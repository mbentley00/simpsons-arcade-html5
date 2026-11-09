// Custom stages (web/stage/stages.js) and their scripted events (web/stage/events.js) on the real board:
//  - old "level art on an original stage" documents migrate to custom stages; validation drops bad data
//  - without ?custom the original stage runs with its own art (no custom art, no events)
//  - ?custom=<id> runs the base stage with the custom art and fires the Bowling Alley events as the camera passes them:
//    the runaway ball knocks down what it reaches through the game's own hit reaction, pins fall, cosmic bowling recolours
//    the custom pens and restores them afterwards.
// Needs roms/simpsons.zip and unzip.
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const { Board } = require('../web/sim/simpsons.js'), { Video } = require('../web/sim/video.js');
const S = require('../web/stage/stagedata.js'); globalThis.SIMPSTAGE = S;
require('../web/custom/tileset_school.js'); require('../web/custom/tileset_bowling.js'); require('../web/custom/tileset_android.js');
const T = require('../web/stage/tileset.js'); globalThis.SIMPTILES = T;
const EV = require('../web/stage/events.js'); globalThis.SIMPEVENTS = EV;
const E = require('../web/stage/enemies.js'); globalThis.SIMPENEMY = E;
const CS = require('../web/stage/stages.js');
const files = require('./roms.js')();
const word = (b, o) => ((b.ram[o] << 8) | b.ram[o + 1]) << 16 >> 16;
(async () => {
  await T.ready;
  // ---- data
  const doc = CS.migrate({ bytes: {}, tilesets: { 4: { id: 'bowling', maps: T.defaults(T.sets.bowling) } } });
  assert(!doc.tilesets, 'old overrides are removed'); const [id] = Object.keys(doc.stages);
  assert.equal(id, 'bowling-alley'); assert.equal(doc.stages[id].scene, 4); assert.equal(doc.stages[id].events.length, 5, 'Bowling Alley comes with its events');
  const v = CS.validate({ ok: { name: 'Lanes', scene: 4, tileset: { id: 'bowling' }, events: [{ type: 'ball', x: 900 }, { type: 'nope', x: 1 }, { type: 'pins', x: -4 }], enemies: 'x' }, 'Bad id': { scene: 4 }, cem: { scene: 9 }, x: { scene: 2, tileset: { id: 'bowling' }, events: [{ type: 'ball', x: 5 }] } });
  assert.deepEqual(Object.keys(v), ['ok', 'cem', 'x']);
  assert.deepEqual(v.ok.events, [{ type: 'ball', x: 900 }]); assert.equal(v.ok.enemies, null); assert.equal(v.ok.tileset.maps[0].length, 72 * 8);
  assert.equal(v.x.tileset, null, 'art must belong to the base stage'); assert.deepEqual(v.x.events, [], 'bowling events need the bowling art');
  assert(CS.templates().some(t => t.art === 'school') && CS.templates().some(t => t.art === 'android' && t.scene === 2) && CS.templates().some(t => t.art === null && t.scene === 2));
  // ---- game: reach stage 2 (the bowling alley's ground) once, then run it as the original and as the custom stage
  const seed = new Board(files); seed.audio = true;
  while (seed.frame < 1040) { seed.inputs.COIN = seed.frame % 60 < 8 ? 0xfe : 0xff; seed.inputs.P1 = seed.ram[0x800] === 2 && seed.ram[0x803] === 1 ? (seed.frame % 16 < 8 ? 0x6f : 0xff) : (seed.frame % 30 < 8 ? 0x7f : 0xff); seed.runFrames(1); seed.drainAudio(); }
  const checkpoint = seed.save();
  const stored = JSON.stringify({ v: 1, bytes: {}, stages: { lanes: { name: 'Lanes', scene: 4, tileset: { id: 'bowling', maps: T.defaults(T.sets.bowling) }, enemies: null, events: [{ type: 'pins', x: 240 }, { type: 'cosmic', x: 270 }, { type: 'ball', x: 320 }] } } });
  async function run(search) {
    const b = new Board(files); b.audio = true; b.load(checkpoint);
    const element = () => ({ style: {}, setAttribute() {}, append() {}, appendChild() {}, remove() {} });
    const g = { SIMPSTAGE: S, SIMPTILES: T, SIMPEVENTS: EV, SIMPENEMY: E, URLSearchParams, location: { search }, localStorage: { getItem: () => stored }, document: { createElement: element, body: { appendChild() {} } }, setTimeout: fn => { fn(); } };
    g.window = g; vm.runInNewContext(fs.readFileSync(require.resolve('../web/stage/stages.js'), 'utf8'), g);
    for (const f of ['mods.js', 'launch.js']) vm.runInNewContext(fs.readFileSync(require.resolve('../web/stage/' + f), 'utf8'), g);
    g.SIMPMODS.apply(files); const vid = new Video(b); g.SIMPMODS.install(b, vid); await g.SIMPLAUNCH.prepare(b);
    return { b, vid, mods: g.SIMPMODS };
  }
  {
    const { b, vid, mods } = await run('?scene=4&play=1');
    assert.equal(mods.custom, null); assert.deepEqual(Object.keys(mods.tilesets), []); assert(!b.stageEvents, 'no events in the original stage');
    for (let f = 0; f < 60; f++) { b.inputs.P1 = 255; b.runFrames(1); }
    vid.render(); let custom = 0; for (let i = 0; i < vid.bmp.length; i++) if (vid.bmp[i] >= T.BASE && vid.bmp[i] < T.SHADE + 256) custom++;
    assert.equal(custom, 0, 'the original amusement park shows its own art');
    console.log('ok without ?custom the amusement park is unchanged');
  }
  {
    const { b, vid, mods } = await run('?custom=lanes&play=1');
    assert.equal(mods.custom.name, 'Lanes'); assert.equal(mods.scene, 4); assert(b.stageEvents, 'events installed');
    const s = b.stageEvents, r = b.ram, hp = r[0xa5b]; let knocked = false, pinsSeen = 0, cosmicPen = -1, enemyDown = false;
    const normal = vid.pens[T.BASE + 1];
    for (let f = 0; f < 1500; f++) {
      b.inputs.P1 = 255 & ~(f % 12 < 4 ? 0x12 : 0x02); if (r[0xa5b] < 10) r[0xa5b] = hp;
      EV.beforeFrame(b);
      const ball = s.live.find(e => e.t === 'ball');
      if (ball && b.frame - ball.at === 44) { // line the first player up with the ball's lane so the knockdown can be checked
        put(r, 0xa40 + 0x11, ball.z);
      }
      if (ball && ball.hit.includes(0xa40)) knocked = true;
      if (ball && ball.hit.some(o => o >= 0xd40)) enemyDown = true;
      const pins = s.live.find(e => e.t === 'pins'); if (pins) pinsSeen = Math.max(pinsSeen, pins.pins.length);
      if (s.live.some(e => e.t === 'cosmic') && b.frame - s.live.find(e => e.t === 'cosmic').at === 60) cosmicPen = vid.pens[T.BASE + 1];
      b.runFrames(1); b.drainAudio();
      if (knocked && s.fired.length === 3 && !s.live.length) break;
    }
    assert.deepEqual(s.fired.sort(), [0, 1, 2], `all events fire as the camera passes them (camera ${word(b, 0x8ac)})`);
    assert(pinsSeen > 0, 'pins fall'); assert(knocked, 'the runaway ball reaches the player on its lane');
    assert(cosmicPen >= 0 && cosmicPen !== normal, 'cosmic bowling recolours the alley'); assert.equal(vid.pens[T.BASE + 1], normal, 'and restores it');
    const px = new Uint32Array(320 * 224); assert.equal(typeof EV.drawOverlay(px), 'boolean');
    console.log(`ok ?custom=lanes plays the Bowling Alley on Stage 2's ground; pins fell (${pinsSeen} at once), the runaway ball knocked the player down${enemyDown ? ' and an enemy' : ''}, cosmic bowling recoloured and restored the lanes`);
  }
  console.log('OK: custom stages leave the originals untouched; Bowling Alley events run');
})().catch(e => { console.error(e); process.exitCode = 1; });
function put(r, o, v) { r[o] = (v >> 8) & 255; r[o + 1] = v & 255; }
