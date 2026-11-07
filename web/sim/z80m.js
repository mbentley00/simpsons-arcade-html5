'use strict';
// License: BSD-3-Clause, copyright-holder Juergen Buchmueller. See THIRD_PARTY_NOTICES.md.
// Z80 core mirroring MAME's cycle-split z80 device (devices/cpu/z80): the instruction body is transpiled from MAME's
// generated z80.hxx (web/sim/z80m_core.js, see tools/z80_transpile.py); the helpers below mirror z80.cpp.
// run(cycles) executes like execute_run(): it may stop in the middle of an instruction once icount <= 0 and resumes there.
// bus: { read(a), write(a, v), ioRead(a), ioWrite(a, v), irqAck() -> vector }
class Z80M {
  constructor(bus) {
    this.bus = bus;
    this.buf = new ArrayBuffer(32); this.w = new Uint16Array(this.buf); this.b = new Uint8Array(this.buf);
    this.f = new Uint8Array(9);
    this.SA_BUSREQ = 0; this.SA_NMI_PENDING = 1; this.SA_IRQ_ON = 2; this.SA_HALT = 3; this.SA_AFTER_EI = 4; this.SA_AFTER_LDAIR = 5;
    this.hook = null;
    // device_start
    this.w.fill(0); this.set_f(0); this.w[4] = this.w[5] = 0xffff; this.f[1] = 0;
    this.iff1 = 0; this.iff2 = 0; this.halt_ = 0; this.im = 0; this.nmi_state = 0; this.irq_state = 0; this.wait_state = 0;
    this.busreq_state = 0; this.busack_state = 0; this.ea = 0; this.sa = 0; this.tmp_irq_vector = 0; this.icount = 0;
    this.total = 0; // total cycles executed (like total_cycles())
    this.reset();
  }
  reset() {
    this.leave_halt(); this.ref = 0xffff00; this.w[10] = 0; this.w[6] = 0; this.b[18] = 0; this.b[16] = 0; this.b[17] = 0;
    this.iff1 = 0; this.iff2 = 0; this.sa &= ~((1 << 1) | (1 << 4) | (1 << 5));
  }
  // execute_run with icount = cycles; returns cycles actually run (cycles - icount)
  run(cycles) { this.icount = cycles; this.runCore(); const ran = cycles - this.icount; this.total += ran; return ran; }
  // current cycle offset inside a run (cycles_running - icount, MAME's time() during execution)
  setInput(line, state) { // execute_set_input
    if (line === 'nmi') {
      if (this.nmi_state === 0 && state !== 0 && this.total) this.sa |= 1 << 1;
      this.nmi_state = state;
    } else {
      this.irq_state = state;
      if (state) this.sa |= 1 << 2; else this.sa &= ~(1 << 2);
    }
  }
  // memory helpers (z80.cpp)
  data_read(a) { return this.bus.read(a & 0xffff); }
  data_write(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  opcode_read() { return this.bus.read(this.w[10]); }
  arg_read() { return this.bus.read(this.w[10]); }
  stack_read(a) { return this.data_read(a); }
  stack_write(a, v) { this.data_write(a, v); }
  io_read(a) { return this.bus.ioRead ? this.bus.ioRead(a & 0xffff) : 0xff; }
  io_write(a, v) { if (this.bus.ioWrite) this.bus.ioWrite(a & 0xffff, v & 0xff); }
  standard_irq_callback() { return this.bus.irqAck ? this.bus.irqAck() : 0xff; }
  reti() {}
  illegal_1() {} illegal_2() {}
  // flags (m_f: 0 s_val 1 z_val 2 yx_val 3 h_val 4 pv_val 5 n 6 c 7 q 8 qtemp)
  f_s() { return this.f[0] & 0x80; }
  f_z() { return this.f[1] ? 0 : 0x40; }
  f_yx() { return this.f[2] & 0x28; }
  f_h() { return this.f[3] & 0x10; }
  f_pv() { let v = this.f[4]; v ^= v >> 4; v ^= (v << 2) & 0xff; v ^= v >> 1; return ~v & 0x04; }
  get_f() { return this.f_s() | this.f_z() | this.f_yx() | this.f_h() | this.f_pv() | (this.f[5] ? 2 : 0) | (this.f[6] ? 1 : 0); }
  set_f(v) { const f = this.f; f[0] = v; f[1] = !(v & 0x40) ? 1 : 0; f[2] = v; f[3] = v; f[4] = !(v & 4) ? 1 : 0; f[5] = (v & 2) ? 1 : 0; f[6] = (v & 1) ? 1 : 0; }
  halt() { if (!this.halt_) { this.halt_ = 1; this.sa |= 1 << 3; } }
  leave_halt() { if (this.halt_) { this.halt_ = 0; this.sa &= ~(1 << 3); } }
  inc(r) { r = (r + 1) & 0xff; const f = this.f; f[8] = 0; f[0] = f[1] = f[2] = r; f[4] = r !== 0x80 ? 1 : 0; f[3] = (r & 0x0f) === 0 ? 0x10 : 0; f[5] = 0; return r; }
  dec(r) { r = (r - 1) & 0xff; const f = this.f; f[8] = 0; f[0] = f[1] = f[2] = r; f[4] = r !== 0x7f ? 1 : 0; f[3] = (r & 0x0f) === 0x0f ? 0x10 : 0; f[5] = 1; return r; }
  rlca() { const b = this.b, f = this.f, a = b[1]; b[1] = (a << 1) | (a >> 7); f[8] = 0; f[2] = b[1]; f[3] = f[5] = 0; f[6] = b[1] & 1; }
  rrca() { const b = this.b, f = this.f, a = b[1]; b[1] = (a >> 1) | (a << 7); f[8] = 0; f[2] = b[1]; f[3] = f[5] = 0; f[6] = a & 1; }
  rla() { const b = this.b, f = this.f, a = b[1], r = ((a << 1) + f[6]) & 0xff; f[8] = 0; f[2] = r; f[3] = f[5] = 0; f[6] = (a & 0x80) ? 1 : 0; b[1] = r; }
  rra() { const b = this.b, f = this.f, a = b[1], r = ((f[6] << 7) | (a >> 1)) & 0xff; f[8] = 0; f[2] = r; f[3] = f[5] = 0; f[6] = a & 1; b[1] = r; }
  add_a(v) { const b = this.b, f = this.f, A = b[1], r = (A + v) & 0xffff; f[8] = 0; f[0] = f[1] = f[2] = r; f[6] = (r & 0x100) ? 1 : 0; f[3] = (A & 15) + (v & 15); f[4] = !((A ^ r) & (v ^ r) & 0x80) ? 1 : 0; f[5] = 0; b[1] = r; }
  adc_a(v) { const b = this.b, f = this.f, A = b[1], c = f[6], r = (A + v + c) & 0xffff; f[8] = 0; f[0] = f[1] = f[2] = r; f[6] = (r & 0x100) ? 1 : 0; f[3] = (A & 15) + (v & 15) + c; f[4] = !((A ^ r) & (v ^ r) & 0x80) ? 1 : 0; f[5] = 0; b[1] = r; }
  sub_a(v) { const b = this.b, f = this.f, A = b[1], r = (A - v) & 0xffff; f[8] = 0; f[0] = f[1] = f[2] = r; f[6] = (r & 0x100) ? 1 : 0; f[3] = (A & 15) - (v & 15); f[4] = !((A ^ v) & (A ^ r) & 0x80) ? 1 : 0; f[5] = 1; b[1] = r; }
  sbc_a(v) { const b = this.b, f = this.f, A = b[1], c = f[6], r = (A - v - c) & 0xffff; f[8] = 0; f[0] = f[1] = f[2] = r; f[6] = (r & 0x100) ? 1 : 0; f[3] = (A & 15) - (v & 15) - c; f[4] = !((A ^ v) & (A ^ r) & 0x80) ? 1 : 0; f[5] = 1; b[1] = r; }
  neg() { const v = this.b[1]; this.b[1] = 0; this.sub_a(v); }
  daa() {
    const b = this.b, f = this.f, A = b[1]; let a = A;
    if (f[5]) { if (this.f_h() || (A & 0xf) > 9) a -= 6; if (f[6] || A > 0x99) a -= 0x60; }
    else { if (this.f_h() || (A & 0xf) > 9) a += 6; if (f[6] || A > 0x99) a += 0x60; }
    a &= 0xff; f[8] = 0; f[0] = f[1] = f[4] = f[2] = a; f[3] = A ^ a; f[6] = (f[6] || A > 0x99) ? 1 : 0; b[1] = a;
  }
  and_a(v) { const b = this.b, f = this.f; b[1] &= v; f[8] = 0; f[0] = f[1] = f[4] = f[2] = b[1]; f[5] = f[6] = 0; f[3] = 0x10; }
  or_a(v) { const b = this.b, f = this.f; b[1] |= v; f[8] = 0; f[0] = f[1] = f[4] = f[2] = b[1]; f[3] = f[5] = f[6] = 0; }
  xor_a(v) { const b = this.b, f = this.f; b[1] ^= v; f[8] = 0; f[0] = f[1] = f[4] = f[2] = b[1]; f[3] = f[5] = f[6] = 0; }
  cp(v) { const b = this.b, f = this.f, A = b[1], r = (A - v) & 0xffff; f[8] = 0; f[0] = f[1] = r; f[2] = v; f[6] = (r & 0x100) ? 1 : 0; f[3] = (A & 15) - (v & 15); f[4] = !((A ^ v) & (A ^ r) & 0x80) ? 1 : 0; f[5] = 1; }
  exx() { const w = this.w; for (const [i, j] of [[1, 13], [2, 14], [3, 15]]) { const t = w[i]; w[i] = w[j]; w[j] = t; } }
  sh_(r, c) { const f = this.f; r &= 0xff; f[8] = 0; f[0] = f[1] = f[4] = f[2] = r; f[3] = f[5] = 0; f[6] = c ? 1 : 0; return r; }
  rlc(v) { return this.sh_((v << 1) | (v >> 7), v & 0x80); }
  rrc(v) { return this.sh_((v >> 1) | (v << 7), v & 1); }
  rl(v) { return this.sh_((v << 1) + this.f[6], v & 0x80); }
  rr(v) { return this.sh_((v >> 1) | (this.f[6] << 7), v & 1); }
  sla(v) { return this.sh_(v << 1, v & 0x80); }
  sra(v) { return this.sh_((v >> 1) | (v & 0x80), v & 1); }
  sll(v) { return this.sh_((v << 1) | 1, v & 0x80); }
  srl(v) { return this.sh_(v >> 1, v & 1); }
  bit(n, v) { const f = this.f; f[8] = 0; f[0] = f[1] = f[4] = v & (1 << n); f[3] = 0x10; f[5] = 0; f[2] = v; }
  bit_hl(n, v) { const f = this.f; f[8] = 0; f[0] = f[1] = f[4] = v & (1 << n); f[3] = 0x10; f[5] = 0; f[2] = this.b[13]; }
  bit_xy(n, v) { const f = this.f; f[8] = 0; f[0] = f[1] = f[4] = v & (1 << n); f[3] = 0x10; f[5] = 0; f[2] = this.ea >> 8; }
  res_(n, v) { return v & ~(1 << n) & 0xff; }
  set_(n, v) { return (v | (1 << n)) & 0xff; }
  block_io_interrupted_flags() {
    const f = this.f, b = this.b; f[2] = this.w[10] >> 8; const pvOld = this.f_pv(), B = b[3];
    if (f[6]) {
      f[3] = 0;
      if (b[14] & 0x80) { f[4] = (B - 1) & 7; if ((B & 15) === 0) f[3] = 0x10; }
      else { f[4] = (B + 1) & 7; if ((B & 15) === 15) f[3] = 0x10; }
    } else f[4] = B & 7;
    f[4] = (pvOld ^ this.f_pv()) & 4;
  }
  ei() { this.iff1 = this.iff2 = 1; this.sa |= 1 << 4; }
  get pc() { return this.w[10]; }
  save() { return { buf: this.b.slice(), f: this.f.slice(), s: [this.iff1, this.iff2, this.halt_, this.im, this.nmi_state, this.irq_state, this.ea, this.sa, this.tmp_irq_vector, this.ref, this.total] }; }
  load(o) { this.b.set(o.buf); this.f.set(o.f); [this.iff1, this.iff2, this.halt_, this.im, this.nmi_state, this.irq_state, this.ea, this.sa, this.tmp_irq_vector, this.ref, this.total] = o.s; }
}
require('./z80m_core.js')(Z80M);
module.exports = Z80M;
