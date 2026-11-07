// Offline render of a dumped audio log (tools/dump_sndlog.js) to a 48 kHz 16-bit stereo WAV.
// Usage: node tools/render_wav.js LOG.bin OUT.wav [startSec] [durSec]
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const Mixer = require(R('web/sim/mixer.js'));
const log = Array.from(new Int32Array(fs.readFileSync(process.argv[2]).buffer.slice(0)));
const s0 = +(process.argv[4] || 0), dur = +(process.argv[5] || log[log.length - 3] / Mixer.CHIP_HZ - s0);
const mx = new Mixer(fs.readFileSync(R('assets_extracted/k053260.bin')), 48000); mx.push(log);
const N = Math.floor(dur * 48000), skip = Math.floor(s0 * 48000), L = new Float32Array(4800), Rr = new Float32Array(4800);
const out = Buffer.alloc(44 + N * 4); let o = 44;
const t0 = Date.now();
for (let i = 0; i < skip + N; i += 4800) {
  const m = Math.min(4800, skip + N - i); mx.render(L, Rr, m);
  for (let j = 0; j < m; j++) if (i + j >= skip) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[j] * 32768))), o); out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(Rr[j] * 32768))), o + 2); o += 4; }
}
const hd = (s, v, n) => n === 4 ? out.writeUInt32LE(v, s) : out.writeUInt16LE(v, s);
out.write('RIFF', 0); hd(4, 36 + N * 4, 4); out.write('WAVEfmt ', 8); hd(16, 16, 4); hd(20, 1); hd(22, 2); hd(24, 48000, 4); hd(28, 192000, 4); hd(32, 4); hd(34, 16);
out.write('data', 36); hd(40, N * 4, 4);
fs.writeFileSync(process.argv[3], out);
console.log('wrote', process.argv[3], N / 48000, 's in', (Date.now() - t0) / 1000, 's');
