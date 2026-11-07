// Z80 interpreter for the Sunset Riders sound board (Z80 @ 8 MHz). Integer-only, deterministic, snapshot-able.
// Cycle counts follow the documented Zilog timings (as MAME's z80 device); interrupts: NMI 11 T, IM1 13 T.
// Undocumented X/Y flags are emulated (incl. MEMPTR for BIT n,(HL)).
(function (G) {
'use strict';
const SZ = new Uint8Array(256), SZP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = i; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1;
  SZ[i] = (i & 0xa8) | (i ? 0 : 0x40);
  SZP[i] = SZ[i] | ((p & 1) ? 0 : 4);
}
const CF = 1, NF = 2, PF = 4, XF = 8, HF = 16, YF = 32, ZF = 64, SF = 128;

function Z80(rd, wr, inp, outp) {
  const self = this; this.tc = 0; // T-state offset of the current memory access inside the instruction
  rd = rd || (() => 0xff); wr = wr || (() => {});
  this.rd = a => { const v = rd(a); self.tc += 3; return v; };
  this.wr = (a, v) => { wr(a, v); self.tc += 3; }; this.inp = inp || (() => 0xff); this.outp = outp || (() => {});
  this.reset();
}
const P = Z80.prototype;
P.reset = function () {
  this.a = 0xff; this.f = 0xff; this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
  this.a2 = 0; this.f2 = 0; this.bc2 = 0; this.de2 = 0; this.hl2 = 0;
  this.ix = 0xffff; this.iy = 0xffff; this.sp = 0; this.pc = 0; this.i = 0; this.r = 0; this.r2 = 0;
  this.wz = 0; this.iff1 = 0; this.iff2 = 0; this.im = 0; this.halt = 0; this.eiDelay = 0;
  this.irq = 0; this.nmiPending = 0; this.cycles = 0;
};
P.save = function () {
  return [this.a, this.f, this.b, this.c, this.d, this.e, this.h, this.l, this.a2, this.f2, this.bc2, this.de2, this.hl2,
    this.ix, this.iy, this.sp, this.pc, this.i, this.r, this.r2, this.wz, this.iff1, this.iff2, this.im, this.halt,
    this.eiDelay, this.irq, this.nmiPending, this.cycles];
};
P.load = function (s) {
  [this.a, this.f, this.b, this.c, this.d, this.e, this.h, this.l, this.a2, this.f2, this.bc2, this.de2, this.hl2,
    this.ix, this.iy, this.sp, this.pc, this.i, this.r, this.r2, this.wz, this.iff1, this.iff2, this.im, this.halt,
    this.eiDelay, this.irq, this.nmiPending, this.cycles] = s;
};
P.af = function () { return (this.a << 8) | this.f; };
P.bc = function () { return (this.b << 8) | this.c; };
P.de = function () { return (this.d << 8) | this.e; };
P.hl = function () { return (this.h << 8) | this.l; };
P.rR = function () { return (this.r & 0x7f) | (this.r2 & 0x80); };

P.fetch = function () { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; };
P.fetch16 = function () { const l = this.fetch(); return l | (this.fetch() << 8); };
P.rd16 = function (a) { return this.rd(a) | (this.rd((a + 1) & 0xffff) << 8); };
P.wr16 = function (a, v) { this.wr(a, v & 0xff); this.wr((a + 1) & 0xffff, v >> 8); };
P.push = function (v) { this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v & 0xff); };
P.pop = function () { const v = this.rd16(this.sp); this.sp = (this.sp + 2) & 0xffff; return v; };

