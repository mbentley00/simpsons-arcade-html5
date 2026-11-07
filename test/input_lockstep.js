// Scripted-input lockstep vs MAME: plays test/input/<script>.txt into the board (web/sim/input.js semantics: held bits,
// active-low ports) and compares, per frame, the FNV-32 of main work RAM 0x4000-0x5fff and every input-port read value
// against run/out/inlog.txt from run/input_script.lua (same script). Also diffs snap/f<n>.raw for SNAP frames.
//   node test/input_lockstep.js test/input/coin_start_walk.txt [lastFrame=4000] [snapFrames,...]
'use strict';
const fs = require('fs'), path = require('path');
const { Board } = require('../web/sim/simpsons.js'), { Video, W, H } = require('../web/sim/video.js');
const ROOT = path.join(__dirname, '..');
const script = process.argv[2], LAST = +(process.argv[3] || 4000), SNAPS = new Set((process.argv[4] || '').split(',').filter(Boolean).map(Number));
const ev = []; for (const l of fs.readFileSync(script, 'utf8').split('\n')) { const m = /^\s*(\d+)\s+([A-Z]+\d?)\s+([0-9a-fA-F]+)/.exec(l); if (m) ev.push([+m[1], m[2], parseInt(m[3], 16)]); }
const mame = { F: new Map(), R: [] };
for (const l of fs.readFileSync(path.join(ROOT, 'run/out/inlog.txt'), 'utf8').split('\n')) {
  const p = l.split(' '); if (p[0] === 'F') mame.F.set(+p[1], p[2]); else if (p[0] === 'R') mame.R.push(`${p[1]} ${p[2]} ${p[3]}`);
}
const b = new Board(require('./roms.js')()), v = new Video(b);
const ours = { R: [] }; let bad = 0, firstBad = null, cmp = 0, pend = 0, pxBad = 0;
const rd = b.mr.bind(b);
b.mr = a => { const d = rd(a); if (a === 0x1f80 || (a >= 0x1f90 && a <= 0x1f93)) ours.R.push(`${b.frame} ${a.toString(16).padStart(4, '0')} ${d.toString(16).padStart(2, '0')}`); return d; };
b.onFrame = bd => {
  const n = bd.frame;
  if (pend) { const px = v.toRGB(), ref = new Uint32Array(fs.readFileSync(path.join(ROOT, `snap/f${pend}.raw`)).buffer.slice(0)); let d = 0;
    for (let i = 0; i < W * H; i++) if ((ref[i] & 0xffffff) !== px[i]) d++; console.log(`frame ${pend}: ${d} px differ from MAME`); pxBad += d; pend = 0; }
  if (SNAPS.has(n)) { v.render(); pend = n; }
  let h = 0x811c9dc5; for (let a = 0; a < 0x2000; a++) { h ^= b.ram[a]; h = Math.imul(h, 0x01000193); }
  const want = mame.F.get(n - 1), // MAME frame_done n runs at our vblank end n+1 (after VIDEO_UPDATE_AFTER_VBLANK)
    got = (h >>> 0).toString(16).padStart(8, '0');
  if (want !== undefined) { cmp++; if (want !== got) { bad++; if (firstBad === null) firstBad = n; } }
  for (const [f, port, bits] of ev) if (f + 1 === n) b.inputs[port] = 0xff & ~bits; // MAME: set in frame_done n -> first read in our frame n+1
};
const t0 = Date.now();
while (b.frame < LAST || pend) b.runFrames(1);
mame.R = mame.R.filter(r => +r.split(' ')[0] < LAST); ours.R = ours.R.filter(r => +r.split(' ')[0] < LAST);
let rbad = -1; for (let i = 0; i < Math.max(ours.R.length, mame.R.length); i++) if (ours.R[i] !== mame.R[i]) { rbad = i; break; }
console.log(`RAM hash: ${cmp} frames compared, ${bad} differ${firstBad !== null ? ' (first at frame ' + firstBad + ')' : ''}`);
console.log(`input reads: ${ours.R.length} ours / ${mame.R.length} MAME, ${rbad < 0 ? 'identical sequence' : 'first mismatch #' + rbad + ': ours ' + ours.R[rbad] + ' MAME ' + mame.R[rbad]}`);
let ed = 0; for (let i = 0; i < 128; i++) if (b.eep.data[i] !== b.eepInit[i]) ed++; console.log(`EEPROM: ${ed} bytes changed by the game`);
console.log(`${((Date.now() - t0) / LAST).toFixed(2)} ms/frame`);
process.exit(bad || rbad >= 0 || pxBad ? 1 : 0);
