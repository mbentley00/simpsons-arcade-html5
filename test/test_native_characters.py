#!/usr/bin/env python3
"""Editor shows the stage's own characters (dog, goons, other native objects), lets them be moved, keeps scripts read-only."""
import functools
import http.server
import os
import threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=os.path.join(ROOT, 'web')))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(); ctx = browser.new_context(viewport={'width': 1400, 'height': 900})
        ed = ctx.new_page(); errors = []
        ed.on('pageerror', lambda e: errors.append(str(e)))
        ed.goto(f'http://127.0.0.1:{server.server_port}/editor.html')
        ed.evaluate('localStorage.clear()'); ed.reload()
        ed.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT, 'roms/simpsons.zip'))
        ed.wait_for_function('document.getElementById("scene").options.length === 12')
        ed.select_option('#scene', label='Stage 2 - amusement park'); ed.click('#toolEnemies')
        names = ed.evaluate('[...document.querySelectorAll("#enemyList option")].map(o => o.textContent)')
        assert any(n.startswith('Dog') for n in names), names
        assert any(n.startswith('Goon (purple suit)') for n in names) and any(n.startswith('Character 0x') for n in names)
        assert not any(n.startswith('Script') for n in names), 'scripts hidden by default'
        basic = sum(n.startswith('Enemy #') for n in names); assert len(names) > basic + 20, (len(names), basic)
        ed.check('#showScripts')
        with_scripts = ed.evaluate('document.querySelectorAll("#enemyList option").length'); assert with_scripts > len(names)
        script = ed.evaluate('[...document.querySelectorAll("#enemyList option")].find(o => o.textContent.startsWith("Script")).value')
        ed.select_option('#enemyList', script)
        assert ed.is_disabled('#enemyMove') and ed.is_disabled('#enemyDelete') and 'cannot be moved' in ed.inner_text('#enemyInfo')
        ed.uncheck('#showScripts')
        dog = ed.evaluate('[...document.querySelectorAll("#enemyList option")].find(o => o.textContent.startsWith("Dog")).value')
        ed.select_option('#enemyList', dog)
        assert not ed.is_disabled('#enemyMove') and 'Dog' in ed.inner_text('#enemyInfo')
        ed.fill('#enemyX', '400'); ed.fill('#enemyY', '160'); ed.click('#enemyMove'); ed.wait_for_timeout(400)
        rows = ed.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY)).enemies["1"]')
        moved = [r for r in rows if r['data'][7] == 0x26 and r.get('edited')]
        assert moved and (moved[0]['data'][0] << 8 | moved[0]['data'][1]) == 400 and moved[0]['data'][2] == 20, moved
        print(f'ok editor lists {len(names)} characters in the amusement park (dog, goons, native objects), scripts read-only, dog moved')
        with ctx.expect_page() as popup:
            ed.click('#play')
        game = popup.value; game.on('pageerror', lambda e: errors.append(str(e)))
        game.wait_for_url('**/index.html?scene=4&play=1'); game.evaluate('SIMPG.ready')
        assert game.evaluate('SIMPLAUNCH.playable(SIMPG.machine,SIMPSTAGE.SCENES[2])')
        assert not errors, errors
        print('ok the edited stage launches with the moved native character; no page errors')
        browser.close()
finally:
    server.shutdown()
