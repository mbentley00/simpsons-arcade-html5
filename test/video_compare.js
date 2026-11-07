// Renders attract-mode frames with web/sim/video.js and diffs them against MAME snapshots (snap/f<n>.raw from run/snaps.lua,
// ARGB32 320x224). Writes preview/cmp_f<n>.png (MAME | ours | diff in red).   node test/video_compare.js [frames...]
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { Board } = require('../web/sim/simpsons.js'), { Video, W, H } = require('../web/sim/video.js');
const ROOT = path.join(__dirname, '..');
const frames = process.argv.slice(2).map(Number);
if (!frames.length) for (const f of fs.readdirSync(path.join(ROOT, 'snap'))) { const m = /^f(\d+)\.raw$/.exec(f); if (m) frames.push(+m[1]); }
frames.sort((a, b) => a - b);
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png(file, w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = px[y * w + x], o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = v >> 16; raw[o + 1] = v >> 8; raw[o + 2] = v; }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const b = new Board(require('./roms.js')()), v = new Video(b), want = new Set(frames), got = {};
// MAME (VIDEO_UPDATE_AFTER_VBLANK) shows frame n's bitmap at the next vblank end, resolving pens with the palette at that time
let pend = 0;
b.onFrame = bd => { if (pend) { got[pend] = v.toRGB().slice(); pend = 0; } if (want.has(bd.frame)) { v.render(); pend = bd.frame; } };
fs.mkdirSync(path.join(ROOT, 'preview'), { recursive: true });
let total = 0;
for (const n of frames) {
  while (!(n in got)) b.runFrames(1);
  const ref = new Uint32Array(fs.readFileSync(path.join(ROOT, `snap/f${n}.raw`)).buffer.slice(0)), ours = got[n];
  const out = new Uint32Array(W * 3 * H); let d = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = ref[i] & 0xffffff, c = ours[i] & 0xffffff, bad = a !== c; if (bad) d++;
    out[y * 3 * W + x] = a; out[y * 3 * W + W + x] = c; out[y * 3 * W + 2 * W + x] = bad ? 0xff0000 : ((a >> 2) & 0x3f3f3f);
  }
  total += d; png(path.join(ROOT, `preview/cmp_f${n}.png`), 3 * W, H, out);
  console.log(`frame ${n}: ${d} / ${W * H} pixels differ${v.mixed ? ' (mixed scroll seen)' : ''}`);
}
console.log(`total ${total}`);
