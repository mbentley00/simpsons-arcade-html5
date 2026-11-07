// Sunset Riders sound board (MAME tmnt2.cpp ssriders: Z80 @ 8 MHz, YM2151 @ 3.579545 MHz, K053260 @ 3.579545 MHz),
// emulated inside the deterministic machine. Time unit = one 68000 cycle at 16 MHz (a Z80 cycle = 2 units); times are
// exact integers kept in JS Numbers (no int32 wrap). Only the *control* side of the sound chips lives here (YM2151 timers /
// busy / status, K053260 voice state for the status register and ROM reads); it produces a register-write log stamped
// with the chip sample index (3579545/64 Hz, both chips) that the audio renderer (ym2151.js + k053260.js) replays.
//
// Scheduling follows MAME's: time slices end at every K053260 timer tick (16 chip clocks) and at 68000 writes to the
// IRQ kludge (abort_timeslice); inside a slice the 68000 runs first, so
//   - a 68000 port write at t is seen by Z80 accesses from the start of the slice containing t,
//   - a 68000 IRQ (5c0604) at t is taken at the first Z80 instruction starting at or after t,
//   - a Z80 port write at w is seen by 68000 reads from the first slice boundary after w.
(function (G) {
'use strict';
const Z80 = typeof require !== 'undefined' ? require('./z80.js') : G.Z80;
const K053260 = typeof require !== 'undefined' ? require('./k053260.js') : G.K053260;
// one chip clock = 3200000/715909 units exactly (16e6 / 3579545)
const CK_NUM = 3200000, CK_DEN = 715909;
const TICK_U = 51200000;      // 715909 K053260 ticks (16 clocks each) = 51200000 units
const MAXINS = 46;            // longest Z80 instruction in units (23 T)
const STOP = {};
// number of chip samples generated before time T. MAME streams run at an integer rate (3579545/64 -> 55930 Hz) and an
// update at time T generates samples 0..floor(T*55930/16e6) inclusive (sound_stream::update); nothing at T = 0.
const RATE = 55930, UNITS = 16000000;
function samplesAt(T) { if (T <= 0) return 0; const q = Math.floor(T / UNITS), r = T - q * UNITS; return q * RATE + Math.floor(r * RATE / UNITS) + 1; }
// K053260 tick index of the last tick at or before t, and the (ceil'ed) time of tick n
function tickBefore(t) { const q = Math.floor(t / TICK_U), r = t - q * TICK_U; return q * CK_DEN + Math.floor(r * CK_DEN / TICK_U); }
function tickTimeFloor(n) { const q = Math.floor(n / CK_DEN), m = n - q * CK_DEN; return q * TICK_U + Math.floor(m * TICK_U / CK_DEN); }
function tickTimeCeil(n) { const q = Math.floor(n / CK_DEN), m = n - q * CK_DEN; return q * TICK_U + Math.ceil(m * TICK_U / CK_DEN); }
const zgrid = t => t - (t % 2);           // Z80 cycle grid (Z80 started at time 0)

function SoundBoard(z80rom, pcmrom) {
  this.rom = z80rom; this.ram = new Uint8Array(0x800);
  this.k = new K053260(pcmrom);
  const self = this;
  this.z = new Z80(a => self.zr(a), (a, d) => self.zw(a, d));
  this.z.ackIrq = () => { self.z.irq = 0; };
  this.log = [];   // audio log: [sampleIndex, reg, data]; reg 0..0xff = YM2151 register, 0x100+n = K053260 register n, 0x200 = K053260 0x2e read
  this.reset();
}
const P = SoundBoard.prototype;
P.reset = function () {
  this.ram.fill(0); this.k.reset(); this.z.reset(); this.log.length = 0; this.logBase = 0;
  this.zt = 0;              // time of the next Z80 instruction
  this.kN = 0;              // K053260 samples generated
  this.ev = [];             // 68000 -> Z80 events, [visibleTime, kind(0/1 = port, 2 = irq, 3 = nmi arm), data], time-ordered
  this.rep = [];            // Z80 -> 68000 port writes, [visibleTime, port(0/1), data]
  this.mport = [0, 0];      // ports as seen by the 68000
  this.lastAbort = -1;
  this.ym = { addr: 0, r10: 0, r11: 0, r12: 0, r14: 0, flags: 0, busyT: -1e9, run: [0, 0], ei: [0, 0], ef: [0, 0] };
  this.nmiArm = -1;
  this.ymRegs = new Uint8Array(256); // shadow of the YM2151 registers (lets a late-joining audio player resume mid-song)
};
P.save = function () {
  const y = this.ym;
  return { z: this.z.save(), ram: this.ram.slice(), k: this.k.save(), nlog: this.logBase + this.log.length, zt: this.zt, kN: this.kN,
    ev: this.ev.map(e => e.slice()), rep: this.rep.map(e => e.slice()), mport: this.mport.slice(), lastAbort: this.lastAbort,
    ym: { addr: y.addr, r10: y.r10, r11: y.r11, r12: y.r12, r14: y.r14, flags: y.flags, busyT: y.busyT, run: y.run.slice(), ei: y.ei.slice(), ef: y.ef.slice() },
    nmiArm: this.nmiArm, ymRegs: this.ymRegs.slice() };
};
P.load = function (s) {
  this.z.load(s.z); this.ram.set(s.ram); this.k.load(s.k); this.log.length = Math.max(0, Math.min(this.log.length, s.nlog - this.logBase));
  this.zt = s.zt; this.kN = s.kN; this.ev = s.ev.map(e => e.slice()); this.rep = s.rep.map(e => e.slice()); this.mport = s.mport.slice();
  this.lastAbort = s.lastAbort; const y = s.ym;
  this.ym = { addr: y.addr, r10: y.r10, r11: y.r11, r12: y.r12, r14: y.r14, flags: y.flags, busyT: y.busyT, run: y.run.slice(), ei: y.ei.slice(), ef: y.ef.slice() };
  this.nmiArm = s.nmiArm; if (s.ymRegs) this.ymRegs.set(s.ymRegs);
};
// start of the scheduler slice containing 68000 time t
P.sliceStart = function (t) { return Math.max(tickTimeFloor(tickBefore(t)), this.lastAbort); };

// ---------------- 68000 side ----------------
P.mainWrite = function (t, port, d) { this.ev.push([zgrid(this.sliceStart(t)), port, d]); };
P.mainIrq = function (t) { this.lastAbort = t; this.ev.push([zgrid(t), 2, 0]); };
P.mainRead = function (t, port) {
  this.runTo(zgrid(this.sliceStart(t)));
  const r = this.rep; let i = 0;
  while (i < r.length && r[i][0] <= t) { this.mport[r[i][1]] = r[i][2]; i++; }
  if (i) r.splice(0, i);
  return this.mport[port];
};
// end of a video frame at time t: run the sound CPU as far as it is safe
P.frameEnd = function (t) { this.runTo(zgrid(this.sliceStart(t))); };

// ---------------- Z80 side ----------------
P.at = function () { return this.zt + 2 * this.z.tc; }; // time of the current Z80 memory access
P.applyEvents = function (a) {
  const ev = this.ev; let i = 0;
  while (i < ev.length && ev[i][0] <= a) {
    const e = ev[i];
    if (e[1] < 2) this.k.port[e[1]] = e[2];
    else if (e[1] === 2) { if (e[0] > this.zt) break; this.z.irq = 1; } // the IRQ is only sampled between instructions
    i++;
  }
  if (i) ev.splice(0, i);
};
P.runTo = function (H) {
  const z = this.z;
  while (this.zt < H) {
    this.applyEvents(this.zt);
    let snap = null;
    if (this.zt + MAXINS > H) { snap = z.save(); this.horizon = H; }
    try { this.zt += 2 * z.step(); }
    catch (e) { if (e !== STOP) throw e; z.load(snap); this.horizon = Infinity; break; }
    this.horizon = Infinity;
  }
};
P.horizon = Infinity;
P.kUpdate = function (a) { const n = samplesAt(a); if (n > this.kN) { this.k.run(n - this.kN, null, 0); this.kN = n; } };
P.zr = function (a) {
  if (a < 0xf000) return this.rom[a];
  if (a < 0xf800) return this.ram[a & 0x7ff];
  const t = this.at();
  if (a === 0xf801) return this.ymStatus(t);
  if (a === 0xf800) return 0xff;
  if (a >= 0xfa00 && a < 0xfa30) {
    const off = a & 0x3f;
    if (off < 2) { if (t >= this.horizon) throw STOP; this.applyEvents(t); return this.k.port[off]; }
    if (off === 0x29) { this.kUpdate(t); return this.k.read(off); }
    if (off === 0x2e) { const v = this.k.read(off); if (this.k.mode & 1) this.log.push(this.kN, 0x200, 0); return v; }
    return 0;
  }
  return 0xff;
};
P.zw = function (a, d) {
  if (a < 0xf000) return;
  if (a < 0xf800) { this.ram[a & 0x7ff] = d; return; }
  const t = this.at();
  if (a === 0xf800) { this.ym.addr = d; return; }
  if (a === 0xf801) { this.ymData(t, d); return; }
  if (a >= 0xfa00 && a < 0xfa30) {
    const off = a & 0x3f;
    this.kUpdate(t);
    if (off === 2 || off === 3) { this.rep.push([this.nextBoundary(t), off - 2, d]); }
    this.k.write(off, d);
    if (off >= 8) this.log.push(this.kN, 0x100 + off, d);
    return;
  }
  // 0xfc00: arm NMI (never used by this game; the NMI line stays asserted since reset)
};
// first time a 68000 access can see a Z80 write at w: the next slice boundary (K053260 tick or YM timer expiry)
P.nextBoundary = function (w) {
  let b = tickTimeCeil(tickBefore(w) + 1);
  const y = this.ym;
  for (let i = 0; i < 2; i++) if (y.run[i]) { const e = y.ei[i] + (y.ef[i] ? 1 : 0); if (e > w && e < b) b = e; }
  return b;
};

// ---------------- YM2151 control side (timers, busy, status) ----------------
P.ymTimers = function (a) { // fire timer expiries visible at Z80 access time a
  const y = this.ym;
  for (let i = 0; i < 2; i++) {
    while (y.run[i] && zgrid(y.ei[i]) <= a) {
      if (y.r14 & (i ? 8 : 4)) y.flags |= i ? 2 : 1;
      this.ymStart(i, 0);
    }
  }
};
P.ymStart = function (i, delta) { // (re)start timer i at its current expiry time (or at the write time already stored there)
  const y = this.ym;
  const per = (i === 0 ? 1024 - ((y.r10 << 2) | (y.r11 & 3)) : 16 * (256 - y.r12)) + delta;
  const tot = y.ef[i] + per * 64 * CK_NUM;
  y.ei[i] += Math.floor(tot / CK_DEN); y.ef[i] = tot % CK_DEN; y.run[i] = 1;
};
// audio streaming: hand over the log entries produced so far (the board forgets them; a later load() cannot rewind
// past them), and the number of samples whose log is complete (no Z80 write can land before the Z80's time)
P.takeLog = function () { const l = this.log; this.logBase += l.length; this.log = []; return l; };
// netcode: hand over only the entries up to absolute log position nAbs (a confirmed frame's snapshot nlog), keep the rest
P.takeLogUpTo = function (nAbs) {
  const k = Math.max(0, Math.min(this.log.length, nAbs - this.logBase)), l = this.log.slice(0, k);
  this.log = this.log.slice(k); this.logBase += k; return l;
};
// after loading a foreign snapshot (late join / resync): the log restarts at the snapshot's position
P.rebase = function (nAbs) { this.log = []; this.logBase = nAbs; };
P.safeSamples = function () { return samplesAt(this.zt); };
P.ymStatus = function (a) {
  this.ymTimers(a);
  const y = this.ym;
  return y.flags | ((a - y.busyT) * CK_DEN < 64 * CK_NUM ? 0x80 : 0);
};
P.ymData = function (a, d) {
  const y = this.ym, r = y.addr;
  this.ymTimers(a);
  y.busyT = a;
  const n = samplesAt(a);
  this.log.push(n, r, d); this.ymRegs[r] = d;
  if (r === 0x10) y.r10 = d; else if (r === 0x11) y.r11 = d; else if (r === 0x12) y.r12 = d;
  else if (r === 0x14) {
    y.r14 = d;
    y.flags &= ~(((d >> 5) & 1 ? 2 : 0) | ((d >> 4) & 1 ? 1 : 0));
    for (const i of [1, 0]) {
      if ((d >> i) & 1) { if (!y.run[i]) { y.ei[i] = a; y.ef[i] = 0; this.ymStart(i, i ? -(n & 15) : 0); } }
      else y.run[i] = 0;
    }
  }
};
SoundBoard.samplesAt = samplesAt;
G.SoundBoard = SoundBoard;
if (typeof module !== 'undefined') module.exports = SoundBoard;
})(typeof window !== 'undefined' ? window : globalThis);
