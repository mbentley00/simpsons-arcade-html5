// Offline Arcade Remix: confirmed-hit combos and a run-scoped, seeded between-stage upgrade draft.
(function (G) {
  'use strict';
  const q = new URLSearchParams(G.location ? G.location.search : '');
  const enabled = q.get('mods') !== '0' && !q.has('sala') && q.get('combat') !== '0';
  const LEVELS = {2:1,4:2,6:3,7:4,8:4,9:5,11:6,13:7,15:8};
  // Draft weights per rarity. A stage rank of A guarantees one rare or epic card; S adds a fourth card.
  const RARITY = {common:{weight:6,label:'Common'},rare:{weight:3,label:'Rare'},epic:{weight:2,label:'Epic'}};
  const UPGRADES = [
    {id:'power',name:'Heavy hands',text:'+20% damage on landed hits.',max:3,rarity:'common'},
    {id:'armor',name:'Thick skin',text:'Take 1 less damage from enemy attacks.',max:3,rarity:'common'},
    {id:'vitality',name:'Big heart',text:'+8 maximum health and heal 8.',max:3,rarity:'common'},
    {id:'leech',name:'Victory snack',text:'Heal 2 health whenever you defeat an enemy.',max:3,rarity:'common'},
    {id:'speed',name:'Quick feet',text:'+15% native movement speed.',max:3,rarity:'common'},
    {id:'focus',name:'Focus training',text:'+3 focus per landed hit.',max:3,rarity:'common'},
    {id:'flow',name:'Keep it flowing',text:'+30 frames to keep your combo alive.',max:3,rarity:'common'},
    {id:'dodge',name:'Slip away',text:'Shorter dodge cooldown and longer invulnerability.',max:3,rarity:'common'},
    {id:'heal',name:'Full recovery',text:'Restore all active players to full health.',max:99,rarity:'common'},
    {id:'momentum',name:'Momentum',text:'From the 5th hit of a combo, +15% damage and +2 focus per hit.',max:3,rarity:'rare'},
    {id:'juggle',name:'Juggler',text:'Air hits deal +2 more damage and pop the enemy back up.',max:2,rarity:'rare'},
    {id:'riposte',name:'Riposte',text:'Perfect-dodge counters last 30 frames longer and hit 25% harder.',max:2,rarity:'rare'},
    {id:'shockwave',name:'Shockwave',text:'Chain finishers hit every other nearby enemy for 4 damage.',max:2,rarity:'epic'},
    {id:'burst',name:'Overcharge',text:'Focus Burst costs 10 less and reaches farther.',max:2,rarity:'epic'},
  ];
  const STOP_MS = {finisher:45,launcher:70,counter:90,shockwave:60};
  let machine = null, ui = null, queued = [], stopUntil = 0;
  const word = (r,o) => ((r[o]<<8)|r[o+1])<<16>>16;
  const put = (r,o,v) => { r[o]=(v>>8)&255; r[o+1]=v&255; };
  const now = () => (G.performance ? G.performance.now() : Date.now());
  const player = o => o>=0xa40 && o<0xd40 && (o-0xa40)%0xc0===0 ? (o-0xa40)/0xc0 : -1;
  const foe = o => o>=0xd40 && o<0x1640 && (o-0xd40)%0x60===0;
  const regular = o => o>=0xf80 && o<0x1280 && (o-0xf80)%0x60===0;
  const playing = m => enabled && m.arcadeCombat && m.ram[0x800]===2 && m.ram[0x802]===1 && !(G.SIMPG && G.SIMPG.net);
  const maximum = s => 40 + 8*(s.upgrades.vitality||0);
  const flowWindow = s => 90+30*(s.upgrades.flow||0);
  const burstCost = s => 50-10*(s.upgrades.burst||0);
  const near = (r,a,b,dx,dz) => Math.abs(word(r,a+12)-word(r,b+12))<dx && Math.abs(word(r,a+17)-word(r,b+17))<dz;
  const newStage = (level,frame) => ({level,start:frame,taken:0,best:0,kos:0,elites:0,counters:0});
  function create(seed) {
    return {version:2,rng:(seed>>>0)||0x42ac9153,level:1,upgrades:{},cleared:{},offers:[],pendingLevel:0,enemySeen:{},elite:{},effects:[],wasGame:false,
      stage:newStage(1,0),results:null,history:[],
      players:Array.from({length:4},()=>({combo:0,best:0,lastHit:-9999,focus:50,lastBits:0,intent:'chain',intentUntil:0,dodgeUntil:0,dodgeReady:0,countered:false,counterUntil:0,dir:1,active:false})),message:'↑ + Attack launches · C dodges · Q special',messageUntil:0};
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
      ui.shake={at:t,amp:kind==='launcher'||kind==='counter'?3:2};
    }
    if(text) ui.callout={text,kind,p,at:t,calm};
  }
  function landed(m,p,o,damage,remaining,kind) {
    const s=m.arcadeCombat, a=s.players[p], r=m.ram;
    a.combo=m.frame-a.lastHit<=flowWindow(s)?a.combo+1:1; a.lastHit=m.frame; a.best=Math.max(a.best,a.combo);
    s.stage.best=Math.max(s.stage.best,a.combo);
    if(kind!=='special') a.focus=Math.min(100,a.focus+7+3*(s.upgrades.focus||0)+(a.combo>=5?2*(s.upgrades.momentum||0):0));
    const launch=kind==='launcher'&&regular(o), finisher=a.combo%3===0, countering=m.frame<=a.counterUntil;
    if(regular(o)&&(launch||finisher)) s.effects.push({o,launch,dir:a.dir});
    else if(regular(o)&&kind==='air'&&(s.upgrades.juggle||0)) s.effects.push({o,launch:false,pop:true,dir:a.dir});
    let waved=0;
    if(finisher&&kind!=='special'&&(s.upgrades.shockwave||0)) {
      for(let e=0xf80;e<0x1280;e+=0x60) if(e!==o&&(r[e]&0x40)&&!(r[e]&4)&&r[e+0x1b]&&near(r,e,o,72,32)) {
        r[e+0x1b]=Math.max(0,r[e+0x1b]-4*s.upgrades.shockwave); r[e]|=0x20; r[e+0x1e]=3; put(r,e+0x25,0x4000+0xa40+p*0xc0);
        s.effects.push({o:e,launch:false,dir:word(r,e+12)<word(r,o+12)?-1:1}); waved++;
        if(!r[e+0x1b]) defeated(m,p,e,false);
      }
    }
    const text=launch?'LAUNCHER!':waved?'SHOCKWAVE!':countering&&kind!=='special'?'COUNTER!':kind==='air'?'AIR HIT!':finisher?'CHAIN FINISHER!':`${a.combo} HIT COMBO`;
    message(m,text);
    if(kind!=='special'&&(launch||waved||finisher||countering)) feedback(launch?'launcher':waved?'shockwave':countering?'counter':'finisher',text,p);
    if(!remaining) defeated(m,p,o,kind!=='special');
  }
  function defeated(m,p,o,focus) {
    const s=m.arcadeCombat,a=s.players[p]; s.stage.kos++;
    heal(m,p,2*(s.upgrades.leech||0)); if(focus) a.focus=Math.min(100,a.focus+5);
    if(s.elite[o]) { delete s.elite[o]; s.stage.elites++; a.focus=Math.min(100,a.focus+15); heal(m,p,4); message(m,'ELITE DOWN!'); feedback('elite','ELITE DOWN!',p); }
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
  }
  function choose(id) {
    const m=machine,s=m&&m.arcadeCombat; if(!s||!s.offers.includes(id)) return false;
    s.upgrades[id]=(s.upgrades[id]||0)+1;
    for(let p=0;p<4;p++) { if(id==='vitality') heal(m,p,8); if(id==='heal') heal(m,p,255); }
    s.offers=[]; s.pendingLevel=0; queued=[];
    if(G.SSRIN) { G.SSRIN.block=false; for(const k in G.SSRIN.held) G.SSRIN.held[k]=0; G.SSRIN.consumeLatch(); }
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
            const state=s.players[attacker], air=word(r,o+0x16)>4;
            const kind=m.frame<=state.intentUntil?state.intent:'chain', next=m.frame-state.lastHit<=flowWindow(s)?state.combo+1:1;
            let damage=(old-value)*(1+.2*(s.upgrades.power||0));
            if(next>=5) damage*=1+.15*(s.upgrades.momentum||0);
            if(m.frame<=state.counterUntil) damage*=1.5+.25*(s.upgrades.riposte||0);
            damage=Math.ceil(damage);
            if(next%3===0) damage+=4;
            if(air) damage+=2+2*(s.upgrades.juggle||0);
            value=Math.max(0,old-damage); landed(this,attacker,o,damage,value,air?'air':kind);
          } else if(p>=0&&foe(other)) {
            const state=s.players[p];
            if(m.frame<state.dodgeUntil) {
              value=old;
              // A real enemy hit landing inside the dodge opens a counter window (once per dodge).
              if(!state.countered) {
                state.countered=true; state.counterUntil=m.frame+60+30*(s.upgrades.riposte||0); s.stage.counters++;
                state.focus=Math.min(100,state.focus+10); message(this,'PERFECT DODGE - COUNTER!'); feedback('counter','PERFECT DODGE!',p);
              }
            } else value=Math.max(0,old-Math.max(1,old-value-(s.upgrades.armor||0)));
            if(value<old) { state.combo=0; state.focus=Math.max(0,state.focus-5); s.stage.taken+=old-value; }
          }
        }
        // Scale the native velocity when it is assigned, so native movement/collision integration remains in use.
        for(let p=0;p<4;p++) {
          const base=0x4a40+p*0xc0, low=a-base;
          if(this.frame<s.players[p].dodgeUntil) {
            if(low===0) value&=~0x20;
            if(low===0x1e) value=0;
          }
          if(low===0x10&&this.frame<(s.players[p].dodgeMoveUntil||0)) {
            const vel=s.players[p].dir*0x500; mw.call(this,a-1,(vel>>8)&255); value=vel&255;
          }
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
    if(G.document&&!options.noUI) buildUI();
    afterFrame(m);
  }
  function request(move,p=0) { if(enabled&&p>=0&&p<4&&['dodge','special'].includes(move)) queued.push({move,p}); }
  function beforeFrame(m) {
    if(!playing(m)||m.arcadeCombat.offers.length) return;
    if(!LEVELS[m.ram[0x803]]) { queued=[]; return; }
    const s=m.arcadeCombat,r=m.ram;
    for(let p=0;p<4;p++) {
      const a=s.players[p],o=0xa40+p*0xc0,bits=(~m.inputs['P'+(p+1)])&255;
      if(bits&1) a.dir=-1; else if(bits&2) a.dir=1;
      if((bits&16)&&!(a.lastBits&16)) { a.intent=bits&4?'launcher':word(r,o+0x16)>4?'air':'chain'; a.intentUntil=m.frame+30; }
      a.lastBits=bits;
      if(m.frame-a.lastHit>flowWindow(s)) a.combo=0;
    }
    const pads=G.navigator?.getGamepads?G.navigator.getGamepads():[];
    for(let p=0;p<Math.min(4,pads.length);p++) {
      const pad=pads[p],a=s.players[p],buttons=pad?.connected?((pad.buttons[4]?.pressed?1:0)|(pad.buttons[5]?.pressed?2:0)):0;
      if((buttons&1)&&!(a.lastPadButtons&1))queued.push({move:'dodge',p});
      if((buttons&2)&&!(a.lastPadButtons&2))queued.push({move:'special',p});a.lastPadButtons=buttons;
    }
    for(const action of queued.splice(0)) {
      const a=s.players[action.p],o=0xa40+action.p*0xc0; if(!(r[o]&0x40)||!r[o+0x1b]) continue;
      if(action.move==='dodge'&&m.frame>=a.dodgeReady) {
        a.dodgeUntil=m.frame+12+4*(s.upgrades.dodge||0); a.dodgeReady=m.frame+Math.max(20,45-8*(s.upgrades.dodge||0));
        a.dodgeMoveUntil=m.frame+8; a.countered=false;
        put(r,o+0x0f,a.dir*0x500); message(m,'DODGE!');
      }
      if(action.move==='special'&&a.focus>=burstCost(s)) {
        a.focus-=burstCost(s); m.inputs['P'+(action.p+1)]&=~0x30;
        let hits=0; const reach=88+24*(s.upgrades.burst||0);
        for(let e=0xd40;e<0x1640;e+=0x60) if((r[e]&0x40)&&!(r[e]&4)&&r[e+0x1b]&&near(r,e,o,reach,38)) {
          const damage=Math.ceil(8*(1+.2*(s.upgrades.power||0))); r[e+0x1b]=Math.max(0,r[e+0x1b]-damage); r[e]|=0x20; r[e+0x1e]=3; put(r,e+0x25,0x4000+o);
          landed(m,action.p,e,damage,r[e+0x1b],'special'); if(regular(e))s.effects.push({o:e,launch:true,dir:a.dir}); hits++;
        }
        message(m,hits?'FOCUS BURST!':'FOCUS BURST - NO TARGETS'); if(hits) feedback('launcher','FOCUS BURST!',action.p);
      }
    }
  }
  function afterFrame(m) {
    if(!enabled||!m.arcadeCombat) return;
    const s=m.arcadeCombat,r=m.ram,live=r[0x800]===2;
    if(s.wasGame&&!live) { m.arcadeCombat=create(s.rng^m.frame); updateUI(); return; }
    s.wasGame=live;
    if(!playing(m)) return;
    s.level=LEVELS[r[0x803]]||s.level;
    if(LEVELS[r[0x803]]) {
    if(s.stage.level!==s.level) s.stage=newStage(s.level,m.frame);
    for(let p=0;p<4;p++) {
      const a=s.players[p],o=0xa40+p*0xc0,active=!!(r[o]&0x40);
      if(active&&!a.active&&(s.upgrades.vitality||0)) heal(m,p,8*s.upgrades.vitality);
      a.active=active;
    }
    for(let o=0xf80;o<0x1280;o+=0x60) {
      if(!(r[o]&0x80)) { delete s.enemySeen[o]; delete s.elite[o]; continue; }
      if(!s.enemySeen[o]&&r[o+4]===0x80&&r[o+0x1b]>0) {
        let hp=Math.max(r[o+0x1b],Math.min(32,12+2*(s.level-1)));
        // Elites appear from stage 2 on: more native health, and a focus/health reward when defeated.
        if(s.level>=2&&random(s)%100<8+4*s.level) { hp=Math.min(56,Math.round(hp*1.6)); s.elite[o]=true; message(m,'ELITE ENEMY!'); }
        r[o+0x1b]=hp; s.enemySeen[o]=true;
      }
    }
    for(const e of s.effects.splice(0)) if(r[e.o]&0x80) {
      put(r,e.o+0x0f,e.dir*0x400);
      if(e.launch) { put(r,e.o+0x16,Math.max(12,word(r,e.o+0x16))); put(r,e.o+0x19,0x500); }
      else if(e.pop) put(r,e.o+0x19,Math.max(0x300,word(r,e.o+0x19)));
    }
    } else s.effects=[];
    // The draft holds the game (SIMPCOMBAT.blocked) and is drawn inside the picture; local input goes to the cards.
    if(s.offers.length&&G.SSRIN&&!G.SSRIN.block) G.SSRIN.block=true;
    updateUI();
  }
  // ---------- in-game presentation: drawn into the finished 320x224 frame by game.js (SIMPCOMBAT.drawOverlay) so it
  // scales and gets the CRT treatment with the game. Arcade-style 3x5 pixel font, chunky panels. Never board state.
  const SW=320, SH=224, STRIP_Y=31, SCREEN_HINT_FRAMES=420;
  const GLYPHS={'A':'.#.#.#####.##.#','B':'##.#.###.#.###.','C':'.###..#..#...##','D':'##.#.##.##.###.','E':'####..##.#..###','F':'####..##.#..#..','G':'.###..#.##.#.##','H':'#.##.#####.##.#','I':'###.#..#..#.###','J':'..#..#..##.#.#.','K':'#.##.###.#.##.#','L':'#..#..#..#..###','M':'#.########.##.#','N':'##.#.##.##.##.#','O':'.#.#.##.##.#.#.','P':'##.#.###.#..#..','Q':'.#.#.##.###..##','R':'##.#.###.#.##.#','S':'.###...#...###.','T':'###.#..#..#..#.','U':'#.##.##.##.####','V':'#.##.##.##.#.#.','W':'#.##.########.#','X':'#.##.#.#.#.##.#','Y':'#.##.#.#..#..#.','Z':'###..#.#.#..###','0':'####.##.##.####','1':'.#.##..#..#.###','2':'##...#.#.#..###','3':'##...#.#...###.','4':'#.##.####..#..#','5':'####..##...###.','6':'.###..####.####','7':'###..#.#..#..#.','8':'####.#####.####','9':'####.####..###.','.':'.............#.',',':'..........#.#..',':':'....#.....#....','!':'.#..#..#.....#.','?':'##...#.#.....#.','+':'....#.###.#....','-':'......###......','%':'#....#.#.#....#','/':'..#..#.#.#..#..',"'":'.#..#..........','(':'.#.#..#..#...#.',')':'.#...#..#..#.#.','x':'...#.#.#.#.#...','<':'..#.#.#...#...#','>':'#...#...#.#.#..','^':'.#.###.#..#..#.','v':'......#.##.#.#.','*':'.......#.......','#':'#.#####.#####.#',' ':'...............'};
  const rgb=(r,g,b)=>(0xff000000|(b<<16)|(g<<8)|r)>>>0;
  const COL={ink:rgb(14,10,20),gold:rgb(255,204,72),white:rgb(255,246,226),cyan:rgb(110,232,255),purple:rgb(222,140,255),blue:rgb(96,176,255),
    orange:rgb(255,146,40),red:rgb(244,72,60),green:rgb(116,224,92),grey:rgb(168,156,140),panel:rgb(34,22,14),panel2:rgb(60,40,24),dim:rgb(96,84,72)};
  const RCOL={common:COL.gold,rare:COL.blue,epic:COL.purple}, RANKCOL={S:COL.cyan,A:COL.gold,B:COL.green,C:COL.grey};
  const KCOL={counter:COL.cyan,shockwave:COL.purple,launcher:COL.orange,elite:COL.red,finisher:COL.gold};
  const clean=t=>String(t).toUpperCase().replace(/[—–]/g,'-').replace(/[·•]/g,'*').replace(/×/g,'x').replace(/↑/g,'^');
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
  function wrap(t,n){const out=[];let line='';for(const w of clean(t).split(' ')){if(line&&(line+' '+w).length>n){out.push(line);line=w;}else line=line?line+' '+w:w;}if(line)out.push(line);return out;}
  const blink=(t,ms=500)=>Math.floor(t/ms)%2===0;
  function playerPos(r,p){const o=0xa40+p*0xc0;return {x:word(r,o+0xc)-54,feet:374-word(r,o+0x11)-r[o+0x17]};}
  function drawStrip(px,s,r,t){
    for(let p=0;p<4;p++){
      const o=0xa40+p*0xc0; if(!(r[o]&0x40)) continue;
      // one strip under each native player panel (panels span x 20..300, ~70 px each)
      const a=s.players[p],x=21+Math.round(p*70.25),y=STRIP_Y,cost=burstCost(s),M=26;
      shade(px,x-1,y-1,69,9);
      text(px,x+1,y+1,'F',COL.white,1,false);
      fill(px,x+6,y+1,M+2,5,COL.ink);fill(px,x+7,y+2,M,3,COL.dim);
      fill(px,x+7,y+2,Math.round(M*a.focus/100),3,a.focus>=cost?(a.focus>=100&&blink(t,200)?COL.white:COL.gold):COL.orange);
      fill(px,x+7+Math.round(M*cost/100),y+1,1,5,COL.white);
      const tx=x+37;
      if(machine.frame<=a.counterUntil){ if(blink(t,150)) text(px,tx,y+1,'COUNTER',COL.cyan,1,false); }
      else if(a.combo>=2) text(px,tx,y+1,a.combo+' HIT',a.combo>=10?COL.red:COL.gold,1,false);
      else { const n=Object.values(s.upgrades).reduce((u,v)=>u+v,0); if(n) text(px,tx,y+1,'+'+n+' UPG',COL.grey,1,false); }
    }
  }
  function drawCallout(px,r,t){
    const c=ui.callout; if(!c) return false;
    const age=t-c.at; if(age>800){ui.callout=null;return false;}
    if(age>600&&!c.calm&&!blink(t,60)) return true;
    const k=!c.calm&&age<90?3:2, pos=playerPos(r,c.p), w=tw(c.text,k);
    const x=Math.max(4,Math.min(SW-4-w,pos.x-(w>>1))), y=Math.max(STRIP_Y+12,Math.min(150,pos.feet-92-(age<90?0:Math.min(8,age/40|0))));
    text(px,x|0,y|0,c.text,KCOL[c.kind]||COL.gold,k); return true;
  }
  function drawDraft(px,s,t){
    shade(px,0,0,SW,SH);
    const res=s.results, n=s.offers.length;
    center(px,10,`STAGE ${s.pendingLevel} CLEAR!`,COL.gold,2);
    box(px,16,30,288,48,COL.panel2,COL.panel);
    if(res){
      const rc=RANKCOL[res.rank]||COL.gold; box(px,24,36,34,36,rc,COL.ink); text(px,30,40,res.rank,rc,6,false);
      const time=`${Math.floor(res.secs/60)}:${String(res.secs%60).padStart(2,'0')}`;
      const rows=[['TIME',time],['BEST COMBO',res.best],['KOS',res.kos],['DAMAGE',res.taken],['ELITES',res.elites],['COUNTERS',res.counters]];
      rows.forEach(([l,v],i)=>{const cx=70+(i%2)*116,cy=38+((i/2)|0)*10;text(px,cx,cy,l,COL.grey,1,false);text(px,cx+92-tw(String(v)),cy,String(v),COL.white,1,false);});
      const note=res.rank==='S'?'S RANK: BONUS 4TH CARD':res.rank==='A'?'A RANK: RARE OR BETTER GUARANTEED':'';
      if(note) text(px,70,68,note,rc,1,false);
    }
    const gap=6,cw=Math.floor((288-gap*(n-1))/n),cy=88,ch=106; ui.cards=[];
    if(ui.sel>=n) ui.sel=0;
    s.offers.forEach((id,i)=>{
      const u=UPGRADES.find(x=>x.id===id),col=RCOL[u.rarity],sel=i===ui.sel,x=16+i*(cw+gap),y=cy-(sel?3:0);
      ui.cards.push({x,y,w:cw,h:ch,id});
      if(sel) fill(px,x-3,y-3,cw+6,ch+6,blink(t,250)?COL.white:col);
      box(px,x,y,cw,ch,col,sel?COL.panel2:COL.panel);
      fill(px,x+2,y+2,cw-4,9,col); text(px,x+4,y+4,`${i+1}`,COL.ink,1,false);
      const tier=RARITY[u.rarity].label; text(px,x+cw-3-tw(tier),y+4,tier,COL.ink,1,false);
      const chars=Math.floor((cw-8)/4); let ly=y+15;
      for(const line of wrap(u.name,chars)){text(px,x+4,ly,line,COL.gold,1,false);ly+=7;}
      ly+=3; for(const line of wrap(u.text,chars)){if(ly>y+ch-16)break;text(px,x+4,ly,line,COL.white,1,false);ly+=7;}
      const own=s.upgrades[id]||0; if(own) text(px,x+4,y+ch-10,`OWNED x${own}`,COL.grey,1,false);
    });
    if(blink(t,600)) center(px,206,`< > CHOOSE   ATTACK OR 1-${n} TAKES`,COL.white);
  }
  function drawHelp(px,s,t){
    shade(px,0,0,SW,SH); box(px,14,14,292,196,COL.gold,COL.panel);
    center(px,22,'HOW TO PLAY',COL.gold,2);
    const lines=[['ATTACK','CHAIN HITS. EVERY 3RD HIT IS A FINISHER'],['^ + ATTACK','LAUNCHER. AIR HITS JUGGLE'],['C / LB','DODGE. DODGE A HIT TO COUNTER'],
      ['Q / RB',`FOCUS BURST (${burstCost(s)} FOCUS)`],['ELITES','EXTRA HEALTH. DROP FOCUS + HEALTH'],['STAGE CLEAR','RANK S-C. PICK AN UPGRADE']];
    lines.forEach(([a,b],i)=>{text(px,24,46+i*10,a,COL.cyan,1,false);text(px,84,46+i*10,b,COL.white,1,false);});
    text(px,24,112,'YOUR RUN',COL.gold,1,false);
    const build=Object.entries(s.upgrades).map(([id,n])=>(UPGRADES.find(u=>u.id===id)?.name||id)+' x'+n).join(', ')||'NO UPGRADES YET';
    let y=122; for(const line of wrap(build,68).slice(0,5)){text(px,24,y,line,COL.white,1,false);y+=8;}
    if(s.history.length) text(px,24,y+2,'RANKS: '+s.history.map(h=>h.rank).join(' '),COL.grey,1,false);
    if(blink(t,600)) center(px,196,'H OR ESC: BACK   N: NEW RUN',COL.white);
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
    if(!playing(machine)||!LEVELS[r[0x803]]) return drew;
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
      ` Choose an upgrade with keys 1 to ${s.offers.length}: `+s.offers.map((id,i)=>{const u=UPGRADES.find(x=>x.id===id);return `${i+1}. ${u.name}, ${RARITY[u.rarity].label}: ${u.text}`;}).join(' ');
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
    if(open&&ui.live) ui.live.textContent='How to play. Attack chains build on landed hits; every third hit is a finisher. Up plus attack launches. C or LB dodges; dodging a hit opens a counter. Q or RB uses Focus Burst. Press H or Escape to return, N for a new run.';
  }
  const GAME_KEYS=/^(Arrow|Key[WASDZJXK]$|Enter$|Space$|Numpad|Digit[1-4]$)/;
  function buildUI() {
    if(ui) return;
    const live=document.createElement('div'); live.id='combat-live'; live.setAttribute('aria-live','polite'); live.setAttribute('role','status');
    live.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    document.body.appendChild(live);
    ui={live,callout:null,shake:null,sel:0,help:false,last:'',cards:[],pads:{}};
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
      if(e.code==='KeyQ'||e.code==='KeyC'){e.preventDefault();request(e.code==='KeyQ'?'special':'dodge');}
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
  const api={enabled,create,install,beforeFrame,afterFrame,request,choose,rate,UPGRADES,RARITY,drawOverlay,flash:feedback,
    help(open){setHelp(!!open);},get helpOpen(){return !!ui?.help;},get selected(){return ui?ui.sel:0;},select(i){if(ui&&machine?.arcadeCombat?.offers.length)ui.sel=Math.max(0,Math.min(machine.arcadeCombat.offers.length-1,i|0));},get cards(){return ui?ui.cards.slice():[];},
    get drafting(){return !!machine?.arcadeCombat?.offers.length;},
    get blocked(){return !!machine?.arcadeCombat?.offers.length||!!ui?.help||now()<stopUntil;},
    assertOnline(){if(enabled&&machine)throw new Error('Arcade Remix is offline. Open ?mods=0 for online play.');}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else G.SIMPCOMBAT=api;
})(typeof window!=='undefined'?window:globalThis);
