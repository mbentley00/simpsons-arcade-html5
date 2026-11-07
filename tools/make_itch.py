"""itch.io HTML5 package for the public page: dist/simpsons_itch_<stamp>.zip, index.html at the zip root.
Only web CODE is packed: no assets/ (ROM-derived), no dumps, no movie, no signal.php (runs on alwaysdata), nothing
from the ROM. Players bring their own MAME simpsons.zip (web/romload.js). Build stamp: ?v=<stamp> on every script and
worklet URL for cache busting. The finished zip is then scanned and the build fails if anything ROM-derived is in it:
files whose CRC32 matches a ROM chip or an extracted file, files with a ROM-chip/extracted size, assets/ or binary
paths, or any 32-byte sample (every 2 KB) of the ROM data found inside any file.
Usage: python3 tools/make_itch.py   (from the repo root; SSR_BUILD=<stamp> to force the stamp)"""
import os, re, sys, time, zipfile, zlib
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); os.chdir(ROOT)
BUILD = os.environ.get('SSR_BUILD') or time.strftime('%Y%m%d-%H%M%S')
WEB = 'web'; OUT = f'dist/simpsons_itch_{BUILD}.zip'
CODE_EXT = ('.js', '.html', '.css', '.ttf', '.txt')
SKIP_DIRS = ('assets', 'net/rooms')
ROM_CRC = {int(c, 16) for c in re.findall(r"'[^']+': 0x([0-9a-f]{8})", open('web/romload.js').read().split('const NEED', 1)[1].split('};', 1)[0])}
ROM_SIZES = {0x80000, 0x28000, 0x100000, 0x400000, 0x140000, 0x20000, 0x10000, 0x40000, 0x200000, 128}

def files():
    for r, d, f in os.walk(WEB):
        rel = os.path.relpath(r, WEB).replace(os.sep, '/')
        d[:] = sorted(x for x in d if not any((rel + '/' + x).lstrip('./').startswith(s) for s in SKIP_DIRS))
        for fn in sorted(f):
            arc = os.path.relpath(os.path.join(r, fn), WEB).replace(os.sep, '/')
            if fn.endswith(CODE_EXT) and not fn.startswith('.'): yield arc

def stamp(arc, text):
    v = '?v=' + BUILD
    if arc == 'index.html':
        text = re.sub(r'(<script src="[^"?]+\.js)(")', r'\1' + v + r'\2', text)
        text = text.replace('<head>', f'<head><script>window.SIMP_BUILD={BUILD!r};</script>', 1)
    return text

def check(path):
    """ROM-free assertion on the finished zip. Returns the list of problems (empty = clean)."""
    bad, crcs, samples = [], set(ROM_CRC), []
    for d in ('assets_extracted', 'web/assets', 'web/assets/gfx', 'dist/simpsons_web/assets'):   # local extracted files, if present: their CRCs + samples
        for fn in (os.listdir(d) if os.path.isdir(d) else []):
            p = os.path.join(d, fn)
            if os.path.isfile(p) and fn.endswith('.bin'):
                b = open(p, 'rb').read(); crcs.add(zlib.crc32(b))
                if len(b) >= 4096: samples += [b[o:o + 32] for o in range(0, len(b) - 32, 2048) if len(set(b[o:o + 32])) > 3]
    if os.path.isfile('roms/simpsons.zip'):   # the raw chips too (local only, never packed)
        with zipfile.ZipFile('roms/simpsons.zip') as r:
            for i in r.infolist():
                b = r.read(i); samples += [b[o:o + 32] for o in range(0, len(b) - 32, 2048) if len(set(b[o:o + 32])) > 3]
    with zipfile.ZipFile(path) as z:
        for i in z.infolist():
            n, b = i.filename, z.read(i.filename)
            if 'assets/' in n or not n.endswith(CODE_EXT): bad.append(f'{n}: not a code file / assets path')
            if zlib.crc32(b) in crcs: bad.append(f'{n}: CRC matches ROM-derived data')
            if len(b) in ROM_SIZES: bad.append(f'{n}: size {len(b)} matches a ROM/extracted size')
            for s in samples:
                if s in b: bad.append(f'{n}: contains ROM data'); break
    return bad, len(samples), len(crcs)

if __name__ == '__main__':
    os.makedirs('dist', exist_ok=True); n = 0
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for arc in files():
            if arc.endswith('.ttf'): z.write(os.path.join(WEB, arc), arc); n += 1; continue   # bundled OFL font (binary)
            t = open(os.path.join(WEB, arc), encoding='utf-8').read(); z.writestr(arc, stamp(arc, t)); n += 1
    bad, ns, nc = check(OUT)
    if bad: os.remove(OUT); print('ROM-FREE CHECK FAILED:', *bad, sep='\n  '); sys.exit(1)
    print(f'itch build {BUILD}: {OUT} {n} files {os.path.getsize(OUT)} bytes; ROM-free check OK ({nc} CRCs, {ns} data samples, no assets/)')
