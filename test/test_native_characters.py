#!/usr/bin/env python3
"""Editor shows the stage's own characters with their real sprites (rendered from the ROM), lets them be moved and placed,
and duplicates script/event groups."""
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
        ed.wait_for_function('document.getElementById("scene").options.length >= 12')
        ed.select_option('#scene', label='Stage 2 - amusement park'); ed.click('#toolEnemies')
        names = ed.evaluate('[...document.querySelectorAll("#enemyList option")].map(o => o.textContent)')
        assert any(n.startswith('Dog') for n in names), names
        assert any(n.startswith('Goon (purple suit)') for n in names) and any(n.startswith('Character 0x') for n in names)
        assert not any(n.startswith(('Event', 'Stage trigger')) for n in names), 'scripts hidden by default'
        basic = sum(n.startswith('Enemy #') for n in names); assert len(names) > basic + 20, (len(names), basic)
        ed.check('#showScripts')
        with_scripts = ed.evaluate('document.querySelectorAll("#enemyList option").length'); assert with_scripts > len(names)
        script = ed.evaluate('[...document.querySelectorAll("#enemyList option")].find(o => /^(Event|Stage trigger)/.test(o.textContent)).value')
        ed.select_option('#enemyList', script)
        assert ed.is_disabled('#enemyMove') and ed.is_disabled('#enemyDelete') and 'cannot be moved' in ed.inner_text('#enemyInfo')
        ed.uncheck('#showScripts')
        dog = ed.evaluate('[...document.querySelectorAll("#enemyList option")].find(o => o.textContent.startsWith("Dog")).value')
        ed.select_option('#enemyList', dog)
        assert not ed.is_disabled('#enemyMove') and 'Dog' in ed.inner_text('#enemyInfo')
        ed.fill('#enemyX', '400'); ed.fill('#enemyY', '160'); ed.click('#enemyMove'); ed.wait_for_timeout(400)
        rows = ed.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY)).enemies["1"]')
        moved = [r for r in rows if r['data'][7] == 3 and r.get('edited')]
        assert moved and (moved[0]['data'][0] << 8 | moved[0]['data'][1]) == 400 and moved[0]['data'][2] == 20, moved
        # sprites come from the ROM at runtime: dog and goon previews have real pixels
        for kid in (3, 0x25):
            dims = ed.evaluate('(id) => { const p = SIMPEDITOR_TEST.nativePreview(id); if (!p) return null; const d = p.canvas.getContext("2d").getImageData(0, 0, p.canvas.width, p.canvas.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return [p.canvas.width, p.canvas.height, n]; }', kid)
            assert dims and dims[0] > 15 and dims[1] > 15 and dims[2] > 150, (kid, dims)
        print(f'ok editor lists {len(names)} characters in the amusement park with ROM-rendered sprites, scripts read-only, dog moved')
        # street: place Principal Skinner (a native object) and duplicate the police-car event group
        ed.select_option('#scene', label='Stage 1 - street'); ed.click('#toolEnemies')
        assert ed.evaluate('[...document.querySelectorAll("#nativeKinds option")].some(o => o.textContent === "Principal Skinner")')
        ed.select_option('#enemyKind', 'native:41'); assert ed.is_visible('#enemyPreview')
        box = ed.locator('#map').bounding_box(); z = box['width'] / ed.evaluate('document.getElementById("map").width')
        ed.evaluate('document.getElementById("mapwrap").scrollLeft = 0')
        box = ed.locator('#map').bounding_box()
        ed.mouse.click(box['x'] + 120 * z, box['y'] + 200 * z); ed.wait_for_timeout(400)
        rows = ed.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY)).enemies["0"]')
        added = [r for r in rows if r['data'][7] == 41 and r.get('edited')]
        assert added and abs((added[0]['data'][0] << 8 | added[0]['data'][1]) - 120) <= 2, added
        ed.check('#showScripts')
        car = ed.evaluate('[...document.querySelectorAll("#enemyList option")].find(o => o.textContent.startsWith("Police car arrives")).value')
        ed.select_option('#enemyList', car); assert not ed.is_disabled('#eventDup')
        before = len(rows); ed.fill('#enemyX', '1400'); ed.click('#eventDup'); ed.wait_for_timeout(400)
        rows = ed.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY)).enemies["0"]')
        copies = [r for r in rows if r.get('edited') and (r['data'][0] << 8 | r['data'][1]) >= 1360]
        assert len(rows) > before + 1 and any(r['data'][7] == 0xe9 for r in copies), (before, len(rows))
        os.makedirs(os.path.join(ROOT, 'preview'), exist_ok=True)
        ed.uncheck('#showScripts'); ed.evaluate('document.getElementById("mapwrap").scrollLeft = 1450'); ed.wait_for_timeout(200)
        ed.screenshot(path=os.path.join(ROOT, 'preview/native_markers.png'))
        print(f'ok placed Principal Skinner and duplicated the police-car event group ({len(copies)} records)')
        with ctx.expect_page() as popup:
            ed.click('#play')
        game = popup.value; game.on('pageerror', lambda e: errors.append(str(e)))
        game.wait_for_url('**/index.html?scene=2&play=1'); game.evaluate('SIMPG.ready')
        assert game.evaluate('SIMPLAUNCH.playable(SIMPG.machine,SIMPSTAGE.SCENES[0])')
        assert not errors, errors
        print('ok the edited street (added Skinner, duplicated event) launches; no page errors')
        browser.close()
finally:
    server.shutdown()
