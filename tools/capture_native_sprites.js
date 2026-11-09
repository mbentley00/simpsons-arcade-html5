#!/usr/bin/env node
// Capture how the game's own spawn-stream objects look, for the stage editor's Enemies view.
//
// For each combat stage: start it (same native launch as the editor's Play button), walk right attacking with the
// player kept alive, and catch every object the spawn stream allocates (pc 0xca80, X = spawn record; enemies/characters at RAM 0xf80.., props at 0x1280..). A few frames
// later, while the object is well inside the screen, its K053247 sprite entries are recorded together with the
// sprite colour base, the K053246 offsets and its feet position. Colours are NOT stored: for each 16-colour palette
// the tool finds the same 32 bytes in prog.bin and stores that ROM offset, so the editor renders the preview from
// the user's own ROM at runtime. Output: web/stage/native_sprites.js (metadata only, no ROM data).
//
// Usage: node tools/capture_native_sprites.js [FRAMES=6000] [stage,stage,...] [--dump DIR]
//   --dump DIR also writes <stage>_<id>.rgba previews (+ index.json) rendered from the metadata, for checking.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { Board } = require(ROOT + '/web/sim/simpsons.js'), { Video } = require(ROOT + '/web/sim/video.js');
const S = require(ROOT + '/web/stage/stagedata.js'), E = require(ROOT + '/web/stage/enemies.js');
const files = require(ROOT + '/test/roms.js')();
const args = process.argv.slice(2), dumpAt = args.indexOf('--dump'), DUMP = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
const FRAMES = +(args[0] || 6000), ONLY = args[1] ? args[1].split(',').map(Number) : null;
const OUT = ROOT + '/web/stage/native_sprites.js';
const prog = Buffer.from(files['prog.bin']);

function palOffset(bytes) { // a ROM copy of this palette (needs some real colours, not a run of zeros)
  const words = new Set(); for (let i = 0; i < 32; i += 2) words.add((bytes[i] << 8) | bytes[i + 1]);
  if (words.size < 4) return -1;
  return prog.indexOf(Buffer.from(bytes));
}
const word = (r, o) => ((r[o] << 8) | r[o + 1]) << 16 >> 16;

// Sprite-only renderer (fake board) shared by ownership tests and --dump previews.
const FAKE = { obj: files['gfx_sprites.bin'], chr: new Uint8Array(32), sprDst: new Uint16Array(0x800), k46: new Uint8Array(8) };
const VID = new Video(FAKE);
function bbox(pieces, k46) { // screen box (bmp rows) of these sprite entries
  FAKE.sprDst.fill(0); pieces.forEach((p, i) => FAKE.sprDst.set(p, i * 8)); FAKE.k46.set(k46);
  VID.bmp.fill(0); VID.pri.fill(0); VID.drawSprites(0, [255, 255, 255]);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < 264; y++) for (let x = 0; x < 320; x++) if (VID.pri[y * 320 + x] === 31) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