// register access by index 0..7 (6 = (HL) handled by caller); xy: 0=HL,1=IX,2=IY for H/L substitution
P.getr = function (i) {
  switch (i) { case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
    case 4: return this.h; case 5: return this.l; case 7: return this.a; }
  return 0;
};
P.setr = function (i, v) {
  switch (i) { case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
    case 4: this.h = v; break; case 5: this.l = v; break; case 7: this.a = v; break; }
};
P.getrx = function (i, xy) {
  if (xy && (i === 4 || i === 5)) { const v = xy === 1 ? this.ix : this.iy; return i === 4 ? v >> 8 : v & 0xff; }
  return this.getr(i);
};
P.setrx = function (i, v, xy) {
  if (xy && (i === 4 || i === 5)) {
    if (xy === 1) this.ix = i === 4 ? (this.ix & 0xff) | (v << 8) : (this.ix & 0xff00) | v;
    else this.iy = i === 4 ? (this.iy & 0xff) | (v << 8) : (this.iy & 0xff00) | v;
    return;
  }
  this.setr(i, v);
};
P.getrp = function (p, xy) { // BC DE HL SP
  switch (p) { case 0: return this.bc(); case 1: return this.de(); case 2: return xy === 1 ? this.ix : xy === 2 ? this.iy : this.hl(); }
  return this.sp;
};
P.setrp = function (p, v, xy) {
  switch (p) {
    case 0: this.b = v >> 8; this.c = v & 0xff; break; case 1: this.d = v >> 8; this.e = v & 0xff; break;
    case 2: if (xy === 1) this.ix = v; else if (xy === 2) this.iy = v; else { this.h = v >> 8; this.l = v & 0xff; } break;
    default: this.sp = v;
  }
};
P.getrp2 = function (p, xy) { return p === 3 ? this.af() : this.getrp(p, xy); };
P.setrp2 = function (p, v, xy) { if (p === 3) { this.a = v >> 8; this.f = v & 0xff; } else this.setrp(p, v, xy); };
P.cond = function (y) {
  const f = this.f;
  switch (y) { case 0: return !(f & ZF); case 1: return f & ZF; case 2: return !(f & CF); case 3: return f & CF;
    case 4: return !(f & PF); case 5: return f & PF; case 6: return !(f & SF); }
  return f & SF;
};

// ALU
P.add8 = function (v, c) {
  const a = this.a, r = a + v + c;
  this.f = (SZ[r & 0xff]) | ((r >> 8) & CF) | ((a ^ v ^ r) & HF) | ((((a ^ ~v) & (a ^ r)) >> 5) & PF);
  this.a = r & 0xff;
};
P.sub8 = function (v, c, store) {
  const a = this.a, r = a - v - c;
  this.f = (SZ[r & 0xff]) | ((r >> 8) & CF) | NF | ((a ^ v ^ r) & HF) | ((((a ^ v) & (a ^ r)) >> 5) & PF);
  if (store) this.a = r & 0xff;
  else this.f = (this.f & ~(XF | YF)) | (v & (XF | YF));
};
P.alu = function (op, v) {
  switch (op) {
    case 0: this.add8(v, 0); break; case 1: this.add8(v, this.f & CF); break;
    case 2: this.sub8(v, 0, 1); break; case 3: this.sub8(v, this.f & CF, 1); break;
    case 4: this.a &= v; this.f = SZP[this.a] | HF; break;
    case 5: this.a ^= v; this.f = SZP[this.a]; break;
    case 6: this.a |= v; this.f = SZP[this.a]; break;
    default: this.sub8(v, 0, 0);
  }
};
P.inc8 = function (v) { const r = (v + 1) & 0xff; this.f = (this.f & CF) | SZ[r] | (r === 0x80 ? PF : 0) | ((r & 0xf) ? 0 : HF); return r; };
P.dec8 = function (v) { const r = (v - 1) & 0xff; this.f = (this.f & CF) | SZ[r] | NF | (r === 0x7f ? PF : 0) | ((v & 0xf) ? 0 : HF); return r; };
P.add16 = function (a, b) {
  const r = a + b; this.wz = (a + 1) & 0xffff;
  this.f = (this.f & (SF | ZF | PF)) | ((r >> 16) & CF) | (((a ^ b ^ r) >> 8) & HF) | ((r >> 8) & (XF | YF));
  return r & 0xffff;
};
P.adc16 = function (b) {
  const a = this.hl(), r = a + b + (this.f & CF); this.wz = (a + 1) & 0xffff;
  this.f = ((r >> 8) & (SF | XF | YF)) | ((r & 0xffff) ? 0 : ZF) | ((r >> 16) & CF) | (((a ^ b ^ r) >> 8) & HF) |
    ((((a ^ ~b) & (a ^ r)) >> 13) & PF);
  this.h = (r >> 8) & 0xff; this.l = r & 0xff;
};
P.sbc16 = function (b) {
  const a = this.hl(), r = a - b - (this.f & CF); this.wz = (a + 1) & 0xffff;
  this.f = ((r >> 8) & (SF | XF | YF)) | ((r & 0xffff) ? 0 : ZF) | ((r >> 16) & CF) | NF | (((a ^ b ^ r) >> 8) & HF) |
    ((((a ^ b) & (a ^ r)) >> 13) & PF);
  this.h = (r >> 8) & 0xff; this.l = r & 0xff;
};
P.rot = function (y, v) { // CB rotates/shifts
  let r, c;
  switch (y) {
    case 0: c = v >> 7; r = ((v << 1) | c) & 0xff; break;
    case 1: c = v & 1; r = (v >> 1) | (c << 7); break;
    case 2: c = v >> 7; r = ((v << 1) | (this.f & CF)) & 0xff; break;
    case 3: c = v & 1; r = (v >> 1) | ((this.f & CF) << 7); break;
    case 4: c = v >> 7; r = (v << 1) & 0xff; break;
    case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;
    case 6: c = v >> 7; r = ((v << 1) | 1) & 0xff; break;
    default: c = v & 1; r = v >> 1;
  }
  this.f = SZP[r] | c;
  return r;
};

