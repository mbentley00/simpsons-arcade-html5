'use strict';
// License for the wrapped core: BSD-3-Clause, Nathan Woods. See THIRD_PARTY_NOTICES.md.
// KONAMI CPU, cycle-resumable: wraps konamim_core.js (transpiled from MAME konami.hxx) so that execution can be
// suspended mid-instruction exactly where MAME does (icount <= 0 checks + 9-bit state stack).
// bus: { read(a), write(a,v), setLines(v), irqAck(line) }  line: 'nmi' | 'firq' | 'irq'
const execute_one = require('./konamim_core.js');
class P16 {
  constructor() { this.w = 0; }
  get h() { return this.w >> 8; } set h(v) { this.w = ((v & 0xff) << 8) | (this.w & 0xff); }
  get l() { return this.w & 0xff; } set l(v) { this.w = (this.w & 0xff00) | (v & 0xff); }
}
class R16 { // masks on write
  constructor() { this._w = 0; }
  get w() { return this._w; } set w(v) { this._w = v & 0xffff; }
  get h() { return this._w >> 8; } set h(v) { this._w = ((v & 0xff) << 8) | (this._w & 0xff); }
  get l() { return this._w & 0xff; } set l(v) { this._w = (this._w & 0xff00) | (v & 0xff); }
}
const K = {
  CC_C: 1, CC_V: 2, CC_Z: 4, CC_N: 8, CC_I: 0x10, CC_H: 0x20, CC_F: 0x40, CC_E: 0x80,
  CC_VC: 3, CC_ZC: 5, CC_NZ: 0xc, CC_NZC: 0xd, CC_NZV: 0xe, CC_NZVC: 0xf, CC_HNZVC: 0x2f,
  VECTOR_SWI3: 0xfff2, VECTOR_SWI2: 0xfff4, VECTOR_FIRQ: 0xfff6, VECTOR_IRQ: 0xfff8, VECTOR_SWI: 0xfffa, VECTOR_NMI: 0xfffc,
  VECTOR_RESET_FFFE: 0xfffe, VECTOR_SWIN: 0xfffa,
  ADDRESSING_MODE_IMMEDIATE: 0, ADDRESSING_MODE_EA: 1, ADDRESSING_MODE_REGISTER_A: 2, ADDRESSING_MODE_REGISTER_B: 3, ADDRESSING_MODE_REGISTER_D: 4,
  INPUT_LINE_NMI: 'nmi', M6809_FIRQ_LINE: 'firq', M6809_IRQ_LINE: 'irq', EXCEPTION_SWI: 0, EXCEPTION_SWIN: 0,
};
const s8 = v => ((v & 0xff) ^ 0x80) - 0x80, s16 = v => ((v & 0xffff) ^ 0x8000) - 0x8000;
class KonamiM {
  constructor(bus) {
    this.bus = bus;
    this.pc = new R16(); this.x = new R16(); this.y = new R16(); this.u = new R16(); this.s = new R16();
    this.q = new R16(); this.ea = new R16(); this.temp = new R16();
    this.cc = 0; this.dp = 0; this.ppc = 0; this.opcode = 0; this.icount = 0; this.state = 0;
    this.addressing_mode = 1; this.r8 = 'h'; this.r16 = this.x; this.cond = false; this.temp_im = 0; this.bcount = 0;
    this.nmi_line = false; this.nmi_asserted = false; this.firq_line = false; this.irq_line = false; this.lds_encountered = false;
    this.total = 0; this.onInsn = null;
  }
  reset() { // m6809 device_reset
    this.nmi_asserted = false; this.lds_encountered = false; this.dp = 0; this.cc |= 0x50; this.set_ea(0xfffe); this.state = 1;
  }
  setInput(line, st) {
    if (line === 'nmi') { this.nmi_asserted = this.nmi_asserted || (st && !this.nmi_line && this.lds_encountered); this.nmi_line = !!st; }
    else if (line === 'firq') this.firq_line = !!st; else this.irq_line = !!st;
  }
  // run like MAME execute_run with icount = cycles; returns cycles actually consumed (cycles - icount)
  run(cycles) {
    this.icount = cycles;
    do execute_one.call(this, K, s8, s16); while (this.icount > 0);
    return cycles - this.icount;
  }
  get a() { return this.q.h; } get b() { return this.q.l; }
  // ---- m6809.h / m6809inl.h / konami.cpp helpers ----
  eat(n) { this.icount -= n; }
  eat_remaining() { this.eat(this.icount); }
  read_memory(a) { this.icount--; return this.bus.read(a & 0xffff) & 0xff; }
  write_memory(a, v) { this.icount--; this.bus.write(a & 0xffff, v & 0xff); }
  read_opcode(a) { if (a === undefined) { a = this.pc.w; this.pc.w = a + 1; } this.icount--; return this.bus.read(a) & 0xff; }
  read_opcode_arg(a) { if (a === undefined) { a = this.pc.w; this.pc.w = a + 1; } this.icount--; return this.bus.read(a & 0xffff) & 0xff; }
  dummy_read_opcode_arg(d) { this.icount--; }
  dummy_vma(n) { this.icount -= n; }
  push_state(s) { this.state = ((this.state << 9) | s) >>> 0; }
  pop_state() { const r = this.state & 0x1ff; this.state >>>= 9; return r; }
  read_ea() { return this.read_memory(this.ea.w); }
  write_ea(v) { this.write_memory(this.ea.w, v); }
  set_ea(v) { this.ea.w = v; this.addressing_mode = 1; }
  set_ea_h(v) { this.ea.h = v; }
  set_ea_l(v) { this.ea.l = v; this.addressing_mode = 1; }
  set_a() { this.addressing_mode = 2; } set_b() { this.addressing_mode = 3; } set_d() { this.addressing_mode = 4; } set_imm() { this.addressing_mode = 0; }
  nop() {}
  add8_sets_h() { return true; } hd6309_native_mode() { return true; } firq_saves_entire_state() { return false; }
  partial_state_registers() { return 0x81; } entire_state_registers() { return 0xff; }
  is_register_addressing_mode() { return this.addressing_mode !== 0 && this.addressing_mode !== 1; }
  get_pending_interrupt() {
    if (this.nmi_asserted) return 0xfffc;
    if (!(this.cc & 0x40) && this.firq_line) return 0xfff6;
    if (!(this.cc & 0x10) && this.irq_line) return 0xfff8;
    return 0;
  }
  cond_hi() { return !(this.cc & 5); } cond_cc() { return !(this.cc & 1); } cond_ne() { return !(this.cc & 4); }
  cond_vc() { return !(this.cc & 2); } cond_pl() { return !(this.cc & 8); }
  cond_ge() { return !!(this.cc & 8) === !!(this.cc & 2); } cond_gt() { return this.cond_ge() && !(this.cc & 4); }
  set_cond(c) { this.cond = c; } branch_taken() { return this.cond; }
  sf(mask, a, b, r, hi) {
    let cc = this.cc & ~mask;
    if (mask & 0x20) cc |= ((a ^ b ^ r) & 0x10) ? 0x20 : 0;
    if (mask & 8) cc |= (r & hi) ? 8 : 0;
    if (mask & 4) cc |= (r & (hi * 2 - 1)) === 0 ? 4 : 0;
    if (mask & 2) cc |= ((a ^ b ^ r ^ (r >>> 1)) & hi) ? 2 : 0;
    if (mask & 1) cc |= (r & (hi << 1)) ? 1 : 0;
    this.cc = cc; return r & (hi * 2 - 1);
  }
  sf8(mask, a, b, r) { if (b === undefined) { r = a; a = 0; b = r; } return this.sf(mask, a & 0xff, b & 0xff, r >>> 0, 0x80); }
  sf16(mask, a, b, r) { if (b === undefined) { r = a; a = 0; b = r; } return this.sf(mask, a & 0xffff, b & 0xffff, r >>> 0, 0x8000); }
  rotate_right_8(v) { const c = v & 1; v >>= 1; if (this.cc & 1) v |= 0x80; else v &= ~0x80; this.cc = c ? this.cc | 1 : this.cc & ~1; return v; }
  rotate_right_16(v) { const c = v & 1; v >>= 1; if (this.cc & 1) v |= 0x8000; else v &= ~0x8000; this.cc = c ? this.cc | 1 : this.cc & ~1; return v; }
  rotate_left_8(v) { const c = v & 0x80; let n = (v << 1) | (this.cc & 1); this.cc = c ? this.cc | 1 : this.cc & ~1; return n; }
  rotate_left_16(v) { const c = v & 0x8000; let n = (v << 1) | (this.cc & 1); this.cc = c ? this.cc | 1 : this.cc & ~1; return n; }
  read_operand(o) {
    switch (this.addressing_mode) {
      case 1: return this.read_memory((this.ea.w + (o || 0)) & 0xffff);
      case 0: return this.read_opcode_arg();
      case 2: return this.q.h; case 3: return this.q.l;
      case 4: return (o & 1) ? this.q.l : this.q.h;
    }
    throw new Error('read_operand');
  }
  write_operand(o, v) {
    if (v === undefined) { v = o; o = 0; }
    switch (this.addressing_mode) {
      case 0: return; case 1: this.write_memory((this.ea.w + o) & 0xffff, v); return;
      case 2: this.q.h = v; return; case 3: this.q.l = v; return;
      case 4: if (o & 1) this.q.l = v; else this.q.h = v; return;
    }
    throw new Error('write_operand');
  }
  read_vector(o) { return this.read_memory(this.ea.w + o); }
  ireg() {
    switch (this.opcode & 0x70) { case 0x20: return this.x; case 0x30: return this.y; case 0x50: return this.u; case 0x60: return this.s; case 0x70: return this.pc; }
    throw new Error('ireg');
  }
  read_exgtfr_register(r) {
    switch (r & 7) { case 0: return this.q.h | 0x1000; case 1: return this.q.w; case 2: return this.x.w; case 3: return this.y.w;
      case 4: return 0; case 5: return this.u.w; case 6: return this.s.w; case 7: return this.pc.w; }
  }
  write_exgtfr_register(r, v) {
    switch (r & 7) { case 0: this.q.h = v; break; case 1: this.q.l = v; break; case 2: this.x.w = v; break; case 3: this.y.w = v; break;
      case 5: this.u.w = v; break; case 6: this.s.w = v; break; case 7: this.pc.w = v; break; }
  }
  daa() {
    let cf = 0; const msn = this.q.h & 0xf0, lsn = this.q.h & 0x0f;
    if (lsn > 9 || (this.cc & 0x20)) cf |= 6;
    if (msn > 0x80 && lsn > 9) cf |= 0x60;
    if (msn > 0x90 || (this.cc & 1)) cf |= 0x60;
    const t = (this.q.h + cf) & 0xffff;
    this.cc &= ~2; if (t & 0x100) this.cc |= 1;
    this.q.h = this.sf8(0xc, t);
  }
  mul() { const r = this.q.h * this.q.l; this.q.w = this.sf16(4, r); if (this.q.w & 0x80) this.cc |= 1; else this.cc &= ~1; }
  lmul() {
    const r = (this.x.w * this.y.w) >>> 0; this.x.w = r >>> 16; this.y.w = r & 0xffff;
    this.cc &= ~4; if (r === 0) this.cc |= 4;
    if (r & 0x8000) this.cc |= 1; else this.cc &= ~1;
  }
  divx() {
    let res = 0, rem = 0; const b = this.q.l;
    if (b) { res = Math.floor(this.x.w / b) & 0xffff; rem = (this.x.w % b) & 0xff; }
    this.x.w = this.sf16(4, res); this.q.l = rem;
    if (res & 0x80) this.cc |= 1; else this.cc &= ~1;
  }
  set_lines(v) { this.bus.setLines && this.bus.setLines(v & 0xff); }
  standard_irq_callback(line) { this.bus.irqAck && this.bus.irqAck(line); }
  debugger_instruction_hook() { if (this.onInsn) this.onInsn(this); }
  debugger_exception_hook() {} syncack_write_func() {} log_illegal() {} logerror() {}
  fatalerror(m) { throw new Error(m); }
}
module.exports = { KonamiM };
