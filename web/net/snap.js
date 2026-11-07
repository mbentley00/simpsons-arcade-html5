// Snapshot helpers for the netcode: a Machine.save() object is a tree of typed arrays, numbers and plain arrays.
// hash(): 32-bit FNV-1a-style hash over the whole tree (deterministic order); pack()/unpack(): one binary blob
// (JSON skeleton + raw typed-array bytes) for the reliable channel.
(function (G) {
  'use strict';
  const TA = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float64Array };
  // 'nsnd' (length of the 68000's debug sound-latch log) is not game state and is skipped
  function hash(o, h = 0x811c9dc5) {
    if (ArrayBuffer.isView(o)) {
      const b = new Uint8Array(o.buffer, o.byteOffset, o.byteLength), n = b.length & ~3, w = new Int32Array(b.buffer.slice(b.byteOffset, b.byteOffset + n));
      for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 0x01000193);
      for (let i = n; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
      return Math.imul(h ^ b.length, 0x01000193);
    }
    if (Array.isArray(o)) { for (const x of o) h = hash(x, h); return Math.imul(h ^ o.length, 0x01000193); }
    if (o && typeof o === 'object') { for (const k of Object.keys(o).sort()) if (k !== 'nsnd') h = hash(o[k], Math.imul(h ^ k.length, 0x01000193)); return h; }
    if (typeof o === 'number') { h = Math.imul(h ^ (o | 0), 0x01000193); return Math.imul(h ^ Math.floor(o / 4294967296), 0x01000193); }
    if (typeof o === 'boolean') return Math.imul(h ^ (o ? 1 : 2), 0x01000193);
    if (typeof o === 'string') { for (let i = 0; i < o.length; i++) h = Math.imul(h ^ o.charCodeAt(i), 0x01000193); return Math.imul(h ^ o.length ^ 0x5a, 0x01000193); }
    return Math.imul(h ^ 7, 0x01000193); // null / undefined
  }
  function pack(o) {
    const bufs = []; let off = 0;
    const sk = JSON.stringify(o, (k, v) => {
      if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice(); bufs.push(b); const r = { $t: v.constructor.name, o: off, n: b.length }; off += (b.length + 7) & ~7; return r; }
      return v;
    });
    const js = new TextEncoder().encode(sk), out = new Uint8Array(8 + ((js.length + 7) & ~7) + off), dv = new DataView(out.buffer);
    dv.setUint32(0, js.length, true); out.set(js, 8); let p = 8 + ((js.length + 7) & ~7);
    for (const b of bufs) { out.set(b, p); p += (b.length + 7) & ~7; }
    return out;
  }
  function unpack(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = dv.getUint32(0, true), base = 8 + ((n + 7) & ~7);
    return JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n)), (k, v) => {
      if (v && typeof v === 'object' && v.$t) { const C = TA[v.$t]; const b = u8.slice(base + v.o, base + v.o + v.n); return new C(b.buffer); }
      return v;
    });
  }
  const api = { hash, pack, unpack };
  if (typeof module !== 'undefined') module.exports = api; else G.SSRSNAP = api;
})(typeof window !== 'undefined' ? window : globalThis);
