// Coin hint (pt63u): "Press 5 to insert a coin, then 1 to join" at the bottom centre while the LOCAL player's slot is
// free. Overlay only (drawn by chat.js on #chatov): reads object RAM, never writes the sim, inputs, rollback or hashes.
// Language follows navigator.language (pt* -> Portuguese). Wording follows the last used device (keyboard / gamepad).
// After a coin key press (local, not read from RAM) it switches to "Press Z to join" until the player is in.
(function (G) {
  'use strict';
  const W = 320, H = 224;
  const PT = /^pt/i.test((G.navigator && navigator.language) || '');
  const TXT = PT
    ? { kb: 'Aperte 5 para colocar ficha, depois 1 para entrar', pad: 'Aperte Select para colocar ficha, depois Start para entrar', kbJ: 'Aperte 1 para entrar', padJ: 'Aperte Start para entrar', vaga: 'Vaga livre! Aperte 5 para entrar', vagaPad: 'Vaga livre! Aperte Select para entrar' }
    : { kb: 'Press 5 to insert a coin, then 1 to join', pad: 'Press Select to insert a coin, then Start to join', kbJ: 'Press 1 to join', padJ: 'Press Start to join', vaga: 'Slot free! Press 5 to join', vagaPad: 'Slot free! Press Select to join' };
  let dev = 'kb', coined = false, coinT = 0, padSeen = false;
  addEventListener('keydown', e => {
    dev = 'kb';
    if (e.code === 'Digit5') { coined = true; coinT = performance.now(); }
  }, true);
  function pollPads() {
    const pads = (G.navigator && navigator.getGamepads) ? navigator.getGamepads() : [];
    let any = false;
    for (const p of pads || []) {
      if (!p || !p.connected) continue; any = true;
      const act = p.buttons.some(b => b && b.pressed) || p.axes.some(a => Math.abs(a) > 0.5);
      if (act) dev = 'pad';
      if (p.buttons[8] && p.buttons[8].pressed) { coined = true; coinT = performance.now(); }
    }
    if (any && !padSeen) dev = 'pad'; // a pad just appeared: use its wording until a key is pressed
    padSeen = any; if (!any && dev === 'pad') dev = 'kb';
  }
  function active(m, p) { const r = m && m.ram; return !!r && !!(r[0x0a40 + 0xc0 * p] & 0xc4); } // player object flags (NOTES.md "Player positions")
  // text to show now, or null
  function text(m) {
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session;
    if (!m || !m.ram || (G.SSRCHAT && G.SSRCHAT.open) || G.SSRHINT.off) return null;
    pollPads();
    const pad = dev === 'pad';
    if (N && N.spec) return N.vaga ? (pad ? TXT.vagaPad : TXT.vaga) : null;
    const slot = N ? N.slot : 0; if (slot < 0 || slot > 3) return null;
    if (active(m, slot)) { coined = false; return null; }
    if (coined && performance.now() - coinT > 60000) coined = false;
    return coined ? (pad ? TXT.padJ : TXT.kbJ) : (pad ? TXT.pad : TXT.kb);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  // guest waiting for the host's state (pt77u: the game area was plain black while 'Conectando…')
  function waitText() {
    const P = G.SSRNETPLAY, N = P && P.session; if (!N || N.role !== 'guest' || N.rb) return null;
    const msg = (P.state && P.state.msg) || '';
    if (/retransmiss|relay server/.test(msg)) return PT ? ['Tentando via servidor de retransmissão…', ''] : ['Trying via relay server…', ''];
    if (/Não foi possível|Could not connect/.test(msg)) return PT ? ['Não foi possível conectar ao anfitrião', 'Veja o painel (F7)'] : ['Could not connect to the host', 'See the panel (F7)'];
    if (/Recebendo|Receiving/.test(msg)) return PT ? ['Recebendo o jogo do anfitrião…', ''] : ['Receiving the game from the host…', ''];
    return PT ? ['Conectando ao anfitrião…', ''] : ['Connecting to the host…', ''];
  }
  function draw(c, m, now) {
    const wt = waitText(); G.SSRHINT.waiting = wt ? wt[0] : null;
    if (wt) { c.save(); c.globalAlpha = 1; c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.globalAlpha = 0.75 + 0.25 * Math.cos(now / 400); c.fillStyle = '#ffc861'; c.font = '700 11px system-ui, sans-serif'; c.fillText(wt[0], W / 2, H / 2 - 6);
      if (wt[1]) { c.globalAlpha = 0.9; c.fillStyle = '#f3e2c0'; c.font = '600 8px system-ui, sans-serif'; c.fillText(wt[1], W / 2, H / 2 + 10); }
      c.restore(); G.SSRHINT.shown = null; return; }
    const t = text(m); G.SSRHINT.shown = t; if (!t) return;
    const a = 0.85 + 0.15 * Math.cos(now / 450); // gentle pulse
    c.save(); c.textBaseline = 'middle'; c.font = '700 7px system-ui, sans-serif';
    const w = Math.ceil(c.measureText(t).width) + 12, h = 11, x = Math.round((W - w) / 2), y = H - h - G.SSRHINT.bottom;
    c.globalAlpha = 0.62; c.fillStyle = '#000'; rr(c, x, y, w, h, 3); c.fill();
    c.globalAlpha = a; c.fillStyle = '#ffe9a8'; c.fillText(t, x + 6, y + h / 2 + 0.5);
    c.restore();
  }
  G.SSRHINT = { draw, text, TXT, PT, off: false, shown: null, waiting: null, waitText, bottom: 2, get dev() { return dev; }, set dev(v) { dev = v; }, get coined() { return coined; } };
})(window);
