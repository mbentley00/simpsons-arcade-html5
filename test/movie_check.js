// Replay a MAME input movie in web/sim/ssr.js and check it frame-exact against the MAME recording made with
// run/record_attract.lua + SSR_MOVIE (dir has state.bin, wram.bin, spr.bin, ports.bin).
// Usage: node test/movie_check.js [DIR=ref/movie] [END] [--spr] ; env IO = input offset (default below)
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const HW = require(R('web/sim/hw.js')), { Machine } = require(R('web/sim/ssr.js'));
const IN = require(R('web/input.js'));
const A = n => fs.readFileSync(R('assets_extracted/' + n));
const args = process.argv.slice(2).filter(a => !a.startsWith('--')), D = R(args[0] || 'ref/movie');
const fds = fs.openSync(D + '/state.bin', 'r'), fdw = fs.openSync(D + '/wram.bin', 'r'), fdp = fs.openSync(D + '/spr.bin', 'r');
const ports = fs.readFileSync(D + '/ports.bin'), nrec = fs.fstatSync(fds).size / HW.REC;
const E = Math.min(+(args[1] || nrec), nrec), spr = process.argv.includes('--spr'), IO = +(process.env.IO ?? -1);
// --dead: ignore the freed stack slots just below the two idle stack tops (0x104c00 user, 0x104e00 supervisor): MAME's
// frame_done snapshot lands a few instructions away from our step boundary, so a dead return address (0x1578/0x157e of
// the idle loop) can differ there; it is below SP, never read back, and the next frames agree again.
const DEAD = process.argv.includes('--dead'), DEADR = [[0xbf0, 0xc00], [0xdf0, 0xe00]];
const rd = (fd, n, f) => { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, (f - 1) * n); return new Uint8Array(b); };
const diff = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
const m = new Machine(A('prog.bin'), A('eeprom.bin'), A('gfx_tiles.bin'), A('gfx_sprites.bin'));
  if (process.env.SND !== '0') m.attachSound(A('z80.bin'), A('k053260.bin'));
m.powerOn(); let ok = 0, first = 0; const t0 = process.hrtime.bigint();
for (let f = 1; f <= E; f++) {
  const k = f + IO; if (k >= 1 && k * 5 <= ports.length) IN.applyFrame(m, IN.fromPorts(ports.subarray((k - 1) * 5, k * 5))); // via the per-player FrameInput struct
  if (f > 1) m.step();
  if (f < 2) { ok++; continue; }
  const r = HW.fromRecord(rd(fds, HW.REC, f - 1), 0), out = [];
  for (const [n] of HW.FIELDS) { const i = diff(m.v[n], r[n]); if (i >= 0) out.push(n + '@' + i.toString(16)); }
  const w = diff(m.wram, rd(fdw, 0x4000, f - 1)); if (w >= 0) { let n = 0; const b = rd(fdw, 0x4000, f - 1); for (let i = 0; i < 0x4000; i++) if (m.wram[i] !== b[i] && !(DEAD && DEADR.some(([lo, hi]) => i >= lo && i < hi))) n++; if (n) out.push('wram@' + (0x104000 + w).toString(16) + 'x' + n); }
  if (spr) { const s = diff(m.sprBytes(), rd(fdp, 0x4000, f - 1)); if (s >= 0) out.push('spr@' + (0x180000 + s).toString(16)); }
  if (out.length) { if (process.env.ALL && f < +process.env.ALL) console.log(f, out.join(" ")); if (!first) { first = f; console.log('first divergence frame', f, out.join(' ')); } } else ok++;
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`${ok}/${E} frames byte-exact (IO=${IO})${first ? ', first divergence ' + first : ''}; ${(ms / E).toFixed(3)} ms/frame`);
