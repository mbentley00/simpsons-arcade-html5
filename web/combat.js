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
  // Presentation only: a short wall-clock hit-stop (game.js skips frames while blocked), a screen shake and a callout.
  // None of it is board state, so save/load and the seeded run stay identical with or without it.
  function feedback(kind,text) {
    if(!ui) return;
    const calm=G.matchMedia&&G.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!calm) {
      stopUntil=Math.max(stopUntil,now()+(STOP_MS[kind]||0));
      const amp=kind==='launcher'||kind==='counter'?4:2;
      for(const el of document.querySelectorAll('#screen, #screen + canvas')) el.animate?.([{translate:'0 0'},{translate:`${amp}px ${-amp/2}px`},{translate:`${-amp}px ${amp/2}px`},{translate:'0 0'}],{duration:140});
    }
    if(text) { const c=ui.callout; c.textContent=text; c.dataset.kind=kind; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
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
    if(kind!=='special'&&(launch||waved||finisher||countering)) feedback(launch?'launcher':waved?'shockwave':countering?'counter':'finisher',text);
    if(!remaining) defeated(m,p,o,kind!=='special');
  }
  function defeated(m,p,o,focus) {
    const s=m.arcadeCombat,a=s.players[p]; s.stage.kos++;
    heal(m,p,2*(s.upgrades.leech||0)); if(focus) a.focus=Math.min(100,a.focus+5);
    if(s.elite[o]) { delete s.elite[o]; s.stage.elites++; a.focus=Math.min(100,a.focus+15); heal(m,p,4); message(m,'ELITE DOWN!'); feedback('finisher','ELITE DOWN!'); }
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
    if(G.SIMPG) G.SIMPG.pause(false); updateUI(); return true;
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
                state.focus=Math.min(100,state.focus+10); message(this,'PERFECT DODGE — COUNTER!'); feedback('counter','PERFECT DODGE!');
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
        message(m,hits?'FOCUS BURST!':'FOCUS BURST — no targets'); if(hits) feedback('launcher','FOCUS BURST!');
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
    if(s.offers.length&&G.SIMPG&&!G.SIMPG.paused) { G.SIMPG.pause(true); if(G.SSRIN) G.SSRIN.block=true; }
    updateUI();
  }
  function buildUI() {
    if(ui) return;
    const style=document.createElement('style'); style.textContent=`#combat-hud{position:fixed;left:12px;top:54px;z-index:16;color:#ffe4a0;background:rgba(18,12,6,.83);padding:8px;border-radius:6px;font:12px system-ui;max-width:255px}#combat-hud progress{width:90px;vertical-align:middle;accent-color:#ffc861}#combat-hud details{margin-top:4px}#combat-hud a{color:#86d6ff}#combat-counter{color:#7fe3ff}#upgrade-draft{position:fixed;inset:0;z-index:60;display:grid;place-content:center;background:rgba(0,0,0,.86);padding:20px;color:#fff1d5;font:15px system-ui}#upgrade-draft[hidden]{display:none}#upgrade-draft section{max-width:900px;max-height:85vh;overflow:auto}#upgrade-results{display:flex;gap:14px;align-items:center;margin:0 0 14px;padding:10px 14px;border-radius:10px;background:#1d1610}#upgrade-rank{font:800 46px system-ui;width:60px;text-align:center;color:#ffc861}#upgrade-rank[data-rank=S]{color:#7fe3ff}#upgrade-rank[data-rank=C]{color:#c9a98a}#upgrade-stats{display:grid;grid-template-columns:repeat(3,auto);gap:2px 18px;font-size:13px}#upgrade-cards{display:flex;gap:10px;flex-wrap:wrap}#upgrade-cards button{flex:1;min-width:185px;padding:20px;background:#2d2117;color:#fff1d5;border:2px solid #c8892e;border-radius:10px;text-align:left;cursor:pointer}#upgrade-cards button[data-rarity=rare]{border-color:#53b8f0;background:#17232d}#upgrade-cards button[data-rarity=epic]{border-color:#d07af5;background:#24172d}#upgrade-cards b{display:block;color:#ffc861;font-size:18px;margin-bottom:4px}#upgrade-cards i{display:block;font-size:11px;font-style:normal;letter-spacing:.08em;text-transform:uppercase;opacity:.8;margin-bottom:8px}#upgrade-cards button:focus-visible{outline:3px solid #fff}#combat-hud summary{cursor:pointer}#combat-callout{position:fixed;left:50%;top:26%;z-index:17;transform:translate(-50%,-50%);pointer-events:none;font:900 34px system-ui;color:#ffc861;text-shadow:0 3px 0 #5a2c00,0 0 12px #000;opacity:0;white-space:nowrap}#combat-callout[data-kind=counter]{color:#7fe3ff}#combat-callout[data-kind=shockwave]{color:#e9a6ff}#combat-callout.pop{animation:combat-pop .7s ease-out}@keyframes combat-pop{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}15%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}70%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-60%) scale(1)}}@media (prefers-reduced-motion:reduce){#combat-callout.pop{animation-duration:1.2s;animation-name:combat-fade}@keyframes combat-fade{0%,80%{opacity:1}100%{opacity:0}}}`; document.head.appendChild(style);
    const hud=document.createElement('div'); hud.id='combat-hud';
    hud.innerHTML='<div id="combat-status"></div><div>Focus <progress id="combat-focus" max="100" value="50" aria-label="Focus"></progress> <span id="combat-meter"></span></div><div id="combat-message"></div><div id="combat-counter" hidden>COUNTER READY</div><details><summary>Moves & run upgrades</summary><p>Attack chains build on landed hits. Every third hit is a finisher. ↑ + Attack launches. Air hits juggle.<br>C: dodge. Dodge through an enemy hit for a perfect-dodge counter: harder hits for a moment.<br>Q: Focus Burst (50 focus).<br>Gamepad LB: dodge · RB: Focus Burst.<br>Elite enemies have extra health and drop focus and health.<br>Each stage clear is ranked S–C. A guarantees a rare or epic card; S adds a fourth card. Upgrades reset when the run ends.</p><div id="combat-build"></div><a href="index.html?scene=2&play=1">Start a new run</a></details>';
    const draftUI=document.createElement('div'); draftUI.id='upgrade-draft'; draftUI.hidden=true; draftUI.setAttribute('role','dialog'); draftUI.setAttribute('aria-modal','true'); draftUI.setAttribute('aria-labelledby','upgrade-title'); draftUI.innerHTML='<section><h2 id="upgrade-title"></h2><div id="upgrade-results"><div id="upgrade-rank" aria-label="Stage rank"></div><div id="upgrade-stats"></div></div><p id="upgrade-help"></p><div id="upgrade-cards"></div></section>';
    const callout=document.createElement('div'); callout.id='combat-callout'; callout.setAttribute('aria-hidden','true');
    document.body.append(hud,draftUI,callout); ui={hud,draft:draftUI,callout,last:''};
    addEventListener('keydown',e=>{
      if(!machine) return; const s=machine.arcadeCombat;
      if(s.offers.length) {
        e.stopImmediatePropagation(); const n=+e.key-1;
        if(n>=0&&n<s.offers.length){e.preventDefault();choose(s.offers[n]);}
        else if(e.code==='Tab'){e.preventDefault();const cards=[...document.querySelectorAll('#upgrade-cards button')],i=cards.indexOf(document.activeElement);cards[(i+(e.shiftKey?cards.length-1:1))%cards.length]?.focus();}
        return;
      }
      const t=e.target;if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||t?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName||''))return;
      if(e.code==='KeyQ'||e.code==='KeyC'){e.preventDefault();request(e.code==='KeyQ'?'special':'dodge');}
    },true);
  }
  function updateUI() {
    if(!ui||!machine) return; const s=machine.arcadeCombat,p=s.players[0];
    document.getElementById('combat-status').textContent=`HP ${machine.ram[0xa5b]}/${maximum(s)} · ${p.combo} HIT · BEST ${p.best} · ${s.won?'RUN CLEAR':'STAGE '+s.level} · ${Object.values(s.upgrades).reduce((a,b)=>a+b,0)} UPGRADES`;
    document.getElementById('combat-build').textContent='Build: '+(Object.entries(s.upgrades).map(([id,n])=>(UPGRADES.find(u=>u.id===id)?.name||id)+' ×'+n).join(', ')||'No upgrades yet')+(s.history.length?' · Ranks: '+s.history.map(h=>h.rank).join(' '):'');
    document.getElementById('combat-focus').value=p.focus; document.getElementById('combat-meter').textContent=`${p.focus}/100 (burst ${burstCost(s)})`;
    document.getElementById('combat-message').textContent=machine.frame<s.messageUntil?s.message:'↑+Attack launch · C dodge · Q special';
    document.getElementById('combat-counter').hidden=machine.frame>p.counterUntil;
    ui.draft.hidden=!s.offers.length;
    const key=s.offers.join(','); if(key&&key!==ui.last) {
      const res=s.results;
      document.getElementById('upgrade-title').textContent=`Stage ${s.pendingLevel} clear — choose your upgrade`;
      const rank=document.getElementById('upgrade-rank'); rank.textContent=res?res.rank:''; rank.dataset.rank=res?res.rank:'';
      const stats=document.getElementById('upgrade-stats'); stats.textContent='';
      if(res) for(const [label,value] of [['Time',`${Math.floor(res.secs/60)}:${String(res.secs%60).padStart(2,'0')}`],['Best combo',res.best],['KOs',res.kos],['Damage taken',res.taken],['Elites',res.elites],['Counters',res.counters]]) { const d=document.createElement('span'); d.textContent=`${label}: ${value}`; stats.appendChild(d); }
      document.getElementById('upgrade-help').textContent=`Choose one upgrade for this run. Press 1–${s.offers.length}.`+(res&&res.rank==='S'?' S rank: bonus fourth card.':res&&res.rank==='A'?' A rank: a rare or better card is guaranteed.':'');
      const cards=document.getElementById('upgrade-cards'); cards.textContent='';
      s.offers.forEach((id,i)=>{const u=UPGRADES.find(x=>x.id===id),b=document.createElement('button'),title=document.createElement('b'),tier=document.createElement('i'),desc=document.createElement('span');b.dataset.upgrade=id;b.dataset.rarity=u.rarity;title.textContent=`${i+1}. ${u.name}`;tier.textContent=RARITY[u.rarity].label+((s.upgrades[id]||0)?` · owned ×${s.upgrades[id]}`:'');desc.textContent=u.text;b.append(title,tier,desc);b.onclick=()=>choose(id);cards.appendChild(b);});
      cards.firstElementChild?.focus();
    } ui.last=key;
  }
  const api={enabled,create,install,beforeFrame,afterFrame,request,choose,rate,UPGRADES,RARITY,
    get drafting(){return !!machine?.arcadeCombat?.offers.length;},
    get blocked(){return !!machine?.arcadeCombat?.offers.length||now()<stopUntil;},
    assertOnline(){if(enabled&&machine)throw new Error('Arcade Remix is offline. Open ?mods=0 for online play.');}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else G.SIMPCOMBAT=api;
})(typeof window!=='undefined'?window:globalThis);
