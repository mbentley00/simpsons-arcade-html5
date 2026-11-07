// Lockstep check of web/sim/konamim.js (resumable core, run in 1-cycle slices to exercise every suspension point) against a MAME trace of the parent simpsons program.
//   1) run/io_taps.lua under MAME (see NOTES.md "CPU lockstep") -> run/out/mtrace.log (pc + regs + totalcycles per
//      instruction) and run/out/mreads.bin (every main-CPU data read in 0x0000-0x3fff, in order: lo, hi, value).
//   2) node test/konami_lockstep.js [roms/simpsons.zip] [maxInstructions]
// Memory model: work RAM 0x4000-0x5fff, banked ROM 0x6000-0x7fff (SETLN data&0x3f), fixed ROM 0x8000-0xffff
// (region 0x78000); all reads in 0x0000-0x3fff are replayed from MAME (video chips / IO / views), writes there are
// dropped. Interrupts are injected from the trace: when MAME's next PC is an NMI/FIRQ/IRQ handler entry and ours is
// not, the line is raised for one step (entry cycles and pushed state are then checked like any instruction).
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { KonamiM } = require('../web/sim/konamim.js');
const ROOT = path.join(__dirname, '..'), zip = process.argv[2] || path.join(ROOT, 'roms/simpsons.zip');
const MAX = +(process.argv[3] || 1e9);
const rom = n => new Uint8Array(execFileSync('unzip', ['-p', zip, n], { maxBuffer: 1 << 24 }));
const prog = new Uint8Array(0x80000);
prog.set(rom('072-g02.16c'), 0); prog.set(rom('072-g01.17c'), 0x20000); prog.set(rom('072-j13.13c'), 0x40000); prog.set(rom('072-j12.15c'), 0x60000);
const reads = fs.readFileSync(path.join(ROOT, 'run/out/mreads.bin')); let rp = 0;
const ram = new Uint8Array(0x2000); let bank = 0, err = null;
const bus = {
  read(a) {
    if (a >= 0x8000) return prog[0x78000 + a - 0x8000];
    if (a >= 0x6000) return prog[bank * 0x2000 + a - 0x6000];
    if (a >= 0x4000) return ram[a - 0x4000];
    if (rp + 3 > reads.length) { err = err || `ran out of logged IO reads at ${a.toString(16)}`; return 0; }
    const la = reads[rp] | reads[rp + 1] << 8, v = reads[rp + 2]; rp += 3;
    if (la !== a) err = err || `IO read address mismatch: ours ${a.toString(16)} MAME ${la.toString(16)}`;
    return v;
  },
  write(a, v) { if (a >= 0x4000 && a < 0x6000) ram[a - 0x4000] = v; },
  setLines(v) { bank = v & 0x3f; },
};

const cpu = new KonamiM(bus);
const VEC = { nmi: 0xfffc, firq: 0xfff6, irq: 0xfff8 }, target = {};
for (const k in VEC) target[k] = bus.read(VEC[k]) << 8 | bus.read(VEC[k] + 1);
// stream the trace in 64 MB chunks (it can exceed V8's max string length)
const fd = fs.openSync(path.join(ROOT, 'run/out/mtrace.log'), 'r'), CH = Buffer.alloc(1 << 26); let carry = '', lines = [], li = 0;
function nextLine() {
  while (li >= lines.length) {
    const k = fs.readSync(fd, CH, 0, CH.length, null); if (!k) { if (carry) { lines = [carry]; carry = ''; li = 0; continue; } return null; }
    lines = (carry + CH.toString('latin1', 0, k)).split('\n'); carry = lines.pop(); li = 0;
  }
  return lines[li++];
}
const re = /^([0-9A-F]{4}) ([0-9A-F]{2}) ([0-9A-F]{2}) ([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{2}) ([0-9A-F]{2}) (\d+)$/;
const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');

const fmt = c => `${hex(c.pc.w, 4)} ${hex(c.q.h, 2)} ${hex(c.q.l, 2)} ${hex(c.x.w, 4)} ${hex(c.y.w, 4)} ${hex(c.u.w, 4)} ${hex(c.s.w, 4)} ${hex(c.dp, 2)} ${hex(c.cc, 2)} ${c.total}`;
let m, n = 0, ints = { nmi: 0, firq: 0, irq: 0 }, prev = '', ok = true, done = false, pending = null;
function next() { let L; while ((L = nextLine()) !== null) if ((m = re.exec(L))) return m; return null; }
cpu.reset();
let cur = next(), base = 0;
cpu.onInsn = c => {
  c.total = base + (1 - c.icount); c.firq_line = c.irq_line = false;
  if (done) return;
  if (!cur) { done = true; return; }
  const want = cur[0], got = fmt(c);
  if (got !== want || err) { console.log(`DIVERGENCE at instruction ${n}${err ? ' (' + err + ')' : ''}\n  prev MAME: ${prev}\n  MAME: ${want}\n  ours: ${got}`); ok = false; done = true; return; }
  prev = want; n++; if (n >= MAX) { done = true; return; }
  cur = next(); if (!cur) done = true;
};
const gpi = cpu.get_pending_interrupt;
cpu.get_pending_interrupt = function () { // MAIN: did MAME take an interrupt here?
  if (cur && this.state === 0) {
    const mpc = parseInt(cur[1], 16);
    if (this.pc.w !== mpc) for (const k of ['nmi', 'firq', 'irq']) if (mpc === target[k]) {
      if (k === 'nmi') this.nmi_asserted = true; else if (k === 'firq') this.firq_line = true; else this.irq_line = true; ints[k]++; break;
    }
  }
  return gpi.call(this);
};
while (!done) {
  base += cpu.run(1);
}
console.log(`${ok ? 'MATCH' : 'stopped'}: ${n} instructions, ${base} cycles, IO reads replayed ${rp / 3}/${reads.length / 3}, interrupts injected ${JSON.stringify(ints)}`);
process.exit(ok ? 0 : 1);
