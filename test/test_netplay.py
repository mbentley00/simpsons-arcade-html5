#!/usr/bin/env python3
"""Netplay in headless Chrome: one browser per player, real WebRTC over loopback, signaling by web/net/signal.php on
PHP's built-in server (php -S). The host creates a room after playing alone for a while; guests open the invite link
(late join: they get the host's snapshot), staggered (the last one joins at --last-join seconds). Every page plays a
scripted bot (coin, start to join, then random moves/shots). Links get simulated latency/jitter/loss (?netsim).
Checks that all state hashes reported by the guests match the host's (no desync, no resync after the join),
and prints rollback stats and CPU cost.
Spectators (--spectators N): after all players, N more pages open the link, get "Sala cheia" + Assistir/Sair, click
Assistir; at --leave-at the last player closes its page and spectator 1 presses coin (5) to take the slot and play.
Nicknames: every page has one in localStorage (one with HTML/control chars, one empty -> "Player N" (or "Jogador N" in Portuguese)); all peers must
agree. Usage: python3 test/test_netplay.py [--players 4] [--seconds 300] [--netsim 60,20,5] [--last-join 60] [--spectators 2]"""
import argparse, os, subprocess, time, json, socket, sys
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('--players', type=int, default=4); ap.add_argument('--seconds', type=float, default=300)
ap.add_argument('--netsim', default='60,20,5'); ap.add_argument('--last-join', type=float, default=60); ap.add_argument('--delay', type=int, default=2)
ap.add_argument('--chat-at', type=float, default=-1, help='seconds after the room opens to test the chat (default last-join + 12)')
ap.add_argument('--spectators', type=int, default=0); ap.add_argument('--leave-at', type=float, default=-1)
ap.add_argument('--preview', default='', help='folder for chat preview screenshots (e.g. ref/preview)')
a = ap.parse_args()
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
php = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', os.path.join(ROOT, 'web')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = f'http://127.0.0.1:{port}/index.html'; SIG = f'http://127.0.0.1:{port}/net/signal.php'
BOT = """seed => { let x = seed * 2654435761 >>> 0, cur = 0, hold = 0, n = 0; const I = SSRIN, orig = I.sample;
  I.sample = () => { n++; const o = new Uint8Array(4); const k = n % 900;
    if (k === 60) o[0] = I.COIN; else if (k === 120 || k === 130) o[0] = I.START;
    else { if (--hold <= 0) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; cur = [0, I.L, I.R, I.U, I.D, I.FIRE, I.FIRE | I.R, I.JUMP, I.L | I.FIRE][(x >>> 16) % 9]; hold = 5 + ((x >>> 8) % 40); } o[0] = cur; }
    return o; }; }"""
STATS = """() => { const N = SSRNETPLAY.session; if (!N || !N.rb) return null; const r = N.rb.stats;
  return { slot: N.slot, frame: N.rb.frame, confirmed: N.rb.confirmed, frames: r.frames, rollbacks: r.rollbacks, rolledFrames: r.rolledFrames,
    maxRollback: r.maxRollback, stalls: r.stalls, msSim: r.msSim / r.frames, msSave: r.msSave / r.frames, msLoad: r.msLoad / Math.max(1, r.rollbacks),
    msTick: SSRG.msPerFrame(), spec: N.spec, names: N.names(), specList: N.spectators(), specDesyncs: N.stats.specDesyncs, specHashChecks: N.stats.specHashChecks, resyncs: N.stats.resyncs, desyncs: N.stats.desyncs, hashChecks: N.stats.hashChecks, lastHash: N.lastHash || null,
    peers: N.peers(), bytesState: N.stats.bytesState }; }"""
fails = []
ZIP = os.path.join(ROOT, 'roms', 'simpsons.zip')
def boot(pg, url):  # the user's own ROM zip through the picker (nothing ROM-derived is served)
    pg.goto(url); pg.locator('#romload input[type=file]').set_input_files(ZIP); pg.evaluate('SSRG.ready')
