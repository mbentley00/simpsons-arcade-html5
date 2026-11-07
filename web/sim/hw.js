// TODO(simpsons): ssriders board register layout below; simpsons.cpp is different (see NOTES.md hardware map).
// Video-hardware state shared by the attract sim and the renderer (same layout as tools/attract_state.py).
// The sim writes these through bus helpers that mirror how the 68000 sees the chips.
'use strict';
(function (G) {
  const FIELDS = [['pal', 0x1000], ['k052109', 0x6000], ['k052109_regs', 12], ['k053251', 16], ['k053244', 16], ['k053245_buf', 0x800], ['misc', 2]];
  const REC = FIELDS.reduce((a, f) => a + f[1], 0);
  function newVideo() { const v = {}; for (const [k, n] of FIELDS) v[k] = new Uint8Array(n); v.misc[0] = 0x10; return v; }
  // k052109 via ssriders k052109_word_w (tmnt2.cpp): word offset; UDS byte -> ram[o], LDS byte -> ram[o+0x2000]
  function vramOff(a) { return (a >> 1) & 0x1fff; }
  function vramWriteB(v, a, d) { // byte write (move.b) at 0x600000+a
    const o = vramOff(a); if (a & 1) v.k052109[o + 0x2000] = d & 0xff; else v.k052109[o] = d & 0xff;
  }
  function fromRecord(buf, off) { const v = {}; let p = off; for (const [k, n] of FIELDS) { v[k] = buf.subarray(p, p + n); p += n; } return v; }
  function toRecord(v, out, off) { let p = off; for (const [k, n] of FIELDS) { out.set(v[k], p); p += n; } }
  const api = { FIELDS, REC, newVideo, vramOff, vramWriteB, fromRecord, toRecord };
  if (typeof module !== 'undefined') module.exports = api; else G.SSRHW = api;
})(typeof window !== 'undefined' ? window : globalThis);
