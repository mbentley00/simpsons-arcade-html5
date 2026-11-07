// Lockstep check of web/sim/ssr.js (68000 core + hardware) against a MAME register trace (run/trace_regs.lua).
// Usage: node test/lockstep.js [/tmp/regs.log] [maxErrors]
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const { Machine } = require(R('web/sim/ssr.js'));
const A = n => fs.readFileSync(R('assets_extracted/' + n));
const m = new Machine(A('prog.bin'), A('eeprom.bin'), A('gfx_tiles.bin'), A('gfx_sprites.bin'));
const file = process.argv[2] || '/tmp/regs.log', maxErr = +(process.argv[3] || 1);
if (process.env.Z80) m.z80ReplyCycle = +process.env.Z80;
const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(1 << 22); let carry = '', eof = false, lines = [], li = 0;
function nextLine() {
  while (li >= lines.length) { if (eof) return null; const n = fs.readSync(fd, buf, 0, buf.length); if (!n) { eof = true; if (carry) { lines = [carry]; carry = ''; li = 0; continue; } return null; }
    const t = (carry + buf.toString('latin1', 0, n)).split('\n'); carry = t.pop(); lines = t; li = 0; }
  return lines[li++];
}
function nextRec() {
  let l; while ((l = nextLine()) !== null && !/^\d+ /.test(l));
  if (l === null) return null; const d = nextLine() || '';
  const v = l.trim().split(' '); return { cyc: +v[0], pc: parseInt(d.slice(0, 6), 16), r: v.slice(2, 18).map(x => parseInt(x, 16) >>> 0), sr: parseInt(v[18], 16), dis: d, line: l };
}
const cpu = m.cpu, CR = cpu.R; let n = 0, errs = 0, prevDis = '', hist = [];
const sr = () => cpu.X.getSR();
cpu.pre = pc => {
  const t = nextRec(); if (!t) { console.log('trace end after', n, 'instructions'); process.exit(errs ? 1 : 0); }
  const now = m.now(); const bad = [];
  if (t.pc !== (pc >>> 0)) bad.push(`pc ${(pc >>> 0).toString(16)}/${t.pc.toString(16)}`);
  const dc = (now - t.cyc) | 0; if (dc) bad.push(`cyc ${now}/${t.cyc} (d${dc})`);
  const user = !(CR[17] & 0x2000), ri = i => (user && i === 15 ? 23 : i); // MAME's sp column is always the SSP
  for (let i = 0; i < 16; i++) if ((CR[ri(i)] >>> 0) !== t.r[i]) bad.push(`${i < 8 ? 'd' + i : 'a' + (i - 8)} ${(CR[ri(i)] >>> 0).toString(16)}/${t.r[i].toString(16)}`);
  if (sr() !== t.sr) bad.push(`sr ${sr().toString(16)}/${t.sr.toString(16)}`);
  if (bad.length) { console.log(`#${n} frame ${m.frame()} at ${t.dis}\n  after: ${prevDis}\n  ${bad.join(' ')}`); console.log('  recent:', hist.slice(-6).join(' | '));
    if (++errs >= maxErr) process.exit(1);
    // resync to MAME's state
    for (let i = 0; i < 16; i++) CR[ri(i)] = t.r[i] | 0; cpu.X.setSR(t.sr); CR[24] += dc; }
  prevDis = t.dis; hist.push(t.dis.slice(0, 40)); if (hist.length > 12) hist.shift(); n++;
};
m.powerOn();
for (let f = 0; f < 100000; f++) { m.step(); if (m.unmapped) { console.log('UNMAPPED', m.unmapped); m.unmapped = null; } }
