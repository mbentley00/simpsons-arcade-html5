// License: BSD-3-Clause, copyright-holder Nathan Woods; the M6809 base is copyright John Butler. See THIRD_PARTY_NOTICES.md.
// KONAMI (053248) CPU core: hand port of MAME 0.289 src/devices/cpu/m6809/konami.cpp + konami.lst + base6x09.lst
// (m6809 base, hd6309_native_mode() == true so every "if(!hd6309_native_mode())" block is skipped).
// Each call to step() runs one MAIN pass of konami.lst atomically: either an interrupt entry (NMI/FIRQ/IRQ, sampled
// only here, exactly like MAME) or one instruction, and returns its exact cycle count (CPU cycles = clock/4,
// simpsons: 24 MHz/2 /4 = 3 MHz). Cycle rules (m6809.h): every read_memory / write_memory / read_opcode /
// read_opcode_arg / dummy_read_opcode_arg costs 1, dummy_vma(n) costs n, eat(n) costs n.
// Dummy reads (dummy_read_opcode_arg, dummy_vma -> read_opcode_arg(0xffff)) are only counted, not put on the bus.
// bus: { read(addr) -> byte, write(addr, byte), setLines(byte) (SETLN), iack(line) (optional: HOLD_LINE clear) }
'use strict';
(function (G) {
  const CC_C = 1, CC_V = 2, CC_Z = 4, CC_N = 8, CC_I = 0x10, CC_H = 0x20, CC_F = 0x40, CC_E = 0x80;
  const NZVC = 0x0f, NZV = 0x0e, NZ = 0x0c, HNZVC = 0x2f;
  // addressing modes (m6809.h)
  const AM_EA = 0, AM_IMM = 1, AM_A = 2, AM_B = 3, AM_D = 4;
  // register selectors for regop8/regop16
  const RA = 0, RB = 1, RD = 2, RX = 3, RY = 4, RU = 5, RS = 6;
  const LINE_NMI = 'nmi', LINE_FIRQ = 'firq', LINE_IRQ = 'irq';

  class Konami {
    constructor(bus) {
      this.bus = bus;
      this.a = 0; this.b = 0; this.x = 0; this.y = 0; this.u = 0; this.s = 0; this.pc = 0; this.dp = 0; this.cc = 0;
      this.ea = 0; this.am = AM_EA; this.temp = 0; this.cyc = 0; this.total = 0; this.ppc = 0;
      this.nmiLine = false; this.nmiAsserted = false; this.firqLine = false; this.irqLine = false; this.ldsEncountered = false;
      this.illegal = 0;
    }
    // ---- MAME device_reset + INTERRUPT_VECTOR(FFFE) ----
    reset() {
      this.nmiAsserted = false; this.ldsEncountered = false; this.dp = 0; this.cc |= CC_I | CC_F;
      this.cyc = 0; this.ea = 0xfffe; this.vector(); this.total += this.cyc; return this.cyc;
    }
    // ---- input lines (m6809.cpp execute_set_input) ----
    setNMI(state) { this.nmiAsserted = this.nmiAsserted || (state && !this.nmiLine && this.ldsEncountered); this.nmiLine = !!state; }
    setFIRQ(state) { this.firqLine = !!state; }
    setIRQ(state) { this.irqLine = !!state; }
    get d() { return (this.a << 8) | this.b; }
    set d(v) { this.a = (v >> 8) & 0xff; this.b = v & 0xff; }
    // ---- bus helpers ----
    rd(a) { this.cyc++; return this.bus.read(a & 0xffff) & 0xff; }
    wr(a, v) { this.cyc++; this.bus.write(a & 0xffff, v & 0xff); }
    arg() { this.cyc++; const v = this.bus.read(this.pc) & 0xff; this.pc = (this.pc + 1) & 0xffff; return v; }
    // ---- set_flags<T>(mask, a, b, r) ----
    f8(mask, a, b, r) {
      let cc = this.cc & ~mask;
      if (mask & CC_H) cc |= ((a ^ b ^ r) & 0x10) ? CC_H : 0;
      if (mask & CC_N) cc |= (r & 0x80) ? CC_N : 0;
      if (mask & CC_Z) cc |= (r & 0xff) === 0 ? CC_Z : 0;
      if (mask & CC_V) cc |= ((a ^ b ^ r ^ (r >>> 1)) & 0x80) ? CC_V : 0;
      if (mask & CC_C) cc |= (r & 0x100) ? CC_C : 0;
      this.cc = cc; return r & 0xff;
    }
    f16(mask, a, b, r) {
      let cc = this.cc & ~mask;
      if (mask & CC_H) cc |= ((a ^ b ^ r) & 0x10) ? CC_H : 0;
      if (mask & CC_N) cc |= (r & 0x8000) ? CC_N : 0;
      if (mask & CC_Z) cc |= (r & 0xffff) === 0 ? CC_Z : 0;
      if (mask & CC_V) cc |= ((a ^ b ^ r ^ (r >>> 1)) & 0x8000) ? CC_V : 0;
      if (mask & CC_C) cc |= (r & 0x10000) ? CC_C : 0;
      this.cc = cc; return r & 0xffff;
    }
    f8r(mask, r) { r &= 0xff; return this.f8(mask, 0, r, r); }      // one-arg form: r truncated to T
    f16r(mask, r) { r &= 0xffff; return this.f16(mask, 0, r, r); }
    rol(v, bits) { const hb = 1 << (bits - 1), nc = v & hb; let n = (v << 1) & ~1; if (this.cc & CC_C) n |= 1; this.cc = nc ? this.cc | CC_C : this.cc & ~CC_C; return n; }
    ror(v, bits) { const hb = 1 << (bits - 1), nc = v & 1; v >>= 1; v = (this.cc & CC_C) ? v | hb : v & ~hb; this.cc = nc ? this.cc | CC_C : this.cc & ~CC_C; return v; }
    // ---- regop ----
    r8(r) { return r === RA ? this.a : this.b; }
    w8(r, v) { if (r === RA) this.a = v & 0xff; else this.b = v & 0xff; }
    r16(r) { switch (r) { case RD: return (this.a << 8) | this.b; case RX: return this.x; case RY: return this.y; case RU: return this.u; default: return this.s; } }
    w16(r, v) { v &= 0xffff; switch (r) { case RD: this.a = v >> 8; this.b = v & 0xff; break; case RX: this.x = v; break; case RY: this.y = v; break; case RU: this.u = v; break; default: this.s = v; } }
    // ---- operands (konami.cpp read_operand / write_operand) ----
    rop() { switch (this.am) { case AM_EA: return this.rd(this.ea); case AM_IMM: return this.arg(); case AM_A: return this.a; case AM_B: return this.b; } throw new Error('rop'); }
    rop2(o) { switch (this.am) { case AM_EA: return this.rd(this.ea + o); case AM_IMM: return this.arg(); case AM_D: return o & 1 ? this.b : this.a; } throw new Error('rop2'); }
    wop(v) { switch (this.am) { case AM_EA: this.wr(this.ea, v); break; case AM_A: this.a = v & 0xff; break; case AM_B: this.b = v & 0xff; break; } }
    wop2(o, v) { switch (this.am) { case AM_EA: this.wr(this.ea + o, v); break; case AM_D: if (o & 1) this.b = v & 0xff; else this.a = v & 0xff; break; } }
    rd16op() { const h = this.rop2(0); return (h << 8) | this.rop2(1); }
    wr16op(v) { this.wop2(0, v >> 8); this.wop2(1, v); }
    isReg() { return this.am !== AM_IMM && this.am !== AM_EA; }
    // ---- INDEXED (konami.lst) ----
    ireg(pb) { switch (pb & 0x70) { case 0x20: return RX; case 0x30: return RY; case 0x50: return RU; case 0x60: return RS; case 0x70: return 7; } throw new Error('ireg'); }
    gi(r) { return r === 7 ? this.pc : this.r16(r); }
    si(r, v) { if (r === 7) this.pc = v & 0xffff; else this.w16(r, v); }
    indexed() {
      const pb = this.arg(); let t;
      switch (pb & 0xf7) {
        case 0x07: { const h = this.arg(); t = (h << 8) | this.arg(); this.cyc += 1; break; }
        case 0x20: case 0x30: case 0x50: case 0x60: case 0x70: { const r = this.ireg(pb); t = this.gi(r); this.si(r, t + 1); this.cyc += 2; break; }
        case 0x21: case 0x31: case 0x51: case 0x61: case 0x71: { const r = this.ireg(pb); t = this.gi(r); this.si(r, t + 2); this.cyc += 3; break; }
        case 0x22: case 0x32: case 0x52: case 0x62: case 0x72: { const r = this.ireg(pb); this.si(r, this.gi(r) - 1); t = this.gi(r); this.cyc += 2; break; }
        case 0x23: case 0x33: case 0x53: case 0x63: case 0x73: { const r = this.ireg(pb); this.si(r, this.gi(r) - 2); t = this.gi(r); this.cyc += 3; break; }
        case 0x24: case 0x34: case 0x54: case 0x64: case 0x74: { const e = this.gi(this.ireg(pb)), o = this.arg(); t = (e + ((o << 24) >> 24)) & 0xffff; this.cyc += 2; break; }
        case 0x25: case 0x35: case 0x55: case 0x65: case 0x75: { const e = this.gi(this.ireg(pb)), h = this.arg(), o = (h << 8) | this.arg(); t = (e + o) & 0xffff; this.cyc += 2; break; }
        case 0x26: case 0x36: case 0x56: case 0x66: case 0x76: t = this.gi(this.ireg(pb)); this.cyc += 1; break;
        case 0xc4: t = (this.dp << 8) | this.arg(); this.cyc += 1; break;
        case 0xa0: case 0xb0: case 0xd0: case 0xe0: case 0xf0: t = (this.gi(this.ireg(pb)) + ((this.a << 24) >> 24)) & 0xffff; this.cyc += 2; break;
        case 0xa1: case 0xb1: case 0xd1: case 0xe1: case 0xf1: t = (this.gi(this.ireg(pb)) + ((this.b << 24) >> 24)) & 0xffff; this.cyc += 2; break;
        case 0xa7: case 0xb7: case 0xd7: case 0xe7: case 0xf7: t = (this.gi(this.ireg(pb)) + this.d) & 0xffff; this.cyc += 2; break;
        default: t = 0; this.badPostbyte = (this.badPostbyte || 0) + 1; break;
      }
      if (pb & 0x08) { const h = this.rd(t); t = (h << 8) | this.rd(t + 1); this.cyc += 1; }
      this.ea = t & 0xffff; this.am = AM_EA;
    }
    // ---- PUSH / PULL (konami.lst) ----
    push(sp, m) { // sp: RS or RU
      let p = this.r16(sp); const W = v => { p = (p - 1) & 0xffff; this.wr(p, v); };
      if (m & 0x80) { W(this.pc); W(this.pc >> 8); }
      if (m & 0x40) { const o = sp === RS ? this.u : this.s; W(o); W(o >> 8); }
      if (m & 0x20) { W(this.y); W(this.y >> 8); }
      if (m & 0x10) { W(this.x); W(this.x >> 8); }
      if (m & 0x08) W(this.dp);
      if (m & 0x04) W(this.b);
      if (m & 0x02) W(this.a);
      if (m & 0x01) W(this.cc);
      this.w16(sp, p);
    }
    pull(sp, m) {
      let p = this.r16(sp); const R = () => { const v = this.rd(p); p = (p + 1) & 0xffff; return v; };
      if (m & 0x01) this.cc = R();
      if (m & 0x02) this.a = R();
      if (m & 0x04) this.b = R();
      if (m & 0x08) this.dp = R();
      if (m & 0x10) { const h = R(); this.x = (h << 8) | R(); }
      if (m & 0x20) { const h = R(); this.y = (h << 8) | R(); }
      if (m & 0x40) { const h = R(), v = (h << 8) | R(); if (sp === RS) this.u = v; else this.s = v; }
      if (m & 0x80) { const h = R(); this.pc = (h << 8) | R(); }
      this.w16(sp, p); this.cyc += 1;
      // NB: PULS S with U-mask writes the other stack reg; w16(sp) after is correct since p tracked the pulled-from reg.
    }
    vector() { this.cyc += 1; const h = this.rd(this.ea); this.pc = (h << 8) | this.rd(this.ea + 1); this.cyc += 1; }
    irqEntry(vec, entire, setF) {
      this.cyc += 3; // 2x dummy_read_opcode_arg + dummy_vma(1)
      if (entire) { this.cc |= CC_E; this.push(RS, 0xff); } else { this.cc &= ~CC_E; this.push(RS, 0x81); }
      this.cc |= CC_I | (setF ? CC_F : 0); this.ea = vec; this.am = AM_EA;
      if (this.bus.iack) this.bus.iack(vec === 0xfffc ? LINE_NMI : vec === 0xfff6 ? LINE_FIRQ : LINE_IRQ);
      this.vector();
    }
    branch(cond) { const o = this.arg(); this.cyc += 1; if (cond) this.pc = (this.pc + ((o << 24) >> 24)) & 0xffff; }
    lbranch(cond) { const h = this.arg(), o = (h << 8) | this.arg(); this.cyc += 1; if (cond) this.pc = (this.pc + o) & 0xffff; }
    gosub() { this.s = (this.s - 1) & 0xffff; this.wr(this.s, this.pc); this.s = (this.s - 1) & 0xffff; this.wr(this.s, this.pc >> 8); this.pc = this.ea; }
    cond(n) { // n = 0..7: true, hi, cc, ne, vc, pl, ge, gt
      const c = this.cc;
      switch (n) {
        case 0: return true; case 1: return !(c & (CC_Z | CC_C)); case 2: return !(c & CC_C); case 3: return !(c & CC_Z);
        case 4: return !(c & CC_V); case 5: return !(c & CC_N); case 6: return !!(c & CC_N) === !!(c & CC_V);
        default: return (!!(c & CC_N) === !!(c & CC_V)) && !(c & CC_Z);
      }
    }
    exgReg(r) { switch (r & 7) { case 0: return this.a | 0x1000; case 1: return this.d; case 2: return this.x; case 3: return this.y; case 4: return 0; case 5: return this.u; case 6: return this.s; default: return this.pc; } }
    exgSet(r, v) { switch (r & 7) { case 0: this.a = v & 0xff; break; case 1: this.b = v & 0xff; break; case 2: this.x = v & 0xffff; break; case 3: this.y = v & 0xffff; break; case 4: break; case 5: this.u = v & 0xffff; break; case 6: this.s = v & 0xffff; break; default: this.pc = v & 0xffff; } }
    // ---- shifts on D/indexed with count (LSRDI etc.) ----
    shiftDI(kind) {
      let n = (this.isReg() ? this.tempIm : this.a) & 0xf; let t = this.rd16op();
      while (n--) {
        this.cyc += 1;
        switch (kind) {
          case 0: this.cc = (this.cc & ~CC_C) | (t & 1); t = this.f16r(NZ, t >> 1); break;                 // LSRDI
          case 1: t = this.f16r(NZ, this.ror(t, 16)); break;                                                  // RORDI
          case 2: this.cc = (this.cc & ~CC_C) | (t & 1); t = this.f16r(NZ, ((t << 16) >> 16) >> 1); break;  // ASRDI
          case 3: t = this.f16(NZVC, t, t, t << 1); break;                                                    // ASLDI
          default: t = this.f16r(NZV, this.rol(t, 16)); break;                                                // ROLDI
        }
      }
      this.wr16op(t);
    }
    // ---- unary 8-bit ops ----
    un8(op) {
      let t;
      switch (op) {
        case 0: this.rop(); this.cc = (this.cc & ~NZVC) | CC_Z; if (!this.isReg()) this.cyc += 1; this.wop(0); return;     // CLR8
        case 1: t = this.rop(); this.cc = (this.cc & ~CC_V) | CC_C; t = this.f8r(NZ, ~t); break;                               // COM8
        case 2: t = this.rop(); t = this.f8(NZVC, 0, t, -t); break;                                                           // NEG8
        case 3: t = this.rop(); t = this.f8(NZV, t, 1, t + 1); if (!this.isReg()) this.cyc += 1; break;                       // INC8
        case 4: t = this.rop(); t = this.f8(NZV, t, 1, t - 1); if (!this.isReg()) this.cyc += 1; break;                       // DEC8
        case 5: t = this.rop(); this.f8r(NZV, t); if (!this.isReg()) this.cyc += 1; return;                                     // TST8
        case 6: t = this.rop(); this.cc = (this.cc & ~CC_C) | (t & 1); t = this.f8r(NZ, t >> 1); break;                       // LSR8
        case 7: t = this.rop(); t = this.f8r(NZ, this.ror(t, 8)); break;                                                      // ROR8
        case 8: t = this.rop(); this.cc = (this.cc & ~CC_C) | (t & 1); t = this.f8r(NZ, ((t << 24) >> 24) >> 1); break;       // ASR8
        case 9: t = this.rop(); t = this.f8(NZVC, t, t, t << 1); break;                                                       // ASL8
        default: t = this.rop(); t = this.f8(NZV, t, t, this.rol(t, 8)); break;                                               // ROL8
      }
      this.wop(t);
    }
    // 8-bit two-operand ALU (LD ADD ADC SUB SBC AND BIT EOR OR CMP)
    alu8(op, r) {
      const R = this.r8(r); let t;
      switch (op) {
        case 0: this.w8(r, this.rop()); this.f8r(NZV, this.r8(r)); return;                                               // LD8
        case 1: t = this.rop(); this.w8(r, this.f8(HNZVC, R, t, R + t)); return;                                          // ADD8
        case 2: t = this.rop(); this.w8(r, this.f8(HNZVC, R, t, R + t + (this.cc & CC_C))); return;                        // ADC8
        case 3: t = this.rop(); this.w8(r, this.f8(NZVC, R, t, R - t)); return;                                           // SUB8
        case 4: t = this.rop(); this.w8(r, this.f8(NZVC, R, t, R - t - (this.cc & CC_C))); return;                        // SBC8
        case 5: this.cc &= ~CC_V; this.w8(r, this.f8(NZ, 0, R, R & this.rop())); return;                                  // AND8
        case 6: this.cc &= ~CC_V; this.f8(NZ, 0, R, R & this.rop()); return;                                              // BIT8
        case 7: this.cc &= ~CC_V; this.w8(r, this.f8(NZ, 0, R, R ^ this.rop())); return;                                  // EOR8
        case 8: this.cc &= ~CC_V; this.w8(r, this.f8(NZ, 0, R, R | this.rop())); return;                                  // OR8
        default: t = this.rop(); this.f8(NZVC, R, t, R - t); return;                                                      // CMP8
      }
    }
    // ---- MAIN ----
    step() {
      this.cyc = 0;
      if (this.nmiAsserted) { this.nmiAsserted = false; this.irqEntry(0xfffc, true, true); }
      else if (!(this.cc & CC_F) && this.firqLine) this.irqEntry(0xfff6, false, true);
      else if (!(this.cc & CC_I) && this.irqLine) this.irqEntry(0xfff8, true, false);
      else { this.ppc = this.pc; this.exec(this.arg()); }
      this.total += this.cyc; return this.cyc;
    }
    exec(op) {
      let t, h;
      if (op >= 0x10 && op <= 0x37) { // 8-bit ALU: groups of 4 = (A imm, B imm, A idx, B idx)
        const r = op & 1 ? RB : RA; if (op & 2) this.indexed(); else this.am = AM_IMM;
        this.alu8((op - 0x10) >> 2, r); return;
      }
      if (op >= 0x60 && op <= 0x7f) { const n = op & 7, c = this.cond(n), v = op & 0x10 ? !c : c; if (op & 8) this.lbranch(v); else this.branch(v); return; }
      if (op >= 0x80 && op <= 0xa2 && op !== 0x8f && op !== 0x9f) {
        let grp, mode; // 0x80-0x8e: CLR COM NEG INC DEC, 0x90-0x9e: TST LSR ROR ASR ASL, 0xa0-0xa2: ROL (A, B, indexed)
        if (op <= 0x8e) { grp = (op - 0x80) / 3 | 0; mode = (op - 0x80) % 3; }
        else if (op <= 0x9e) { grp = 5 + ((op - 0x90) / 3 | 0); mode = (op - 0x90) % 3; }
        else { grp = 10; mode = op - 0xa0; }
        if (mode === 0) this.am = AM_A; else if (mode === 1) this.am = AM_B; else this.indexed();
        this.un8(grp); return;
      }
      switch (op) {
        case 0x08: case 0x09: this.indexed(); { const r = op === 0x08 ? RX : RY; this.w16(r, this.f16r(CC_Z, this.ea)); } this.cyc += 1; return; // LEA_xy
        case 0x0a: case 0x0b: this.indexed(); if (op === 0x0b) { this.ldsEncountered = true; this.s = this.ea; } else this.u = this.ea; this.cyc += 1; return;
        case 0x0c: t = this.arg(); this.cyc += 2; this.push(RS, t); return;
        case 0x0d: t = this.arg(); this.cyc += 2; this.push(RU, t); return;
        case 0x0e: t = this.arg(); this.cyc += 1; this.pull(RS, t); return;
        case 0x0f: t = this.arg(); this.cyc += 1; this.pull(RU, t); return;
        case 0x38: this.am = AM_IMM; t = this.rop(); if (this.bus.setLines) this.bus.setLines(t); return;
        case 0x39: this.indexed(); t = this.rop(); if (this.bus.setLines) this.bus.setLines(t); return;
        case 0x3a: case 0x3b: this.indexed(); this.wr(this.ea, this.f8r(NZV, this.r8(op & 1 ? RB : RA))); return;
        case 0x3c: this.am = AM_IMM; this.cc &= this.rop(); return;
        case 0x3d: this.am = AM_IMM; this.cc |= this.rop(); return;
        case 0x3e: case 0x3f: {
          const p = this.arg(), reg = this.exgReg(p);
          if (!(p & 0x80)) { const reg2 = this.exgReg(p >> 4); this.exgSet(p, reg2); this.cyc += 1; }
          this.exgSet(p >> 4, reg); this.cyc += 2; return;
        }
        case 0x40: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47: case 0x48: case 0x49: { // LD16
          const r = [RD, RX, RY, RU, RS][(op - 0x40) >> 1]; if (op & 1) this.indexed(); else this.am = AM_IMM;
          h = this.rop2(0); t = this.rop2(1); this.w16(r, (h << 8) | t);
          this.f16r(NZV, this.r16(r)); if (r === RS) this.ldsEncountered = true; return;
        }
        case 0x4a: case 0x4b: case 0x4c: case 0x4d: case 0x4e: case 0x4f: case 0x50: case 0x51: case 0x52: case 0x53: { // CMP16
          const r = [RD, RX, RY, RU, RS][(op - 0x4a) >> 1]; if (op & 1) this.indexed(); else this.am = AM_IMM;
          t = this.rd16op(); const R = this.r16(r); this.f16(NZVC, R, t, R - t); return;
        }
        case 0x54: case 0x55: this.am = AM_IMM; if (op & 1) this.indexed(); t = this.rd16op(); h = this.d; this.d = this.f16(NZVC, h, t, h + t); return;
        case 0x56: case 0x57: this.am = AM_IMM; if (op & 1) this.indexed(); t = this.rd16op(); h = this.d; this.d = this.f16(NZVC, h, t, h - t); return;
        case 0x58: case 0x59: case 0x5a: case 0x5b: case 0x5c: { // ST16
          const r = [RD, RX, RY, RU, RS][op - 0x58]; this.indexed(); t = this.r16(r); this.wop2(0, t >> 8); this.wop2(1, t); this.f16r(NZV, t); return;
        }
        case 0x8f: this.pull(RS, 0x80); return; // RTS
        case 0x9f: this.cyc += 1; this.cc = this.rd(this.s); this.s = (this.s + 1) & 0xffff; this.pull(RS, ((this.cc & CC_E) ? 0xff : 0x81) & ~1); return; // RTI
        case 0xa3: case 0xa4: case 0xa5: case 0xa6: case 0xa7: { // 16-bit indexed shifts
          this.indexed(); t = this.rd16op();
          switch (op) {
            case 0xa3: this.cc = (this.cc & ~CC_C) | (t & 1); t = this.f16r(NZ, t >> 1); break;
            case 0xa4: t = this.f16r(NZ, this.ror(t, 16)); break;
            case 0xa5: this.cc = (this.cc & ~CC_C) | (t & 1); t = this.f16r(NZ, ((t << 16) >> 16) >> 1); break;
            case 0xa6: t = this.f16(NZVC, t, t, t << 1); break;
            default: t = this.f16r(NZV, this.rol(t, 16)); break;
          }
          this.wr16op(t); return;
        }
        case 0xa8: this.indexed(); this.pc = this.ea; return;                               // JMP
        case 0xa9: this.indexed(); this.cyc += 2; this.gosub(); return;                     // JSR
        case 0xaa: t = this.arg(); this.ea = (this.pc + ((t << 24) >> 24)) & 0xffff; this.cyc += 2; this.gosub(); return; // BSR
        case 0xab: h = this.arg(); t = (h << 8) | this.arg(); this.ea = (this.pc + t) & 0xffff; this.cyc += 2; this.gosub(); return; // LBSR
        case 0xac: this.b = this.f8(NZV, this.b, 1, this.b - 1); this.cyc += 1; this.branch(this.cond(3)); return; // DBJNZ
        case 0xad: this.x = this.f16(NZV, this.x, 1, this.x - 1); this.cyc += 1; this.branch(this.cond(3)); return; // DXJNZ
        case 0xae: return;                                                                    // NOP
        case 0xb0: this.x = (this.x + this.b) & 0xffff; return;                              // ABX
        case 0xb1: { // DAA
          let cf = 0; const msn = this.a & 0xf0, lsn = this.a & 0x0f;
          if (lsn > 9 || (this.cc & CC_H)) cf |= 6; if (msn > 0x80 && lsn > 9) cf |= 0x60; if (msn > 0x90 || (this.cc & CC_C)) cf |= 0x60;
          t = this.a + cf; this.cc &= ~CC_V; if (t & 0x100) this.cc |= CC_C; this.a = this.f8r(NZ, t); return;
        }
        case 0xb2: this.d = this.f16r(NZ, (this.b << 24) >> 24); return;                    // SEX
        case 0xb3: t = this.a * this.b; this.d = this.f16r(CC_Z, t); this.cc = (this.d & 0x80) ? this.cc | CC_C : this.cc & ~CC_C; this.cyc += 9; return; // MUL
        case 0xb4: { // LMUL
          const r = this.x * this.y; this.x = (r >>> 16) & 0xffff; this.y = r & 0xffff;
          this.cc = (this.cc & ~CC_Z) | (r === 0 ? CC_Z : 0); this.cc = (r & 0x8000) ? this.cc | CC_C : this.cc & ~CC_C; this.cyc += 21; return;
        }
        case 0xb5: { // DIVX
          let q = 0, rem = 0; if (this.b) { q = Math.floor(this.x / this.b) & 0xffff; rem = this.x % this.b; }
          this.x = this.f16r(CC_Z, q); this.b = rem & 0xff; this.cc = (q & 0x80) ? this.cc | CC_C : this.cc & ~CC_C; this.cyc += 10; return;
        }
        case 0xb6: while (this.u) { t = this.rd(this.y); this.y = (this.y + 1) & 0xffff; this.wr(this.x, t); this.x = (this.x + 1) & 0xffff; this.u = (this.u - 1) & 0xffff; } return; // BMOVE
        case 0xb7: t = this.rd(this.y); this.y = (this.y + 1) & 0xffff; this.wr(this.x, t); this.x = (this.x + 1) & 0xffff; this.u = (this.u - 1) & 0xffff; return; // MOVE
        case 0xb8: case 0xba: case 0xbc: case 0xbe: case 0xc0: this.tempIm = this.arg(); this.am = AM_D; this.shiftDI([0, 1, 2, 3, 4][(op - 0xb8) >> 1]); return;
        case 0xb9: case 0xbb: case 0xbd: case 0xbf: case 0xc1: this.indexed(); this.shiftDI([0, 1, 2, 3, 4][(op - 0xb9) >> 1]); return;
        case 0xc2: case 0xc3: if (op & 1) this.indexed(); else this.am = AM_D; this.cc = (this.cc & ~NZVC) | CC_Z; this.wop2(0, 0); this.wop2(1, 0); return; // CLR16
        case 0xc4: case 0xc5: if (op & 1) this.indexed(); else this.am = AM_D; t = this.rd16op(); t = this.f16(NZVC, 0, t, -t); this.wr16op(t); return; // NEG16
        case 0xc6: case 0xc7: if (op & 1) this.indexed(); else this.am = AM_D; t = this.rd16op(); t = this.f16(NZVC, t, 1, t + 1); this.wr16op(t); return; // INC16
        case 0xc8: case 0xc9: if (op & 1) this.indexed(); else this.am = AM_D; t = this.rd16op(); t = this.f16(NZVC, t, 1, t - 1); this.wr16op(t); return; // DEC16
        case 0xca: case 0xcb: if (op & 1) this.indexed(); else this.am = AM_D; t = this.rd16op(); this.f16r(NZV, t); if (op & 1) this.cyc += 1; return; // TST16
        case 0xcc: case 0xcd: this.am = op & 1 ? AM_B : AM_A; t = this.rop(); t = this.f8(NZVC, 0, t, (t & 0x80) ? -t : t); this.wop(t); return; // ABS8
        case 0xce: this.am = AM_D; t = this.rd16op(); t = this.f16(NZVC, 0, t, (t & 0x8000) ? -t : t); this.wr16op(t); return; // ABS16
        case 0xcf: while (this.u) { this.cyc += 1; this.wr(this.x, this.a); this.x = (this.x + 1) & 0xffff; this.u = (this.u - 1) & 0xffff; } return; // BSET
        case 0xd0: while (this.u) { this.cyc += 1; this.wr(this.x, this.a); this.x = (this.x + 1) & 0xffff; this.wr(this.x, this.b); this.x = (this.x + 1) & 0xffff; this.u = (this.u - 1) & 0xffff; } return; // BSETW
        default: this.illegal++; return; // ILLEGAL (log_illegal only)
      }
    }
    // ---- state save / load (for rollback) ----
    save() { return [this.a, this.b, this.x, this.y, this.u, this.s, this.pc, this.dp, this.cc, +this.nmiLine, +this.nmiAsserted, +this.firqLine, +this.irqLine, +this.ldsEncountered, this.total]; }
    load(v) { [this.a, this.b, this.x, this.y, this.u, this.s, this.pc, this.dp, this.cc] = v; this.nmiLine = !!v[9]; this.nmiAsserted = !!v[10]; this.firqLine = !!v[11]; this.irqLine = !!v[12]; this.ldsEncountered = !!v[13]; this.total = v[14]; }
  }
  const api = { Konami, CC_C, CC_V, CC_Z, CC_N, CC_I, CC_H, CC_F, CC_E };
  if (typeof module !== 'undefined') module.exports = api; else G.KONAMICPU = api;
})(typeof window !== 'undefined' ? window : globalThis);
