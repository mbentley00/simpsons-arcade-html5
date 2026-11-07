#!/usr/bin/env python3
"""Promo capture: a real 4-player online session (4 headless Chromes, WebRTC over loopback, local php -S signal.php).
Planned inputs (test/promo_plan_simpsons.js -> /tmp/sp/plan_N.json, keyed by frame after power-on state /tmp/sp/s0.bin).
The host loads s0 before creating the room; the host records confirmed inputs + a snapshot at F0 + chat -> /tmp/sp/out/session_pN.json.
Usage: python3 test/promo_live_simpsons.py PLAN.json F0 END"""
import os, subprocess, time, json, socket, sys, base64
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); OUT = '/tmp/sp/out'
PLANF, F0, END = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
php = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', os.path.join(ROOT, 'web')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = f'http://127.0.0.1:{port}/index.html'; SIG = f'http://127.0.0.1:{port}/net/signal.php'
NICKS = ['Saulo', 'Ronaldo', 'Bia', 'Leo']; ZIP = os.path.join(ROOT, 'roms', 'simpsons.zip')
PLAN = json.load(open(PLANF))['plan']; S0 = base64.b64encode(open('/tmp/sp/s0.bin', 'rb').read()).decode()
BOT = """plan => { const P = SSRNETPLAY, tk = P.tick;  // every frame f gets plan[f-1][slot] (also the frames a stall gap-fills)
  P.tick = fi => { const N = P.session, rb = N && N.rb;
    if (rb && !rb.__pp) { rb.__pp = 1; rb.addLocal = function () { const s = this.slot, t = this.frame + this.delay;
      for (let f = Math.max(this.known[s] + 1, this.frame); f <= t; f++) { const r = plan[f - 1]; this.store(s, f, r ? r[s] : 0); } }; }
    return tk(0); }; }"""
HOOK = """F0 => { const N = SSRNETPLAY.session, rb = N.rb; window.__rec = {}; window.__chat = []; window.__F0 = F0;
  const sim = rb.sim.bind(rb); rb.sim = f => { sim(f); window.__rec[f] = Array.from(rb.used.get(f)); };
  const oa = rb.onAudio; rb.onAudio = (after, f) => { if (rb.confirmed === F0 - 1 && !window.__snap) window.__snap = Array.from(SSRSNAP.pack(after)); if (oa) oa(after, f); };
  const sh = SSRCHAT.show; SSRCHAT.show = (slot, text, name) => { window.__chat.push([rb.frame, slot, text]); return sh(slot, text, name); }; return rb.frame; }"""
fails = []
def boot(pg, url): pg.goto(url); pg.locator('#romload input[type=file]').set_input_files(ZIP); pg.evaluate('SSRG.ready')
with sync_playwright() as p:
    args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--use-gl=angle', '--use-angle=swiftshader']
    browsers = [p.chromium.launch(args=args) for _ in range(4)]; pages = []
    for i, b in enumerate(browsers):
        pg = b.new_page(viewport={'width': 960, 'height': 540}); pg.add_init_script(f'try {{ localStorage.setItem("simpsons_nick", {json.dumps(NICKS[i])}) }} catch (e) {{}}')
        pg.on('pageerror', lambda e, i=i: fails.append(f'page {i}: {e}')); pages.append(pg)
    h = pages[0]; boot(h, f'{BASE}?signal={SIG}'); h.evaluate(BOT, PLAN)
    h.evaluate("""async b64 => { SSRG.pause(true); const u = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); SSRG.m.load(SSRSNAP.unpack(u)); await SSRNETPLAY.host(); SSRG.pause(false); }""", S0)
    time.sleep(1); room = h.evaluate('SSRNETPLAY.state ? SSRNETPLAY.state.room : SSRNETPLAY.session.room'); print('room', room, 'f', h.evaluate('SSRNETPLAY.session.rb.frame'), flush=True)
    for i in range(1, 4):
        g = pages[i]; boot(g, f'{BASE}?sala={room}&signal={SIG}'); g.evaluate(BOT, PLAN)
        g.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot >= 0', timeout=60000); print('joined', i, flush=True)
    print('frame after joins', h.evaluate('SSRNETPLAY.session.rb.frame'), flush=True)
    h.wait_for_function(f'SSRNETPLAY.session.rb.frame >= {F0 - 60}', timeout=300000, polling=50)
    print('hook', [pg.evaluate(HOOK, F0) for pg in pages], flush=True)
    chats = [(F0 + 60, 0, 'bora, família!'), (F0 + 200, 1, "D'oh!"), (F0 + 360, 2, 'cadê a Maggie?'), (F0 + 500, 3, 'pega o chefe!')]
    while True:
        fr = h.evaluate('SSRNETPLAY.session.rb.frame')
        if chats and fr >= chats[0][0]: _, k, t = chats.pop(0); pages[k].evaluate('t => SSRCHAT.send(t)', t)
        if fr > END + 30: break
        time.sleep(0.05)
    time.sleep(2)
    for i, pg in enumerate(pages): pg.screenshot(path=f'{OUT}/live_end_p{i+1}.png')
    st = [pg.evaluate('(() => { const N = SSRNETPLAY.session; return { slot: N.slot, desyncs: N.stats.desyncs, resyncs: N.stats.resyncs, hc: N.stats.hashChecks, names: N.names(), conf: N.rb.confirmed } })()') for pg in pages]
    print(json.dumps(st), flush=True)
    for i, pg in enumerate(pages):
        d = pg.evaluate('({ F0: __F0, snap: window.__snap, chat: __chat, slot: SSRNETPLAY.session.slot, conf: SSRNETPLAY.session.rb.confirmed, names: SSRNETPLAY.session.names(), rec: Object.fromEntries(Object.entries(__rec).filter(([f]) => +f >= __F0 && +f <= SSRNETPLAY.session.rb.confirmed)) })')
        json.dump(d, open(f'{OUT}/session_p{i}.json', 'w')); print(i, 'frames', len(d['rec']), 'chat', d['chat'], 'snap', len(d['snap'] or []), 'slot', d['slot'])
    for b in browsers: b.close()
php.terminate(); print('errors', fails[:5])
