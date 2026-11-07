// Free-running lockstep of the whole board model against MAME's main-CPU trace (run/out/mtrace.log from run/io_taps.lua):
// nothing is injected; interrupts, IO values, EEPROM, sound CPU and timers all come from web/sim/simpsons.js.
// Compares PC, registers and totalcycles at every instruction; prints the match length or the first divergence.
//   node test/board_lockstep.js [roms/simpsons.zip] [maxInstructions]
'use strict';
const fs = require('fs'), path = require('path'), readline = require('readline');
const { Board } = require('../web/sim/simpsons.js');
const ROOT = path.join(__dirname, '..');
const b = new Board(require('./roms.js')(process.argv[2]));
const MAX = +(process.argv[3] || 1e12);
const re = /^([0-9A-F]{4}) ([0-9A-F]{2}) ([0-9A-F]{2}) ([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{2}) ([0-9A-F]{2}) (\d+)$/;
const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');
const fmt = c => `${hex(c.pc.w, 4)} ${hex(c.q.h, 2)} ${hex(c.q.l, 2)} ${hex(c.x.w, 4)} ${hex(c.y.w, 4)} ${hex(c.u.w, 4)} ${hex(c.s.w, 4)} ${hex(c.dp, 2)} ${hex(c.cc, 2)} ${b.s.totalCycles(b.em)}`;
const fd = fs.openSync(path.join(ROOT, 'run/out/mtrace.log'), 'r'), buf = Buffer.alloc(1 << 24);
let lines = [], li = 0, tail = '', eof = false, n = 0, prev = [], done = false;
function line() {
  while (li >= lines.length - 1 && !eof) {
    const k = fs.readSync(fd, buf, 0, buf.length, null); if (!k) { eof = true; lines = lines.slice(li); li = 0; break; }
    lines = lines.slice(li).concat((tail + buf.toString('latin1', 0, k)).split('\n')); li = 0; tail = lines.pop();
  }
  return li < lines.length ? lines[li++] : null;
}
function next() { for (let l; (l = line()) !== null;) if (re.test(l)) { const d = li < lines.length ? lines[li] : ''; return [l, d]; } return null; }
b.cpu.onInsn = c => {
  if (done) return;
  const cur = next(); if (!cur) { done = 'end'; b.s.abort(); return; }
  const got = fmt(c);
  if (got !== cur[0]) { done = { want: cur[0], got, dis: cur[1] }; b.s.abort(); return; }
  prev.push(cur[0] + '  ' + cur[1]); if (prev.length > 8) prev.shift();
  if (++n >= MAX) { done = 'max'; b.s.abort(); }
};
const t0 = Date.now();
try { while (!done) b.s.timeslice(); } catch (e) { done = { err: e.stack }; }
const sec = (Number(b.s.time()) / 1e18).toFixed(6), fr = b.frame;
if (typeof done === 'string') console.log(`MATCH: ${n} instructions (${done}), t=${sec}s, frame ${fr}, ${(Date.now() - t0) / 1000}s`);
else { console.log(`first divergence after ${n} instructions, t=${sec}s, frame ${fr}`); console.log(prev.join('\n')); console.log('MAME:', done.want, ' ', done.dis || ''); console.log('ours:', done.got || done.err); process.exit(1); }
