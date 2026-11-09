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
  const label = document.createElement('div'); label.id = 'pause-label'; label.hidden = true; label.setAttribute('role', 'status');
  label.innerHTML = '<span>Paused<small>Press P or Resume to continue</small></span>'; document.body.appendChild(label);
  let ready = false;
  function update() {
    pause.disabled = !ready || !!game.net;
    pause.textContent = game.paused ? 'Resume (P)' : 'Pause (P)';
    pause.title = game.net ? 'Pause is unavailable in online rooms' : 'Pause or resume the game (P)';
    pause.setAttribute('aria-pressed', String(game.paused));
    sound.textContent = game.muted ? 'Unmute (F8)' : 'Mute audio (F8)';
    sound.setAttribute('aria-pressed', String(game.muted)); label.hidden = !game.paused;
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
