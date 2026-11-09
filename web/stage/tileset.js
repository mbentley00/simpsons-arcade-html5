// Custom background tilesets (web/custom/tileset_*.js): new 32x32 background art drawn over a stage slot.
//
// The original game still loads and scrolls the stage. A custom level repaints that stage's maps (ordinary ROM map
// edits, like the editor's) so that every cell uses a "carrier" block: an original block whose 16 tile codes are
// unique in its block table. When the game draws a carrier into tile RAM, the renderer recognises the carrier by its
// tile codes and draws the matching custom block instead, with its own private palette. Collision, scrolling,
// enemies and timing are the original stage's. Runs in Node (tests) and in the page (window.SIMPTILES).
'use strict';
(function (G) {
  const BASE = 0x2000, SHADE = 0x2100, CELL = 32, SH = 0.6;
  const sets = () => G.SIMPTILESETS || {};
  const S = () => G.SIMPSTAGE || (typeof require === 'function' ? require('./stagedata.js') : null);
  const b64 = s => typeof atob === 'function' ? Uint8Array.from(atob(s), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64'));
  async function inflate(bytes) {
    if (typeof DecompressionStream === 'function') return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    return new Uint8Array(require('zlib').inflateSync(bytes));
  }
  // Decode every registered tileset once; blocks become Uint8Array(count * 1024) of palette indices (0 = clear).
  const ready = (async () => {
    for (const set of Object.values(sets())) if (!set.decoded) {
      for (const L of set.layers) { L.blocks = await inflate(b64(L.z)); if (L.blocks.length !== L.count * CELL * CELL) throw new Error('bad tileset ' + set.id); }
      set.decoded = true;
    }
  })();
  ready.catch(e => console.error(e));
  const codeKey = c => Array.prototype.join.call(c, ',');
  // Carrier block numbers for each custom block, per layer, from the ORIGINAL program ROM (block tables are not edited).
  function carriers(prog, set) {
    const D = S().open(prog), sec = D.section(set.st, set.area);
    return sec.layers.map((L, l) => {
      const need = set.layers[l].count, seen = new Map(), out = [];
      for (let i = 0; i < 1024; i++) { const b = D.block(L, i); if (!b) break; const k = codeKey(b.codes); seen.set(k, (seen.get(k) || 0) + 1); }
      for (let i = 0; i < 1024 && out.length < need; i++) { const b = D.block(L, i); if (b && seen.get(codeKey(b.codes)) === 1) out.push(i); }
      if (out.length < need) throw new Error(`${set.name}: only ${out.length} carrier blocks for ${need} custom blocks`);
      return out;
    });
  }
  // The level's map edits: returns { offset: byte } like SIMPSTAGE.diff, for every map word that changes.
  function layoutPatch(orig, set) {
    const work = orig.slice(), D = S().open(work), sec = D.section(set.st, set.area), car = carriers(orig, set);
    sec.layers.forEach((L, l) => {
      const cols = Math.min(set.cols, L.map.screens.length * 8), rows = Math.min(set.rows, L.map.rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) D.setBlock(L, x, y, car[l][set.layers[l].map[y * set.cols + x]]);
    });
    return S().diff(orig, work);
  }
  // Offsets of every map word in the slot this set replaces (used to undo the level).
  function slotOffsets(prog, set) {
    const D = S().open(prog), sec = D.section(set.st, set.area), out = [];
    for (const L of sec.layers) if (L) for (const s of L.map.screens) for (let i = 0; i < L.map.rows * 8; i++) out.push(s + 2 * i, s + 2 * i + 1);
    return out;
  }
  function rgb(set, i) { const p = set.palette; return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]; }
  // Game hook: draw custom blocks wherever the stage's carriers are in tile RAM.
  function install(board, video, set) {
    if (!set.decoded) throw new Error('tileset not decoded yet: await SIMPTILES.ready');
    const car = carriers(board.prog, set);
    const keys = car.map((list, l) => { const D = S().open(board.prog), L = D.section(set.st, set.area).layers[l], m = new Map(); list.forEach((blk, id) => m.set(codeKey(D.block(L, blk).codes), id)); return m; });
    const cells = [null, new Int16Array(128), new Int16Array(128)], codes = new Uint8Array(16);
    const n = set.palette.length / 3;
    const fill = () => {
      if (video.pens.length < SHADE + 256) { const p = new Uint32Array(SHADE + 256); p.set(video.pens.subarray(0, Math.min(video.pens.length, BASE))); video.pens = p; }
      for (let i = 1; i < n; i++) { const [r, g, b] = rgb(set, i); video.pens[BASE + i] = (r << 16) | (g << 8) | b; video.pens[SHADE + i] = (Math.trunc(r * SH) << 16) | (Math.trunc(g * SH) << 8) | Math.trunc(b * SH); }
    };
    fill();
    const buildPens = video.buildPens;
    video.buildPens = function () { buildPens.call(this); if (this.pens.length < SHADE + 256) fill(); };
    let active = false;
    const scan = () => {
      const r = board.ram; active = (r[0x875] & 0x7f) === (set.st & 0x7f) && r[0x876] === set.area;
      if (!active) return;
      const v = board.vram;
      for (let vl = 1; vl <= 2; vl++) {
        const o = vl * 0x800, out = cells[vl], m = keys[vl - 1];
        for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 16; cx++) {
          for (let t = 0; t < 16; t++) codes[t] = v[0x2000 + o + ((((cy << 2) + (t >> 2)) & 31) << 6) + (((cx << 2) + (t & 3)) & 63)];
          const id = m.get(codeKey(codes)); out[(cy << 4) | cx] = id === undefined ? -1 : id;
        }
      }
    };
    const render = video.render;
    video.render = function () { scan(); return render.call(this); };
    const tilePix = video.tilePix;
    const blocks = [null, set.layers[0].blocks, set.layers[1].blocks];
    video.tilePix = function (layer, cb, tx, ty) {
      if (active && layer) {
        const id = cells[layer][((ty >> 5) << 4) | (tx >> 5)];
        if (id >= 0) { const p = blocks[layer][(id << 10) | ((ty & 31) << 5) | (tx & 31)]; return p ? BASE + p : -1; }
      }
      return tilePix.call(this, layer, cb, tx, ty);
    };
    return { get active() { return active; }, cells, carriers: car };
  }
  // Editor helper: 32x32 RGBA image of custom block `id` on layer `l` (pen 0 transparent).
  function drawBlock(out, stride, ox, oy, set, l, id) {
    const bl = set.layers[l].blocks, base = id << 10;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const p = bl[base + (y << 5) + x]; if (!p) continue;
      const i = ((oy + y) * stride + ox + x) * 4; out[i] = set.palette[3 * p]; out[i + 1] = set.palette[3 * p + 1]; out[i + 2] = set.palette[3 * p + 2]; out[i + 3] = 255;
    }
  }
  function forScene(scene) { return Object.values(sets()).find(s => s.scene === scene) || null; }
  function validate(doc) { // { "<scene>": "<tileset id>" }
    const out = {};
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return out;
    for (const [k, id] of Object.entries(doc)) { const set = sets()[id]; if (set && String(set.scene) === k) out[k] = id; }
    return out;
  }
  const api = { ready, carriers, layoutPatch, slotOffsets, install, drawBlock, forScene, validate, get sets() { return sets(); }, BASE, SHADE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else G.SIMPTILES = api;
})(typeof window !== 'undefined' ? window : globalThis);
