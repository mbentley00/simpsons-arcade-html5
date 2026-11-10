// License: BSD-3-Clause, copyright-holder Aaron Giles. See THIRD_PARTY_NOTICES.md.
// MAME device_scheduler port (src/emu/schedule.cpp, diexec.cpp) with exact attosecond times (BigInt, absolute since
// power-on; one second = 1e18). Reproduces timeslice(): quantum, per-CPU cycle conversion (shift/divisor), abort on new
// head timer, timer ordering (insert before the first strictly later timer), one-shot disable before callback,
// "modified during callback" rule, and device_input event queues (set_input_line -> synchronize(empty_event_queue)).
'use strict';
(function (G) {
const NEVER = 1n << 120n, ASPS = 1000000000000000000n, EXACT = 1n << 53n, MEMO = 4096;
// Speed: the sound chip's update timer splits every frame into ~3800 slices of ~10 cycles, so the per-slice BigInt work
// dominates. Both helpers below give exactly the BigInt results: small products are computed once and reused, and the
// cycle conversion runs on Numbers when the attosecond delta is below 2^53 (exact there; see timeslice).
const CLEAR = 0, ASSERT = 1, HOLD = 2;
class Timer {
  constructor(s, name, cb, temporary) {
    this.s = s; this.name = name; this.cb = cb; this.param = 0; this.period = NEVER; this.start = s.time();
    this.expire = NEVER; this.enabled = false; this.temporary = !!temporary;
  }
  adjust(delay, param = 0, period = NEVER) {
    const s = this.s;
    if (s.cbTimer === this) s.cbModified = true;
    this.param = param; this.enabled = true;
    if (delay < 0n) delay = 0n;
    this.start = s.time(); this.expire = delay >= NEVER ? NEVER : this.start + delay; this.period = period;
    s.remove(this); s.insert(this);
    if (s.list[0] === this) s.abort();
  }
  enable(en) {
    const old = this.enabled;
    if (old !== en) { this.enabled = en; this.s.remove(this); this.s.insert(this); }
    return old;
  }
  remaining() { return this.enabled && this.expire < NEVER ? this.expire - this.s.time() : NEVER; }
}
// exec: { name, cpu (has icount and run(n)), apc (attoseconds per cycle), shift, div, cyc (attos per cycle for time()) }
class Scheduler {
  constructor() {
    this.list = []; this.basetime = 0n; this.execs = []; this.executing = null;
    this.cbTimer = null; this.cbModified = false; this.cbExpire = 0n;
    this.quantum = 16666666666666666n; // maximum_quantum(1/60 s)
    this.log = null; // optional function(line)
  }
  addExec(e) {
    e.localtime = 0n; e.total = 0; e.running = 0; e.stolen = 0;
    e.apcN = new Array(MEMO); e.cycN = new Array(MEMO); e.shiftN = 2 ** Number(e.shift); e.divN = Number(e.div);
    this.execs.push(e); return e;
  }
  // n * e.apc and n * e.cyc as BigInt, with the products of small n kept
  apcTimes(e, n) { if (n >= 0 && n < MEMO) { const t = e.apcN[n]; return t !== undefined ? t : (e.apcN[n] = BigInt(n) * e.apc); } return BigInt(n) * e.apc; }
  cycTimes(e, n) { if (n >= 0 && n < MEMO) { const t = e.cycN[n]; return t !== undefined ? t : (e.cycN[n] = BigInt(n) * e.cyc); } return BigInt(n) * e.cyc; }
  time() {
    if (this.cbTimer) return this.cbExpire;
    const e = this.executing;
    if (e) return e.localtime + this.cycTimes(e, e.running - e.cpu.icount);
    return this.basetime;
  }
  totalCycles(e) { return this.executing === e ? e.total + e.running - e.cpu.icount : e.total; }
  insert(t) { // inactive timers are simply kept off the list
    if (t.expire >= NEVER || !t.enabled) return;
    const L = this.list; let i = 0;
    while (i < L.length && !(L[i].expire > t.expire)) i++;
    L.splice(i, 0, t);
  }
  remove(t) { const i = this.list.indexOf(t); if (i >= 0) this.list.splice(i, 1); }
  timer(name, cb) { return new Timer(this, name, cb, false); }       // timer_alloc: never
  timerSet(delay, name, cb, param = 0) { // anonymous temporary timer
    const t = new Timer(this, name, cb, true); t.param = param; t.expire = t.start + delay; t.enabled = true;
    this.insert(t); if (this.list[0] === t) this.abort(); return t;
  }
  synchronize(name, cb, param = 0) { return this.timerSet(0n, name, cb, param); }
  abort() {
    const e = this.executing; if (!e) return;
    const ic = e.cpu.icount;
    if (ic > 0) { e.stolen += ic; e.running -= ic; e.cpu.icount = 0; }
  }
  head() { return this.list.length ? this.list[0].expire : NEVER; }
  timeslice() {
    const log = this.log;
    while (this.basetime < this.head()) {
      let target = this.basetime + this.quantum; const h = this.head(); if (h < target) target = h;
      for (const e of this.execs) {
        if (e.suspended) continue;
        const delta = target - e.localtime;
        if (delta >= e.apc) {
          // floor(floor(delta / 2^shift) / div): exact on Numbers below 2^53 (the quotient is small, so a remainder of
          // at least 1/div is far larger than the rounding step and floor never crosses an integer wrongly)
          let ran = delta < EXACT ? Math.floor(Math.floor(Number(delta) / e.shiftN) / e.divN) : Number((delta >> e.shift) / e.div);
          e.running = ran; e.stolen = 0; this.executing = e;
          e.cpu.run(ran);
          ran = ran - e.cpu.icount - e.stolen;   // MAME: ran -= *icountptr; ran -= m_cycles_stolen
          e.total += ran; e.cpu.total = e.total;
          if (log) log(`X ${e.name} ${e.running + e.stolen} ${ran} ${e.total}`);
          e.localtime += this.apcTimes(e, ran);
          if (e.localtime < target) target = e.localtime > this.basetime ? e.localtime : this.basetime;
        }
      }
      this.executing = null;
      this.basetime = target;
    }
    this.executeTimers();
  }
  executeTimers() {
    const log = this.log;
    while (this.list.length && this.list[0].expire <= this.basetime) {
      const t = this.list[0], was = t.enabled;
      if (t.period === 0n || t.period >= NEVER) t.enabled = false;
      this.cbModified = false; this.cbTimer = t; this.cbExpire = t.expire;
      if (was && t.cb) { if (log && t.name) log(`T ${t.name} ${t.expire / ASPS} ${t.expire % ASPS}`); t.cb(t.param); }
      if (!this.cbModified) {
        if (!t.temporary) { t.start = t.expire; t.expire = t.period >= NEVER ? NEVER : t.expire + t.period; this.remove(t); this.insert(t); }
        else this.remove(t);
      }
    }
    this.cbTimer = null;
  }
  runUntil(T) { while (this.basetime < T) this.timeslice(); }
}
// device_execute_interface::device_input
class InputLine {
  constructor(s, exec, line) { this.s = s; this.exec = exec; this.line = line; this.cur = CLEAR; this.q = []; this.cb = () => this.empty(); }
  set(state) {
    this.q.push(state);
    if (this.q.length === 1) this.s.synchronize('device_execute_interface::device_input::empty_event_queue', this.cb);
  }
  empty() {
    for (const st of this.q) { this.cur = st; this.exec.cpu.setInput(this.line, st === CLEAR ? 0 : st); }
    this.q.length = 0;
  }
  ack() { if (this.cur === HOLD) { this.exec.cpu.setInput(this.line, 0); this.cur = CLEAR; } }
}
// attotime::from_ticks / cycles_to_attotime for small counts (n < clock): n * floor(1e18 / clock)
const perTick = hz => ASPS / BigInt(hz);
const api = { Scheduler, Timer, InputLine, NEVER, ASPS, CLEAR, ASSERT, HOLD, perTick };
if (typeof module !== 'undefined') module.exports = api; else G.SCHED = api;
})(typeof window !== 'undefined' ? window : globalThis);
