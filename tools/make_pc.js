// PC deploy build (Saulo's own machine only): copies web/ into dist/simpsons_web/ and adds assets/*.bin extracted
// from the local roms/simpsons.zip with the same code the browser uses (web/romload.js), so index.html starts the game
// directly. Output is ROM-derived: never commit it, never upload it anywhere public. Usage: node tools/make_pc.js
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); process.chdir(ROOT);
const OUT = 'dist/simpsons_web', BUILD = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
fs.rmSync(OUT, { recursive: true, force: true }); fs.cpSync('web', OUT, { recursive: true, filter: s => !/net[\/\\]rooms/.test(s) });
let h = fs.readFileSync(OUT + '/index.html', 'utf8').replace(/(<script src="[^"?]+\.js)(")/g, `$1?v=${BUILD}$2`);
fs.writeFileSync(OUT + '/index.html', h);
const R = require(path.join(ROOT, 'web/romload.js'));
(async () => {
  const files = await R.extract(fs.readFileSync('roms/simpsons.zip'));
  fs.mkdirSync(OUT + '/assets', { recursive: true });
  for (const [n, b] of Object.entries(files)) if (b) fs.writeFileSync(`${OUT}/assets/${n}`, b);
  execSync(`cd dist && rm -f simpsons_web_pc.zip && python3 -m zipfile -c simpsons_web_pc.zip simpsons_web`);
  console.log('pc build', BUILD, OUT, Object.keys(files).join(' '));
})();
