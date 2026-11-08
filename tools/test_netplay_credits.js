#!/usr/bin/env node
// Two headless Chromium peers: attract -> coin (5) -> Start (1) -> shot (Z).
// Uses real CDP key events. Optional SSR_NET_SIM=lat,jit,loss (default 220,40,0).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const ZIP = process.env.SSR_ROM || path.join(ROOT, 'roms', 'simpsons.zip');
const NETSIM = process.env.SSR_NET_SIM || '220,40,0';
const OUT = path.join(ROOT, 'extracted/preview');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(150);
  }
  throw new Error('timeout ' + url);
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.n = 0; this.pend = new Map(); this.exceptions = [];
    this.logs = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data.toString() : ev.data.toString());
      if (msg.id && this.pend.has(msg.id)) {
        const { ok, ko } = this.pend.get(msg.id); this.pend.delete(msg.id);
        msg.error ? ko(new Error(msg.error.message || JSON.stringify(msg.error))) : ok(msg.result);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const ex = msg.params.exceptionDetails || {};
        this.exceptions.push((ex.exception && (ex.exception.description || ex.exception.value)) || ex.text || 'ex');
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
        this.logs.push((msg.params.type || 'log') + ': ' + args);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.n;
    return new Promise((ok, ko) => {
      const timer = setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); ko(new Error('CDP timeout ' + method)); } }, 60000);
      this.pend.set(id, { ok: r => { clearTimeout(timer); ok(r); }, ko: e => { clearTimeout(timer); ko(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || expression);
    return r.result ? r.result.value : undefined;
  }
  async hold(code, key, vk, ms) {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(ms);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }
  async setRom(zip) {
    const doc = await this.send('DOM.getDocument', { depth: 2 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#romload input[type=file]' });
    if (!nodeId) throw new Error('rom picker not found');
    await this.send('DOM.setFileInputFiles', { nodeId, files: [zip] });
  }
}
async function launchChrome(i, url) {
  const dbg = 19601 + i, profile = '/tmp/ssr-cred-chrome-' + i;
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=old', '--no-sandbox', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--force-webrtc-ip-handling-policy=default_public_and_private_interfaces',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=960,540', '--remote-debugging-port=' + dbg, '--remote-allow-origins=*',
    '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitHttp(`http://127.0.0.1:${dbg}/json/version`, 25000);
  const pages = await waitHttp(`http://127.0.0.1:${dbg}/json/list`, 5000);
  const page = pages.find(p => p.type === 'page') || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.addEventListener('open', ok); ws.addEventListener('error', ko); setTimeout(() => ko(new Error('ws')), 10000); });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  if (url) await cdp.send('Page.navigate', { url });
  return { chrome, cdp };
}
async function waitReady(cdp, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const has = await cdp.eval(`!!document.querySelector('#romload input[type=file]')`);
    if (has) { await cdp.setRom(ZIP); break; }
    const ready = await cdp.eval(`!!(window.SSRG && SSRG.machine)`);
    if (ready) break;
    await sleep(200);
  }
  const t1 = Date.now();
  while (Date.now() - t1 < ms) {
    const st = await cdp.eval(`({ready: !!(window.SSRG && SSRG.machine), err: window.__ssrErr || null})`);
    if (st && st.err) throw new Error(st.err);
    if (st && st.ready) {
      try { await cdp.eval('SSRG.ready', true); } catch (e) {}
      return;
    }
    await sleep(200);
  }
  throw new Error('page not ready');
}
const INFO = `() => {
  const m = SSRG && SSRG.machine, N = window.SSRNETPLAY && SSRNETPLAY.session, rb = N && N.rb;
  const pos = p => window.SSRCHAT && SSRCHAT.playerPos(m, p);
  return {
    frame: m && m.frame, cred: m && m.ram && m.ram[0x800],
    slot: N && N.slot, delay: rb && rb.delay, maxRoll: rb && rb.maxRoll,
    stalls: rb && rb.stats.stalls, confirmed: rb && rb.confirmed, rbFrame: rb && rb.frame,
    desyncs: N && N.stats.desyncs, hashChecks: N && N.stats.hashChecks,
    peers: N && N.peers(),
    p1: pos(0), p2: pos(1),
  };
}`;

