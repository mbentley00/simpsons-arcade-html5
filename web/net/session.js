// Netplay session (star topology: every guest talks only to the host, who relays inputs). Transport-agnostic: a link
// is { send(obj, reliable), onmsg(obj), onclose(), close() } (see link.js); the game loop calls tick(localInput).
// Host: slot 0, owns the roster (join/leave frame per slot) and the reference state hashes; a guest that joins
// (or desyncs) gets the host's confirmed snapshot. Guests keep their frame near the host's estimated frame.
(function (G) {
  'use strict';
  const NODE = typeof require !== 'undefined';
  const RB = NODE ? require('./rollback.js') : G.SSRROLL, SNAP = NODE ? require('./snap.js') : G.SSRSNAP;
  const { Rollback, INF } = RB, NS = 4, MAXSPEC = 4;
  const now = () => performance.now();
  // Chat (outside the simulation: never touches the rollback inputs, snapshots or hashes). Plain text only, 60 chars.
  const CHAT_MAX = 60, CHAT_GAP = 700, CHAT_WIN = 10000, CHAT_PER_WIN = 5;
  function sanitize(t) { return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX).trim(); }
  const NICK_MAX = 12;
  function cleanNick(t) { return sanitize(t).replace(/[^\p{L}\p{N} _.!?'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX).trim(); }
  function RateLimit() { this.t = []; }
  RateLimit.prototype.ok = function (t) { this.t = this.t.filter(x => t - x < CHAT_WIN); if (this.t.length >= CHAT_PER_WIN || (this.t.length && t - this.t[this.t.length - 1] < CHAT_GAP)) return false; this.t.push(t); return true; };
  const b64 = { enc(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
    dec(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } };
  function Session(o) {
    this.m = o.m; this.step = o.step; this.role = o.role; this.STEP = o.stepMs || 1000 / 59.1856;
    this.delay = o.delay ?? 2; this.maxRoll = o.maxRoll ?? 8; this.hashEvery = o.hashEvery ?? 60; this.joinLead = o.joinLead ?? 30;
    this.lockDelay = !!o.lockDelay;
    this.name = cleanNick(o.name || ''); this.links = []; this.rb = null; this.slot = -1; this.ev = o.onEvent || (() => {}); this.audio = o.onAudio || null;
    this.chatRl = [new RateLimit(), new RateLimit(), new RateLimit(), new RateLimit()];
    this.hashes = new Map(); this.stats = { resyncs: 0, desyncs: 0, hashChecks: 0, sent: 0, recv: 0, bytesState: 0, specDesyncs: 0, specHashChecks: 0 };
    // spectators (pt40u): no input slot (slot -1), simulate only fully confirmed frames; host caps them at MAXSPEC
    this.spec = false; this.vaga = false; this.specList = []; this.specRl = new RateLimit(); this.nextSid = 1;
    if (this.role === 'host') this.startRb(o.frame, 0, [o.frame, INF, INF, INF], [INF, INF, INF, INF]);
  }
  const P = Session.prototype;
  P.startRb = function (F, slot, join, leave) {
    this.slot = slot;
    this.rb = new Rollback(this.m, { step: this.step, slot, delay: this.delay, maxRoll: this.maxRoll, hashEvery: this.hashEvery, frame: F, join, leave,
      onHash: (f, h) => this.onHash(f, h), onAudio: (s, f) => this.audio && this.audio(s, f) }); // f: the confirmed frame (game.js netAudio keys PCM by frame)
  };
  P.addLink = function (link) {
    const L = { link, slot: -1, spec: false, sid: 0, rl: null, hc: 0, dc: 0, ack: [-1, -1, -1, -1], rtt: 0, f: 0, fT: 0, lastPing: 0, echo: 0, echoT: 0, lastState: -1e9, name: '' };
    this.links.push(L);
    link.onmsg = msg => this.onMsg(L, msg);
    link.onclose = () => this.drop(L);
    if (this.role === 'guest') link.send({ t: 'hello', name: this.name || '' }, true);
    return L;
  };
  P.drop = function (L) {
    const i = this.links.indexOf(L); if (i < 0) return; this.links.splice(i, 1);
    if (this.role === 'host' && L.slot > 0 && this.rb) {
      const rb = this.rb, leave = rb.leave.slice(); leave[L.slot] = Math.max(rb.known[L.slot] + 1, rb.join[L.slot]); rb.setRoster(rb.join, leave);
    }
    if (this.role === 'host' && L.spec) { this.ev({ t: 'specleft', name: L.name }); this.sendWho(); return; }
    this.ev({ t: this.role === 'host' ? 'left' : 'hostgone', slot: L.slot });
    if (this.role === 'host') this.sendWho();
  };
  // host: spectator names to everyone (reliable, on change)
  // nicknames per slot (host: own name + links; guest: from the host's 'who')
  P.names = function () {
    if (this.role !== 'host') return this.nameList || ['', '', '', ''];
    const P = (typeof navigator !== 'undefined' && /^pt/i.test(navigator.language || '')) ? 'Jogador ' : 'Player ', n = [this.name || P + 1, '', '', '']; for (const l of this.links) if (l.slot > 0) n[l.slot] = l.name || P + (l.slot + 1); return n;
  };
  P.setName = function (x) { this.name = cleanNick(x); if (this.role === 'host') this.sendWho(); else if (this.links[0]) this.links[0].link.send({ t: 'nick', name: this.name }, true); };
  P.spectators = function () { return this.role === 'host' ? this.links.filter(l => l.spec).map(l => l.name) : this.specList; };
  P.sendWho = function () { const sp = this.spectators(); const pl = this.names(); for (const L of this.links) L.link.send({ t: 'who', sp, pl }, true); this.ev({ t: 'who' }); };
  // host: give link L a player slot s (new guest or promoted spectator)
  P.seat = function (L, s) {
    const rb = this.rb, join = rb.join.slice(), leave = rb.leave.slice(), was = L.spec;
    L.slot = s; L.spec = false; L.ack = [-1, -1, -1, -1]; join[s] = rb.frame + this.joinLead; leave[s] = INF; rb.setRoster(join, leave);
    for (const f of [...rb.inp[s].keys()]) if (f >= rb.leave[s] || f >= join[s]) rb.inp[s].delete(f); rb.known[s] = join[s] - 1; // keep the old window's inputs (rollbacks may replay it)
    this.sendState(L); this.ev({ t: was ? 'promoted' : 'joined', slot: s, name: L.name }); if (was) this.sendWho();
  };
  // guest: room was full, watch instead / spectator: take a free player slot
  P.watch = function () { const L = this.links[0]; if (L) L.link.send({ t: 'hello', name: this.name || '', watch: 1 }, true); };
  P.promote = function () { const L = this.links[0]; if (L && this.spec && this.vaga) { this.vaga = false; L.link.send({ t: 'promote' }, true); return true; } return false; };
  P.freeSlot = function () { for (let s = 1; s < NS; s++) if (!this.links.some(l => l.slot === s) && (this.rb.join[s] === INF || this.rb.leave[s] !== INF)) return s; return -1; };
  P.sendState = function (L) {
    const st = this.rb.exportState(), bin = SNAP.pack(st.snap);
    this.stats.bytesState += bin.length; L.lastState = now();
    L.link.send({ t: 'state', slot: L.slot, F: st.F, join: st.join, leave: st.leave, inputs: st.inputs, past: st.past, snap: b64.enc(bin), hf: this.rb.frame }, true);
  };
  P.onMsg = function (L, msg) {
    this.stats.recv++;
    const t = now();
    if (msg.p !== undefined) { L.echo = msg.p; L.echoT = t; if (msg.e) { const r = t - msg.e - (msg.ed || 0); L.rtt = L.rtt ? L.rtt * 0.9 + r * 0.1 : r; } }
    if (msg.f !== undefined) { L.f = msg.f; L.fT = t; }
    switch (msg.t) {
      case 'i': {
        if (msg.a) L.ack = msg.a;
        if (!this.rb) return;
        if (this.role === 'host') { if (L.slot > 0 && msg.d && msg.d[L.slot]) this.rb.addRemote(L.slot, msg.d[L.slot][0], msg.d[L.slot][1]); }
        else { if (msg.v !== undefined && this.spec) { const v = !!msg.v; if (v !== this.vaga) { this.vaga = v; this.ev({ t: 'vaga', v }); } }
          if (msg.r) this.rb.setRoster(msg.r[0], msg.r[1], msg.r[2]); for (const s in msg.d) if (+s !== this.slot) this.rb.addRemote(+s, msg.d[s][0], msg.d[s][1]); }
        break;
      }
      case 'hello': { // host: a guest wants in
        if (this.role !== 'host') return;
        if (L.slot > 0 || L.spec) return;
        L.name = cleanNick(msg.name); const s = this.freeSlot();
        if (s >= 0 && !msg.watch) { this.seat(L, s); this.sendWho(); break; }
        const nspec = this.links.filter(l => l.spec).length;
        if (!msg.watch || nspec >= MAXSPEC) { L.link.send({ t: 'full', watch: nspec < MAXSPEC ? 1 : 0 }, true); return; }
        L.spec = true; L.sid = this.nextSid++; L.rl = new RateLimit(); if (!L.name) L.name = 'Espectador ' + L.sid; L.autoName = !msg.name;
        this.sendState(L); this.ev({ t: 'spectator', name: L.name }); this.sendWho();
        break;
      }
      case 'promote': { // host: a spectator takes a free slot (first come first served)
        if (this.role !== 'host' || !L.spec) return;
        const s = this.freeSlot(); if (s < 0) return; // the 'v' flag in the next input message tells it the slot is gone
        this.seat(L, s); break;
      }
      case 'who': if (this.role !== 'host') { this.specList = (msg.sp || []).map(x => sanitize(x).slice(0, 20)).slice(0, MAXSPEC); this.nameList = [0, 1, 2, 3].map(i => cleanNick((msg.pl || [])[i])); this.ev({ t: 'who' }); } break;
      case 'nick': if (this.role === 'host') { const n = cleanNick(msg.name); L.name = n || (L.spec ? 'Espectador ' + L.sid : ''); this.sendWho(); } break;
      case 'state': { // guest: (re)load the host's state
        const snap = SNAP.unpack(b64.dec(msg.snap));
        if (!this.rb) this.startRb(msg.F, msg.slot, msg.join, msg.leave);
        if (this.rb.slot !== msg.slot && msg.slot >= 0) { const I = this.rb.inp[msg.slot]; for (const f of [...I.keys()]) if (f >= msg.join[msg.slot]) I.delete(f); } // promoted: drop predictions in the new window, keep the old player's
        this.slot = this.rb.slot = msg.slot; this.spec = msg.slot < 0; if (!this.spec) this.vaga = false;
        this.rb.loadState(msg.F, snap, msg.join, msg.leave, msg.inputs, msg.past);
        L.f = msg.hf; L.fT = t;
        this.stats.resyncs++; this.ev({ t: 'state', slot: msg.slot, F: msg.F, snap });
        break;
      }
      case 'h': { // host: a guest's hash of a confirmed frame
        if (this.role !== 'host') return;
        const mine = this.hashes.get(msg.f);
        if (mine === undefined) { (L.pend || (L.pend = [])).push([msg.f, msg.h]); return; }
        this.checkHash(L, msg.f, msg.h, mine);
        break;
      }
      case 'full': this.ev({ t: 'full', watch: !!msg.watch }); break;
      case 'c': { // chat: guest -> host (slot taken from the link, not the message) -> relayed to every other guest
        const x = sanitize(msg.x); if (!x) return;
        if (this.role === 'host') {
          if (L.spec) { // spectator line: tagged with its name, never on a character
            if (!L.rl.ok(t)) return;
            for (const o of this.links) if (o !== L && (o.slot > 0 || o.spec)) o.link.send({ t: 'c', s: -1, n: L.name, x }, true);
            this.ev({ t: 'chat', slot: -1, name: L.name, text: x }); return;
          }
          if (L.slot < 1 || !this.chatRl[L.slot].ok(t)) return;
          for (const o of this.links) if (o !== L && (o.slot > 0 || o.spec)) o.link.send({ t: 'c', s: L.slot, x }, true);
          this.ev({ t: 'chat', slot: L.slot, text: x });
        } else {
          const s = msg.s | 0;
          if (s === -1) { if (L === this.links[0]) this.ev({ t: 'chat', slot: -1, name: sanitize(msg.n).slice(0, 20) || 'Espectador', text: x }); }
          else if (s >= 0 && s < NS && s !== this.slot) this.ev({ t: 'chat', slot: s, text: x });
        }
        break;
      }
    }
  };
  P.checkHash = function (L, f, h, mine) {
    if (L.spec) this.stats.specHashChecks++; else this.stats.hashChecks++;
    L.hc++; if (h === mine) return;
    L.dc++; if (L.spec) this.stats.specDesyncs++; else this.stats.desyncs++; this.ev({ t: 'desync', slot: L.slot, spec: L.spec, f });
    if (now() - L.lastState > 2000) this.sendState(L);
  };
  P.onHash = function (f, h) {
    if (this.role === 'host') {
      this.hashes.set(f, h); this.hashes.delete(f - 60 * this.hashEvery);
      for (const L of this.links) if (L.pend) { L.pend = L.pend.filter(([pf, ph]) => { if (pf === f) { this.checkHash(L, pf, ph, h); return false; } return pf > f; }); }
    } else { const L = this.links[0]; if (L) L.link.send({ t: 'h', f, h }, false); this.lastHash = [f, h]; }
  };
  // estimated current frame of the host (guest side)
  P.hostFrame = function () { const L = this.links[0]; return L ? L.f + (now() - L.fT + L.rtt / 2) / this.STEP : 0; };
  // Size the input delay to one-way latency so frames are scheduled early enough to arrive
  // before the peer simulates them. delay=2 + maxRoll=8 stalls constantly around 400–500 ms RTT,
  // and addLocal cannot record a tap once the lookahead window is already filled with 0.
  P.adaptDelay = function () {
    if (this.lockDelay || !this.rb) return;
    let rtt = 0;
    for (const L of this.links) if (L.rtt > rtt) rtt = L.rtt;
    if (rtt < 40) return;
    const d = Math.max(2, Math.min(24, Math.round((rtt / 2) / this.STEP) + 2));
    const mr = Math.max(this.maxRoll, d + 8);
    if (d > this.rb.delay) this.rb.delay = this.delay = d;
    if (mr > this.rb.maxRoll) this.rb.maxRoll = this.maxRoll = mr;
  };
  // one real-time tick: returns the number of frames simulated
  P.tick = function (local) {
    if (!this.rb) { this.sendAll(); return 0; }
    this.adaptDelay();
    if (this.spec) return this.specTick();
    let n = 1;
    if (this.role === 'guest') {
      const d = this.hostFrame() - this.rb.frame;
      n = d > 8 ? Math.min(12, Math.floor(d)) : d > 1.5 ? 2 : d < -1.5 ? 0 : 1;
    }
    let done = 0;
    for (let i = 0; i < n; i++) { this.rb.addLocal(local); if (this.rb.advance()) done++; }
    if (!n) this.rb.addLocal(local);
    this.sendAll(); return done;
  };
  // spectator: only frames whose inputs are all known (never predicts, never rolls back); keeps a small buffer for jitter
  P.specTick = function () {
    const rb = this.rb; let k = INF; for (let s = 0; s < NS; s++) k = Math.min(k, rb.knownTo(s));
    const avail = k - rb.frame + 1, n = avail > 24 ? Math.min(12, avail - 4) : avail > 6 ? 2 : avail > 0 ? 1 : 0;
    let done = 0; for (let i = 0; i < n; i++) { rb.sim(rb.frame++); rb.stats.frames++; done++; }
    if (!n) rb.stats.stalls++;
    rb.confirm(); this.sendAll(); return done;
  };
  P.sendAll = function () {
    const t = now(), rb = this.rb;
    for (const L of this.links) {
      const msg = { t: 'i', f: rb ? rb.frame : 0, p: t };
      if (L.echoT) { msg.e = L.echo; msg.ed = t - L.echoT; }
      if (rb) {
        msg.a = rb.known.slice(); msg.d = {};
        if (this.spec) { L.link.send(msg, false); this.stats.sent++; continue; } // a spectator has no inputs to send
        if (this.role === 'host' && L.spec) msg.v = this.freeSlot() >= 0 ? 1 : 0;
        for (let s = 0; s < NS; s++) {
          if (this.role === 'host' ? s === L.slot : s !== this.slot) continue;
          if (rb.join[s] === INF) continue;
          const f0 = Math.max(L.ack[s] + 1, rb.join[s]);
          if (f0 <= rb.known[s]) msg.d[s] = [f0, rb.range(s, f0, 48)];
        }
        if (this.role === 'host') msg.r = [rb.join, rb.leave, rb.past];
      }
      L.link.send(msg, false); this.stats.sent++;
    }
  };
  // send a chat line from this player; returns the sanitized text (null if empty, not in a slot yet or rate limited)
  P.chat = function (text) {
    const x = sanitize(text); if (!x) return null;
    if (this.spec) {
      if (!this.specRl.ok(now()) || !this.links[0]) return null;
      this.links[0].link.send({ t: 'c', s: -1, x }, true); this.ev({ t: 'chat', slot: -1, name: this.name || 'Você', text: x, self: true }); return x;
    }
    if (this.slot < 0 || !this.chatRl[this.slot].ok(now())) return null;
    const msg = { t: 'c', s: this.slot, x };
    for (const L of this.links) if (this.role === 'guest' || L.slot > 0 || L.spec) L.link.send(msg, true);
    this.ev({ t: 'chat', slot: this.slot, text: x, self: true });
    return x;
  };
  P.peers = function () { return this.links.map(L => ({ slot: L.slot, spec: L.spec, name: L.name, rtt: Math.round(L.rtt), hc: L.hc, dc: L.dc })); };
  const api = { Session, b64, sanitize, cleanNick, RateLimit, CHAT_MAX, MAXSPEC, NICK_MAX };
  if (NODE) module.exports = api; else G.SSRSESSION = api;
})(typeof window !== 'undefined' ? window : globalThis);