const anchorOf = (r, o) => [word(r, o + 12) - 54, 374 - ((r[o + 17] << 8) | r[o + 18]) - r[o + 23] + 16];
// An object's sprites, found by difference: run one frame as is, then the same frame again (from a saved state) with
// the object moved 1024 px away. Entries that exist only in the first run are the object's; everything else (players,
// other objects, props) is unaffected. The board is left exactly as after the normal frame.
let probing = false;
const keyOf = p => [p[0] & 0xff00, p[1], p[2], p[3], p[4], p[5], p[6]].join(','); // word 0's low byte is the z order, which shifts for everyone
function activeEntries(b) { const out = []; for (let i = 0; i < 256; i++) { const w = b.spr[i * 8]; if ((w & 0x8000) && (w & 0xff)) out.push(Array.from(b.spr.subarray(i * 8, i * 8 + 8))); } return out; }
function capture(b, slot) {
  const state = b.save(); probing = true;
  const r = b.ram, x = (r[slot + 12] << 8) | r[slot + 13], moved = (x + 0x400) & 0xffff;
  r[slot + 12] = moved >> 8; r[slot + 13] = moved & 255; b.runFrames(1); b.drainAudio();
  const without = new Map(); for (const p of activeEntries(b)) { const k = keyOf(p); without.set(k, (without.get(k) || 0) + 1); }
  b.load(state); probing = false; b.runFrames(1); b.drainAudio();
  if (!(r[slot] & 0x80)) return null;
  const k46 = Array.from(b.k46), [ax, ay] = anchorOf(r, slot), pieces = [];
  for (const p of activeEntries(b)) { const k = keyOf(p), n = without.get(k) || 0; if (n) without.set(k, n - 1); else pieces.push(p); }
  // Keep differing entries near the object (moving it can also change what others do). Parts drawn by helpers that do
  // not follow +12 (the dog's body, for example) are added when they are nearby, use one of the object's palettes, and
  // are closer to this object than to any other live object.
  const near = (p, bb = bbox([p], k46)) => bb && (bb.x0 + bb.x1) / 2 > ax - 80 && (bb.x0 + bb.x1) / 2 < ax + 80 && bb.y1 <= ay + 16 && bb.y0 >= ay - 180;
  const kept = pieces.filter(p => near(p)), colors = new Set(kept.map(p => p[6] & 0x1f)), have = new Set(kept.map(keyOf));
  const others = []; for (let o = 0xa40; o < 0x1640; o += 0x60) if (o !== slot && (r[o] & 0x80)) others.push(anchorOf(r, o));
  for (const p of activeEntries(b)) {
    if (have.has(keyOf(p)) || !colors.has(p[6] & 0x1f)) continue;
    const bb = bbox([p], k46); if (!near(p, bb)) continue;
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, d = Math.hypot(cx - ax, (cy - ay + 40) / 2);
    if (others.every(([x, y]) => Math.hypot(cx - x, (cy - y + 40) / 2) > d)) kept.push(p);
  }
  pieces.length = 0; pieces.push(...kept);
  const box = pieces.length && bbox(pieces, k46); if (!box || box.x1 - box.x0 > 110 || box.y1 - box.y0 > 160) return null; // one character, not a crowd
  if (!pieces.length) return null;
  const k = b.k51, colorbase = 32 * ((k[9] >> 2) & 3), pal = {};
  for (const p of pieces) {
    const color = (colorbase + (p[6] & 0x1f)) & 127; if (pal[color] !== undefined) continue;
    const off = palOffset(b.pal.subarray(color * 32, color * 32 + 32)); if (off < 0) return null;
    pal[color] = off;
  }
  return { colorbase, k46, anchor: [ax, ay], pieces, pal };
}

// Render a capture the way the editor does (fake board: only sprites, palette from prog offsets).
function render(v, cap) {
  const fake = v.b; fake.sprDst.fill(0); cap.pieces.forEach((p, i) => fake.sprDst.set(p, i * 8)); fake.k46.set(cap.k46);
  v.bmp.fill(0); v.pri.fill(0); v.drawSprites(cap.colorbase, [255, 255, 255]);
  let x0 = 320, y0 = 264, x1 = -1, y1 = -1;
  for (let y = 0; y < 264; y++) for (let x = 0; x < 320; x++) if (v.pri[y * 320 + x] === 31) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, rgba = Buffer.alloc(w * h * 4), c5 = n => (n << 3) | (n >> 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y0 + y) * 320 + x0 + x; if (v.pri[i] !== 31) continue;
    const pen = v.bmp[i] & 2047, off = cap.pal[pen >> 4]; if (off === undefined) continue;
    const o = off + (pen & 15) * 2, c = (prog[o] << 8) | prog[o + 1], k = (y * w + x) * 4;
    rgba[k] = c5(c & 31); rgba[k + 1] = c5((c >> 5) & 31); rgba[k + 2] = c5((c >> 10) & 31); rgba[k + 3] = 255;
  }
  return { w, h, rgba, ax: cap.anchor[0] - x0, ay: cap.anchor[1] - y0 };
}

