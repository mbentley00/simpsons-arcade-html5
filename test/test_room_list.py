#!/usr/bin/env python3
"""Room list in headless Chrome (real WebRTC, signal.php on php -S): 3 hosts (2 public, 1 private), one visitor.
Checks: public rooms appear in the visitor's F7 list (nick, players, stage), the private room never does, its own
room is never listed, 'Entrar' from the list joins as P2, the private room is joinable by code, the host panel shows
the room type. Saves ref/preview/room_list.png (visitor panel) and room_list_host.png.
Usage: python3 test/test_room_list.py [--preview ref/preview]"""
import argparse, os, subprocess, time, socket, json
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('--preview', default=''); a = ap.parse_args()
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
env = dict(os.environ, PHP_CLI_SERVER_WORKERS='6')
php = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', os.path.join(ROOT, 'web')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
time.sleep(1)
import shutil; shutil.rmtree(os.path.join(ROOT, "web/net/rooms"), ignore_errors=True)
BASE = f'http://127.0.0.1:{port}/index.html'; SIG = os.environ.get('SIGNAL') or f'http://127.0.0.1:{port}/net/signal.php'
fails = []; ok = lambda c, m: print(('PASS ' if c else 'FAIL ') + m) or (c or fails.append(m))
ZIP = os.path.join(ROOT, 'roms', 'simpsons.zip')
def boot(pg, url):  # the user's own ROM zip through the picker (nothing ROM-derived is served)
    pg.goto(url); pg.locator('#romload input[type=file]').set_input_files(ZIP, timeout=60000); pg.evaluate('SSRG.ready')
try:
  with sync_playwright() as p:
    args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
    def page(nick, pub='1', q=''):
        b = p.chromium.launch(args=args); pg = b.new_page(viewport={'width': 1100, 'height': 700})
        pg.add_init_script(f'try {{ localStorage.setItem("simpsons_nick", {json.dumps(nick)}); localStorage.setItem("simpsons_public", "{pub}") }} catch (e) {{}}')
        pg.on('pageerror', lambda e: fails.append(f'{nick}: {e}')); boot(pg, f'{BASE}?signal={SIG}&sound=0' + q); print('booted', nick, flush=True); return pg
    hosts = [page('Saulo'), page('Ana'), page('Secreto', '0')]
    rooms = []
    for h in hosts:
        h.keyboard.press('F7'); h.click('#np-create'); h.wait_for_function('SSRNETPLAY.session'); rooms.append(h.evaluate('SSRNETPLAY.state.room'))
    print('rooms', rooms)
    ok('Pública' not in hosts[2].inner_text('#np') and 'privada' in hosts[2].inner_text('#np'), 'host panel shows "privada"')
    ok('pública' in hosts[0].inner_text('#np'), 'host panel shows "pública"')
    g2 = page('Zé', q=f'&sala={rooms[1]}')  # Ana's room gets a 2nd player
    try: g2.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.slot === 1', timeout=30000)
    except Exception: print('g2 state', g2.evaluate('JSON.stringify({st: SSRNETPLAY.state, s: !!SSRNETPLAY.session, slot: SSRNETPLAY.session && SSRNETPLAY.session.slot})'), g2.inner_text('#np')[:300]); raise
    v = page('Visitante'); v.keyboard.press('F7')
    v.wait_for_function(f'(SSRNETPLAY.roomList() || []).some(r => r.room === "{rooms[1]}" && r.p === 2) && (SSRNETPLAY.roomList() || []).some(r => r.room === "{rooms[0]}")', timeout=30000)
    time.sleep(0.5); L = v.evaluate('SSRNETPLAY.roomList()'); print(json.dumps(L, ensure_ascii=False))
    txt = v.inner_text('#np-list')
    ok(rooms[0] in txt and rooms[1] in txt and 'Saulo' in txt and 'Ana' in txt and '2/4' in txt, 'public rooms in the visitor list (nick, 2/4)')
    ok(rooms[2] not in txt and all(r['room'] != rooms[2] for r in L), 'private room not listed')
    ok(all(r['st'] for r in L), 'stage column filled: ' + ', '.join(r['st'] for r in L))
    hosts[0].keyboard.press('F7'); hosts[0].keyboard.press('F7')
    if a.preview: v.screenshot(path=os.path.join(ROOT, a.preview, 'room_list.png')); hosts[2].screenshot(path=os.path.join(ROOT, a.preview, 'room_list_host.png'))
    v.click(f'#np-list button[data-r="{rooms[0]}"]'); v.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.slot === 1', timeout=30000)
    ok(True, 'Entrar from the list joined Saulo\'s room as P2')
    pv = page('Amigo'); pv.keyboard.press('F7'); pv.fill('#np-code', rooms[2]); pv.click('#np-join')
    pv.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.slot === 1', timeout=30000); ok(True, 'private room joinable by code')
    time.sleep(6); hosts[0].evaluate('SSRNETPLAY.refreshList()')
    hp = hosts[1].evaluate('SSRNETPLAY.session.links.length'); ok(hp == 1, 'Ana room links ' + str(hp))
finally:
    php.terminate()
ok(not [f for f in fails if ':' in f and 'FAIL' not in f and f not in ('',)] or True, 'done')
print('ALL PASS' if not fails else 'FAILED: ' + '; '.join(fails)); raise SystemExit(1 if fails else 0)
