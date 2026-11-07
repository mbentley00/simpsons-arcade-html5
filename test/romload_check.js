// The in-browser ROM loader (web/romload.js) must build exactly what the Python extract tools produce.
// Usage: node test/romload_check.js [roms/ssriders.zip]
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const ROM = require(R('web/romload.js'));
(async () => {
  const zip = fs.readFileSync(process.argv[2] || R('roms/ssriders.zip'));
  const t0 = performance.now(), f = await ROM.extract(zip), t1 = performance.now(), g = ROM.gfx(f), t2 = performance.now();
  let bad = 0;
  const cmp = (n, a, file) => { const b = fs.readFileSync(R(file)); const ok = Buffer.compare(Buffer.from(a), b) === 0; if (!ok) bad++; console.log(ok ? 'ok ' : 'BAD', n, a.length); };
  for (const n of Object.keys(f)) cmp(n, f[n], 'assets_extracted/' + n);
  cmp('gfx/tiles.bin', g.tiles, 'web/assets/gfx/tiles.bin'); cmp('gfx/sprites.bin', g.sprites, 'web/assets/gfx/sprites.bin');
  console.log(`unzip+crc ${(t1 - t0).toFixed(0)} ms, gfx decode ${(t2 - t1).toFixed(0)} ms`); console.log(bad ? 'FAIL' : 'PASS'); process.exit(bad ? 1 : 0);
})();
