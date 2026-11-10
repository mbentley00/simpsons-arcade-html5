#!/usr/bin/env python3
"""Offline character choice: keys 1-4 and the "Play as" buttons join Marge/Homer/Bart/Lisa without a coin, and the
keyboard (including the Remix move keys) then drives that character. Uses the player's local ROM."""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=os.path.join(ROOT, 'web')))
threading.Thread(target=server.serve_forever, daemon=True).start()
IN = '(p) => !!(SIMPG.machine.ram[0x0a40 + 0xc0 * p] & 0x40)'   # 0x40 = in play
X = '(p) => { const r = SIMPG.machine.ram, o = 0x0a4c + 0xc0 * p; return ((r[o] << 8) | r[o + 1]) << 16 >> 16; }'
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 860}); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://127.0.0.1:{server.server_port}/index.html'); pg.evaluate('localStorage.removeItem("simpsons.slot")')
        pg.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT, 'roms', 'simpsons.zip')); pg.evaluate('SSRG.ready')
        assert pg.is_visible('#playas') and pg.inner_text('#playas').startswith('Play as')
        pg.wait_for_function('SIMPG.frame > 1200', timeout=90000)   # title / attract running
        assert not any(pg.evaluate(IN, s) for s in range(4)), 'nobody playing yet'
        pg.mouse.click(640, 500); pg.keyboard.press('2')              # Homer, no coin
        pg.wait_for_function(f'({IN})(1)', timeout=90000)
        assert pg.evaluate('SSRIN.slot') == 1 and pg.get_attribute('#playas button:nth-of-type(2)', 'aria-pressed') == 'true'
        assert not pg.evaluate(IN, 0), 'Marge did not join'
        pg.wait_for_timeout(4000)                                     # stage intro
        x0 = pg.evaluate(X, 1); pg.keyboard.down('ArrowRight'); pg.wait_for_timeout(1200); pg.keyboard.up('ArrowRight'); x1 = pg.evaluate(X, 1)
        assert x1 > x0 + 20, f'the arrow keys move Homer ({x0} -> {x1})'
        print(f'ok key 2: Homer joined without a coin and the keyboard moves him ({x0} -> {x1})')
        pg.click('#playas button:nth-of-type(4)')                     # Lisa
        pg.wait_for_function(f'({IN})(3)', timeout=90000); assert pg.evaluate('SSRIN.slot') == 3
        pg.wait_for_timeout(3000)
        x0 = pg.evaluate(X, 3); pg.keyboard.down('ArrowLeft'); pg.wait_for_timeout(1000); pg.keyboard.up('ArrowLeft'); x1 = pg.evaluate(X, 3)
        assert x1 < x0 - 15, f'the keyboard now moves Lisa ({x0} -> {x1})'
        pg.keyboard.press('v'); pg.wait_for_timeout(100)
        assert pg.evaluate('SIMPG.machine.arcadeCombat.players[3].heavyAt >= 0 || SIMPG.machine.arcadeCombat.players[3].heavyReady > 0'), 'V is a heavy attack for Lisa'
        pg.screenshot(path=os.path.join(ROOT, 'preview', 'character_choice.png'))
        print(f'ok Play as Lisa: joined, keyboard and Remix keys follow her ({x0} -> {x1})')
        b.close()
    assert not errors, errors
    print('ok no page errors')
finally:
    server.shutdown()
