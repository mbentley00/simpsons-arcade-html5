// Friendly custom NPCs are presentation objects, never native enemy actors or wave-clear targets.
(function(G){
  'use strict';
  const q=new URLSearchParams(location.search),enabled=q.get('mods')!=='0'&&!q.has('sala');
  let m=null,prompt=null,dialog=null,tags=null,requested=false,opened=false,wasPaused=false;
  function nearest(board){
    if(!board||!(board.ram[0xa40]&0x40))return null;
    const r=board.ram,x=((r[0xa4c]<<8)|r[0xa4d])-54,feet=374-((r[0xa51]<<8)|r[0xa52])-r[0xa57];
    return SIMPENEMY.npcPositions(board).filter(n=>n.dialogue&&Math.abs(n.x-x)<52&&Math.abs(n.feet-feet)<36).sort((a,b)=>Math.abs(a.x-x)-Math.abs(b.x-x))[0]||null;
  }
  function close(){
    if(!opened)return;opened=false;dialog.hidden=true;
    if(G.SSRIN){SSRIN.block=false;for(const k in SSRIN.held)SSRIN.held[k]=0;SSRIN.consumeLatch();}
    G.SIMPG.pause(wasPaused);
  }
  function install(board){
    if(!enabled||!Object.values(board.stageNPCs||{}).some(rows=>rows.length))return;
    m=board;
    const style=document.createElement('style');style.textContent='#npc-prompt{position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:25;padding:7px 12px;border-radius:6px;background:#121c24;color:#91dfff;font:14px system-ui}#npc-prompt[hidden],#npc-dialog[hidden]{display:none}#npc-dialog{position:fixed;inset:0;z-index:45;display:grid;place-content:end center;padding:0 16px 8vh;background:rgba(0,0,0,.25)}#npc-dialog section{width:min(520px,80vw);padding:20px;border:2px solid #80d4f6;border-radius:10px;background:#15212c;color:#fff1d5;font:16px system-ui}#npc-dialog h3{margin:0;color:#91dfff}#npc-dialog button{padding:6px 14px;cursor:pointer}';document.head.appendChild(style);
    prompt=document.createElement('div');prompt.id='npc-prompt';prompt.hidden=true;
    dialog=document.createElement('div');dialog.id='npc-dialog';dialog.hidden=true;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','npc-name');dialog.innerHTML='<section><h3 id="npc-name"></h3><p id="npc-text"></p><button id="npc-close">Close (E / Esc)</button></section>';
    document.body.append(prompt,dialog);document.getElementById('npc-close').onclick=close;
    tags=document.createElement('div');tags.id='npc-tags';tags.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:12';document.body.appendChild(tags);
    addEventListener('keydown',e=>{
      if(opened){e.stopImmediatePropagation();if(e.code==='Tab'){e.preventDefault();document.getElementById('npc-close').focus();}if(e.code==='KeyE'||e.code==='Escape'||e.code==='KeyP'){e.preventDefault();close();}return;}
      const t=e.target;if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||t?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName||''))return;
      if(e.code==='KeyE'&&nearest(m)&&!G.SIMPCOMBAT?.drafting){e.preventDefault();requested=true;}
    },true);
  }
  function beforeFrame(board){
    if(!m||board!==m||opened)return;
    const screen=document.getElementById('screen').getBoundingClientRect(); tags.textContent='';
    for(const npc of SIMPENEMY.npcPositions(m))if(npc.x>=0&&npc.x<320&&npc.feet>0&&npc.feet<250){
      const label=document.createElement('span');label.textContent=npc.name+' · NPC';
      label.style.cssText='position:absolute;transform:translate(-50%,-100%);font:11px system-ui;color:#91dfff;background:rgba(10,20,30,.8);padding:2px 4px;border-radius:3px';
      label.style.left=screen.left+npc.x*screen.width/320+'px';label.style.top=screen.top+(npc.feet-63)*screen.height/224+'px';tags.appendChild(label);
    }
    const n=nearest(m);prompt.hidden=!n||!!G.SIMPCOMBAT?.drafting;if(n)prompt.textContent='E · Talk to '+n.name;
    if(requested){requested=false;if(n){wasPaused=G.SIMPG.paused;G.SIMPG.pause(true);if(G.SSRIN)SSRIN.block=true;document.getElementById('npc-name').textContent=n.name;document.getElementById('npc-text').textContent=n.dialogue;dialog.hidden=false;opened=true;document.getElementById('npc-close').focus();}}
  }
  G.SIMPNPC={install,beforeFrame,nearest,get blocked(){return opened;}};
})(window);
