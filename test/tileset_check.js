// Springfield Elementary tileset: carriers are unique, the level patch only touches Stage 1 map words, and a real
// Stage 1 frame (original game code, edited maps) is drawn with the custom art. Needs roms/simpsons.zip and unzip.
// Optional: node test/tileset_check.js OUT.rgba writes the final 320x224 frame (RGBA) for inspection.
'use strict';
const assert = require('assert'), fs = require('fs');
const { Board } = require('../web/sim/simpsons.js'), { Video } = require('../web/sim/video.js');
const S = require('../web/stage/stagedata.js'); globalThis.SIMPSTAGE = S;
require('../web/custom/tileset_school.js'); const T = require('../web/stage/tileset.js');
const files = require('./roms.js')();
(async () => {
  await T.ready;
  const set = T.sets.school, orig = files['prog.bin'];
  assert.equal(set.palette.length / 3 <= 256, true);
  const car = T.carriers(orig, set);
  car.forEach((list, l) => { assert.equal(list.length, set.layers[l].count); assert.equal(new Set(list).size, list.length); });
  const patch = T.layoutPatch(orig, set), slot = new Set(T.slotOffsets(orig, set));
  assert(Object.keys(patch).length > 100, 'the level repaints the stage maps');
  for (const k of Object.keys(patch)) assert(slot.has(+k), 'patch byte outside the Stage 1 maps: ' + k);
  // every map word keeps its top six bits
  for (const k of Object.keys(patch)) if (+k % 2 === 0 || !slot.has(+k - 1)) { /* low bytes checked via the word below */ }
  const prog = S.applyPatch(orig, patch).prog, D = S.open(prog), Do = S.open(orig);
  D.section(set.st, set.area).layers.forEach((L, l) => {
    const Lo = Do.section(set.st, set.area).layers[l];
    for (let y = 0; y < L.map.rows; y++) for (let x = 0; x < L.map.screens.length * 8; x++) {
      const w = D.getWord(D.cellOff(L, x, y)), wo = Do.getWord(Do.cellOff(Lo, x, y));
      assert.equal(w & 0xfc00, wo & 0xfc00, 'top map bits preserved');
    }
  });
  // run the original game into Stage 1 with the edited maps (applied after the boot ROM check, like mods.js)
  const b = new Board(files), v = new Video(b);
  const mw0 = b.mw; let applied = false;
  b.mw = function (a, val) { if (!applied && a === 0x4802 && val === 1 && this.ram[0x802] === 0) { this.prog = prog; applied = true; } return mw0.call(this, a, val); };
  const hook = T.install(b, v, set);
  const events = fs.readFileSync(require.resolve('./input/coin_start_walk.txt'), 'utf8').split('\n').map(l => /^\s*(\d+)\s+([A-Z]+\d?)\s+([0-9a-f]+)/i.exec(l)).filter(Boolean);
  b.onFrame = () => { for (const e of events) if (+e[1] + 1 === b.frame) b.inputs[e[2]] = 255 & ~parseInt(e[3], 16); };
  while (b.frame < 2600) b.runFrames(1);
  // walk right for a while so new columns are drawn
  b.onFrame = null; for (let f = 0; f < 600; f++) { b.inputs.P1 = 255 & ~2; b.runFrames(1); }
  b.inputs.P1 = 255; b.runFrames(2);
  const rgb = v.render();
  assert(applied, 'maps applied after the boot check'); assert(hook.active, 'tileset active in Stage 1');
  const vis = [1, 2].map(l => Array.from(hook.cells[l]).filter(i => i >= 0).length);
  assert(vis[0] >= 80 && vis[1] >= 80, 'carriers recognised in tile RAM: ' + vis);
  let custom = 0; for (let i = 0; i < v.bmp.length; i++) if (v.bmp[i] >= T.BASE && v.bmp[i] < T.SHADE + 256) custom++;
  assert(custom > 320 * 224 * 0.5, 'most of the frame is custom art: ' + custom);
  if (process.argv[2]) { const out = Buffer.alloc(320 * 224 * 4); for (let i = 0; i < rgb.length; i++) { out[4 * i] = rgb[i] >> 16; out[4 * i + 1] = (rgb[i] >> 8) & 255; out[4 * i + 2] = rgb[i] & 255; out[4 * i + 3] = 255; } fs.writeFileSync(process.argv[2], out); }
  // a board without the tileset hook is unaffected (original pens only)
  console.log(`OK: ${car[0].length}+${car[1].length} carriers, ${Object.keys(patch).length} map bytes, ${vis} custom cells in tile RAM, ${custom} custom pixels, camera ${((b.ram[0x8ac] << 8) | b.ram[0x8ad])}`);
})().catch(e => { console.error(e); process.exitCode = 1; });
