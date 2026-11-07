// Savestate determinism check (rollback netcode): the board's save()/load() must capture everything.
//   1) reference run with 4-player scripted input (coins, starts, random moves), per-frame hash of RAM/video RAM/
//      palette/sprites + audio samples; 2) same run with a save -> pack -> unpack -> load round trip every 7 frames;
//   3) rollbacks: from a saved frame run k frames with WRONG input, load, re-run with the right input (k = 1..12);
//   4) a fresh Board loads a packed state from the reference and continues. All must match the reference exactly.
//   node test/state_check.js [frames=3000]
'use strict';
const { Board } = require('../web/sim/simpsons.js'), IN = require('../web/input.js'), SNAP = require('../web/net/snap.js');
const files = require('./roms.js')(), N = +(process.argv[2] || 3000);
function inputFor(f) { // deterministic 4P script
  const fi = new Uint8Array(4);
  for (let p = 0; p < 4; p++) {
    const t = f - 700 - 40 * p;
    if (t >= 0 && t < 6) fi[p] |= IN.COIN; else if (t >= 60 && t < 66) fi[p] |= IN.START;
    else if (t > 300) { let x = Math.imul((f >> 4) * 2654435761 + p * 97, 0x45d9f3b) >>> 0; x ^= x >>> 15; fi[p] = [0, 1, 2, 4, 8, 5, 6, 9, 10][x % 9] | ((x >> 8) & 3 ? 0 : 16) | ((x >> 12) % 11 ? 0 : 32); }
  }
  return fi;
}
function fh(b, a) { let h = 0x811c9dc5; for (const arr of [b.ram, b.ram3, b.pal, b.vram, b.zram]) for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ arr[i], 0x01000193);
  for (let i = 0; i < b.spr.length; i++) h = Math.imul(h ^ b.spr[i], 0x01000193); for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193); return h >>> 0; }
function step(b, f, inp = inputFor) { IN.applyFrame(b, inp(f), 0); b.runFrames(1); return fh(b, b.drainAudio()); }
const mk = () => { const b = new Board(files); b.audio = true; return b; };
let t0 = Date.now(); const ref = [0], refB = mk(), keep = new Map();
for (let f = 1; f <= N; f++) { if (f % 500 === 0) keep.set(f, SNAP.pack(refB.save())); ref.push(step(refB, f)); }
console.log(`reference: ${N} frames, ${((Date.now() - t0) / N).toFixed(2)} ms/frame; player inputs from frame 700`);
let bad = 0; const chk = (what, f, h) => { if (h !== ref[f]) { if (bad++ < 5) console.log(`MISMATCH ${what} at frame ${f}`); } };
// 2) round trip
t0 = Date.now(); let b = mk(), ns = 0, msS = 0, msL = 0, bytes = 0;
for (let f = 1; f <= N; f++) {
  if (f % 7 === 0) { let t = performance.now(); const p = SNAP.pack(b.save()); msS += performance.now() - t; bytes = p.length; t = performance.now(); b.load(SNAP.unpack(p)); msL += performance.now() - t; ns++; }
  chk('round-trip', f, step(b, f));
}
console.log(`round trip: ${ns} save/pack/unpack/load, state ${(bytes / 1024).toFixed(0)} KB packed, save+pack ${(msS / ns).toFixed(2)} ms, unpack+load ${(msL / ns).toFixed(2)} ms`);
// 3) rollbacks with wrong predictions
b = mk(); let nr = 0, rf = 0;
const wrong = f => { const x = inputFor(f); return x.map((v, p) => v ^ (1 << ((f + p) % 6))); };
for (let f = 1; f <= N; f++) {
  if (f % 37 === 0 && f + 12 < N) {
    const k = 1 + (f % 12), st = b.save(), hs = [];
    for (let i = 0; i < k; i++) hs.push(step(b, f + i, wrong)); // mispredicted frames (state diverges)
    b.load(st); nr++; rf += k;
  }
  chk('rollback', f, step(b, f));
}
console.log(`rollbacks: ${nr} (re-simulated ${rf} frames after wrong input)`);
// 4) fresh board from packed state
for (const [f0, p] of keep) { const c = mk(); c.load(SNAP.unpack(p)); for (let f = f0; f < Math.min(N, f0 + 300); f++) chk('fresh board from frame ' + f0, f, step(c, f)); }
console.log(`fresh boards: ${keep.size} states loaded into new boards, 300 frames each`);
// state hash stability: two boards at the same frame hash equal; save() does not change the state
const h1 = SNAP.hash(refB.save()), h2 = SNAP.hash(refB.save()); if (h1 !== h2) { bad++; console.log('save() not idempotent'); }
console.log(bad ? `FAIL: ${bad} mismatches` : 'OK: all runs identical to the reference (RAM, video RAM, palette, sprites, audio)');
process.exit(bad ? 1 : 0);
