// Netplay overlay (pt-BR). F7 (or the "Multijogador" button) opens it. "Criar sala" makes this browser the host
// (player 1) and shows the invite link (?sala=CODE) with copy and WhatsApp buttons; opening the link joins as
// P2/P3/P4. In the game every player inserts a coin (5) and presses fire, like the arcade.
// Query: ?sala=CODE join, ?net=peerjs use the PeerJS cloud instead of signal.php, ?signal=URL other signal.php,
// ?turn=turn:host:port,user,pass add a TURN server, ?delay=N input delay (default 2), ?netsim=lat,jit,loss (tests).
(function () {
  'use strict';
  const q = new URLSearchParams(location.search), G = window.SSRG;
  const KIND = q.get('net') === 'peerjs' ? 'peerjs' : 'php', SIGNAL = q.get('signal') || SSRNET.DEFAULT_SIGNAL;
  const ICE = SSRNET.ICE.slice(), EXTRA = [];
  if (q.get('turn')) { const [urls, username, credential] = q.get('turn').split(','); EXTRA.push({ urls, username, credential }); }
  // ?noturn=1: only ?turn= servers (tests); ?direct=N: seconds before the relay-only retry (default 15)
  const iceAll = async () => ICE.concat(EXTRA, q.get('noturn') ? [] : await SSRNET.getTurn(SIGNAL));
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
  const btn = Object.assign(document.createElement('button'), { id: 'npb', textContent: 'Multijogador (F7)' }); document.body.appendChild(btn);
  const show = v => { box.style.display = v ? 'block' : 'none'; if (v) refreshList(); };
  btn.onclick = () => show(box.style.display !== 'block');
  addEventListener('keydown', e => { if (e.code === 'F7') { e.preventDefault(); show(box.style.display !== 'block'); } });
  const nickKey = 'simpsons_nick', getNick = () => { try { return localStorage.getItem(nickKey) || ''; } catch (e) { return ''; } };
  const st = { s: null, t: null, room: null, role: null, msg: '', log: [], rooms: null, pub: true, autoWatch: false };
  const pubKey = 'simpsons_public', getPub = () => { try { return localStorage.getItem(pubKey) !== '0'; } catch (e) { return true; } };
  const escH = x => String(x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  // what the game is showing, from work RAM: 0x104001 = 1 attract / 2 game, 0x104003 = attract step (5 = demo),
  // 0x104300 = stage index (0 = stage 1). See NOTES.md "Room list".
  // room list "Fase" column: the Simpsons board has no stage number found in RAM yet; players in game vs. waiting
  function stageName(m) { const r = m && m.ram; if (!r) return ''; let n = 0; for (let p = 0; p < 4; p++) if (r[0x0a40 + 0xc0 * p] & 0xc4) n++; return n ? 'Em jogo' : 'Tela de título'; }
  // meta for signal.php: public rooms are listed; private ones send pv:1 (never listed, only counted in the owner's usage stats)
  function meta() { const s = st.s; if (!s || st.role !== 'host') return null;
    return { n: getNick() || 'Jogador 1', p: 1 + s.links.filter(l => l.slot > 0).length, s: s.spectators().length, st: stageName(G.machine),
      pv: st.pub ? 0 : 1, pl: s.names().filter(x => x), sp: s.spectators() }; }
  // public room list (only while the panel is open and we are not in a room)
  function listHtml() {
    if (st.rooms === null) return '<small>Carregando salas…</small>';
    const rows = st.rooms.filter(r => r.room !== st.room);
    if (!rows.length) return '<small>Nenhuma sala aberta agora</small>';
    let h = '<table><tr><th>Sala</th><th>Anfitrião</th><th>Jog.</th><th>Esp.</th><th>Fase</th><th></th></tr>';
    for (const r of rows) {
      const full = r.p >= 4, b = full ? (r.s >= SSRSESSION.MAXSPEC ? '<button disabled>Cheia</button>' : `<button data-r="${escH(r.room)}" data-w="1">Assistir</button>`) : `<button data-r="${escH(r.room)}">Entrar</button>`;
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
    if (KIND === 'peerjs') u.searchParams.set('net', 'peerjs');
    if (q.get('signal')) u.searchParams.set('signal', SIGNAL);
    return u.toString();
  }
  function render() {
    const s = st.s, nk = getNick().replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'); let h = '<h3>Multijogador online</h3>';
    h += `<small>Seu apelido (aparece sobre o seu personagem):</small><input id="np-nick" maxlength="${SSRSESSION.NICK_MAX}" placeholder="Jogador N" value="${nk}">`;
    if (!s) {
      h += `<button id="np-create">Criar sala</button><label><input type="checkbox" id="np-pub"${getPub() ? ' checked' : ''}>Sala pública (aparece na lista; sem marcar, só entra quem tiver o link ou o código)</label><small>ou entre com o código:</small><input id="np-code" maxlength="8" placeholder="ex.: K7Q2">
        <button id="np-join">Entrar</button>`;
      if (KIND === 'php') h += `<div style="margin-top:8px"><small>Salas abertas agora:</small><div id="np-list">${listHtml()}</div></div>`;
    } else if (st.full) {
      h += `<div>Sala <b>${st.room}</b> está cheia (4 jogadores).</div>`;
      h += st.full === 'watch' ? `<small>Você pode assistir à partida (e conversar pelo chat). Se abrir uma vaga, dá pra entrar como jogador.</small><br>
        <button id="np-watch">Assistir</button><button id="np-leave">Sair</button>` : `<small>Já tem ${SSRSESSION.MAXSPEC} espectadores também.</small><br><button id="np-leave">Sair</button>`;
    } else {
      if (st.role === 'host') {
        const L = link();
        h += `<div><small>${st.pub ? 'Sala <b>pública</b> (aparece na lista de salas)' : 'Sala <b>privada</b> (só entra quem tiver o link ou o código)'}</small></div>`;
        h += `<div>Sala <b>${st.room}</b> — convide até 3 amigos:</div><input id="np-link" readonly value="${L}">
          <button id="np-copy">Copiar link</button><a href="https://wa.me/?text=${encodeURIComponent('Bora jogar The Simpsons comigo! ' + L)}" target="_blank" rel="noopener"><button>WhatsApp</button></a>`;
        const pend = st.t && st.t.pending ? st.t.pending() : 0;
        if (pend) h += `<div style="color:#9fe0ff">${tr('Alguém tentando entrar…', 'Someone is trying to join…')}</div>`;
      } else h += `<div>Sala <b>${st.room}</b></div>`;
      const peers = s.peers(), me = s.slot;
      h += '<div style="margin-top:8px">';
      for (let p = 0; p < 4; p++) {
        let who = '<small>livre</small>';
        const nm = s.names()[p], esc1 = x => String(x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
        if (p === me) who = 'você' + (nm ? ` <small>(${esc1(nm)})</small>` : '');
        else if (st.role === 'host') { const L = peers.find(x => x.slot === p); if (L) who = `${esc1(nm || 'conectado')} <small>${L.rtt} ms</small>`; }
        else if (s.rb && s.rb.join[p] !== SSRROLL.INF && s.rb.leave[p] === SSRROLL.INF) who = p === 0 ? `${esc1(nm || 'anfitrião')} <small>${peers[0] ? peers[0].rtt : '?'} ms</small>` : esc1(nm || 'conectado');
        h += `<div class="slot"><span>Jogador ${p + 1}</span><span>${who}</span></div>`;
      }
      const sp = s.spectators(), esc = x => String(x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
      h += `<div class="slot"><span>Espectadores (${sp.length}/${SSRSESSION.MAXSPEC})</span><span><small>${sp.length ? sp.map(esc).join(', ') : 'nenhum'}</small></span></div>`;
      if (s.spec) h += `<div style="margin-top:6px;color:#9fe0ff">Você está <b>assistindo</b>.</div>` + (s.vaga ? `<div style="color:#8f8">Vaga livre! Aperte ficha (5) ou o botão para entrar.</div><button id="np-promote">Entrar como jogador</button>` : '');
      h += '</div><small>Espectadores assistem e podem usar o chat (a mensagem aparece no alto da tela).<br>Para entrar no jogo: moeda (5) e depois tiro (Z), como no fliperama.<br>Chat: <b>TAB</b> abre o campo, <b>Enter</b> envia (aparece num balão sobre o seu personagem), <b>Esc</b> cancela.</small><br><button id="np-leave">Sair da sala</button>';
    }
    if (st.msg) h += `<div style="margin-top:6px;color:#ffb0a0">${st.msg}</div>`;
    box.innerHTML = h;
    const $ = id => box.querySelector('#' + id);
    if ($('np-create')) $('np-create').onclick = () => host($('np-pub') ? $('np-pub').checked : undefined).catch(err);
    if ($('np-join')) $('np-join').onclick = () => join($('np-code').value.trim().toUpperCase()).catch(err);
    if ($('np-copy')) $('np-copy').onclick = () => { navigator.clipboard.writeText(link()).then(() => { st.msg = 'Link copiado!'; render(); }, () => { $('np-link').select(); }); };
    if ($('np-leave')) $('np-leave').onclick = leave;
    if ($('np-pub')) $('np-pub').onchange = e => { try { localStorage.setItem(pubKey, e.target.checked ? '1' : '0'); } catch (x) {} };
    if ($('np-list')) bindList($('np-list'));
    if ($('np-nick')) $('np-nick').onchange = e => { const n = SSRSESSION.cleanNick(e.target.value); try { localStorage.setItem(nickKey, n); } catch (x) {} e.target.value = n; if (st.s) st.s.setName(n); };
    if ($('np-watch')) $('np-watch').onclick = () => { st.full = null; st.msg = 'Recebendo o jogo para assistir…'; st.s.watch(); render(); };
    if ($('np-retry')) $('np-retry').onclick = () => { const r = st.retry; endSession(); join(r).catch(err); };
    if ($('np-promote')) $('np-promote').onclick = () => { st.s.promote(); render(); };
  }
  function err(e) { st.msg = 'Erro: ' + (e && e.message || e); console.warn(e); render(); }
  function makeSession(role, extra) {
    const m = G.machine;
    const s = new SSRSESSION.Session(Object.assign({ m, step: G.netStep, role, name: getNick(), delay: +(q.get('delay') || 2), onAudio: G.netAudio,
      onEvent: e => { if (e.t === 'chat') { if (window.SSRCHAT) SSRCHAT.show(e.slot, e.text, e.name); return; }
        if (e.t === 'vaga' && e.v) show(true); st.log.push(e); if (e.t === 'state') { G.netAudioResync(e.snap); st.msg = ''; } if (e.t === 'hostgone') { st.msg = 'O anfitrião saiu da sala.'; endSession(); }
        if (e.t === 'full' && st.autoWatch && e.watch) { st.autoWatch = false; st.msg = 'Recebendo o jogo para assistir…'; st.s.watch(); render(); return; }
        if (e.t === 'full') { st.msg = ''; st.full = e.watch ? 'watch' : 'nowatch'; show(true); } render(); } }, extra));
    return s;
  }
  async function host(pub) {
    st.pub = pub === undefined ? getPub() : !!pub;
    await G.ready; st.room = code(); st.role = 'host'; st.msg = 'Abrindo sala…'; render();
    st.t = await SSRNET.open(KIND, { room: st.room, role: 'host', signal: SIGNAL, ice: await iceAll(), sim: SIM, meta, simnat: +(q.get('simnat') || 0) });
    st.s = makeSession('host', { frame: G.frameNo + 1 }); G.net = ctl;
    st.t.onlink = l => { st.s.addLink(l); render(); };
    st.msg = ''; render();
  }
  async function join(room, watch) {
    if (!/^[A-Z0-9]{4,8}$/.test(room)) throw new Error('código inválido');
    st.autoWatch = !!watch;
    await G.ready; st.room = room; st.role = 'guest'; st.msg = tr('Conectando…', 'Connecting…'); render(); show(true);
    st.s = makeSession('guest'); G.net = ctl;
    const ice = await iceAll(), gen = st.gen = (st.gen || 0) + 1, hasTurn = ice.some(x => /^turns?:/.test([].concat(x.urls)[0]));
    // attempt 1: direct + STUN + TURN (policy all); attempt 2 (if no link after DIRECT_S): fresh connection, relay only
    for (const [policy, secs] of KIND === 'php' ? [['all', DIRECT_S]].concat(hasTurn ? [['relay', RELAY_S]] : []) : [['all', 0]]) {
      if (policy === 'relay') { try { fetch(SIGNAL + '?a=ice&relay=1&room=' + room, { cache: 'no-store' }).catch(() => {}); } catch (e) {} st.msg = tr('Não foi possível conectar direto ao anfitrião. Tentando via servidor de retransmissão…', 'Could not connect directly to the host. Trying via relay server…'); render(); }
      console.log('[ssr-net] guest attempt', policy, 'room', room);
      const ok = await new Promise(async res => {
        let t; try { t = await SSRNET.open(KIND, { room, role: 'guest', signal: SIGNAL, ice, sim: SIM, policy, simnat: +(q.get('simnat') || 0) }); } catch (e) { res(e); return; }
        if (st.gen !== gen || !st.s) { t.close(); res(false); return; }
        st.t = t; let done = false;
        t.onlink = l => { done = true; st.s.addLink(l); st.msg = tr('Recebendo o jogo do anfitrião…', 'Receiving the game from the host…'); render(); res(true); };
        if (secs) setTimeout(() => { if (!done) { console.log('[ssr-net] guest: no connection after', secs, 's (' + policy + ')'); t.onlink = null; t.close(); if (st.t === t) st.t = null; res(false); } }, secs * 1000);
      });
      if (ok === true) return;
      if (ok instanceof Error) throw ok;
      if (st.gen !== gen || !st.s) return; // left meanwhile
    }
    st.msg = tr('Não foi possível conectar ao anfitrião. A rede de um de vocês (operadora, 4G, rede de empresa/faculdade) pode estar bloqueando a conexão. Tentem os dois em Wi-Fi de casa, ou peçam para o outro criar a sala.',
      'Could not connect to the host. One of your networks (carrier, mobile data, company/school network) may be blocking the connection. Try both on home Wi-Fi, or let the other player host.')
      + `<br><button id="np-retry">${tr('Tentar de novo', 'Try again')}</button>`;
    st.retry = room; render();
  }
  function endSession() { st.gen = (st.gen || 0) + 1; st.full = null; if (st.t) st.t.close(); st.t = null; st.s = null; G.net = null; st.role = null; }
  function leave() { endSession(); st.msg = ''; st.rooms = null; render(); refreshList(); }
  addEventListener('beforeunload', () => { if (st.t) st.t.close(); });
  setInterval(() => { if (st.s && box.style.display === 'block' && !box.contains(document.activeElement)) render(); }, 1000);
  render();
  window.SSRNETPLAY = Object.assign(ctl, { host, join, leave, link, refreshList, stageName, roomList: () => st.rooms, signal: SIGNAL, kind: KIND });
  if (q.get('sala')) join(q.get('sala').toUpperCase()).catch(err);
})();
