// A stage played without its original enemies (enemies.js install option `quiet`), on the real ROM: Stage 1 with its
// plain enemy records removed and one placed Duffman. The stage's own goons (characters, script entrances) must never
// be visible, the placed enemy must appear, and the level must still reach its boss and clear (the hidden goons are
// knocked out on their first frame, so waves and the boss scene advance). node test/quiet_stage_check.js (needs the ROM).
'use strict';
const assert = require('assert'), fs = require('fs'), E = require('../web/stage/enemies.js'), { Board } = require('../web/sim/simpsons.js');
const files = require('./roms.js')(), b = new Board(files);
const rows = E.read(files['prog.bin'], 0).filter(r => E.kind(r) !== 'enemy'); rows.push(E.make('duffman', 420, 192));
E.install(b, null, { 0: rows }, { duffman: {} }, { quiet: [0] });
const events = fs.readFileSync(require.resolve('./input/coin_start_walk.txt'), 'utf8').split('\n').map(l => /^\s*(\d+)\s+([A-Z]+\d?)\s+([0-9a-f]+)/i.exec(l)).filter(Boolean);
b.onFrame = () => { for (const e of events) if (+e[1] + 1 === b.frame) b.inputs[e[2]] = 255 & ~parseInt(e[3], 16); };
while (b.frame < 2480) b.runFrames(1); b.onFrame = null;
const r = b.ram; let visible = 0, custom = 0, bossAt = -1, clearAt = -1;
// Marge's health is kept full; she walks right and attacks
for (let f = 0; f < 12000 && clearAt < 0; f++) {
  r[0xa5b] = 40; b.inputs.P1 = 255 & ~(2 | (f % 12 < 3 ? 16 : 0)); b.runFrames(1);
  for (let o = 0xf80; o < 0x1280; o += 0x60) if (r[o] & 0x40 && r[o + 0x1b]) {
    if (b.stageEnemySkins[o]) custom++;
    else if (!b.stageGhosts[o] && r[o + 0x1b] < 100) visible++;   // health 100+ is the boss's side of the fight
  }
  for (let o = 0xd40; o < 0xf80; o += 0x60) if (r[o] & 0x80 && bossAt < 0) bossAt = f;
  if (r[0x803] !== 2) clearAt = f;
}
assert.equal(visible, 0, 'no original goon is ever visible');
assert(custom > 0, 'the placed Duffman appears');
assert(b.stageEnemiesHeld > 5, 'the stage\'s own goons were held back (' + b.stageEnemiesHeld + ')');
assert(bossAt > 0, 'the boss still arrives');
assert(clearAt > bossAt, 'and the stage clears');
console.log(`OK: no original goons visible (${b.stageEnemiesHeld} held back), placed enemy shown, boss at frame ${bossAt}, stage clear at ${clearAt}`);
