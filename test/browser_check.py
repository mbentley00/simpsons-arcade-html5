#!/usr/bin/env python3
"""Runs web/index.html in headless Chromium with roms/simpsons.zip fed through the ROM picker (nothing is served from
the repo but web/), checks: no console errors, every MAME snapshot frame in snap/ (run/snaps.lua) equals the page's
displayed pixels, then free-runs the attract live for a few seconds (measures emulated Hz) and saves
preview/browser.png. With /tmp/mw/mame.wav (or $MAME_WAV, MAME -wavwrite at -samplerate 55930) also
compares the PCM the page generated sample by sample.   python3 test/browser_check.py [frames...]"""
import sys, os, re, threading, functools, http.server, struct, time
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); os.chdir(ROOT)
frames = sorted(int(a) for a in sys.argv[1:]) or sorted(int(m.group(1)) for f in os.listdir('snap') if (m := re.match(r'f(\d+)\.raw$', f)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory='web')); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.makedirs('preview', exist_ok=True)
errs = []; bad = 0
def boot(pg, q):
    pg.goto(f'http://127.0.0.1:{port}/index.html{q}')
    pg.locator('#romload input[type=file]').set_input_files('roms/simpsons.zip')
    pg.evaluate('SIMPG.ready')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text + ' ' + str(m.location.get('url')))); pg.on('pageerror', lambda e: errs.append(str(e)))
    boot(pg, '?pause=1')
    pg.evaluate('SIMPG.keepAudio = true')
    for n in frames:
        pg.evaluate(f'(() => {{ while (SIMPG.shown < {n}) SIMPG.run(1); }})()')
        px = pg.evaluate('SIMPG.pixels()')
        ref = struct.unpack(f'<{320*224}I', open(f'snap/f{n}.raw', 'rb').read())
        d = sum(1 for a, c in zip(ref, px) if (a & 0xffffff) != (((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)))
        bad += d; print(f'frame {n:5d}: {d} px differ from MAME')
    if os.path.exists('/tmp/mw/mame.wav') or os.environ.get('MAME_WAV'):   # browser-generated PCM vs MAME -wavwrite -samplerate 55930
        import wave
        pcm = pg.evaluate('SIMPG.takeAudio()'); pg.evaluate('SIMPG.keepAudio = false')
        w = wave.open(os.environ.get('MAME_WAV', '/tmp/mw/mame.wav')); ref = struct.unpack(f'<{len(pcm)}h', w.readframes(len(pcm) // 2))
        ad = sum(1 for a, c in zip(ref, pcm) if a != c); bad += ad
        print(f'audio: {len(pcm)//2} stereo samples from the page, {ad} differ from MAME -wavwrite')
    st = pg.evaluate('({...SIMPG.stats})'); print(f"machine+video: {st['ms']/st['steps']:.2f} ms/frame in Chromium")
    # scripted input (coin/start/walk/attack, 3 players) from power-on vs MAME run/input_script.lua log
    INP = os.environ.get('INPUT_SCRIPT', 'test/input/coin_start_walk.txt')
    if os.path.exists('run/out/inlog.txt') and os.path.exists(INP):
        ev = [(int(a[0]), a[1], int(a[2], 16)) for a in (l.split() for l in open(INP)) if len(a) >= 3 and a[0].isdigit()]
        mf = {int(a[1]): a[2] for a in (l.split() for l in open('run/out/inlog.txt')) if a and a[0] == 'F'}
        last = max(mf) - 2
        ctx.close(); ctx = b.new_context(viewport={'width': 1280, 'height': 720}); pg = ctx.new_page()
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text + ' ' + str(m.location.get('url')))); pg.on('pageerror', lambda e: errs.append(str(e)))
        boot(pg, '?pause=1')
        hs = pg.evaluate('''([ev, last]) => {
          const P = { COIN: -1, P1: 0, P2: 1, P3: 2, P4: 3 }, st = { COIN: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
          SIMPI.script = f => { for (const [n, p, v] of ev) if (n + 1 === f) st[p] = v; const fi = new Uint8Array(4);
            for (let i = 0; i < 4; i++) fi[i] = st['P' + (i + 1)]; for (let i = 0; i < 4; i++) if (st.COIN & (1 << i)) fi[i] |= SSRIN.COIN; return fi; };
          const m = SIMPG.m, of = m.onFrame, H = {};
          m.onFrame = bd => { of(bd); let h = 0x811c9dc5; for (let a = 0; a < 0x2000; a++) { h ^= m.ram[a]; h = Math.imul(h, 0x01000193); } H[m.frame] = (h >>> 0).toString(16).padStart(8, '0'); };
          while (m.frame < last) SIMPG.run(1);
          return H; }''', [ev, last])
        hb = sum(1 for n, h in hs.items() if int(n) - 1 in mf and mf[int(n) - 1] != h); bad += hb
        print(f'scripted input: {len(hs)} frames in the page, RAM hash vs MAME: {hb} differ')
        pg.locator('#screen').screenshot(path='preview/browser_play.png')
        # EEPROM persistence round trip: a changed cell is saved to localStorage and comes back after a reload
        pg.evaluate('SIMPG.m.eep.data[0x7f] ^= 0x5a; SIMPI.eepromSave(SIMPG.m, true)')
        want = pg.evaluate('Array.from(SIMPG.m.eep.data)')
        pg.goto(f'http://127.0.0.1:{port}/index.html?pause=1'); pg.evaluate('SIMPG.ready')
        got = pg.evaluate('Array.from(SIMPG.m.eep.data)'); ok = got == want; bad += 0 if ok else 1
        print('EEPROM localStorage round trip:', 'OK' if ok else 'FAIL'); pg.evaluate('SIMPI.eepromClear()')
    ctx.close(); ctx = b.new_context(viewport={'width': 1280, 'height': 720}); pg = ctx.new_page()   # fresh profile: picker again
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text + ' ' + str(m.location.get('url')))); pg.on('pageerror', lambda e: errs.append(str(e)))
    boot(pg, '')                       # live: rAF loop, real time
    pg.mouse.click(5, 5); pg.wait_for_timeout(500)
    f0, t0 = pg.evaluate('SIMPG.frame'), time.time(); pg.wait_for_timeout(int(os.environ.get("LIVE_MS", "30000")))
    f1, t1 = pg.evaluate('SIMPG.frame'), time.time()
    print(f'live: {(f1 - f0) / (t1 - t0):.2f} emulated frames/s (target 59.1856), webgl={pg.evaluate("SSRGFX.webgl")} mode={pg.evaluate("SSRGFX.mode")} audio={pg.evaluate("SIMPG.audio && SIMPG.audio.state")}')
    pg.screenshot(path='preview/browser.png')
    kb = []
    for key, port, val in [('Digit5', 'COIN', 0xfe), ('Digit8', 'COIN', 0xf7), ('KeyZ', 'P1', 0xef), ('Numpad6', 'P2', 0xfd), ('Digit4', 'P4', 0x7f)]:
        pg.keyboard.down(key); pg.wait_for_timeout(120); got = pg.evaluate(f'SIMPG.m.inputs.{port}'); pg.keyboard.up(key); pg.wait_for_timeout(60)
        kb.append(got == val)
    # gamepad: a fake standard-mapping pad in slot 2 (player 3) holding d-pad right + A (attack) + Start
    pg.evaluate('''navigator.getGamepads = () => { const B = i => ({ pressed: [0, 9, 15].includes(i), value: 0 });
      return [null, null, { connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, (_, i) => B(i)) }, null]; }''')
    pg.wait_for_timeout(150); kb.append(pg.evaluate('SIMPG.m.inputs.P3') == 0xff & ~(0x02 | 0x10 | 0x80))
    print('keyboard + gamepad -> ports:', 'OK' if all(kb) else f'FAIL {kb}'); bad += 0 if all(kb) else 1
    b.close()
print('console errors:', errs or 'none'); print('pixel diffs total:', bad)
sys.exit(1 if errs or bad else 0)
