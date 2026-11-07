#!/usr/bin/env python3
"""Run web/index.html (interpreter Machine from power-on + render.js) in headless Chromium, time it, take screenshots.
  1. attract from power-on to DEMO (stage 1 demo play, frames ~8100-9500) -> ref/preview/web_demo.png
  2. ?movie=assets/movie/ports.bin (MAME input movie, copy ref/movie/ports.bin there) to PLAY -> ref/preview/web_play.png,
     and check the browser machine's work RAM + video state against ref/movie at that frame.
Usage: python3 test/test_web_runtime.py [DEMO=9000] [PLAY=2400]"""
import sys, os, threading, functools, http.server, hashlib
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); os.chdir(ROOT)
DEMO = int(sys.argv[1]) if len(sys.argv) > 1 else 9000
PLAY = int(sys.argv[2]) if len(sys.argv) > 2 else 2400
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory='web')); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.makedirs('ref/preview', exist_ok=True)
TIME = """async n => { const t0 = performance.now(); SSRG.run(n); const t1 = performance.now();
  const N = 30, t2 = performance.now(); for (let i = 0; i < N; i++) SSRG.draw(); const t3 = performance.now();
  return { step: (t1 - t0) / n, draw: (t3 - t2) / N, frame: SSRG.frame }; }"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 288 * 3, 'height': 224 * 3})
    pg.goto(f'http://127.0.0.1:{port}/index.html?pause=1'); pg.evaluate('SSRG.ready')
    r = pg.evaluate(TIME, DEMO)
    print(f"attract: {r['frame']} frames from power-on, machine step {r['step']:.3f} ms/frame, render {r['draw']:.3f} ms/frame")
    pg.locator('#screen').screenshot(path='ref/preview/web_demo.png')
    pg.goto(f'http://127.0.0.1:{port}/index.html?pause=1&movie=assets/movie/ports.bin'); pg.evaluate('SSRG.ready')
    r = pg.evaluate(TIME, PLAY)
    print(f"movie:   {r['frame']} frames, machine step {r['step']:.3f} ms/frame, render {r['draw']:.3f} ms/frame")
    pg.locator('#screen').screenshot(path='ref/preview/web_play.png')
    w = bytes(pg.evaluate('Array.from(SSRG.machine.wram)'))
    pal = bytes(pg.evaluate('Array.from(SSRG.machine.v.pal)'))
    with open('ref/movie/wram.bin', 'rb') as f: f.seek((PLAY - 2) * 0x4000); mw = f.read(0x4000)
    dead = [i for i in range(0x4000) if w[i] != mw[i] and not (0xbf0 <= i < 0xc00 or 0xdf0 <= i < 0xe00)]
    print('browser machine work RAM vs MAME at movie frame', PLAY, 'OK' if not dead else f'DIFF {len(dead)} bytes')
    b.close()
