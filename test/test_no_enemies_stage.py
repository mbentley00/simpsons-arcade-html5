#!/usr/bin/env python3
"""New stage without the original enemies: the New stage dialog option, an empty enemy list, the Enemies-panel toggle,
a placed enemy, and play with no original goons on screen (uses the player's local ROM)."""
import functools, http.server, json, os, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=os.path.join(ROOT, 'web')))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}'
def doc(page): return page.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY) || "null")')
# step the paused game n frames, Marge walking right with full health; count visible original goons and placed enemies
STEP = '''async (n) => { const m = SIMPG.machine, r = m.ram; let visible = 0, placed = 0;
  SIMPI.script = f => new Uint8Array([2 | (f % 12 < 3 ? 16 : 0), 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    let t = 0; while (SIMPCOMBAT.blocked && t++ < 50) await new Promise(res => setTimeout(res, 20));
    r[0xa5b] = 40; SIMPG.run(1);
    for (let o = 0xf80; o < 0x1280; o += 0x60) if ((r[o] & 0x40) && r[o + 0x1b]) {
      if (m.stageEnemySkins[o]) placed++; else if (!(m.stageGhosts || {})[o] && r[o + 0x1b] < 100) visible++;
    }
  }
  SIMPI.script = () => new Uint8Array(4); return { visible, placed, held: m.stageEnemiesHeld || 0 }; }'''
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(); ctx = browser.new_context(viewport={'width': 1400, 'height': 900}); errors = []
        ed = ctx.new_page(); ed.on('pageerror', lambda e: errors.append(str(e))); ed.on('dialog', lambda d: d.accept())
        ed.goto(BASE + '/editor.html'); ed.evaluate('localStorage.clear()'); ed.reload()
        ed.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT, 'roms/simpsons.zip'))
        ed.wait_for_function('document.querySelectorAll("#scene option").length >= 13')
        ed.select_option('#scene', 'new'); assert ed.is_visible('#nsNoEnemies') and not ed.is_checked('#nsNoEnemies')
        labels = ed.evaluate('[...document.querySelectorAll("#nsTemplate option")].map(o => o.textContent)')
        ed.fill('#nsName', 'Empty Street'); ed.select_option('#nsTemplate', index=labels.index('Copy of Stage 1 - street'))
        ed.check('#nsNoEnemies'); ed.click('#nsCreate'); ed.wait_for_timeout(300)
        st = doc(ed)['stages']['empty-street']
        assert st['noEnemies'] is True, st.keys()
        kinds = ed.evaluate('(rows) => rows.map(r => SIMPENEMY.kind(r))', st['enemies'])
        assert 'enemy' not in kinds and 'script' in kinds, 'plain enemies removed; scripts and props kept'
        print(f'ok New stage option: no plain enemy records ({len(kinds)} scripts/characters kept)')
        # the Enemies panel shows the toggle (checked); original goon characters are listed as off
        ed.click('#toolEnemies'); assert ed.is_visible('#noEnemiesRow') and ed.is_checked('#noEnemies')
        listed = ed.evaluate('[...document.querySelectorAll("#enemyList option")].map(o => o.textContent)')
        assert any('(off)' in t for t in listed), listed
        ed.uncheck('#noEnemies'); assert 'noEnemies' not in doc(ed)['stages']['empty-street']
        ed.check('#noEnemies'); assert doc(ed)['stages']['empty-street']['noEnemies'] is True
        print('ok Enemies panel toggle saves the option; held-back goons are marked (off)')
        # place a Duffman near the start
        ed.select_option('#enemyKind', 'duffman')
        box = ed.locator('#map').bounding_box(); z = box['width'] / ed.evaluate('document.getElementById("map").width')
        ed.mouse.click(box['x'] + 150 * z, box['y'] + 232 * z); ed.wait_for_timeout(200)
        ed.wait_for_function('SIMPEDITOR_TEST.stages["empty-street"].enemies.some(r => r.skin === "duffman")', timeout=3000); ed.wait_for_timeout(1200)
        assert any(r.get('skin') == 'duffman' for r in doc(ed)['stages']['empty-street']['enemies']), 'saved'
        with ctx.expect_page() as pop: ed.click('#play')
        g = pop.value; g.on('pageerror', lambda e: errors.append(str(e)))
        g.wait_for_url('**/index.html?*custom=empty-street*'); g.wait_for_function('window.SIMPG'); g.evaluate('SIMPG.ready')
        g.wait_for_function('SIMPG.machine && SIMPG.machine.ram[0x800]===2 && SIMPG.machine.ram[0x802]===1', timeout=90000)
        g.evaluate('SIMPG.pause(true)')
        res = g.evaluate(STEP, 1500)
        assert res['visible'] == 0, res
        assert res['placed'] > 0 and res['held'] > 0, res
        os.makedirs(os.path.join(ROOT, 'preview'), exist_ok=True); g.locator('#screen').screenshot(path=os.path.join(ROOT, 'preview/no_enemies_stage.png'))
        print(f'ok played without the original goons ({res["held"]} held back), the placed Duffman fights')
        assert not errors, errors
        print('ok no page errors')
        browser.close()
finally:
    server.shutdown()