(async () => {
  if (!fs.existsSync(ZIP)) throw new Error('missing ROM zip (local only): ' + ZIP);
  fs.mkdirSync(OUT, { recursive: true });
  const phpPort = await new Promise(res => {
    const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
  const php = spawn('php', ['-S', '127.0.0.1:' + phpPort, '-t', ROOT], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { PHP_CLI_SERVER_WORKERS: '8' }) });
  const kids = [php];
  const cleanup = () => { for (const k of kids) try { k.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);
  await sleep(350);
  const SIG = process.env.SSR_SIGNAL || 'https://games4me.alwaysdata.net/simpsons/signal.php';
  const qs = `gfx=orig&mute=1&webgl=0&signal=${encodeURIComponent(SIG)}${NETSIM ? '&netsim=' + NETSIM : ''}`;
  const BASE = `http://127.0.0.1:${phpPort}/web/index.html?${qs}`;
  console.log('signal', SIG, 'netsim', NETSIM);
  try {
    const host = await launchChrome(0, BASE);
    kids.push(host.chrome);
    const guest = await launchChrome(1, BASE);
    kids.push(guest.chrome);
    await Promise.all([waitReady(host.cdp), waitReady(guest.cdp)]);
    await host.cdp.eval(`try { localStorage.setItem('simpsons_nick', 'HostP1'); } catch (e) {}`);
    await guest.cdp.eval(`try { localStorage.setItem('simpsons_nick', 'GuestP2'); } catch (e) {}`);
    const tF = Date.now();
    while (Date.now() - tF < 25000) {
      const f = await host.cdp.eval('SSRG.machine && SSRG.machine.frame');
      if (f >= 600) break;
      await sleep(200);
    }
    await host.cdp.eval('SSRNETPLAY.host()', true);
    await sleep(400);
    const room = await host.cdp.eval('SSRNETPLAY.state.room');
    if (!room) throw new Error('no room');
    console.log('room', room);
    await guest.cdp.eval(`SSRNETPLAY.join(${JSON.stringify(room)}, false)`, true);
    const tJ = Date.now();
    while (Date.now() - tJ < 40000) {
      const gs = await guest.cdp.eval("(" + INFO + ")()");
      if (gs && gs.slot === 1 && gs.rbFrame > 0) break;
      await sleep(300);
    }
    await sleep(1500);
    let hs = await host.cdp.eval("(" + INFO + ")()"), gs = await guest.cdp.eval("(" + INFO + ")()");
    const hMsg = await host.cdp.eval('SSRNETPLAY && SSRNETPLAY.state && SSRNETPLAY.state.msg');
    const gMsg = await guest.cdp.eval('SSRNETPLAY && SSRNETPLAY.state && SSRNETPLAY.state.msg');
    console.log('joined', { hs, gs, hMsg, gMsg });
    if (!hs || hs.slot !== 0 || !gs || gs.slot !== 1) {
      console.log('host logs', host.cdp.logs.slice(-20));
      console.log('guest logs', guest.cdp.logs.slice(-20));
      throw new Error('slots not filled');
    }

    for (const ev of [
      ['Digit5', '5', 0x35, 220, 'coin'],
      ['Digit1', '1', 0x31, 220, 'start'],
      ['KeyZ', 'z', 0x5A, 280, 'shot'],
    ]) {
      console.log('keys', ev[4]);
      await Promise.all([host.cdp.hold(ev[0], ev[1], ev[2], ev[3]), guest.cdp.hold(ev[0], ev[1], ev[2], ev[3])]);
      await sleep(700);
      hs = await host.cdp.eval("(" + INFO + ")()"); gs = await guest.cdp.eval("(" + INFO + ")()");
      console.log('after', ev[4], { host: hs, guest: gs });
    }

    const tS = Date.now();
    while (Date.now() - tS < 35000) {
      hs = await host.cdp.eval("(" + INFO + ")()"); gs = await guest.cdp.eval("(" + INFO + ")()");
      if (hs.p1 && hs.p2 && gs.p1 && gs.p2) break;
      await sleep(500);
    }
    console.log('final', { hs, gs });
    const shot = async (cdp, name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const dest = path.join(OUT, name);
      fs.writeFileSync(dest, Buffer.from(r.data, 'base64'));
      console.log('wrote', dest, fs.statSync(dest).size);
    };
    await shot(host.cdp, 'net_credits_host.png');
    await shot(guest.cdp, 'net_credits_guest.png');

    const fails = [];
    if ((hs.cred || 0) < 1 && !hs.p1) fails.push('host credits still 0 and P1 not in game');
    if ((gs.cred || 0) < 1 && !gs.p1) fails.push('guest credits still 0 and nobody in game');
    if (hs.desyncs > 0 || gs.desyncs > 0) fails.push('desyncs host=' + hs.desyncs + ' guest=' + gs.desyncs);
    if ((hs.hashChecks || 0) < 1) fails.push('no hash checks');
    if (!hs.p1 || !hs.p2) fails.push('host missing P1/P2 positions (not in stage/select?) frame=' + hs.frame + ' cred=' + hs.cred);
    if (!gs.p1 || !gs.p2) fails.push('guest missing P1/P2 positions frame=' + gs.frame + ' cred=' + gs.cred);
    if (hs.delay < 8) fails.push('delay did not adapt to high RTT: ' + hs.delay);
    if (gs.delay < 8) fails.push('guest delay did not adapt: ' + gs.delay);
    if (host.cdp.exceptions.length || guest.cdp.exceptions.length)
      fails.push('exceptions ' + host.cdp.exceptions.concat(guest.cdp.exceptions).join(' | '));
    if (fails.length) { console.error('FAIL', fails); process.exitCode = 1; }
    else console.log('PASS netplay credits/start/stage1', { delay: hs.delay, maxRoll: hs.maxRoll, frame: hs.frame, cred: hs.cred, hashChecks: hs.hashChecks, rtt: hs.peers });
  } finally { cleanup(); }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
