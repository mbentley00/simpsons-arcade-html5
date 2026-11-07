#!/usr/bin/env python3
"""The itch build inside an itch-like iframe (cross-origin, itch's sandbox/allow attributes), headless Chrome:
loader shows -> pick roms/ssriders.zip -> game runs; keyboard reaches the game in the iframe; fullscreen of the iframe
refits the canvas; reload -> starts from the IndexedDB cache; F7 opens the multiplayer UI with the alwaysdata https
signal URL. Screenshots ref/preview/itch_loader.png and itch_play.png.
Usage: python3 test/test_itch_iframe.py [dist/sunsetriders_itch_<stamp>.zip]   (default: newest in dist/)"""
import os, sys, glob, time, zipfile, tempfile, threading, functools, http.server
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); os.chdir(ROOT)
BUILD = sys.argv[1] if len(sys.argv) > 1 else max(glob.glob('dist/sunsetriders_itch_*.zip'), key=os.path.getmtime)
game = tempfile.mkdtemp(); zipfile.ZipFile(BUILD).extractall(game); top = tempfile.mkdtemp()
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve(d, host):
    s = http.server.ThreadingHTTPServer((host, 0), functools.partial(Q, directory=d)); threading.Thread(target=s.serve_forever, daemon=True).start(); return s.server_address[1]
gp = serve(game, '127.0.0.1')
# itch.io embeds games like this (attributes copied from an itch game page)
open(os.path.join(top, 'index.html'), 'w').write(f'''<!doctype html><html><body style="margin:0;background:#222;color:#ccc;font:14px sans-serif">
<p style="padding:8px">itch-like page (other origin)</p>
<iframe id="game_drop" src="http://127.0.0.1:{gp}/index.html" width="960" height="600" frameborder="0" scrolling="no" allowfullscreen
 allow="autoplay; fullscreen *; geolocation; microphone; camera; midi; monetization; xr-spatial-tracking; gamepad; gyroscope; accelerometer; xr; cross-origin-isolated; web-share"
 sandbox="allow-scripts allow-pointer-lock allow-popups allow-same-origin allow-popups-to-escape-sandbox allow-downloads allow-forms allow-modals allow-orientation-lock"></iframe></body></html>''')
tp = serve(top, 'localhost')
ok, log = True, []
def chk(name, v): global ok; ok &= bool(v); print(('ok  ' if v else 'BAD ') + name)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); pg = b.new_page(viewport={'width': 1000, 'height': 680}, locale=os.environ.get('LOC', 'pt-BR'))
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://localhost:{tp}/index.html')
    fr = lambda: pg.frame_locator('#game_drop'); F = lambda: [f for f in pg.frames if f.url.startswith(f'http://127.0.0.1:{gp}')][0]
    fr().locator('#romload button').wait_for(timeout=15000); time.sleep(0.3)
    chk('loader shows inside the iframe', fr().locator('#romload').is_visible())
    bb = fr().locator('#romload .bx').bounding_box(); chk(f'loader box fits the 960x600 iframe ({bb["width"]:.0f}x{bb["height"]:.0f})', bb['height'] < 600 and bb['width'] < 960)
    pg.screenshot(path='ref/preview/itch_loader' + ('' if os.environ.get('LOC', 'pt-BR') == 'pt-BR' else '_en') + '.png')
    t0 = time.time(); fr().locator('#rz').set_input_files('roms/ssriders.zip'); F().evaluate('SSRG.ready')
    chk(f'zip -> game running ({time.time() - t0:.2f} s)', F().evaluate('SSRG.frame') >= 0)
    time.sleep(2); f0 = F().evaluate('SSRG.frame'); chk(f'frames advance ({f0})', f0 > 60)
    # keyboard focus in the iframe: click the game, then keys must reach SSRIN
    pg.locator('#game_drop').click(); pg.keyboard.down('Digit5'); held = F().evaluate('SSRIN.sample()[0]'); pg.keyboard.up('Digit5')
    chk(f'keyboard reaches the game in the iframe (P1 byte {held})', held & 64)
    while F().evaluate('SSRG.frame') < 900: time.sleep(0.2)   # boot + intro start; the coin skips to the title
    for k in ['Digit5', 'KeyZ', 'KeyZ']: pg.keyboard.down(k); time.sleep(0.15); pg.keyboard.up(k); time.sleep(1.0)
    pg.keyboard.down('ArrowRight'); t = time.time()
    while time.time() - t < 14: pg.keyboard.down('KeyZ'); time.sleep(0.1); pg.keyboard.up('KeyZ'); time.sleep(0.15)
    pg.keyboard.up('ArrowRight'); pg.screenshot(path='ref/preview/itch_play.png')
    # fullscreen button (itch fullscreens the iframe): canvas must refit
    w0 = F().evaluate('screen_w = document.getElementById("screen").getBoundingClientRect().width')
    pg.evaluate('document.getElementById("game_drop").requestFullscreen()'); time.sleep(1)
    w1 = F().evaluate('document.getElementById("screen").getBoundingClientRect().width'); iw = F().evaluate('innerWidth')
    chk(f'fullscreen refits the canvas ({w0:.0f} -> {w1:.0f} px, iframe {iw} px wide)', w1 >= w0 and w1 <= iw)
    pg.evaluate('document.exitFullscreen()'); time.sleep(0.5)
    pg.reload(); fr().locator('canvas#screen').wait_for(); F().evaluate('SSRG.ready'); time.sleep(1.5)
    chk('reload: starts from cache, no loader', fr().locator('#romload').count() == 0 and F().evaluate('SSRG.frame') > 30)
    pg.locator('#game_drop').click(); pg.keyboard.press('F7'); time.sleep(0.3)
    chk('F7 opens the multiplayer UI', fr().locator('#np').is_visible())
    sig = F().evaluate('SSRNETPLAY.signal'); chk(f'signal URL {sig}', sig == 'https://games4me.alwaysdata.net/ssr/signal.php')
    chk('build stamp on scripts', '?v=' in F().evaluate('document.querySelector("script[src*=game]").src'))
    chk(f'no page errors {errs}', not errs)
    b.close()
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
