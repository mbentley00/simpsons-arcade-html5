// Offline editor launch: run native initialization without displaying intros, then cache the ready-to-play state
// privately in this browser. No checkpoints or ROM data are shipped in the code package.
(function (G) {
  'use strict';
  const q = new URLSearchParams(location.search), enabled = q.get('play') === '1' && G.SIMPMODS && SIMPMODS.scene !== null;
  const nativeScene = { 5: 6, 10: 11, 14: 15 };
  function playable(m, target) {
    const r = m.ram, scene = nativeScene[target.scene] || target.scene;
    if (r[0x800] !== 2 || r[0x802] !== 1 || r[0x803] !== scene || r[0x875] !== target.st) return false;
    if (scene === 16) return r[0x804] >= 1;
    // Bonus rounds use their own player objects, not the beat-em-up actor at 4A40.
    if (scene === 3 || scene === 12) return r[0x804] >= 3;
    const phase = scene === 7 ? 3 : scene === 15 ? 5 : 4;
    return r[0x804] >= phase && (r[0xa40] & 0xc0) === 0xc0;
  }
  function hash(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16); }
  function cache(key, value) {
    return new Promise(resolve => {
      if (!G.indexedDB) { resolve(null); return; }
      let db;
      const open = indexedDB.open('simpsons.editor.launch.v1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('states');
      open.onerror = open.onblocked = () => resolve(null);
      open.onsuccess = () => {
        db = open.result;
        try {
          const tx = db.transaction('states', value ? 'readwrite' : 'readonly'), store = tx.objectStore('states');
          const req = value ? store.put(value, key) : store.get(key); let result = null;
          req.onsuccess = () => { result = req.result; };
          tx.oncomplete = () => { db.close(); resolve(result); };
          tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
        } catch (e) { db.close(); resolve(null); }
      };
    });
  }
  async function prepare(m) {
    if (!enabled) return false;
    const target = SIMPSTAGE.SCENES.find(s => s.scene === SIMPMODS.scene);
    if (!target) return false;
    const overlay = document.createElement('div'); overlay.id = 'stage-launch'; overlay.setAttribute('role', 'status');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-content:center;text-align:center;background:#17120d;color:#ffc861;font:18px system-ui;padding:24px';
    const title = document.createElement('strong'); const ts = SIMPMODS.tilesets && SIMPMODS.tilesets[target.scene]; title.textContent = 'Starting ' + (ts && G.SIMPTILES ? SIMPTILES.sets[ts].name : target.name);
    const detail = document.createElement('p'); detail.textContent = 'Preparing gameplay. Introductions will be skipped.';
    overlay.append(title, detail); document.body.appendChild(overlay);
    let patch = ''; try { patch = localStorage.getItem(SIMPSTAGE.PATCH_KEY) || ''; } catch (e) { /* optional storage */ }
    const art = Object.entries(G.SIMPENEMY_ASSETS || {}).sort().map(([id, a]) => [id, hash(a.tiles + JSON.stringify([a.palette, a.displayScale]))]);
    const signature = JSON.stringify({ version: 6, art, scene: target.scene, build: G.SIMP_BUILD || '', patch, eeprom: Array.from(m.eep.data) });
    const key = target.scene + '/' + hash(signature), cached = q.get('fresh') === '1' ? null : await cache(key);
    if (cached && cached.signature === signature) {
      SIMPMODS.restore(m); m.load(cached.state); m.drainAudio();
      if (playable(m, target)) { overlay.remove(); return true; }
      // A stale/unusable checkpoint must never silently send the player to the wrong scene.
      detail.textContent = 'The saved stage launch could not be restored. Reload with &fresh=1 added to the address.';
      throw new Error(detail.textContent);
    }
    const oldFrame = m.onFrame; m.onFrame = null;
    try {
      const end = m.frame + 3600;
      while (m.frame < end && !playable(m, target)) {
        const until = Math.min(end, m.frame + 24);
        while (m.frame < until && !playable(m, target)) {
          // Real coin/start/confirm ports: let the original game create the player and scene normally.
          m.inputs.COIN = m.frame % 60 < 8 ? 0xfe : 0xff;
          m.inputs.P1 = m.ram[0x800] === 2 && m.ram[0x803] === 1 ? (m.frame % 16 < 8 ? 0x6f : 0xff) : (m.frame % 30 < 8 ? 0x7f : 0xff);
          m.runFrames(1); m.drainAudio();
        }
        detail.textContent = m.ram[0x800] === 2 ? 'Loading the stage and skipping its introduction…' : 'Preparing the game for its first launch…';
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!playable(m, target)) throw new Error('The selected stage did not become playable. Return to the editor and try again.');
      m.inputs.COIN = m.inputs.P1 = 255;
      // Skip cached reads with &fresh=1, but still refresh the checkpoint after a successful launch.
      await cache(key, { signature, state: m.save() });
      overlay.remove(); return true;
    } catch (e) {
      detail.textContent = e.message;
      const back = document.createElement('a'); back.href = 'editor.html'; back.textContent = 'Return to editor'; back.style.color = '#7ad0ff'; overlay.appendChild(back);
      throw e;
    } finally { m.onFrame = oldFrame; m.inputs.COIN = m.inputs.P1 = 255; }
  }
  G.SIMPLAUNCH = { enabled, prepare, playable };
})(window);
