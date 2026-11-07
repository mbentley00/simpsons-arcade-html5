// Netplay transports. Each one opens a room as host or guest and hands WebRTC links (link.js) to the session:
//   const t = await SSRNET.open('php' | 'peerjs', { room, role, signal, ice, sim }); t.onlink = link => ...; t.close()
// 'php'   : our signal.php (polling, files) relays offer/answer/ICE; two negotiated DataChannels per peer:
//           id 0 unordered + maxRetransmits 0 (inputs, sent redundantly), id 1 reliable ordered (state, control).
// 'peerjs': the free PeerJS cloud broker (0.peerjs.com) does signaling; two DataConnections per peer (raw strings).
// Star topology: guests connect only to the host.
(function (G) {
  'use strict';
  const LINK = G.SSRLINK;
  const DEFAULT_SIGNAL = 'https://games4me.alwaysdata.net/simpsons/signal.php';
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  // TURN, when a direct path fails, comes only from signal.php (?a=ice): short-lived credentials minted
  // on that server. This file holds no relay secret and does not fall back to another provider.
  let turnCache = null;
  function iceServer(x) {
    if (!x || typeof x.username !== 'string' || typeof x.credential !== 'string' || !x.credential) return null;
    const urls = [].concat(x.urls).filter(u => typeof u === 'string' && /^turns?:[^\s<>"']+$/i.test(u));
    return urls.length ? { urls, username: x.username, credential: x.credential } : null;
  }
  async function getTurn(signalUrl) {
    if (turnCache) return turnCache;
    const out = [];
    try {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 5000);
      const r = await fetch((signalUrl || DEFAULT_SIGNAL) + '?a=ice', { cache: 'no-store', credentials: 'omit', mode: 'cors', signal: ac.signal });
      clearTimeout(tm);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.ok && Array.isArray(j.ice)) for (const x of j.ice) { const s = iceServer(x); if (s) out.push(s); }
      turnCache = out;
    } catch (e) { console.warn('[ssr-net] ?a=ice', e.message); }
    console.log('[ssr-net] TURN servers:', out.map(x => x.urls[0]));
    return out;
  }
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- PHP polling signaling ----------
  function PhpSignal(url, room, id) { this.url = url; this.room = room; this.id = id; this.onmsg = null; this.alive = true; this.fast = 0; }
  PhpSignal.prototype.req = async function (a, extra, body) {
    const u = `${this.url}?a=${a}&room=${this.room}&id=${this.id}${extra || ''}`;
    const r = await fetch(u, body === undefined ? { cache: 'no-store' } : { method: 'POST', body, cache: 'no-store' });
    const j = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
    if (!j.ok) throw new Error(j.error || 'signal error');
    return j;
  };
  PhpSignal.prototype.send = function (to, msg) { this.fast = 20; return this.req('send', '&to=' + to, JSON.stringify(msg)).catch(e => console.warn('signal send', e.message)); };
  PhpSignal.prototype.loop = async function () {
    while (this.alive) {
      let extra = '';
      if (this.meta && Date.now() - (this.metaT || 0) >= 5000) { const m = this.meta(); if (m) { extra = '&meta=' + encodeURIComponent(JSON.stringify(m)); this.metaT = Date.now(); } }
      try { const j = await this.req('poll', extra); for (const m of j.msgs) { let d; try { d = JSON.parse(m.msg); } catch (e) { continue; } if (this.onmsg) this.onmsg(m.from, d); if (j.msgs.length) this.fast = 20; } }
      catch (e) { console.warn('signal poll', e.message); await sleep(2000); }
      await sleep(this.fast > 0 ? (this.fast--, 300) : 1500); // short polling while a connection is being set up
    }
  };
  PhpSignal.prototype.close = function () { this.alive = false; this.req('leave', '', '').catch(() => {}); };

  // one RTCPeerConnection to `peer` with the two negotiated channels; signaling messages {sdp} / {ice}
  function rtcLink(sig, peer, initiator, ice, sim, onopen, policy, simnat) {
    // test hook ?simnat=1: drop non-relay candidates both ways (CGNAT on both sides); 2: also drop everything unless policy relay
    const keep = c => !simnat || (/ typ relay/.test(c.candidate || '') && (simnat < 2 || policy === 'relay'));
    const pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: policy || 'all' });
    const tag = `[ssr-net ${peer.slice(0, 6)}${policy === 'relay' ? ' relay' : ''}]`, cand = { host: 0, srflx: 0, relay: 0, prflx: 0 };
    pc.oniceconnectionstatechange = () => console.log(tag, 'ice', pc.iceConnectionState);
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') console.log(tag, 'local candidates', JSON.stringify(cand)); };
    pc.onicecandidateerror = e => console.log(tag, 'candidate error', e.url, e.errorCode, e.errorText);
    const cu = pc.createDataChannel('u', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    const cr = pc.createDataChannel('r', { negotiated: true, id: 1, ordered: true });
    const link = LINK.makeLink(s => cu.readyState === 'open' && cu.send(s), s => cr.readyState === 'open' && cr.send(s), () => pc.close(), sim);
    let open = 0, closed = false;
    const opened = () => { if (++open === 2) { link.opened = true; onopen(link); } };
    cu.onopen = opened; cr.onopen = opened;
    cu.onmessage = e => link.recv(e.data); cr.onmessage = e => link.recv(e.data);
    const close = () => { if (closed) return; closed = true; if (link.onclose) link.onclose(); try { pc.close(); } catch (e) {} };
    cr.onclose = close;
    pc.onconnectionstatechange = () => { console.log(tag, 'connection', pc.connectionState); link.state = pc.connectionState;
      if (pc.connectionState === 'connected') pc.getStats().then(r => r.forEach(x => { if (x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded') {
        const l = r.get(x.localCandidateId), m = r.get(x.remoteCandidateId); link.path = (l && l.candidateType) + '>' + (m && m.candidateType); console.log(tag, 'path', l && l.candidateType, l && l.protocol, '->', m && m.candidateType); } })).catch(() => {});
      if (['failed', 'closed'].includes(pc.connectionState)) { link.failed = true; close(); } };
    pc.onicecandidate = e => { if (e.candidate) { const ty = (/ typ (\w+)/.exec(e.candidate.candidate) || [])[1]; if (ty in cand) cand[ty]++; if (keep(e.candidate)) sig.send(peer, { ice: e.candidate.toJSON() }); } };
    link.signal = async d => {
      if (d.sdp) {
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); sig.send(peer, { sdp: pc.localDescription.toJSON() }); }
        for (const c of link.pendingIce || []) await pc.addIceCandidate(c).catch(() => {}); link.pendingIce = null;
      } else if (d.ice) { if (!keep(d.ice)) return; if (!pc.remoteDescription) (link.pendingIce || (link.pendingIce = [])).push(d.ice); else await pc.addIceCandidate(d.ice).catch(() => {}); }
    };
    if (initiator) (async () => { await pc.setLocalDescription(await pc.createOffer()); sig.send(peer, { sdp: pc.localDescription.toJSON() }); })();
    link.pc = pc; link.t0 = Date.now(); return link;
  }

  async function openPhp(o) {
    const id = rid(), sig = new PhpSignal(o.signal || DEFAULT_SIGNAL, o.room, id), t = { onlink: null, kind: 'php', id, close() { sig.close(); for (const l of peers.values()) l.close(); } };
    const peers = new Map(), ice = o.ice || ICE, early = new Map();
    t.pending = () => { let n = 0; for (const l of peers.values()) if (!l.opened && !l.failed && Date.now() - l.t0 < 60000) n++; return n; };
    if (o.meta) sig.meta = o.meta; // host of a public room: () => {n, p, s, st} piggybacked on the poll every 5 s
    const give = l => { if (t.onlink) t.onlink(l); };
    if (o.role === 'host') {
      await sig.req('host', '', '');
      // ICE candidates may overtake the offer (separate POSTs): keep them until the offer arrives (bug before pt77u: dropped)
      sig.onmsg = (from, d) => { let l = peers.get(from);
        if (!l) { if (!d.sdp) { if (d.ice) { const a = early.get(from) || []; if (a.length < 64) a.push(d); early.set(from, a); if (early.size > 32) early.delete(early.keys().next().value); } return; }
          l = rtcLink(sig, from, false, ice, o.sim, give, undefined, o.simnat); peers.set(from, l); console.log('[ssr-net] host: guest', from.slice(0, 6), 'is connecting');
          l.signal(d); for (const e of early.get(from) || []) l.signal(e); early.delete(from); return; }
        l.signal(d); };
    } else {
      const j = await sig.req('join', '', '');
      const l = rtcLink(sig, j.host, true, ice, o.sim, give, o.policy, o.simnat); peers.set(j.host, l); t.link = l;
      sig.onmsg = (from, d) => { if (from === j.host) l.signal(d); };
    }
    sig.loop();
    return t;
  }

  // ---------- PeerJS cloud ----------
  async function loadPeerJS() {
    if (G.Peer) return;
    await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'; s.onload = ok; s.onerror = () => ko(new Error('PeerJS não carregou')); document.head.appendChild(s); });
  }
  async function openPeerJS(o) {
    await loadPeerJS();
    const pid = 'simpsons-' + o.room.toLowerCase();
    const peer = new G.Peer(o.role === 'host' ? pid : undefined, { config: { iceServers: o.ice || ICE }, debug: 1 });
    await new Promise((ok, ko) => { peer.on('open', ok); peer.on('error', ko); });
    const t = { onlink: null, kind: 'peerjs', id: peer.id, close() { peer.destroy(); } };
    const pairUp = (cu, cr) => {
      const link = LINK.makeLink(s => cu.open && cu.send(s), s => cr.open && cr.send(s), () => { cu.close(); cr.close(); }, o.sim);
      cu.on('data', d => link.recv(d)); cr.on('data', d => link.recv(d)); cr.on('close', () => link.onclose && link.onclose());
      if (t.onlink) t.onlink(link);
    };
    if (o.role === 'host') {
      const half = new Map();
      peer.on('connection', c => c.on('open', () => {
        const h = half.get(c.peer) || {}; h[c.label] = c; half.set(c.peer, h);
        if (h.u && h.r) { half.delete(c.peer); pairUp(h.u, h.r); }
      }));
    } else {
      const cu = peer.connect(pid, { label: 'u', reliable: false, serialization: 'raw' }), cr = peer.connect(pid, { label: 'r', reliable: true, serialization: 'raw' });
      let n = 0; const go = () => { if (++n === 2) pairUp(cu, cr); }; cu.on('open', go); cr.on('open', go);
    }
    return t;
  }

  // public room list from signal.php (?a=list); [] on any error (older signal.php without 'list' included)
  async function listRooms(url) {
    try { const r = await fetch((url || DEFAULT_SIGNAL) + '?a=list', { cache: 'no-store' }); const j = await r.json(); return j.ok && Array.isArray(j.rooms) ? j.rooms : []; }
    catch (e) { return null; }
  }
  function open(kind, o) { return kind === 'peerjs' ? openPeerJS(o) : openPhp(o); }
  G.SSRNET = { open, listRooms, getTurn, DEFAULT_SIGNAL, ICE, rid };
})(window);