P.takeNmi = function () {
  this.nmiPending = 0;
  if (this.halt) { this.halt = 0; this.pc = (this.pc + 1) & 0xffff; }
  this.r = (this.r + 1) & 0x7f | 0;
  this.iff1 = 0; this.push(this.pc); this.pc = 0x66; this.wz = 0x66;
  return 11;
};
P.takeIrq = function () {
  if (this.halt) { this.halt = 0; this.pc = (this.pc + 1) & 0xffff; }
  this.r = (this.r + 1) & 0x7f;
  this.iff1 = this.iff2 = 0;
  if (this.ackIrq) this.ackIrq();
  if (this.im === 2) { const vec = 0xff; this.push(this.pc); this.pc = this.rd16(((this.i << 8) | vec) & 0xffff); this.wz = this.pc; return 19; }
  this.push(this.pc); this.pc = 0x38; this.wz = 0x38;
  return 13; // IM1 (IM0 with RST 38h on the bus is the same)
};

// execute one instruction (or interrupt acceptance); returns T-states
P.step = function () {
  let t; this.tc = 0;
  if (this.nmiPending) t = this.takeNmi();
  else if (this.irq && this.iff1 && !this.eiDelay) t = this.takeIrq();
  else { this.eiDelay = 0; t = this.exec(); }
  this.cycles += t;
  return t;
};

P.exec = function () {
  if (this.halt) { this.r = (this.r + 1) & 0x7f; return 4; }
  let op = this.fetch(); this.tc++; this.r = (this.r + 1) & 0x7f;
  let xy = 0, t = 0;
  while (op === 0xdd || op === 0xfd) { xy = op === 0xdd ? 1 : 2; t += 4; op = this.fetch(); this.tc++; this.r = (this.r + 1) & 0x7f; }
  if (op === 0xcb) return t + (xy ? this.execXYCB(xy) : this.execCB());
  if (op === 0xed) { this.r = (this.r + 1) & 0x7f; const o2 = this.fetch(); this.tc++; return t + this.execED(o2); }
  return t + this.execMain(op, xy);
};

P.ixd = function (xy) { // address (IX+d)
  const d = this.fetch(); this.tc += 5; const a = ((xy === 1 ? this.ix : this.iy) + ((d << 24) >> 24)) & 0xffff; this.wz = a; return a;
};