with sync_playwright() as p:
    args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
    NB = a.players + a.spectators; NICKS = ['Saulo', '<b>Zé</b>\x07 do Rifle longo', '', 'Ana'] + [f'Fã {k}' for k in range(1, 9)]
    browsers = [p.chromium.launch(args=args) for _ in range(NB)]
    pages = []
    for i, b in enumerate(browsers):
        pg = b.new_page(); pg.add_init_script(f'try {{ localStorage.setItem("simpsons_nick", {json.dumps(NICKS[i])}) }} catch (e) {{}}'); pg.on('pageerror', lambda e, i=i: fails.append(f'page {i}: {e}')); pages.append(pg)
    h = pages[0]; boot(h, f'{BASE}?signal={SIG}&mods=0'); h.evaluate(BOT, 1)   # online rooms run the original game
    time.sleep(5)  # host plays alone for a bit (attract / coin)
    h.evaluate('SSRNETPLAY.host()'); room = h.evaluate('SSRNETPLAY.state.room'); print('room', room, 'link', h.evaluate('SSRNETPLAY.link()'))
    chat_at = a.chat_at if a.chat_at >= 0 else a.last_join + 12; chat_done = False; chat_res = None
    LINES = ['Cobre a direita!', 'Bora, parceiro! Vamos pegar o Simon Greedwell <b>agora</b>', 'Valeu!', 'Tô sem vida...']
    def chat_test():
        # guest 1 types with the real keyboard: TAB opens the field, the game input is blocked, Enter sends
        g = pages[1]; g.keyboard.press('Tab'); opened = g.evaluate('[SSRCHAT.open, SSRIN.block, document.activeElement && document.activeElement.id]')
        g.keyboard.type(LINES[1]); g.keyboard.press('Enter')
        closed = g.evaluate('[SSRCHAT.open, SSRIN.block]')
        # Esc cancels without sending
        g2 = pages[0]; g2.keyboard.press('Tab'); g2.keyboard.type('nao enviar'); g2.keyboard.press('Escape')
        for i, pg in enumerate(pages[:joined]):
            if i != 1: pg.evaluate('t => SSRCHAT.send(t)', LINES[i % len(LINES)] if i else LINES[0])
        time.sleep(1.2)
        return {'opened': opened, 'closed': closed, 'recent': [pg.evaluate('SSRCHAT.recent.map(r => [r.slot, r.text])') for pg in pages[:joined]],
                'pos': [pg.evaluate('[0,1,2,3].map(p => SSRCHAT.playerPos(SSRG.machine, p))') for pg in pages[:joined]]}
    spec_at = a.last_join + 20; leave_at = a.leave_at if a.leave_at >= 0 else spec_at + 25; spec_state = 0; promo = None; gone = set()
    def shot(pg, name):
        if a.preview: os.makedirs(a.preview, exist_ok=True); pg.screenshot(path=os.path.join(a.preview, name))
    t0 = time.time(); joins = [0] + [a.last_join * k / max(1, a.players - 1) for k in range(1, a.players)]; joined = 1
    while time.time() - t0 < a.seconds:
        el = time.time() - t0
        while joined < a.players and el >= joins[joined]:
            g = pages[joined]; boot(g, f'{BASE}?sala={room}&signal={SIG}&netsim={a.netsim}&delay={a.delay}'); g.evaluate(BOT, joined + 1)
            print(f'{el:6.1f}s guest {joined} joining'); joined += 1
        time.sleep(1)
        if not chat_done and el >= chat_at and joined == a.players and a.players > 1:
            chat_done = True; chat_res = chat_test(); print('chat', json.dumps(chat_res, ensure_ascii=False), flush=True)
            if a.preview:
                os.makedirs(a.preview, exist_ok=True)
                for i, pg in enumerate(pages[:joined]): pg.screenshot(path=os.path.join(a.preview, f'chat_p{i + 1}.png'))
        if a.spectators and spec_state == 0 and el >= spec_at:
            spec_state = 1
            for k in range(a.spectators):
                g = pages[a.players + k]; boot(g, f'{BASE}?sala={room}&signal={SIG}&netsim={a.netsim}&delay={a.delay}')
                g.wait_for_function('SSRNETPLAY.state.full', timeout=20000)
                if k == 0: shot(g, 'spec_choice.png')
                g.click('#np-watch'); print(f'{el:6.1f}s spectator {k + 1} watching', flush=True)
        if spec_state == 1 and el >= spec_at + 12:
            spec_state = 2; g = pages[a.players]; g.keyboard.press('F7'); time.sleep(0.3)
            g.evaluate("t => SSRCHAT.send(t)", 'Que partida, pessoal!'); time.sleep(1.5)
            h.keyboard.press('F7'); time.sleep(0.3)
            shot(g, 'spec_panel_spectator.png'); shot(h, 'spec_panel_host.png'); g.keyboard.press('F7'); h.keyboard.press('F7'); time.sleep(0.3)
            shot(g, 'spec_screen.png'); shot(h, 'nicks_p1.png')
        if spec_state == 2 and el >= leave_at:
            spec_state = 3; last = pages[a.players - 1]; last.goto('about:blank'); gone.add(a.players - 1); print(f'{el:6.1f}s player {a.players} left', flush=True)
        if spec_state == 3:
            g = pages[a.players]
            if g.evaluate('!!(SSRNETPLAY.session && SSRNETPLAY.session.vaga)'):
                shot(g, 'spec_vaga.png'); g.keyboard.down('Digit5'); time.sleep(0.15); g.keyboard.up('Digit5'); time.sleep(1)
            if g.evaluate('!!(SSRNETPLAY.session && !SSRNETPLAY.session.spec)'):
                spec_state = 4; promo = el; g.evaluate(BOT, 99); print(f'{el:6.1f}s spectator 1 promoted to slot', g.evaluate('SSRNETPLAY.session.slot'), flush=True)
        if int(el) % 30 == 0:
            st = [pg.evaluate(STATS) if i not in gone else None for i, pg in enumerate(pages[:joined + (a.spectators if spec_state else 0)])]
            print(f'{el:6.1f}s', ' | '.join(f"P{s['slot']+1} f{s['frame']} rb{s['rollbacks']} st{s['stalls']} rs{s['resyncs']}" if s else '-' for s in st), flush=True)
    st = [pg.evaluate(STATS) if (i < joined or (spec_state and i >= a.players)) and i not in gone else None for i, pg in enumerate(pages)]
    recs = [pg.evaluate('SSRCHAT.recent.map(r => [r.slot, r.text])') if s0 else [] for pg, s0 in zip(pages, st)]
    shots = [pg.screenshot(path=f'/tmp/netplay_p{i}.png') for i, pg in enumerate(pages)]
    for b in browsers: b.close()
