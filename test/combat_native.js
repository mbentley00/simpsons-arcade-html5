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
  // walk in, then keep rolling through the nearest enemy (each roll aims at it, so the player stays in the fight)
  const r=d.ram,w=o=>((r[o]<<8)|r[o+1])<<16>>16,nearest=()=>{let best=null;for(let e=0xd40;e<0x1640;e+=0x60)if((r[e]&0x40)&&r[e+0x1b]&&(!best||Math.abs(w(e+12)-w(0xa4c))<Math.abs(w(best+12)-w(0xa4c))))best=e;return best;};
  for(let f=0;f<900&&at<0;f++){const e=nearest(),close=e&&Math.abs(w(e+12)-w(0xa4c))<70;d.inputs.P1=close?255:f%40<20?253:255;
    if(close&&f%3===0){s.players[0].dir=w(e+12)>=w(0xa4c)?1:-1;C.request('dodge');}C.beforeFrame(d);d.runFrames(1);C.afterFrame(d);if(s.stage.counters)at=f;}
  assert(at>=0,'a native enemy hit inside a dodge must open a counter');assert(s.players[0].counterUntil>d.frame);
  console.log(`OK: native perfect dodge at frame +${at}, counter window ${s.players[0].counterUntil-d.frame} frames`);
}
// A thrown bowling ball rolls into a live native enemy on the real board and damages it through the native health path.
{
  const r=b.ram,word=o=>((r[o]<<8)|r[o+1])<<16>>16,s=b.arcadeCombat;
  let foe=-1;for(let e=0xd40;e<0x1640;e+=0x60)if((r[e]&0x40)&&!(r[e]&4)&&r[e+0x1b]){foe=e;break;}
  for(let f=0;f<600&&foe<0;f++){b.inputs.P1=255;C.beforeFrame(b);b.runFrames(1);C.afterFrame(b);for(let e=0xd40;e<0x1640;e+=0x60)if((r[e]&0x40)&&!(r[e]&4)&&r[e+0x1b]){foe=e;break;}}
  assert(foe>=0,'a live native enemy to bowl at');
  const hp=r[foe+0x1b],px=word(0xa4c),dir=word(foe+12)>px?1:-1;s.players[0].dir=dir;s.players[0].throwReady=0;b.inputs.P1=255;
  C.request('throw');C.beforeFrame(b);const ball=s.balls[s.balls.length-1];assert(ball,'ball thrown');
  ball.z=word(foe+17);ball.x=word(foe+12)+word(0x8ac)-dir*30;   // line the ball up with the enemy's depth band
  r[foe+0x1b]=Math.max(r[foe+0x1b],20);const full=r[foe+0x1b];
  let hit=-1;for(let f=0;f<40&&hit<0;f++){C.beforeFrame(b);if(ball.hit.includes(foe))hit=f;b.runFrames(1);C.afterFrame(b);}
  assert(hit>=0,'the ball must reach the enemy');assert(r[foe+0x1b]<full,'the ball damages the native enemy');
  // the game's own hit handler reacts (state 4 = hit reaction); hit kind 3 used to be ignored, so enemies never flinched
  let reacted=false;for(let f=0;f<6;f++){if(r[foe+2]===4)reacted=true;C.beforeFrame(b);b.runFrames(1);C.afterFrame(b);}
  assert(reacted,'the ball knocks the enemy down');
  console.log(`OK: native bowling ball hit enemy 0x${foe.toString(16)} after ${hit+1} frames (health ${full} -> ${r[foe+0x1b]}, knocked down)`);
}
// Roll, heavy attack and the sprite pipeline on the real board with the real video.
{
  const {Video}=require('../web/sim/video.js'),bd=new Board(require('./roms.js')());
  bd.onFrame=()=>{for(const e of events)if(+e[1]+1===bd.frame)bd.inputs[e[2]]=255&~parseInt(e[3],16);};
  while(bd.frame<2480)bd.runFrames(1);bd.onFrame=null;
  const v=new Video(bd);C.install(bd,{noUI:true,seed:7,video:v});
  const r=bd.ram,s=bd.arcadeCombat,a=s.players[0],word=o=>((r[o]<<8)|r[o+1])<<16>>16,step=(bits=255)=>{bd.inputs.P1=bits;C.beforeFrame(bd);bd.runFrames(1);C.afterFrame(bd);};
  assert.equal(r[0xa44],0,'player 1 is character 0 (Marge)');
  for(let i=0;i<10;i++)step();
  const x0=word(0xa4c),z0=word(0xa51);a.dir=1;bd.inputs.P1=255&~4;C.beforeFrame(bd);C.request('roll');
  let mid=null,stand=null;for(let i=0;i<C.ROLL.frames;i++){step(255&~4);v.render();const b=v.combatFx.box(0);if(b&&(!mid||b.outH/b.h<mid.outH/mid.h))mid={...b};}
  const rolled=word(0xa4c)-x0;assert(rolled>=40,'a roll travels ('+rolled+' px)');assert(word(0xa51)!==z0,'up tilts the roll into the stage');
  stand={w:mid.w,h:mid.h};
  assert(mid&&mid.outH<mid.h*.75&&mid.outW>mid.w*1.2,`mid-roll the sprite is turned on its side (${mid.w}x${mid.h} -> ${mid.outW}x${mid.outH})`);
  assert(Math.abs(mid.bottom-mid.floor)<=3,'the tumbling sprite stays on the floor '+JSON.stringify(mid));
  for(let i=0;i<30;i++)step();
  // walk to the first enemies and smash one (the roll moved Marge into another depth lane: line her up with the
  // nearest enemy's depth once it is in reach, so this checks the attack rather than navigation)
  let smash=false;for(let f=0;f<900&&!smash;f++){
    const lane=[...Array(15)].map((_,k)=>0xd40+k*0x60).find(e=>(r[e]&0x40)&&r[e+0x1b]&&Math.abs(word(e+12)-word(0xa4c))<80);
    if(lane&&a.heavyAt<0){r[0xa51]=r[lane+17];r[0xa52]=r[lane+18];}
    const near=[...Array(15)].some((_,k)=>{const e=0xd40+k*0x60;return (r[e]&0x40)&&r[e+0x1b]&&Math.abs(word(e+12)-word(0xa4c))<60&&Math.abs(word(e+17)-word(0xa51))<10;});
    if(near&&bd.frame>=a.heavyReady&&a.heavyAt<0){const e=[...Array(15)].map((_,k)=>0xd40+k*0x60).find(e=>(r[e]&0x40)&&r[e+0x1b]&&Math.abs(word(e+12)-word(0xa4c))<60);a.dir=word(e+12)>word(0xa4c)?1:-1;C.request('heavy');}
    step(near?255:(f%60<30?253:255&~(f%120<60?4:8)));if(s.message==='SMASH!')smash=true;}
  assert(smash,'a heavy attack lands on a real enemy as a SMASH');
  console.log(`OK: native roll moved ${rolled}px, sprite ${mid.w}x${mid.h} -> ${mid.outW}x${mid.outH} mid-roll, heavy SMASH on a real enemy`);
}
