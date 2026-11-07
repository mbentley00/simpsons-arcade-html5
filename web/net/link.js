// Links: { send(obj, reliable), onmsg, onclose, close() } over two raw string channels (unreliable + reliable).
// Big reliable messages are cut into 16 KB chunks (DataChannel message size limits). Optional network simulator
// (latency/jitter/loss on send) for tests: ?netsim=latencyMs,jitterMs,lossPercent.
(function (G) {
  'use strict';
  const CHUNK = 16000;
  function makeLink(sendU, sendR, close, sim) {
    let rq = 0; const parts = new Map();
    const L = { onmsg: null, onclose: null, close: close || (() => {}), sim: sim || null, bytesOut: 0, bytesIn: 0, dropped: 0 };
    const raw = (s, rel) => {
      L.bytesOut += s.length;
      const go = () => { try { (rel ? sendR : sendU)(s); } catch (e) { /* channel closing */ } };
      const ns = L.sim; if (!ns) return go();
      if (!rel && Math.random() * 100 < ns.loss) { L.dropped++; return; }
      let d = ns.lat + (Math.random() * 2 - 1) * ns.jit; if (d < 0) d = 0;
      if (rel) { const t = performance.now() + d; rq = Math.max(rq, t); setTimeout(go, rq - performance.now()); } else setTimeout(go, d);
    };
    L.send = (obj, rel) => {
      const s = JSON.stringify(obj);
      if (!rel || s.length <= CHUNK) return raw(s, rel);
      const id = Math.random().toString(36).slice(2), n = Math.ceil(s.length / CHUNK);
      for (let i = 0; i < n; i++) raw(JSON.stringify({ t: '#', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }), true);
    };
    L.recv = s => {
      L.bytesIn += s.length;
      let m; try { m = JSON.parse(s); } catch (e) { return; }
      if (m.t === '#') {
        let p = parts.get(m.id); if (!p) parts.set(m.id, p = []); p[m.i] = m.d;
        if (p.filter(x => x !== undefined).length < m.n) return;
        parts.delete(m.id); m = JSON.parse(p.join(''));
      }
      if (L.onmsg) L.onmsg(m);
    };
    return L;
  }
  function parseSim(s) { if (!s) return null; const [lat, jit, loss] = s.split(',').map(Number); return { lat: lat || 0, jit: jit || 0, loss: loss || 0 }; }
  // in-memory pair (tests)
  function pair(simA, simB) {
    let a, b;
    a = makeLink(s => b.recv(s), s => b.recv(s), () => { b.onclose && b.onclose(); }, simA);
    b = makeLink(s => a.recv(s), s => a.recv(s), () => { a.onclose && a.onclose(); }, simB);
    return [a, b];
  }
  const api = { makeLink, parseSim, pair };
  if (typeof module !== 'undefined') module.exports = api; else G.SSRLINK = api;
})(typeof window !== 'undefined' ? window : globalThis);
