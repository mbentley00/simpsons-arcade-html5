// Online play panel. F7 (or the "Online play" button) opens it. "Create room" makes this browser the host (player 1)
// and shows the invite link (?sala=CODE) with a copy button; opening the link joins as P2/P3/P4. In the game every
// player inserts a coin (5) and presses attack, like the arcade. English, or Portuguese when the browser asks for it.
// Signaling: the free PeerJS broker by default (no server of our own needed). ?signal=URL uses a copy of signal.php
// instead (needed for the public room list and relay credentials), ?net=php the default signal.php.
// Online rooms run the original game: a page with the offline Arcade Remix, custom enemies, edited stages or a custom
// player outfit reopens itself with ?mods=0 before hosting (?host=1 then creates the room on load); invite links
// (?sala=) always load the original game.
// Query: ?sala=CODE join, ?turn=turn:host:port,user,pass add a TURN server, ?delay=N input delay (default 2),
// ?netsim=lat,jit,loss (tests).
(function () {
  'use strict';
  const q = new URLSearchParams(location.search), G = window.SSRG;
  const KIND = q.get('net') === 'peerjs' ? 'peerjs' : q.get('signal') || q.get('net') === 'php' ? 'php' : 'peerjs';
  const SIGNAL = q.get('signal') || SSRNET.DEFAULT_SIGNAL;
  const ICE = SSRNET.ICE.slice(), EXTRA = [];
  if (q.get('turn')) { const [urls, username, credential] = q.get('turn').split(','); EXTRA.push({ urls, username, credential }); }
  // ?noturn=1: only ?turn= servers (tests); ?direct=N: seconds before the relay-only retry (default 15).
  // Relay credentials only come from a signal.php; with PeerJS there is none to ask.
  const iceAll = async () => ICE.concat(EXTRA, q.get('noturn') || KIND !== 'php' ? [] : await SSRNET.getTurn(SIGNAL));
  const DIRECT_S = +(q.get('direct') || 15), RELAY_S = +(q.get('relayt') || 20);
  const PT = /^pt/i.test(navigator.language || ''), tr = (pt, en) => PT ? pt : en;
  const SIM = SSRLINK.parseSim(q.get('netsim'));
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => ALPHA[b % ALPHA.length]).join('');
  const css = `#np{position:fixed;right:12px;top:12px;width:300px;background:rgba(20,12,4,.93);color:#f3e2c0;font:14px system-ui,sans-serif;
    border:2px solid #c8892e;border-radius:10px;padding:12px;z-index:10;display:none}#np h3{margin:0 0 8px;font-size:16px;color:#ffc861}
    #np button{background:#c8892e;color:#1a0f02;border:0;border-radius:6px;padding:6px 10px;margin:3px 3px 3px 0;font-weight:600;cursor:pointer}
    #np input{width:100%;box-sizing:border-box;padding:6px;border-radius:6px;border:1px solid #c8892e;background:#000;color:#fff;margin:4px 0}
    #np .slot{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #4a3010}#np small{color:#b9a27a}
    #np table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}#np td,#np th{padding:2px 3px;text-align:left;border-bottom:1px solid #4a3010}
    #np th{color:#ffc861;font-weight:600}#np td button{padding:2px 6px;margin:0;font-size:12px}#np td button:disabled{background:#6b5a40;cursor:default}
    #np label{display:block;margin:2px 0}#np label input{width:auto;margin:0 4px 0 0}
    #npb{position:fixed;right:12px;bottom:12px;z-index:9;background:rgba(200,137,46,.85);color:#1a0f02;border:0;border-radius:6px;padding:5px 9px;font:600 12px system-ui;cursor:pointer;opacity:.6}`;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
  const box = Object.assign(document.createElement('div'), { id: 'np' }); document.body.appendChild(box);
  const btn = Object.assign(document.createElement('button'), { id: 'npb', textContent: tr('Multijogador (F7)', 'Online play (F7)') }); document.body.appendChild(btn);
  const show = v => { box.style.display = v ? 'block' : 'none'; if (v) { if (!st.s) render(); refreshList(); } };
  btn.onclick = () => show(box.style.display !== 'block');
  addEventListener('keydown', e => { if (e.code === 'F7') { e.preventDefault(); show(box.style.display !== 'block'); } });
  const nickKey = 'simpsons_nick', getNick = () => { try { return localStorage.getItem(nickKey) || ''; } catch (e) { return ''; } };
  const st = { s: null, t: null, room: null, role: null, msg: '', log: [], rooms: null, pub: true, autoWatch: false };
  const pubKey = 'simpsons_public', getPub = () => { try { return localStorage.getItem(pubKey) !== '0'; } catch (e) { return true; } };
  const escH = x => String(x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const playerN = n => tr('Jogador ', 'Player ') + n;
  // room list "Stage" column: no stage number has been found in the Simpsons RAM yet; players in game vs. waiting
  function stageName(m) { const r = m && m.ram; if (!r) return ''; let n = 0; for (let p = 0; p < 4; p++) if (r[0x0a40 + 0xc0 * p] & 0xc4) n++; return n ? tr('Em jogo', 'Playing') : tr('Tela de título', 'Title screen'); }
  // meta for signal.php: public rooms are listed; private ones send pv:1 (never listed, only counted in the owner's usage stats)
  function meta() { const s = st.s; if (!s || st.role !== 'host') return null;
    return { n: getNick() || playerN(1), p: 1 + s.links.filter(l => l.slot > 0).length, s: s.spectators().length, st: stageName(G.machine),
      pv: st.pub ? 0 : 1, pl: s.names().filter(x => x), sp: s.spectators() }; }
  // public room list (only with a signal.php, while the panel is open and we are not in a room)
  function listHtml() {
    if (st.rooms === null) return `<small>${tr('Carregando salas…', 'Loading rooms…')}</small>`;
    const rows = st.rooms.filter(r => r.room !== st.room);
    if (!rows.length) return `<small>${tr('Nenhuma sala aberta agora', 'No open rooms right now')}</small>`;
    let h = `<table><tr><th>${tr('Sala', 'Room')}</th><th>${tr('Anfitrião', 'Host')}</th><th>${tr('Jog.', 'Pl.')}</th><th>${tr('Esp.', 'Watch')}</th><th>${tr('Fase', 'Stage')}</th><th></th></tr>`;
    for (const r of rows) {
      const full = r.p >= 4, b = full ? (r.s >= SSRSESSION.MAXSPEC ? `<button disabled>${tr('Cheia', 'Full')}</button>` : `<button data-r="${escH(r.room)}" data-w="1">${tr('Assistir', 'Watch')}</button>`) : `<button data-r="${escH(r.room)}">${tr('Entrar', 'Join')}</button>`;
      h += `<tr><td><b>${escH(r.room)}</b></td><td>${escH(r.host || '?')}</td><td>${r.p | 0}/4</td><td>${r.s | 0}/${SSRSESSION.MAXSPEC}</td><td>${escH(r.st || '')}</td><td>${b}</td></tr>`;
    }
    return h + '</table>';
  }
  function bindList(el) { for (const b of el.querySelectorAll('button[data-r]')) b.onclick = () => join(b.dataset.r, !!b.dataset.w).catch(err); }
  async function refreshList() {
    if (KIND !== 'php' || st.s || box.style.display !== 'block') return;
    const r = await SSRNET.listRooms(SIGNAL); if (r) st.rooms = r; else if (st.rooms === null) st.rooms = [];
    const el = box.querySelector('#np-list'); if (el && !st.s) { el.innerHTML = listHtml(); bindList(el); }
  }
  setInterval(refreshList, 5000);
  const ctl = { active: () => !!(st.s && (st.s.rb || st.role === 'guest')), tick: fi => { const s = st.s; if (s.spec && s.vaga && (fi & SSRIN.COIN)) s.promote(); return s.tick(s.spec ? 0 : fi); }, get session() { return st.s; }, get state() { return st; } };
  function link() {
    const u = new URL(location.href); u.search = ''; u.searchParams.set('sala', st.room);
    if (KIND === 'php') { if (q.get('signal')) u.searchParams.set('signal', SIGNAL); else u.searchParams.set('net', 'php'); }
    return u.toString();
  }
  function render() {
    const s = st.s, nk = escH(getNick()); let h = `<h3>${tr('Multijogador online', 'Online play')}</h3>`;
    h += `<small>${tr('Seu apelido (aparece sobre o seu personagem):', 'Your nickname (shown over your character):')}</small><input id="np-nick" maxlength="${SSRSESSION.NICK_MAX}" placeholder="${playerN('N')}" value="${nk}">`;
    if (!s) {
      h += `<button id="np-create">${tr('Criar sala', 'Create room')}</button>`;
      if (KIND === 'php') h += `<label><input type="checkbox" id="np-pub"${getPub() ? ' checked' : ''}>${tr('Sala pública (aparece na lista; sem marcar, só entra quem tiver o link ou o código)', 'Public room (shown in the list; otherwise only people with the link or code can join)')}</label>`;
      h += `<small>${tr('ou entre com o código:', 'or join with a code:')}</small><input id="np-code" maxlength="8" placeholder="${tr('ex.: K7Q2', 'e.g. K7Q2')}">
        <button id="np-join">${tr('Entrar', 'Join')}</button>`;
      if (KIND === 'php') h += `<div style="margin-top:8px"><small>${tr('Salas abertas agora:', 'Open rooms:')}</small><div id="np-list">${listHtml()}</div></div>`;
      if (modded()) h += `<div style="margin-top:6px"><small>${tr('Salas online usam o jogo original: ao criar uma sala, esta página reabre sem o Arcade Remix e as edições.', 'Online rooms play the original game: creating a room reopens this page without the Arcade Remix and editor changes.')}</small></div>`;
    } else if (st.full) {
      h += `<div>${tr('Sala', 'Room')} <b>${st.room}</b> ${tr('está cheia (4 jogadores).', 'is full (4 players).')}</div>`;
      h += st.full === 'watch' ? `<small>${tr('Você pode assistir à partida (e conversar pelo chat). Se abrir uma vaga, dá pra entrar como jogador.', 'You can watch the match (and use the chat). If a slot opens you can take it.')}</small><br>
        <button id="np-watch">${tr('Assistir', 'Watch')}</button><button id="np-leave">${tr('Sair', 'Leave')}</button>` : `<small>${tr('Já tem ' + SSRSESSION.MAXSPEC + ' espectadores também.', 'It already has ' + SSRSESSION.MAXSPEC + ' spectators too.')}</small><br><button id="np-leave">${tr('Sair', 'Leave')}</button>`;
    } else {
      if (st.role === 'host') {
        const L = link();
        if (KIND === 'php') h += `<div><small>${st.pub ? tr('Sala <b>pública</b> (aparece na lista de salas)', '<b>Public</b> room (shown in the room list)') : tr('Sala <b>privada</b> (só entra quem tiver o link ou o código)', '<b>Private</b> room (only people with the link or code can join)')}</small></div>`;
        h += `<div>${tr('Sala', 'Room')} <b>${st.room}</b> — ${tr('convide até 3 amigos:', 'invite up to 3 friends:')}</div><input id="np-link" readonly value="${L}">
          <button id="np-copy">${tr('Copiar link', 'Copy link')}</button>`;
        const pend = st.t && st.t.pending ? st.t.pending() : 0;
        if (pend) h += `<div style="color:#9fe0ff">${tr('Alguém tentando entrar…', 'Someone is trying to join…')}</div>`;
      } else h += `<div>${tr('Sala', 'Room')} <b>${st.room}</b></div>`;
      const peers = s.peers(), me = s.slot;
      h += '<div style="margin-top:8px">';
      for (let p = 0; p < 4; p++) {
        let who = `<small>${tr('livre', 'open')}</small>`;
        const nm = s.names()[p];
        if (p === me) who = tr('você', 'you') + (nm ? ` <small>(${escH(nm)})</small>` : '');
        else if (st.role === 'host') { const L = peers.find(x => x.slot === p); if (L) who = `${escH(nm || tr('conectado', 'connected'))} <small>${L.rtt} ms</small>`; }
        else if (s.rb && s.rb.join[p] !== SSRROLL.INF && s.rb.leave[p] === SSRROLL.INF) who = p === 0 ? `${escH(nm || tr('anfitrião', 'host'))} <small>${peers[0] ? peers[0].rtt : '?'} ms</small>` : escH(nm || tr('conectado', 'connected'));
        h += `<div class="slot"><span>${playerN(p + 1)}</span><span>${who}</span></div>`;
      }
      const sp = s.spectators();
      h += `<div class="slot"><span>${tr('Espectadores', 'Spectators')} (${sp.length}/${SSRSESSION.MAXSPEC})</span><span><small>${sp.length ? sp.map(escH).join(', ') : tr('nenhum', 'none')}</small></span></div>`;
      if (s.spec) h += `<div style="margin-top:6px;color:#9fe0ff">${tr('Você está <b>assistindo</b>.', 'You are <b>watching</b>.')}</div>` + (s.vaga ? `<div style="color:#8f8">${tr('Vaga livre! Aperte ficha (5) ou o botão para entrar.', 'A slot is open! Press coin (5) or the button to play.')}</div><button id="np-promote">${tr('Entrar como jogador', 'Play')}</button>` : '');
      h += `</div><small>${tr('Espectadores assistem e podem usar o chat (a mensagem aparece no alto da tela).<br>Para entrar no jogo: moeda (5) e depois tiro (Z), como no fliperama.<br>Chat: <b>TAB</b> abre o campo, <b>Enter</b> envia (aparece num balão sobre o seu personagem), <b>Esc</b> cancela.',
        'Spectators watch and can chat (messages appear at the top of the screen).<br>To play: coin (5), then attack (Z), like the arcade.<br>Chat: <b>TAB</b> opens the field, <b>Enter</b> sends (a bubble over your character), <b>Esc</b> cancels.')}</small><br><button id="np-leave">${tr('Sair da sala', 'Leave room')}</button>`;
    }
    if (st.msg) h += `<div style="margin-top:6px;color:#ffb0a0">${st.msg}</div>`;
    box.innerHTML = h;
    const $ = id => box.querySelector('#' + id);
    if ($('np-create')) $('np-create').onclick = () => host($('np-pub') ? $('np-pub').checked : undefined).catch(err);
    if ($('np-join')) $('np-join').onclick = () => join($('np-code').value.trim().toUpperCase()).catch(err);
    if ($('np-copy')) $('np-copy').onclick = () => { navigator.clipboard.writeText(link()).then(() => { st.msg = tr('Link copiado!', 'Link copied!'); render(); }, () => { $('np-link').select(); }); };
    if ($('np-leave')) $('np-leave').onclick = leave;
    if ($('np-pub')) $('np-pub').onchange = e => { try { localStorage.setItem(pubKey, e.target.checked ? '1' : '0'); } catch (x) {} };
    if ($('np-list')) bindList($('np-list'));
    if ($('np-nick')) $('np-nick').onchange = e => { const n = SSRSESSION.cleanNick(e.target.value); try { localStorage.setItem(nickKey, n); } catch (x) {} e.target.value = n; if (st.s) st.s.setName(n); e.target.blur(); };
    if ($('np-link')) $('np-link').setAttribute('readonly', '');
    const play = document.getElementById('screen');
    if (play && !play.hasAttribute('tabindex')) play.tabIndex = 0;
    if ($('np-watch')) $('np-watch').onclick = () => { st.full = null; st.msg = tr('Recebendo o jogo para assistir…', 'Receiving the game to watch…'); st.s.watch(); render(); };
    if ($('np-retry')) $('np-retry').onclick = () => { const r = st.retry; endSession(); join(r).catch(err); };
    if ($('np-promote')) $('np-promote').onclick = () => { st.s.promote(); render(); };
  }
  function err(e) { st.msg = tr('Erro: ', 'Error: ') + (e && e.message || e); console.warn(e); render(); }
  function makeSession(role, extra) {
    const m = G.machine;
    const s = new SSRSESSION.Session(Object.assign({ m, step: G.netStep, role, name: getNick(), delay: +(q.get('delay') || 2), lockDelay: q.get('delay') != null, onAudio: G.netAudio,
      onEvent: e => { if (e.t === 'chat') { if (window.SSRCHAT) SSRCHAT.show(e.slot, e.text, e.name); return; }
        if (e.t === 'vaga' && e.v) show(true); st.log.push(e); if (e.t === 'state') { G.netAudioResync(e.snap); st.msg = ''; const play = document.getElementById('screen'); if (play) try { play.focus(); } catch (x) {} } if (e.t === 'hostgone') { st.msg = tr('O anfitrião saiu da sala.', 'The host left the room.'); endSession(); }
        if (e.t === 'full' && st.autoWatch && e.watch) { st.autoWatch = false; st.msg = tr('Recebendo o jogo para assistir…', 'Receiving the game to watch…'); st.s.watch(); render(); return; }
        if (e.t === 'full') { st.msg = ''; st.full = e.watch ? 'watch' : 'nowatch'; show(true); } render(); } }, extra));
    return s;
  }
  // true when this page runs offline-only changes (Remix, custom enemies/stages, outfit) that the other players lack
  function modded() { if (!window.SIMPMODS) return false; try { SIMPMODS.assertOnline(); return false; } catch (e) { return true; } }
  // the same page (its other settings, e.g. ?signal= or ?delay=, kept) as the original game
  function reopenOriginal(extra) { const u = new URL(location.href); u.searchParams.set('mods', '0'); for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v); location.href = u.toString(); }
  async function host(pub) {
    st.pub = pub === undefined ? getPub() : !!pub;
    await G.ready;
    if (modded()) { st.msg = tr('Reabrindo o jogo original para a sala online…', 'Reopening the original game for the online room…'); render(); reopenOriginal({ host: '1' }); return; }
    st.role = 'host'; st.msg = tr('Abrindo sala…', 'Opening room…'); render();
    const ice = await iceAll();
    for (let tries = 0; ; tries++) {   // PeerJS: another room may already hold the code, so try a fresh one
      st.room = code();
      try { st.t = await SSRNET.open(KIND, { room: st.room, role: 'host', signal: SIGNAL, ice, sim: SIM, meta, simnat: +(q.get('simnat') || 0) }); break; }
      catch (e) { if (e.type !== 'unavailable-id' || tries >= 4) { st.role = null; throw e; } }
    }
    st.s = makeSession('host', { frame: G.frameNo + 1 }); G.net = ctl;
    st.t.onlink = l => { st.s.addLink(l); render(); };
    st.msg = ''; render();
    const play = document.getElementById('screen'); if (play) try { play.focus(); } catch (e) {}
  }
  async function join(room, watch) {
    if (!/^[A-Z0-9]{4,8}$/.test(room)) throw new Error(tr('código inválido', 'invalid code'));
    st.autoWatch = !!watch;
    await G.ready;
    // a modded page joining by code: open the invite link instead, which always loads the original game
    if (modded()) { const u = new URL(location.href); u.search = ''; u.searchParams.set('sala', room); if (KIND === 'php') u.searchParams.set('net', 'php'); location.href = u.toString(); return; }
    st.room = room; st.role = 'guest'; st.msg = tr('Conectando…', 'Connecting…'); render(); show(true);
    st.s = makeSession('guest'); G.net = ctl;
    const ice = await iceAll(), gen = st.gen = (st.gen || 0) + 1, hasTurn = ice.some(x => /^turns?:/.test([].concat(x.urls)[0]));
    // attempt 1: direct + STUN + TURN (policy all); attempt 2 (if no link after DIRECT_S): fresh connection, relay only.
    // PeerJS: one attempt, given up after 30 s so a wrong code or a closed room does not wait forever.
    for (const [policy, secs] of KIND === 'php' ? [['all', DIRECT_S]].concat(hasTurn ? [['relay', RELAY_S]] : []) : [['all', 30]]) {
      if (policy === 'relay') { try { fetch(SIGNAL + '?a=ice&relay=1&room=' + room, { cache: 'no-store' }).catch(() => {}); } catch (e) {} st.msg = tr('Não foi possível conectar direto ao anfitrião. Tentando via servidor de retransmissão…', 'Could not connect directly to the host. Trying via relay server…'); render(); }
      console.log('[ssr-net] guest attempt', policy, 'room', room);
      const ok = await new Promise(async res => {
        let t; try { t = await SSRNET.open(KIND, { room, role: 'guest', signal: SIGNAL, ice, sim: SIM, policy, simnat: +(q.get('simnat') || 0) }); } catch (e) { res(e); return; }
        if (st.gen !== gen || !st.s) { t.close(); res(false); return; }
        st.t = t; let done = false;
        t.onlink = l => { done = true; st.s.addLink(l); st.msg = tr('Recebendo o jogo do anfitrião…', 'Receiving the game from the host…'); render(); res(true); };
        t.onfail = () => { if (done) return; done = true; t.onlink = null; t.close(); if (st.t === t) st.t = null; res('missing'); };
        if (secs) setTimeout(() => { if (!done) { console.log('[ssr-net] guest: no connection after', secs, 's (' + policy + ')'); t.onlink = null; t.close(); if (st.t === t) st.t = null; res(false); } }, secs * 1000);
      });
      if (ok === true) return;
      if (ok instanceof Error) throw ok;
      if (ok === 'missing') { endSession(); st.msg = tr('Sala ' + room + ' não encontrada. Confira o código (o anfitrião precisa estar com a sala aberta).', 'Room ' + room + ' was not found. Check the code (the host must have the room open).'); render(); return; }
      if (st.gen !== gen || !st.s) return; // left meanwhile
    }
    st.msg = tr('Não foi possível conectar ao anfitrião. Confira o código da sala. A rede de um de vocês (operadora, 4G, rede de empresa/faculdade) pode estar bloqueando a conexão. Tentem os dois em Wi-Fi de casa, ou peçam para o outro criar a sala.',
      'Could not connect to the host. Check the room code. One of your networks (carrier, mobile data, company/school network) may be blocking the connection: try both on home Wi-Fi, or let the other player host.')
      + `<br><button id="np-retry">${tr('Tentar de novo', 'Try again')}</button>`;
    st.retry = room; render();
  }
  function endSession() { st.gen = (st.gen || 0) + 1; st.full = null; if (st.t) st.t.close(); st.t = null; st.s = null; G.net = null; st.role = null; }
  function leave() { endSession(); st.msg = ''; st.rooms = null; render(); refreshList(); }
  addEventListener('beforeunload', () => { if (st.t) st.t.close(); });
  setInterval(() => { if (st.s && box.style.display === 'block' && !box.contains(document.activeElement)) render(); }, 1000);
  render();
  window.SSRNETPLAY = Object.assign(ctl, { host, join, leave, link, refreshList, stageName, modded, roomList: () => st.rooms, signal: SIGNAL, kind: KIND });
  if (q.get('sala')) join(q.get('sala').toUpperCase()).catch(err);
  // reopened by host() from a modded page: open the panel and create the room
  else if (q.get('host') === '1') { show(true); host().catch(err); }
})();