(async () => {
  const seed = new Board(files); seed.audio = true;
  while (seed.frame < 1040) {
    seed.inputs.COIN = seed.frame % 60 < 8 ? 0xfe : 0xff;
    seed.inputs.P1 = seed.ram[0x800] === 2 && seed.ram[0x803] === 1 ? (seed.frame % 16 < 8 ? 0x6f : 0xff) : (seed.frame % 30 < 8 ? 0x7f : 0xff);
    seed.runFrames(1); seed.drainAudio();
  }
  const checkpoint = seed.save();
  const modSource = fs.readFileSync(ROOT + '/web/stage/mods.js', 'utf8'), launchSource = fs.readFileSync(ROOT + '/web/stage/launch.js', 'utf8');
  let out = {}; try { const g = {}; vm.runInNewContext(fs.readFileSync(OUT, 'utf8'), { window: g }); out = g.SIMPNATIVE_SPRITES || {}; } catch (e) { /* first run */ }
  for (const sc of S.SCENES) {
    const stage = E.STAGES[S.SCENES.indexOf(sc)]; if (stage < 0 || (ONLY && !ONLY.includes(stage))) continue;
    const rows = E.read(files['prog.bin'], stage), want = new Set(rows.filter(r => E.kind(r) !== 'script').map(r => r.data[7]));
    const have = new Set(Object.keys(out).filter(k => k.startsWith(stage + ':')).map(k => +k.split(':')[1]));
    if ([...want].every(id => have.has(id))) { console.log('stage', stage, 'already complete'); continue; }
    const b = new Board(files); b.audio = true; b.load(checkpoint);
    const element = () => ({ style: {}, setAttribute() {}, append() {}, appendChild() {}, remove() {} });
    const g = { SIMPSTAGE: S, URLSearchParams, location: { search: '?scene=' + sc.scene + '&play=1' }, localStorage: { getItem() { return null; } }, document: { createElement: element, body: { appendChild() {} } }, setTimeout: fn => { fn(); } };
    g.window = g; vm.runInNewContext(modSource, g); vm.runInNewContext(launchSource, g);
    g.SIMPMODS.apply(files); g.SIMPMODS.install(b);
    try { await g.SIMPLAUNCH.prepare(b); } catch (e) { console.log('stage', stage, 'did not launch'); continue; }
    const listPtr = (prog[0x7efbc + stage * 2] << 8) | prog[0x7efbd + stage * 2], ptr0 = (prog[0x36000 + listPtr - 0x6000] << 8) | prog[0x36000 + listPtr - 0x6000 + 1];
    const live = {}, mw = b.mw, scene = ({ 5: 6, 10: 11, 14: 15 })[sc.scene] || sc.scene;
    b.mw = function (a, val) {
      if (!probing && a >= 0x4f80 && a < 0x5640 && (a - 0x4f80) % 0x60 === 0 && val === 4 && this.cpu.pc.w === 0xca80) live[a - 0x4000] = { i: (this.cpu.x.w - ptr0) / 8, at: this.frame };
      return mw.call(this, a, val);
    };
    const hp = b.ram[0xa5b], done = new Set(Object.keys(out).filter(k => k.startsWith(stage + ':'))); let got = 0;
    for (let f = 0; f < FRAMES; f++) {
      b.inputs.P1 = 255 & ~(f % 12 < 4 ? 0x12 : 0x02);
      if (b.ram[0xa5b] < hp) b.ram[0xa5b] = hp;
      b.runFrames(1); b.drainAudio();
      if (b.ram[0x803] !== scene) break;
      for (const [key, o] of Object.entries(live)) {
        const slot = +key, row = rows[o.i], age = b.frame - o.at;
        if (!(b.ram[slot] & 0x80) && age > 2) { delete live[key]; continue; } // freed slots get reused by other objects
        if (!row || !Number.isInteger(o.i) || E.kind(row) === 'script') { delete live[key]; continue; }
        const id = row.data[7], k = stage + ':' + id;
        if (age < 16 || (age - 16) % 24 || (o.n || 0) >= 6 || done.has(k)) continue; // several looks per object; keep the fullest
        if (age > 400 || !(b.ram[slot] & 0x80)) { delete live[key]; continue; }
        const x = word(b.ram, slot + 12) - 54; if (x < 40 || x > 280 || b.ram[slot + 6] >= 4) continue; // on screen, not reeling
        const cap = capture(b, slot); if (!cap) continue;
        o.n = (o.n || 0) + 1; if (!out[k] || cap.pieces.length > out[k].pieces.length) { if (!out[k]) got++; out[k] = cap; }
      }
      if (f > 1500 && [...want].every(id => out[stage + ':' + id])) break;
    }
    const n = [...want].filter(id => out[stage + ':' + id]).length;
    console.log(`stage ${stage} ${sc.name}: +${got}, ${n}/${want.size} object ids captured`);
    write(out);
  }
  write(out);
  if (DUMP) {
    fs.mkdirSync(DUMP, { recursive: true });
    const v = VID, index = [];
    for (const [k, cap] of Object.entries(out)) {
      const img = render(v, cap); if (!img) continue;
      const file = path.join(DUMP, k.replace(':', '_') + '.rgba'); fs.writeFileSync(file, img.rgba); index.push({ key: k, w: img.w, h: img.h, file });
    }
    fs.writeFileSync(path.join(DUMP, 'index.json'), JSON.stringify(index));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

function write(out) {
  const keys = Object.keys(out).sort((a, b) => { const [s1, i1] = a.split(':').map(Number), [s2, i2] = b.split(':').map(Number); return s1 - s2 || i1 - i2; });
  const lines = keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(out[k])},`);
  fs.writeFileSync(OUT, '// Generated by tools/capture_native_sprites.js: sprite-entry metadata for the stage editor\'s previews of the\n' +
    '// game\'s own spawn-stream objects ("<stage>:<object id>"). Palettes are prog.bin offsets; no graphics or colours are stored.\n' +
    '(function (G) {\n  G.SIMPNATIVE_SPRITES = {\n' + lines.join('\n') + '\n  };\n})(typeof window !== \'undefined\' ? window : globalThis);\n');
}
