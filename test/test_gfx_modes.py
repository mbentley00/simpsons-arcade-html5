#!/usr/bin/env python3
"""Presentation modes (web/gfx.js): WebGL CRT active in headless Chrome (SwiftShader), always bezel (no F8, old
localStorage ssr_gfx ignored+cleaned), #screen/#chatov aligned with the picture in every mode, ?webgl=0 falls back to the
2D canvas, and the sim state hash is identical across modes. Usage: python3 test/test_gfx_modes.py [--preview DIR]"""
import os, sys, threading, functools, http.server, time
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PREV = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=os.path.join(ROOT, 'web'))); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True
def check(name, cond):
    global ok; ok &= bool(cond); print(('ok   ' if cond else 'FAIL ') + name)
RECT = "(id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })"
HASH = """() => { SSRG.pause(true); const m = SSRG.machine, s0 = m.save(), out = [];
  for (const md of ['bezel', 'crt', 'orig']) { m.load(s0); SSRGFX.set(md); for (let i = 0; i < 300; i++) SSRG.run(1); out.push(SSRSNAP.hash(m.save()) >>> 0); }
  m.load(s0); SSRG.pause(false); return out; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(locale='pt-BR', viewport={'width': 1920, 'height': 1080}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{port}/index.html?sound=0'); pg.evaluate('localStorage.removeItem("ssr_gfx")'); pg.reload()
    pg.evaluate('SSRG.ready'); time.sleep(1)
    check('default mode is bezel', pg.evaluate('SSRGFX.mode') == 'bezel')
    check('WebGL CRT active', pg.evaluate('SSRGFX.webgl'))
    pg.evaluate('SSRG.run(1500)'); time.sleep(1.5)
    if PREV: pg.screenshot(path=os.path.join(PREV, 'gfx_crt_bezel_title.png'))
    sr, cr, orr = (pg.evaluate(RECT + f"('{i}')") for i in ('screen', 'crt', 'chatov'))
    print('bezel rects screen/crt/chatov', sr, cr, orr)
    check('crt canvas + overlay on the game picture (bezel)', all(abs(a - c) < 1 and abs(a - d) < 1 for a, c, d in zip(sr, cr, orr)))
    check('bezel picture is 4:3', abs(sr[2] / sr[3] - 4 / 3) < .01)
    fps0, f0 = pg.evaluate('SSRGFX.frames'), time.time(); time.sleep(3); fps = (pg.evaluate('SSRGFX.frames') - fps0) / (time.time() - f0)
    print(f'present fps {fps:.1f}, ms/present {pg.evaluate("SSRGFX.msPresent()"):.2f}, sim ms/frame {pg.evaluate("SSRG.msPerFrame()"):.2f}')
    # gameplay: coin + start, then a chat bubble
    pg.keyboard.down('Digit5'); time.sleep(.15); pg.keyboard.up('Digit5'); time.sleep(.4)
    for _ in range(30):
        pg.keyboard.down('KeyZ'); time.sleep(.1); pg.keyboard.up('KeyZ'); time.sleep(.2)
        if pg.evaluate('SSRHINT.shown') is None: break
    time.sleep(6); pg.keyboard.down('ArrowRight'); time.sleep(1.5); pg.keyboard.up('ArrowRight')
    pg.keyboard.press('Tab'); pg.keyboard.type('Yee-haw!'); pg.keyboard.press('Enter'); time.sleep(.6)
    if PREV:
        pg.screenshot(path=os.path.join(PREV, 'gfx_final.png'))
        x, y, w, h = sr; pg.screenshot(path=os.path.join(PREV, 'gfx_crt_zoom.png'), clip={'x': x + w * .30, 'y': y + h * .55, 'width': 480, 'height': 270})
    # no F8 toggle; stale localStorage from the old F8 build is ignored and cleaned
    pg.keyboard.press('F8'); time.sleep(.3); check('F8 does nothing', pg.evaluate('SSRGFX.mode') == 'bezel' and not pg.evaluate('!!document.getElementById("gfxtoast")'))
    pg.evaluate('localStorage.setItem("ssr_gfx", "orig")'); pg.reload(); pg.evaluate('SSRG.ready'); time.sleep(1)
    check('old ssr_gfx ignored -> bezel', pg.evaluate('SSRGFX.mode') == 'bezel')
    check('old ssr_gfx cleaned', pg.evaluate('localStorage.getItem("ssr_gfx")') is None)
    # hidden debug ?gfx=crt still lays out aligned
    pg.goto(f'http://127.0.0.1:{port}/index.html?sound=0&gfx=crt'); pg.evaluate('SSRG.ready'); time.sleep(.5)
    sr = pg.evaluate(RECT + "('screen')"); check('debug ?gfx=crt aligned', abs(sr[3] - 1080) < 1 and all(abs(a - c) < 1 for a, c in zip(sr, pg.evaluate(RECT + "('chatov')"))))
    pg.goto(f'http://127.0.0.1:{port}/index.html?sound=0'); pg.evaluate('SSRG.ready')
    time.sleep(1); r = pg.evaluate(HASH); print('state hash per mode', r); check('sim state identical in all modes', len(set(r)) == 1)
    check('no page errors', not errs); ctx.close()
    # non-16:9 window (itch embed 960x600) + WebGL off fallback
    ctx = b.new_context(locale='en-US', viewport={'width': 960, 'height': 600}); pg = ctx.new_page()
    pg.goto(f'http://127.0.0.1:{port}/index.html?sound=0&webgl=0'); pg.evaluate('SSRG.ready'); time.sleep(1)
    check('fallback: no webgl, 2D canvas visible', not pg.evaluate('SSRGFX.webgl') and pg.evaluate('document.getElementById("screen").style.opacity') == '1')
    sr, br = pg.evaluate(RECT + "('screen')"), pg.evaluate(RECT + "('bezel')"); print('960x600 bezel area', br, 'picture', sr)
    check('16:9 area letterboxed in 960x600', abs(br[2] - 960) < 1 and abs(br[3] - 540) < 1 and abs(br[1] - 30) < 1)
    check('fallback still bezel mode', pg.evaluate('SSRGFX.mode') == 'bezel')
    ctx.close(); b.close()
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
