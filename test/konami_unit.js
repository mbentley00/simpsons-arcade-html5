// Unit checks for web/sim/konami.js (the full instruction-level proof is test/konami_lockstep.js vs MAME).
'use strict';
const assert = require('assert');
const { Konami } = require('../web/sim/konami.js');
function mk() {
  const mem = new Uint8Array(0x10000);
  const set = (a, v) => { mem[a] = v >> 8; mem[a + 1] = v & 0xff; };
  set(0xfffe, 0x8000); set(0xfffc, 0x9000); set(0xfff6, 0xa000); set(0xfff8, 0xb000);
  const lines = [];
  const cpu = new Konami({ read: a => mem[a], write: (a, v) => { mem[a] = v; }, setLines: v => lines.push(v) });
  return { cpu, mem, lines };
}
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
t('reset vector + 4 cycles + I/F masked', () => {
  const { cpu } = mk(); assert.strictEqual(cpu.reset(), 4); assert.strictEqual(cpu.pc, 0x8000); assert.strictEqual(cpu.cc & 0x50, 0x50);
});
t('IRQ entry: 19 cycles, full frame (12 bytes), E set, I set, F untouched', () => {
  const { cpu, mem } = mk(); cpu.reset(); cpu.s = 0x5000; cpu.cc = 0; cpu.a = 0x12; cpu.b = 0x34; cpu.irqLine = true;
  assert.strictEqual(cpu.step(), 19); assert.strictEqual(cpu.pc, 0xb000); assert.strictEqual(cpu.s, 0x5000 - 12);
  assert.strictEqual(mem[cpu.s] & 0x80, 0x80); assert.strictEqual(mem[cpu.s + 1], 0x12); assert.strictEqual(mem[cpu.s + 2], 0x34);
  assert.strictEqual(cpu.cc & 0x10, 0x10); assert.strictEqual(cpu.cc & 0x40, 0);
});
t('IRQ masked by I', () => { const { cpu } = mk(); cpu.reset(); cpu.irqLine = true; cpu.step(); assert.notStrictEqual(cpu.pc, 0xb000); });
t('FIRQ entry: 10 cycles, CC+PC only, E clear, I+F set', () => {
  const { cpu } = mk(); cpu.reset(); cpu.s = 0x5000; cpu.cc = 0x80; cpu.firqLine = true;
  assert.strictEqual(cpu.step(), 10); assert.strictEqual(cpu.pc, 0xa000); assert.strictEqual(cpu.s, 0x5000 - 3);
  assert.strictEqual(cpu.cc & 0xd0, 0x50);
});
t('NMI needs LDS first, then 19 cycles to 0x9000', () => {
  const { cpu } = mk(); cpu.reset(); cpu.s = 0x5000; cpu.setNMI(1); assert.strictEqual(cpu.nmiAsserted, false);
  cpu.setNMI(0); cpu.ldsEncountered = true; cpu.setNMI(1); assert.strictEqual(cpu.step(), 19); assert.strictEqual(cpu.pc, 0x9000);
});
t('NMI has priority over FIRQ/IRQ', () => {
  const { cpu } = mk(); cpu.reset(); cpu.s = 0x5000; cpu.cc = 0; cpu.ldsEncountered = true; cpu.irqLine = cpu.firqLine = true; cpu.setNMI(1);
  cpu.step(); assert.strictEqual(cpu.pc, 0x9000);
});
t('save/load round trip', () => {
  const { cpu } = mk(); cpu.reset(); Object.assign(cpu, { a: 1, b: 2, x: 3, y: 4, u: 5, s: 6, dp: 7, cc: 8 });
  const s = cpu.save(); const c2 = mk().cpu; c2.load(s); assert.deepStrictEqual(c2.save(), s);
});
console.log(`konami_unit: ${n} passed`);
