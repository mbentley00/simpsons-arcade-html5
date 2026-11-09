#!/usr/bin/env python3
"""Stage editor page check (needs roms/simpsons.zip). Serves web/, opens editor.html in headless Chromium, feeds the zip
through the ROM picker, paints one block in stage 2's front layer and checks the saved edit, then opens
index.html?scene=4&pause=1 in the same browser profile and checks that the game's prog.bin carries the edit and that
coin + Start lands in scene 4 (stage value 0x84) instead of stage 1. Screenshots go to preview/.
    python test/test_stage_editor.py"""
import os, sys, threading, functools, http.server, json
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); os.chdir(ROOT)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory='web')); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.makedirs('preview', exist_ok=True)
errs, fails = [], []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 800})
    ctx.add_init_script('''localStorage.setItem('simpsons.editor.prefs', JSON.stringify({scene: 0.5, area: -1, layer: 99, zoom: 0, sel: -3}));''')
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text + ' ' + str(m.location.get('url')))); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{port}/editor.html')
    pg.locator('#romload input[type=file]').set_input_files('roms/simpsons.zip')
    pg.wait_for_function('document.getElementById("scene").options.length > 0', timeout=60000)
    names = pg.evaluate(r'[...document.getElementById("scene").options].filter(o => /^\d+$/.test(o.value)).map(o => o.textContent)')
    check(len(names) == 12, f'{len(names)} stages listed')
    pg.select_option('#scene', label='Stage 2 - amusement park')
    pg.wait_for_timeout(300)
    size = pg.evaluate('[map.width, map.height]')
    check(size == [9 * 256, 256], f'stage 2 map is {size[0]}x{size[1]}')
    pg.screenshot(path='preview/editor_stage2.png')
    # pick block 5 in the picker, paint front layer screen 0 / column 2 / row 1
    pg.click('#l1')
    pg.evaluate('''(() => { const c = document.getElementById("pick"), r = c.getBoundingClientRect(), k = r.width / c.width;
        c.dispatchEvent(new MouseEvent("click", { clientX: r.left + (5 * 32 + 16) * k, clientY: r.top + 16 * k, bubbles: true })); })()''')
    check('#5' in pg.inner_text('#selinfo'), 'block 5 selected')
    box = pg.locator('#map').bounding_box(); z = pg.evaluate('JSON.parse(localStorage.getItem("simpsons.editor.prefs")).zoom')
    pg.mouse.click(box['x'] + (2 * 32 + 16) * z, box['y'] + (1 * 32 + 16) * z)
    pg.wait_for_timeout(400)
    patch = pg.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY) || "null")')
    check(bool(patch and patch['bytes']), f'edit saved ({len(patch["bytes"]) if patch else 0} bytes)')
    hover_ok = pg.evaluate('''(() => { const m = document.getElementById("map"), r = m.getBoundingClientRect(), z = %d;
        m.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + (2 * 32 + 16) * z, clientY: r.top + (32 + 16) * z, bubbles: true }));
        return document.getElementById("hover").textContent; })()''' % z)
    check('block #5' in hover_ok and 'edited' in hover_ok, 'hover shows the edited block: ' + hover_ok.strip())
    pg.click('#undo'); pg.wait_for_timeout(400)
    check(pg.evaluate('localStorage.getItem(SIMPSTAGE.PATCH_KEY)') is None, 'undo removes the edit')
    pg.click('#redo'); pg.wait_for_timeout(400)
    patch = pg.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY) || "null")')
    check(bool(patch and patch['bytes']), 'redo restores the edit')
    pg.locator('#impf').set_input_files({'name': 'invalid.json', 'mimeType': 'application/json',
        'buffer': json.dumps({'format': 'simpsons-stage-edits', 'v': 1, 'bytes': {'4': 'oops'}}).encode()})
    pg.wait_for_function('document.getElementById("msg").textContent.startsWith("Import failed:")')
    check(pg.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY))') == patch, 'invalid import preserves saved edits')
    pg.screenshot(path='preview/editor_painted.png')
    # game page, same profile: ROM comes from IndexedDB, edits from localStorage
    g = ctx.new_page()
    g.on('console', lambda m: m.type == 'error' and errs.append(m.text + ' ' + str(m.location.get('url')))); g.on('pageerror', lambda e: errs.append(str(e)))
    g.goto(f'http://127.0.0.1:{port}/index.html?scene=4&pause=1')
    g.evaluate('SIMPG.ready')
    for action in ['host()', 'join("ABCD")']:
        rejection = g.evaluate('async () => { try { await SSRNETPLAY.%s; return "allowed"; } catch (e) { return e.message; } }' % action)
        check('mods=0' in rejection, action + ' rejects local modifications before connecting')
    # coin at 900, start at 1020 (as test/input/coin_start_walk.txt), then let the stage load
    # inputs go through web/input.js (keyboard), which overwrites board.inputs every frame
    def run_to(f): g.evaluate('(f => { while (SIMPG.frame < f) SIMPG.run(1); })(%d)' % f)
    def tap(key): g.keyboard.down(key); g.evaluate('SIMPG.run(6)'); g.keyboard.up(key)
    g.bring_to_front(); g.mouse.click(5, 5)  # give the game page keyboard focus
    run_to(900); tap('5'); run_to(1020); tap('1'); run_to(2300)
    applied = g.evaluate('(b => Object.entries(b).every(([k, v]) => SIMPG.machine.prog[+k] === v))(%s)' % json.dumps(patch['bytes']))
    check(applied and g.evaluate('SIMPMODS.active') == len(patch['bytes']), 'game prog.bin carries the edit')
    sc, stv = g.evaluate('[SIMPG.machine.ram[0x803], SIMPG.machine.ram[0x875]]')
    check(sc == 4 and stv == 0x84, f'?scene=4 started scene {sc}, stage value {stv:#x}')
    g.screenshot(path='preview/editor_warp_scene4.png')
    b.close()
errs = [e for e in errs if 'assets/' not in e]  # romload probes the optional assets/ folder first
check(not errs, 'no console errors' + ('' if not errs else ': ' + ' | '.join(errs[:5])))
sys.exit(1 if fails else 0)
