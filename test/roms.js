// Node helper: build the board files from roms/simpsons.zip (same layout as web/romload.js extract()).
'use strict';
const path = require('path'), { execFileSync } = require('child_process');
module.exports = function load(zip) {
  zip = zip || path.join(__dirname, '../roms/simpsons.zip');
  const r = n => new Uint8Array(execFileSync('unzip', ['-p', zip, n], { maxBuffer: 1 << 25 }));
  const prog = new Uint8Array(0x80000);
  prog.set(r('072-g02.16c'), 0); prog.set(r('072-g01.17c'), 0x20000); prog.set(r('072-j13.13c'), 0x40000); prog.set(r('072-j12.15c'), 0x60000);
  const z80 = new Uint8Array(0x28000), e = r('072-e03.6g'); z80.set(e.subarray(0, 0x8000), 0); z80.set(e.subarray(0x8000), 0x10000);
  const pcm = new Uint8Array(0x140000); pcm.set(r('072-d05.1f'), 0); pcm.set(r('072-d04.1d'), 0x100000);
  const b07 = r('072-b07.18h'), b06 = r('072-b06.16h'), chr = new Uint8Array(b07.length * 2);
  for (let i = 0; i < b07.length; i += 2) { chr[2 * i] = b07[i]; chr[2 * i + 1] = b07[i + 1]; chr[2 * i + 2] = b06[i]; chr[2 * i + 3] = b06[i + 1]; }
  const sr = ['072-b08.3n', '072-b09.8n', '072-b10.12n', '072-b11.16l'].map(r), spr = new Uint8Array(0x400000);
  for (let i = 0; i < 0x100000; i += 2) for (let k = 0; k < 4; k++) { spr[4 * i + 2 * k] = sr[k][i]; spr[4 * i + 2 * k + 1] = sr[k][i + 1]; }
  return { 'prog.bin': prog, 'z80.bin': z80, 'k053260.bin': pcm, 'gfx_tiles.bin': chr, 'gfx_sprites.bin': spr, 'eeprom.bin': r('simpsons.12c.nv') };
};
