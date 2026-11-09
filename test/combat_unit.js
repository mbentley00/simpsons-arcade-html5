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
assert.equal(m.ram[0xa5b],24);assert.equal(m.arcadeCombat.players[0].focus,27);assert.equal(m.arcadeCombat.stage.elites,1);assert(!m.arcadeCombat.elite[0xf80]);
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
