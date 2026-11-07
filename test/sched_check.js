// Compare the board's scheduler log (X = CPU slice, T = timer callback) with MAME's (-log patch, see NOTES.md).
//   node test/sched_check.js [sched.log] [seconds]
'use strict';
const fs = require('fs');
const { Board, } = require('../web/sim/simpsons.js');
const ref = fs.readFileSync(process.argv[2] || '/tmp/sched.log', 'utf8').split('\n').filter(l => /^[XT] /.test(l));
const secs = +(process.argv[3] || 1);
const b = new Board(require('./roms.js')());
let n = 0, bad = null;
b.s.log = l => { if (bad) return; if (n < ref.length && l !== ref[n]) bad = { n, ours: l, mame: ref[n], ctx: ref.slice(Math.max(0, n - 6), n) }; n++; };
// replay log from reset: reset() created the timers before s.log was set, which only logs at run time
const T = BigInt(Math.round(secs * 1e6)) * 1000000000000n;
try { while (!bad && b.s.basetime < T && n < ref.length) b.s.timeslice(); } catch (e) { console.log('exception after', n, 'lines:', e.message); }
if (bad) { console.log(`first divergence at line ${bad.n + 1}:`); console.log(bad.ctx.join('\n')); console.log('MAME:', bad.mame); console.log('ours:', bad.ours); process.exit(1); }
console.log(`match: ${n} lines (MAME log has ${ref.length}), t=${Number(b.s.basetime) / 1e18}s`);
