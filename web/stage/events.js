// Scripted events for custom stages (offline only). An event fires once, when the camera brings its X to the middle of
// the screen. Events act on the running game the way the game's own attacks do: a hit writes the hit kind at +0x1e,
// health at +0x1b, the attacker pointer at +0x25 and sets flag 0x20; the object's handler plays the reaction on the
// next frame. Kinds confirmed in play: players 1 = flinch, 2 = knocked down; enemies 0x12 = flinch, 0x14 = knocked
// down. Run state is plain data on the board (m.stageEvents); pictures are drawn into the finished frame (drawOverlay).
(function (G) {
  'use strict';
  const TYPES = {
    ball: { name: 'Runaway ball', art: 'bowling', text: 'A giant bowling ball breaks loose and rolls down a player’s lane after a short warning. Anyone it reaches is knocked down: players and enemies alike. Jump or dodge it.' },
    pins: { name: 'Pin storm', art: 'bowling', text: 'The pinsetters go haywire: pins rain down around the players for about 5 seconds. Watch for their shadows.' },
    cosmic: { name: 'Cosmic bowling', art: 'bowling', text: 'Lights out: the alley switches to blacklight neon for 12 seconds.' },
    frenzy: { name: 'Ball-return frenzy', art: 'bowling', text: 'The ball return jams open: for 10 seconds bowling balls (B / RT) have almost no cooldown.' },
  };
  const DEFAULTS = { bowling: [{ type: 'pins', x: 620 }, { type: 'ball', x: 980 }, { type: 'cosmic', x: 1320 }, { type: 'frenzy', x: 1700 }, { type: 'ball', x: 2040 }] };
  const MAX = 24, WARN = 45, BALL_R = 13, PIN_FALL = 34;
  const word = (r, o) => ((r[o] << 8) | r[o + 1]) << 16 >> 16;
  const put = (r, o, v) => { r[o] = (v >> 8) & 255; r[o + 1] = v & 255; };
  function hit(r, o, health, kind, attacker) { r[o] &= ~0x20; r[o + 0x1e] = kind; r[o + 0x1b] = health; put(r, o + 0x25, 0x4000 + attacker); r[o] |= 0x20; }

  // type 'custom': an event made from a typed description; its recipe (web/stage/recipes.js) is stored with it and
  // works in any custom stage, with or without level art
  const RECIPE = () => G.SIMPRECIPE || (typeof require === 'function' ? require('./recipes.js') : null);
  const typesFor = art => Object.keys(TYPES).filter(t => TYPES[t].art === art);
  const defaults = art => (DEFAULTS[art] || []).map(e => ({ ...e }));
  const nameOf = ev => ev.type === 'custom' ? (ev.recipe && ev.recipe.name) || 'Custom event' : TYPES[ev.type] ? TYPES[ev.type].name : ev.type;
  function validate(list, art) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const e of list.slice(0, MAX)) {
      if (!e || typeof e !== 'object') continue;
      const x = Math.round(Number(e.x)); if (!Number.isFinite(x) || x < 0 || x > 8192) continue;
      if (e.type === 'custom') {
        const recipe = RECIPE() && RECIPE().normalize(e.recipe); if (!recipe) continue;
        out.push({ type: 'custom', x, prompt: String(e.prompt || '').slice(0, 600), recipe }); continue;
      }
      if (!TYPES[e.type] || TYPES[e.type].art !== art) continue;
      out.push({ type: e.type, x });
    }
    return out.sort((a, b) => a.x - b.x);
  }

  // opts: { events, set (level art, or null), st (the base stage's stage value, when there is no art) }
  let machine = null, video = null, cfg = null, saved = null;
  function install(m, vid, opts) {
    if (!opts || !(opts.set || opts.st) || !opts.events || !opts.events.length) return false;
    machine = m; video = vid; cfg = opts; saved = null;
    m.stageEvents = { fired: [], live: [], rng: 0x2545f491, banner: null, maxHp: [0, 0, 0, 0] };
    return true;
  }
  const inStage = m => m.ram[0x800] === 2 && (m.ram[0x875] & 0x7f) === ((cfg.set ? cfg.set.st : cfg.st) & 0x7f) && (!cfg.set || m.ram[0x876] === cfg.set.area);
  function rand(s, n) { s.rng ^= s.rng << 13; s.rng >>>= 0; s.rng ^= s.rng >>> 17; s.rng ^= s.rng << 5; s.rng >>>= 0; return s.rng % n; }
  function players(m) {
    const r = m.ram, c = word(r, 0x8ac), out = [];
    for (let p = 0; p < 4; p++) {
      const o = 0xa40 + p * 0xc0; if (!(r[o] & 0x40) || !r[o + 0x1b]) continue;
      out.push({ p, o, x: word(r, o + 12) - 54 + c, z: word(r, o + 0x11), air: word(r, o + 0x16) > 4, dodging: !!m.arcadeCombat && m.frame < m.arcadeCombat.players[p].dodgeUntil });
    }
    return out;
  }
  function enemies(m) {
    const r = m.ram, c = word(r, 0x8ac), out = [];
    for (let e = 0xd40; e < 0x1640; e += 0x60) if ((r[e] & 0x40) && !(r[e] & 4) && r[e + 0x1b]) out.push({ o: e, x: word(r, e + 12) - 54 + c, z: word(r, e + 0x11), air: word(r, e + 0x16) > 4 });
    return out;
  }
  function banner(s, m, text, color) { s.banner = { text, color, at: m.frame }; }
  function start(m, ev, i) {
    const s = m.stageEvents, c = word(m.ram, 0x8ac), ps = players(m), f = m.frame;
    if (ev.type === 'ball') {
      const t = ps.length ? ps[rand(s, ps.length)] : { z: 176 }, dir = i % 2 ? 1 : -1;
      s.live.push({ t: 'ball', at: f, z: t.z, dir, x: dir < 0 ? c + 344 : c - 24, hit: [] }); banner(s, m, 'LOOK OUT!', 'red');
    } else if (ev.type === 'pins') { s.live.push({ t: 'pins', at: f, until: f + 300, pins: [], n: 0 }); banner(s, m, 'PIN STORM!', 'white'); }
    else if (ev.type === 'cosmic') { s.live.push({ t: 'cosmic', at: f, until: f + 720 }); banner(s, m, 'COSMIC BOWLING!', 'purple'); }
    else if (ev.type === 'frenzy') { s.live.push({ t: 'frenzy', at: f, until: f + 600 }); banner(s, m, m.arcadeCombat ? 'FREE BALLS! PRESS B!' : 'BALL RETURN JAMMED!', 'cyan'); }
    else if (ev.type === 'custom' && RECIPE()) { s.live.push(RECIPE().start(m, ev.recipe, f)); if (ev.recipe.banner) banner(s, m, ev.recipe.banner, ev.recipe.color); }
  }
  // what a recipe may use: the same player/enemy lists and hit write as the built-in events
  const env = {
    players, enemies, cam: m => word(m.ram, 0x8ac), rand: n => rand(machine.stageEvents, n),
    hit: (r, o, health, kind) => hit(r, o, health, kind, o >= 0xd40 ? 0xa40 : 0xf80),
    banner: (text, color) => banner(machine.stageEvents, machine, text, color),
    maxHealth: (m, p) => m.arcadeCombat ? 40 + 8 * (m.arcadeCombat.upgrades.vitality || 0) : Math.max(1, m.stageEvents.maxHp[p]),
  };
  function stepBall(m, b) {
    const r = m.ram, age = m.frame - b.at, c = word(r, 0x8ac);
    if (age < WARN) return true;
    b.x += b.dir * 5;
    let struck = 0;
    for (const p of players(m)) {
      if (b.hit.includes(p.o) || p.air || p.dodging || Math.abs(p.x - b.x) >= BALL_R + 6 || Math.abs(p.z - b.z) >= 10) continue;
      b.hit.push(p.o); hit(r, p.o, Math.max(1, r[p.o + 0x1b] - 5), 2, 0xf80);
    }
    for (const e of enemies(m)) {
      if (b.hit.includes(e.o) || e.air || Math.abs(e.x - b.x) >= BALL_R + 6 || Math.abs(e.z - b.z) >= 10) continue;
      b.hit.push(e.o); hit(r, e.o, Math.max(0, r[e.o + 0x1b] - 10), 0x14, 0xa40); struck++;
    }
    if (struck && b.hit.filter(o => o >= 0xd40).length === 3) banner(m.stageEvents, m, 'STRIKE!', 'cyan');
    return age < 420 && (b.dir < 0 ? b.x > c - 40 : b.x < c + 360);
  }
  function stepPins(m, ev) {
    const s = m.stageEvents, r = m.ram, f = m.frame;
    if (f < ev.until && (f - ev.at) % 15 === 0) {
      const ps = players(m);
      if (ps.length) { const t = ps[ev.n++ % ps.length]; ev.pins.push({ x: t.x + rand(s, 129) - 64, z: Math.max(150, Math.min(240, t.z + rand(s, 25) - 12)), born: f, spin: rand(s, 2) ? 1 : -1 }); }
    }
    for (const pin of ev.pins) if (f - pin.born === PIN_FALL) {
      for (const p of players(m)) if (!p.dodging && Math.abs(p.x - pin.x) < 11 && Math.abs(p.z - pin.z) < 9) hit(r, p.o, Math.max(1, r[p.o + 0x1b] - 3), 1, 0xf80);
      for (const e of enemies(m)) if (Math.abs(e.x - pin.x) < 11 && Math.abs(e.z - pin.z) < 9) hit(r, e.o, Math.max(0, r[e.o + 0x1b] - 5), 0x12, 0xa40);
    }
    ev.pins = ev.pins.filter(p => f - p.born < PIN_FALL + 40);
    return f < ev.until || ev.pins.length > 0;
  }
  // blacklight: dark surfaces drop to deep violet, bright or saturated paint glows
  function cosmicPens(on) {
    if (!video || !video.pens || !cfg.set) return;
    const set = cfg.set, n = set.palette.length / 3, B = 0x2000, SHADE = 0x2100;
    if (video.pens.length < SHADE + 256) return;
    if (!saved) saved = video.pens.slice(B, SHADE + 256);
    for (let i = 1; i < n; i++) {
      let r = set.palette[3 * i], g = set.palette[3 * i + 1], b = set.palette[3 * i + 2];
      if (on) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, lum = (r * 3 + g * 6 + b) / 10;
        if (lum > 200 || (sat > 0.55 && mx > 120)) { const k = 255 / Math.max(1, mx); r = Math.min(255, r * k * 0.7 + 60); g = Math.min(255, g * k * 0.6 + 20); b = Math.min(255, b * k + 90); }
        else { const v = lum * 0.22; r = v * 0.9 + 14; g = v * 0.5 + 4; b = v * 1.3 + 30; }
      }
      r |= 0; g |= 0; b |= 0;
      video.pens[B + i] = (r << 16) | (g << 8) | b; video.pens[SHADE + i] = ((r * 0.6) << 16) | ((g * 0.6) << 8) | (b * 0.6);
    }
  }
  function beforeFrame(m) {
    if (!cfg || m !== machine || !m.stageEvents) return;
    const s = m.stageEvents;
    if (!inStage(m)) { if (s.live.length) { s.live = []; cosmicPens(false); } return; }
    const c = word(m.ram, 0x8ac);
    for (const p of players(m)) s.maxHp[p.p] = Math.max(s.maxHp[p.p], m.ram[p.o + 0x1b]);
    cfg.events.forEach((ev, i) => { if (!s.fired.includes(i) && c + 160 >= ev.x) { s.fired.push(i); start(m, ev, i); } });
    let cosmic = false;
    s.live = s.live.filter(ev => {
      if (ev.t === 'ball') return stepBall(m, ev);
      if (ev.t === 'pins') return stepPins(m, ev);
      if (ev.t === 'cosmic') { const age = m.frame - ev.at, left = ev.until - m.frame; cosmic = age < 40 ? (age >> 3) % 2 === 0 : left < 40 ? (left >> 3) % 2 === 1 : true; return m.frame < ev.until; }
      if (ev.t === 'frenzy') { if (m.arcadeCombat) for (const a of m.arcadeCombat.players) a.throwReady = Math.min(a.throwReady || 0, m.frame + 5); return m.frame < ev.until; }
      if (ev.t === 'recipe') return RECIPE().step(m, ev, env);
      return false;
    });
    if (cosmic || s.cosmicOn) cosmicPens(cosmic); s.cosmicOn = cosmic;
  }

  // ---------- pictures, drawn into the finished 320x224 frame (ABGR words) after the game's own picture
  const SW = 320, SH = 224;
  const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  const C = { ink: rgb(14, 10, 20), white: rgb(250, 248, 240), red: rgb(230, 40, 50), cyan: rgb(110, 232, 255), purple: rgb(222, 140, 255), gold: rgb(255, 204, 72),
    ball: rgb(30, 34, 70), ball2: rgb(70, 40, 130), ballHi: rgb(170, 160, 255), pinShade: rgb(196, 190, 180) };
  const put1 = (px, x, y, c) => { if (x >= 0 && x < SW && y >= 0 && y < SH) px[y * SW + x] = c; };
  function darken(px, x, y) { if (x >= 0 && x < SW && y >= 0 && y < SH) px[y * SW + x] = (0xff000000 | ((px[y * SW + x] >>> 1) & 0x7f7f7f)) >>> 0; }
  function shadow(px, sx, feet, w) { for (let y = -2; y <= 2; y++) for (let x = -w; x <= w; x++) if ((x * x) / (w * w) + (y * y) / 4 <= 1) darken(px, sx + x, feet + y); }
  function drawBall(px, b, c, f) {
    const age = f - b.at;
    if (age < WARN) { // warning arrow at the screen edge on the ball's lane
      if ((age >> 2) % 2) return;
      const ex = b.dir < 0 ? SW - 12 : 11, y = 374 - b.z - 8;
      for (let i = 0; i < 9; i++) for (let j = -i; j <= i; j++) put1(px, ex + (b.dir < 0 ? i - 4 : 4 - i), y + j, C.red);
      return;
    }
    const sx = Math.round(b.x - c), feet = 374 - b.z, cy = feet - BALL_R, R = BALL_R;
    shadow(px, sx, feet, R + 2);
    for (let y = -R - 1; y <= R + 1; y++) for (let x = -R - 1; x <= R + 1; x++) {
      const d = x * x + y * y; if (d > (R + 1) * (R + 1)) continue;
      put1(px, sx + x, cy + y, d > R * R ? C.ink : ((x * 3 + y * 5 + Math.round(b.x / 3)) & 15) < 3 ? C.ball2 : C.ball);
    }
    for (let i = 0; i < 4; i++) put1(px, sx - 6 + i, cy - 7 + (i >> 1), C.ballHi);
    const a = (b.x / 6) * b.dir;
    for (const k of [0, 0.6, -0.6]) { const hx = Math.round(sx + Math.cos(a + k) * 6), hy = Math.round(cy + Math.sin(a + k) * 6); put1(px, hx, hy, C.ink); put1(px, hx + 1, hy, C.ink); put1(px, hx, hy + 1, C.ink); put1(px, hx + 1, hy + 1, C.ink); }
  }
  const PIN = ['..##..', '.####.', '.####.', '..##..', '..##..', '.#rr#.', '.####.', '######', '######', '######', '######', '.####.', '.####.', '..##..'];
  function drawPin(px, sx, y, tipped, dir) {
    for (let j = 0; j < PIN.length; j++) for (let i = 0; i < 6; i++) {
      const ch = PIN[j][i]; if (ch === '.') continue;
      const col = ch === 'r' ? C.red : i >= 4 ? C.pinShade : C.white;
      if (tipped) put1(px, sx + (dir > 0 ? j - 7 : 7 - j), y - 6 + i, col); else put1(px, sx - 3 + i, y - PIN.length + j, col);
    }
  }
  function drawPins(px, ev, c, f) {
    for (const p of ev.pins) {
      const age = f - p.born, sx = Math.round(p.x - c), feet = 374 - p.z;
      if (age < PIN_FALL) { const t = age / PIN_FALL; shadow(px, sx, feet, Math.max(1, Math.round(6 * t))); drawPin(px, sx, Math.round(feet - (1 - t * t) * 140), false, p.spin); }
      else if (age < PIN_FALL + 40 && (age < PIN_FALL + 28 || (age >> 1) % 2)) { shadow(px, sx, feet, 7); drawPin(px, sx, feet, true, p.spin); }
    }
  }
  function drawOverlay(px) {
    const m = machine; if (!cfg || !m || !m.stageEvents) return false;
    const s = m.stageEvents, f = m.frame, c = word(m.ram, 0x8ac); let drew = false;
    if (!inStage(m)) return false;
    for (const ev of s.live) if (ev.t === 'recipe' && RECIPE().drawScreen(px, ev, f)) drew = true; // shake and tints under the objects
    for (const ev of s.live) {
      if (ev.t === 'ball') { drawBall(px, ev, c, f); drew = true; }
      else if (ev.t === 'pins') { drawPins(px, ev, c, f); drew = true; }
      else if (ev.t === 'recipe' && RECIPE().drawObjects(px, ev, c, f)) drew = true;
    }
    const gfx = G.SIMPCOMBAT && SIMPCOMBAT.gfx;
    if (gfx) {
      const fr = s.live.find(ev => ev.t === 'frenzy');
      if (fr && m.arcadeCombat) { gfx.text(px, 238, 44, 'FREE BALLS ' + Math.ceil((fr.until - f) / 60), gfx.COL.cyan, 1); drew = true; }
      if (s.banner && f - s.banner.at < 110) {
        const age = f - s.banner.at; if (age < 90 || (age >> 2) % 2) gfx.center(px, 58, s.banner.text, gfx.COL[s.banner.color] || gfx.COL.gold, age < 8 ? 3 : 2);
        drew = true;
      }
    }
    return drew;
  }
  const api = { TYPES, DEFAULTS, typesFor, defaults, nameOf, validate, install, beforeFrame, drawOverlay, hit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else G.SIMPEVENTS = api;
})(typeof window !== 'undefined' ? window : globalThis);
