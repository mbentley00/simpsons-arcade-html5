// Game-side hook for the stage editor (editor.html):
//  - applies the edits saved by the editor (localStorage, see SIMPSTAGE.PATCH_KEY) to the board's prog ROM. The game
//    checksums its ROM while booting and stops on a mismatch, so the bytes are written only after that check, when the
//    main state ($02) goes from 0 to 1. Stage maps are read later, when a stage loads.
//  - ?scene=N starts the game at scene N (main game state $03, see docs/stage-format.md) instead of stage 1: when the
//    title code moves $03 from 1 to 2 the write is changed to N. Coin and Start work as usual.
// Both are off in an online room (?sala=) and with ?mods=0, because every peer must run the same ROM.
(function (G) {
  'use strict';
  const q = new URLSearchParams(location.search);
  const off = q.get('mods') === '0' || q.has('sala');
  let pending = null, active = 0, enemies = {}, tilesets = {};
  const sc = Number(q.get('scene')), warp = !off && Number.isInteger(sc) && sc >= 2 && sc <= 16;
  let done = !warp;
  function saved() {
    try { const j = JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY) || 'null'); return j && j.bytes ? j : null; } catch (e) { return null; }
  }
  function badge(text) {
    const d = document.createElement('div'); d.textContent = text;
    d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:30;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.7);color:#ffc861;font:12px system-ui,sans-serif;pointer-events:none';
    document.body.appendChild(d); setTimeout(() => d.remove(), 8000);
  }
  function apply(files) { // called before the board exists: only remember the edits
    if (off || !G.SIMPSTAGE) return files;
    const doc = saved(); if (doc && Object.keys(doc.bytes).length) pending = doc.bytes;
    if (doc && doc.tilesets && G.SIMPTILES) tilesets = SIMPTILES.validate(doc.tilesets);
    if (doc && doc.enemies && G.SIMPENEMY) try { enemies = SIMPENEMY.validate(doc.enemies); } catch (e) { console.warn('Ignoring invalid enemy edits:', e.message); }
    return files;
  }
  function install(m, video) {
    if (!off && G.SIMPENEMY) SIMPENEMY.install(m, video, enemies, G.SIMPENEMY_ASSETS || G.SIMPDUFFMAN);
    // custom level art; carriers come from the original ROM, which is still loaded at this point
    if (!off && G.SIMPTILES && video) for (const id of Object.values(tilesets)) SIMPTILES.install(m, video, SIMPTILES.sets[id]);
    if (!pending && !warp) return;
    const mw0 = m.mw;
    m.mw = function (a, v) {
      // The boot RAM test also writes FF/AA/55 here. Only state 1 marks the completed ROM check.
      if (pending && a === 0x4802 && v === 1 && this.ram[0x802] === 0) {
        const r = SIMPSTAGE.applyPatch(this.prog, pending); this.prog = r.prog; active = r.n; pending = null;
        badge(`Stage edits on (${r.n} bytes). Online play needs everyone on the same ROM. ?mods=0 turns edits off.`);
      }
      // Attract mode also goes through scene 1 -> 2. It must not consume the player's stage selection.
      if (!done && a === 0x4803 && v === 2 && this.ram[0x803] === 1 && this.ram[0x800] === 2) { done = true; v = sc; }
      return mw0.call(this, a, v);
    };
    if (warp && q.get('play') !== '1') badge(`Insert a coin and press Start: the game begins at scene ${sc}.`);
  }
  function assertOnline() {
    if (G.SIMPCOMBAT) SIMPCOMBAT.assertOnline();
    if (pending || active || warp || Object.keys(enemies).length || Object.keys(tilesets).length) throw new Error('Stage edits and scene selection are enabled. Open the game with ?mods=0 before creating or joining an online room.');
  }
  function restore(m) { // a cached launch state has already passed the ROM checks
    if (pending) { const r = SIMPSTAGE.applyPatch(m.prog, pending); m.prog = r.prog; active = r.n; pending = null; }
    done = true;
  }
  G.SIMPMODS = { apply, install, restore, assertOnline, get active() { return active; }, get scene() { return warp ? sc : null; }, get tilesets() { return tilesets; } };
})(window);
