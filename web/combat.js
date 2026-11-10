// Offline Arcade Remix: confirmed-hit combos, a roll, heavy attacks and a signature move per character, Springfield
// item pickups and a run-scoped, seeded between-stage item draft.
(function (G) {
  'use strict';
  const q = new URLSearchParams(G.location ? G.location.search : '');
  const enabled = q.get('mods') !== '0' && !q.has('sala') && q.get('combat') !== '0';
  const LEVELS = {2:1,4:2,6:3,7:4,8:4,9:5,11:6,13:7,15:8};
  // Draft weights per rarity. A stage rank of A guarantees one rare or epic card; S adds a fourth card.
  const RARITY = {common:{weight:6,label:'Common'},rare:{weight:3,label:'Rare'},epic:{weight:2,label:'Epic'}};
  // Run upgrades are Springfield items; `icon` names the pixel-art picture drawn on cards, the HUD and the help page.
  const UPGRADES = [
    {id:'power',name:'Buzz Cola',text:'+20% damage on landed hits.',max:3,rarity:'common',icon:'cola'},
    {id:'armor',name:'Hockey Pads',text:'Take 1 less damage from enemy attacks.',max:3,rarity:'common',icon:'pads'},
    {id:'vitality',name:'Pink Donut',text:'+8 maximum health and heal 8.',max:3,rarity:'common',icon:'donut'},
    {id:'leech',name:'Krusty Burger',text:'Heal 2 health whenever you defeat an enemy.',max:3,rarity:'common',icon:'burger'},
    {id:'speed',name:'Skateboard',text:'+15% native movement speed.',max:3,rarity:'common',icon:'board'},
    {id:'focus',name:'Comic Book',text:'+3 focus per landed hit.',max:3,rarity:'common',icon:'comic'},
    {id:'flow',name:'Squishee',text:'+30 frames to keep your combo alive.',max:3,rarity:'common',icon:'squishee'},
    {id:'dodge',name:'Roller Skates',text:'Roll again sooner and stay untouchable longer.',max:3,rarity:'common',icon:'skates'},
    {id:'steel',name:'Steel-Toe Boots',text:'Heavy attacks hit 30% harder and wind up faster.',max:2,rarity:'common',icon:'boot'},
    {id:'heal',name:'Family Dinner',text:'Restore all active players to full health.',max:99,rarity:'common',icon:'turkey'},
    {id:'momentum',name:'Sugar Rush',text:'From the 5th hit of a combo, +15% damage and +2 focus per hit.',max:3,rarity:'rare',icon:'candy'},
    {id:'juggle',name:'Bowling Pin',text:'Air hits deal +2 more damage and pop the enemy back up.',max:2,rarity:'rare',icon:'pin'},
    {id:'riposte',name:'Boxing Glove',text:'Perfect-roll counters last 30 frames longer and hit 25% harder.',max:2,rarity:'rare',icon:'glove'},
    {id:'encore',name:'Lucky Clover',text:'Your signature move recharges 25% faster.',max:2,rarity:'rare',icon:'clover'},
    {id:'shockwave',name:'Uranium Rod',text:'Chain finishers hit every other nearby enemy for 4 damage.',max:2,rarity:'epic',icon:'rod'},
    {id:'burst',name:'Plant Battery',text:'Focus Burst costs 10 less and reaches farther.',max:2,rarity:'epic',icon:'battery'},
  ];
  const STOP_MS = {finisher:45,launcher:70,counter:90,shockwave:60,strike:80,heavy:85,signature:70};
  // Free bowling balls (B / gamepad RT): no meter, short cooldown. Balls are plain board data in world coordinates
  // (object x + camera), roll along the thrower's depth line and hit native enemies through the same health/reaction
  // writes Focus Burst uses. A ball that hits 3+ enemies is a STRIKE.
  const BALL = {cooldown:20,speed:5,life:110,reachX:14,reachZ:12,damage:6,colors:5};
  // Roll (C / LB): a ground tumble in the facing direction (up/down tilts it into the depth of the stage). Invulnerable
  // for `inv` frames; a real enemy hit landing inside them is a perfect roll and opens a counter window.
  const ROLL = {frames:18,inv:14,speed:0x380,depth:0x140,cooldown:30};
  // Heavy attack (V / gamepad X): wind up, dash in, then the native attack lands as a SMASH with big knockback.
  const HEAVY = {windup:10,dash:5,press:2,window:22,cooldown:42,dashSpeed:0x700};
  // Native character id at player byte +4 (4-player set: P1 Marge, P2 Homer, P3 Bart, P4 Lisa). Signature moves
  // (F / gamepad Y) recharge over `cool` frames.
  const CHARS = ['marge','homer','bart','lisa'];
  const SIG = {
    marge:{name:'VACUUM',frames:44,cool:210,help:'SUCKS ENEMIES IN, THEN BLOWS THEM AWAY'},
    homer:{name:'BELLY BUMP',frames:20,cool:170,help:'CHARGES THROUGH A CROWD, TAKES HALF DAMAGE'},
    bart:{name:'SLINGSHOT',frames:24,cool:150,help:'THREE ROCKS ACROSS THE SCREEN'},
    lisa:{name:'SAX SOLO',frames:46,cool:210,help:'SOUND WAVES STUN EVERYONE IN FRONT'},
  };
  // Elites drop a Springfield snack where they fall; walk over it to eat it.
  const PICKUP = {life:720,reachX:16,reachZ:12,kinds:[{icon:'donut',name:'DONUT!',heal:8,focus:20},{icon:'squishee',name:'SQUISHEE!',heal:4,focus:40},{icon:'burger',name:'KRUSTY BURGER!',heal:14,focus:10}]};
  let machine = null, ui = null, queued = [], stopUntil = 0;
  const word = (r,o) => ((r[o]<<8)|r[o+1])<<16>>16;
  const put = (r,o,v) => { r[o]=(v>>8)&255; r[o+1]=v&255; };
  const now = () => (G.performance ? G.performance.now() : Date.now());
  const player = o => o>=0xa40 && o<0xd40 && (o-0xa40)%0xc0===0 ? (o-0xa40)/0xc0 : -1;
  const foe = o => o>=0xd40 && o<0x1640 && (o-0xd40)%0x60===0;
  const regular = o => o>=0xf80 && o<0x1280 && (o-0xf80)%0x60===0;
  const live = (r,e) => (r[e]&0x40) && !(r[e]&4) && r[e+0x1b];
  const playing = m => enabled && m.arcadeCombat && m.ram[0x800]===2 && m.ram[0x802]===1 && !(G.SIMPG && G.SIMPG.net);
  const maximum = s => 40 + 8*(s.upgrades.vitality||0);
  const flowWindow = s => 90+30*(s.upgrades.flow||0);
  const burstCost = s => 50-10*(s.upgrades.burst||0);
  const cam = r => word(r,0x8ac);
  const near = (r,a,b,dx,dz) => Math.abs(word(r,a+12)-word(r,b+12))<dx && Math.abs(word(r,a+17)-word(r,b+17))<dz;
  const grounded = (r,o) => word(r,o+0x16)<=4;
  // native player action byte +5: below 0x30 standing, walking, idle animations or carrying; 0x35-0x37 attacking; others (0x3f held by an enemy,
  // 0x5x hurt or knocked down) belong to the game, so Remix moves never start there
  const free = (r,o,attacking=false) => grounded(r,o) && (r[o+5]<0x30 || (attacking && r[o+5]>=0x35 && r[o+5]<=0x37));
  const charOf = (r,p) => CHARS[r[0xa40+p*0xc0+4]&3];
  const rolling = (a,f) => a.rollAt>=0 && f<a.rollAt+ROLL.frames;
  const newStage = (level,frame) => ({level,start:frame,taken:0,best:0,kos:0,elites:0,counters:0});
  function create(seed) {
    return {version:3,rng:(seed>>>0)||0x42ac9153,level:1,upgrades:{},cleared:{},offers:[],pendingLevel:0,enemySeen:{},elite:{},effects:[],balls:[],rocks:[],waves:[],pickups:[],wasGame:false,
      stage:newStage(1,0),results:null,history:[],
      players:Array.from({length:4},()=>({combo:0,best:0,lastHit:-9999,focus:50,lastBits:0,intent:'chain',intentUntil:0,dodgeUntil:0,dodgeReady:0,countered:false,counterUntil:0,throwReady:0,dir:1,active:false,
        rollAt:-1,rollDir:1,rollDz:0,heavyAt:-1,heavyHitUntil:0,heavyReady:0,sigAt:-1,sigKind:'',sigReady:0,sigHit:[],armorUntil:0,vx:0,vxUntil:0,vz:0,vzUntil:0})),
      message:'^ + ATTACK LAUNCHES * C ROLLS * V HEAVY * F SIGNATURE * Q BURST * B BOWLS',messageUntil:0};
  }
  function random(s) { let x=s.rng; x^=x<<13; x^=x>>>17; x^=x<<5; s.rng=x>>>0; return s.rng; }
  function heal(m,p,n) { const o=0xa40+p*0xc0; if(m.ram[o]&0x40) m.ram[o+0x1b]=Math.min(maximum(m.arcadeCombat),m.ram[o+0x1b]+n); }
  function message(m,text) { const s=m.arcadeCombat; s.message=text; s.messageUntil=m.frame+90; }
  // Presentation only: a short wall-clock hit-stop (game.js skips frames while blocked), a screen shake and a callout
  // drawn into the game picture. None of it is board state, so save/load and the seeded run stay identical.
  function feedback(kind,text,p=0) {
    if(!ui) return;
    const t=now(), calm=G.matchMedia&&G.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!calm) {
      stopUntil=Math.max(stopUntil,t+(STOP_MS[kind]||0));
      ui.shake={at:t,amp:kind==='launcher'||kind==='counter'||kind==='heavy'?3:2};
    }
    if(text) ui.callout={text,kind,p,at:t,calm};
  }
  // A hit written the way the game's own attacks write it: hit kind at +0x1e, health, attacker pointer at +0x25, then
  // flag 0x20; the enemy's handler plays the reaction next frame. Kinds seen from native attacks: 0x11/0x12 flinch,
  // 0x14 knocks the enemy into the air and down. Any other kind is ignored (no flinch, no knockdown).
  const HIT={flinch:0x12,knockdown:0x14};
  function hit(r,e,health,kind,attacker) { r[e]&=~0x20; r[e+0x1e]=kind; r[e+0x1b]=health; put(r,e+0x25,0x4000+attacker); r[e]|=0x20; }
  // One scripted hit from a Remix move (burst, ball, signature): native health/reaction writes plus combo accounting.
  function strike(m,p,e,base,kind,reaction,push) {
    const s=m.arcadeCombat,r=m.ram,o=0xa40+p*0xc0,damage=Math.ceil(base*(1+.2*(s.upgrades.power||0)));
    hit(r,e,Math.max(0,r[e+0x1b]-damage),reaction,o); landed(m,p,e,damage,r[e+0x1b],kind);
    if(push&&regular(e)) s.effects.push({o:e,launch:reaction===HIT.knockdown,dir:push,power:0x500});
    return damage;
  }
  function landed(m,p,o,damage,remaining,kind) {
    const s=m.arcadeCombat, a=s.players[p], r=m.ram;
    a.combo=m.frame-a.lastHit<=flowWindow(s)?a.combo+1:1; a.lastHit=m.frame; a.best=Math.max(a.best,a.combo);
    s.stage.best=Math.max(s.stage.best,a.combo);
    if(kind!=='special') a.focus=Math.min(100,a.focus+7+3*(s.upgrades.focus||0)+(a.combo>=5?2*(s.upgrades.momentum||0):0));
    const launch=kind==='launcher'&&regular(o), finisher=a.combo%3===0, countering=m.frame<=a.counterUntil, scripted=kind==='special'||kind==='signature'||kind==='ball';
    if(regular(o)&&(launch||finisher)&&kind!=='heavy') s.effects.push({o,launch,dir:a.dir});
    else if(regular(o)&&kind==='air'&&(s.upgrades.juggle||0)) s.effects.push({o,launch:false,pop:true,dir:a.dir});
    let waved=0;
    if(finisher&&kind!=='special'&&(s.upgrades.shockwave||0)) {
      for(let e=0xf80;e<0x1280;e+=0x60) if(e!==o&&(r[e]&0x40)&&!(r[e]&4)&&r[e+0x1b]&&near(r,e,o,72,32)) {
        hit(r,e,Math.max(0,r[e+0x1b]-4*s.upgrades.shockwave),HIT.flinch,0xa40+p*0xc0);
        s.effects.push({o:e,launch:false,dir:word(r,e+12)<word(r,o+12)?-1:1}); waved++;
        if(!r[e+0x1b]) defeated(m,p,e,false);
      }
    }
    const text=kind==='heavy'?'SMASH!':launch?'LAUNCHER!':waved?'SHOCKWAVE!':countering&&!scripted?'COUNTER!':kind==='air'?'AIR HIT!':finisher?'CHAIN FINISHER!':`${a.combo} HIT COMBO`;
    if(kind!=='signature') message(m,text);
    if(kind==='heavy') feedback('heavy','SMASH!',p);
    else if(!scripted&&(launch||waved||finisher||countering)) feedback(launch?'launcher':waved?'shockwave':countering?'counter':'finisher',text,p);
    if(!remaining) defeated(m,p,o,kind!=='special');
  }
  function defeated(m,p,o,focus) {
    const s=m.arcadeCombat,a=s.players[p],r=m.ram; s.stage.kos++;
    heal(m,p,2*(s.upgrades.leech||0)); if(focus) a.focus=Math.min(100,a.focus+5);
    if(s.elite[o]) {
      delete s.elite[o]; s.stage.elites++; a.focus=Math.min(100,a.focus+15); message(m,'ELITE DOWN!'); feedback('elite','ELITE DOWN!',p);
      // the elite drops a snack where it fell: plain world-coordinate data, eaten by walking over it
      const kind=random(s)%PICKUP.kinds.length;
      (s.pickups||(s.pickups=[])).push({x:word(r,o+12)+cam(r),z:word(r,o+17),kind,born:m.frame});
    }
  }
  // Stage rank from plain run data; the par time grows with the stage.
  function rate(st,frame) {
    const secs=Math.max(0,Math.round((frame-st.start)/60)), par=150+15*(st.level-1);
    const score=Math.round(60+4*Math.min(st.best,15)+2*Math.min(st.kos,25)+5*st.elites+4*st.counters-2*st.taken-Math.max(0,secs-par)/3);
    return {level:st.level,secs,best:st.best,kos:st.kos,taken:st.taken,elites:st.elites,counters:st.counters,score,rank:score>=110?'S':score>=85?'A':score>=60?'B':'C'};
  }
  function pick(s,pool) {
    let total=0; for(const u of pool) total+=RARITY[u.rarity].weight;
    let n=random(s)%total; for(let i=0;i<pool.length;i++) { n-=RARITY[pool[i].rarity].weight; if(n<0) return pool.splice(i,1)[0]; }
    return pool.pop();
  }
  function draft(m,level) {
    const s=m.arcadeCombat; if(s.offers.length||s.cleared[level]) return;
    s.cleared[level]=true; s.pendingLevel=level; s.results=rate(s.stage,m.frame); s.history.push(s.results);
    const pool=UPGRADES.filter(u=>(s.upgrades[u.id]||0)<u.max), count=s.results.rank==='S'?4:3;
    while(s.offers.length<count&&pool.length) s.offers.push(pick(s,pool).id);
    const fancy=id=>UPGRADES.find(u=>u.id===id).rarity!=='common';
    if('SA'.includes(s.results.rank)&&!s.offers.some(fancy)) {
      const better=pool.filter(u=>u.rarity!=='common');
      if(better.length) s.offers[s.offers.length-1]=pick(s,better).id;
    }
    if(ui) ui.draftAt=now();
  }
  function choose(id) {
    const m=machine,s=m&&m.arcadeCombat; if(!s||!s.offers.includes(id)) return false;
    s.upgrades[id]=(s.upgrades[id]||0)+1;
    for(let p=0;p<4;p++) { if(id==='vitality') heal(m,p,8); if(id==='heal') heal(m,p,255); }
    s.offers=[]; s.pendingLevel=0; queued=[];
    if(G.SSRIN) { G.SSRIN.block=false; for(const k in G.SSRIN.held) G.SSRIN.held[k]=0; G.SSRIN.consumeLatch(); }
    if(ui) ui.gotItem={id,at:now()};
    updateUI(); return true;
  }
  function install(m,options={}) {
    if(!enabled) return;
    machine=m; m.arcadeCombat=create(options.seed===undefined?(Date.now()^m.frame):options.seed);
    m.arcadeCombat.level=LEVELS[m.ram[0x803]]||1; m.arcadeCombat.stage=newStage(m.arcadeCombat.level,m.frame);
    const mw=m.mw;
    m.mw=function(a,value) {
      const s=this.arcadeCombat,r=this.ram;
      if(playing(this)&&LEVELS[r[0x803]]) {
        const o=a-0x4000-0x1b, old=r[o+0x1b], p=player(o);
        if((p>=0||foe(o))&&old>value) {
          const target=a-0x1b, x=this.cpu?.x?.w, u=this.cpu?.u?.w, other=(x===target?u:x)-0x4000;
          const attacker=player(other);
          if(foe(o)&&(r[o]&0x40)&&attacker>=0&&(r[other]&0x40)) {
            const state=s.players[attacker], air=word(r,o+0x16)>4, heavy=m.frame<=state.heavyHitUntil;
            const kind=heavy?'heavy':m.frame<=state.intentUntil?state.intent:'chain', next=m.frame-state.lastHit<=flowWindow(s)?state.combo+1:1;
            let damage=(old-value)*(1+.2*(s.upgrades.power||0));
            if(next>=5) damage*=1+.15*(s.upgrades.momentum||0);
            if(m.frame<=state.counterUntil) damage*=1.5+.25*(s.upgrades.riposte||0);
            if(heavy) damage=damage*1.6*(1+.3*(s.upgrades.steel||0))+3;
            damage=Math.ceil(damage);
            if(next%3===0) damage+=4;
            if(air) damage+=2+2*(s.upgrades.juggle||0);
            value=Math.max(0,old-damage); landed(this,attacker,o,damage,value,air&&!heavy?'air':kind);
            if(heavy&&regular(o)) s.effects.push({o,launch:true,dir:state.dir,power:0x700});
          } else if(p>=0&&foe(other)) {
            const state=s.players[p];
            if(m.frame<state.dodgeUntil) {
              value=old;
              // A real enemy hit landing inside the roll opens a counter window (once per roll).
              if(!state.countered) {
                state.countered=true; state.counterUntil=m.frame+60+30*(s.upgrades.riposte||0); s.stage.counters++;
                state.focus=Math.min(100,state.focus+10); message(this,'PERFECT ROLL - COUNTER!'); feedback('counter','PERFECT ROLL!',p);
              }
            } else {
              let loss=Math.max(1,old-value-(s.upgrades.armor||0));
              if(m.frame<state.armorUntil) loss=Math.max(1,loss>>1);
              value=Math.max(0,old-loss);
            }
            if(value<old) {
              state.combo=0; state.focus=Math.max(0,state.focus-5); s.stage.taken+=old-value;
              // a hit interrupts a wind-up or signature move, except Homer's armored belly bump
              state.heavyAt=-1; state.heavyHitUntil=0; if(m.frame>=state.armorUntil) state.sigAt=-1;
            }
          }
        }
        // Scale or replace the native velocity when it is assigned, so native movement/collision integration remains in use.
        for(let p=0;p<4;p++) {
          const base=0x4a40+p*0xc0, low=a-base, st=s.players[p];
          if(this.frame<st.dodgeUntil) {
            if(low===0) value&=~0x20;
            if(low===0x1e) value=0;
          }
          if(low===0x10&&this.frame<st.vxUntil) { mw.call(this,a-1,(st.vx>>8)&255); value=st.vx&255; continue; }
          if(low===0x15&&this.frame<st.vzUntil) { mw.call(this,a-1,(st.vz>>8)&255); value=st.vz&255; continue; }
          if((low===0x10||low===0x15)&&(s.upgrades.speed||0)&&(r[base-0x4000]&0x40)) {
            const bits=(~this.inputs['P'+(p+1)])&255;
            if((bits&15)&&!(bits&48)) {
              const vel=((r[a-0x4000-1]<<8)|value)<<16>>16;
              if(Math.abs(vel)>=0x80&&Math.abs(vel)<=0x600) {
                const scaled=Math.round(vel*(1+.15*s.upgrades.speed)); mw.call(this,a-1,(scaled>>8)&255); value=scaled&255;
              }
            }
          }
        }
        if(a===0x4803) {
          const from=r[0x803], level=LEVELS[from];
          if(level&&from!==7&&value===from+1) {
            if(level===8) { s.won=true; s.results=rate(s.stage,this.frame); s.history.push(s.results); message(this,'RUN COMPLETE!'); }
            else draft(this,level);
          }
        }
        if(a>=0x4f80&&a<0x5280&&(a-0x4f80)%0x60===0&&value===4) { delete s.enemySeen[a-0x4000]; delete s.elite[a-0x4000]; }
      }
      return mw.call(this,a,value);
    };
    if(G.SSRIN) G.SSRIN.remixPad=true;   // gamepad X/Y become Heavy/Signature instead of extra Attack/Jump
    const video=options.video||(G.SIMPG&&G.SIMPG.video);
    if(video&&m.objectDma) installVideo(m,video);
    if(G.document&&!options.noUI) buildUI();
    afterFrame(m);
  }
  const MOVES=['dodge','roll','special','throw','heavy','signature'];
  function request(move,p=0) { if(enabled&&p>=0&&p<4&&MOVES.includes(move)) queued.push({move:move==='roll'?'dodge':move,p}); }
  // Active-low native input byte for scripted frames: only the given bits are held.
  const hold = bits => 0xff&~bits;
  function setVX(a,f,v,n=1) { a.vx=v; a.vxUntil=f+n; }
  function beforeFrame(m) {
    if(!playing(m)||m.arcadeCombat.offers.length) return;
    if(!LEVELS[m.ram[0x803]]) { queued=[]; return; }
    const s=m.arcadeCombat,r=m.ram;
    for(let p=0;p<4;p++) {
      const a=s.players[p],o=0xa40+p*0xc0,bits=(~m.inputs['P'+(p+1)])&255;
      if(!busy(a,m.frame)) { if(bits&1) a.dir=-1; else if(bits&2) a.dir=1; }
      if((bits&16)&&!(a.lastBits&16)) { a.intent=bits&4?'launcher':word(r,o+0x16)>4?'air':'chain'; a.intentUntil=m.frame+30; }
      a.lastBits=bits; a.heldBits=bits;
      if(m.frame-a.lastHit>flowWindow(s)) a.combo=0;
    }
    const pads=G.navigator?.getGamepads?G.navigator.getGamepads():[];
    // pad n plays slot n, except that the first pad and the chosen character's slot swap (input.js character choice)
    const chosen=G.SSRIN?G.SSRIN.slot:0, padSlot=i=>i===0?chosen:i===chosen?0:i;
    for(let i=0;i<Math.min(4,pads.length);i++) {
      const pad=pads[i],a=s.players[i],p=padSlot(i),b=n=>pad?.connected&&!!pad.buttons[n]?.pressed;
      const buttons=(b(4)||b(6)?1:0)|(b(5)?2:0)|(b(7)?4:0)|(b(2)?8:0)|(b(3)?16:0), edge=buttons&~(a.lastPadButtons||0);
      if(edge&1)queued.push({move:'dodge',p}); if(edge&2)queued.push({move:'special',p}); if(edge&4)queued.push({move:'throw',p});
      if(edge&8)queued.push({move:'heavy',p}); if(edge&16)queued.push({move:'signature',p});
      a.lastPadButtons=buttons;
    }
    for(const action of queued.splice(0)) {
      const a=s.players[action.p],o=0xa40+action.p*0xc0; if(!(r[o]&0x40)||!r[o+0x1b]) continue;
      const f=m.frame;
      if(action.move==='dodge'&&f>=a.dodgeReady&&free(r,o,true)) {
        const held=a.heldBits||0;
        a.rollAt=f; a.rollDir=a.dir; a.rollDz=held&4?1:held&8?-1:0; a.heavyAt=-1; a.heavyHitUntil=0;
        a.dodgeUntil=f+ROLL.inv+4*(s.upgrades.dodge||0); a.dodgeReady=f+Math.max(18,ROLL.cooldown-6*(s.upgrades.dodge||0)); a.countered=false;
        setVX(a,f,a.dir*ROLL.speed,ROLL.frames-2);
        if(a.rollDz) { a.vz=a.rollDz*ROLL.depth; a.vzUntil=f+ROLL.frames-2; }
        message(m,'ROLL!');
      }
      if(action.move==='special'&&a.focus>=burstCost(s)) {
        a.focus-=burstCost(s); m.inputs['P'+(action.p+1)]&=~0x30;
        let hits=0; const reach=88+24*(s.upgrades.burst||0);
        for(let e=0xd40;e<0x1640;e+=0x60) if(live(r,e)&&near(r,e,o,reach,38)) {
          const damage=Math.ceil(8*(1+.2*(s.upgrades.power||0))); hit(r,e,Math.max(0,r[e+0x1b]-damage),HIT.knockdown,o);
          landed(m,action.p,e,damage,r[e+0x1b],'special'); if(regular(e))s.effects.push({o:e,launch:true,dir:a.dir}); hits++;
        }
        message(m,hits?'FOCUS BURST!':'FOCUS BURST - NO TARGETS'); if(hits) feedback('launcher','FOCUS BURST!',action.p);
      }
      if(action.move==='throw'&&f>=(a.throwReady||0)) {
        a.throwReady=f+BALL.cooldown; s.balls=s.balls||[];
        s.balls.push({p:action.p,x:word(r,o+12)+cam(r)+a.dir*14,z:word(r,o+17),dir:a.dir,born:f,hit:[],color:random(s)%BALL.colors});
      }
      if(action.move==='heavy'&&f>=a.heavyReady&&free(r,o)&&!rolling(a,f)&&a.sigAt<0) {
        a.heavyAt=f; a.heavyReady=f+HEAVY.cooldown; a.heavyDir=a.dir;
      }
      if(action.move==='signature'&&f>=a.sigReady&&free(r,o)&&!rolling(a,f)&&a.heavyAt<0) {
        const kind=charOf(r,action.p),sig=SIG[kind];
        a.sigAt=f; a.sigKind=kind; a.sigDir=a.dir; a.sigHit=[]; a.sigReady=f+Math.round(sig.cool*(1-.25*(s.upgrades.encore||0)));
        if(kind==='homer') a.armorUntil=f+sig.frames+4;
        message(m,sig.name+'!'); feedback('signature',sig.name+'!',action.p);
      }
    }
    for(let p=0;p<4;p++) stepMoves(m,p);
    rollBalls(m); flyRocks(m); spreadWaves(m); eatPickups(m);
  }
  const busy = (a,f) => rolling(a,f)||a.heavyAt>=0||a.sigAt>=0;
  // Per-frame scripting of the roll, heavy attack and signature move: native input is replaced for the frames the move
  // owns (so the game's own walk/attack code runs) and velocities go through the native assignment hook in mw.
  function stepMoves(m,p) {
    const s=m.arcadeCombat,r=m.ram,a=s.players[p],o=0xa40+p*0xc0,f=m.frame,P='P'+(p+1);
    if(!(r[o]&0x40)||!r[o+0x1b]) { a.heavyAt=-1; a.sigAt=-1; return; }
    const dirBit=d=>d<0?1:2;
    if(rolling(a,f)) {
      m.inputs[P]=hold(dirBit(a.rollDir)|(a.rollDz>0?4:a.rollDz<0?8:0));
      return;
    }
    if(a.heavyAt>=0) {
      const t=f-a.heavyAt, wind=HEAVY.windup-3*(s.upgrades.steel||0), d=a.heavyDir;
      if(t<wind) { m.inputs[P]=hold(0); setVX(a,f,0); }
      else if(t<wind+HEAVY.dash) { m.inputs[P]=hold(dirBit(d)); setVX(a,f,d*HEAVY.dashSpeed); }
      else if(t<wind+HEAVY.dash+HEAVY.press) { m.inputs[P]=hold(16); a.heavyHitUntil=f+HEAVY.window; }
      else if(t>=wind+HEAVY.dash+HEAVY.window) a.heavyAt=-1;   // in between, the player's own input drives the native attack
      return;
    }
    if(a.sigAt>=0) {
      const t=f-a.sigAt, kind=a.sigKind, d=a.sigDir, sig=SIG[kind];
      if(t>=sig.frames) { a.sigAt=-1; return; }
      if(kind==='homer') {
        m.inputs[P]=hold(dirBit(d)); setVX(a,f,d*0x700);
        for(let e=0xd40;e<0x1640;e+=0x60) if(live(r,e)&&!a.sigHit.includes(e)&&Math.abs(word(r,e+12)-word(r,o+12))<30&&Math.abs(word(r,e+17)-word(r,o+17))<14) {
          a.sigHit.push(e); strike(m,p,e,8,'signature',HIT.knockdown,d);
          if(a.sigHit.length===1) feedback('heavy',null,p);
        }
        return;
      }
      m.inputs[P]=hold(0); setVX(a,f,0);
      const rel=e=>({dx:(word(r,e+12)-word(r,o+12))*d,dz:word(r,e+17)-word(r,o+17)});
      if(kind==='marge') {
        if(t<30) {
          // suction: every enemy in the cone in front slides toward the nozzle
          for(let e=0xd40;e<0x1640;e+=0x60) if(live(r,e)) { const q=rel(e); if(q.dx>18&&q.dx<132&&Math.abs(q.dz)<26) put(r,e+12,word(r,e+12)-d*2); }
        } else if(t===30) {
          let n=0; for(let e=0xd40;e<0x1640;e+=0x60) if(live(r,e)) { const q=rel(e); if(q.dx>-6&&q.dx<136&&Math.abs(q.dz)<28) { strike(m,p,e,7,'signature',HIT.knockdown,d); n++; } }
          if(n) feedback('launcher','BLOW OUT!',p);
        }
      }
      if(kind==='bart'&&(t===6||t===12||t===18)) (s.rocks||(s.rocks=[])).push({p,x:word(r,o+12)+cam(r)+d*16,z:word(r,o+17),dir:d,born:f,last:t===18});
      if(kind==='lisa'&&t%9===0&&t<40) (s.waves||(s.waves=[])).push({p,x:word(r,o+12)+cam(r)+d*12,z:word(r,o+17),dir:d,born:f,hit:[],last:t>=36});
    }
  }
  function rollBalls(m) {
    const s=m.arcadeCombat,r=m.ram,c=cam(r); if(!s.balls||!s.balls.length) return;
    s.balls=s.balls.filter(b=>{
      b.x+=b.dir*BALL.speed;
      const o=0xa40+b.p*0xc0, sx=b.x-c-54;
      for(let e=0xd40;e<0x1640;e+=0x60) {
        if(!live(r,e)||b.hit.includes(e)) continue;
        if(Math.abs(word(r,e+12)+c-b.x)>=BALL.reachX||Math.abs(word(r,e+17)-b.z)>=BALL.reachZ) continue;
        const damage=Math.ceil(BALL.damage*(1+.2*(s.upgrades.power||0)));
        hit(r,e,Math.max(0,r[e+0x1b]-damage),HIT.knockdown,o);
        b.hit.push(e); landed(m,b.p,e,damage,r[e+0x1b],'ball'); if(regular(e)) s.effects.push({o:e,launch:false,dir:b.dir});
        if(b.hit.length===3) { message(m,'STRIKE!'); feedback('strike','STRIKE!',b.p); }
      }
      return m.frame-b.born<BALL.life&&sx>-40&&sx<360;
    });
  }
  // Bart's slingshot rocks: fast, each stops at the first enemy it hits; the third rock knocks down.
  function flyRocks(m) {
    const s=m.arcadeCombat,r=m.ram,c=cam(r); if(!s.rocks||!s.rocks.length) return;
    s.rocks=s.rocks.filter(k=>{
      k.x+=k.dir*9; const sx=k.x-c-54;
      for(let e=0xd40;e<0x1640;e+=0x60) if(live(r,e)&&Math.abs(word(r,e+12)+c-k.x)<11&&Math.abs(word(r,e+17)-k.z)<14) {
        strike(m,k.p,e,k.last?6:4,'signature',k.last?HIT.knockdown:HIT.flinch,k.dir); return false;
      }
      return m.frame-k.born<48&&sx>-20&&sx<340;
    });
  }
  // Lisa's sax: each wave is a growing ring in front of her that stuns every enemy it passes once.
  function spreadWaves(m) {
    const s=m.arcadeCombat,r=m.ram,c=cam(r); if(!s.waves||!s.waves.length) return;
    s.waves=s.waves.filter(w=>{
      const rad=(m.frame-w.born)*4;
      for(let e=0xd40;e<0x1640;e+=0x60) if(live(r,e)&&!w.hit.includes(e)) {
        const dx=(word(r,e+12)+c-w.x)*w.dir, dz=word(r,e+17)-w.z;
        if(dx>-6&&dx>rad-10&&dx<rad+6&&Math.abs(dz)<28) { w.hit.push(e); strike(m,w.p,e,w.last?5:3,'signature',w.last?HIT.knockdown:HIT.flinch,w.dir); }
      }
      return rad<118;
    });
  }
  function eatPickups(m) {
    const s=m.arcadeCombat,r=m.ram,c=cam(r); if(!s.pickups||!s.pickups.length) return;
    s.pickups=s.pickups.filter(k=>{
      for(let p=0;p<4;p++) {
        const o=0xa40+p*0xc0; if(!(r[o]&0x40)||!r[o+0x1b]) continue;
        if(Math.abs(word(r,o+12)+c-k.x)<PICKUP.reachX&&Math.abs(word(r,o+17)-k.z)<PICKUP.reachZ) {
          const kind=PICKUP.kinds[k.kind], a=s.players[p];
          heal(m,p,kind.heal); a.focus=Math.min(100,a.focus+kind.focus); message(m,kind.name); feedback('elite',kind.name,p); return false;
        }
      }
      return m.frame-k.born<PICKUP.life;
    });
  }
  function afterFrame(m) {
    if(!enabled||!m.arcadeCombat) return;
    const s=m.arcadeCombat,r=m.ram,live=r[0x800]===2;
    if(s.wasGame&&!live) { m.arcadeCombat=create(s.rng^m.frame); updateUI(); return; }
    s.wasGame=live;
    if(!playing(m)) return;
    s.level=LEVELS[r[0x803]]||s.level;
    if(LEVELS[r[0x803]]) {
    if(s.stage.level!==s.level) { s.stage=newStage(s.level,m.frame); s.pickups=[]; }
    for(let p=0;p<4;p++) {
      const a=s.players[p],o=0xa40+p*0xc0,active=!!(r[o]&0x40);
      if(active&&!a.active&&(s.upgrades.vitality||0)) heal(m,p,8*s.upgrades.vitality);
      a.active=active;
    }
    for(let o=0xf80;o<0x1280;o+=0x60) {
      if(!(r[o]&0x80)) { delete s.enemySeen[o]; delete s.elite[o]; continue; }
      if(!s.enemySeen[o]&&r[o+4]===0x80&&r[o+0x1b]>0) {
        let hp=Math.max(r[o+0x1b],Math.min(32,12+2*(s.level-1)));
        // Elites appear from stage 2 on: more native health, and a snack drop when defeated.
        if(s.level>=2&&random(s)%100<8+4*s.level) { hp=Math.min(56,Math.round(hp*1.6)); s.elite[o]=true; message(m,'ELITE ENEMY!'); }
        r[o+0x1b]=hp; s.enemySeen[o]=true;
      }
    }
    for(const e of s.effects.splice(0)) if(r[e.o]&0x80) {
      put(r,e.o+0x0f,e.dir*(e.power||0x400));
      if(e.launch) { put(r,e.o+0x16,Math.max(12,word(r,e.o+0x16))); put(r,e.o+0x19,0x500); }
      else if(e.pop) put(r,e.o+0x19,Math.max(0x300,word(r,e.o+0x19)));
    }
    } else { s.effects=[]; s.balls=[]; s.rocks=[]; s.waves=[]; }
    // The draft holds the game (SIMPCOMBAT.blocked) and is drawn inside the picture; local input goes to the cards.
    if(s.offers.length&&G.SSRIN&&!G.SSRIN.block) G.SSRIN.block=true;
    updateUI();
  }

  // ---------- sprite effects in the native video pipeline: while a player rolls, winds up or uses a signature move,
  // their native sprites are drawn into a scratch buffer and composited back rotated, leaned, scaled or flashing, with
  // afterimages. Palette indices stay native (plus one 16-pen effects palette), so the CRT and palette fades still apply.
  const FX_PAL=['000000','ffffff','fff4b0','ffd820','ff9020','e83030','70e8ff','3080f0','d8d0c8','908880','484050','60d850','ff90c0','b070f0','a06030','100c14'];
  const FXP={white:1,cream:2,yellow:3,orange:4,red:5,cyan:6,blue:7,grey:9};
  function transformFor(m,p) {
    const s=m.arcadeCombat; if(!s||!playing(m)) return null;
    const a=s.players[p],f=m.frame,r=m.ram,o=0xa40+p*0xc0; if(!(r[o]&0x40)) return null;
    if(rolling(a,f)) {
      const t=f-a.rollAt, n=ROLL.frames, d=a.rollDir;
      if(t<2||t>=n-2) return {rot:0,kx:1.05,ky:.82,pivot:'feet',ghosts:[]};
      const turn=(t-2)/(n-4);
      return {rot:d*Math.PI*2*turn,kx:.86,ky:.86,pivot:'roll',ghosts:[{dx:-d*9,pen:FXP.cyan},{dx:-d*17,pen:FXP.blue}],shadow:true};
    }
    if(a.heavyAt>=0) {
      const t=f-a.heavyAt, wind=HEAVY.windup-3*(s.upgrades.steel||0), d=a.heavyDir;
      if(t<wind) return {rot:-d*.16*Math.min(1,t/4),kx:1,ky:1,pivot:'feet',tint:t>=wind-4&&t%2===0?FXP.white:0,ghosts:[]};
      if(t<wind+HEAVY.dash+HEAVY.press) return {rot:d*.14,kx:1.04,ky:1,pivot:'feet',ghosts:[{dx:-d*10,pen:FXP.orange},{dx:-d*20,pen:FXP.red}]};
      return null;
    }
    if(a.sigAt>=0) {
      const t=f-a.sigAt, d=a.sigDir;
      if(a.sigKind==='homer') return {rot:d*.22,kx:1.12,ky:1.06,pivot:'feet',ghosts:[{dx:-d*10,pen:FXP.yellow},{dx:-d*20,pen:FXP.orange}],tint:t<2?FXP.white:0};
      if(a.sigKind==='marge') return t<30?{rot:d*.07+.02*Math.sin(t*1.7),kx:1,ky:1,pivot:'feet',ghosts:[]}:{rot:-d*.12,kx:1,ky:1,pivot:'feet',ghosts:[],tint:t<33?FXP.white:0};
      if(a.sigKind==='bart') return {rot:[6,12,18].some(k=>t>=k&&t<k+3)?-d*.12:d*.03,kx:1,ky:1,pivot:'feet',ghosts:[]};
      if(a.sigKind==='lisa') return {rot:.06*Math.sin(t*.45),kx:1,ky:1,pivot:'feet',ghosts:[]};
    }
    return null;
  }
  function installVideo(m,v) {
    const pal=[]; for(const h of FX_PAL){const c=[0,2,4].map(i=>parseInt(h.substr(i,2),16)>>3),w=c[0]|(c[1]<<5)|(c[2]<<10);pal.push(w>>8,w&255);}
    const palettes=v.customPalettes||(v.customPalettes=[]), penBase=4096+palettes.length*16; palettes.push(pal);
    const pens=new Uint32Array(Math.max(v.pens.length,4096+palettes.length*16)); pens.set(v.pens); v.pens=pens;
    const W=320, owner=new Int8Array(256).fill(-1), xf=[null,null,null,null];
    const scratch=[0,1,2,3].map(()=>({bmp:new Uint16Array(v.bmp.length),pri:new Uint8Array(v.pri.length),priSnap:new Uint8Array(v.pri.length),pmask:0,used:false}));
    const dma=m.objectDma;
    m.objectDma=function() {
      owner.fill(-1); let any=false;
      for(let p=0;p<4;p++) { xf[p]=transformFor(this,p); if(xf[p]) any=true; }
      if(any) {
        const r=this.ram, start=[0,1,2,3].map(p=>{const o=0xa40+p*0xc0,st=(((r[o+0x59]<<8)|r[o+0x5a])-0x2000)/16;return xf[p]&&(r[o]&0xc0)&&Number.isInteger(st)&&st>=0&&st<256?st:-99;});
        let compact=0;
        for(let i=0;i<256;i++) { const w=this.spr[i*8]; if(!(w&0x8000)||!(w&255)) continue; for(let p=0;p<4;p++) if(i>=start[p]&&i<start[p]+8) owner[compact]=p; compact++; }
      }
      return dma.apply(this,arguments);
    };
    let realBmp=null, realPri=null, cur=-1;
    const restore=view=>{ if(cur>=0&&realBmp){ view.bmp=realBmp; view.pri=realPri; } cur=-1; };
    const prior=v.spriteOverride;
    v.spriteOverride=function(view,offs,pmask,first) {
      if(first) { restore(view); realBmp=view.bmp; realPri=view.pri; for(let p=0;p<4;p++) if(xf[p]) { scratch[p].pri.fill(0); scratch[p].used=false; } }
      const p=owner[offs>>3], want=p>=0&&xf[p]?p:-1;
      if(want!==cur) {
        restore(view);
        if(want>=0) {
          const S=scratch[want];
          // the priority picture as it is when this player's sprites start: objects already drawn are in front of the
          // player; objects drawn later (behind) are not in the snapshot, so the composited player covers them
          if(!S.used) { S.priSnap.set(realPri); S.pmask=pmask; }
          view.bmp=S.bmp; view.pri=S.pri; S.used=true; cur=want;
        }
      }
      return prior?prior(view,offs,pmask,first):false;
    };
    const after=v.afterSprites;
    v.afterSprites=function(view) {
      restore(view);
      for(let p=0;p<4;p++) if(xf[p]&&scratch[p].used) composite(view,scratch[p],xf[p],penBase);
      if(after) after(view);
    };
    v.combatFx={penBase,owner,transforms:xf,box:p=>scratch[p].lastBox||null};
  }
  function composite(view,S,X,penBase) {
    const W=320, pri=S.pri, bmp=S.bmp, rows=pri.length/W; let x0=W,y0=rows,x1=-1,y1=-1;
    for(let y=16;y<rows;y++) { const row=y*W; for(let x=0;x<W;x++) if(pri[row+x]===31) { if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; y1=y; } }
    if(x1<0) return;
    const w=x1-x0+1, h=y1-y0+1, px=(x0+x1)/2, py=X.pivot==='feet'?y1:(y0+y1)/2, c=Math.cos(X.rot), s=Math.sin(X.rot), kx=X.kx||1, ky=X.ky||1;
    let dy=py;
    if(X.pivot==='roll') {   // rest the lowest rotated pixel of the real figure (not its bounding box) on the floor line
      let low=-1e9; for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) if(pri[y*W+x]===31) { const o=ky*(s*(x-px)+c*(y-py)); if(o>low) low=o; }
      dy=y1-low;
    }
    const R=Math.ceil(Math.hypot(w*kx,h*ky))+2;
    const vb=view.bmp, vp=view.pri, snap=S.priSnap||vp, mask=S.pmask|(1<<31), mine=new Uint8Array(W*rows);
    if(X.shadow) for(let x=Math.round(px-w*.35);x<=Math.round(px+w*.35);x++) for(const y of [y1-1,y1]) {
      if(x<0||x>=W) continue; const i=y*W+x, c0=vb[i]; if(c0<2048&&!(vp[i]&0x80)&&snap[i]!==31) { vb[i]=c0+2048; vp[i]|=0x80; }
    }
    // the figure first, then afterimages only where the figure is not (they trail behind it)
    const draw=(ox,pen,checker)=>{
      for(let Y=Math.max(16,Math.floor(dy-R));Y<=Math.min(rows-1,Math.ceil(dy+R));Y++) for(let Xd=Math.max(0,Math.floor(px+ox-R));Xd<=Math.min(W-1,Math.ceil(px+ox+R));Xd++) {
        if(checker&&((Xd+Y)&1)) continue;
        const u=(Xd-px-ox)/kx, vv=(Y-dy)/ky, sx=Math.round(px+c*u+s*vv), sy=Math.round(py-s*u+c*vv);
        if(sx<x0||sx>x1||sy<y0||sy>y1) continue;
        const si=sy*W+sx; if(pri[si]!==31) continue;
        const i=Y*W+Xd; if(mine[i]||((1<<(snap[i]&31))&mask)!==0) continue;
        vb[i]=pen?penBase+pen:bmp[si]; vp[i]=31; mine[i]=1;
      }
    };
    draw(0,X.tint||0,false);
    let ox0=W,ox1=-1,oy0=rows,oy1=-1; for(let i=0;i<mine.length;i++) if(mine[i]) { const x=i%W,y=(i/W)|0; if(x<ox0)ox0=x; if(x>ox1)ox1=x; if(y<oy0)oy0=y; if(y>oy1)oy1=y; }
    S.lastBox={w,h,outW:ox1-ox0+1,outH:oy1-oy0+1,bottom:oy1,floor:y1};
    for(const g of X.ghosts||[]) draw(g.dx,g.pen,true);
  }

  // ---------- in-game presentation: drawn into the finished 320x224 frame by game.js (SIMPCOMBAT.drawOverlay) so it
  // scales and gets the CRT treatment with the game. Headings use the arcade's own 8x8 font read from the tile ROM
  // (no ROM data in this file); small print uses a 3x5 pixel font. Never board state.
  const SW=320, SH=224, STRIP_Y=31, SCREEN_HINT_FRAMES=420;
  const GLYPHS={'A':'.#.#.#####.##.#','B':'##.#.###.#.###.','C':'.###..#..#...##','D':'##.#.##.##.###.','E':'####..##.#..###','F':'####..##.#..#..','G':'.###..#.##.#.##','H':'#.##.#####.##.#','I':'###.#..#..#.###','J':'..#..#..##.#.#.','K':'#.##.###.#.##.#','L':'#..#..#..#..###','M':'#.########.##.#','N':'##.#.##.##.##.#','O':'.#.#.##.##.#.#.','P':'##.#.###.#..#..','Q':'.#.#.##.###..##','R':'##.#.###.#.##.#','S':'.###...#...###.','T':'###.#..#..#..#.','U':'#.##.##.##.####','V':'#.##.##.##.#.#.','W':'#.##.########.#','X':'#.##.#.#.#.##.#','Y':'#.##.#.#..#..#.','Z':'###..#.#.#..###','0':'####.##.##.####','1':'.#.##..#..#.###','2':'##...#.#.#..###','3':'##...#.#...###.','4':'#.##.####..#..#','5':'####..##...###.','6':'.###..####.####','7':'###..#.#..#..#.','8':'####.#####.####','9':'####.####..###.','.':'.............#.',',':'..........#.#..',':':'....#.....#....','!':'.#..#..#.....#.','?':'##...#.#.....#.','+':'....#.###.#....','-':'......###......','%':'#....#.#.#....#','/':'..#..#.#.#..#..',"'":'.#..#..........','(':'.#.#..#..#...#.',')':'.#...#..#..#.#.','x':'...#.#.#.#.#...','<':'..#.#.#...#...#','>':'#...#...#.#.#..','^':'.#.###.#..#..#.','v':'......#.##.#.#.','*':'.......#.......','#':'#.#####.#####.#','&':'.#.#.#.#.#.#.##',' ':'...............'};
  // 7x7 punctuation for the 8x8 arcade font (the ROM's bold font has letters and digits only)
  const PUNCT8={'!':['..##...','..##...','..##...','..##...','.......','..##...','..##...'],'?':['.####..','##..##.','...##..','..##...','.......','..##...','..##...'],
    '.':['.......','.......','.......','.......','.......','.##....','.##....'],',':['.......','.......','.......','.......','.##....','.##....','##.....'],
    ':':['.......','.##....','.##....','.......','.##....','.##....','.......'],'-':['.......','.......','.......','######.','.......','.......','.......'],
    '+':['.......','..##...','..##...','######.','..##...','..##...','.......'],'/':['.....##','....##.','...##..','..##...','.##....','##.....','.......'],
    "'":['..##...','..##...','.##....','.......','.......','.......','.......'],'%':['##...##','##..##.','...##..','..##...','.##....','##..##.','#...##.'],
    'x':['.......','##...##','.##.##.','..###..','.##.##.','##...##','.......'],'&':['.###...','##.##..','.###...','.###.##','##.###.','##..##.','.###.##'],
    '^':['...#...','..###..','.##.##.','##...##','.......','.......','.......'],'*':['.......','.#.#.#.','..###..','#######','..###..','.#.#.#.','.......'],
    '(':['...##..','..##...','.##....','.##....','.##....','..##...','...##..'],')':['.##....','..##...','...##..','...##..','...##..','..##...','.##....'],
    '#':['.##.##.','#######','.##.##.','.##.##.','#######','.##.##.','.......'],'<':['...##..','..##...','.##....','##.....','.##....','..##...','...##..'],
    '>':['.##....','..##...','...##..','....##.','...##..','..##...','.##....'],'$':['..##...','.#####.','##.....','.####..','....##.','#####..','..##...'],' ':['.......','.......','.......','.......','.......','.......','.......']};
  let FONT8=null;
  function font8() {
    if(FONT8!==null) return FONT8;
    const v=G.SIMPG&&G.SIMPG.video; if(!v||!v.tiles) return null;
    const out={}, from=(t)=>{const g=[];for(let y=0;y<8;y++){let row='';for(let x=0;x<8;x++)row+=v.tiles[(t<<6)|(y<<3)|x]?'#':'.';g.push(row);}return g;};
    for(let i=0;i<26;i++) out[String.fromCharCode(65+i)]=from(0x170+i);
    for(let i=0;i<10;i++) out[String(i)]=from(0x162+i);
    // sanity check: a real font has an empty bottom row and a filled 'A'; otherwise fall back to the small font
    if(out.A[7]!=='........'||!out.A.join('').includes('#')||!out['0'].join('').includes('#')) return (FONT8=false);
    for(const [k,g] of Object.entries(PUNCT8)) out[k]=g.map(r=>r+'.').concat(['........']);
    return (FONT8=out);
  }
  const rgb=(r,g,b)=>(0xff000000|(b<<16)|(g<<8)|r)>>>0;
  const COL={ink:rgb(14,10,20),gold:rgb(255,204,72),white:rgb(255,246,226),cyan:rgb(110,232,255),purple:rgb(222,140,255),blue:rgb(96,176,255),
    orange:rgb(255,146,40),red:rgb(244,72,60),green:rgb(116,224,92),grey:rgb(168,156,140),panel:rgb(34,22,14),panel2:rgb(60,40,24),dim:rgb(96,84,72),
    yellow:rgb(255,216,32),pink:rgb(255,144,192),brown:rgb(160,96,48),dark:rgb(72,64,80),light:rgb(216,208,200),sky:rgb(112,200,255)};
  const RCOL={common:COL.gold,rare:COL.blue,epic:COL.purple}, RANKCOL={S:COL.cyan,A:COL.gold,B:COL.green,C:COL.grey};
  const KCOL={counter:COL.cyan,shockwave:COL.purple,launcher:COL.orange,elite:COL.red,finisher:COL.gold,strike:COL.cyan,heavy:COL.orange,signature:COL.yellow};
  // native score-panel colours (P1 Marge red, P2 Homer blue, P3 Bart green, P4 Lisa orange)
  const PCOL=[rgb(232,56,72),rgb(64,136,248),rgb(72,200,88),rgb(248,168,40)];
  // 12x12 item pictures. k ink, w white, y yellow, o orange, r red, p pink, b blue, c cyan, g green, n brown, l light grey, d dark grey, u purple, s sky
  const ICONS={
    cola:['...kkkkkk...','..klllllk...','..krrrrrrk..','..krwrrrrk..','..krwyyyrk..','..krwyrrrk..','..krwyyyrk..','..krwrrrrk..','..krrrrrrk..','..krrrrrrk..','..kllllllk..','...kkkkkk...'],
    pads:['..kkkkkkkk..','.kbbbbbbbbk.','.kbwwbbbbbk.','.kbwbbbbbbk.','.kbbbbbbbbk.','.kbbbkkbbbk.','.kbbkcckbbk.','..kbbkkbbk..','..kbbbbbbk..','...kbbbbk...','....kbbk....','.....kk.....'],
    donut:['....kkkk....','..kkppppkk..','.kpwppypppk.','.kpppkkpupk.','kppykk.kkppk','kpbk....kprk','kppk....kpgk','kpwkk..kkppk','.kpppkkppyk.','.knpppppppk.','..kknnnnkk..','....kkkk....'],
    burger:['............','...kkkkkk...','..koowoook..','.kooooowoook','.kowoooooook','.kkkkkkkkkk.','kggggggggggk','.krrrrrrrrk.','.knnnnnnnnk.','.koooooooook','..kkkkkkkkk.','............'],
    board:['............','............','............','.kkkkkkkkkk.','krrrrrrrrrrk','krywyrrywyrk','kkkkkkkkkkkk','..kdk..kdk..','..kkk..kkk..','............','............','............'],
    comic:['.kkkkkkkkkk.','.kyyyyyyyyk.','.kyrrkrrryk.','.kyyyyyyyyk.','.kwwwwkbbbk.','.kwrrwkbwbk.','.kwrrwkbbbk.','.kwwwwkbbbk.','.kkkkkkkkkk.','.kggggggggk.','.kgwwggwwgk.','.kkkkkkkkkk.'],
    squishee:['.....kk.....','....krrk....','...kkrkkk...','..kccccccck.','..kcwccccck.','..kccccscck.','..kkkkkkkkk.','..kbbbbbbbk.','..kbwbbbbbk.','...kbbbbbk..','...kbbbbbk..','....kkkkk...'],
    skates:['............','..kkkk......','..kpppk.....','..kpwpk.....','..kpppkkkk..','..kppppppk..','.kpppppppkk.','.kwwwwwwwwk.','.kkkkkkkkkk.','..kdk..kdk..','..kkk..kkk..','............'],
    boot:['............','..kkkkk.....','..knnnk.....','..knwnk.....','..knnnk.....','..knnnkkkk..','..knnnnnnkk.','.knnnnnnnnk.','.klllnnnnnk.','.klllkkkkkk.','.kkkkk......','............'],
    turkey:['............','....kkkk....','..kknnnnkk..','.knnwnnnnnk.','.knnnnnnnnk.','.knnnnnnnnkk','kkkkkkkkkkkw','klllllllllkw','.kllllllllk.','..kkkkkkkk..','............','............'],
    candy:['............','.kk......kk.','krpk....kprk','krppkkkkpprk','.kppprrrppk.','..kpwrrrpk..','..kprrrrpk..','.kppprrrppk.','krppkkkkpprk','krpk....kprk','.kk......kk.','............'],
    pin:['.....kk.....','....kwwk....','....kwwk....','....kwwk....','....krrk....','....kwwk....','...kwwwwk...','..kwwwwwwk..','..kwwwwwwk..','..kwwwwwwk..','...kwwwwk...','....kkkk....'],
    glove:['............','...kkkkk....','..krrrrrkk..','.krwrrrrrrk.','.krrrrrrrrk.','.krrrrrrrrk.','.kkrrrrrrrk.','krrkrrrrrk..','krrrkrrrk...','.kkkwwwwk...','...kwwwwk...','...kkkkkk...'],
    clover:['............','..kkk.kkk...','.kgggkgggk..','.kgwgkgggk..','..kgggggk...','.kkgggggkk..','kgggkgkgggk.','kgggk.kgggk.','.kkk.k.kkk..','.....k......','.....k......','............'],
    rod:['.....kk.....','....kggk....','...kgwggk...','...kgwggk...','...kggggk...','...kggggk...','...kggggk...','...kggggk...','...kggggk...','...kggggk...','....kggk....','.....kk.....'],
    battery:['....kkkk....','....klllk...','..kkkkkkkk..','..kyyyyyyk..','..kywyyyyk..','..kyykkyyk..','..kykyykyk..','..kyyyyyyk..','..kddddddk..','..kddddddk..','..kddddddk..','..kkkkkkkk..'],
  };
  const ICOL={k:COL.ink,w:COL.white,y:COL.yellow,o:COL.orange,r:COL.red,p:COL.pink,b:COL.blue,c:COL.cyan,g:COL.green,n:COL.brown,l:COL.light,d:COL.dark,u:COL.purple,s:COL.sky};
  const BALLCOL=[[rgb(220,40,60),rgb(130,16,34),rgb(255,150,160)],[rgb(40,96,230),rgb(18,46,130),rgb(150,190,255)],[rgb(40,176,96),rgb(16,96,48),rgb(150,240,180)],
    [rgb(250,170,30),rgb(160,90,10),rgb(255,230,150)],[rgb(150,60,210),rgb(80,24,120),rgb(220,170,255)]];
  const clean=t=>String(t).toUpperCase().replace(/[—–]/g,'-').replace(/[·•]/g,'*').replace(/×/g,'x').replace(/↑/g,'^');
  function dot(px,x,y,c){x|=0;y|=0;if(x>=0&&x<SW&&y>=0&&y<SH)px[y*SW+x]=c;}
  function fill(px,x,y,w,h,c){x|=0;y|=0;const x0=Math.max(0,x),y0=Math.max(0,y),x1=Math.min(SW,x+w),y1=Math.min(SH,y+h);for(let j=y0;j<y1;j++)px.fill(c,j*SW+x0,j*SW+x1);}
  function shade(px,x,y,w,h){const x0=Math.max(0,x|0),y0=Math.max(0,y|0),x1=Math.min(SW,(x+w)|0),y1=Math.min(SH,(y+h)|0);for(let j=y0;j<y1;j++)for(let i=j*SW+x0,e=j*SW+x1;i<e;i++){const c=px[i];px[i]=(0xff000000|((c>>>2)&0x3f3f3f)+((c>>>3)&0x1f1f1f))>>>0;}}
  function box(px,x,y,w,h,border,bg){fill(px,x-1,y-1,w+2,h+2,COL.ink);fill(px,x,y,w,h,border);if(bg!==undefined)fill(px,x+2,y+2,w-4,h-4,bg);}
  const tw=(t,k=1)=>clean(t).length*4*k-k;
  function glyphs(px,x,y,t,c,k){
    for(const ch of clean(t)){const g=GLYPHS[ch]||GLYPHS[' '];for(let i=0;i<15;i++)if(g[i]==='#')fill(px,x+(i%3)*k,y+((i/3)|0)*k,k,k,c);x+=4*k;}
  }
  function text(px,x,y,t,c,k=1,outline=true){
    if(outline)for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[1,-1],[-1,1]])glyphs(px,x+dx,y+dy,t,COL.ink,k);
    glyphs(px,x,y,t,c,k);
  }
  const center=(px,y,t,c,k=1)=>text(px,((SW-tw(t,k))/2)|0,y,t,c,k);
  // Arcade font: 8 px advance per character at k=1, ink outline plus a drop shadow like the game's own captions.
  const tw8=(t,k=1)=>font8()?clean(t).length*8*k-k:tw(t,k*2);
  function glyphs8(px,x,y,t,c,k){const F=font8();for(const ch of clean(t)){const g=F[ch]||F[' '];if(g)for(let j=0;j<8;j++)for(let i=0;i<8;i++)if(g[j][i]==='#')fill(px,x+i*k,y+j*k,k,k,c);x+=8*k;}}
  function text8(px,x,y,t,c,k=1){
    if(!font8()) return text(px,x,y,t,c,k*2);
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[1,-1],[-1,1],[2,2],[1,2],[2,1]])glyphs8(px,x+dx,y+dy,t,COL.ink,k);
    glyphs8(px,x,y,t,c,k);
  }
  const center8=(px,y,t,c,k=1)=>text8(px,((SW-tw8(t,k))/2)|0,y,t,c,k);
  function icon(px,x,y,id,k=1){const g=ICONS[id];if(!g)return;for(let j=0;j<12;j++)for(let i=0;i<12;i++){const c=ICOL[g[j][i]];if(c)fill(px,x+i*k,y+j*k,k,k,c);}}
  function wrap(t,n){const out=[];let line='';for(const w of clean(t).split(' ')){if(line&&(line+' '+w).length>n){out.push(line);line=w;}else line=line?line+' '+w:w;}if(line)out.push(line);return out;}
  const blink=(t,ms=500)=>Math.floor(t/ms)%2===0;
  function playerPos(r,p){const o=0xa40+p*0xc0;return {x:word(r,o+0xc)-54,feet:374-word(r,o+0x11)-r[o+0x17]};}
  function objPos(r,o){return {x:word(r,o+0xc)-54,feet:374-word(r,o+0x11)-r[o+0x17]};}
  function drawStrip(px,s,r,t){
    for(let p=0;p<4;p++){
      const o=0xa40+p*0xc0; if(!(r[o]&0x40)) continue;
      // one strip under each native player panel (panels span x 20..300, ~70 px each), framed in the panel's colour
      const a=s.players[p],x=21+Math.round(p*70.25),y=STRIP_Y,cost=burstCost(s),M=22,f=machine.frame;
      shade(px,x-1,y-1,69,9); fill(px,x-1,y+8,69,1,PCOL[p]);
      text(px,x+1,y+1,'F',COL.white,1,false);
      fill(px,x+6,y+1,M+2,5,COL.ink);fill(px,x+7,y+2,M,3,COL.dim);
      fill(px,x+7,y+2,Math.round(M*a.focus/100),3,a.focus>=cost?(a.focus>=100&&blink(t,200)?COL.white:COL.gold):COL.orange);
      fill(px,x+7+Math.round(M*cost/100),y+1,1,5,COL.white);
      // signature pip: fills while recharging, flashes when ready
      const sig=SIG[charOf(r,p)], left=Math.max(0,a.sigReady-f), full=Math.round(sig.cool*(1-.25*(s.upgrades.encore||0)));
      const sx=x+32; fill(px,sx,y,7,7,COL.ink); fill(px,sx+1,y+1,5,5,COL.dim);
      const h=left?Math.round(5*(1-left/full)):5; fill(px,sx+1,y+6-h,5,h,left?COL.blue:(blink(t,300)?COL.white:COL.cyan));
      const tx=x+41;
      if(f<=a.counterUntil){ if(blink(t,150)) text(px,tx,y+1,'COUNTER',COL.cyan,1,false); }
      else if(a.combo>=2) text(px,tx,y+1,a.combo+' HIT',a.combo>=10?COL.red:COL.gold,1,false);
      else if(!left) text(px,tx,y+1,'SIG OK',COL.cyan,1,false);
    }
  }
  function drawBalls(px,s,r){
    const c=cam(r), R=6;
    for(const b of s.balls||[]){
      const age=machine.frame-b.born, sx=Math.round(b.x-c-54), feet=374-b.z, hop=Math.round(Math.abs(Math.sin(age*0.35))*Math.max(0,8-age*0.25));
      const [base,dark,light]=BALLCOL[b.color%BALLCOL.length], cy=feet-R-hop;
      for(let y=-1;y<=1;y++)for(let x=-R+Math.abs(y)*2;x<=R-Math.abs(y)*2;x++){const X=sx+x,Y=feet+y;if(X>=0&&X<SW&&Y>=0&&Y<SH)px[Y*SW+X]=(0xff000000|((px[Y*SW+X]>>>1)&0x7f7f7f))>>>0;}
      for(let y=-R-1;y<=R+1;y++)for(let x=-R-1;x<=R+1;x++){
        const d=x*x+y*y, X=sx+x, Y=cy+y; if(X<0||X>=SW||Y<0||Y>=SH) continue;
        if(d<=(R+1)*(R+1)&&d>R*R) px[Y*SW+X]=COL.ink;
        else if(d<=R*R) px[Y*SW+X]=x+y>4?dark:base;
      }
      fill(px,sx-3,cy-4,2,2,light); fill(px,sx-4,cy-2,1,1,light);
      const a=age*b.dir*0.45;
      for(const k of [0,0.55,-0.55]){const hx=Math.round(sx+Math.cos(a+k)*2.6),hy=Math.round(cy-1+Math.sin(a+k)*2.6);fill(px,hx,hy,k?1:2,k?1:2,COL.ink);}
    }
  }
  function floorShadow(px,x,y,w){for(let i=-w;i<=w;i++)for(const j of [0,1]){const X=x+i,Y=y+j;if(X>=0&&X<SW&&Y>=0&&Y<SH&&(Math.abs(i)<w-1||j===0))px[Y*SW+X]=(0xff000000|((px[Y*SW+X]>>>1)&0x7f7f7f))>>>0;}}
  function puff(px,x,y,rad,c){for(let j=-rad;j<=rad;j++)for(let i=-rad;i<=rad;i++)if(i*i+j*j<=rad*rad&&((i+j)&1)===0)dot(px,x+i,y+j,c);}
  function line(px,x0,y0,x1,y1,c){const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0),1);for(let i=0;i<=n;i++)dot(px,Math.round(x0+(x1-x0)*i/n),Math.round(y0+(y1-y0)*i/n),c);}
  const NOTE=['..##','..#.','..#.','..#.','###.','###.'];
  // a front-facing arc (span degrees either side), 2 px thick with an ink edge so it reads on any background
  function arc(px,cx,cy,rad,dir,span,col,flat){
    if(rad<2) return; const step=Math.max(1,Math.round(140/rad)), pts=[];
    for(let q=-span;q<=span;q+=step){const ang=q*Math.PI/180;pts.push([Math.round(cx+dir*Math.cos(ang)*rad),Math.round(cy+Math.sin(ang)*rad*flat)]);}
    for(const [x,y] of pts) fill(px,x-1,y-1,4,4,COL.ink);
    for(const [x,y] of pts) fill(px,x,y,2,2,col);
  }
  // Effects that belong to the moves themselves: dust, speed lines, the vacuum stream, sound waves, rocks, snacks, elite crowns.
  function drawMoves(px,s,r,t){
    const f=machine.frame,c=cam(r);
    for(let p=0;p<4;p++){
      const a=s.players[p],o=0xa40+p*0xc0; if(!(r[o]&0x40)) continue;
      const pos=playerPos(r,p);
      if(rolling(a,f)){const k=f-a.rollAt;for(let i=0;i<3;i++){const age=k-i*3;if(age<0||age>10)continue;puff(px,pos.x-a.rollDir*(6+i*8),pos.feet-2-(age>>2),Math.max(1,4-(age>>2)),age<5?COL.light:COL.grey);}}
      if(a.heavyAt>=0){
        const k=f-a.heavyAt,wind=HEAVY.windup-3*(s.upgrades.steel||0);
        if(k<wind&&k>=2){const gx=pos.x+a.heavyDir*10,gy=pos.feet-40,g=k%4<2?COL.white:COL.yellow,n=1+(k>>1)%3;line(px,gx-n-1,gy,gx+n+1,gy,g);line(px,gx,gy-n-1,gx,gy+n+1,g);}
        else if(k<wind+HEAVY.dash+HEAVY.press)for(let i=0;i<4;i++){const ly=pos.feet-12-i*11,lx=pos.x-a.heavyDir*(18+((k*5+i*7)%14));line(px,lx,ly,lx-a.heavyDir*10,ly,i&1?COL.white:COL.orange);}
      }
      if(a.sigAt>=0){
        const k=f-a.sigAt,d=a.sigDir;
        if(a.sigKind==='homer'){for(let i=0;i<5;i++){const ly=pos.feet-6-i*10,lx=pos.x-d*(20+((k*6+i*9)%18));line(px,lx,ly,lx-d*(8+i%3*4),ly,i&1?COL.white:COL.yellow);}puff(px,pos.x-d*12,pos.feet-2,2+(k&1),COL.light);}
        if(a.sigKind==='marge'){
          const nx=pos.x+d*18,ny=pos.feet-20;
          if(k<30) {
            // suction: rings shrink toward the nozzle while dust and scraps fly in
            for(let i=0;i<3;i++){const rad=104-((k*6+i*35)%105);if(rad>6)arc(px,nx,ny,rad,d,50,i===1?COL.white:COL.cyan,.5);}
            for(let i=0;i<10;i++){const ph=(k*5+i*23)%104,dist=104-ph,spread=((i*37)%44-22)*dist/104,x=Math.round(nx+d*dist),y=Math.round(ny+spread);
              fill(px,x-1,y-1,4,4,COL.ink);fill(px,x,y,2,2,[COL.light,COL.brown,COL.white,COL.green][i&3]);}
          } else arc(px,nx,ny,(k-30)*9,d,60,(k&1)?COL.cyan:COL.white,.5);
        }
        if(a.sigKind==='lisa'){
          for(let i=0;i<3;i++){const age=(k+i*6)%18,nx=pos.x+d*(10+age),ny=pos.feet-50-age*2;
            for(const [ox,oy,col] of [[-1,0,COL.ink],[1,0,COL.ink],[0,-1,COL.ink],[0,1,COL.ink],[0,0,i===1?COL.cyan:COL.yellow]])
              for(let j=0;j<NOTE.length;j++)for(let q=0;q<4;q++)if(NOTE[j][q]==='#')fill(px,nx+ox+(d<0?3-q:q)*2,ny+oy+j*2,2,2,col);}
        }
        if(a.sigKind==='bart'&&k<20){const t6=k%6,bx=pos.x+d*10,by=pos.feet-34;line(px,bx,by-5,bx-d*t6,by,COL.ink);line(px,bx,by+5,bx-d*t6,by,COL.ink);fill(px,bx-1,by-6,2,13,COL.brown);}
      }
    }
    for(const w of s.waves||[]){
      const rad=(f-w.born)*4,sx=w.x-c-54,feet=374-w.z-24;
      arc(px,sx,feet,rad,w.dir,70,rad>80?COL.orange:COL.yellow,.5); if(rad>8) arc(px,sx,feet,rad-5,w.dir,60,COL.white,.5);
    }
    for(const k of s.rocks||[]){const sx=Math.round(k.x-c-54),sy=374-k.z-32;floorShadow(px,sx,374-k.z,3);
      for(let i=1;i<4;i++)fill(px,sx-k.dir*(4+i*4),sy,3,1,i===1?COL.white:COL.light);fill(px,sx-2,sy-2,5,5,COL.ink);fill(px,sx-1,sy-1,3,3,COL.grey);dot(px,sx-1,sy-1,COL.white);}
    for(const k of s.pickups||[]){
      const age=f-k.born; if(age>PICKUP.life-120&&!blink(t,120)) continue;
      const sx=Math.round(k.x-c-54),feet=374-k.z,bob=Math.round(Math.sin(age*.12)*2),kind=PICKUP.kinds[k.kind];
      floorShadow(px,sx,feet,6); icon(px,sx-6,feet-16+bob,kind.icon);
      if(age%40<6) dot(px,sx+5,feet-17+bob,COL.white);
    }
    // elite crowns float above the enemy's head
    for(const key of Object.keys(s.elite||{})){
      const e=+key; if(!(r[e]&0x80)) continue; const pos=objPos(r,e),cx=pos.x,cy=pos.feet-78+(Math.floor(t/250)%2);
      const crown=['#.#.#','#####','#####']; for(let j=0;j<3;j++)for(let i=0;i<5;i++)if(crown[j][i]==='#'){fill(px,cx-5+i*2,cy+j*2,2,2,COL.yellow);}
      fill(px,cx-6,cy-1,12,1,COL.ink); fill(px,cx-6,cy+6,12,1,COL.ink); dot(px,cx-1,cy+3,COL.red); dot(px,cx,cy+3,COL.red);
    }
  }
  function drawCallout(px,r,t){
    const c=ui.callout; if(!c) return false;
    const age=t-c.at; if(age>800){ui.callout=null;return false;}
    if(age>600&&!c.calm&&!blink(t,60)) return true;
    const k=!c.calm&&age<90?2:1, pos=playerPos(r,c.p), w=tw8(c.text,k);
    const x=Math.max(4,Math.min(SW-4-w,pos.x-(w>>1))), y=Math.max(STRIP_Y+12,Math.min(150,pos.feet-96-(age<90?0:Math.min(8,age/40|0))));
    text8(px,x|0,y|0,c.text,KCOL[c.kind]||COL.gold,k); return true;
  }
  function drawDraft(px,s,t){
    shade(px,0,0,SW,SH);
    const res=s.results, n=s.offers.length, age=t-(ui.draftAt||0);
    center8(px,8,`STAGE ${s.pendingLevel} CLEAR!`,COL.gold,2);
    box(px,16,30,288,46,COL.panel2,COL.panel);
    if(res){
      const rc=RANKCOL[res.rank]||COL.gold; box(px,22,34,36,38,rc,COL.ink);
      if(font8()) text8(px,26,38,res.rank,rc,4); else text(px,30,40,res.rank,rc,6,false);
      const time=`${Math.floor(res.secs/60)}:${String(res.secs%60).padStart(2,'0')}`;
      const rows=[['TIME',time],['BEST COMBO',res.best],['KOS',res.kos],['DAMAGE',res.taken],['ELITES',res.elites],['COUNTERS',res.counters]];
      rows.forEach(([l,v],i)=>{const cx=68+(i%2)*118,cy=36+((i/2)|0)*11;text(px,cx,cy+1,l,COL.grey,1,false);text8(px,cx+100-tw8(String(v)),cy,String(v),COL.white);});
      const note=res.rank==='S'?'S RANK: BONUS 4TH ITEM':res.rank==='A'?'A RANK: RARE OR BETTER GUARANTEED':'';
      if(note) text(px,68,69,note,rc,1,false);
    }
    text(px,16,79,'PICK AN ITEM FOR THE REST OF THE RUN',COL.white,1,false);
    const gap=6,cw=Math.floor((288-gap*(n-1))/n),cy=94,ch=108; ui.cards=[];
    if(ui.sel>=n) ui.sel=0;
    s.offers.forEach((id,i)=>{
      // cards drop in one after another
      const u=UPGRADES.find(x=>x.id===id),col=RCOL[u.rarity],sel=i===ui.sel,drop=Math.max(0,Math.min(1,(age-i*90)/220)),x=16+i*(cw+gap),y=cy-(sel?3:0)-Math.round((1-drop)*(1-drop)*120);
      ui.cards.push({x,y:cy,w:cw,h:ch,id});
      if(drop<=0) return;
      if(sel) fill(px,x-3,y-3,cw+6,ch+6,blink(t,250)?COL.white:col);
      box(px,x,y,cw,ch,col,sel?COL.panel2:COL.panel);
      fill(px,x+2,y+2,cw-4,9,col); text(px,x+4,y+4,`${i+1}`,COL.ink,1,false);
      const tier=RARITY[u.rarity].label; text(px,x+cw-3-tw(tier),y+4,tier,COL.ink,1,false);
      fill(px,x+(cw>>1)-15,y+14,30,30,COL.ink); fill(px,x+(cw>>1)-14,y+15,28,28,sel?COL.dark:COL.panel2); icon(px,x+(cw>>1)-12,y+17,u.icon,2);
      let ly=y+48; const big=font8()&&cw>=84, per=big?Math.floor((cw-8)/8):Math.floor((cw-8)/4);
      for(const l of wrap(u.name,per)){ if(big){text8(px,x+((cw-tw8(l))>>1),ly,l,COL.gold);ly+=10;} else {text(px,x+((cw-tw(l))>>1),ly,l,COL.gold,1,false);ly+=7;} }
      ly+=3; const chars=Math.floor((cw-8)/4);
      for(const l of wrap(u.text,chars)){if(ly>y+ch-16)break;text(px,x+4,ly,l,COL.white,1,false);ly+=7;}
      const own=s.upgrades[id]||0; if(own) text(px,x+4,y+ch-10,`OWNED x${own}`,COL.grey,1,false);
    });
    if(blink(t,600)) center(px,210,`< > CHOOSE   ATTACK OR 1-${n} TAKES`,COL.white);
  }
  function drawGot(px,t){
    const g=ui.gotItem; if(!g) return; const age=t-g.at; if(age>1600){ui.gotItem=null;return;}
    const u=UPGRADES.find(x=>x.id===g.id); if(!u) return;
    const w=tw8('GOT '+u.name)+30, x=(SW-w)>>1, y=60-Math.round(Math.max(0,1-age/200)*20);
    box(px,x-4,y-4,w+8,24,RCOL[u.rarity],COL.panel); icon(px,x,y,u.icon); text8(px,x+18,y+2,'GOT '+u.name,COL.white);
  }
  function drawHelp(px,s,t){
    shade(px,0,0,SW,SH); box(px,10,8,300,208,COL.gold,COL.panel);
    center8(px,14,'HOW TO PLAY',COL.gold,2);
    const lines=[['ATTACK','CHAIN HITS. EVERY 3RD HIT IS A FINISHER'],['^ + ATTACK','LAUNCHER. AIR HITS JUGGLE'],['V / L / X PAD','HEAVY: WIND UP, DASH IN, SMASH'],
      ['F / I / Y PAD','SIGNATURE MOVE (PIP UNDER YOUR SCORE)'],['C / U / LB','ROLL. ROLL THROUGH A HIT TO COUNTER'],['Q / RB',`FOCUS BURST (${burstCost(s)} FOCUS)`],['B / RT','BOWL A BALL. 3 HITS: STRIKE!'],
      ['ELITES','WEAR A CROWN. DROP A SNACK'],['STAGE CLEAR','RANK S-C. PICK AN ITEM']];
    lines.forEach(([a,b],i)=>{text(px,18,38+i*9,a,COL.cyan,1,false);text(px,80,38+i*9,b,COL.white,1,false);});
    const sig=Object.entries(SIG).map(([k,v])=>[k.toUpperCase(),v.name+': '+v.help]);
    sig.forEach(([a,b],i)=>{text(px,18,122+i*8,a,COL.yellow,1,false);text(px,56,122+i*8,b,COL.white,1,false);});
    text(px,18,158,'YOUR ITEMS',COL.gold,1,false);
    const own=Object.entries(s.upgrades).filter(([,n])=>n);
    if(!own.length) text(px,18,170,'NONE YET',COL.grey,1,false);
    own.slice(0,12).forEach(([id,n],i)=>{const u=UPGRADES.find(x=>x.id===id),x=18+(i%6)*48,y=168+((i/6)|0)*16;if(u){icon(px,x,y,u.icon);text(px,x+14,y+4,'x'+n,COL.white,1,false);}});
    if(s.history.length) text(px,160,158,'RANKS: '+s.history.map(h=>h.rank).join(' '),COL.grey,1,false);
    if(blink(t,600)) center(px,206,'H OR ESC: BACK   N: NEW RUN',COL.white);
  }
  function drawOverlay(px) {
    if(!ui||!machine||!machine.arcadeCombat) return false;
    const s=machine.arcadeCombat,r=machine.ram,t=now(); let drew=false;
    pollPads(s);
    if(ui.shake){ const age=t-ui.shake.at; if(age>140) ui.shake=null; else {
      const ph=(age/35|0)%4,dx=[ui.shake.amp,-ui.shake.amp,ui.shake.amp>>1,0][ph],dy=[-1,1,0,0][ph],src=px.slice();
      for(let y=0;y<SH;y++){const sy=Math.max(0,Math.min(SH-1,y-dy));for(let x=0;x<SW;x++)px[y*SW+x]=src[sy*SW+Math.max(0,Math.min(SW-1,x-dx))];} drew=true; } }
    if(s.offers.length){ drawDraft(px,s,t); mirror(s); return true; }
    if(ui.help){ drawHelp(px,s,t); return true; }
    if(!playing(machine)||!LEVELS[r[0x803]]) { if(ui.gotItem&&machine.arcadeCombat) { drawGot(px,t); return true; } return drew; }
    drawGot(px,t);
    drawMoves(px,s,r,t);
    drawBalls(px,s,r);
    drawStrip(px,s,r,t);
    const big=drawCallout(px,r,t);
    if(!big&&machine.frame<s.messageUntil&&!/HIT COMBO$/.test(s.message)) center(px,STRIP_Y+12,s.message,COL.white);
    if(machine.frame-s.stage.start<SCREEN_HINT_FRAMES&&blink(t,700)) text(px,SW-4-tw('H: HOW TO PLAY'),214,'H: HOW TO PLAY',COL.gold);
    return true;
  }
  function mirror(s) { // screen-reader text for the in-game draft
    const key=s.offers.join(',')+'|'+s.pendingLevel; if(!ui.live||key===ui.last) return; ui.last=key; ui.sel=0;
    const res=s.results;
    ui.live.textContent=`Stage ${s.pendingLevel} clear.`+(res?` Rank ${res.rank}. Time ${res.secs} seconds, best combo ${res.best}, ${res.kos} KOs, damage taken ${res.taken}.`:'')+
      ` Choose an item with keys 1 to ${s.offers.length}: `+s.offers.map((id,i)=>{const u=UPGRADES.find(x=>x.id===id);return `${i+1}. ${u.name}, ${RARITY[u.rarity].label}: ${u.text}`;}).join(' ');
  }
  function moveSel(d){const s=machine?.arcadeCombat;if(!s?.offers.length)return;ui.sel=(ui.sel+d+s.offers.length)%s.offers.length;}
  function takeSel(){const s=machine?.arcadeCombat;if(s?.offers.length)choose(s.offers[ui.sel]||s.offers[0]);}
  function pollPads(s) {
    const pads=G.navigator?.getGamepads?G.navigator.getGamepads():[];
    for(let i=0;i<pads.length;i++){
      const pad=pads[i]; if(!pad?.connected) continue;
      const b=n=>!!pad.buttons[n]?.pressed, ax=pad.axes[0]||0;
      const bits=(b(14)||ax<-0.5?1:0)|(b(15)||ax>0.5?2:0)|(b(0)||b(2)?4:0)|(b(1)||b(3)?8:0);
      const edge=bits&~(ui.pads[i]||0); ui.pads[i]=bits;
      if(s.offers.length){ if(edge&1)moveSel(-1); if(edge&2)moveSel(1); if(edge&4)takeSel(); }
      else if(ui.help&&(edge&12)) setHelp(false);
    }
  }
  function setHelp(open) {
    if(!ui||ui.help===open) return; ui.help=open;
    if(G.SSRIN){ G.SSRIN.block=open; for(const k in G.SSRIN.held) G.SSRIN.held[k]=0; G.SSRIN.consumeLatch(); }
    if(open&&ui.live) ui.live.textContent='How to play. Attack chains build on landed hits; every third hit is a finisher. Up plus attack launches. V, L or gamepad X is a heavy attack. F, I or gamepad Y is your character\'s signature move: Marge vacuums, Homer belly bumps, Bart uses his slingshot and Lisa plays a sax solo. C, U or LB rolls; rolling through a hit opens a counter. Q or RB uses Focus Burst. B or RT bowls a ball for free; three hits with one ball is a strike. Elites wear a crown and drop a snack. Press H or Escape to return, N for a new run.';
  }
  const GAME_KEYS=/^(Arrow|Key[WASDZJXK]$|Enter$|Space$|Numpad|Digit[1-4]$)/;
  const KEY_MOVES={KeyC:'dodge',KeyU:'dodge',KeyQ:'special',KeyB:'throw',KeyV:'heavy',KeyL:'heavy',KeyF:'signature',KeyI:'signature'};
  function buildUI() {
    if(ui) return;
    const live=document.createElement('div'); live.id='combat-live'; live.setAttribute('aria-live','polite'); live.setAttribute('role','status');
    live.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    document.body.appendChild(live);
    ui={live,callout:null,shake:null,sel:0,help:false,last:'',cards:[],pads:{},draftAt:0,gotItem:null};
    addEventListener('keydown',e=>{
      if(!machine||!machine.arcadeCombat) return; const s=machine.arcadeCombat;
      if(s.offers.length) {
        if(!GAME_KEYS.test(e.code)) return;
        e.stopImmediatePropagation(); e.preventDefault(); if(e.repeat) return;
        const n=+e.key-1;
        if(n>=0&&n<s.offers.length) choose(s.offers[n]);
        else if(/^(ArrowLeft|KeyA|Numpad4)$/.test(e.code)) moveSel(-1);
        else if(/^(ArrowRight|KeyD|Numpad6)$/.test(e.code)) moveSel(1);
        else if(/^(Enter|Space|KeyZ|KeyJ|Numpad0|NumpadEnter)$/.test(e.code)) takeSel();
        return;
      }
      if(ui.help) {
        if(e.code==='KeyP'||e.code==='F8') return;
        e.stopImmediatePropagation(); e.preventDefault();
        if(/^(KeyH|Escape|Enter|KeyZ|KeyJ|KeyX|KeyK)$/.test(e.code)) setHelp(false);
        else if(e.code==='KeyN') location.href='index.html?scene=2&play=1';
        return;
      }
      const t=e.target;if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||t?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName||''))return;
      if(e.code==='KeyH'&&playing(machine)){e.preventDefault();setHelp(true);return;}
      const move=KEY_MOVES[e.code]; if(move){e.preventDefault();request(move,G.SSRIN?G.SSRIN.slot:0);}   // the keyboard plays the chosen character (input.js)
    },true);
    const at=e=>{const sc=document.getElementById('screen');if(!sc)return null;const b=sc.getBoundingClientRect();if(!b.width)return null;return {x:(e.clientX-b.left)*SW/b.width,y:(e.clientY-b.top)*SH/b.height};};
    const hit=p=>p&&ui.cards.findIndex(c=>p.x>=c.x&&p.x<c.x+c.w&&p.y>=c.y&&p.y<c.y+c.h);
    addEventListener('pointermove',e=>{if(!machine?.arcadeCombat?.offers.length)return;const i=hit(at(e));if(i>=0)ui.sel=i;});
    addEventListener('pointerdown',e=>{
      const s=machine?.arcadeCombat;if(!s)return;
      if(s.offers.length){const i=hit(at(e));if(i>=0){e.preventDefault();choose(ui.cards[i].id);}return;}
      if(ui.help){const p=at(e);if(p&&p.x>=0&&p.x<SW&&p.y>=0&&p.y<SH){e.preventDefault();setHelp(false);}}
    });
  }
  function updateUI() { if(ui&&machine&&!machine.arcadeCombat?.offers.length) { ui.cards=[]; ui.last=''; } }
  const api={enabled,BALL,ROLL,HEAVY,SIG,CHARS,PICKUP,ICONS,create,install,beforeFrame,afterFrame,request,choose,rate,UPGRADES,RARITY,drawOverlay,flash:feedback,transformFor,composite,gfx:{text,center,tw,text8,COL},
    help(open){setHelp(!!open);},get helpOpen(){return !!ui?.help;},get selected(){return ui?ui.sel:0;},select(i){if(ui&&machine?.arcadeCombat?.offers.length)ui.sel=Math.max(0,Math.min(machine.arcadeCombat.offers.length-1,i|0));},get cards(){return ui?ui.cards.slice():[];},
    get drafting(){return !!machine?.arcadeCombat?.offers.length;},
    get blocked(){return !!machine?.arcadeCombat?.offers.length||!!ui?.help||now()<stopUntil;},
    assertOnline(){if(enabled&&machine)throw new Error('Arcade Remix is offline. Open ?mods=0 for online play.');}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else G.SIMPCOMBAT=api;
})(typeof window!=='undefined'?window:globalThis);
