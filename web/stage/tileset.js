// Custom background tilesets (web/custom/tileset_*.js): new 32x32 background art drawn over a stage slot.
//
// The original stage is left completely unchanged: its ROM maps still decide collision and walkable ground, its
// scripts, enemies and scrolling run as normal. Only the picture changes. While the stage is loaded, every pixel of
// the two scrolling layers is taken from a custom block map indexed by WORLD position instead of from tile RAM. The
// world position comes from the layer's scroll register, which in Stage 1 is always camera + 422 (mod 512); the
// camera word at RAM 0x8ac resolves the 512-pixel wrap (and tolerates the +-3 px screen shake).
// Runs in Node (tests) and in the page (window.SIMPTILES).
'use strict';
(function (G) {
  const BASE = 0x2000, SHADE = 0x2100, CELL = 32, SH = 0.6, SCROLL_OFS = 422;
  const sets = () => G.SIMPTILESETS || {};
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

  // Saved form: tilesets = { "<scene>": { id, maps: [[back ids], [front ids]] } } (row-major, cols x rows of the set).
  const defaults = set => set.layers.map(L => L.map.slice());
  function validate(doc) {
    const out = {};
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return out;
    for (const [k, v] of Object.entries(doc)) {
      const id = typeof v === 'string' ? v : v && v.id, set = sets()[id];
      if (!set || String(set.scene) !== k) continue;
      let maps = v && Array.isArray(v.maps) ? v.maps : null;
      const ok = maps && maps.length === 2 && maps.every((m, l) => Array.isArray(m) && m.length === set.cols * set.rows && m.every(x => Number.isInteger(x) && x >= 0 && x < set.layers[l].count));
      out[k] = { id, maps: ok ? maps.map(m => m.slice()) : defaults(set) };
    }
    return out;
  }
  // Earlier builds repainted the stage's ROM maps ("carrier" blocks) and stored the id as a plain string. That broke
  // the stage's collision, so those map bytes are dropped from the saved edits.
  function migrate(doc, prog) {
    if (!doc || !doc.tilesets || !doc.bytes || !G.SIMPSTAGE && typeof require !== 'function') return doc;
    const S = G.SIMPSTAGE || require('./stagedata.js');
    for (const [k, v] of Object.entries(doc.tilesets)) {
      const set = sets()[v]; if (typeof v !== 'string' || !set) continue;
      const D = S.open(prog), sec = D.section(set.st, set.area);
      for (const L of sec.layers) if (L) for (const s of L.map.screens) for (let i = 0; i < L.map.rows * 16; i++) delete doc.bytes[s + i];
      doc.tilesets[k] = { id: v };
    }
    return doc;
  }
  function rgb(set, i) { const p = set.palette; return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]; }

  // Game hook: replace the two scrolling layers with the custom maps while the set's stage/section is loaded.
  function install(board, video, set, maps) {
    if (!set.decoded) throw new Error('tileset not decoded yet: await SIMPTILES.ready');
    maps = (maps || defaults(set)).map(m => Int16Array.from(m));
    const n = set.palette.length / 3, width = set.cols * CELL, height = set.rows * CELL;
    const fill = () => {
      if (video.pens.length < SHADE + 256) { const p = new Uint32Array(SHADE + 256); p.set(video.pens.subarray(0, Math.min(video.pens.length, BASE))); video.pens = p; }
      for (let i = 1; i < n; i++) { const [r, g, b] = rgb(set, i); video.pens[BASE + i] = (r << 16) | (g << 8) | b; video.pens[SHADE + i] = (Math.trunc(r * SH) << 16) | (Math.trunc(g * SH) << 8) | Math.trunc(b * SH); }
    };
    fill();
    const buildPens = video.buildPens;
    video.buildPens = function () { buildPens.call(this); if (this.pens.length < SHADE + 256) fill(); };
    let active = false; const left = [0, 0, 0];
    const scan = () => {
      const r = board.ram; active = (r[0x875] & 0x7f) === (set.st & 0x7f) && r[0x876] === set.area;
      if (!active) return;
      const cam = ((r[0x8ac] << 8) | r[0x8ad]) << 16 >> 16, v = board.vram;
      for (let vl = 1; vl <= 2; vl++) {
        const m = vl === 2 ? 0x2000 : 0, scroll = v[0x1a00 | m] + 256 * v[0x1a01 | m];
        left[vl] = cam + ((((scroll - SCROLL_OFS - cam) % 512) + 512 + 256) % 512) - 256;
      }
    };
    const render = video.render;
    video.render = function () { scan(); return render.call(this); };
    const tilePix = video.tilePix, blocks = [null, set.layers[0].blocks, set.layers[1].blocks];
    video.tilePix = function (layer, cb, tx, ty) {
      if (active && layer) {
        const wx = left[layer] + ((tx - left[layer]) & 511);
        if (wx >= 0 && wx < width && ty < height) {
          const id = maps[layer - 1][(ty >> 5) * set.cols + (wx >> 5)];
          const p = blocks[layer][(id << 10) | ((ty & 31) << 5) | (wx & 31)];
          return p ? BASE + p : -1;
        }
      }
      return tilePix.call(this, layer, cb, tx, ty);
    };
    return { get active() { return active; }, left, maps };
  }
  // Editor helper: 32x32 RGBA image of custom block `id` on layer `l` (pen 0 transparent).
  function drawBlock(out, stride, ox, oy, set, l, id) {
    const bl = set.layers[l].blocks, base = id << 10;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const p = bl[base + (y << 5) + x]; if (!p) continue;
      const i = ((oy + y) * stride + ox + x) * 4; out[i] = set.palette[3 * p]; out[i + 1] = set.palette[3 * p + 1]; out[i + 2] = set.palette[3 * p + 2]; out[i + 3] = 255;
    }
  }
  // several art sets can use the same original stage's ground
  function forSceneAll(scene) { return Object.values(sets()).filter(s => s.scene === scene); }
  function forScene(scene) { return forSceneAll(scene)[0] || null; }
  const api = { ready, install, drawBlock, forScene, forSceneAll, validate, migrate, defaults, get sets() { return sets(); }, BASE, SHADE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else G.SIMPTILES = api;
})(typeof window !== 'undefined' ? window : globalThis);
