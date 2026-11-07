#!/usr/bin/env python3
"""TURN relay fallback in headless Chrome (pt77u): a local coturn (127.0.0.1, --allow-loopback-peers) stands in for
the public relay; signal.php on php -S. Scenarios (guest URL ?simnat= drops candidates in transport.js):
  A raw relay-only RTCPeerConnection gathers 'relay' candidates from the TURN server;
  B simnat=1 (only relay candidates survive, like CGNAT on both sides): guest joins as P2, nominated path = relay;
  C simnat=2 (direct attempt gets no candidates at all): after ?direct=4 s the panel shows the relay message,
    the relay-only retry connects as P2, host saw 'Alguém tentando entrar' / 'Someone is trying to join';
  D simnat=2 without any TURN (?noturn=1): clear failure message + 'Try again' button instead of eternal Connecting.
Usage: python3 test/test_relay.py   (needs `turnserver` from the coturn package)"""
import os, subprocess, time, socket, json, shutil
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
def fport():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p
port, tport = fport(), fport()
php = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', os.path.join(ROOT, 'web')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=dict(os.environ, PHP_CLI_SERVER_WORKERS='6'))
LIVE = os.environ.get('SIGNAL', '')  # e.g. https://games4me.alwaysdata.net/simpsons/signal.php: its Cloudflare TURN, no coturn
turn = None if LIVE else subprocess.Popen(['turnserver', '-n', '--listening-ip=127.0.0.1', '--relay-ip=127.0.0.1', f'--listening-port={tport}', '--lt-cred-mech', '--user=ssr:test', '--realm=ssr',
    '--allow-loopback-peers', '--no-cli', '--no-tls', '--no-dtls', '--min-port=49200', '--max-port=49300', '--log-file=stdout'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5); shutil.rmtree(os.path.join(ROOT, 'web/net/rooms'), ignore_errors=True)
BASE = f'http://127.0.0.1:{port}/index.html'; SIG = LIVE or f'http://127.0.0.1:{port}/net/signal.php'
TURN = f'turn:127.0.0.1:{tport},ssr,test'
fails = []; ok = lambda c, m: print(('PASS ' if c else 'FAIL ') + m) or (c or fails.append(m))
ZIP = os.path.join(ROOT, 'roms', 'simpsons.zip')
def boot(pg, url):  # the user's own ROM zip through the picker (nothing ROM-derived is served)
    pg.goto(url); pg.locator('#romload input[type=file]').set_input_files(ZIP, timeout=60000); pg.evaluate('SSRG.ready')
try:
  with sync_playwright() as p:
    args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
    logs = []
    def page(extra=''):
        b = p.chromium.launch(args=args); pg = b.new_page(viewport={'width': 1100, 'height': 700})
        pg.on('console', lambda m: logs.append(m.text) if '[ssr-net' in m.text else None)
        pg.on('pageerror', lambda e: fails.append(str(e))); boot(pg, f'{BASE}?signal={SIG}&sound=0' + ('' if LIVE else f'&noturn=1&turn={TURN}') + extra); return pg
    h = page()
    c = h.evaluate("""async ([t, live]) => { const out = []; let ice; // live: the server's short-lived TURN credentials (never printed)
      if (live) ice = (await (await fetch(live + '?a=ice')).json()).ice; else { const [urls, username, credential] = t.split(','); ice = [{ urls, username, credential }]; }
      const pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: 'relay' }); pc.createDataChannel('x');
      pc.onicecandidate = e => e.candidate && out.push(e.candidate.candidate); await pc.setLocalDescription(await pc.createOffer());
      await new Promise(r => setTimeout(r, 4000)); pc.close(); return out.map(x => x.replace(/\\d+\\.\\d+\\.\\d+\\.\\d+/g, "x.x.x.x")); }""", [TURN, LIVE])
    print(c); ok(c and all(' typ relay' in x for x in c), 'A relay-only gathering: %d relay candidates' % len(c))
    h.keyboard.press('F7'); h.click('#np-create'); h.wait_for_function('SSRNETPLAY.session'); room = h.evaluate('SSRNETPLAY.state.room')
    g = page(f'&simnat=1&sala={room}')
    g.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.slot === 1', timeout=30000)
    time.sleep(1); path = g.evaluate('SSRNETPLAY.session.links[0].link.path || (SSRNETPLAY.state.t.link && SSRNETPLAY.state.t.link.path)')
    ok('relay' in str(path), 'B simnat=1 joined as P2 via path ' + str(path))
    seen = []
    g2 = page(('' if LIVE else '&direct=4') + f'&simnat=2&sala={room}')  # live: the real 15 s direct timeout
    for i in range(120):
        try: txt = g2.inner_text('#np'); seen.append(txt)
        except Exception: pass
        try: ht = h.inner_text('#np'); seen.append(ht)
        except Exception: pass
        w = g2.evaluate('SSRHINT.waiting'); w and seen.append('W:' + w)
        if g2.evaluate('!!(SSRNETPLAY.session && SSRNETPLAY.session.slot === 2)'): break
        time.sleep(0.5)
    ok(g2.evaluate('!!(SSRNETPLAY.session && SSRNETPLAY.session.slot === 2)'), 'C relay retry joined as P3')
    ok(any('relay server' in t for t in seen), 'C guest panel showed the relay retry message')
    ok(any(t.startswith('W:Connecting to the host') for t in seen) and any(t.startswith('W:Trying via relay') for t in seen), 'C game area shows Connecting / relay text instead of black')
    ok(any('trying to join' in t or 'tentando entrar' in t for t in seen), 'C host panel showed someone trying to join')
    h.screenshot(path='/tmp/relay_host.png')
    b = p.chromium.launch(args=args); g3 = b.new_page(); g3.on('console', lambda m: logs.append(m.text) if '[ssr-net' in m.text else None)
    boot(g3, f'{BASE}?signal={SIG}&sound=0&noturn=1&simnat=2&direct=3&sala={room}')
    g3.wait_for_selector('#np-retry', timeout=20000); t = g3.inner_text('#np'); print(t[-300:])
    ok('Could not connect to the host' in t and 'Connecting' not in t, 'D no TURN: failure message + Try again button')
    time.sleep(0.5); w = g3.evaluate('SSRHINT.waiting'); ok(w == 'Could not connect to the host', 'D game area shows: ' + str(w))
    g3.screenshot(path='/tmp/relay_fail.png')
    ok(any("'ice'" in l or ' ice ' in l for l in logs) or any('connection' in l for l in logs), 'ICE state logged to console (%d lines)' % len(logs))
finally:
    php.terminate(); turn and turn.terminate()
print('ALL PASS' if not fails else 'FAILED: ' + '; '.join(fails)); raise SystemExit(1 if fails else 0)
