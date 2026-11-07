#!/usr/bin/env python3
"""Promo render: replay a session JSON (test/promo_live_simpsons.py) frame-exact in one page (CRT + bezel, nicks, chat
bubbles on a virtual clock, coin hint off), screenshot every frame of [A, B), save the board's PCM (Int16 stereo 55930 Hz)
and a per-frame state hash (RAM+VRAM). Usage: promo_render_simpsons.py A B SESSION.json TAG W H"""
import os, subprocess, time, json, socket, sys, base64
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); OUT = '/tmp/sp/out'
A, B, SES, TAG, VW, VH = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4], int(sys.argv[5]), int(sys.argv[6])
FR = f'{OUT}/frames_{TAG}'; os.makedirs(FR, exist_ok=True); ZIP = os.path.join(ROOT, 'roms', 'simpsons.zip')
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
php = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', os.path.join(ROOT, 'web')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
d = json.load(open(SES))
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader'])
    pg = b.new_page(viewport={'width': VW, 'height': VH}, device_scale_factor=1)
    pg.add_init_script("""(() => { const real = performance.now.bind(performance); window.__vt = null; performance.now = () => window.__vt === null ? real() : window.__vt; })()""")
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{port}/index.html?pause=1'); pg.locator('#romload input[type=file]').set_input_files(ZIP); pg.evaluate('SSRG.ready')
    pg.evaluate("""d => { const m = SSRG.m; m.load(SSRSNAP.unpack(new Uint8Array(d.snap))); m.audio = true; m.drainAudio();
      SSRG.frameNo = d.F0 - 1; SSRHINT.off = true; window.__d = d; window.__ci = 0; window.__pcm = []; window.__h = {};
      SSRNETPLAY.state.s = { rb: {}, names: () => d.names, slot: d.slot || 0, spec: false, role: 'host', peers: () => [], stats: {} };
      const H = a => { let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };
      window.__stepTo = (f1, keep) => { const D = window.__d; for (let f = SSRG.frameNo + 1; f <= f1; f++) {
          window.__vt = f * 16.896; while (__ci < D.chat.length && D.chat[__ci][0] <= f) { const c = D.chat[__ci++]; SSRCHAT.show(c[1], c[2]); }
          SSRG.netStep(new Uint8Array(D.rec[f]), f); const a = SSRG.netAudio ? null : null; window.__h[f] = H(m.ram) ^ Math.imul(H(m.vram), 3); }
        SSRG.run(0); }; }""", d)
    # capture PCM: netStep stores the frame's samples in game.js npcm; read them through drainAudio wrapper
    pg.evaluate("""() => { const m = SSRG.m, dr = m.drainAudio.bind(m); m.drainAudio = () => { const x = dr(); if (window.__rec) window.__pcm.push(Array.from(x)); return x; }; }""")
    pg.evaluate(f'__stepTo({A - 1})'); pg.evaluate('window.__rec = 1'); t0 = time.time()
    for f in range(A, B):
        pg.evaluate(f'__stepTo({f})'); pg.screenshot(path=f'{FR}/{f - A:05d}.png', timeout=180000)
        if f % 100 == 0: print(f, round(time.time() - t0, 1), flush=True)
    pcm = pg.evaluate('(() => { const a = []; for (const p of __pcm) for (const x of p) a.push(x); return a; })()')
    import array; arr = array.array('h', pcm); open(f'{OUT}/pcm_{TAG}.raw', 'wb').write(arr.tobytes())
    json.dump(pg.evaluate(f'Object.fromEntries(Object.entries(__h).filter(([f]) => +f >= {A}))'), open(f'{OUT}/hash_{TAG}.json', 'w'))
    print('errors', errs[:5], 'samples', len(pcm) // 2); b.close()
php.terminate()
