// Springfield Elementary tileset: the original Stage 1 runs unchanged (same ROM maps, so the same collision) while
// the two scrolling layers are drawn from the custom maps by world position. The player must be able to walk the
// stage, and the picture must follow the camera. Needs roms/simpsons.zip and unzip.
// Optional: node test/tileset_check.js OUT.rgba writes the final 320x224 frame (RGBA) for inspection.
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const { Board } = require('../web/sim/simpsons.js'), { Video } = require('../web/sim/video.js');
const S = require('../web/stage/stagedata.js'); globalThis.SIMPSTAGE = S;
require('../web/custom/tileset_school.js'); const T = require('../web/stage/tileset.js');
const files = require('./roms.js')();
(async () => {
  await T.ready;
  const set = T.sets.school;
  assert(set.palette.length / 3 <= 256 && set.cols === 56 && set.rows === 8);
  // saved-format validation and migration of the old "carrier" format (which repainted the ROM maps)
  const v = T.validate({ 2: { id: 'school', maps: T.defaults(set) }, 4: 'school', 2.5: 'x' });
  assert.deepEqual(Object.keys(v), ['2']); assert.equal(v[2].maps[1].length, 448);
  assert.equal(T.validate({ 2: { id: 'school', maps: [[1], [2]] } })[2].maps[0].length, 448, 'bad maps fall back to the default layout');
  const D = S.open(files['prog.bin']), L0 = D.section(0x82, 0).layers[0], legacyOff = L0.map.screens[0] + 3;
  const legacy = T.migrate({ bytes: { [legacyOff]: 7, 12: 34 }, tilesets: { 2: 'school' } }, files['prog.bin']);
  assert.deepEqual(legacy.bytes, { 12: 34 }, 'legacy Stage 1 map bytes are dropped'); assert.deepEqual(legacy.tilesets, { 2: { id: 'school' } });
  // play the original Stage 1 from a fresh launch with the tileset hook installed
  const seed = new Board(files); seed.audio = true;
  while (seed.frame < 1040) { seed.inputs.COIN = seed.frame % 60 < 8 ? 0xfe : 0xff; seed.inputs.P1 = seed.ram[0x800] === 2 && seed.ram[0x803] === 1 ? (seed.frame % 16 < 8 ? 0x6f : 0xff) : (seed.frame % 30 < 8 ? 0x7f : 0xff); seed.runFrames(1); seed.drainAudio(); }
  const b = new Board(files); b.audio = true; b.load(seed.save());
  const element = () => ({ style: {}, setAttribute() {}, append() {}, appendChild() {}, remove() {} });
  const g = { SIMPSTAGE: S, URLSearchParams, location: { search: '?scene=2&play=1' }, localStorage: { getItem() { return null; } }, document: { createElement: element, body: { appendChild() {} } }, setTimeout: fn => { fn(); } };
  g.window = g; vm.runInNewContext(fs.readFileSync(require.resolve('../web/stage/mods.js'), 'utf8'), g); vm.runInNewContext(fs.readFileSync(require.resolve('../web/stage/launch.js'), 'utf8'), g);
  g.SIMPMODS.apply(files); g.SIMPMODS.install(b); await g.SIMPLAUNCH.prepare(b);
  const vid = new Video(b), hook = T.install(b, vid, set, v[2].maps);
  const progBefore = b.prog.slice();
  const hp = b.ram[0xa5b], word = o => ((b.ram[o] << 8) | b.ram[o + 1]) << 16 >> 16, startX = word(0xa4c);
  for (let f = 0; f < 2400; f++) { b.inputs.P1 = 255 & ~(f % 12 < 4 ? 0x12 : 0x02); if (b.ram[0xa5b] < hp) b.ram[0xa5b] = hp; b.runFrames(1); b.drainAudio(); }
  b.inputs.P1 = 255; b.runFrames(2);
  assert.deepEqual(b.prog, progBefore, 'the ROM is not modified');
  const cam = word(0x8ac); assert(cam > 300, `the player walks the stage (camera ${cam})`);
  const rgb = vid.render();
  if (process.argv[2]) { const out = Buffer.alloc(320 * 224 * 4); for (let i = 0; i < rgb.length; i++) { out[4 * i] = rgb[i] >> 16; out[4 * i + 1] = (rgb[i] >> 8) & 255; out[4 * i + 2] = rgb[i] & 255; out[4 * i + 3] = 255; } fs.writeFileSync(process.argv[2], out); }
  assert(hook.active, 'tileset active in Stage 1'); assert.equal(hook.left[1], cam); assert.equal(hook.left[2], cam);
  let custom = 0; for (let i = 16 * 320; i < 240 * 320; i++) if (vid.bmp[i] >= T.BASE && vid.bmp[i] < T.SHADE + 256) custom++;
  assert(custom > 320 * 224 * 0.6, 'most of the frame is custom art: ' + custom);
  // sampled screen pixels (not sprites, not the fixed HUD/prop layer) show the custom map at world x = camera + screen x
  { let ok = 0, tot = 0; for (let y = 40; y < 224; y += 7) for (let x = 0; x < 320; x += 5) { const wx = cam + x, wy = y + 16, pens = [0, 1].map(l => set.layers[l].blocks[(v[2].maps[l][(wy >> 5) * 56 + (wx >> 5)] << 10) | ((wy & 31) << 5) | (wx & 31)]).filter(Boolean).map(q => T.BASE + q); if (!pens.length || vid.pri[(y + 16) * 320 + x] === 31 || vid.tilePix(0, [0, 0, 0], x + 96, y + 16) >= 0) continue; tot++; const got = vid.bmp[(y + 16) * 320 + x]; if (pens.includes(got) || pens.includes(got - 0x100)) ok++; } assert(ok > tot * 0.97, `custom art follows the camera (${ok}/${tot})`); }
  console.log(`OK: original Stage 1 collision, camera scrolled to ${cam}, ${custom} custom pixels, legacy edits migrated`);
})().catch(e => { console.error(e); process.exitCode = 1; });
