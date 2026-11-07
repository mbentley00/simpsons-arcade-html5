// In-game chat (pt34u). TAB opens a text field, Enter sends, TAB/Esc cancels. The line appears as a speech bubble above
// the sender's character on every screen. Online it travels over the reliable DataChannel (session.chat / 't:c'), never
// through the rollback inputs, so it cannot desync the game. Offline (no room) it shows over P1 (local only).
// Bubbles are drawn on an overlay canvas over #screen (not by render.js), anchored to the player object in the main
// work RAM (see NOTES.md "Player positions"): player p's object is at 0x4a40+0xC0*p (board.ram offset 0x0a40+0xC0*p):
//   byte +0x00 flags (0x80/0x40/0x04 set while the player is in the game; 0 = not joined), word +0x0C X (screen
//   x ≈ X-54, already camera relative), byte +0x12 depth (feet y ≈ 374-depth-jump), byte +0x17 jump height.
(function (G) {
  'use strict';
  const W = 320, H = 224, MAXC = 60;
  const COL = ['#ffd23c', '#4aa8ff', '#5adc6a', '#ff6b5a'];
  const bubbles = [null, null, null, null], recent = [], specLines = []; // spectator lines: top of the screen, tagged with the name
  // ---- player positions (game pixels); null when not on screen ----
  const HEIGHT = [60, 50, 42, 42]; // Marge, Homer, Bart, Lisa (feet to top of the head/hair, game pixels)
  function playerPos(m, p) {
    const r = m && m.ram; if (!r || r.length < 0x1000) return null;
    const o = 0x0a40 + 0xc0 * p; if (!(r[o] & 0xc4)) return null;
    const x = (((r[o + 12] << 8) | r[o + 13]) << 16 >> 16) - 54, feet = 374 - r[o + 0x12] - r[o + 0x17];
    if (x < -8 || x > W + 8 || feet < 24 || feet > H + 40) return null;
    return { x, feet, head: feet - HEIGHT[p] };
  }
  // ---- overlay ----
  let ov = null, oc = null, field = null, open = false;
  function setup() {
    const scr = document.getElementById('screen');
    ov = Object.assign(document.createElement('canvas'), { id: 'chatov' });
    ov.style.cssText = 'position:absolute;pointer-events:none;z-index:5';
    scr.after(ov); oc = ov.getContext('2d');
    const css = `#chatin{position:fixed;left:50%;bottom:8%;transform:translateX(-50%);width:min(520px,80vw);z-index:11;display:none;
      font:600 18px system-ui,sans-serif;padding:8px 12px;border-radius:10px;border:3px solid #ffd23c;background:rgba(10,6,2,.92);color:#fff;outline:none}
      #chatin::placeholder{color:#a99}`;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
    field = Object.assign(document.createElement('input'), { id: 'chatin', maxLength: MAXC, autocomplete: 'off', spellcheck: false, placeholder: 'Mensagem (Enter envia, Esc cancela)' });
    document.body.appendChild(field);
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const t = field.value; close(); send(t); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    field.addEventListener('blur', () => { if (open) close(); });
    addEventListener('keydown', e => {
      if (e.code !== 'Tab' || open) return;
      if (e.target && e.target.tagName === 'INPUT') return; // the F7 panel's fields keep normal TAB
      e.preventDefault(); openField();
    });
  }
  function mySlot() { const N = G.SSRNETPLAY && G.SSRNETPLAY.session; return N ? N.slot : 0; }
  function openField() {
    open = true; G.SSRIN.block = true; for (const k in G.SSRIN.held) G.SSRIN.held[k] = 0;
    const s = Math.max(0, mySlot()); field.style.borderColor = COL[s]; field.value = '';
    field.style.display = 'block'; field.focus();
  }
  function close() { if (!open) return; open = false; G.SSRIN.block = false; field.style.display = 'none'; field.blur(); try { G.focus(); } catch (e) {} }
  const localRl = G.SSRSESSION ? new G.SSRSESSION.RateLimit() : null;
  // send a line: online through the session (it echoes a 'chat' event that calls show), offline as P1
  function send(text) {
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session;
    if (N) return N.chat(text);
    const x = G.SSRSESSION.sanitize(text); if (!x || !localRl.ok(performance.now())) return null;
    show(0, x); return x;
  }
  function show(slot, text, name) {
    const x = G.SSRSESSION.sanitize(text); if (!x || slot < -1 || slot > 3) return;
    if (slot === -1) {
      const n = G.SSRSESSION.sanitize(name || 'Espectador').slice(0, 20);
      specLines.push({ name: n, text: x, t0: performance.now(), dur: 5000 }); if (specLines.length > 3) specLines.shift();
      recent.push({ slot, name: n, text: x, t: Date.now() }); if (recent.length > 50) recent.shift(); return;
    }
    bubbles[slot] = { text: x, t0: performance.now(), dur: 4000 + Math.max(0, x.length - 20) * 60 };
    recent.push({ slot, text: x, t: Date.now() }); if (recent.length > 50) recent.shift();
  }
  function wrap(ctx, text, maxW) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
      while (ctx.measureText(cur).width > maxW && cur.length > 1) { let k = cur.length - 1; while (k > 1 && ctx.measureText(cur.slice(0, k)).width > maxW) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); }
    }
    if (cur) lines.push(cur); return lines;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function draw(m) {
    if (!ov) return;
    const scr = document.getElementById('screen'), cw = parseFloat(scr.style.width) || W, ch = parseFloat(scr.style.height) || H;
    const dpr = G.devicePixelRatio || 1, bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
    if (ov.width !== bw || ov.height !== bh) { ov.width = bw; ov.height = bh; }
    ov.style.left = scr.style.left; ov.style.top = scr.style.top; ov.style.width = cw + 'px'; ov.style.height = ch + 'px';
    const c = oc, k = bw / W, ky = bh / H, now = performance.now(); // 4:3 modes (gfx.js): non-square game pixels
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, bw, bh);
    c.setTransform(k, 0, 0, ky, 0, 0);
    drawSpec(c, now);
    if (G.SSRHINT) G.SSRHINT.draw(c, m, now); // coin hint (net/hint.js), also the spectator's free-slot notice
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session, names = N && N.rb ? N.names() : null; // nicknames: online only
    const nk = []; if (names) for (let p = 0; p < 4; p++) if (names[p] && !bubbles[p]) drawNick(c, m, p, names[p], nk);
    if (!bubbles.some(b => b)) return;
    const placed = [];
    for (let p = 0; p < 4; p++) {
      const b = bubbles[p]; if (!b) continue;
      const age = now - b.t0; if (age > b.dur) { bubbles[p] = null; continue; }
      const alpha = Math.min(1, age / 120, (b.dur - age) / 600);
      c.globalAlpha = alpha;
      c.font = '600 8px system-ui, sans-serif';
      const pos = playerPos(m, p), tail = 6;
      const lines = wrap(c, b.text, pos ? 118 : 60), lh = 9.5; // off screen: the bubble hangs under that player's HUD panel (72 px)
      const tw = Math.max(...lines.map(l => c.measureText(l).width)), w = Math.ceil(tw) + 10, h = lines.length * lh + 7;
      let ax, ay, up; // anchor (tail tip), bubble above (up=false) or below the HUD (up=true)
      if (pos) { ax = pos.x; ay = pos.head; up = false; if (ay - tail - h < 18) { ay = 18 + tail + h; } }
      else { ax = 72 * p + 30; ay = 20; up = true; }
      let bx = Math.round(Math.min(W - w - 2, Math.max(2, ax - w / 2))), by = Math.round(up ? ay + tail : ay - tail - h);
      // two players close together: push this bubble past the ones already drawn (the tail stretches)
      for (let tries = 0; tries < 4; tries++) {
        const hit = placed.find(r => bx < r.x + r.w + 1 && bx + w + 1 > r.x && by < r.y + r.h + 6 && by + h + 6 > r.y);
        if (!hit) break;
        by = up ? hit.y + hit.h + 8 : hit.y - h - 8;
        if (!up && by < 2) { by = hit.y + hit.h + 8; up = true; }
      }
      placed.push({ x: bx, y: by, w, h, p, ax, ay, up, lines, lh, alpha });
    }
    // tails first, then the bodies, so a stretched tail never crosses another bubble's text
    for (const r of placed) {
      c.globalAlpha = r.alpha; c.lineWidth = 1.5; c.strokeStyle = COL[r.p]; c.fillStyle = 'rgba(255,255,255,0.96)';
      const tx = Math.min(r.x + r.w - 6, Math.max(r.x + 6, r.ax));
      c.beginPath();
      if (r.up && r.ay <= r.y) { c.moveTo(tx - 3.5, r.y + 2); c.lineTo(tx, r.ay); c.lineTo(tx + 3.5, r.y + 2); }
      else if (r.up) { c.moveTo(tx - 3.5, r.y + 2); c.lineTo(tx, r.y - 5); c.lineTo(tx + 3.5, r.y + 2); }
      else { c.moveTo(tx - 3.5, r.y + r.h - 2); c.lineTo(tx, r.ay); c.lineTo(tx + 3.5, r.y + r.h - 2); }
      c.fill(); c.stroke();
    }
    for (const r of placed) {
      const { x: bx, y: by, w, h, p, lines, lh } = r;
      c.globalAlpha = r.alpha; c.lineWidth = 1.5; c.strokeStyle = COL[p]; c.fillStyle = 'rgba(255,255,255,0.96)';
      rr(c, bx, by, w, h, 4); c.fill(); c.stroke();
      // open the tail into the body: cover the border stroke across the tail base (white, no stroke)
      const tx = Math.min(bx + w - 6, Math.max(bx + 6, r.ax)); c.beginPath();
      if (r.up) { c.moveTo(tx - 2.6, by + 1.6); c.lineTo(tx, by - 2.2); c.lineTo(tx + 2.6, by + 1.6); }
      else { c.moveTo(tx - 2.6, by + h - 1.6); c.lineTo(tx, by + h + 2.2); c.lineTo(tx + 2.6, by + h - 1.6); }
      c.closePath(); c.fill();
      c.font = '600 8px system-ui, sans-serif';
      c.fillStyle = '#1a1208'; c.textBaseline = 'top';
      lines.forEach((l, i) => c.fillText(l, bx + 5, by + 4 + i * lh));
      c.font = '800 6px system-ui, sans-serif'; const tag = 'P' + (p + 1) + (names && names[p] ? ' ' + names[p] : ''), tgw = c.measureText(tag).width + 5;
      c.fillStyle = COL[p]; rr(c, bx - 1, by - 5, tgw, 7, 2); c.fill();
      c.fillStyle = '#000'; c.fillText(tag, bx + 1.5, by - 4.2);
    }
    c.globalAlpha = 1;
  }
  // nickname over the head (player colour, dark outline); hidden while the player object is not active/on screen
  function drawNick(c, m, p, name, nk) {
    const pos = playerPos(m, p); if (!pos) return;
    c.font = '700 6px system-ui, sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'center'; c.globalAlpha = 0.9;
    const w = c.measureText(name).width, x = Math.min(W - w / 2 - 2, Math.max(w / 2 + 2, pos.x)); let y = Math.max(26, pos.head - 2);
    for (let i = 0; i < 4; i++) { const hit = nk.find(r => Math.abs(r.x - x) < (r.w + w) / 2 + 2 && Math.abs(r.y - y) < 7); if (!hit) break; y = hit.y - 7; }
    nk.push({ x, y, w });
    c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineJoin = 'round'; c.strokeText(name, x, y);
    c.fillStyle = COL[p]; c.fillText(name, x, y); c.textAlign = 'left'; c.globalAlpha = 1;
  }
  // spectator overlay: an "ASSISTINDO" tag (+ free slot notice) for the spectator itself, and the spectators' chat lines
  function drawSpec(c, now) {
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session;
    c.textBaseline = 'top';
    if (N && N.spec) {
      c.globalAlpha = 0.85; c.font = '800 7px system-ui, sans-serif';
      const t = 'ASSISTINDO', w = c.measureText(t).width + 8; c.fillStyle = 'rgba(0,0,0,.6)'; rr(c, W - w - 3, H - 13, w, 10, 3); c.fill();
      c.fillStyle = '#9fe0ff'; c.fillText(t, W - w + 1, H - 11.5);
    }
    let y = 30;
    for (let i = 0; i < specLines.length; i++) {
      const l = specLines[i], age = now - l.t0; if (age > l.dur) { specLines.splice(i--, 1); continue; }
      c.globalAlpha = Math.min(1, age / 120, (l.dur - age) / 600);
      c.font = '700 6px system-ui, sans-serif'; const tag = l.name, tw = c.measureText(tag).width;
      c.font = '600 7px system-ui, sans-serif'; const lines = wrap(c, l.text, 200), mw = Math.max(...lines.map(x => c.measureText(x).width));
      const w = Math.ceil(Math.max(mw, tw)) + 10, h = lines.length * 8.5 + 11, x = Math.round((W - w) / 2);
      c.fillStyle = 'rgba(15,25,40,.85)'; c.strokeStyle = '#9fe0ff'; c.lineWidth = 1; rr(c, x, y, w, h, 3); c.fill(); c.stroke();
      c.fillStyle = '#9fe0ff'; c.font = '700 6px system-ui, sans-serif'; c.fillText(tag, x + 5, y + 2);
      c.fillStyle = '#fff'; c.font = '600 7px system-ui, sans-serif'; lines.forEach((t, j) => c.fillText(t, x + 5, y + 10 + j * 8.5));
      y += h + 3;
    }
    c.globalAlpha = 1;
  }
  G.SSRCHAT = { specLines, show, send, draw, playerPos, recent, bubbles, get open() { return open; }, openField, close, COL };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', setup); else setup();
})(window);
