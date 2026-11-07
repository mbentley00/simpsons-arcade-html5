// Renders the attract-mode sound (YM2151 + K053260 mixed like MAME's speaker) from power-on to a 16-bit stereo WAV at
// the native 55930 Hz stream rate.   node test/audio_render.js OUT.wav [seconds=120]
'use strict';
const fs = require('fs');
const { Board, HZ } = require('../web/sim/simpsons.js');
const out = process.argv[2] || 'preview/attract.wav', secs = +(process.argv[3] || 120);
const b = new Board(require('./roms.js')()); b.audio = true;
const parts = []; let n = 0; const frames = Math.ceil(secs * HZ), t0 = Date.now();
for (let f = 0; f < frames; f++) { b.runFrames(1); const a = b.drainAudio(); parts.push(a); n += a.length; }
const pcm = new Int16Array(n); let o = 0; for (const a of parts) { pcm.set(a, o); o += a.length; }
const h = Buffer.alloc(44), R = 55930;
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(R, 24); h.writeUInt32LE(R * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.byteLength, 40);
fs.writeFileSync(out, Buffer.concat([h, Buffer.from(pcm.buffer)]));
console.log(out, n / 2, 'samples', ((Date.now() - t0) / frames).toFixed(2), 'ms/frame');
