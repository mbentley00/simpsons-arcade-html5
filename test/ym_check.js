// Compare web/sim/ym2151.js against native ymfm (harness output, int16 stereo) for a dumped audio log.
// Usage: node test/ym_check.js LOG.bin REF.raw
const fs = require('fs'), path = require('path');
const YM = require(path.join(__dirname, '../web/sim/ym2151.js'));
const L = new Int32Array(fs.readFileSync(process.argv[2]).buffer.slice(0)), ref = new Int16Array(fs.readFileSync(process.argv[3]).buffer.slice(0));
const y = new YM(); let p = 0, bad = 0, nz = 0; const N = ref.length / 2, t0 = Date.now();
for (let n = 0; n < N; n++) {
  while (p < L.length && L[p] <= n) { if (L[p + 1] < 0x100) y.write(L[p + 1], L[p + 2]); p += 3; }
  const o = y.generate();
  if (ref[2 * n]) nz++;
  if (o[0] !== ref[2 * n] || o[1] !== ref[2 * n + 1]) { if (bad++ < 5) console.log('sample', n, 'ours', o[0], o[1], 'ref', ref[2 * n], ref[2 * n + 1]); }
}
console.log(N, 'samples,', nz, 'nonzero, mismatches', bad, ',', (Date.now() - t0) / N * 1000, 'us/sample');
process.exit(bad ? 1 : 0);
