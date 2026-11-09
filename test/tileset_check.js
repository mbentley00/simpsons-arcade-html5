// Custom level art (Springfield Elementary in Stage 1, Bowling Alley in Stage 2): the original stage runs unchanged
// (same ROM maps, so the same collision) while the two scrolling layers are drawn from the custom maps by world
// position. The player must be able to walk the stage, and the picture must follow the camera.
// Needs roms/simpsons.zip and unzip. Optional: node test/tileset_check.js OUTDIR writes <id>.rgba (320x224 RGBA) frames.
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const { Board } = require('../web/sim/simpsons.js'), { Video } = require('../web/sim/video.js');
const S = require('../web/stage/stagedata.js'); globalThis.SIMPSTAGE = S;
require('../web/custom/tileset_school.js'); require('../web/custom/tileset_bowling.js'); require('../web/custom/tileset_android.js');
const T = require('../web/stage/tileset.js');
const files = require('./roms.js')();
const word = (b, o) => ((b.ram[o] << 8) | b.ram[o + 1]) << 16 >> 16;
(async () => {
  await T.ready;
  // saved-format validation and migration of the old "carrier" format (which repainted the ROM maps)
  const school = T.sets.school, bowling = T.sets.bowling, android = T.sets.android;
  const v = T.validate({ 2: { id: 'school', maps: T.defaults(school) }, 4: 'bowling', 9: 'school', 2.5: 'x' });
  assert.deepEqual(Object.keys(v), ['2', '4']); assert.equal(v[2].maps[1].length, 448); assert.equal(v[4].maps[0].length, 72 * 8);
  assert.equal(T.validate({ 2: { id: 'school', maps: [[1], [2]] } })[2].maps[0].length, 448, 'bad maps fall back to the default layout');
  assert.equal(T.forScene(2), school); assert.deepEqual(T.forSceneAll(2), [school, android]); assert.equal(T.forScene(4), bowling); assert.equal(T.forScene(5), null);
  const D = S.open(files['prog.bin']), L0 = D.section(0x82, 0).layers[0], legacyOff = L0.map.screens[0] + 3;
  const legacy = T.migrate({ bytes: { [legacyOff]: 7, 12: 34 }, tilesets: { 2: 'school' } }, files['prog.bin']);
  assert.deepEqual(legacy.bytes, { 12: 34 }, 'legacy Stage 1 map bytes are dropped'); assert.deepEqual(legacy.tilesets, { 2: { id: 'school' } });
  // each set's slot must match its stage's main section size
  for (const set of [school, bowling, android]) {
    assert(set.palette.length / 3 <= 256);
    for (const L of D.section(set.st, set.area).layers) { assert.equal(L.map.screens.length * 8, set.cols, set.id + ' columns'); assert.equal(L.map.rows, set.rows); }
  }
  const seed = new Board(files); seed.audio = true;
  while (seed.frame < 1040) { seed.inputs.COIN = seed.frame % 60 < 8 ? 0xfe : 0xff; seed.inputs.P1 = seed.ram[0x800] === 2 && seed.ram[0x803] === 1 ? (seed.frame % 16 < 8 ? 0x6f : 0xff) : (seed.frame % 30 < 8 ? 0x7f : 0xff); seed.runFrames(1); seed.drainAudio(); }
  const checkpoint = seed.save();
  for (const set of [school, bowling, android]) {
    const b = new Board(files); b.audio = true; b.load(checkpoint);
    const element = () => ({ style: {}, setAttribute() {}, append() {}, appendChild() {}, remove() {} });
    const g = { SIMPSTAGE: S, URLSearchParams, location: { search: `?scene=${set.scene}&play=1` }, localStorage: { getItem() { return null; } }, document: { createElement: element, body: { appendChild() {} } }, setTimeout: fn => { fn(); } };
    g.window = g; vm.runInNewContext(fs.readFileSync(require.resolve('../web/stage/mods.js'), 'utf8'), g); vm.runInNewContext(fs.readFileSync(require.resolve('../web/stage/launch.js'), 'utf8'), g);
    g.SIMPMODS.apply(files); g.SIMPMODS.install(b); await g.SIMPLAUNCH.prepare(b);
    const maps = T.defaults(set), vid = new Video(b), hook = T.install(b, vid, set, maps), progBefore = b.prog.slice(), hp = b.ram[0xa5b];
    for (let f = 0; f < 2400; f++) { b.inputs.P1 = 255 & ~(f % 12 < 4 ? 0x12 : 0x02); if (b.ram[0xa5b] < hp) b.ram[0xa5b] = hp; b.runFrames(1); b.drainAudio(); }
    b.inputs.P1 = 255; b.runFrames(2);
    assert.deepEqual(b.prog, progBefore, 'the ROM is not modified');
    const cam = word(b, 0x8ac); assert(cam > 300, `${set.id}: the player walks the stage (camera ${cam})`);
    const rgb = vid.render();
    if (process.argv[2]) { const out = Buffer.alloc(320 * 224 * 4); for (let i = 0; i < rgb.length; i++) { out[4 * i] = rgb[i] >> 16; out[4 * i + 1] = (rgb[i] >> 8) & 255; out[4 * i + 2] = rgb[i] & 255; out[4 * i + 3] = 255; } fs.mkdirSync(process.argv[2], { recursive: true }); fs.writeFileSync(`${process.argv[2]}/${set.id}.rgba`, out); }
    assert(hook.active, set.id + ' active'); assert.equal(hook.left[1], cam); assert.equal(hook.left[2], cam);
    let custom = 0; for (let i = 16 * 320; i < 240 * 320; i++) if (vid.bmp[i] >= T.BASE && vid.bmp[i] < T.SHADE + 256) custom++;
    assert(custom > 320 * 224 * 0.6, `${set.id}: most of the frame is custom art (${custom})`);
    // sampled screen pixels (not sprites, not the fixed HUD/prop layer) show the custom map at world x = camera + screen x
    const ys = b.vram[0x1800 | 12];
    let ok = 0, tot = 0;
    for (let y = 40; y < 224; y += 7) for (let x = 0; x < 320; x += 5) {
      const wx = cam + x, wy = (y + 16 + ys) & 255, i = (y + 16) * 320 + x;
      const pens = [0, 1].map(l => set.layers[l].blocks[(maps[l][(wy >> 5) * set.cols + (wx >> 5)] << 10) | ((wy & 31) << 5) | (wx & 31)]).filter(Boolean).map(q => T.BASE + q);
      if (!pens.length || vid.pri[i] === 31 || vid.tilePix(0, [0, 0, 0], x + 96, y + 16) >= 0) continue;
      tot++; if (pens.includes(vid.bmp[i]) || pens.includes(vid.bmp[i] - 0x100)) ok++;
    }
    assert(tot > 500 && ok > tot * 0.97, `${set.id}: custom art follows the camera (${ok}/${tot})`);
    console.log(`ok ${set.name}: original stage collision, camera scrolled to ${cam}, ${custom} custom pixels`);
  }
  console.log('OK: all custom levels; legacy edits migrated');
})().catch(e => { console.error(e); process.exitCode = 1; });
