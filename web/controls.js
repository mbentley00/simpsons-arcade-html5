// Local playback controls. Audio preferences affect output only; online emulation cannot be paused locally.
(function () {
  'use strict';
  const game = window.SIMPG;
  const style = document.createElement('style');
  style.textContent = `#playback{position:fixed;top:12px;left:12px;z-index:20;display:flex;gap:6px}
    #playback button{background:rgba(20,12,4,.9);color:#ffc861;border:1px solid #c8892e;border-radius:6px;padding:7px 10px;font:600 13px system-ui;cursor:pointer}
    #playback button:disabled{opacity:.5;cursor:default}#playback button:focus-visible{outline:2px solid #fff;outline-offset:2px}
    #pause-label{position:fixed;inset:0;display:grid;place-content:center;z-index:19;pointer-events:none;color:#ffc861;font:700 28px system-ui;text-shadow:0 2px 4px #000}
    #pause-label[hidden]{display:none}#pause-label span{background:rgba(0,0,0,.8);padding:16px 24px;border-radius:10px;text-align:center}
    #pause-label small{display:block;font-size:13px;font-weight:400;margin-top:6px}`;
  document.head.appendChild(style);
  const bar = document.createElement('div'); bar.id = 'playback'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Playback controls');
  const pause = document.createElement('button'); pause.id = 'game-pause'; pause.disabled = true; pause.setAttribute('aria-keyshortcuts', 'P');
  const sound = document.createElement('button'); sound.id = 'game-sound'; sound.title = 'Mute or unmute music and sound effects (F8)'; sound.setAttribute('aria-keyshortcuts', 'F8');
  bar.append(pause, sound); document.body.appendChild(bar);
  // Play as: pick your character (cabinet slot) without a coin; keys 1-4 do the same (input.js). Offline only.
  style.textContent += `#playas{display:flex;gap:4px;align-items:center;background:rgba(20,12,4,.9);border:1px solid #c8892e;border-radius:6px;padding:3px 6px;color:#ffc861;font:600 13px system-ui}
    #playas[hidden]{display:none}#playas button{padding:4px 8px;border-width:2px;color:#fff}#playas button[aria-pressed=true]{outline:2px solid #fff;outline-offset:1px}`;
  const CHAR_COL = ['#c8203c', '#2f6fd8', '#2c9c46', '#d98b10'];
  const playas = document.createElement('div'); playas.id = 'playas'; playas.setAttribute('role', 'group'); playas.setAttribute('aria-label', 'Play as');
  playas.append('Play as');
  const pick = (window.SSRIN ? SSRIN.NAMES : ['Marge', 'Homer', 'Bart', 'Lisa']).map((name, i) => {
    const b = document.createElement('button'); b.textContent = `${i + 1} ${name}`; b.style.background = CHAR_COL[i]; b.style.borderColor = CHAR_COL[i];
    b.title = `Play as ${name} (key ${i + 1}); no coin needed`;
    b.onclick = () => { if (window.SSRIN) SSRIN.choose(i); b.blur(); const scr = document.getElementById('screen'); if (scr) try { scr.focus(); } catch (e) {} };
    playas.append(b); return b;
  });
  bar.append(playas);
  const syncPick = () => { const on = window.SSRIN && !SSRIN.online(); playas.hidden = !on; const s = window.SSRIN ? SSRIN.slot : 0; pick.forEach((b, i) => b.setAttribute('aria-pressed', String(i === s))); };
  if (window.SSRIN) SSRIN.onChoose(syncPick);
  const label = document.createElement('div'); label.id = 'pause-label'; label.hidden = true; label.setAttribute('role', 'status');
  label.innerHTML = '<span>Paused<small>Press P or Resume to continue</small></span>'; document.body.appendChild(label);
  let ready = false;
  function update() {
    pause.disabled = !ready || !!game.net;
    pause.textContent = game.paused ? 'Resume (P)' : 'Pause (P)';
    pause.title = game.net ? 'Pause is unavailable in online rooms' : 'Pause or resume the game (P)';
    pause.setAttribute('aria-pressed', String(game.paused));
    sound.textContent = game.muted ? 'Unmute (F8)' : 'Mute audio (F8)';
    sound.setAttribute('aria-pressed', String(game.muted)); label.hidden = !game.paused; syncPick();
  }
  const togglePause = () => { if (!pause.disabled) game.pause(!game.paused); };
  pause.onclick = togglePause;
  sound.onclick = () => game.mute(!game.muted);
  addEventListener('keydown', e => {
    const t = e.target;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    if (e.code === 'KeyP' || e.code === 'Pause') { e.preventDefault(); togglePause(); }
    else if (e.code === 'F8') { e.preventDefault(); game.mute(!game.muted); }
  });
  game.onControlsChange = update;
  game.ready.then(() => { ready = true; update(); }, () => {}); update();
})();
