// Power-on run of web/sim/ssr.js (the original 68000 program on emulated hardware) checked against the MAME attract
// recording (ref/attract: video state, work RAM, spriteram per frame). Usage: node test/machine_check.js [END] [--ram] [--spr]
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const HW = require(R('web/sim/hw.js')), { Machine } = require(R('web/sim/ssr.js'));
const A = n => fs.readFileSync(R('assets_extracted/' + n));
const fds = fs.openSync(R('ref/attract/state.bin'), 'r'), fdw = fs.openSync(R('ref/attract/wram.bin'), 'r');
const fdp = fs.existsSync(R('ref/attract/spr.bin')) ? fs.openSync(R('ref/attract/spr.bin'), 'r') : null;
const nrec = fs.fstatSync(fds).size / HW.REC;
const rd = (fd, n, f) => { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, (f - 1) * n); return new Uint8Array(b); };
function cmp(a, b, name, base, out) { let n = 0, first = -1; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { n++; if (first < 0) first = i; }
  if (n) out.push(`${name}:${n}@0x${(first + (base || 0)).toString(16)} (${a[first]?.toString(16)}/${b[first]?.toString(16)})`); }
function check(m, f, opt) {
  const r = HW.fromRecord(rd(fds, HW.REC, f), 0), out = [];
  for (const [k] of HW.FIELDS) cmp(m.v[k], r[k], k, 0, out);
  if (opt.ram) cmp(m.wram, rd(fdw, 0x4000, f), 'wram', 0x104000, out);
  if (opt.spr && fdp) cmp(m.sprBytes(), rd(fdp, 0x4000, f), 'spr', 0x180000, out);
  return out;
}
module.exports = { check, A, Machine, nrec };
if (require.main === module) {
  const E = Math.min(+(process.argv[2] || nrec), nrec), opt = { ram: process.argv.includes('--ram'), spr: process.argv.includes('--spr') };
  const all = process.argv.includes('--all');
  const SH = +(process.env.SH ?? -1); // recorded frame f-1 = state after step f (default)
  const m = new Machine(A('prog.bin'), A('eeprom.bin'), A('gfx_tiles.bin'), A('gfx_sprites.bin'));
  if (process.env.SND !== '0') m.attachSound(A('z80.bin'), A('k053260.bin'));
  m.powerOn(); let ok = 0, bad = 0, firstBad = 0; const t0 = process.hrtime.bigint();
  for (let f = 1; f <= E; f++) {
    if (f > 1) m.step();
    if (m.unmapped && !/60b800/.test(m.unmapped)) { console.log('UNMAPPED', m.unmapped, 'frame', f); } m.unmapped = null;
    const d = f + SH < 1 ? [] : check(m, f + SH, opt);
    if (d.length) { bad++; if (!firstBad) firstBad = f; if (all || bad <= 5) console.log('frame', f, d.join(' ')); } else ok++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${ok}/${E} frames byte-exact${firstBad ? ', first divergence ' + firstBad : ''}; ${(ms / E).toFixed(3)} ms/frame (node, interpreter)`);
}
