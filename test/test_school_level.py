#!/usr/bin/env python3
"""Springfield Elementary level: build it in the editor, paint with its blocks, play it, and restore the original."""
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
        ctx = browser.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
        ed = ctx.new_page(); errors = []
        ed.on('pageerror', lambda e: errors.append(str(e)))
        ed.on('dialog', lambda d: d.accept())
        ed.goto(f'http://127.0.0.1:{server.server_port}/editor.html')
        ed.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT, 'roms/simpsons.zip'))
        ed.wait_for_function('document.getElementById("scene").options.length === 12')
        ed.select_option('#scene', label='Stage 1 - street')
        assert not ed.is_disabled('#tileset')
        ed.select_option('#tileset', 'school')
        ed.wait_for_function('document.getElementById("scene").options[0].textContent.startsWith("Springfield Elementary")')
        doc = ed.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY))')
        assert doc['tilesets']['2']['id'] == 'school' and len(doc['tilesets']['2']['maps'][1]) == 448, 'level saved with its custom maps'
        assert not doc.get('bytes'), 'the stage ROM maps (and collision) are not edited'
        assert 'Springfield Elementary' in ed.inner_text('#selinfo')
        os.makedirs(os.path.join(ROOT, 'preview'), exist_ok=True); ed.click('#l0'); ed.screenshot(path=os.path.join(ROOT, 'preview/school_editor.png')); ed.click('#l1')
        n_custom = ed.evaluate('SIMPTILESETS.school.layers[1].count')
        assert ed.evaluate('document.getElementById("pick").height') == -(-n_custom // 8) * 32, 'picker lists the custom blocks'
        # other stages have no school art
        ed.select_option('#scene', index=2); assert ed.is_disabled('#tileset'); ed.select_option('#scene', index=0)
        # paint custom block #5 of the front layer at column 2, row 1
        ed.click('#l1')
        pick = ed.locator('#pick').bounding_box(); k = pick['width'] / ed.evaluate('document.getElementById("pick").width')
        ed.mouse.click(pick['x'] + (5 % 8 * 32 + 16) * k, pick['y'] + (5 // 8 * 32 + 16) * k)
        box = ed.locator('#map').bounding_box(); z = box['width'] / ed.evaluate('document.getElementById("map").width')
        ed.mouse.click(box['x'] + (2 * 32 + 16) * z, box['y'] + (1 * 32 + 16) * z)
        ed.wait_for_timeout(400)
        assert 'block <b>#5</b>' in ed.inner_html('#selinfo')
        doc = ed.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY))')
        assert doc['tilesets']['2']['maps'][1][1 * 56 + 2] == 5, 'painting edits the custom map'
        ed.keyboard.press('Control+z'); ed.wait_for_timeout(400)
        assert ed.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY)).tilesets["2"].maps[1][58]') == ed.evaluate('SIMPTILESETS.school.layers[1].map[58]'), 'undo restores the cell'
        ed.keyboard.press('Control+y'); ed.wait_for_timeout(400)
        with ed.expect_download() as dl:
            ed.click('#exp')
        exported = json.load(open(dl.value.path()))
        assert exported['tilesets']['2']['id'] == 'school' and exported['tilesets']['2']['maps'][1][58] == 5
        with ctx.expect_page() as popup:
            ed.click('#play')
        game = popup.value; game.on('pageerror', lambda e: errors.append(str(e)))
        game.wait_for_url('**/index.html?scene=2&play=1')
        game.evaluate('SIMPG.ready'); game.evaluate('SIMPG.pause(true)')
        assert game.evaluate('SIMPLAUNCH.playable(SIMPG.machine,SIMPSTAGE.SCENES[0])')
        game.evaluate('SIMPG.video.render()')
        share = game.evaluate('(() => { const b = SIMPG.video.bmp; let n = 0; for (let y = 16; y < 240; y++) for (let x = 0; x < 320; x++) { const p = b[y * 320 + x]; if (p >= 0x2000 && p < 0x2200) n++; } return n / (320 * 224); })()')
        assert share > 0.5, f'school art covers the stage ({share:.2f})'
        # the player can walk: Stage 1's collision is untouched
        cam0 = game.evaluate('(SIMPG.machine.ram[0x8ac] << 8) | SIMPG.machine.ram[0x8ad]')
        game.evaluate('SIMPG.pause(false)'); game.focus('#screen') if game.locator('#screen').count() else None
        game.keyboard.down('ArrowRight'); game.wait_for_timeout(5000); game.keyboard.up('ArrowRight'); game.evaluate('SIMPG.pause(true)')
        cam1 = game.evaluate('(SIMPG.machine.ram[0x8ac] << 8) | SIMPG.machine.ram[0x8ad]')
        assert cam1 > cam0 + 40, f'walking right scrolls the school level ({cam0} -> {cam1})'
        game.evaluate('SIMPG.video.render()')
        os.makedirs(os.path.join(ROOT, 'preview'), exist_ok=True)
        game.screenshot(path=os.path.join(ROOT, 'preview/school_level.png'))
        game.close()
        print(f'ok editor builds Springfield Elementary, paints custom blocks, exports, and plays it ({share:.0%} custom pixels)')
        # back to the original street
        ed.select_option('#tileset', '')
        ed.wait_for_function('document.getElementById("scene").options[0].textContent === "Stage 1 - street"')
        doc = ed.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY) || "null")')
        assert doc is None or (not doc.get('tilesets') and not doc.get('bytes')), doc
        game = ctx.new_page(); game.on('pageerror', lambda e: errors.append(str(e)))
        game.goto(f'http://127.0.0.1:{server.server_port}/index.html?pause=1'); game.evaluate('SIMPG.ready')
        assert game.evaluate('Object.keys(SIMPMODS.tilesets).length') == 0
        assert not errors, errors
        print('ok restoring the original removes the level and its map edits; no page errors')
        browser.close()
finally:
    server.shutdown()
