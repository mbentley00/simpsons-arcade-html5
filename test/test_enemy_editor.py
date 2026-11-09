#!/usr/bin/env python3
"""Enemy editor integration: placement, movement, deletion, history, persistence, export/import and stage scoping."""
import functools
import http.server
import json
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
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1400, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/editor.html')
        page.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT, 'roms/simpsons.zip'))
        page.wait_for_function('document.getElementById("scene").options.length === 12')
        page.click('#toolEnemies')
        assert page.locator('#enemyKind').input_value() == 'rivet'
        assert page.locator('#enemyPreview').get_attribute('aria-label') == 'Rivet enemy preview'
        page.select_option('#enemyKind', 'duffman')
        assert page.locator('#enemyPanel').is_visible()
        assert page.locator('#enemyList option').count() == 24
        box = page.locator('#map').bounding_box()
        zoom = page.evaluate('document.getElementById("map").getBoundingClientRect().width / document.getElementById("map").width')
        page.mouse.click(box['x'] + 240 * zoom, box['y'] + 192 * zoom)
        page.wait_for_function('!!JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY))?.enemies[0]')
        def duff():
            return page.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY)).enemies[0].find(r => r.skin === "duffman")')
        assert duff()['data'][:3] == [0, 240, 24]
        assert page.locator('#enemyList option').count() == 25
        print('ok lists original enemies and adds Duffman at the clicked map position')
        page.fill('#enemyX', '272'); page.fill('#enemyY', '184'); page.click('#enemyMove')
        page.wait_for_timeout(300); assert duff()['data'][:3] == [1, 16, 23]
        page.click('#undo'); page.wait_for_timeout(300); assert duff()['data'][:3] == [0, 240, 24]
        page.click('#redo'); page.wait_for_timeout(300); assert duff()['data'][:3] == [1, 16, 23]
        print('ok numeric movement and undo/redo')
        page.select_option('#enemyList', index=24)
        page.click('#enemyDelete'); page.wait_for_timeout(300)
        assert page.evaluate('localStorage.getItem(SIMPSTAGE.PATCH_KEY)') is None
        page.click('#undo'); page.wait_for_timeout(300); assert duff()
        page.select_option('#enemyList', index=24)
        box = page.locator('#map').bounding_box()
        page.mouse.move(box['x'] + 272 * zoom, box['y'] + 184 * zoom)
        page.mouse.down(); page.mouse.move(box['x'] + 296 * zoom, box['y'] + 208 * zoom, steps=4); page.mouse.up()
        page.wait_for_timeout(300); assert duff()['data'][:3] == [1, 40, 26]
        page.click('#undo'); page.wait_for_timeout(300); assert duff()['data'][:3] == [1, 16, 23]
        print('ok dragging a marker moves the spawn and can be undone')
        page.select_option('#scene', label='Stage 2 - amusement park')
        assert 'Duffman' not in page.locator('#enemyList').inner_text()
        page.select_option('#scene', label='Stage 1 - street')
        assert 'Duffman' in page.locator('#enemyList').inner_text()
        print('ok deletion is undoable and enemy edits stay in their stage')
        page.select_option('#scene', label='Bonus round 1')
        assert not page.locator('#toolEnemies').is_enabled()
        page.select_option('#scene', label='Stage 1 - street'); page.click('#toolEnemies')
        assert page.locator('#toolEnemies').is_enabled()
        with page.expect_download() as download:
            page.click('#exp')
        exported = json.loads(open(download.value.path(), encoding='utf-8').read())
        assert exported['enemies']['0'][-1]['skin'] == 'duffman'
        page.reload(); page.wait_for_function('document.getElementById("scene").options.length === 12')
        page.click('#toolEnemies'); assert 'Duffman' in page.locator('#enemyList').inner_text()
        page.locator('#impf').set_input_files({'name': 'edits.json', 'mimeType': 'application/json', 'buffer': json.dumps(exported).encode()})
        page.wait_for_function('document.getElementById("msg").textContent.startsWith("Imported")')
        assert duff()['data'][:3] == [1, 16, 23]
        page.select_option('#enemyKind','rivet')
        box = page.locator('#map').bounding_box()
        page.mouse.click(box['x']+200*zoom,box['y']+216*zoom)
        page.wait_for_timeout(300)
        assert page.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY)).enemies[0].some(r=>r.skin==="rivet")')
        assert 'Rivet' in page.locator('#enemyList').inner_text()
        assert page.locator('#enemyPreview').get_attribute('aria-label') == 'Rivet enemy preview'
        with page.expect_download() as mixed_download:
            page.click('#exp')
        mixed = json.loads(open(mixed_download.value.path(),encoding='utf-8').read())
        assert {r.get('skin') for r in mixed['enemies']['0']} >= {'rivet','duffman'}
        page.locator('#impf').set_input_files({'name':'mixed.json','mimeType':'application/json','buffer':json.dumps(mixed).encode()})
        page.wait_for_function('document.getElementById("msg").textContent.startsWith("Imported")')
        page.reload(); page.wait_for_function('document.getElementById("scene").options.length === 12'); page.click('#toolEnemies')
        assert 'Rivet' in page.locator('#enemyList').inner_text() and 'Duffman' in page.locator('#enemyList').inner_text()
        bad = dict(exported); bad['enemies'] = {'0': [{'data': [0, 0]}]}
        page.locator('#impf').set_input_files({'name': 'bad.json', 'mimeType': 'application/json', 'buffer': json.dumps(bad).encode()})
        page.wait_for_function('document.getElementById("msg").textContent.startsWith("Import failed")')
        assert duff()['data'][:3] == [1, 16, 23]
        os.makedirs(os.path.join(ROOT, 'preview'), exist_ok=True)
        page.screenshot(path=os.path.join(ROOT, 'preview/editor_enemies.png'))
        assert not errors, errors
        print('ok export/import, reload persistence, malformed import rejection, Rivet placement/preview, and no page errors')
        browser.close()
finally:
    server.shutdown()
