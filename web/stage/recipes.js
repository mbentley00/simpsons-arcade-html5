// Prompt-made scripted events (offline only). A sentence typed in the editor ("donuts rain from the sky and the lights
// go out") becomes a recipe: plain JSON built from a fixed set of building blocks (things that roll across the screen,
// things that fall, blasts, screen tints, shaking, healing, ball frenzy, messages). The game runs the recipe with the
// same native hit writes as the Bowling Alley events (web/stage/events.js); no generated code is ever run.
//
// A recipe comes from Claude (generate(), with the user's own API key) or, without a key, from fromText(), a small
// keyword reader. Either way it goes through normalize(), which clamps every field, so a saved recipe is always safe.
//
//   recipe = { name, banner, color, summary, actions: [action] }
//   action = { kind, delay, duration, object, from, target, effect, damage, count, speed, size, tint, amount, text }
(function (G) {
  'use strict';
  const KINDS = ['projectile', 'rain', 'blast', 'tint', 'shake', 'heal', 'frenzy', 'banner'];
  const OBJECTS = ['ball', 'pin', 'donut', 'rock', 'fireball', 'can', 'bomb', 'pie', 'anvil'];
  const TINTS = ['none', 'night', 'blacklight', 'red', 'green', 'sepia', 'invert', 'flash'];
  const COLORS = ['gold', 'red', 'cyan', 'white', 'purple', 'green', 'orange'];
  const MAX_ACTIONS = 6, MODEL = 'claude-opus-5-5', SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
  const SPEED = { slow: 3, medium: 5, fast: 8 }, SIZE = { small: 7, medium: 11, large: 16 };

  // ---------- recipe format
  const pick = (v, list, d) => list.includes(v) ? v : d;
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const str = (v, n, d = '') => String(v == null ? d : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  function normalize(r) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.actions)) return null;
    const actions = [];
    for (const a of r.actions.slice(0, MAX_ACTIONS)) {
      if (!a || !KINDS.includes(a.kind)) continue;
      actions.push({
        kind: a.kind, delay: Math.round(num(a.delay, 0, 30, 0) * 10) / 10, duration: Math.round(num(a.duration, 0.5, 30, 5) * 10) / 10,
        object: pick(a.object, OBJECTS, 'ball'), from: pick(a.from, ['left', 'right', 'both'], 'right'), target: pick(a.target, ['players', 'enemies', 'everyone'], 'everyone'),
        effect: pick(a.effect, ['flinch', 'knockdown'], 'flinch'), damage: Math.round(num(a.damage, 0, 20, 4)), count: Math.round(num(a.count, 1, 12, 1)),
        speed: pick(a.speed, Object.keys(SPEED), 'medium'), size: pick(a.size, Object.keys(SIZE), 'medium'), tint: pick(a.tint, TINTS, 'none'),
        amount: Math.round(num(a.amount, 0, 40, 8)), text: str(a.text, 24).toUpperCase(),
      });
    }
    if (!actions.length) return null;
    return { name: str(r.name, 32, 'Custom event') || 'Custom event', banner: str(r.banner, 24).toUpperCase(), color: pick(r.color, COLORS, 'gold'), summary: str(r.summary, 400), actions };
  }
  const SCHEMA = {
    type: 'object', additionalProperties: false, required: ['name', 'banner', 'color', 'summary', 'actions'],
    properties: {
      name: { type: 'string', description: 'Short name for the editor list, at most 32 characters' },
      banner: { type: 'string', description: 'Headline flashed on screen when the event starts, at most 24 characters, or empty' },
      color: { type: 'string', enum: COLORS },
      summary: { type: 'string', description: 'One or two plain sentences for the level designer: what will happen, and anything asked for that the building blocks cannot do' },
      actions: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['kind', 'delay', 'duration', 'object', 'from', 'target', 'effect', 'damage', 'count', 'speed', 'size', 'tint', 'amount', 'text'],
          properties: {
            kind: { type: 'string', enum: KINDS }, delay: { type: 'number' }, duration: { type: 'number' }, object: { type: 'string', enum: OBJECTS },
            from: { type: 'string', enum: ['left', 'right', 'both'] }, target: { type: 'string', enum: ['players', 'enemies', 'everyone'] },
            effect: { type: 'string', enum: ['flinch', 'knockdown'] }, damage: { type: 'integer' }, count: { type: 'integer' },
            speed: { type: 'string', enum: Object.keys(SPEED) }, size: { type: 'string', enum: Object.keys(SIZE) }, tint: { type: 'string', enum: TINTS },
            amount: { type: 'integer' }, text: { type: 'string' },
          },
        },
      },
    },
  };
  const SYSTEM = `You turn a level designer's description of a scripted event into a recipe for a side-scrolling beat-'em-up starring the Simpsons (up to 4 players fight waves of goons; the screen is 320x224 and scrolls right). The event fires once when the camera reaches its spot. You cannot write code: build the event only from these actions (1 to ${MAX_ACTIONS}). Every action has every field; fields an action does not use are ignored, so give them any allowed value.

- projectile: "count" objects roll or fly across the screen along a target's walking lane after a short flashing warning arrow, one after another spread over "duration" seconds. Uses object, from (left/right/both alternate), target (whose lane is aimed at AND who gets hit: players, enemies or everyone), effect, damage, speed, size. Jumping or dodging players are missed.
- rain: objects fall from the sky onto a growing shadow near the targets for "duration" seconds; "count" = objects per second (1-12). Uses object, target, effect, damage, size.
- blast: an instant shockwave/explosion that hits every target on screen. Uses target, effect, damage.
- tint: recolours the whole screen for "duration" seconds. tint: night (dark blue, lights out), blacklight (neon glow), red (pulsing alarm), green (toxic), sepia (old film), invert (negative), flash (white flash fading out).
- shake: shakes the screen for "duration" seconds; amount = strength 1-6.
- heal: players regain "amount" health (1-40) at once.
- frenzy: for "duration" seconds the bowling-ball throw (B button) has no cooldown.
- banner: shows "text" (at most 24 characters) at its delay.

"delay" is seconds after the event fires (0-30); "duration" is 0.5-30 seconds. damage 0-20 (enemies have about 12-30 health, players 40; players never drop below 1 from events). effect: flinch (a stagger) or knockdown (thrown to the floor). Objects available: ${OBJECTS.join(', ')}; pick the closest one (e.g. boulders = rock, beer = can, explosion = bomb, cream pie = pie). Sequence actions with delays to tell a little story. Spawning new characters, moving the camera, changing music or sound, and anything else outside these actions is not possible: approximate what you can and say what was left out in "summary".`;

  // ---------- Claude (the designer's own API key, kept only in their browser)
  let sdk = null;
  async function generate(prompt, apiKey, fetchImpl) {
    prompt = str(prompt, 600); if (!prompt) throw new Error('Describe the event first.');
    if (!sdk) sdk = import(SDK).then(m => m.default || m.Anthropic);
    const Anthropic = await sdk;
    // the key is the designer's own and never leaves their browser except to the API
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
    const req = {
      model: MODEL, max_tokens: 16000, system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    };
    let res;
    try { res = await client.beta.messages.create({ ...req, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }); }
    catch (e) { if (e && e.status === 400 && /fallback/i.test(e.message || '')) res = await client.messages.create(req); else throw e; }
    if (res.stop_reason === 'refusal') throw new Error('Claude declined to make this event. Try describing it differently.');
    if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try a shorter description.');
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const recipe = normalize(JSON.parse(text));
    if (!recipe) throw new Error('Claude returned an event with no usable actions.');
    return recipe;
  }

  // ---------- built-in reader: common words to building blocks, for use without an API key
  const OBJ_WORDS = [['donut', /\bdo(ugh)?nuts?\b/], ['pie', /\bpies?\b/], ['can', /\b(cans?|duff|beers?|soda)\b/], ['bomb', /\b(bombs?|explosives?|dynamite|tnt)\b/],
    ['fireball', /\b(fire ?balls?|fire|flames?|meteors?|lava)\b/], ['rock', /\b(rocks?|boulders?|stones?|rubble|debris)\b/], ['anvil', /\banvils?\b/],
    ['pin', /\bpins?\b/], ['ball', /\b(balls?|bowling)\b/]];
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
  function fromText(prompt) {
    const t = ' ' + str(prompt, 600).toLowerCase() + ' ';
    if (!t.trim()) return null;
    const n = s => s in WORDNUM ? WORDNUM[s] : Number(s);
    const NUM = '(\\d+|' + Object.keys(WORDNUM).join('|') + ')';
    const secs = (t.match(new RegExp('\\b' + NUM + '\\s*(?:seconds?|secs?|s)\\b')) || [])[1], dur = secs ? n(secs) : 0;
    const times = (t.match(new RegExp('\\b' + NUM + '\\s+(?:times\\b|(?!seconds?\\b|secs?\\b)(?:\\w+\\s+)?\\w+s\\b)')) || [])[1], cnt = times ? n(times) : 0;
    const obj = (OBJ_WORDS.find(([, re]) => re.test(t)) || ['ball'])[0];
    const target = /\b(only|just)\s+(the\s+)?(enem|goon|bad)/.test(t) || /\b(hits?|smash|crush)\w*\s+(the\s+|all\s+)?(enem|goon|bad)/.test(t) ? 'enemies'
      : /\b(only|just)\s+(the\s+)?players?\b/.test(t) || /\b(hurts?|hits?)\s+(the\s+)?players?\b/.test(t) ? 'players' : 'everyone';
    const effect = /\b(knock|flatten|crush|smash|launch|explo|blast|bowl(s|ed)? over|down)/.test(t) ? 'knockdown' : 'flinch';
    const speed = /\b(fast|quick|speed|zoom|rocket)/.test(t) ? 'fast' : /\b(slow|creep|lazy)/.test(t) ? 'slow' : 'medium';
    const size = /\b(giant|huge|big|massive|enormous|large)/.test(t) ? 'large' : /\b(small|tiny|little|mini)/.test(t) ? 'small' : 'medium';
    const from = /\bfrom (the )?left\b|\bleft to right\b/.test(t) ? 'left' : /\b(both (sides|ways|directions)|every direction|all sides)\b/.test(t) ? 'both' : 'right';
    const base = { delay: 0, duration: dur || 6, object: obj, from, target, effect, damage: effect === 'knockdown' ? 6 : 4, count: 1, speed, size, tint: 'none', amount: 8, text: '' };
    const actions = [], add = (kind, o) => actions.push({ ...base, kind, ...o });
    let tint = null;
    if (/\b(lights? (go )?out|darkness|dark|night|blackout|power ?(cut|out|outage))\b/.test(t)) tint = 'night';
    else if (/\b(blacklight|black light|neon|disco|cosmic|rave|party)\b/.test(t)) tint = 'blacklight';
    else if (/\b(alarm|red alert|emergency|siren|danger)\b/.test(t)) tint = 'red';
    else if (/\b(toxic|radioactive|nuclear|slime|poison|green)\b/.test(t)) tint = 'green';
    else if (/\b(sepia|old (film|movie|timey)|flashback|olden)\b/.test(t)) tint = 'sepia';
    else if (/\b(invert|negative|upside)\b/.test(t)) tint = 'invert';
    const rain = /\b(rain|falls?|falling|drops?|dropping|from (the )?(sky|above|ceiling|roof)|shower|hail|storm)\b/.test(t);
    const roll = /\b(roll|rolling|rolls|across|charge|charging|fly|flies|flying|shoot|launch|stampede|barrel|zoom|runaway|thrown?)\b/.test(t);
    const blast = /\b(explo\w*|blast|shock ?wave|kaboom|boom|nuke|earthquake|quake|thunder|lightning|smite)\b/.test(t) && !rain;
    if (rain) add('rain', { count: Math.min(12, Math.max(1, cnt || (size === 'large' ? 1 : 3))), duration: dur || 5 });
    if (roll || (!rain && !blast && !tint && OBJ_WORDS.some(([, re]) => re.test(t)))) add('projectile', { count: Math.min(12, Math.max(1, cnt || 1)), duration: Math.max(1, dur || 1), delay: actions.length ? 1 : 0 });
    if (blast) {
      if (/\b(earthquake|quake|rumble|tremor)\b/.test(t)) add('shake', { duration: 2, amount: 4 });
      add('blast', { delay: /\b(earthquake|quake|rumble)\b/.test(t) ? 0.5 : 0, effect: 'knockdown', damage: 6 });
      if (!tint && /\b(explo|boom|nuke|lightning|thunder|flash)/.test(t)) tint = 'flash';
    } else if (/\b(shake|shaking|rumble|tremor|earthquake|quake)\b/.test(t)) add('shake', { duration: dur || 3, amount: 3 });
    if (tint) add('tint', { tint, duration: tint === 'flash' ? 1 : dur || 10 });
    if (/\b(heal|health|recover|restore|first aid|food|snack|feast|medic)\b/.test(t)) add('heal', { amount: 16 });
    if (/\b(frenzy|free balls?|unlimited|infinite|no cooldown|rapid fire)\b/.test(t)) add('frenzy', { duration: dur || 10 });
    if (!actions.length) return null;
    const NOUN = { ball: 'bowling ball', pin: 'pin', donut: 'donut', rock: 'boulder', fireball: 'fireball', can: 'Duff can', bomb: 'bomb', pie: 'pie', anvil: 'anvil' };
    const first = actions[0], thing = NOUN[obj], cap = s => s.replace(/^\w/, c => c.toUpperCase());
    const name = cap(first.kind === 'rain' ? `${thing} storm` : first.kind === 'projectile' ? (first.count > 1 ? `${thing} stampede` : `runaway ${thing}`)
      : first.kind === 'blast' || first.kind === 'shake' ? (/\b(earthquake|quake)\b/.test(t) ? 'earthquake' : 'explosion')
      : first.kind === 'tint' ? { night: 'lights out', blacklight: 'neon night', red: 'red alert', green: 'toxic spill', sepia: 'flashback', invert: 'negative world', flash: 'flash' }[tint]
      : first.kind === 'heal' ? 'free food' : 'ball frenzy');
    const banner = (rain ? obj.toUpperCase() + ' STORM!' : blast ? 'KABOOM!' : roll ? 'LOOK OUT!' : tint === 'night' ? 'LIGHTS OUT!' : tint ? 'WHOA!' : 'HEADS UP!').slice(0, 24);
    return normalize({ name, banner, color: tint === 'red' || blast ? 'red' : tint === 'green' ? 'green' : tint === 'blacklight' ? 'purple' : 'gold',
      summary: 'Made by the built-in reader, which knows common words only. Add a Claude API key for richer events.', actions });
  }
  function describe(r) {
    const tgt = a => a.target === 'everyone' ? 'everyone' : a.target, sec = s => s + ' s';
    return r.actions.map(a => {
      const at = a.delay ? ` after ${sec(a.delay)}` : '';
      switch (a.kind) {
        case 'projectile': return `${a.count} ${a.size} ${a.object}${a.count > 1 ? 's' : ''} ${a.speed === 'fast' ? 'race' : 'roll'} in from the ${a.from === 'both' ? 'left and right' : a.from}${at} (${a.effect}, ${a.damage} damage, hits ${tgt(a)})`;
        case 'rain': return `${a.object}s rain down for ${sec(a.duration)}${at}, ${a.count}/s (${a.effect}, ${a.damage} damage, hits ${tgt(a)})`;
        case 'blast': return `a blast hits ${tgt(a)} on screen${at} (${a.effect}, ${a.damage} damage)`;
        case 'tint': return `${a.tint} screen for ${sec(a.duration)}${at}`;
        case 'shake': return `the screen shakes for ${sec(a.duration)}${at}`;
        case 'heal': return `players heal ${a.amount}${at}`;
        case 'frenzy': return `free bowling balls for ${sec(a.duration)}${at}`;
        case 'banner': return `"${a.text}"${at}`;
      }
      return a.kind;
    }).join('; ') + '.';
  }

  // ---------- running a recipe. env = { players(m), enemies(m), rand(n), hit(r,o,health,kind), cam } from events.js
  const F = 60, WARN = 36, FALL = 34;
  const wants = (a, who) => a.target === 'everyone' || a.target === who;
  function strike(m, env, a, who, o) {
    const r = m.ram;
    if (who === 'players') { r[o + 0x1b] = Math.max(1, r[o + 0x1b] - a.damage); env.hit(r, o, r[o + 0x1b], a.effect === 'knockdown' ? 2 : 1); }
    else env.hit(r, o, Math.max(0, r[o + 0x1b] - a.damage), a.effect === 'knockdown' ? 0x14 : 0x12);
  }
  function start(m, rec, at) {
    return { t: 'recipe', rec, at, acts: rec.actions.map(a => ({ a, at: at + Math.round(a.delay * F), until: at + Math.round((a.delay + a.duration) * F), on: false, objs: [], n: 0 })) };
  }
  // targets whose lane an object aims at
  function aim(m, env, a) {
    const ps = wants(a, 'players') ? env.players(m) : [], es = wants(a, 'enemies') ? env.enemies(m) : [], all = ps.concat(es);
    return all.length ? all[env.rand(all.length)] : { z: 176, x: env.cam(m) + 160 };
  }
  function contact(m, env, a, o, rad, dz, airOk) {
    for (const p of wants(a, 'players') ? env.players(m) : []) if (!o.hit.includes(p.o) && !p.dodging && (airOk || !p.air) && Math.abs(p.x - o.x) < rad && Math.abs(p.z - o.z) < dz) { o.hit.push(p.o); strike(m, env, a, 'players', p.o); }
    for (const e of wants(a, 'enemies') ? env.enemies(m) : []) if (!o.hit.includes(e.o) && (airOk || !e.air) && Math.abs(e.x - o.x) < rad && Math.abs(e.z - o.z) < dz) { o.hit.push(e.o); strike(m, env, a, 'enemies', e.o); }
  }
  function step(m, ev, env) {
    const f = m.frame, c = env.cam(m); let alive = false;
    for (const s of ev.acts) {
      const a = s.a, R = SIZE[a.size];
      if (f < s.at) { alive = true; continue; }
      if (!s.on) {
        s.on = true;
        if (a.kind === 'banner' && a.text) env.banner(a.text, ev.rec.color);
        if (a.kind === 'heal') for (const p of env.players(m)) m.ram[p.o + 0x1b] = Math.min(env.maxHealth(m, p.p), m.ram[p.o + 0x1b] + a.amount);
        if (a.kind === 'blast') {
          s.objs.push({ born: f });
          const onScreen = t => t.x > c - 8 && t.x < c + 328;
          for (const p of wants(a, 'players') ? env.players(m) : []) if (onScreen(p) && !p.dodging) strike(m, env, a, 'players', p.o);
          for (const e of wants(a, 'enemies') ? env.enemies(m) : []) if (onScreen(e)) strike(m, env, a, 'enemies', e.o);
        }
      }
      if (a.kind === 'projectile') {
        const gap = a.count > 1 ? Math.max(12, Math.round(a.duration * F / a.count)) : 0;
        while (s.n < a.count && f >= s.at + s.n * gap) {
          const t = aim(m, env, a), dir = a.from === 'left' ? 1 : a.from === 'right' ? -1 : s.n % 2 ? 1 : -1;
          s.objs.push({ born: f, z: Math.max(150, Math.min(240, t.z)), dir, x: dir < 0 ? c + 320 + R + 8 : c - R - 8, hit: [] }); s.n++;
        }
        for (const o of s.objs) if (f - o.born >= WARN) { o.x += o.dir * SPEED[a.speed]; contact(m, env, a, o, R + 6, 10, false); }
        s.objs = s.objs.filter(o => f - o.born < 600 && (o.dir < 0 ? o.x > c - 2 * R - 20 : o.x < c + 340 + 2 * R));
        if (s.n < a.count || s.objs.length) alive = true;
      } else if (a.kind === 'rain') {
        const every = Math.max(5, Math.round(F / a.count));
        if (f < s.until && (f - s.at) % every === 0) {
          const t = aim(m, env, a);
          s.objs.push({ born: f, x: t.x + env.rand(129) - 64, z: Math.max(150, Math.min(240, t.z + env.rand(25) - 12)), hit: [], spin: env.rand(2) ? 1 : -1 });
        }
        for (const o of s.objs) if (f - o.born === FALL) contact(m, env, a, o, R + 4, 9, true);
        s.objs = s.objs.filter(o => f - o.born < FALL + 36);
        if (f < s.until || s.objs.length) alive = true;
      } else if (a.kind === 'frenzy') {
        if (f < s.until) { if (m.arcadeCombat) for (const p of m.arcadeCombat.players) p.throwReady = Math.min(p.throwReady || 0, f + 5); alive = true; }
      } else if (a.kind === 'blast') { if (f - s.at < 30) alive = true; }
      else if (a.kind === 'tint' || a.kind === 'shake') { if (f < s.until) alive = true; }
    }
    return alive;
  }

  // ---------- pictures (finished 320x224 frame, ABGR words)
  const SW = 320, SH = 224;
  const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  const P = {
    ink: rgb(14, 10, 20), white: rgb(250, 248, 240), red: rgb(230, 40, 50), hi: rgb(255, 255, 255),
    ball: [rgb(30, 34, 70), rgb(70, 40, 130), rgb(170, 160, 255)], rock: [rgb(120, 112, 104), rgb(84, 78, 72), rgb(176, 168, 156)],
    bomb: [rgb(34, 34, 40), rgb(60, 60, 70), rgb(150, 150, 170)], fire: [rgb(255, 120, 20), rgb(255, 220, 60), rgb(255, 250, 200)],
    dough: rgb(214, 160, 90), icing: rgb(255, 120, 190), crust: rgb(222, 172, 104), cream: rgb(255, 246, 226), duff: rgb(200, 30, 40), metal: rgb(196, 200, 210), anvil: rgb(70, 74, 84),
    sprinkles: [rgb(255, 255, 255), rgb(90, 200, 255), rgb(255, 230, 60), rgb(110, 230, 110)], pinShade: rgb(196, 190, 180), orange: rgb(255, 160, 40), yellow: rgb(255, 230, 80),
  };
  const put1 = (px, x, y, c) => { if (x >= 0 && x < SW && y >= 0 && y < SH) px[y * SW + x] = c; };
  function darken(px, x, y) { if (x >= 0 && x < SW && y >= 0 && y < SH) px[y * SW + x] = (0xff000000 | ((px[y * SW + x] >>> 1) & 0x7f7f7f)) >>> 0; }
  function shadow(px, sx, feet, w) { for (let y = -2; y <= 2; y++) for (let x = -w; x <= w; x++) if ((x * x) / (w * w) + (y * y) / 4 <= 1) darken(px, sx + x, feet + y); }
  function disc(px, cx, cy, R, fill) { for (let y = -R - 1; y <= R + 1; y++) for (let x = -R - 1; x <= R + 1; x++) { const d = x * x + y * y; if (d <= (R + 1) * (R + 1)) put1(px, cx + x, cy + y, d > R * R ? P.ink : fill(x, y, d)); } }
  const PIN = ['..##..', '.####.', '.####.', '..##..', '..##..', '.#rr#.', '.####.', '######', '######', '######', '######', '.####.', '.####.', '..##..'];
  function drawPin(px, sx, y, tipped, dir) {
    for (let j = 0; j < PIN.length; j++) for (let i = 0; i < 6; i++) {
      const ch = PIN[j][i]; if (ch === '.') continue;
      const col = ch === 'r' ? P.red : i >= 4 ? P.pinShade : P.white;
      if (tipped) put1(px, sx + (dir > 0 ? j - 7 : 7 - j), y - 6 + i, col); else put1(px, sx - 3 + i, y - PIN.length + j, col);
    }
  }
  // one object, centre (cx, cy), radius R; roll = turning angle for round things, f = frame for flicker
  function drawObject(px, kind, cx, cy, R, roll, f, dir) {
    if (kind === 'pin') { drawPin(px, cx, cy + R, false, 1); return; }
    if (kind === 'ball' || kind === 'rock' || kind === 'bomb') {
      const [a, b, hi] = P[kind];
      disc(px, cx, cy, R, (x, y) => kind === 'rock' ? (((x * 7 + y * 13 + (x * y)) & 7) < 2 ? b : a) : ((x * 3 + y * 5 + Math.round(roll * 4)) & 15) < 3 ? b : a);
      for (let i = 0; i < Math.max(2, R >> 2); i++) put1(px, cx - (R >> 1) + i, cy - (R >> 1) - 1 + (i >> 1), hi);
      if (kind === 'ball') for (const k of [0, 0.6, -0.6]) { const hx = Math.round(cx + Math.cos(roll + k) * R * 0.45), hy = Math.round(cy + Math.sin(roll + k) * R * 0.45); put1(px, hx, hy, P.ink); put1(px, hx + 1, hy, P.ink); put1(px, hx, hy + 1, P.ink); }
      if (kind === 'bomb') { for (let i = 0; i < 4; i++) put1(px, cx + 2 + i, cy - R - i, P.pinShade); put1(px, cx + 6, cy - R - 4 - (f & 1), (f >> 1) & 1 ? P.yellow : P.orange); put1(px, cx + 7, cy - R - 5, P.white); }
      return;
    }
    if (kind === 'fireball') {
      for (let i = 1; i <= 3; i++) disc(px, cx - dir * i * Math.round(R * 0.7), cy + ((f + i) & 1), Math.max(2, R - i * Math.max(2, R >> 2)), () => i === 1 ? P.fire[0] : P.orange);
      disc(px, cx, cy, R, (x, y, d) => d < R * R * 0.25 ? P.fire[2] : d < R * R * 0.6 ? P.fire[1] : P.fire[0]);
      return;
    }
    if (kind === 'donut') {
      const hole = Math.max(2, Math.round(R * 0.38));
      disc(px, cx, cy, R, (x, y, d) => d <= hole * hole ? P.ink : y < R * 0.25 && d < R * R * 0.8 ? ((x * 5 + y * 3) % 11 === 0 ? P.sprinkles[((x + y) & 3)] : P.icing) : P.dough);
      for (let y = -hole + 1; y < hole; y++) for (let x = -hole + 1; x < hole; x++) if (x * x + y * y < (hole - 1) * (hole - 1)) darken(px, cx + x, cy + y);
      return;
    }
    if (kind === 'pie') {
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
        const d = x * x + y * y * 3; if (d > R * R * 1.1) continue;
        put1(px, cx + x, cy + y, d > R * R * 0.8 ? P.ink : y > 0 ? P.crust : ((x + y) & 3) ? P.cream : P.white);
      }
      return;
    }
    if (kind === 'can') {
      const w = Math.max(3, Math.round(R * 0.6)), h = Math.round(R * 1.4);
      for (let y = -h; y <= h; y++) for (let x = -w; x <= w; x++) {
        const edge = Math.abs(x) === w || Math.abs(y) === h;
        put1(px, cx + x, cy + y, edge ? P.ink : y < -h + 3 ? P.metal : Math.abs(y) < Math.max(2, h >> 2) ? P.white : x > w - 2 ? rgb(140, 20, 30) : P.duff);
      }
      return;
    }
    if (kind === 'anvil') {
      for (let y = -R + 2; y <= R; y++) {
        const half = y < -R / 3 ? R : y < R / 3 ? Math.round(R * 0.4) : Math.round(R * 0.8);
        for (let x = -half - (y < -R / 3 ? Math.round(R * 0.5) : 0); x <= half; x++) put1(px, cx + x, cy + y, y === -R + 2 || y === R ? P.ink : x > half - 2 ? rgb(46, 48, 56) : P.anvil);
      }
    }
  }
  function tintPixel(mode, p, k, f) {
    let r = p & 255, g = (p >>> 8) & 255, b = (p >>> 16) & 255;
    if (mode === 'night') { r = r * 0.32 + 4; g = g * 0.38 + 6; b = b * 0.6 + 26; }
    else if (mode === 'blacklight') {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, lum = (r * 3 + g * 6 + b) / 10;
      if (lum > 200 || (sat > 0.55 && mx > 120)) { const q = 255 / Math.max(1, mx); r = Math.min(255, r * q * 0.7 + 60); g = Math.min(255, g * q * 0.6 + 20); b = Math.min(255, b * q + 90); }
      else { const v = lum * 0.22; r = v * 0.9 + 14; g = v * 0.5 + 4; b = v * 1.3 + 30; }
    } else if (mode === 'red') { const pulse = 0.5 + 0.5 * Math.sin(f / 7); r = Math.min(255, r * 0.7 + 90 * pulse + 20); g *= 0.55; b *= 0.55; }
    else if (mode === 'green') { const lum = (r * 3 + g * 6 + b) / 10; r = lum * 0.45; g = Math.min(255, lum * 0.9 + 50); b = lum * 0.35; }
    else if (mode === 'sepia') { const lum = (r * 3 + g * 6 + b) / 10; r = Math.min(255, lum * 1.07 + 30); g = Math.min(255, lum * 0.86 + 20); b = lum * 0.62 + 8; }
    else if (mode === 'invert') { r = 255 - r; g = 255 - g; b = 255 - b; }
    else if (mode === 'flash') { r = r + (255 - r) * k; g = g + (255 - g) * k; b = b + (255 - b) * k; }
    return (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
  }
  function drawWarn(px, dir, z, f) {
    if ((f >> 2) % 2) return;
    const ex = dir < 0 ? SW - 12 : 11, y = 374 - z - 8;
    for (let i = 0; i < 9; i++) for (let j = -i; j <= i; j++) put1(px, ex + (dir < 0 ? i - 4 : 4 - i), y + j, P.red);
  }
  // screen effects first (shake, tint), then objects on top
  function drawScreen(px, ev, f) {
    let drew = false;
    for (const s of ev.acts) {
      const a = s.a; if (f < s.at || f >= s.until) continue;
      if (a.kind === 'shake') {
        const k = Math.max(1, Math.min(6, a.amount || 3)), dx = ((f * 7) % (2 * k + 1)) - k, dy = ((f * 3) % (k + 1)) - (k >> 1);
        const copy = px.slice();
        for (let y = 0; y < SH; y++) { const sy = Math.min(SH - 1, Math.max(0, y + dy)); for (let x = 0; x < SW; x++) px[y * SW + x] = copy[sy * SW + Math.min(SW - 1, Math.max(0, x + dx))]; }
        drew = true;
      } else if (a.kind === 'tint' && a.tint !== 'none') {
        const age = f - s.at, left = s.until - f, len = s.until - s.at;
        if (a.tint === 'flash') { const k = 1 - age / len; for (let i = 0; i < px.length; i++) px[i] = tintPixel('flash', px[i], k, f); drew = true; continue; }
        const flick = (a.tint === 'night' || a.tint === 'blacklight') && len > 120 ? (age < 30 ? (age >> 3) % 2 === 0 : left < 30 ? (left >> 3) % 2 === 1 : true) : true;
        if (!flick) continue;
        for (let i = 0; i < px.length; i++) px[i] = tintPixel(a.tint, px[i], 1, f);
        drew = true;
      }
    }
    return drew;
  }
  function drawObjects(px, ev, c, f) {
    let drew = false;
    for (const s of ev.acts) {
      const a = s.a, R = SIZE[a.size];
      if (a.kind === 'projectile') for (const o of s.objs) {
        drew = true;
        if (f - o.born < WARN) { drawWarn(px, o.dir, o.z, f); continue; }
        const sx = Math.round(o.x - c), feet = 374 - o.z, air = a.object === 'fireball' ? 14 : 0;
        shadow(px, sx, feet, R + 2); drawObject(px, a.object, sx, feet - R - air, R, (o.x / R) * o.dir, f, o.dir);
      } else if (a.kind === 'rain') for (const o of s.objs) {
        const age = f - o.born, sx = Math.round(o.x - c), feet = 374 - o.z; drew = true;
        if (age < FALL) { const t = age / FALL; shadow(px, sx, feet, Math.max(1, Math.round((R + 1) * t))); drawObject(px, a.object, sx, Math.round(feet - R - (1 - t * t) * 150), R, age / 3, f, 1); }
        else if (age < FALL + 36 && (age < FALL + 24 || (age >> 1) % 2)) {
          shadow(px, sx, feet, R + 2);
          if (a.object === 'pin') drawPin(px, sx, feet, true, o.spin); else if (a.object === 'bomb' || a.object === 'fireball') { if (age < FALL + 10) disc(px, sx, feet - R, R + (age - FALL), () => (age & 2) ? P.fire[1] : P.fire[0]); }
          else drawObject(px, a.object, sx, feet - R, R, 0, f, 1);
        }
      } else if (a.kind === 'blast') for (const o of s.objs) {
        const age = f - o.born; if (age >= 24) continue; drew = true;
        const rr = 8 + age * 9, cx = SW >> 1, cy = 140;
        for (let t = 0; t < 360; t += 2) { const x = Math.round(cx + Math.cos(t * Math.PI / 180) * rr), y = Math.round(cy + Math.sin(t * Math.PI / 180) * rr * 0.45); for (let w = 0; w < 3; w++) put1(px, x, y + w, age < 8 ? P.hi : P.yellow); }
      }
    }
    return drew;
  }

  const api = { KINDS, OBJECTS, TINTS, COLORS, MODEL, SCHEMA, SYSTEM, normalize, fromText, describe, generate, start, step, drawScreen, drawObjects, drawObject };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else G.SIMPRECIPE = api;
})(typeof window !== 'undefined' ? window : globalThis);