P.execMain = function (op, xy) {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  let v, a, n;
  switch (x) {
    case 0:
      switch (z) {
        case 0:
          switch (y) {
            case 0: return 4;
            case 1: { const ta = this.a, tf = this.f; this.a = this.a2; this.f = this.f2; this.a2 = ta; this.f2 = tf; return 4; }
            case 2: n = this.fetch(); this.b = (this.b - 1) & 0xff;
              if (this.b) { this.pc = (this.pc + ((n << 24) >> 24)) & 0xffff; this.wz = this.pc; return 13; } return 8;
            case 3: n = this.fetch(); this.pc = (this.pc + ((n << 24) >> 24)) & 0xffff; this.wz = this.pc; return 12;
            default: n = this.fetch();
              if (this.cond(y - 4)) { this.pc = (this.pc + ((n << 24) >> 24)) & 0xffff; this.wz = this.pc; return 12; } return 7;
          }
        case 1:
          if (!q) { this.setrp(p, this.fetch16(), xy); return xy ? 10 : 10; }
          this.setrp(2, this.add16(this.getrp(2, xy), this.getrp(p, xy)), xy); return 11;
        case 2:
          switch (((y & 1) << 2) | (y >> 1)) {
            case 0: this.wr(this.bc(), this.a); this.wz = ((this.bc() + 1) & 0xff) | (this.a << 8); return 7;
            case 1: this.wr(this.de(), this.a); this.wz = ((this.de() + 1) & 0xff) | (this.a << 8); return 7;
            case 2: a = this.fetch16(); this.wr16(a, this.getrp(2, xy)); this.wz = (a + 1) & 0xffff; return 16;
            case 3: a = this.fetch16(); this.wr(a, this.a); this.wz = ((a + 1) & 0xff) | (this.a << 8); return 13;
            case 4: a = this.bc(); this.a = this.rd(a); this.wz = (a + 1) & 0xffff; return 7;
            case 5: a = this.de(); this.a = this.rd(a); this.wz = (a + 1) & 0xffff; return 7;
            case 6: a = this.fetch16(); this.setrp(2, this.rd16(a), xy); this.wz = (a + 1) & 0xffff; return 16;
            default: a = this.fetch16(); this.a = this.rd(a); this.wz = (a + 1) & 0xffff; return 13;
          }
        case 3:
          this.setrp(p, (this.getrp(p, xy) + (q ? -1 : 1)) & 0xffff, xy); return 6;
        case 4: case 5:
          if (y === 6) {
            a = xy ? this.ixd(xy) : this.hl();
            v = this.rd(a); this.wr(a, z === 4 ? this.inc8(v) : this.dec8(v)); return xy ? 19 : 11;
          }
          v = this.getrx(y, xy); this.setrx(y, z === 4 ? this.inc8(v) : this.dec8(v), xy); return 4;
        case 6:
          if (y === 6) { a = xy ? this.ixd(xy) : this.hl(); n = this.fetch(); if (xy) this.tc -= 3; this.wr(a, n); return xy ? 15 : 10; }
          this.setrx(y, this.fetch(), xy); return 7;
        default:
          switch (y) {
            case 0: { const c = this.a >> 7; this.a = ((this.a << 1) | c) & 0xff; this.f = (this.f & (SF | ZF | PF)) | (this.a & (XF | YF)) | c; return 4; }
            case 1: { const c = this.a & 1; this.a = (this.a >> 1) | (c << 7); this.f = (this.f & (SF | ZF | PF)) | (this.a & (XF | YF)) | c; return 4; }
            case 2: { const c = this.a >> 7; this.a = ((this.a << 1) | (this.f & CF)) & 0xff; this.f = (this.f & (SF | ZF | PF)) | (this.a & (XF | YF)) | c; return 4; }
            case 3: { const c = this.a & 1; this.a = (this.a >> 1) | ((this.f & CF) << 7); this.f = (this.f & (SF | ZF | PF)) | (this.a & (XF | YF)) | c; return 4; }
            case 4: { // DAA
              let a0 = this.a, corr = 0, c = this.f & CF;
              if ((this.f & HF) || (a0 & 0xf) > 9) corr |= 6;
              if (c || a0 > 0x99) { corr |= 0x60; c = 1; }
              let r, h;
              if (this.f & NF) { r = (a0 - corr) & 0xff; h = (this.f & HF) && (a0 & 0xf) < 6 ? HF : 0; }
              else { r = (a0 + corr) & 0xff; h = (a0 & 0xf) > 9 ? HF : 0; }
              this.f = SZP[r] | (this.f & NF) | h | c; this.a = r; return 4;
            }
            case 5: this.a ^= 0xff; this.f = (this.f & (SF | ZF | PF | CF)) | HF | NF | (this.a & (XF | YF)); return 4;
            case 6: this.f = (this.f & (SF | ZF | PF)) | CF | (this.a & (XF | YF)); return 4;
            default: this.f = ((this.f & (SF | ZF | PF | CF)) | ((this.f & CF) << 4) | (this.a & (XF | YF))) ^ CF; return 4;
          }
      }
    case 1:
      if (op === 0x76) { this.halt = 1; this.pc = (this.pc - 1) & 0xffff; return 4; }
      if (y === 6) { a = xy ? this.ixd(xy) : this.hl(); this.wr(a, this.getr(z)); return xy ? 15 : 7; }
      if (z === 6) { a = xy ? this.ixd(xy) : this.hl(); this.setr(y, this.rd(a)); return xy ? 15 : 7; }
      this.setrx(y, this.getrx(z, xy), xy); return 4;
    case 2:
      if (z === 6) { a = xy ? this.ixd(xy) : this.hl(); this.alu(y, this.rd(a)); return xy ? 15 : 7; }
      this.alu(y, this.getrx(z, xy)); return 4;
    default:
      switch (z) {
        case 0: if (this.cond(y)) { this.pc = this.pop(); this.wz = this.pc; return 11; } return 5;
        case 1:
          if (!q) { this.setrp2(p, this.pop(), xy); return 10; }
          switch (p) {
            case 0: this.pc = this.pop(); this.wz = this.pc; return 10;
            case 1: { let t1 = this.bc(); this.setrp(0, this.bc2); this.bc2 = t1; t1 = this.de(); this.setrp(1, this.de2); this.de2 = t1;
              t1 = this.hl(); this.h = this.hl2 >> 8; this.l = this.hl2 & 0xff; this.hl2 = t1; return 4; }
            case 2: this.pc = this.getrp(2, xy); return 4;
            default: this.sp = this.getrp(2, xy); return 6;
          }
        case 2: a = this.fetch16(); this.wz = a; if (this.cond(y)) this.pc = a; return 10;
        case 3:
          switch (y) {
            case 0: this.pc = this.fetch16(); this.wz = this.pc; return 10;
            case 2: n = this.fetch(); this.outp((this.a << 8) | n, this.a); this.wz = ((n + 1) & 0xff) | (this.a << 8); return 11;
            case 3: n = this.fetch(); this.wz = (((this.a << 8) | n) + 1) & 0xffff; this.a = this.inp((this.a << 8) | n); return 11;
            case 4: { v = this.rd16(this.sp); this.wr16(this.sp, this.getrp(2, xy)); this.setrp(2, v, xy); this.wz = v; return 19; }
            case 5: { const td = this.d, te = this.e; this.d = this.h; this.e = this.l; this.h = td; this.l = te; return 4; }
            case 6: this.iff1 = this.iff2 = 0; return 4;
            default: this.iff1 = this.iff2 = 1; this.eiDelay = 1; return 4;
          }
        case 4: a = this.fetch16(); this.wz = a; if (this.cond(y)) { this.push(this.pc); this.pc = a; return 17; } return 10;
        case 5:
          if (!q) { this.push(this.getrp2(p, xy)); return 11; }
          a = this.fetch16(); this.wz = a; this.push(this.pc); this.pc = a; return 17; // only p=0 reaches here
        case 6: this.alu(y, this.fetch()); return 7;
        default: this.push(this.pc); this.pc = y << 3; this.wz = this.pc; return 11;
      }
  }
};

