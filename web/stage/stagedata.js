// Stage background data in the program ROM (prog.bin, 0x80000 bytes; bank n = n*0x2000, fixed 0x8000-0xffff = 0x78000).
// Format notes and how they were found: docs/stage-format.md. Runs in Node (tests) and in the page (window.SIMPSTAGE).
//
// Per stage value ($75, 0x80 set = 4-player tables) and section ($76), each scrolling layer has:
//   map:  bank + pointer to a list of screen pointers (one per 256 px column). A screen is rows x 8 big-endian words;
//         the low 10 bits are a block number, the top 6 bits are kept as they are (meaning unknown).
//   meta: bank + pointer to the block table. A block is 18 bytes: K052109 attribute byte, one unused byte, then 4x4
//         tile codes (row-major). Tile number = code | (attr & 0x3f) << 8, bank bits remapped through the CRB pair.
'use strict';
(function (G) {
  const FIX = a => 0x78000 + a - 0x8000;
  const LAYER_DESC = [0xeca1, 0xecb3];          // descriptor pointers listed at $ec9d (back layer, front layer)
  const META_ALT = [0xed29, 0xedbb];            // block tables, used by $c8bd / $c8f7 when $75 & 0x80
  const PAL_ALT = 0xeaeb, PAL_STD = 0xe9cb;     // palette lists read at $bcce
  const CRB_ALT = 0xef63;                       // K052109 char bank pairs, $c931
  // Scenes ($03, main game state machine table at $e6d9) and what each one loads. Palette ids and masks were read
  // from the running game (palette loader at $bcd1), not from a table, so they are listed here.
  const SCENES = [
    { scene: 2, st: 0x82, pal: 0x81, mask: 15, name: 'Stage 1 - street' },
    { scene: 3, st: 0x83, pal: 0x82, mask: 15, name: 'Bonus round 1' },
    { scene: 4, st: 0x84, pal: 0x83, mask: 15, name: 'Stage 2 - amusement park' },
    { scene: 5, st: 0x86, pal: 0x85, mask: 15, name: 'Stage 3 - cemetery' },
    { scene: 7, st: 0x87, pal: 0x86, mask: 15, name: 'Stage 4 - part 1' },
    { scene: 8, st: 0x88, pal: 0x87, mask: 14, name: 'Stage 4 - part 2' },
    { scene: 9, st: 0x89, pal: 0x88, mask: 15, name: 'Stage 5 - gorge' },
    { scene: 10, st: 0x8a, pal: 0x8b, mask: 15, name: 'Stage 6 - dream' },
    { scene: 12, st: 0x8b, pal: 0x82, mask: 15, name: 'Bonus round 2' },
    { scene: 13, st: 0x8c, pal: 0x8d, mask: 15, name: 'Stage 7 - TV studio' },
    { scene: 14, st: 0x8d, pal: 0x8e, mask: 14, name: 'Stage 8 - power plant' },
    { scene: 16, st: 0x8e, pal: 0x90, mask: 15, name: 'Ending' },
  ];
  const LAYER_NAMES = ['Back', 'Front'];
  // K053251 colour bases for the two scrolling layers (registers 9/10 are the same in every scene that was checked)
  const PAL_BASE = [0x40, 0x50];
  const BLOCK_BYTES = 18, SCREEN_W = 8, CELL = 32;

  function open(prog) {
    if (!(prog instanceof Uint8Array) || prog.length !== 0x80000) throw new Error('prog.bin must be 0x80000 bytes');
    const fx = a => prog[FIX(a)], fw = a => (fx(a) << 8) | fx(a + 1);
    const boff = (bank, a) => bank * 0x2000 + a - 0x6000;
    const bw = (bank, a) => (prog[boff(bank, a)] << 8) | prog[boff(bank, a) + 1];
    const okPtr = (bank, a) => bank < 0x3c && a >= 0x6000 && a < 0x8000;
    const mapTabs = LAYER_DESC.map(d => fw(d + 0x10));
    const ent = a => ({ ptr: fw(a), bank: fx(a + 2) });

    function readMap(e) {
      if (!okPtr(e.bank, e.ptr)) return null;
      const first = bw(e.bank, e.ptr), n = (first - e.ptr) >> 1;
      if (first <= e.ptr || first >= 0x8000 || (first - e.ptr) & 1 || n < 1 || n > 64) return null;
      const scr = []; for (let i = 0; i < n; i++) { const s = bw(e.bank, e.ptr + 2 * i); if (s < first || s >= 0x8000) return null; scr.push(s); }
      // screens are packed one after another, so the smallest gap between them gives the row count (8 rows = 0x80)
      const sorted = [...new Set(scr)].sort((a, b) => a - b); let gap = Infinity;
      for (let i = 1; i < sorted.length; i++) gap = Math.min(gap, sorted[i] - sorted[i - 1]);
      if (!isFinite(gap) || gap < 16) gap = 0x80;
      const rows = Math.max(1, Math.min(64, gap >> 4));
      if (sorted[sorted.length - 1] + rows * 16 > 0x8000) return null;
      return { bank: e.bank, ptr: e.ptr, screens: scr.map(s => boff(e.bank, s)), rows };
    }
    // number of sections: distance to the next different list in the back-layer table (lists overlap)
    function sectionCount(st) {
      const lst = fw(mapTabs[0] + 2 * (st & 0x7f)), first = fw(mapTabs[0]);
      let next = Infinity; for (let a = mapTabs[0]; a < first; a += 2) { const v = fw(a); if (v > lst && v < next) next = v; }
      let n = isFinite(next) ? (next - lst) >> 2 : 8; n = Math.max(1, Math.min(8, n));
      let ok = 0; for (let i = 0; i < n; i++) { if (!readMap(ent(lst + 4 * i))) break; ok++; }
      return Math.max(1, ok);
    }
    function section(st, area) {
      const s = st & 0x7f, layers = [];
      for (let l = 0; l < 2; l++) {
        const map = readMap(ent(fw(mapTabs[l] + 2 * s) + 4 * area));
        const me = ent(fw(META_ALT[l] + 2 * s) + 4 * area);
        layers.push(map && okPtr(me.bank, me.ptr) ? { layer: l, name: LAYER_NAMES[l], map, meta: { bank: me.bank, ptr: me.ptr, rom: boff(me.bank, me.ptr) } } : null);
      }
      const cp = fw(CRB_ALT + 2 * s) + 2 * area, r1 = fx(cp), r2 = fx(cp + 1);
      return { st, area, layers, crb: [r1 & 15, r1 >> 4, r2 & 15, r2 >> 4] };
    }
    const cellOff = (L, x, y) => { const scr = L.map.screens[x >> 3]; return scr === undefined || y < 0 || y >= L.map.rows ? -1 : scr + y * 16 + (x & 7) * 2; };
    const getWord = off => (prog[off] << 8) | prog[off + 1];
    function setBlock(L, x, y, block) { // keeps the top 6 bits of the map word
      const off = cellOff(L, x, y); if (off < 0) return null;
      const w = (getWord(off) & 0xfc00) | (block & 0x3ff); prog[off] = w >> 8; prog[off + 1] = w & 0xff; return off;
    }
    function block(L, idx) {
      const o = L.meta.rom + idx * BLOCK_BYTES; if (o + BLOCK_BYTES > prog.length) return null;
      return { attr: prog[o], extra: prog[o + 1], codes: prog.subarray(o + 2, o + 18) };
    }
    function palette(sc) { // palette RAM (0x1000 bytes) after the scene's list; stage 1's list first as a base
      const ram = new Uint8Array(0x1000);
      const load = (id, mask) => {
        const y = id & 0x80 ? fw(PAL_ALT + 2 * (id & 0x7f)) : fw(PAL_STD + 2 * id);
        for (let i = 0; i < 4; i++) {
          if (!(mask & (1 << i))) continue;
          const e = y + 5 * i, src = boff(0x2d, fw(e)), dst = fw(e + 2), n = fx(e + 4) * 32;
          if (dst + n <= 0x1000 && src + n <= prog.length) ram.set(prog.subarray(src, src + n), dst);
        }
      };
      load(0x81, 15); if (sc.pal !== 0x81) load(sc.pal, sc.mask);
      return ram;
    }
    return { prog, sectionCount, section, cellOff, getWord, setBlock, block, palette };
  }
  // tile pixel lookup helpers shared by the editor and tests (same rules as web/sim/video.js tilePix, addrmap = 0)
  function tileNumber(attr, code0, crb) {
    const bank = crb[(attr & 0x0c) >> 2], color = (attr & 0xf3) | ((bank & 3) << 2);
    return (code0 | ((color & 0x3f) << 8) | ((bank >> 2) << 14)) & 0x7fff;
  }
  function decodeTiles(chr) { // 64 bytes per 8x8 tile, one pen per byte (same as web/sim/video.js decodeTiles)
    const n = chr.length >> 5, out = new Uint8Array(n * 64);
    for (let t = 0; t < n; t++) for (let r = 0; r < 8; r++) {
      const o = t * 32 + r * 4, b0 = chr[o], b1 = chr[o + 1], b2 = chr[o + 2], b3 = chr[o + 3];
      for (let x = 0; x < 8; x++) { const s = 7 - x; out[(t << 6) | (r << 3) | x] = (((b3 >> s) & 1) << 3) | (((b2 >> s) & 1) << 2) | (((b1 >> s) & 1) << 1) | ((b0 >> s) & 1); }
    }
    return out;
  }
  function rgb(ram, pen) { const w = (ram[2 * pen] << 8) | ram[2 * pen + 1], c5 = v => (v << 3) | (v >> 2); return [c5(w & 31), c5((w >> 5) & 31), c5((w >> 10) & 31)]; }
  // Draw one block (32x32) into an RGBA buffer; pen 0 stays transparent.
  function drawBlock(out, stride, ox, oy, blk, layer, crb, tiles, ram) {
    const pb = PAL_BASE[layer] + ((blk.attr & 0xc0) >> 6);
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const t = tileNumber(blk.attr, blk.codes[ty * 4 + tx], crb) << 6;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const pix = tiles[t | (py << 3) | px]; if (!pix) continue;
        const [r, g, b] = rgb(ram, (pb << 4) | pix), i = ((oy + ty * 8 + py) * stride + ox + tx * 8 + px) * 4;
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
      }
    }
  }
  // Patches: { "<rom offset>": byte } for the bytes that differ from the original prog.bin.
  const PATCH_KEY = 'simpsons.stagepatch.v1';
  function diff(orig, cur) { const o = {}; for (let i = 0; i < cur.length; i++) if (cur[i] !== orig[i]) o[i] = cur[i]; return o; }
  function applyPatch(prog, bytes) {
    const p = prog.slice(); let n = 0;
    if (!bytes || typeof bytes !== 'object' || Array.isArray(bytes)) return { prog: p, n };
    for (const [k, v] of Object.entries(bytes)) {
      const i = +k;
      if (String(i) === k && Number.isInteger(i) && i >= 0 && i < p.length && Number.isInteger(v) && v >= 0 && v < 256) { p[i] = v; n++; }
    }
    return { prog: p, n };
  }
  const api = { open, SCENES, LAYER_NAMES, PAL_BASE, BLOCK_BYTES, SCREEN_W, CELL, tileNumber, decodeTiles, rgb, drawBlock, diff, applyPatch, PATCH_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else G.SIMPSTAGE = api;
})(typeof window !== 'undefined' ? window : globalThis);
