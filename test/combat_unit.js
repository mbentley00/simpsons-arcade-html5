'use strict';
const assert=require('assert'), C=require('../web/combat.js');
function board(){
  const m={frame:100,ram:new Uint8Array(0x2000),inputs:{P1:255,P2:255,P3:255,P4:255},cpu:{x:{w:0x4a40},u:{w:0x4f80}},mw(a,v){this.ram[a-0x4000]=v;}};
  const r=m.ram;r[0x800]=2;r[0x802]=1;r[0x803]=2;r[0xa40]=0xc0;r[0xa5b]=40;r[0xa4c]=1;r[0xa4d]=0;r[0xa52]=176;
  r[0xf80]=0xc0;r[0xf84]=0x80;r[0xf9b]=40;r[0xf8c]=1;r[0xf8d]=16;r[0xf92]=176;
  C.install(m,{seed:123,noUI:true});return m;
}
let m=board();
for(let i=0;i<3;i++){m.mw(0x4f9b,m.ram[0xf9b]-4);m.frame+=10;}
assert.equal(m.arcadeCombat.players[0].combo,3);assert.equal(m.ram[0xf9b],24,'third confirmed hit adds finisher damage');
assert(m.arcadeCombat.players[0].focus>50);
m.arcadeCombat.players[0].intent='launcher';m.arcadeCombat.players[0].intentUntil=m.frame+30;m.mw(0x4f9b,m.ram[0xf9b]-4);C.afterFrame(m);
assert.equal((m.ram[0xf96]<<8)|m.ram[0xf97],12);assert.equal((m.ram[0xf99]<<8)|m.ram[0xf9a],0x500);
console.log('ok confirmed-hit chain, finisher damage, focus gain and native launcher impulse');
m=board();m.arcadeCombat.upgrades.armor=1;m.cpu.x.w=0x4f80;m.cpu.u.w=0x4a40;m.mw(0x4a5b,36);assert.equal(m.ram[0xa5b],37);
C.request('dodge');C.beforeFrame(m);m.mw(0x4a5b,33);assert.equal(m.ram[0xa5b],37);m.mw(0x4a40,0xe0);assert.equal(m.ram[0xa40]&0x20,0);
const until=m.arcadeCombat.players[0].dodgeReady;C.request('dodge');C.beforeFrame(m);assert.equal(m.arcadeCombat.players[0].dodgeReady,until);
console.log('ok armor reduces real health loss; dodge blocks damage/stagger and obeys cooldown');
m=board();C.request('special');C.beforeFrame(m);assert.equal(m.ram[0xf9b],32);assert.equal(m.arcadeCombat.players[0].focus,0,'special cannot refill itself');
console.log('ok Focus Burst spends meter and damages nearby enemies');
m=board();m.ram[0xf80]|=4;C.request('special');C.beforeFrame(m);assert.equal(m.ram[0xf9b],40,'native invulnerability shields must be respected');
m=board();m.ram[0xd40]=0xc0;m.ram[0xd5b]=80;m.cpu.u.w=0x4d40;m.arcadeCombat.players[0].intent='launcher';m.arcadeCombat.players[0].intentUntil=200;m.mw(0x4d5b,76);C.afterFrame(m);assert.equal(m.arcadeCombat.players[0].combo,1);assert.equal(m.ram[0xd57],0,'bosses resist forced launcher physics');
console.log('ok invulnerability shields and boss hit accounting/launcher resistance');
m=board();m.arcadeCombat.upgrades.speed=1;m.inputs.P1=253;m.mw(0x4a4f,2);m.mw(0x4a50,0);assert.equal((m.ram[0xa4f]<<8)|m.ram[0xa50],Math.round(512*1.15));
console.log('ok movement upgrade changes native velocity');
m=board();m.mw(0x4803,3);assert.equal(m.arcadeCombat.offers.length,3);assert.equal(new Set(m.arcadeCombat.offers).size,3);
m.arcadeCombat.offers=['vitality','power','armor'];assert(C.choose('vitality'));assert.equal(m.ram[0xa5b],48);assert.equal(m.ram[0xa8e],0,'upgrades must not overwrite unrelated object fields');assert.equal(m.arcadeCombat.upgrades.vitality,1);assert(!C.blocked);
m.ram[0x800]=1;C.afterFrame(m);assert.deepEqual(m.arcadeCombat.upgrades,{});
console.log('ok seeded three-choice stage draft, applied upgrade and run reset');
// Perfect dodge: a real enemy hit inside the dodge opens one counter window that boosts the next landed hits.
m=board();m.cpu.x.w=0x4f80;m.cpu.u.w=0x4a40;C.request('dodge');C.beforeFrame(m);m.mw(0x4a5b,30);
let a=m.arcadeCombat.players[0];assert.equal(m.ram[0xa5b],40);assert(a.counterUntil>m.frame);assert.equal(a.focus,60);assert.equal(m.arcadeCombat.stage.counters,1);
m.mw(0x4a5b,30);assert.equal(m.arcadeCombat.stage.counters,1,'one counter per dodge');
m.cpu.x.w=0x4a40;m.cpu.u.w=0x4f80;m.mw(0x4f9b,36);assert.equal(m.ram[0xf9b],34,'counter hit deals +50%');
m.frame=a.counterUntil+1;m.mw(0x4f9b,m.ram[0xf9b]-4);assert.equal(m.ram[0xf9b],30,'counter window expires');
m=board();m.arcadeCombat.upgrades.riposte=2;m.cpu.x.w=0x4f80;m.cpu.u.w=0x4a40;C.request('dodge');C.beforeFrame(m);m.mw(0x4a5b,30);
assert.equal(m.arcadeCombat.players[0].counterUntil,m.frame+120);m.cpu.x.w=0x4a40;m.cpu.u.w=0x4f80;m.mw(0x4f9b,36);assert.equal(m.ram[0xf9b],32,'riposte raises the counter multiplier');
console.log('ok perfect-dodge counter window, once per dodge, expiry and Riposte');
// Momentum from the 5th hit, Juggler air bonus and re-pop, Shockwave on finishers, Overcharge cost/reach.
m=board();m.arcadeCombat.upgrades.momentum=2;m.ram[0xf9b]=200;
for(let i=0;i<4;i++){m.mw(0x4f9b,m.ram[0xf9b]-10);m.frame+=10;}
let hp=m.ram[0xf9b];m.mw(0x4f9b,hp-10);assert.equal(hp-m.ram[0xf9b],13,'5th hit +30% with Momentum x2');
m=board();m.arcadeCombat.upgrades.juggle=1;m.ram[0xf97]=20;m.mw(0x4f9b,36);assert.equal(m.ram[0xf9b],32);
C.afterFrame(m);assert((m.ram[0xf99]<<8|m.ram[0xf9a])>=0x300,'juggle re-pops the air target');
m=board();m.arcadeCombat.upgrades.shockwave=1;const e2=0xfe0;m.ram[e2]=0xc0;m.ram[e2+4]=0x80;m.ram[e2+0x1b]=20;m.ram[e2+12]=1;m.ram[e2+13]=40;m.ram[e2+18]=176;
C.afterFrame(m);m.ram[e2+0x1b]=20;
for(let i=0;i<3;i++){m.mw(0x4f9b,m.ram[0xf9b]-4);m.frame+=10;}assert.equal(m.ram[e2+0x1b],16,'finisher shockwave hits a nearby enemy');assert.equal(m.arcadeCombat.players[0].combo,3,'shockwave does not inflate the combo');
m=board();m.arcadeCombat.upgrades.burst=2;m.arcadeCombat.players[0].focus=30;m.ram[0xf8c]=1;m.ram[0xf8d]=100;C.request('special');C.beforeFrame(m);
assert.equal(m.arcadeCombat.players[0].focus,0);assert.equal(m.ram[0xf9b],32,'Overcharge: 30 focus and 136px reach');
console.log('ok Momentum, Juggler, Shockwave and Overcharge');
// Elites are seeded, stage 2+, and pay out focus/health when defeated.
m=board();m.ram[0x803]=9;m.arcadeCombat.level=5;let elites=0;
for(let i=0;i<40;i++){m.ram[0xf80]=0;C.afterFrame(m);m.ram[0xf80]=0xc0;m.ram[0xf9b]=10;C.afterFrame(m);if(m.arcadeCombat.elite[0xf80]){elites++;assert(m.ram[0xf9b]>=32&&m.ram[0xf9b]<=56);}}
assert(elites>3&&elites<25,'about 28% elites at stage 5, got '+elites);
const run=s=>{const b=board();b.ram[0x803]=9;b.arcadeCombat.rng=s;const out=[];for(let i=0;i<20;i++){b.ram[0xf80]=0;C.afterFrame(b);b.ram[0xf80]=0xc0;b.ram[0xf9b]=10;C.afterFrame(b);out.push(!!b.arcadeCombat.elite[0xf80]);}return out.join();};
assert.equal(run(99),run(99),'elite rolls are deterministic for a seed');
m.arcadeCombat.elite[0xf80]=true;m.ram[0xf9b]=4;m.ram[0xa5b]=20;m.arcadeCombat.players[0].focus=0;m.mw(0x4f9b,0);
assert.equal(m.ram[0xa5b],20,'health comes from the dropped snack, not instantly');assert.equal(m.arcadeCombat.players[0].focus,27);assert.equal(m.arcadeCombat.stage.elites,1);assert(!m.arcadeCombat.elite[0xf80]);
{const s=m.arcadeCombat,k=s.pickups[0];assert.equal(s.pickups.length,1,'an elite drops a snack');assert.deepEqual(JSON.parse(JSON.stringify(s.pickups)),s.pickups,'pickups are plain data');
 const kind=C.PICKUP.kinds[k.kind];m.ram[0xa4c]=m.ram[0xf8c];m.ram[0xa4d]=m.ram[0xf8d];m.ram[0xa51]=m.ram[0xf91];m.ram[0xa52]=m.ram[0xf92];s.players[0].focus=0;C.beforeFrame(m);
 assert.equal(s.pickups.length,0,'walking over the snack eats it');assert.equal(m.ram[0xa5b],Math.min(40,20+kind.heal));assert.equal(s.players[0].focus,kind.focus);}
