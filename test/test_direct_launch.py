#!/usr/bin/env python3
"""Editor launches the gorge with Rivet and Duffman together; repeat launch restores both cached skins/palettes."""
import functools
import http.server
import os
import threading
import time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=os.path.join(ROOT, 'web')))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width':1400,'height':900})
        editor = ctx.new_page(); errors = []
        editor.on('pageerror',lambda e:errors.append(str(e)))
        editor.goto(f'http://127.0.0.1:{server.server_port}/editor.html')
        editor.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT,'roms/simpsons.zip'))
        editor.wait_for_function('document.getElementById("scene").options.length >= 12')
        editor.select_option('#scene',label='Stage 5 - gorge'); editor.click('#toolEnemies')
        assert editor.evaluate('SIMPENEMY.display(SIMPDUFFMAN)') == {'width':48,'height':72,'anchor':[24,68]}
        box = editor.locator('#map').bounding_box(); zoom = editor.evaluate('document.getElementById("map").getBoundingClientRect().width / document.getElementById("map").width')
        editor.mouse.click(box['x']+240*zoom,box['y']+192*zoom)
        editor.select_option('#enemyKind','duffman')
        editor.mouse.click(box['x']+280*zoom,box['y']+216*zoom)
        with ctx.expect_page() as popup:
            editor.click('#play')
        game = popup.value; game.on('pageerror',lambda e:errors.append(str(e)))
        game.wait_for_url('**/index.html?scene=9&play=1')
        game.evaluate('SIMPG.ready')
        assert game.evaluate('SIMPLAUNCH.playable(SIMPG.machine,SIMPSTAGE.SCENES.find(s=>s.scene===9))')
        assert game.evaluate('SIMPG.machine.ram[0x867]') == 6
        game.evaluate('SIMPG.pause(true)')
        assert game.evaluate('Object.keys(SIMPG.machine.stageEnemySkins).length') > 0
        assert game.evaluate('Object.values(SIMPG.machine.stageEnemySkins).some(s=>s.id==="rivet")')
        game.evaluate('SIMPG.video.render()')
        assert game.evaluate('SIMPG.video.bmp.some(p=>p>=4096)')
        assert game.evaluate('(()=>{const b=4096+16*Object.keys(SIMPENEMY_ASSETS).sort().indexOf("rivet");return SIMPG.video.bmp.some(p=>p>=b&&p<b+16)})()'), 'Rivet must use his own palette'
        os.makedirs(os.path.join(ROOT,'preview'),exist_ok=True)
        game.screenshot(path=os.path.join(ROOT,'preview/direct_gorge.png'))
        print('ok editor launches directly into playable gorge with Rivet and Duffman; no coin/start needed')
        url = game.url + '&pause=1'
        start = time.monotonic(); game.goto(url); game.evaluate('SIMPG.ready'); elapsed = time.monotonic()-start
        assert elapsed < 8, f'Cached launch took {elapsed:.1f}s'
        assert game.evaluate('SIMPLAUNCH.playable(SIMPG.machine,SIMPSTAGE.SCENES.find(s=>s.scene===9))')
        game.evaluate('SIMPG.video.render()')
        assert game.evaluate('SIMPG.video.bmp.some(p=>p>=4096)'), 'custom sprites must survive cached state restoration'
        assert game.evaluate('(()=>{const b=4096+16*Object.keys(SIMPENEMY_ASSETS).sort().indexOf("rivet");return SIMPG.video.bmp.some(p=>p>=b&&p<b+16)})()'), 'Rivet must survive cached state restoration'
        assert not errors,errors
        print(f'ok repeated launch restores the playable stage and custom sprites in {elapsed:.2f}s; no page errors')
        browser.close()
finally:
    server.shutdown()
