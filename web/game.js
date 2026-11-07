// The Simpsons remake entry point: asks for the user's simpsons.zip (romload.js), loads the MAME-exact board model
// (sim/simpsons.js on sim/sched.js, KONAMI + Z80 cores) and video (sim/video.js) through sim/cjs.js, runs it at
// 59.1856 Hz (FRAME = 264 lines x 384 px at 6 MHz) and presents through gfx.js (CRT + bezel).
// Debug/test: ?pause=1 (no free run; drive with SIMPG.run(n)).
'use strict';
(function (G) {
  const W = 320, H = 224, q = new URLSearchParams(location.search), PAUSE = q.get('pause') === '1';
  const cv = document.getElementById('screen'), ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  const px32 = new Uint32Array(img.data.buffer);
  let paused = false, shown = -1, m = null, v = null, STEP = 0, acc = 0, last = 0, fresh = false, stats = { steps: 0, ms: 0 };
  function blit(rgb) { for (let i = 0; i < W * H; i++) { const c = rgb[i]; px32[i] = 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff); } }
  function draw() { if (G.SSRCHAT && m) SSRCHAT.draw(m); if (!fresh) return; fresh = false; ctx.putImageData(img, 0, 0); if (G.SSRGFX) SSRGFX.present(img); }
  function run(n) { if (net && net.active()) return netTick(n); const t0 = performance.now(); for (let i = 0; i < n; i++) { if (G.SIMPI) SIMPI.apply(m); m.runFrames(1); audioOut(m.drainAudio()); } stats.steps += n; stats.ms += performance.now() - t0; }
  // ---- netplay (net/ui.js): the rollback session owns the stepping; it calls netStep(fi, f) for every (re)simulated
  // frame. Per-frame rendering is off while online (resimulated frames are never drawn); after each tick the current
  // state is drawn once. Audio: every frame's PCM is kept and only released when the frame is confirmed (netAudio).
  let net = null, frameNo = 0; const npcm = new Map();
  function netStep(fi, f) { SSRIN.applyFrame(m, fi, 0); m.runFrames(1); npcm.set(f, m.drainAudio()); frameNo = f; }
  function netAudio(snap, f) { const p = npcm.get(f); if (p) { npcm.delete(f); audioOut(p); } for (const k of npcm.keys()) if (k < f - 600) npcm.delete(k); }
  function netAudioResync() { npcm.clear(); }
  function netTick(n) {
    const t0 = performance.now(), fi = SSRIN.sample(), any = fi[0] | fi[1] | fi[2] | fi[3];
    for (let i = 0; i < n; i++) net.tick(any);
    if (n) { v.render(); blit(v.toRGB()); fresh = true; shown = m.frame; if (G.SIMPI) SIMPI.onFrame(m); }
    stats.steps += n; stats.ms += performance.now() - t0;
  }
  function tick(t) {
    acc += Math.min(250, t - (last || t)); last = t;
    let n = 0; while (acc >= STEP) { acc -= STEP; n++; }
    if (paused) n = 0;
    if (net && net.active()) netTick(n); else if (n) run(n);
    draw(); requestAnimationFrame(tick);
  }
  // ---- audio: AudioWorklet fed with the board's 55930 Hz PCM; the context starts on the first user gesture (autoplay)
  let ac = null, node = null; const apcm = [];
  function audioOut(p) { if (!p.length) return; if (node) node.port.postMessage({ pcm: p }, [p.buffer]); else if (G.SIMPG && SIMPG.keepAudio) apcm.push(p); }
  async function audioStart() {
    if (ac || q.get('mute') === '1') return;
    try {
      ac = new AudioContext({ latencyHint: 'interactive' }); await ac.audioWorklet.addModule('audio_worklet.js');
      node = new AudioWorkletNode(ac, 'simpsons-out', { outputChannelCount: [2] }); node.connect(ac.destination);
    } catch (e) { console.warn('audio unavailable:', e.message); ac = node = null; }
  }
  for (const ev of ['pointerdown', 'keydown', 'gamepadconnected']) addEventListener(ev, () => { audioStart(); if (ac && ac.state === 'suspended') ac.resume(); });
  function hash() { let h = 0x811c9dc5; const d = px32; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; }
  const ready = (async () => {
    const mods = await SIMCJS.load('sim/', ['simpsons.js', 'video.js']);
    G.SIMPM = mods['simpsons.js']; G.SimpsonsVideo = mods['video.js'];
    STEP = 1000 / SIMPM.HZ;
    let files = G.SSRROM ? await SSRROM.ensure() : {};
    files = Object.assign({}, files || {});
    const eep = G.SIMPI && SIMPI.eepromLoad(); if (eep) files['eeprom.bin'] = eep; // saved high scores / settings
    m = new SIMPM.Board(files); m.audio = true; v = new SimpsonsVideo.Video(m);
    // MAME (VIDEO_UPDATE_AFTER_VBLANK) shows frame n's bitmap at the next vblank end with the palette at that time
    let pend = false;
    m.onFrame = () => { if (net && net.active()) return; if (pend) { blit(v.toRGB()); fresh = true; shown = m.frame - 1; } v.render(); pend = true; if (G.SIMPI) SIMPI.onFrame(m); };
    addEventListener('resize', () => G.SSRGFX && SSRGFX.layout()); if (G.SSRGFX) SSRGFX.layout();
    if (!PAUSE) requestAnimationFrame(tick);
  })();
  ready.catch(e => console.error(e));
  G.SIMPG = G.SSRG = { ready, run: n => { run(n); draw(); }, hash, stats, get m() { return m; }, get v() { return v; }, get frame() { return m.frame; }, get shown() { return shown; }, pixels: () => Array.from(px32), keepAudio: false, takeAudio: () => { const a = apcm.splice(0); const r = []; for (const p of a) for (const x of p) r.push(x); return r; }, audioStart, get audio() { return ac; },
    get machine() { return m; }, get video() { return v; }, pause: x => { paused = !!x; }, msPerFrame: () => stats.steps ? stats.ms / stats.steps : 0, netStep, netAudio, netAudioResync, get frameNo() { return frameNo || m.frame; }, set frameNo(x) { frameNo = x; }, get net() { return net; }, set net(x) { net = x; } };
})(window);
