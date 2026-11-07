// Run the machine (attract, or the input movie with MOVIE=1) with the sound board and dump its audio log
// as Int32 triples [sample, reg, data]. Usage: node tools/dump_sndlog.js OUT FRAMES [movie]
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const { Machine } = require(R('web/sim/ssr.js')); const IN = require(R('web/input.js'));
const A = n => fs.readFileSync(R('assets_extracted/' + n));
const OUT = process.argv[2], F = +process.argv[3], movie = process.argv[4] === 'movie';
const m = new Machine(A('prog.bin'), A('eeprom.bin'), A('gfx_tiles.bin'), A('gfx_sprites.bin'));
m.attachSound(A('z80.bin'), A('k053260.bin')); m.powerOn();
const ports = movie ? fs.readFileSync(R('ref/movie/ports.bin')) : null;
for (let f = 1; f <= F; f++) {
  const k = f - 1; if (movie && k >= 1 && k * 5 <= ports.length) IN.applyFrame(m, IN.fromPorts(ports.subarray((k - 1) * 5, k * 5)));
  if (f > 1) m.step();
}
fs.writeFileSync(OUT, Buffer.from(Int32Array.from(m.snd.log).buffer));
console.log(m.snd.log.length / 3, 'entries; last sample', m.snd.log[m.snd.log.length - 3]);
