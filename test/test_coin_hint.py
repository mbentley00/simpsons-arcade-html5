#!/usr/bin/env python3
"""Coin hint overlay (web/net/hint.js) in headless Chrome: PT / EN by navigator.language, gamepad wording (fake pad),
'press Z to join' after the coin, hidden once P1 is in, hidden while the chat field is open, and the overlay never
touches the sim (same frame-by-frame RAM hash with the hint on and off). Usage: python3 test/test_coin_hint.py [--preview DIR]"""
import os, sys, threading, functools, http.server, time
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PREV = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=os.path.join(ROOT, 'web'))); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
PAD = """(() => { const pad = { id: 'Xbox fake', index: 0, connected: true, mapping: 'standard', axes: [0,0,0,0],
  buttons: Array.from({length: 17}, () => ({ pressed: false, value: 0 })) };
  navigator.getGamepads = () => [pad, null, null, null]; window.__pad = pad; })()"""
ok = True
def check(name, cond):
    global ok; ok &= bool(cond); print(('ok   ' if cond else 'FAIL ') + name)
def shot(pg, n):
    if PREV: pg.screenshot(path=os.path.join(PREV, n), clip=pg.evaluate("(() => { const r = document.getElementById('screen').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()"))
ZIP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'roms', 'simpsons.zip')
def boot(pg, url):  # the user's own ROM zip through the picker (nothing ROM-derived is served)
    pg.goto(url); pg.locator('#romload input[type=file]').set_input_files(ZIP); pg.evaluate('SSRG.ready')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    def page(locale, pad=False):
        ctx = b.new_context(locale=locale, viewport={'width': 1152, 'height': 896}); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        if pad: pg.add_init_script(PAD)
        boot(pg, f'http://127.0.0.1:{port}/index.html?sound=0'); time.sleep(1); pg.evaluate('SSRG.run(2400)'); time.sleep(1); return pg, errs
    # PT, keyboard
    pg, errs = page('pt-BR'); s = pg.evaluate('SSRHINT.shown'); print('PT:', s)
    check('PT text on attract (offline free play)', s == 'Aperte 1-4 para jogar com Marge, Homer, Bart ou Lisa'); shot(pg, 'coin_hint_pt.png')
    pg.keyboard.press('Tab'); time.sleep(0.2); check('hidden while chat field open', pg.evaluate('SSRHINT.shown') is None)
    pg.keyboard.press('Escape'); time.sleep(0.2)
    # 1 = play as Marge: no coin; the hint goes once she is in play (the start sequence takes a few seconds)
    pg.keyboard.press('Digit1')
    for i in range(120):
        time.sleep(0.3)
        if pg.evaluate('SSRHINT.shown') is None: break
    time.sleep(1); print('flags', pg.evaluate('SSRG.machine.ram[0x0a40]'), pg.evaluate('SSRHINT.shown')); check('hidden once P1 is in', pg.evaluate('SSRHINT.shown') is None); shot(pg, 'coin_hint_joined.png')
    check('no page errors', not errs); pg.context.close()
    # EN
    pg, errs = page('en-US'); s = pg.evaluate('SSRHINT.shown'); print('EN:', s)
    check('EN text', s == 'Press 1-4 to play as Marge, Homer, Bart or Lisa'); shot(pg, 'coin_hint_en.png'); pg.context.close()
    # gamepad
    pg, errs = page('pt-BR', pad=True); s = pg.evaluate('SSRHINT.shown'); print('pad:', s)
    check('pad wording', s == 'Aperte Start para jogar (1-4 escolhe o personagem)'); shot(pg, 'coin_hint_pad.png')
    pg.keyboard.press('ArrowLeft'); time.sleep(0.2); check('key press -> keyboard wording', pg.evaluate('SSRHINT.shown').startswith('Aperte 1-4'))
    pg.context.close()
    # determinism: the overlay does not change the sim (RAM hash after N frames with hint on vs off, no rAF loop)
    pg, _ = page('pt-BR'); r = pg.evaluate("""() => { SSRG.pause(true); const m = SSRG.machine, s0 = m.save(), out = [];
      for (const off of [false, true]) { m.load(s0); SSRHINT.off = off; const f0 = SSRG.frame; let shown = 0;
        for (let i = 0; i < 600; i++) { SSRG.run(1); if (SSRHINT.shown) shown++; }
        out.push([SSRSNAP.hash(m.save()) >>> 0, shown]); }
      return out; }""")
    pg.context.close(); print('state hash hint on / off', r); check('overlay drawn and state identical with hint on/off', r[0][0] == r[1][0] and r[0][1] > 0 and r[1][1] == 0)
    b.close()
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
