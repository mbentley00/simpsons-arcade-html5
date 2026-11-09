#!/usr/bin/env python3
"""Events from a description, in the editor and in play.
Without an API key the built-in reader makes the event; with a key the editor asks Claude (the API is mocked here, the
SDK is loaded from the CDN) and the returned recipe is placed. A selected described event can be remade from an edited
description. The events work in a custom stage without level art and fire in the game."""
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
def doc(page): return page.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY) || "null")')
def events(page): return doc(page)['stages']['lanes']['events']
CLAUDE_RECIPE = {'name': 'Duff stampede', 'banner': 'DUFF STAMPEDE!', 'color': 'red', 'summary': 'Cans roll in from both sides; the screen shakes.',
                 'actions': [{'kind': 'projectile', 'delay': 0, 'duration': 2, 'object': 'can', 'from': 'both', 'target': 'everyone', 'effect': 'knockdown',
                              'damage': 5, 'count': 4, 'speed': 'fast', 'size': 'large', 'tint': 'none', 'amount': 0, 'text': ''},
                             {'kind': 'shake', 'delay': 0, 'duration': 2, 'object': 'ball', 'from': 'left', 'target': 'everyone', 'effect': 'flinch',
                              'damage': 0, 'count': 1, 'speed': 'slow', 'size': 'small', 'tint': 'none', 'amount': 3, 'text': ''}]}
CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS'}
requests = []
def claude(route):
    if route.request.method == 'OPTIONS': route.fulfill(status=204, headers=CORS); return
    requests.append({'body': json.loads(route.request.post_data), 'headers': route.request.headers})
    msg = {'id': 'msg_test', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'content': [{'type': 'text', 'text': json.dumps(CLAUDE_RECIPE)}],
           'stop_reason': 'end_turn', 'stop_sequence': None, 'usage': {'input_tokens': 10, 'output_tokens': 10}}
    route.fulfill(status=200, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps(msg))
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1400, 'height': 900})
        ctx.route('https://api.anthropic.com/**', claude)
        ed = ctx.new_page(); errors = []
        ed.on('pageerror', lambda e: errors.append(str(e)))
        ed.on('dialog', lambda d: d.accept())
        ed.goto(BASE + '/editor.html'); ed.evaluate('localStorage.clear()'); ed.reload()
        ed.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT, 'roms/simpsons.zip'))
        ed.wait_for_function('document.querySelectorAll("#scene option").length >= 13')
        # a copy of Stage 2: no level art, original ground
        ed.select_option('#scene', 'new'); labels = ed.evaluate('[...document.querySelectorAll("#nsTemplate option")].map(o => o.textContent)')
        ed.fill('#nsName', 'Lanes'); ed.select_option('#nsTemplate', index=next(i for i, l in enumerate(labels) if l.startswith('Copy of Stage 2')))
        ed.click('#nsCreate'); ed.wait_for_timeout(300)
        assert ed.evaluate('document.getElementById("scene").value') == 'c:lanes'
        assert not ed.is_disabled('#toolEvents'), 'described events work in stages without level art'
        ed.click('#toolEvents'); assert ed.is_visible('#aiPrompt')
        # 1. built-in reader (no key)
        ed.fill('#aiPrompt', 'Giant donuts rain from the sky for 8 seconds and the lights go out'); ed.click('#aiMake'); ed.wait_for_timeout(450)
        evs = events(ed); assert len(evs) == 1 and evs[0]['type'] == 'custom', evs
        kinds = [a['kind'] for a in evs[0]['recipe']['actions']]; assert kinds == ['rain', 'tint'] and evs[0]['recipe']['actions'][0]['object'] == 'donut', kinds
        assert 'donut' in ed.inner_text('#aiResult') and requests == []
        ed.fill('#eventX', '120'); ed.click('#eventMove'); ed.wait_for_timeout(450); assert events(ed)[0]['x'] == 120
        print('ok without a key the built-in reader made', evs[0]['recipe']['name'], kinds)
        # 2. Claude (mocked API): deselect so a new event is made
        ed.evaluate('document.getElementById("aiKeyBox").open = true'); ed.fill('#aiKey', 'sk-ant-api03-test'); ed.dispatch_event('#aiKey', 'change')
        ed.keyboard.press('Escape'); ed.evaluate('document.getElementById("eventList").value = ""')
        ed.click('#toolEvents')  # resets the selection
        ed.fill('#aiPrompt', 'A stampede of Duff cans charges in from both sides and the ground shakes'); ed.click('#aiMake')
        ed.wait_for_function('document.querySelectorAll("#eventList option").length === 2', timeout=30000); ed.wait_for_timeout(450)
        assert len(requests) == 1, requests
        body = requests[0]['body']; h = requests[0]['headers']
        assert body['model'] == 'claude-opus-5-5' and body['output_config']['format']['type'] == 'json_schema' and 'building blocks' not in body['messages'][0]['content'], body
        assert body['messages'][0]['content'].startswith('A stampede of Duff cans') and body['system'] and body.get('fallbacks') == 'default', body.keys()
        assert h.get('authorization') == 'Bearer sk-ant-api03-test' and 'server-side-fallback-2026-07-01' in h.get('anthropic-beta', ''), h
        evs = events(ed); duff = next(e for e in evs if e['recipe']['name'] == 'Duff stampede')
        assert [a['kind'] for a in duff['recipe']['actions']] == ['projectile', 'shake'] and duff['prompt'].startswith('A stampede')
        assert ed.evaluate('localStorage.getItem("simpsons.claudeKey")') == 'sk-ant-api03-test'
        assert '✨ Duff stampede' in ed.evaluate('[...document.querySelectorAll("#eventType option")].map(o => o.textContent)')
        i = evs.index(duff); ed.select_option('#eventList', str(i)); ed.fill('#eventX', '150'); ed.click('#eventMove'); ed.wait_for_timeout(450)
        print('ok with a key the editor asked Claude (model, JSON schema, fallbacks, key header) and placed', duff['recipe']['name'])
        # 3. remake the selected described event from an edited description (built-in reader: key removed)
        ed.fill('#aiKey', ''); ed.dispatch_event('#aiKey', 'change')
        sel = next(i for i, e in enumerate(events(ed)) if e['x'] == 120); ed.select_option('#eventList', str(sel)); ed.wait_for_timeout(100)
        assert ed.input_value('#aiPrompt').startswith('Giant donuts') and ed.inner_text('#aiMake') == 'Remake selected event'
        ed.fill('#aiPrompt', 'Giant boulders rain from the sky for 6 seconds'); ed.click('#aiMake'); ed.wait_for_timeout(450)
        evs = events(ed); assert len(evs) == 2 and evs[0]['x'] == 120 and evs[0]['recipe']['actions'][0]['object'] == 'rock' and len(requests) == 1, evs[0]
        ed.keyboard.press('Control+z'); ed.wait_for_timeout(450); assert events(ed)[0]['recipe']['actions'][0]['object'] == 'donut', 'undo restores the old recipe'
        ed.keyboard.press('Control+y'); ed.wait_for_timeout(450)
        os.makedirs(os.path.join(ROOT, 'preview'), exist_ok=True); ed.screenshot(path=os.path.join(ROOT, 'preview/described_events_editor.png'))
        print('ok remaking the selected event replaces its recipe at the same X; undo/redo work')
        # 4. play: the events fire on Stage 2's original ground
        with ctx.expect_page() as popup:
            ed.click('#play')
        game = popup.value; game.on('pageerror', lambda e: errors.append(str(e)))
        game.wait_for_url('**/index.html?custom=lanes&play=1'); game.evaluate('SIMPG.ready')
        game.keyboard.down('ArrowRight')
        game.wait_for_function('SIMPG.machine.stageEvents && SIMPG.machine.stageEvents.live.some(e => e.t === "recipe" && SIMPG.machine.frame - e.at > 40)', timeout=60000)
        game.keyboard.up('ArrowRight'); game.evaluate('SIMPG.pause(true)'); game.wait_for_timeout(200)
        drawn = game.evaluate('(() => { const a = SIMPG.pixels(), c = SIMPG.screenPixels(); let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) n++; return n; })()')
        assert drawn > 200, f'the described event is drawn into the picture ({drawn} px)'
        game.screenshot(path=os.path.join(ROOT, 'preview/described_events.png')); game.close()
        print(f'ok described events fire in play on the copy of Stage 2 ({drawn} px drawn)')
        assert not errors, errors
        browser.close()
finally:
    server.shutdown()
