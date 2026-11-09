#!/usr/bin/env python3
"""Real-browser pause/audio regression check. Needs Playwright Chromium and roms/simpsons.zip."""
import functools
import http.server
import os
import threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=os.path.join(ROOT, 'web')))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        page = browser.new_page(viewport={'width': 1152, 'height': 800})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
        page.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT, 'roms/simpsons.zip'))
        page.evaluate('SIMPG.ready')
        page.wait_for_function('SIMPG.frame > 2')
        page.click('#game-pause')
        page.wait_for_function('SIMPG.audio && SIMPG.audioGain === 0')
        frame = page.evaluate('SIMPG.frame')
        page.wait_for_timeout(350)
        assert page.evaluate('SIMPG.frame') == frame
        assert page.locator('#pause-label').is_visible()
        assert page.locator('#game-pause').inner_text() == 'Resume (P)'
        print('ok pause freezes frames, silences audio, and shows Resume')
        os.makedirs(os.path.join(ROOT, 'preview'), exist_ok=True)
        page.screenshot(path=os.path.join(ROOT, 'preview/playback_paused.png'))
        page.keyboard.press('p')
        page.wait_for_function('(f) => SIMPG.frame > f', arg=frame)
        assert not page.locator('#pause-label').is_visible()
        assert page.evaluate('SIMPG.audioGain') == 1
        print('ok P resumes frames and audio')
        page.keyboard.press('p')
        assert page.evaluate('SIMPG.paused')
        page.click('#game-pause')
        assert not page.evaluate('SIMPG.paused')
        print('ok P pauses and Resume button continues')
        page.click('#game-sound')
        assert page.evaluate('SIMPG.muted && SIMPG.audioGain === 0')
        frame = page.evaluate('SIMPG.frame')
        page.wait_for_function('(f) => SIMPG.frame > f', arg=frame)
        page.reload()
        page.evaluate('SIMPG.ready')
        assert page.evaluate('SIMPG.muted')
        assert page.locator('#game-sound').inner_text() == 'Unmute (F8)'
        page.click('#screen', force=True)
        page.wait_for_function('SIMPG.audio && SIMPG.audioGain === 0')
        page.keyboard.press('F8')
        assert page.evaluate('!SIMPG.muted && SIMPG.audioGain === 1')
        print('ok mute preserves gameplay, persists on reload, and F8 unmutes')
        page.keyboard.press('F7')
        page.locator('#np-nick').fill('Pause P')
        page.keyboard.press('p')
        page.keyboard.press('F8')
        assert page.evaluate('!SIMPG.paused && !SIMPG.muted')
        print('ok shortcuts do not fire while typing')
        page.evaluate('SIMPG.pause(true); SIMPG.net = {active: () => false}')
        assert not page.evaluate('SIMPG.paused')
        assert not page.locator('#game-pause').is_enabled()
        page.evaluate('SIMPG.pause(true)')
        assert not page.evaluate('SIMPG.paused')
        page.evaluate('SIMPG.net = null')
        assert page.locator('#game-pause').is_enabled()
        assert not errors, errors
        print('ok entering online mode resumes play and blocks local pause; no page errors')
        browser.close()
finally:
    server.shutdown()
