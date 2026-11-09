// Native scene initialization checks, sharing a pre-selection checkpoint generated from the user's ROM at runtime.
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {Board} = require('../web/sim/simpsons.js'), S = require('../web/stage/stagedata.js');
const files = require('./roms.js')();
const seed = new Board(files); seed.audio = true;
while(seed.frame < 1040) {
  seed.inputs.COIN = seed.frame % 60 < 8 ? 0xfe : 0xff;
  seed.inputs.P1 = seed.ram[0x800] === 2 && seed.ram[0x803] === 1 ? (seed.frame % 16 < 8 ? 0x6f : 0xff) : (seed.frame % 30 < 8 ? 0x7f : 0xff);
  seed.runFrames(1); seed.drainAudio();
}
assert.equal(seed.ram[0x803], 1); const checkpoint = seed.save();
console.log('Generated clean native character-selection checkpoint at frame', seed.frame);
const modSource = fs.readFileSync(require.resolve('../web/stage/mods.js'), 'utf8');
const launchSource = fs.readFileSync(require.resolve('../web/stage/launch.js'), 'utf8');
(async () => {
  let failed = 0;
  for (const sc of S.SCENES) {
    const b = new Board(files); b.audio = true; b.load(checkpoint);
    const element = () => ({style:{},setAttribute(){},append(){},appendChild(){},remove(){}});
    const g = {SIMPSTAGE:S,URLSearchParams,location:{search:'?scene='+sc.scene+'&play=1'},localStorage:{getItem(){return null;}},document:{createElement:element,body:{appendChild(){}}}, setTimeout: fn => { fn(); }};
    g.window = g; vm.runInNewContext(modSource, g); vm.runInNewContext(launchSource, g);
    g.SIMPMODS.apply(files); g.SIMPMODS.install(b);
    try { await g.SIMPLAUNCH.prepare(b); } catch(e) { failed++; console.error('FAIL',sc.name,Array.from(b.ram.slice(0x800,0x808)),b.ram[0x875],b.ram[0xa40]); continue; }
    assert(g.SIMPLAUNCH.playable(b,sc));
    assert.equal(b.ram[0x875], sc.st); assert.equal(b.inputs.P1,255); assert.equal(b.inputs.COIN,255);
    console.log('ok',sc.name,'scene',b.ram[0x803],'stage',b.ram[0x875].toString(16),'phase',b.ram[0x804]);
  }
  assert.equal(failed,0,'every editor scene must launch');
})().catch(e=>{console.error(e);process.exitCode=1;});