m=board();for(let i=0;i<30;i++){m.ram[0xf80]=0;C.afterFrame(m);m.ram[0xf80]=0xc0;C.afterFrame(m);}assert.deepEqual(m.arcadeCombat.elite,{},'no elites on stage 1');
console.log('ok seeded elite enemies with stage scaling and KO rewards');
// Results card, rank, rarity weighting, rank bonuses.
const st={level:1,start:0,taken:0,best:12,kos:20,elites:2,counters:3};
assert.equal(C.rate(st,60*100).rank,'S');assert.equal(C.rate({...st,best:3,kos:8,elites:0,counters:0,taken:10},60*200).rank,'C');
m=board();m.arcadeCombat.stage={...st,start:m.frame};m.frame+=6000;m.mw(0x4803,3);
assert.equal(m.arcadeCombat.results.rank,'S');assert.equal(m.arcadeCombat.offers.length,4);assert(m.arcadeCombat.offers.some(id=>C.UPGRADES.find(u=>u.id===id).rarity!=='common'));
assert.equal(m.arcadeCombat.history.length,1);
let rare=0,all=0;for(let s=1;s<400;s++){const b=board();b.arcadeCombat.rng=s;b.mw(0x4803,3);for(const id of b.arcadeCombat.offers){all++;if(C.UPGRADES.find(u=>u.id===id).rarity==='epic')rare++;}}
assert(rare/all>.03&&rare/all<.16,'epic cards are uncommon: '+rare/all);
m=board();C.afterFrame(m);m.ram[0x803]=4;C.afterFrame(m);assert.equal(m.arcadeCombat.stage.level,2,'stats reset when the next stage starts');
console.log('ok stage results rank, S/A draft bonuses, rarity weights and per-stage stats');
// The in-game overlay draws nothing without a page (Node), and never touches the frame it is given then.
{const px=new Uint32Array(320*224).fill(7);assert.equal(C.drawOverlay(px),false);assert(px.every(v=>v===7));console.log('ok overlay is presentation-only and inert without a page');}
// Free bowling balls: no meter, cooldown, roll along the thrower's depth, confirmed hits, STRIKE on 3+ hits, plain data.
m=board();a=m.arcadeCombat.players[0];const focus0=a.focus;C.request('throw');C.beforeFrame(m);
assert.equal(m.arcadeCombat.balls.length,1);assert.equal(m.ram[0xf9b],34,'ball hits an overlapping enemy');assert.equal(a.combo,1);assert(a.focus>=focus0,'throwing costs no focus');
C.request('throw');C.beforeFrame(m);assert.equal(m.arcadeCombat.balls.length,1,'cooldown between throws');
m.frame+=C.BALL.cooldown;C.request('throw');C.beforeFrame(m);assert.equal(m.arcadeCombat.balls.length,2);
assert.deepEqual(JSON.parse(JSON.stringify(m.arcadeCombat.balls)),m.arcadeCombat.balls,'balls are plain board data');
for(let i=0;i<200;i++){m.frame++;C.beforeFrame(m);}assert.equal(m.arcadeCombat.balls.length,0,'balls leave the screen');
m=board();for(const e of [0xfe0,0x1040]){m.ram.copyWithin(e,0xf80,0xfe0);}
m.ram[0xf80+0x11]=0;m.ram[0xfe0+0x11]=0;m.ram[0x1040+0x11]=0;
C.request('throw');C.beforeFrame(m);assert.equal(m.arcadeCombat.balls[0].hit.length,3);assert.equal(m.arcadeCombat.message,'STRIKE!');
m=board();m.ram[0xf92]=100;C.request('throw');for(let i=0;i<20;i++){m.frame++;C.beforeFrame(m);}assert.equal(m.ram[0xf9b],40,'other depth lanes are not hit');
console.log('ok bowling balls: free throws with cooldown, confirmed hits, STRIKE on three hits, depth lanes, plain data');
// Heavy attack: wind-up holds the player, a dash, then a native attack press; a native hit in the window is a SMASH.
{
  const m=board(),s=m.arcadeCombat,a=s.players[0],seen=[];C.request('heavy');
  for(let i=0;i<C.HEAVY.windup+C.HEAVY.dash+1;i++){C.beforeFrame(m);seen.push(m.inputs.P1);m.frame++;m.inputs.P1=255;}
  assert(seen.slice(0,C.HEAVY.windup).every(v=>v===255),'wind-up releases every button');
  assert.equal(seen[C.HEAVY.windup],253,'the dash holds the facing direction');assert.equal(seen[seen.length-1],255&~16,'then the native attack is pressed');
  assert(a.heavyHitUntil>=m.frame);m.mw(0x4f9b,36);assert.equal(m.ram[0xf9b],30,'a heavy hit deals 1.6x + 3');assert.equal(s.message,'SMASH!');
  C.afterFrame(m);assert.equal((m.ram[0xf8f]<<8)|m.ram[0xf90],0x700,'and knocks the enemy far back');
  const at=a.heavyAt,ready=a.heavyReady;C.request('heavy');C.beforeFrame(m);assert.equal(a.heavyAt,at);assert.equal(a.heavyReady,ready,'no restart during the move or cooldown');
  console.log('ok heavy attack: wind-up, dash, native press, SMASH damage and knockback');
}
// Signature moves by native character id (+4): Marge vacuum, Homer belly bump, Bart slingshot, Lisa sax.
const sigRun=(id,setup)=>{const m=board();m.ram[0xa44]=id;if(setup)setup(m);C.request('signature');for(let i=0;i<60;i++){C.beforeFrame(m);C.afterFrame(m);m.frame++;}return m;};
{
  const b=sigRun(2);assert.equal(b.ram[0xf9b],40-4-4-6,'three slingshot rocks: 4 + 4 + 6');assert.equal(b.arcadeCombat.rocks.length,0);
  const l=sigRun(3);assert.equal(l.ram[0xf9b],40-3*4-5,'five sax waves stun once each, the last knocks down');
  const mg=sigRun(0,m=>{m.ram[0xf8d]=60;});const x=(mg.ram[0xf8c]<<8)|mg.ram[0xf8d];
  assert(x<256+60-30,'the vacuum pulls enemies in ('+(x-256)+' px left)');assert.equal(mg.ram[0xf9b],33,'then blows them away for 7');
  const h=sigRun(1);assert.equal(h.ram[0xf9b],32,'belly bump hits for 8');
  const hm=board();hm.ram[0xa44]=1;C.request('signature');C.beforeFrame(hm);hm.cpu.x.w=0x4f80;hm.cpu.u.w=0x4a40;hm.mw(0x4a5b,30);assert.equal(hm.ram[0xa5b],35,'Homer takes half damage while charging');
  const again=board();C.request('signature');C.beforeFrame(again);const ready=again.arcadeCombat.players[0].sigReady;assert(ready>again.frame+100);
  again.frame+=60;C.request('signature');C.beforeFrame(again);assert.equal(again.arcadeCombat.players[0].sigReady,ready,'signature recharges');
  assert.deepEqual(JSON.parse(JSON.stringify(again.arcadeCombat)),again.arcadeCombat,'move state is plain data');
  console.log('ok signature moves: slingshot rocks, sax waves, vacuum pull + blast, belly bump with half damage, recharge');
}
// Roll: holds the roll direction for the native walk, scripted velocity, and a rotating sprite transform mid-roll.
{
  const m=board(),a=m.arcadeCombat.players[0];m.inputs.P1=255&~4;C.beforeFrame(m);m.inputs.P1=255&~4;C.request('roll');C.beforeFrame(m);
  assert.equal(m.inputs.P1,255&~(2|4),'rolls right and into the stage while up is held');assert.equal(a.rollDz,1);
  m.mw(0x4a4f,0);m.mw(0x4a50,0);assert.equal(((m.ram[0xa4f]<<8)|m.ram[0xa50]),C.ROLL.speed,'native velocity assignment becomes the roll speed');
  m.frame+=8;const t=C.transformFor(m,0);assert(t&&Math.abs(t.rot)>0.5&&t.ghosts.length===2,'mid-roll the sprite spins with afterimages');
  m.frame+=C.ROLL.frames;assert.equal(C.transformFor(m,0),null,'and stands back up');
  console.log('ok roll: direction, depth, native velocity and sprite transform');
}
// Compositor: a 10x20 figure in the scratch buffer rotated a quarter turn lands 20x10, on the floor line for a roll.
{
  const W=320,view={bmp:new Uint16Array(W*264),pri:new Uint8Array(W*264)},S={bmp:new Uint16Array(W*264),pri:new Uint8Array(W*264),priSnap:new Uint8Array(W*264),pmask:0};
  for(let y=100;y<120;y++)for(let x=50;x<60;x++){S.pri[y*W+x]=31;S.bmp[y*W+x]=77;}
  C.composite(view,S,{rot:Math.PI/2,kx:1,ky:1,pivot:'roll',ghosts:[{dx:-8,pen:6}]},4096);
  let x0=W,x1=0,y0=264,y1=0,n=0,g=0;for(let i=0;i<view.bmp.length;i++){if(view.bmp[i]===77){n++;const x=i%W,y=(i/W)|0;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}if(view.bmp[i]===4102)g++;}
  assert(x1-x0>=18&&y1-y0<=11,'rotated a quarter turn: '+(x1-x0+1)+'x'+(y1-y0+1));assert(Math.abs(y1-119)<=1,'rests on the original floor line');assert(n>=180&&g>20,'figure plus a checkered afterimage');
  view.pri.fill(0);view.bmp.fill(0);S.priSnap.fill(31);C.composite(view,S,{rot:0.3,kx:1,ky:1,pivot:'feet',ghosts:[]},4096);assert.equal(view.bmp.filter(v=>v===77).length,0,'objects already in front keep covering the player');
  for(const [k,gl] of Object.entries(C.ICONS))assert(gl.length===12&&gl.every(r=>r.length===12),'icon '+k+' is 12x12');
  for(const u of C.UPGRADES)assert(C.ICONS[u.icon],'item '+u.id+' has a picture');
  console.log('ok sprite compositor rotation, floor line, afterimages, occlusion; item pictures');
}
// Moves never start while the game owns the player (0x3f = held by an enemy), and never write velocity directly:
// a velocity written while held would keep the player sliding, because the game stops assigning velocity then.
{
  const m=board(),a=m.arcadeCombat.players[0];m.ram[0xa45]=0x3f;for(const mv of ['heavy','signature','roll']){C.request(mv);C.beforeFrame(m);}
  assert(a.heavyAt<0&&a.sigAt<0&&a.rollAt<0,'no move starts while held');
  m.ram[0xa45]=1;m.ram[0xa4f]=0;m.ram[0xa50]=0;C.request('heavy');for(let i=0;i<C.HEAVY.windup+C.HEAVY.dash;i++){C.beforeFrame(m);m.frame++;}
  assert.equal((m.ram[0xa4f]<<8)|m.ram[0xa50],0,'moves only replace velocities the game assigns itself');
  console.log('ok moves wait for a free native state and never write velocity directly');
}