P.execCB = function () {
  const op = this.fetch(); this.tc++; this.r = (this.r + 1) & 0x7f;
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
  const mem = z === 6, a = this.hl();
  const v = mem ? this.rd(a) : this.getr(z);
  if (x === 1) {
    const r = v & (1 << y);
    this.f = (this.f & CF) | HF | (r ? (r & SF) : (ZF | PF)) | ((mem ? this.wz >> 8 : v) & (XF | YF));
    return mem ? 12 : 8;
  }
  const r = x === 0 ? this.rot(y, v) : x === 2 ? v & ~(1 << y) : v | (1 << y);
  if (mem) { this.wr(a, r); return 15; }
  this.setr(z, r); return 8;
};
P.execXYCB = function (xy) {
  const a = this.ixd(xy); const op = this.fetch(); this.tc -= 3;
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
  const v = this.rd(a);
  if (x === 1) {
    const r = v & (1 << y);
    this.f = (this.f & CF) | HF | (r ? (r & SF) : (ZF | PF)) | ((a >> 8) & (XF | YF));
    return 16; // + 4 prefix = 20
  }
  const r = x === 0 ? this.rot(y, v) : x === 2 ? v & ~(1 << y) : v | (1 << y);
  this.wr(a, r);
  if (z !== 6) this.setr(z, r);
  return 19; // + 4 = 23
};

