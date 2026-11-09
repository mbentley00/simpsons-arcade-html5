#!/usr/bin/env python3
"""Custom stages: build new stages in the editor without changing the original ones.
Springfield Elementary: create it, paint with its blocks, export, play it, and check the street is untouched.
Bowling Alley: its scripted events are listed, placed, moved and deleted in the editor, and fire in the game.
Old documents that put level art on an original stage are migrated to custom stages."""
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
BASE = f'http://127.0.0.1:{server.server_port}'
SHARE = '(() => { const b = SIMPG.video.bmp; let n = 0; for (let y = 16; y < 240; y++) for (let x = 0; x < 320; x++) { const p = b[y * 320 + x]; if (p >= 0x2000 && p < 0x2200) n++; } return n / (320 * 224); })()'
CAM = '(SIMPG.machine.ram[0x8ac] << 8) | SIMPG.machine.ram[0x8ad]'
def doc(page): return page.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY) || "null")')
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
        ed = ctx.new_page(); errors = []
        ed.on('pageerror', lambda e: errors.append(str(e)))
        ed.on('dialog', lambda d: d.accept())
        ed.goto(BASE + '/editor.html'); ed.evaluate('localStorage.clear()'); ed.reload()
        ed.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT, 'roms/simpsons.zip'))
        ed.wait_for_function('document.querySelectorAll("#scene option").length >= 13')
        # original stages keep their art: no level art choice there
        ed.select_option('#scene', label='Stage 1 - street'); assert ed.is_disabled('#tileset')
        assert ed.is_hidden('#stageDelete') and ed.is_disabled('#toolEvents')
        # + New stage... -> Springfield Elementary on the street's ground
        ed.select_option('#scene', 'new'); assert ed.is_visible('#newStage')
        labels = ed.evaluate('[...document.querySelectorAll("#nsTemplate option")].map(o => o.textContent)')
        assert any(l.startswith('Springfield Elementary') for l in labels) and any(l.startswith('Bowling Alley') for l in labels) and any(l.startswith('Copy of') for l in labels), labels
        ed.fill('#nsName', 'My School'); ed.select_option('#nsTemplate', index=next(i for i, l in enumerate(labels) if l.startswith('Springfield')))
        ed.click('#nsCreate'); ed.wait_for_timeout(300)
        assert ed.evaluate('document.getElementById("scene").value') == 'c:my-school'
        d = doc(ed); st = d['stages']['my-school']
        assert st['scene'] == 2 and st['tileset']['id'] == 'school' and len(st['tileset']['maps'][1]) == 448 and not d.get('bytes') and not d.get('tilesets'), 'a new stage, no ROM edits'
        assert 'Springfield Elementary' in ed.inner_text('#selinfo') and not ed.is_hidden('#stageDelete')
        os.makedirs(os.path.join(ROOT, 'preview'), exist_ok=True); ed.click('#l0'); ed.screenshot(path=os.path.join(ROOT, 'preview/school_editor.png')); ed.click('#l1')
        n_custom = ed.evaluate('SIMPTILESETS.school.layers[1].count')
        assert ed.evaluate('document.getElementById("pick").height') == -(-n_custom // 8) * 32, 'picker lists the custom blocks'
        # paint custom block #5 of the front layer at column 2, row 1; undo/redo
        pick = ed.locator('#pick').bounding_box(); k = pick['width'] / ed.evaluate('document.getElementById("pick").width')
        ed.mouse.click(pick['x'] + (5 % 8 * 32 + 16) * k, pick['y'] + (5 // 8 * 32 + 16) * k)
        box = ed.locator('#map').bounding_box(); z = box['width'] / ed.evaluate('document.getElementById("map").width')
        ed.mouse.click(box['x'] + (2 * 32 + 16) * z, box['y'] + (1 * 32 + 16) * z); ed.wait_for_timeout(400)
        assert doc(ed)['stages']['my-school']['tileset']['maps'][1][58] == 5, 'painting edits the custom map'
        ed.keyboard.press('Control+z'); ed.wait_for_timeout(400)
        assert doc(ed)['stages']['my-school']['tileset']['maps'][1][58] == ed.evaluate('SIMPTILESETS.school.layers[1].map[58]'), 'undo restores the cell'
        ed.keyboard.press('Control+y'); ed.wait_for_timeout(400)
        with ed.expect_download() as dl:
            ed.click('#exp')
        exported = json.load(open(dl.value.path()))
        assert exported['stages']['my-school']['tileset']['maps'][1][58] == 5
        # the street itself is unchanged
        ed.select_option('#scene', label='Stage 1 - street'); assert ed.evaluate('document.getElementById("pick").height') != -(-n_custom // 8) * 32
        ed.select_option('#scene', 'c:my-school')
        with ctx.expect_page() as popup:
            ed.click('#play')
        game = popup.value; game.on('pageerror', lambda e: errors.append(str(e)))
        game.wait_for_url('**/index.html?custom=my-school&play=1')
        game.evaluate('SIMPG.ready'); game.evaluate('SIMPG.pause(true)')
        assert game.evaluate('SIMPLAUNCH.playable(SIMPG.machine,SIMPSTAGE.SCENES[0])') and game.evaluate('SIMPMODS.custom.name') == 'My School'
        game.evaluate('SIMPG.video.render()'); share = game.evaluate(SHARE)
        assert share > 0.5, f'school art covers the stage ({share:.2f})'
        cam0 = game.evaluate(CAM)
        game.evaluate('SIMPG.pause(false)'); game.keyboard.down('ArrowRight'); game.wait_for_timeout(5000); game.keyboard.up('ArrowRight'); game.evaluate('SIMPG.pause(true)')
        cam1 = game.evaluate(CAM); assert cam1 > cam0 + 40, f'walking right scrolls the school level ({cam0} -> {cam1})'
        game.evaluate('SIMPG.video.render()'); game.screenshot(path=os.path.join(ROOT, 'preview/school_level.png')); game.close()
        print(f'ok New stage builds My School (Springfield Elementary), paints, exports and plays it ({share:.0%} custom pixels)')
        orig = ctx.new_page(); orig.on('pageerror', lambda e: errors.append(str(e)))
        orig.goto(BASE + '/index.html?scene=2&play=1'); orig.evaluate('SIMPG.ready'); orig.evaluate('SIMPG.pause(true)'); orig.evaluate('SIMPG.video.render()')
        assert orig.evaluate('SIMPMODS.custom') is None and orig.evaluate(SHARE) == 0, 'the original street shows its own art'
        orig.close(); print('ok the original Stage 1 street is untouched')
        # Bowling Alley: scripted events
        ed.select_option('#scene', 'new'); labels = ed.evaluate('[...document.querySelectorAll("#nsTemplate option")].map(o => o.textContent)')
        ed.select_option('#nsTemplate', index=next(i for i, l in enumerate(labels) if l.startswith('Bowling'))); ed.click('#nsCreate'); ed.wait_for_timeout(300)
        assert ed.evaluate('document.getElementById("scene").value') == 'c:bowling-alley'
        assert not ed.is_disabled('#toolEvents'); ed.click('#toolEvents'); assert ed.is_visible('#eventPanel')
        kinds = ed.evaluate('[...document.querySelectorAll("#eventType option")].map(o => o.textContent)')
        assert kinds == ['Runaway ball', 'Pin storm', 'Cosmic bowling', 'Ball-return frenzy'], kinds
        assert ed.evaluate('document.querySelectorAll("#eventList option").length') == 5, 'Bowling Alley starts with its events'
        ed.evaluate('document.getElementById("mapwrap").scrollLeft = 0'); box = ed.locator('#map').bounding_box()
        ed.select_option('#eventType', label='Runaway ball'); ed.mouse.click(box['x'] + 140 * z, box['y'] + 150 * z); ed.wait_for_timeout(300)
        evs = doc(ed)['stages']['bowling-alley']['events']; assert evs[0] == {'type': 'ball', 'x': 140}, evs
        ed.mouse.move(box['x'] + 140 * z, box['y'] + 150 * z); ed.mouse.down(); ed.mouse.move(box['x'] + 170 * z, box['y'] + 150 * z, steps=4); ed.mouse.up(); ed.wait_for_timeout(300)
        assert doc(ed)['stages']['bowling-alley']['events'][0]['x'] == 170, 'drag moves the event'
        ed.select_option('#eventType', label='Pin storm'); ed.mouse.click(box['x'] + 100 * z, box['y'] + 150 * z); ed.wait_for_timeout(300)
        ed.keyboard.press('Delete'); ed.wait_for_timeout(450); assert len(doc(ed)['stages']['bowling-alley']['events']) == 6, 'delete removes the selected event'
        ed.keyboard.press('Control+z'); ed.wait_for_timeout(450); assert len(doc(ed)['stages']['bowling-alley']['events']) == 7, 'undo brings it back'
        ed.screenshot(path=os.path.join(ROOT, 'preview/bowling_events_editor.png'))
        with ctx.expect_page() as popup:
            ed.click('#play')
        game = popup.value; game.on('pageerror', lambda e: errors.append(str(e)))
        game.wait_for_url('**/index.html?custom=bowling-alley&play=1'); game.evaluate('SIMPG.ready')
        game.keyboard.down('ArrowRight'); game.wait_for_function('SIMPG.machine.stageEvents && SIMPG.machine.stageEvents.fired.length >= 2', timeout=60000); game.keyboard.up('ArrowRight')
        game.wait_for_function('SIMPG.machine.stageEvents.live.some(e => e.t === "ball" && SIMPG.machine.frame - e.at > 50)', timeout=20000)
        game.evaluate('SIMPG.pause(true)'); game.wait_for_timeout(200)
        drawn = game.evaluate('(() => { const a = SIMPG.pixels(), c = SIMPG.screenPixels(); let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) n++; return n; })()')
        assert drawn > 200, f'the pins and the runaway ball are drawn into the picture ({drawn} px)'
        game.screenshot(path=os.path.join(ROOT, 'preview/bowling_events.png')); game.close()
        print(f'ok Bowling Alley events: listed, placed, dragged, deleted/undone in the editor; pin storm and runaway ball fire in play ({drawn} px drawn)')
        # delete a custom stage
        ed.click('#toolBlocks'); ed.select_option('#scene', 'c:my-school'); ed.click('#stageDelete'); ed.wait_for_timeout(300)
        assert 'my-school' not in doc(ed)['stages'] and ed.evaluate('document.getElementById("scene").value') == '0'
        # migration of the old format (level art on the original Stage 1)
        ed.evaluate('localStorage.setItem(SIMPSTAGE.PATCH_KEY, JSON.stringify({ v: 1, bytes: {}, tilesets: { 2: { id: "school", maps: SIMPTILES.defaults(SIMPTILES.sets.school) } } }))')
        ed.reload(); ed.wait_for_function('document.querySelectorAll("#scene option").length >= 13')
        d = doc(ed); assert not d.get('tilesets') and d['stages']['springfield-elementary']['scene'] == 2, d.keys()
        assert 'custom stage' in ed.inner_text('#msg')
        assert not errors, errors
        print('ok deleting a custom stage; old level-art documents become custom stages; no page errors')
        browser.close()
finally:
    server.shutdown()
