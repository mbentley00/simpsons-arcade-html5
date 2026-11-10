// Netcode check in node: N sessions (host + guests) with their own Machine, in-memory links with simulated latency,
// jitter and loss, scripted random play (coin + start to join, then moving/shooting). Guests join late (staggered).
// Checks: every confirmed-frame state hash reported by the guests matches the host's (no desync), and prints rollback stats.
// Spectators (SPEC > 0): they knock after all players are in, get {t:'full', watch}, choose watch(); spectators beyond
// MAXSPEC must get watch=0. Half-way, the last player leaves; spectator 1 must see the free slot, promote() and play.
// Checks: zero player desyncs, every spectator link hash-checked with zero mismatches, spectator chat seen by all,
// host frame rate unaffected (frames/ticks), promoted spectator plays (hash checks as a player after promotion).
// Usage: node test/net_check.js [PLAYERS=4] [SECONDS=30] [lat,jit,loss=60,20,5] [SPEC=0]
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const { Board } = require(R('web/sim/simpsons.js')), IN = require(R('web/input.js'));
const { Session } = require(R('web/net/session.js')), LINK = require(R('web/net/link.js'));
globalThis.btoa ??= s => Buffer.from(s, 'binary').toString('base64'); globalThis.atob ??= s => Buffer.from(s, 'base64').toString('binary');
const FILES = require(R('test/roms.js'))();
const NSPEC = +(process.argv[5] || 0), NP = +(process.argv[2] || 4), SEC = +(process.argv[3] || 30), SIM = LINK.parseSim(process.argv[4] || '60,20,5');
const STEP = 1000 / 59.1856;
function machine() { const m = new Board(FILES); m.audio = true; return m; }
const stepFn = m => (fi, f) => { IN.applyFrame(m, fi, 0); m.runFrames(1); m.drainAudio(); };
function bot(seed) { let x = seed * 2654435761 >>> 0, cur = 0, hold = 0, n = 0; return () => {
  n++; if (n % 600 === 30) return IN.COIN; if (n % 600 === 90 || n % 600 === 100) return IN.START;
  if (--hold <= 0) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; cur = [0, IN.L, IN.R, IN.U, IN.D, IN.FIRE, IN.FIRE | IN.R, IN.JUMP, IN.L | IN.FIRE][(x >>> 16) % 9]; hold = 5 + ((x >>> 8) % 40); }
  return cur; }; }
const peers = [];
const hm = machine(); hm.runFrames(599); hm.drainAudio(); // host has been playing alone for 10 s
const chats = []; // [peerIndex, slot, text]
const DB = new Map(); let dumped = false;
globalThis.NETDBG = process.env.NETDBG ? (rb, f, after) => { let e = DB.get(rb); if (!e) DB.set(rb, e = new Map()); const u = rb.used.get(f); e.set(f, { u: u ? Array.from(u) : null, s: f % 60 === 0 ? after : null, roster: JSON.stringify([rb.join, rb.leave, rb.past]) }); } : null;
function dumpDesync(f) { if (dumped) return; dumped = true; const H = DB.get(peers[0].s.rb);
  for (const [rb, e] of DB) { if (rb === peers[0].s.rb || !e.has(f)) continue;
    for (let g = f - 60; g <= f; g++) { const a = H.get(g), b = e.get(g); if (a && b && JSON.stringify(a.u) !== JSON.stringify(b.u)) { console.log('input differs slot', rb.slot, 'f', g, a.u, b.u, a.roster, b.roster); break; } }
    const A = H.get(f).s, B = e.get(f).s; if (A && B) for (const k of Object.keys(A)) if (JSON.stringify(A[k], (x, v) => typeof v === 'bigint' ? '' + v : (ArrayBuffer.isView(v) ? Array.from(v).join() : v)) !== JSON.stringify(B[k], (x, v) => typeof v === 'bigint' ? '' + v : (ArrayBuffer.isView(v) ? Array.from(v).join() : v))) console.log('  state field differs', rb.slot, k);
  } }
const onEv = i => e => { if (e.t === 'desync') { console.log('desync', e); if (globalThis.NETDBG) dumpDesync(e.f); } if (e.t === 'chat') chats.push([i, e.slot, e.text]);
  if (e.t === 'full' && peers[i]) { peers[i].full = e.watch ? 1 : 0; if (e.watch) peers[i].s.watch(); }
  if (e.t === 'vaga' && e.v && peers[i] && peers[i].promoteMe) peers[i].s.promote(); };
