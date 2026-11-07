// Audio output: the board's mixed 55930 Hz int16 stereo (sim/simpsons.js drainAudio, bit-exact vs MAME -wavwrite) is
// posted here once per emulated frame and played from a ring buffer, resampled linearly to the context rate. The
// emulation is paced by rAF, so the read step is nudged (+-0.5%) to hold ~50 ms of buffered audio instead of drifting.
class SimpsonsOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.N = 1 << 16; this.L = new Float32Array(this.N); this.R = new Float32Array(this.N);
    this.w = 0; this.r = 0; this.step = 55930 / sampleRate; this.target = 55930 * 0.05; this.started = false;
    this.port.onmessage = e => {
      const d = e.data; if (d.reset) { this.w = this.r = 0; this.started = false; return; }
      const p = d.pcm, n = p.length >> 1;
      for (let i = 0; i < n; i++) { const j = (this.w + i) & (this.N - 1); this.L[j] = p[2 * i] / 32768; this.R[j] = p[2 * i + 1] / 32768; }
      this.w += n; if (this.w - this.r > this.N - 4096) this.r = this.w - this.target; // overrun: drop to target
    };
  }
  process(_, outs) {
    const o = outs[0], L = o[0], R = o[1] || o[0], M = this.N - 1;
    let fill = this.w - this.r;
    if (!this.started) { if (fill < this.target) { L.fill(0); R.fill(0); return true; } this.started = true; }
    const st = this.step * (1 + Math.max(-0.005, Math.min(0.005, (fill - this.target) / this.target * 0.01)));
    for (let i = 0; i < L.length; i++) {
      if (this.w - this.r < 2) { L[i] = R[i] = 0; this.started = false; continue; }
      const k = Math.floor(this.r), f = this.r - k, a = k & M, b = (k + 1) & M;
      L[i] = this.L[a] + (this.L[b] - this.L[a]) * f; R[i] = this.R[a] + (this.R[b] - this.R[a]) * f;
      this.r += st;
    }
    return true;
  }
}
registerProcessor('simpsons-out', SimpsonsOut);