P.execED = function (op) {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  let a, v;
  if (x === 1) {
    switch (z) {
      case 0: a = this.bc(); v = this.inp(a); this.wz = (a + 1) & 0xffff; if (y !== 6) this.setr(y, v); this.f = (this.f & CF) | SZP[v]; return 12;
      case 1: a = this.bc(); this.outp(a, y === 6 ? 0 : this.getr(y)); this.wz = (a + 1) & 0xffff; return 12;
      case 2: if (q) this.adc16(this.getrp(p, 0)); else this.sbc16(this.getrp(p, 0)); return 15;
      case 3: a = this.fetch16(); this.wz = (a + 1) & 0xffff;
        if (q) this.setrp(p, this.rd16(a), 0); else this.wr16(a, this.getrp(p, 0)); return 20;
      case 4: { const a0 = this.a; this.a = 0; this.sub8(a0, 0, 1); return 8; }
      case 5: this.iff1 = this.iff2; this.pc = this.pop(); this.wz = this.pc; return 14;
      case 6: this.im = [0, 0, 1, 2][y & 3]; return 8;
      default:
        switch (y) {
          case 0: this.i = this.a; return 9;
          case 1: this.r = this.a & 0x7f; this.r2 = this.a & 0x80; return 9;
          case 2: this.a = this.i; this.f = (this.f & CF) | SZ[this.a] | (this.iff2 ? PF : 0); return 9;
          case 3: this.a = this.rR(); this.f = (this.f & CF) | SZ[this.a] | (this.iff2 ? PF : 0); return 9;
          case 4: { a = this.hl(); const m = this.rd(a); this.wr(a, ((this.a << 4) | (m >> 4)) & 0xff); this.a = (this.a & 0xf0) | (m & 0xf);
            this.f = (this.f & CF) | SZP[this.a]; this.wz = (a + 1) & 0xffff; return 18; } // RRD
          case 5: { a = this.hl(); const m = this.rd(a); this.wr(a, ((m << 4) | (this.a & 0xf)) & 0xff); this.a = (this.a & 0xf0) | (m >> 4);
            this.f = (this.f & CF) | SZP[this.a]; this.wz = (a + 1) & 0xffff; return 18; } // RLD
          default: return 8;
        }
    }
  }
  if (x === 2 && z <= 3 && y >= 4) {
    const inc = (y & 1) ? -1 : 1, rep = y >= 6;
    if (z === 0) { // LDI/LDD
      v = this.rd(this.hl()); this.wr(this.de(), v);
      this.setrp(2, (this.hl() + inc) & 0xffff, 0); this.setrp(1, (this.de() + inc) & 0xffff, 0);
      const bc = (this.bc() - 1) & 0xffff; this.setrp(0, bc, 0);
      const n = (v + this.a) & 0xff;
      this.f = (this.f & (SF | ZF | CF)) | (bc ? PF : 0) | (n & XF) | ((n << 4) & YF);
      if (rep && bc) { this.pc = (this.pc - 2) & 0xffff; this.wz = (this.pc + 1) & 0xffff; return 21; }
      return 16;
    }
    if (z === 1) { // CPI/CPD
      v = this.rd(this.hl()); const r = (this.a - v) & 0xff; const h = (this.a ^ v ^ r) & HF;
      this.setrp(2, (this.hl() + inc) & 0xffff, 0); this.wz = (this.wz + inc) & 0xffff;
      const bc = (this.bc() - 1) & 0xffff; this.setrp(0, bc, 0);
      const n = (r - (h ? 1 : 0)) & 0xff;
      this.f = (this.f & CF) | NF | (SZ[r] & (SF | ZF)) | h | (bc ? PF : 0) | (n & XF) | ((n << 4) & YF);
      if (rep && bc && r) { this.pc = (this.pc - 2) & 0xffff; this.wz = (this.pc + 1) & 0xffff; return 21; }
      return 16;
    }
    if (z === 2) { // INI/IND
      v = this.inp(this.bc()); this.wz = (this.bc() + inc) & 0xffff; this.wr(this.hl(), v);
      this.b = (this.b - 1) & 0xff; this.setrp(2, (this.hl() + inc) & 0xffff, 0);
      const k = v + ((this.c + inc) & 0xff);
      this.f = SZ[this.b] | ((v >> 6) & NF) | (k > 255 ? HF | CF : 0) | (SZP[(k & 7) ^ this.b] & PF);
      if (rep && this.b) { this.pc = (this.pc - 2) & 0xffff; return 21; }
      return 16;
    }
    // OUTI/OUTD
    v = this.rd(this.hl()); this.b = (this.b - 1) & 0xff; this.wz = (this.bc() + inc) & 0xffff; this.outp(this.bc(), v);
    this.setrp(2, (this.hl() + inc) & 0xffff, 0);
    const k = v + this.l;
    this.f = SZ[this.b] | ((v >> 6) & NF) | (k > 255 ? HF | CF : 0) | (SZP[(k & 7) ^ this.b] & PF);
    if (rep && this.b) { this.pc = (this.pc - 2) & 0xffff; return 21; }
    return 16;
  }
  return 8;
};

G.Z80 = Z80;
if (typeof module !== 'undefined') module.exports = Z80;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