const host = new Session({ m: hm, step: stepFn(hm), role: 'host', frame: 601, name: 'Saulo', onEvent: onEv(0) });
peers.push({ s: host, input: bot(1) });
const t0 = performance.now(); let joined = 1;
function addGuest(i) {
  const NICKS = ['Saulo', '  <b>Zé</b>\u0007 do Rifle muito longo', '', 'Ana'];
  const m = machine(), s = new Session({ m, step: stepFn(m), role: 'guest', name: i < NP ? NICKS[i % 4] : '', onEvent: onEv(i) });
  const [a, b] = LINK.pair(SIM, SIM); host.addLink(a); s.addLink(b); peers.push({ s, input: bot(i + 1), link: b, isSpec: i >= NP, promoteMe: i === NP });
}
let rate0 = null, rateMark = null, rateLeave = null; let specJoined = 0, leftAt = 0, promotedAt = 0, promoHc0 = 0, specChat = null; const tickHostFrames = [];
let ticks = 0, chatSent = 0; const chatRes = {};
const timer = setInterval(() => {
  const el = performance.now() - t0;
  if (joined < NP && el > 2000 * joined) addGuest(joined++);
  if (joined === NP && specJoined < NSPEC && el > 2000 * NP + 6000 + 1000 * specJoined) { addGuest(NP + specJoined); specJoined++; }
  // half-way: the last player leaves, spectator 1 takes the slot
  if (NSPEC && !rate0 && el > 2000 * NP + 1000) rate0 = [ticks, host.rb.stats.frames];
  if (NSPEC && !rateMark && specJoined === 1) rateMark = [ticks, host.rb.stats.frames, host.rb.stats.stalls];
  if (NSPEC && !leftAt && el > SEC * 500) { rateLeave = [ticks, host.rb.stats.frames, host.rb.stats.stalls]; leftAt = el; const p = peers[NP - 1]; p.gone = true; p.link.close(); console.log('player', NP, 'left at', (el / 1000).toFixed(1), 's'); }
  if (NSPEC && !promotedAt && peers[NP] && !peers[NP].s.spec && peers[NP].s.slot > 0) { promotedAt = el; promoHc0 = host.peers().find(x => x.slot === peers[NP].s.slot).hc; console.log('spectator 1 promoted to slot', peers[NP].s.slot, 'at', (el / 1000).toFixed(1), 's'); }
  if (NSPEC && !specChat && specJoined === NSPEC && peers[NP + Math.min(NSPEC, 4) - 1].s.rb && el > 2000 * NP + 6000 + 1000 * NSPEC + 3000) specChat = peers[NP + Math.min(NSPEC, 4) - 1].s.chat('Que partida! <i>');
  for (const p of peers) if (!p.gone) p.s.tick(p.s.rb ? p.input() : 0);
  ticks++;
  // chat (outside the sim): a guest and the host talk once everyone is in; a spam burst must be rate limited
  if (joined === NP && !chatSent && el > 2000 * NP + 3000 && peers.every(p => p.s.rb && p.s.slot >= 0)) {
    chatSent = el;
    chatRes.g = peers[1].s.chat('  Bora <b>x</b>\u0007 cobrir\n a direita!  ' + 'x'.repeat(80));
    chatRes.h = peers[0].s.chat('Valeu!');
    chatRes.spam = [1, 2, 3, 4, 5, 6].map(k => peers[NP - 1].s.chat('spam ' + k)).filter(Boolean).length;
  }
  if (el > SEC * 1000) {
    clearInterval(timer);
    const out = peers.filter(p => p.s.rb).map((p, i) => ({ peer: i, slot: p.s.slot, frame: p.s.rb && p.s.rb.frame, confirmed: p.s.rb && p.s.rb.confirmed, ...p.s.rb.stats,
      msSim: +(p.s.rb.stats.msSim / p.s.rb.stats.frames).toFixed(3), msSave: +(p.s.rb.stats.msSave / p.s.rb.stats.frames).toFixed(3), resyncs: p.s.stats.resyncs }));
    console.table(out);
    console.log('host hash checks', host.stats.hashChecks, 'desyncs', host.stats.desyncs, 'state bytes', host.stats.bytesState, 'rtt', host.peers());
    // final cross-check: every guest's last confirmed hash equals the host's for that frame
    let bad = 0; for (const p of peers.slice(1)) { const [f, h] = p.s.lastHash || []; if (host.hashes.has(f) && host.hashes.get(f) !== h) bad++; }
    // chat: every peer saw the guest's line as slot 1 (sanitized), every peer saw the host's line as slot 0
    const want = 'Bora <b>x</b> cobrir a direita! ' + 'x'.repeat(80);
    const gtext = want.slice(0, 60).trim(), seen = (txt, slot) => peers.slice(0, NP).map((_, i) => chats.some(c => c[0] === i && c[1] === slot && c[2] === txt));
    const cg = seen(gtext, 1), ch = seen('Valeu!', 0);
    const chatOk = !NP || NP < 2 || (chatSent && chatRes.g === gtext && cg.every(Boolean) && ch.every(Boolean) && chatRes.spam === 1);
    console.log('chat sent at', (chatSent / 1000).toFixed(1), 's; guest line', JSON.stringify(chatRes.g), 'seen by', cg, '; host line seen by', ch, '; spam allowed', chatRes.spam, 'of 6', chatOk ? 'OK' : 'BAD');
    console.log('host frames/ticks', (host.rb.stats.frames / ticks).toFixed(3), 'host stalls', host.rb.stats.stalls, 'ticks', ticks);
    // nicknames: sanitized, defaults, identical on every peer (players and spectators); a promoted spectator's slot shows its name
    const wantN = host.names(), nickPeers = peers.filter(p => !p.gone && p.s.rb);
    const nickOk = wantN[0] === 'Saulo' && (NP < 2 || wantN[1] === 'bZéb do Rifl') && nickPeers.every(p => JSON.stringify(p.s.names()) === JSON.stringify(wantN))
      && wantN.every(n => n.length <= 12 && !/[<>\u0000-\u001f]/.test(n)) && (NP < 3 || ['Jogador 3', 'Player 3'].includes(wantN[2]));
    console.log('nicks', JSON.stringify(wantN), 'same on', nickPeers.length, 'peers:', nickOk ? 'OK' : 'BAD', nickPeers.map(p => JSON.stringify(p.s.names())).filter(x => x !== JSON.stringify(wantN)));
    let specOk = nickOk;
    if (NSPEC) {
      const hp = host.peers(), specs = peers.slice(NP).map((p, k) => ({ k, full: p.full, spec: p.s.spec, slot: p.s.slot, frame: p.s.rb && p.s.rb.frame, stalls: p.s.rb && p.s.rb.stats.stalls, resyncs: p.s.stats.resyncs, lag: p.s.rb ? host.rb.frame - p.s.rb.frame : null }));
      console.table(specs);
      const specLinks = hp.filter(x => x.spec); console.log('spectator links (host view)', specLinks, 'spec hash checks', host.stats.specHashChecks, 'spec desyncs', host.stats.specDesyncs);
      const nWatch = Math.min(NSPEC, 4), extra = NSPEC - nWatch;
      const promo = peers[NP], promoLink = hp.find(x => x.slot === promo.s.slot);
      const r0 = (rateMark[1] - rate0[1]) / (rateMark[0] - rate0[0]), r1 = (rateLeave[1] - rateMark[1]) / (rateLeave[0] - rateMark[0]), ratio = r1 / r0; // host rate with spectators vs before
      console.log('host frames/tick before spectators', r0.toFixed(3), 'with spectators', r1.toFixed(3));
      const scTxt = 'Que partida! <i>', scSeen = peers.map((p, i) => p.gone || i === NP + Math.min(NSPEC, 4) - 1 || p.full === 0 ? true : chats.some(c => c[0] === i && c[1] === -1 && c[2] === scTxt));
      const conds = { allKnocked: specs.every(x => x.full !== undefined), extrasRefused: specs.slice(nWatch).every(x => x.full === 0 && !x.spec),
        watchersSynced: specLinks.length === nWatch - 1 && specLinks.every(x => x.hc >= 3 && x.dc === 0), promoted: promotedAt > 0 && promo.s.slot === NP - 1,
        promotedPlays: !!promoLink && promoLink.hc - promoHc0 >= 3 && promoLink.dc === 0 && promo.s.stats.resyncs === 2, specChat: specChat === scTxt && scSeen.every(Boolean),
        hostRate: ratio > 0.9, playerDesyncs: host.stats.desyncs === 0 };
      console.log('host rate with/without spectators', ratio.toFixed(3), 'spectator chat seen', scSeen); console.log('spectator checks', conds);
      specOk = specOk && Object.values(conds).every(Boolean);
    }
    const ok = host.stats.desyncs === 0 && host.stats.hashChecks > 0 && bad === 0 && chatOk && specOk;
    console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
  }
}, STEP);
