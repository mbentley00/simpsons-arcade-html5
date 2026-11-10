#!/usr/bin/env python3
"""Online play the way a player starts it, over the public PeerJS broker (needs internet; WebRTC runs on loopback):
the host opens the normal page (offline Arcade Remix on), opens the panel (F7) and clicks Create room; the page reopens
as the original game (?mods=0&host=1) and opens a PeerJS room; a second browser opens the invite link. Both play with a
scripted bot; the host's hash checks must find no desync. A wrong room code must fail quickly with "not found".
Usage: python test/test_netplay_peerjs.py [--seconds 45]"""
import argparse, functools, http.server, os, sys, threading, time
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('--seconds', type=float, default=45); a = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); ZIP = os.path.join(ROOT, 'roms', 'simpsons.zip')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=os.path.join(ROOT, 'web')))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}/index.html'
BOT = """seed => { let x = seed * 2654435761 >>> 0, cur = 0, hold = 0, n = 0; const I = SSRIN;
  I.sample = () => { n++; const o = new Uint8Array(4); const k = n % 900;
    if (k === 60) o[0] = I.COIN; else if (k === 120 || k === 130) o[0] = I.START;
    else { if (--hold <= 0) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; cur = [0, I.L, I.R, I.U, I.D, I.FIRE, I.FIRE | I.R, I.JUMP, I.L | I.FIRE][(x >>> 16) % 9]; hold = 5 + ((x >>> 8) % 40); } o[0] = cur; }
    return o; }; }"""
STATS = """() => { const N = SSRNETPLAY.session; if (!N || !N.rb) return null;
  return { slot: N.slot, frame: N.rb.frame, rollbacks: N.rb.stats.rollbacks, stalls: N.rb.stats.stalls, resyncs: N.stats.resyncs,
    desyncs: N.stats.desyncs, hashChecks: N.stats.hashChecks, names: N.names(), peers: N.peers() }; }"""
fails = []
try:
    with sync_playwright() as p:
        args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
        hb, gb = p.chromium.launch(args=args), p.chromium.launch(args=args)
        h, g = hb.new_page(), gb.new_page()
        for i, pg in enumerate((h, g)): pg.on('pageerror', lambda e, i=i: fails.append(f'page {i}: {e}'))
        # host: the normal page, with the offline Remix on
        h.goto(BASE); h.locator('#romload input[type=file]').set_input_files(ZIP); h.evaluate('SSRG.ready')
        assert h.evaluate('SIMPCOMBAT.enabled'), 'the normal page runs the Arcade Remix'
        assert h.inner_text('#npb') == 'Online play (F7)'
        h.keyboard.press('F7'); h.wait_for_selector('#np-create'); assert 'original game' in h.inner_text('#np')
        h.click('#np-create')
        h.wait_for_url('**/index.html?*host=1*', timeout=30000); h.evaluate('SSRG.ready')   # ROM from the browser cache
        assert not h.evaluate('SIMPCOMBAT.enabled'), 'the reopened page is the original game'
        h.wait_for_function('SSRNETPLAY.state.room && SSRNETPLAY.state.s', timeout=60000)
        room, link, kind = h.evaluate('[SSRNETPLAY.state.room, SSRNETPLAY.link(), SSRNETPLAY.kind]')
        print('room', room, 'kind', kind, 'link', link, flush=True); assert kind == 'peerjs' and 'sala=' + room in link and 'net=' not in link
        h.evaluate(BOT, 1)
        # a wrong code fails fast with a clear message
        g.goto(BASE + '?sala=ZZZZ'); g.locator('#romload input[type=file]').set_input_files(ZIP); g.evaluate('SSRG.ready')
        t0 = time.time(); g.wait_for_function("document.getElementById('np').innerText.includes('was not found')", timeout=40000)
        print(f'ok wrong code reported as not found after {time.time() - t0:.1f}s', flush=True)
        # guest: the invite link
        g.goto(link); g.evaluate('SSRG.ready')
        g.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb', timeout=60000); g.evaluate(BOT, 2)
        print('ok guest connected', flush=True)
        end = time.time() + a.seconds
        while time.time() < end: time.sleep(5)
        hs, gs = h.evaluate(STATS), g.evaluate(STATS)
        print('host ', hs); print('guest', gs)
        h.screenshot(path=os.path.join(ROOT, 'preview', 'netplay_host.png')); g.screenshot(path=os.path.join(ROOT, 'preview', 'netplay_guest.png'))
        hb.close(); gb.close()
    ok = True
    if not hs or not gs: print('a peer never synced'); ok = False
    else:
        if hs['desyncs']: print('host saw', hs['desyncs'], 'desyncs'); ok = False
        if hs['hashChecks'] < 3: print('too few hash checks', hs['hashChecks']); ok = False
        if gs['resyncs'] != 1: print('guest resynced', gs['resyncs'], 'times (1 = the join)'); ok = False
        if gs['slot'] != 1: print('guest slot', gs['slot']); ok = False
        if hs['names'] != gs['names']: print('names differ', hs['names'], gs['names']); ok = False
    if fails: print('page errors', fails[:5]); ok = False
    print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
finally:
    server.shutdown()
