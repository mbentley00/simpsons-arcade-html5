// Player input for The Simpsons (MAME simpsons.cpp: P1..P4 = KONAMI8_B12_START at 0x1f90-0x1f93, COIN 1-4 at 0x1f80
// bits 0-3, TEST at 0x1f81 bit 0; all active low). One byte per player per frame, active HIGH (netcode-ready):
//   bit 0 left, 1 right, 2 up, 3 down, 4 attack (BUTTON1), 5 jump (BUTTON2), 6 coin, 7 start  -> FrameInput = 4 bytes.
// Keyboard: P1 arrows/WASD, Z or J attack, X or K jump, 5 coin, 1 or Enter start.
//           P2 numpad 8/4/5(2)/6, numpad 0 or N attack, numpad . or M jump, 6 coin, 2 start.
//           P3 coin 7 start 3, P4 coin 8 start 4 (move with gamepads). F2 = service/test switch (hold).
// Gamepads (standard mapping): pad n = player n+1; d-pad/left stick, A/X attack, B/Y jump, Select coin, Start start.
// Also keeps the ER5911 EEPROM (high scores, settings) in localStorage across sessions.
(function (G) {
  'use strict';
  const L = 1, R = 2, U = 4, D = 8, FIRE = 16, JUMP = 32, COIN = 64, START = 128;
  const KEYMAP = [
    { ArrowLeft: L, ArrowRight: R, ArrowUp: U, ArrowDown: D, KeyA: L, KeyD: R, KeyW: U, KeyS: D,
      KeyZ: FIRE, KeyJ: FIRE, KeyX: JUMP, KeyK: JUMP, Digit5: COIN, Digit1: START, Enter: START },
    { Numpad4: L, Numpad6: R, Numpad8: U, Numpad5: D, Numpad2: D, Numpad0: FIRE, KeyN: FIRE, NumpadDecimal: JUMP, KeyM: JUMP,
      Digit6: COIN, Digit2: START },
    { Digit7: COIN, Digit3: START },
    { Digit8: COIN, Digit4: START },
  ];
  const SERVICE_KEY = 'F2';
  const held = {};
  // Readonly fields (the invite URL in the net overlay) are not typing: game keys must still work.
  // Edge latch: a keydown is kept until consumeLatch() after the emulator actually scheduled it,
  // so a tap during a netplay stall is not dropped when addLocal cannot write a new frame yet.
  const latched = {};
  const typing = e => {
    const t = e.target;
    if (!t || t.readOnly || t.disabled) return false;
    return !!(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  function attach(target) {
    target.addEventListener('keydown', e => { if (typing(e)) return; held[e.code] = 1; latched[e.code] = 1; if (/^(Arrow|Space|F2$)/.test(e.code)) e.preventDefault(); });
    target.addEventListener('keyup', e => { held[e.code] = 0; });
    target.addEventListener('blur', () => { for (const k in held) held[k] = 0; for (const k in latched) delete latched[k]; });
  }
  function padBits(p) {
    if (!p || !p.connected) return 0;
    const b = i => p.buttons[i] && p.buttons[i].pressed, ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    let v = 0;
    if (b(14) || ax < -0.5) v |= L; if (b(15) || ax > 0.5) v |= R;
    if (b(12) || ay < -0.5) v |= U; if (b(13) || ay > 0.5) v |= D;
    if (b(0) || b(2)) v |= FIRE; if (b(1) || b(3)) v |= JUMP; if (b(8)) v |= COIN; if (b(9)) v |= START;
    return v;
  }
  // Local devices -> FrameInput (Uint8Array(4)); block = true (chat field open) gives neutral input
  function sample() {
    const out = new Uint8Array(4);
    if (api.block) return out;
    for (let p = 0; p < 4; p++) for (const k in KEYMAP[p]) if (held[k] || latched[k]) out[p] |= KEYMAP[p][k];
    const pads = (G.navigator && navigator.getGamepads) ? navigator.getGamepads() : [];
    for (let i = 0; i < Math.min(4, pads.length); i++) out[i] |= padBits(pads[i]);
    for (let p = 0; p < 4; p++) out[p] = clean(out[p]);
    return out;
  }
  // opposite directions cancel on local devices (a real stick cannot press both); scripts/netcode apply as is
  function clean(b) { if ((b & 3) === 3) b &= ~3; if ((b & 12) === 12) b &= ~12; return b; }
  const PNAME = ['P1', 'P2', 'P3', 'P4'];
  function applyFrame(m, fi, test) {
    let coins = 0xff;
    for (let p = 0; p < 4; p++) { const b = fi[p] | 0; m.inputs[PNAME[p]] = 0xff & ~(b & 0xbf); if (b & COIN) coins &= ~(1 << p); }
    m.inputs.COIN = coins; m.inputs.service = test ? 0 : 1;
  }
  // MAME-style ports (P1..P4, COIN; active low) -> FrameInput
  function fromPorts(r) {
    const fi = new Uint8Array(4);
    for (let p = 0; p < 4; p++) { fi[p] = ~r[p] & 0xbf; if (!(r[4] & (1 << p))) fi[p] |= COIN; }
    return fi;
  }
  // ---- EEPROM persistence (128 bytes, hex in localStorage)
  const EEP_KEY = 'simpsons.eeprom.v1';
  let eepSaved = null, eepTick = 0;
  function eepromLoad() {
    try { const h = localStorage.getItem(EEP_KEY); if (!h || h.length !== 256) return null; const a = new Uint8Array(128); for (let i = 0; i < 128; i++) a[i] = parseInt(h.substr(2 * i, 2), 16); eepSaved = h; return a; } catch (e) { return null; }
  }
  function eepromSave(m, force) {
    const e = m && m.eep; if (!e || (!force && e.state !== 0)) return; // only between EEPROM transactions
    let h = ''; for (let i = 0; i < 128; i++) h += e.data[i].toString(16).padStart(2, '0');
    if (h !== eepSaved) { try { localStorage.setItem(EEP_KEY, h); eepSaved = h; } catch (x) {} }
  }
  function eepromClear() { try { localStorage.removeItem(EEP_KEY); } catch (e) {} eepSaved = null; }
  // ---- hooks used by game.js (offline play; netplay drives applyFrame itself)
  let machine = null;
  const SIMPI = {
    script: null, // test hook: function(frame) -> FrameInput, replaces the local devices
    apply(m) { machine = m; if (G.SSRNETPLAY && G.SSRNETPLAY.active && G.SSRNETPLAY.active()) return; applyFrame(m, SIMPI.script ? SIMPI.script(m.frame) : sample(), !SIMPI.script && !!held[SERVICE_KEY]); },
    onFrame(m) { machine = m; if (++eepTick % 60 === 0) eepromSave(m); },
    eepromLoad, eepromSave, eepromClear,
  };
  if (G.addEventListener) { attach(G); G.addEventListener('pagehide', () => eepromSave(machine)); G.addEventListener('visibilitychange', () => document.hidden && eepromSave(machine)); }
  const api = { block: false, L, R, U, D, FIRE, JUMP, COIN, START, KEYMAP, attach, sample, applyFrame, fromPorts, held,
    consumeLatch() { for (const k of Object.keys(latched)) delete latched[k]; } };
  if (typeof module !== 'undefined') module.exports = api; else { G.SSRIN = api; G.SIMPI = SIMPI; }
})(typeof window !== 'undefined' ? window : globalThis);
