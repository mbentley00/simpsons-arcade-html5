// License: BSD-3-Clause, copyright-holders Ernesto Corvi and Alex W. Jackson. See THIRD_PARTY_NOTICES.md.
// Konami K053260 (KDSC) PCM/ADPCM voices, a direct port of MAME devices/sound/k053260.cpp (sample rate = clock / 64).
// Used twice: inside the deterministic machine (voice status, ROM reads, no output) and in the audio renderer (output).
(function (G) {
'use strict';
const PAN = [[0, 0], [127, 0], [116, 52], [104, 73], [90, 90], [73, 104], [52, 116], [0, 127]];
const KADPCM = [0, 1, 2, 4, 8, 16, 32, 64, -128, -64, -32, -16, -8, -4, -2, -1];
const NV = 15; // per-voice slots: position counter output playing start length pitch volume pan loop kadpcm reverse pv0 pv1
const V_POS = 0, V_CNT = 1, V_OUT = 2, V_PLAY = 3, V_START = 4, V_LEN = 5, V_PITCH = 6, V_VOL = 7, V_PAN = 8, V_LOOP = 9,
  V_ADPCM = 10, V_REV = 11, V_PV0 = 12, V_PV1 = 13;
function K053260(rom) {
  this.rom = rom; this.mask = rom ? rom.length - 1 : 0;
  this.v = new Int32Array(4 * NV); this.port = new Uint8Array(4); this.keyon = 0; this.mode = 0;
}
const P = K053260.prototype;
P.reset = function () { this.v.fill(0); this.port.fill(0); this.keyon = 0; this.mode = 0; };
P.save = function () { return { v: this.v.slice(), port: this.port.slice(), keyon: this.keyon, mode: this.mode }; };
P.load = function (s) { this.v.set(s.v); this.port.set(s.port); this.keyon = s.keyon; this.mode = s.mode; };
P.pan = function (o) { const v = this.v; v[o + V_PV0] = v[o + V_VOL] * PAN[v[o + V_PAN]][0]; v[o + V_PV1] = v[o + V_VOL] * PAN[v[o + V_PAN]][1]; };
P.rd = function (a) { return this.rom[a & this.mask]; }; // MAME device_rom_interface: 21-bit space, ROM mirrors (1 MB)
// register write (offset 0..0x3f), the stream must already be advanced to the write time
P.write = function (off, d) {
  off &= 0x3f; const v = this.v;
  if (off >= 8 && off <= 0x27) {
    const o = ((off - 8) >> 3) * NV;
    switch (off & 7) {
      case 0: v[o + V_PITCH] = (v[o + V_PITCH] & 0xf00) | d; break;
      case 1: v[o + V_PITCH] = (v[o + V_PITCH] & 0xff) | ((d << 8) & 0xf00); break;
      case 2: v[o + V_LEN] = (v[o + V_LEN] & 0xff00) | d; break;
      case 3: v[o + V_LEN] = (v[o + V_LEN] & 0xff) | (d << 8); break;
      case 4: v[o + V_START] = (v[o + V_START] & 0x1fff00) | d; break;
      case 5: v[o + V_START] = (v[o + V_START] & 0x1f00ff) | (d << 8); break;
      case 6: v[o + V_START] = (v[o + V_START] & 0xffff) | ((d << 16) & 0x1f0000); break;
      default: v[o + V_VOL] = d & 0x7f; this.pan(o);
    }
    return;
  }
  switch (off) {
    case 2: case 3: this.port[off] = d; break;
    case 0x28: {
      const rise = d & ~this.keyon;
      for (let i = 0; i < 4; i++) {
        const o = i * NV; v[o + V_REV] = (d >> (i + 4)) & 1;
        if ((rise >> i) & 1) { v[o + V_POS] = v[o + V_ADPCM] ? 1 : 0; v[o + V_CNT] = 0x1000 - 64; v[o + V_OUT] = 0; v[o + V_PLAY] = 1; }
        else if (!((d >> i) & 1)) { v[o + V_POS] = 0; v[o + V_OUT] = 0; v[o + V_PLAY] = 0; }
      }
      this.keyon = d; break;
    }
    case 0x2a: for (let i = 0; i < 4; i++) { v[i * NV + V_LOOP] = (d >> i) & 1; v[i * NV + V_ADPCM] = (d >> (i + 4)) & 1; } break;
    case 0x2c: v[V_PAN] = d & 7; this.pan(0); v[NV + V_PAN] = (d >> 3) & 7; this.pan(NV); break;
    case 0x2d: v[2 * NV + V_PAN] = d & 7; this.pan(2 * NV); v[3 * NV + V_PAN] = (d >> 3) & 7; this.pan(3 * NV); break;
    case 0x2f: this.mode = d; break;
  }
};
// register read (sub CPU side); stream must be advanced first for 0x29
P.read = function (off) {
  off &= 0x3f; const v = this.v;
  if (off < 2) return this.port[off];
  if (off === 0x29) { let r = 0; for (let i = 0; i < 4; i++) r |= v[i * NV + V_PLAY] << i; return r; }
  if (off === 0x2e) {
    if (!(this.mode & 1)) return 0;
    const offs = v[V_START] + v[V_POS]; v[V_POS] = (v[V_POS] + 1) & 0xffff; return this.rd(offs);
  }
  return 0;
};
// generate n samples; out (Int32Array, interleaved L/R, clamped to +-32768 like put_int_clamp) may be null (state only)
P.run = function (n, out, oi) {
  const v = this.v;
  if (!(this.mode & 2)) { if (out) for (let j = 0; j < 2 * n; j++) out[oi + j] = 0; return; }
  for (let j = 0; j < n; j++) {
    let l = 0, r = 0;
    for (let o = 0; o < 4 * NV; o += NV) {
      if (!v[o + V_PLAY]) continue;
      let cnt = v[o + V_CNT] + 64;
      if (cnt >= 0x1000) {
        let stop = 0;
        do {
          cnt = (cnt - 0x1000 + v[o + V_PITCH]) & 0xffff;
          const pos = (v[o + V_POS] + 1) >>> 0; v[o + V_POS] = pos;
          let bp = v[o + V_ADPCM] ? pos >>> 1 : pos;
          if (bp > v[o + V_LEN]) {
            if (v[o + V_LOOP]) { v[o + V_POS] = 0; v[o + V_OUT] = 0; bp = 0; }
            else { v[o + V_PLAY] = 0; stop = 1; break; }
          }
          let d = this.rd(v[o + V_START] + (v[o + V_REV] ? -bp : bp));
          if (v[o + V_ADPCM]) { if (v[o + V_POS] & 1) d >>= 4; v[o + V_OUT] = ((v[o + V_OUT] + KADPCM[d & 15]) << 24) >> 24; }
          else v[o + V_OUT] = (d << 24) >> 24;
        } while (cnt >= 0x1000);
        v[o + V_CNT] = cnt;
        if (stop) continue;
      } else v[o + V_CNT] = cnt;
      l += (v[o + V_OUT] * v[o + V_PV0]) >> 6; r += (v[o + V_OUT] * v[o + V_PV1]) >> 6;
    }
    if (out) {
      out[oi + 2 * j] = l < -32768 ? -32768 : l > 32767 ? 32767 : l;
      out[oi + 2 * j + 1] = r < -32768 ? -32768 : r > 32767 ? 32767 : r;
    }
  }
};
G.K053260 = K053260;
if (typeof module !== 'undefined') module.exports = K053260;
})(typeof window !== 'undefined' ? window : globalThis);
