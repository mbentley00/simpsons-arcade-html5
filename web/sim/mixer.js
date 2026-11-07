// Audio renderer: replays the sound board's register log (sound.js) into the sound chips and mixes them like MAME's
// ssriders driver (YM2151 x1.0 and K053260 x0.70 on both speakers), at the chip rate 3579545/64 Hz, then resamples
// with MAME's default 'lofi' resampler (pairs averaged when the source rate is above the
// output rate, then 4-point interpolation with the same table) so the result matches MAME -wavwrite. Runs in node (offline WAV) and in the AudioWorklet (web/audio_worklet.js).
(function (G) {
'use strict';
const YM2151 = typeof require !== 'undefined' ? require('./ym2151.js') : G.YM2151;
const K053260 = typeof require !== 'undefined' ? require('./k053260.js') : G.K053260;
const CHIP_HZ = 55930; // MAME stream rate (integer 3579545/64); sample indices in the log are on this grid
function SoundMixer(pcmrom, outHz) {
  this.ym = new YM2151(); this.k = new K053260(pcmrom); this.k.reset();
  this.q = []; this.qi = 0;          // pending log entries (flat triples) and read index
  this.n = 0;                        // chip samples rendered
  this.kb = new Int32Array(2 * 256);
  this.outHz = outHz || 48000; this.div = CHIP_HZ <= this.outHz ? 1 : 1 + Math.floor(CHIP_HZ / this.outHz);
  this.d = 0;                        // output samples produced (MAME maps each one to a source position exactly)
  this.A = new Float32Array(2 * 64); this.an = 0; // ring of averaged source frames, an = number produced
}
const P = SoundMixer.prototype;
P.push = function (entries) { if (this.qi > 4096) { this.q = this.q.slice(this.qi); this.qi = 0; } for (let i = 0; i < entries.length; i++) this.q.push(entries[i]); };
// skip (+1) or repeat (-1) one output sample, for the worklet to follow the emulation clock
P.nudge = function (k) { this.d = Math.max(0, this.d + k); };
// render one chip sample, returns the mix in this.mL / this.mR
P.chip = function () {
  const q = this.q, n = this.n;
  while (this.qi < q.length && q[this.qi] <= n) {
    const r = q[this.qi + 1], d = q[this.qi + 2]; this.qi += 3;
    if (r < 0x100) this.ym.write(r, d); else if (r < 0x200) this.k.write(r - 0x100, d); else this.k.read(0x2e);
  }
  const y = this.ym.generate(); this.k.run(1, this.kb, 0);
  this.mL = (y[0] + 0.7 * this.kb[0]) / 32768; this.mR = (y[1] + 0.7 * this.kb[1]) / 32768;
  this.n = n + 1;
};
// jump to chip sample n (rounded down to the averaging grid) without producing output: register writes are applied
// in order; only the last `exact` samples are really generated (older envelope/phase detail is irrelevant once silent)
P.skipTo = function (n, exact) {
  n -= n % this.div;
  const q = this.q, from = Math.max(this.n, n - (exact || 0));
  while (this.n < from) {
    let nx = from; if (this.qi < q.length && q[this.qi] < nx) nx = Math.max(this.n, q[this.qi]);
    if (nx > this.n) { this.k.run(nx - this.n, null, 0); this.n = nx; }
    while (this.qi < q.length && q[this.qi] <= this.n) {
      const r = q[this.qi + 1], d = q[this.qi + 2]; this.qi += 3;
      if (r < 0x100) this.ym.write(r, d); else if (r < 0x200) this.k.write(r - 0x100, d); else this.k.read(0x2e);
    }
  }
  while (this.n < n) this.chip();
  this.an = n / this.div; this.A.fill(0);
  this.d = Math.ceil(n * this.outHz / CHIP_HZ);
};
// restart at chip sample n from a register image (netplay: a full-state load). The YM2151 gets its register file
// rewritten (key-on 0x08 skipped: notes restart on their next key-on), the K053260 its saved voice state.
P.resync = function (n, ymRegs, kState) {
  this.q = []; this.qi = 0; this.ym.reset();
  for (let r = 0x20; r < 0x100; r++) this.ym.write(r, ymRegs[r]);
  for (const r of [0x01, 0x0f, 0x18, 0x19, 0x1b]) this.ym.write(r, ymRegs[r]);
  if (kState) this.k.load(kState);
  n -= n % this.div; this.n = n; this.an = n / this.div; this.A.fill(0); this.d = Math.ceil(n * this.outHz / CHIP_HZ);
};
// produce averaged source frame number an (average of div chip samples)
P.next = function () {
  let l = 0, r = 0;
  for (let i = 0; i < this.div; i++) { this.chip(); l += this.mL; r += this.mR; }
  const j = (this.an & 63) * 2; this.A[j] = l / this.div; this.A[j + 1] = r / this.div; this.an++;
};
const T0 = new Float32Array(0x1001), T1 = new Float32Array(0x1001);
for (let i = 1; i < 4096; i++) { const p = Math.fround(i / 4096); T0[i] = Math.fround((p - p * p * p) / 6); }
for (let i = 1; i < 2049; i++) { const p = Math.fround(i / 4096); T1[i] = Math.fround(p + (p * p - p * p * p) / 2); }
for (let i = 2049; i < 4096; i++) T1[i] = Math.fround(1 + T0[i] + T0[4096 - i] - T1[4096 - i]);
T1[0x1000] = 1;
// fill L/R Float32Arrays with m output samples (audio_resampler_lofi::apply, source position per output sample)
P.render = function (L, R, m) {
  const fs = CHIP_HZ, ft = this.outHz, div = this.div, A = this.A;
  for (let i = 0; i < m; i++, this.d++) {
    const sec = Math.floor(this.d / ft), ds = this.d - sec * ft;
    const ss = Math.floor(ds * fs * 4096 / ft);
    let ssample = Math.floor(ss / 4096) + fs * sec, phase = ss & 0xfff;
    if (div > 1) { const dl = ssample % div; phase = Math.floor((phase | (dl << 12)) / div); ssample -= dl; }
    const b = ssample / div;                 // s0..s3 = averaged frames b-4 .. b-1
    while (this.an < b) this.next();
    const g = k => { const j = b - 4 + k; return j < 0 || j < this.an - 64 ? 0 : 1; };
    const c = phase, a0 = T0[0x1000 - c], a1 = T1[0x1000 - c], a2 = T1[c], a3 = T0[c];
    let l = 0, r = 0;
    for (let k = 0; k < 4; k++) {
      if (!g(k)) continue;
      const j = ((b - 4 + k) & 63) * 2, w = k === 0 ? -a0 : k === 1 ? a1 : k === 2 ? a2 : -a3;
      l += A[j] * w; r += A[j + 1] * w;
    }
    L[i] = l; R[i] = r;
  }
};
SoundMixer.CHIP_HZ = CHIP_HZ;
G.SoundMixer = SoundMixer;
if (typeof module !== 'undefined') module.exports = SoundMixer;
})(typeof window !== 'undefined' ? window : globalThis);
