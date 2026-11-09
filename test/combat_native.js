// Verify a real native collision produces a combo/launcher, and native motion honors the dodge velocity hook.
'use strict';
const assert=require('assert'),fs=require('fs'),{Board}=require('../web/sim/simpsons.js'),C=require('../web/combat.js');
const b=new Board(require('./roms.js')());
const events=fs.readFileSync(require.resolve('./input/coin_start_walk.txt'),'utf8').split('\n').map(l=>/^\s*(\d+)\s+([A-Z]+\d?)\s+([0-9a-f]+)/i.exec(l)).filter(Boolean);
b.onFrame=()=>{for(const e of events)if(+e[1]+1===b.frame)b.inputs[e[2]]=255&~parseInt(e[3],16);};
while(b.frame<2480)b.runFrames(1);b.onFrame=null;C.install(b,{noUI:true,seed:7});
let maxZ=0,airFrames=0,best=0;
for(let f=0;f<150;f++){
  b.inputs.P1=255&~(f%30<8?21:5);C.beforeFrame(b);b.runFrames(1);C.afterFrame(b);
  const z=(b.ram[0xf96]<<8)|b.ram[0xf97];if(z>0&&z<256)airFrames++;maxZ=Math.max(maxZ,z<256?z:0);best=Math.max(best,b.arcadeCombat.players[0].best);
}
assert(best>=1,'native hit must increase the confirmed-hit combo');assert(maxZ>12&&airFrames>=5,'native physics must continue the launch after the initial impulse');
b.inputs.P1=253;const x=()=>((b.ram[0xa4c]<<8)|b.ram[0xa4d]);const start=x();C.request('dodge');
for(let f=0;f<8;f++){C.beforeFrame(b);b.runFrames(1);C.afterFrame(b);}
assert(x()-start>=24,'native dodge must move faster than the normal walk');
console.log(`OK: native hit combo ${best}, launcher peak ${maxZ}px over ${airFrames} frames, dodge moved ${x()-start}px`);
// Perfect dodge against a real enemy attack: walk into stage 1's first enemies while dodging on cooldown.
{
  const d=new Board(require('./roms.js')());
  d.onFrame=()=>{for(const e of events)if(+e[1]+1===d.frame)d.inputs[e[2]]=255&~parseInt(e[3],16);};
  while(d.frame<2480)d.runFrames(1);d.onFrame=null;C.install(d,{noUI:true,seed:7});
  const s=d.arcadeCombat;let at=-1;
  for(let f=0;f<600&&at<0;f++){d.inputs.P1=f%40<20?253:255;if(f>40&&f%3===0)C.request('dodge');C.beforeFrame(d);d.runFrames(1);C.afterFrame(d);if(s.stage.counters)at=f;}
  assert(at>=0,'a native enemy hit inside a dodge must open a counter');assert(s.players[0].counterUntil>d.frame);
  console.log(`OK: native perfect dodge at frame +${at}, counter window ${s.players[0].counterUntil-d.frame} frames`);
}
