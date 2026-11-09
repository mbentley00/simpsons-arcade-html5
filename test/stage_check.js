// ROM-free regression checks for patch input, the boot self-test, and online isolation.
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const S = require('../web/stage/stagedata.js');
const source = fs.readFileSync(require.resolve('../web/stage/mods.js'), 'utf8');
function setup(search = '', bytes = { 12: 42 }) {
  const original = new Uint8Array(0x80000), m = { prog: original, ram: new Uint8Array(0x2000), mw(a, v) { this.ram[a - 0x4000] = v; } };
  const G = { SIMPSTAGE: S, location: { search }, URLSearchParams,
    localStorage: { getItem: () => bytes === null ? null : JSON.stringify({ v: 1, bytes }) },
    document: { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } }, setTimeout() {} };
  G.window = G; vm.runInNewContext(source, G);
  G.SIMPMODS.apply({ 'prog.bin': original }); G.SIMPMODS.install(m);
  return { mods: G.SIMPMODS, m, original };
}
const p = new Uint8Array(16);
const invalid = Object.assign(Object.create({ 3: 99 }), { 1: 7, '-1': 1, '16': 1, '1.5': 1, '02': 2, '4': '8', '5': null, '6': 3.5 });
const r = S.applyPatch(p, invalid);
assert.equal(r.n, 1); assert.equal(r.prog[1], 7); assert.equal(p[1], 0);
assert.equal(S.applyPatch(p, [1, 2]).n, 0);
assert.equal(S.applyPatch(p, null).n, 0);
let { mods, m, original } = setup();
assert.throws(() => mods.assertOnline(), /mods=0/);
for (const v of [255, 170, 85, 0]) m.mw(0x4802, v);
assert.equal(m.prog[12], 0, 'RAM test must leave the ROM unchanged');
m.mw(0x4802, 1);
assert.equal(m.prog[12], 42, 'apply after the boot checks');
assert.equal(original[12], 0, 'keep the loader copy unchanged');
assert.equal(mods.active, 1);
assert.throws(() => mods.assertOnline(), /mods=0/);
for (const search of ['?mods=0&scene=4', '?sala=ABCD&scene=4']) {
  const t = setup(search); t.m.mw(0x4802, 1); t.m.ram[0x803] = 1; t.m.mw(0x4803, 2);
  assert.equal(t.m.prog[12], 0); assert.equal(t.m.ram[0x803], 2); t.mods.assertOnline();
}
const t = setup('?scene=4', null);
assert.throws(() => t.mods.assertOnline(), /mods=0/);
t.m.ram[0x800] = 1; t.m.ram[0x803] = 1; t.m.mw(0x4803, 2); assert.equal(t.m.ram[0x803], 2, 'attract mode must not consume the selection');
t.m.ram[0x800] = 2; t.m.ram[0x803] = 1; t.m.mw(0x4803, 2); assert.equal(t.m.ram[0x803], 4);
t.m.ram[0x803] = 1; t.m.mw(0x4803, 2); assert.equal(t.m.ram[0x803], 2, 'warp only once');
setup('', null).mods.assertOnline();
console.log('OK: patch validation, boot timing, original ROM isolation, scene selection, and online guards');
