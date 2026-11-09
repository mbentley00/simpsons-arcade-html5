// Events made from a typed description (web/stage/recipes.js):
//  - normalize() clamps every field and drops unknown actions, so any recipe (from Claude or a saved file) is safe
//  - fromText(), the built-in reader, turns common descriptions into the expected building blocks
//  - on the real board, a custom stage WITHOUT level art (a copy of Stage 2) runs described events: falling donuts and a
//    rolling rock hit through the native hit write, a blast hits enemies, heal restores health, night tint darkens the
//    frame and shake moves it.
// Needs roms/simpsons.zip and unzip.
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const { Board } = require('../web/sim/simpsons.js'), { Video } = require('../web/sim/video.js');
const S = require('../web/stage/stagedata.js'); globalThis.SIMPSTAGE = S;
require('../web/custom/tileset_school.js'); require('../web/custom/tileset_bowling.js'); require('../web/custom/tileset_android.js');
const T = require('../web/stage/tileset.js'); globalThis.SIMPTILES = T;
const R = require('../web/stage/recipes.js'); globalThis.SIMPRECIPE = R;
const EV = require('../web/stage/events.js'); globalThis.SIMPEVENTS = EV;
const E = require('../web/stage/enemies.js'); globalThis.SIMPENEMY = E;
const CS = require('../web/stage/stages.js');
const files = require('./roms.js')();
const word = (b, o) => ((b.ram[o] << 8) | b.ram[o + 1]) << 16 >> 16;
const act = (kind, o = {}) => ({ kind, delay: 0, duration: 4, object: 'ball', from: 'right', target: 'everyone', effect: 'flinch', damage: 4, count: 1, speed: 'medium', size: 'medium', tint: 'none', amount: 8, text: '', ...o });
(async () => {
  await T.ready;
  // ---- recipe data
  assert.equal(R.normalize(null), null); assert.equal(R.normalize({ actions: [{ kind: 'eval' }] }), null, 'unknown actions are dropped');
  const n = R.normalize({ name: 'x'.repeat(80), banner: 'boom', color: 'plaid', actions: [act('rain', { damage: 999, count: -3, duration: 500, delay: -2, object: 'piano', text: 'hi' }), ...Array(9).fill(act('shake'))] });
  assert.equal(n.name.length, 32); assert.equal(n.banner, 'BOOM'); assert.equal(n.color, 'gold'); assert.equal(n.actions.length, 6, 'at most 6 actions');
  assert.deepEqual([n.actions[0].damage, n.actions[0].count, n.actions[0].duration, n.actions[0].delay, n.actions[0].object], [20, 1, 30, 0, 'ball']);
  const kinds = t => (R.fromText(t) || { actions: [] }).actions.map(a => a.kind).join(',');
  assert.equal(kinds('Giant donuts rain from the sky for 8 seconds'), 'rain');
  assert.equal(R.fromText('Giant donuts rain from the sky for 8 seconds').actions[0].object, 'donut');
  assert.equal(R.fromText('Giant donuts rain from the sky for 8 seconds').actions[0].duration, 8);
  assert.equal(kinds('A boulder rolls across the screen from the left and knocks everyone down'), 'projectile');
  const boulder = R.fromText('A boulder rolls across the screen from the left and knocks everyone down').actions[0];
  assert.deepEqual([boulder.object, boulder.from, boulder.effect], ['rock', 'left', 'knockdown']);
  assert.equal(kinds('The lights go out'), 'tint'); assert.equal(kinds('An earthquake hits only the enemies'), 'shake,blast');
  assert.equal(R.fromText('An earthquake hits only the enemies').actions[1].target, 'enemies');
  assert.equal(kinds('Free food heals everybody'), 'heal'); assert.equal(R.fromText('hello there'), null);
  assert(R.describe(R.fromText('Duff cans fly in from both sides')).includes('can'));
  assert.deepEqual(Object.keys(R.SCHEMA.properties).sort(), ['actions', 'banner', 'color', 'name', 'summary']);
  // custom events survive validation in a stage without art; built-in bowling events still need the bowling art
  const v = CS.validate({ copy: { name: 'Copy', scene: 4, tileset: null, events: [{ type: 'custom', x: 300, prompt: 'p', recipe: R.fromText('lights out') }, { type: 'custom', x: 10, recipe: { actions: [] } }, { type: 'ball', x: 40 }] } });
  assert.equal(v.copy.events.length, 1); assert.equal(v.copy.events[0].recipe.actions[0].tint, 'night'); assert.equal(EV.nameOf(v.copy.events[0]), 'Lights out');
  console.log('ok recipes are clamped, the built-in reader understands common descriptions, custom events validate without art');

  // ---- game: Stage 2's ground with its original art, events from descriptions
  const seed = new Board(files); seed.audio = true;
  while (seed.frame < 1040) { seed.inputs.COIN = seed.frame % 60 < 8 ? 0xfe : 0xff; seed.inputs.P1 = seed.ram[0x800] === 2 && seed.ram[0x803] === 1 ? (seed.frame % 16 < 8 ? 0x6f : 0xff) : (seed.frame % 30 < 8 ? 0x7f : 0xff); seed.runFrames(1); seed.drainAudio(); }
  const checkpoint = seed.save();
  const rec = (name, actions) => ({ name, banner: name.toUpperCase(), color: 'gold', summary: '', actions });
  const events = [
    { type: 'custom', x: 230, prompt: 'donut storm', recipe: rec('Donut storm', [act('rain', { object: 'donut', count: 6, duration: 4, target: 'players', damage: 3 })]) },
    { type: 'custom', x: 250, prompt: 'rock and night', recipe: rec('Rock', [act('projectile', { object: 'rock', count: 3, duration: 1, target: 'players', effect: 'knockdown', size: 'large' }), act('tint', { tint: 'night', duration: 6 }), act('shake', { duration: 2, amount: 4 })]) },
    { type: 'custom', x: 270, prompt: 'heal then blast', recipe: rec('Blast', [act('heal', { amount: 30 }), act('blast', { delay: 1, target: 'enemies', effect: 'knockdown', damage: 5 })]) },
  ];
  const stored = JSON.stringify({ v: 1, bytes: {}, stages: { copy: { name: 'Copy', scene: 4, tileset: null, enemies: null, events } } });
  const b = new Board(files); b.audio = true; b.load(checkpoint);
  const element = () => ({ style: {}, setAttribute() {}, append() {}, appendChild() {}, remove() {} });
  const g = { SIMPSTAGE: S, SIMPTILES: T, SIMPEVENTS: EV, SIMPRECIPE: R, SIMPENEMY: E, URLSearchParams, location: { search: '?custom=copy&play=1' }, localStorage: { getItem: () => stored }, document: { createElement: element, body: { appendChild() {} } }, setTimeout: fn => { fn(); } };
  g.window = g; vm.runInNewContext(fs.readFileSync(require.resolve('../web/stage/stages.js'), 'utf8'), g);
  for (const f of ['mods.js', 'launch.js']) vm.runInNewContext(fs.readFileSync(require.resolve('../web/stage/' + f), 'utf8'), g);
  g.SIMPMODS.apply(files); const vid = new Video(b); g.SIMPMODS.install(b, vid); await g.SIMPLAUNCH.prepare(b);
  assert.equal(g.SIMPMODS.custom.name, 'Copy'); assert(b.stageEvents, 'events installed in a stage without level art');
  const s = b.stageEvents, r = b.ram;
  let rainHit = false, rockHit = false, enemyBlast = false, healed = false, darker = false, shaken = false, drewObj = false;
  for (let f = 0; f < 1800; f++) {
    b.inputs.P1 = 255 & ~(f % 12 < 4 ? 0x12 : 0x02); if (r[0xa5b] < 8) r[0xa5b] = 20;
    EV.beforeFrame(b);
    for (const ev of s.live) for (const st of ev.acts || []) {
      if (st.a.kind === 'rain') { for (const o of st.objs) { if (b.frame - o.born === 30) { put(r, 0xa40 + 12, o.x - word(b, 0x8ac) + 54); put(r, 0xa40 + 0x11, o.z); } if (o.hit.includes(0xa40)) rainHit = true; } }
      if (st.a.kind === 'projectile') for (const o of st.objs) { if (b.frame - o.born === 35) put(r, 0xa40 + 0x11, o.z); if (o.hit.includes(0xa40)) rockHit = true; }
      if (st.a.kind === 'heal' && st.on && !st.checked) { st.checked = true; healed = r[0xa5b] >= 20; }
      if (st.a.kind === 'blast' && st.on && !st.seen) { st.seen = true; enemyBlast = true; }
      if (st.a.kind === 'heal' && !st.on && b.frame === st.at - 1) r[0xa5b] = 10;
    }
    const tint = s.live.find(ev => ev.acts && ev.acts.some(a => a.a.kind === 'tint' && b.frame >= a.at + 40 && b.frame < a.until - 40));
    if (tint && !darker) {
      const px = new Uint32Array(320 * 224).fill(0xff808080); R.drawScreen(px, tint, b.frame);
      darker = (px[1000] & 255) < 0x60 && ((px[1000] >>> 16) & 255) > (px[1000] & 255);
    }
    const sh = s.live.find(ev => ev.acts && ev.acts.some(a => a.a.kind === 'shake' && b.frame >= a.at && b.frame < a.until));
    if (sh && !shaken) { const px = new Uint32Array(320 * 224); for (let i = 0; i < px.length; i++) px[i] = (0xff000000 | (i % 320)) >>> 0; const only = { acts: sh.acts.filter(a => a.a.kind === 'shake') }; R.drawScreen(px, only, b.frame); shaken = px.some((p, i) => p !== ((0xff000000 | (i % 320)) >>> 0)); }
    if (!drewObj && s.live.length) { const px = new Uint32Array(320 * 224); drewObj = EV.drawOverlay(px) && px.some(p => p !== 0); }
    b.runFrames(1); b.drainAudio();
    if (s.fired.length === 3 && !s.live.length) break;
  }
  assert.deepEqual(s.fired.sort(), [0, 1, 2], `all described events fire (camera ${word(b, 0x8ac)})`);
  assert(rainHit, 'a falling donut lands on the player under it'); assert(rockHit, 'the rolling rock reaches the player on its lane');
  assert(healed, 'heal restores health'); assert(enemyBlast, 'the blast goes off'); assert(darker, 'night tint darkens the picture'); assert(shaken, 'shake moves the picture');
  assert(drewObj, 'objects are drawn into the frame');
  console.log('ok described events run on a copy of Stage 2: donut rain and rock hit the player, heal, blast, night tint and shake work');
  console.log('OK: events from descriptions');
})().catch(e => { console.error(e); process.exitCode = 1; });
function put(r, o, v) { r[o] = (v >> 8) & 255; r[o + 1] = v & 255; }