php.terminate()
host = st[0]
print(json.dumps(st, indent=1, default=str)[:6000])
ok = True
for i, s in enumerate(st):
    if i in gone: continue
    if not s: print('peer', i, 'never synced'); ok = False; continue
    if s['names'] != host['names']: print('peer', i, 'nicks differ', s['names'], host['names']); ok = False
    if i == a.players and a.spectators:
        if s['spec'] or s['slot'] != a.players - 1 or s['resyncs'] != 2: print('spectator 1 not promoted', s['spec'], s['slot'], s['resyncs']); ok = False
        continue
    if i and s['resyncs'] != 1: print('peer', i, 'resynced', s['resyncs'], 'times (1 = the join)'); ok = False
if host['desyncs']: print('host saw', host['desyncs'], 'desyncs'); ok = False
print('nicks', host['names'])
if host['names'][0] != 'Saulo' or any(len(n) > 12 or '<' in n for n in host['names']) or (a.players > 2 and host['names'][2] not in ('Jogador 3', 'Player 3')): print('bad nicks', host['names']); ok = False
if a.spectators:
    sp = [x for x in host['peers'] if x['spec']]; print('spectator links', sp, 'spec hash checks', host['specHashChecks'], 'spec desyncs', host['specDesyncs'])
    if spec_state < 4: print('spectator flow stopped at state', spec_state); ok = False
    if host['specDesyncs'] or len(sp) != a.spectators - 1 or any(x['hc'] < 3 or x['dc'] for x in sp): print('spectators not in sync'); ok = False
    pl = next((x for x in host['peers'] if x['slot'] == a.players - 1), None)
    if not pl or pl['hc'] < 3 or pl['dc']: print('promoted spectator not hash-checked as a player', pl); ok = False
    for i, r in enumerate(recs):
        if st[i] and [-1, 'Que partida, pessoal!'] not in r: print('peer', i, 'missed the spectator chat'); ok = False
    if len(host['specList']) != a.spectators - 1: print('host spectator list', host['specList']); ok = False
if host['hashChecks'] < (a.players - 1) * 5: print('too few hash checks', host['hashChecks']); ok = False
if a.players > 1:
    if not chat_res: print('chat test did not run'); ok = False
    else:
        g = 'Bora, parceiro! Vamos pegar o Simon Greedwell <b>agora</b>'[:60].strip()
        if chat_res['opened'][:2] != [True, True] or chat_res['opened'][2] != 'chatin' or chat_res['closed'] != [False, False]: print('chat field open/close/block wrong', chat_res['opened'], chat_res['closed']); ok = False
        for i, rec in enumerate(chat_res['recent']):
            if [1, g] not in rec: print('peer', i, 'did not get the guest line'); ok = False
            if any('nao enviar' in r[1] for r in rec): print('peer', i, 'got the cancelled line'); ok = False
            if len({tuple(r) for r in rec if r[0] >= 0}) < a.players: print('peer', i, 'missing lines', rec); ok = False
if fails: print('page errors', fails[:5]); ok = False
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
