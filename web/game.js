// The Simpsons remake entry point: asks for the user's simpsons.zip (romload.js), loads the MAME-exact board model
// (sim/simpsons.js on sim/sched.js, KONAMI + Z80 cores) and video (sim/video.js) through sim/cjs.js, runs it at
// 59.1856 Hz (FRAME = 264 lines x 384 px at 6 MHz) and presents through gfx.js (CRT + bezel).
// Debug/test: ?pause=1 (no free run; drive with SIMPG.run(n)).
'use strict';
(function (G) {
  const W = 320, H = 224, q = new URLSearchParams(location.search), PAUSE = q.get('pause') === '1';
  const cv = document.getElementById('screen'), ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  const px32 = new Uint32Array(img.data.buffer);
  // base: the clean game frame. px32 = base plus the Arcade Remix overlay (web/combat.js), redrawn every display frame
  // so the in-game HUD, callouts and draft animate even while the board is held. Hashes/pixels() read the clean frame.
  const base = new Uint32Array(W * H); let overlaid = false;
  let paused = false, shown = -1, m = null, v = null, STEP = 0, acc = 0, last = 0, fresh = false, stats = { steps: 0, ms: 0 }, skipRender = false, flushFrame = null;
  let muted = q.get('mute') === '1';
  if (!q.has('mute')) try { muted = localStorage.getItem('simpsons.audio.muted') === '1'; } catch (e) { /* optional preference */ }
  const controlsChanged = () => { if (G.SIMPG && SIMPG.onControlsChange) SIMPG.onControlsChange(); };
  function setPaused(value) {
    if (value && net) return false;
    paused = !!value; acc = last = 0;
    if (G.SSRIN && SSRIN.consumeLatch) SSRIN.consumeLatch();
    if (node) node.port.postMessage({ reset: true });
    syncAudio(); controlsChanged(); return paused;
  }
  function setMuted(value) {
    muted = !!value;
    try { localStorage.setItem('simpsons.audio.muted', muted ? '1' : '0'); } catch (e) { /* optional preference */ }
    syncAudio(); controlsChanged();
  }
  function blit(rgb) { for (let i = 0; i < W * H; i++) { const c = rgb[i]; base[i] = 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff); } }
  function draw() {
    if (G.SSRCHAT && m) SSRCHAT.draw(m);
    if ((G.SIMPCOMBAT || G.SIMPEVENTS) && m && !net) {
      // stage events (giant ball, pins, banners) are drawn under the Remix HUD and draft
      px32.set(base); let d = G.SIMPEVENTS ? SIMPEVENTS.drawOverlay(px32) : false; if (G.SIMPCOMBAT && SIMPCOMBAT.drawOverlay(px32)) d = true;
      if (!fresh && !d && !overlaid) return; overlaid = d;
    } else { if (!fresh) return; px32.set(base); }
    fresh = false; ctx.putImageData(img, 0, 0); if (G.SSRGFX) SSRGFX.present(img);
  }
  function run(n) {
    if (net && net.active()) return netTick(n);
    if ((G.SIMPCOMBAT && SIMPCOMBAT.blocked) || (G.SIMPNPC && SIMPNPC.blocked)) return;
    const t0=performance.now(); let ran=0;
    for(let i=0;i<n;i++) {
      // catching up several frames in one tick: only the last one is drawn (the picture of the others is never shown)
      skipRender = i < n - 1;
      if(G.SIMPI) SIMPI.apply(m);
      if(G.SIMPCOMBAT) SIMPCOMBAT.beforeFrame(m);
      if(G.SIMPEVENTS) SIMPEVENTS.beforeFrame(m);
      if(G.SIMPNPC) SIMPNPC.beforeFrame(m);
      if(G.SIMPNPC&&SIMPNPC.blocked) break;
      m.runFrames(1);
      if(G.SIMPCOMBAT) SIMPCOMBAT.afterFrame(m);
      audioOut(m.drainAudio()); if(G.SSRIN&&SSRIN.consumeLatch) SSRIN.consumeLatch(); ran++;
      if(G.SIMPCOMBAT&&SIMPCOMBAT.blocked) break;
    }
    skipRender = false; if (ran && flushFrame) flushFrame(); stats.steps+=ran; stats.ms+=performance.now()-t0;
  }
  // ---- netplay (net/ui.js): the rollback session owns the stepping; it calls netStep(fi, f) for every (re)simulated
  // frame. Per-frame rendering is off while online (resimulated frames are never drawn); after each tick the current
  // state is drawn once. Audio: every frame's PCM is kept and only released when the frame is confirmed (netAudio).
  let net = null, frameNo = 0; const npcm = new Map();
  function netStep(fi, f) { SSRIN.applyFrame(m, fi, 0); m.runFrames(1); npcm.set(f, m.drainAudio()); frameNo = f; }
  function netAudio(snap, f) { const p = npcm.get(f); if (p) { npcm.delete(f); audioOut(p); } for (const k of npcm.keys()) if (k < f - 600) npcm.delete(k); }
  function netAudioResync() { npcm.clear(); }
  function netTick(n) {
    const t0 = performance.now(), fi = SSRIN.sample(), any = fi[0] | fi[1] | fi[2] | fi[3];
    const sess = net.session;
    const known0 = sess && sess.rb && sess.slot >= 0 ? sess.rb.known[sess.slot] : -1;
    for (let i = 0; i < n; i++) net.tick(any);
    const known1 = sess && sess.rb && sess.slot >= 0 ? sess.rb.known[sess.slot] : -1;
    if (n && (!sess || !sess.rb || known1 > known0)) SSRIN.consumeLatch();
    if (n) { v.render(); blit(v.toRGB()); fresh = true; shown = m.frame; if (G.SIMPI) SIMPI.onFrame(m); }
    stats.steps += n; stats.ms += performance.now() - t0;
  }
  // At most CATCHUP emulated frames per display frame. A computer too slow for full speed then runs the game a little
  // slower but keeps drawing every tick, instead of stalling for up to 15 frames (250 ms) at a time and jumping ahead.
  const CATCHUP = 4;
  function tick(t) {
    acc += Math.min(250, t - (last || t)); last = t;
    if (!(net && net.active())) acc = Math.min(acc, STEP * CATCHUP);
    let n = 0; while (acc >= STEP) { acc -= STEP; n++; }
    if (paused) n = 0;
    if (net && net.active()) netTick(n); else if (n) run(n);
    draw(); requestAnimationFrame(tick);
  }
  // ---- audio: AudioWorklet fed with the board's 55930 Hz PCM; the context starts on the first user gesture (autoplay)
  let ac = null, node = null, gain = null; const apcm = [];
  function syncAudio() { if (gain) gain.gain.value = paused || muted ? 0 : 1; }
  function audioOut(p) { if (!p.length) return; if (node) { if (!paused) node.port.postMessage({ pcm: p }, [p.buffer]); } else if (G.SIMPG && SIMPG.keepAudio) apcm.push(p); }
  async function audioStart() {
    if (ac) return;
    try {
      ac = new AudioContext({ latencyHint: 'interactive' }); await ac.audioWorklet.addModule('audio_worklet.js');
      node = new AudioWorkletNode(ac, 'simpsons-out', { outputChannelCount: [2] });
      gain = ac.createGain(); syncAudio(); node.connect(gain); gain.connect(ac.destination);
    } catch (e) { console.warn('audio unavailable:', e.message); ac = node = gain = null; }
  }
  for (const ev of ['pointerdown', 'keydown', 'gamepadconnected']) addEventListener(ev, () => { audioStart(); if (ac && ac.state === 'suspended') ac.resume(); });
  function hash() { let h = 0x811c9dc5; const d = base; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; }
  const ready = (async () => {
    const mods = await SIMCJS.load('sim/', ['simpsons.js', 'video.js']);
    G.SIMPM = mods['simpsons.js']; G.SimpsonsVideo = mods['video.js'];
    STEP = 1000 / SIMPM.HZ;
    let files = G.SSRROM ? await SSRROM.ensure() : {};
    files = Object.assign({}, files || {});
    const eep = G.SIMPI && SIMPI.eepromLoad(); if (eep) files['eeprom.bin'] = eep; // saved high scores / settings
    if (G.SIMPTILES) await SIMPTILES.ready; // custom level art (web/stage/tileset.js)
    if (G.SIMPMODS) files = SIMPMODS.apply(files); // stage editor edits (web/stage/mods.js)
    m = new SIMPM.Board(files); m.audio = true; v = new SimpsonsVideo.Video(m);
    if (G.SIMPMODS) SIMPMODS.install(m, v); // ?scene=N and custom enemy spawns
    const launched = G.SIMPLAUNCH && await SIMPLAUNCH.prepare(m);
    if (G.SIMPCOMBAT) SIMPCOMBAT.install(m);
    if (G.SIMPNPC) SIMPNPC.install(m);
    // MAME (VIDEO_UPDATE_AFTER_VBLANK) shows frame n's bitmap at the next vblank end with the palette at that time
    let pend = false;
    flushFrame = () => { if (!pend) { v.render(); pend = true; } }; // the loop stopped early on a frame that skipped drawing
    m.onFrame = () => { if (net && net.active()) return; if (pend) { blit(v.toRGB()); fresh = true; shown = m.frame - 1; } if (skipRender) pend = false; else { v.render(); pend = true; } if (G.SIMPI) SIMPI.onFrame(m); };
    addEventListener('resize', () => G.SSRGFX && SSRGFX.layout()); if (G.SSRGFX) SSRGFX.layout();
    if (launched) { v.render(); blit(v.toRGB()); fresh = true; shown = m.frame; draw(); }
    if (!PAUSE) requestAnimationFrame(tick);
  })();
  ready.catch(e => console.error(e));
  G.SIMPG = G.SSRG = { ready, run: n => { run(n); draw(); }, hash, stats, get m() { return m; }, get v() { return v; }, get frame() { return m.frame; }, get shown() { return shown; }, pixels: () => Array.from(base), screenPixels: () => Array.from(px32), keepAudio: false, takeAudio: () => { const a = apcm.splice(0); const r = []; for (const p of a) for (const x of p) r.push(x); return r; }, audioStart, get audio() { return ac; },
    get machine() { return m; }, get video() { return v; }, pause: setPaused, get paused() { return paused; }, mute: setMuted, get muted() { return muted; }, get audioGain() { return gain ? gain.gain.value : 0; },
    msPerFrame: () => stats.steps ? stats.ms / stats.steps : 0, netStep, netAudio, netAudioResync, get frameNo() { return frameNo || m.frame; }, set frameNo(x) { frameNo = x; }, get net() { return net; }, set net(x) { net = x; if (x) setPaused(false); else controlsChanged(); } };
})(window);
