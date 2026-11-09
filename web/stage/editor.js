// Stage editor page (editor.html): paints 32x32 blocks into the two scrolling background layers of each stage.
// The ROM comes from the same place as the game (assets/ next to the page, or the IndexedDB copy of your zip).
// Edits are kept as changed prog.bin bytes in localStorage (SIMPSTAGE.PATCH_KEY); web/stage/mods.js applies them
// when the game page starts.
(function () {
  'use strict';
  const S = SIMPSTAGE, E = SIMPENEMY, $ = id => document.getElementById(id), CELL = S.CELL;
  let enemyEdits = {}, enemyRows = [], enemySelected = -1, enemyDrag = null, mode = 'blocks';
  const clone = rows => JSON.parse(JSON.stringify(rows));
  const enemyStage = () => E.STAGES[st.scene];
  const visibleEntity = row => mode === 'npcs' ? row.role === 'npc' && E.enemy(row) : row.role !== 'npc' && (E.kind(row) !== 'script' || $('showScripts').checked);
  const PREFS = 'simpsons.editor.prefs';
  const st = { scene: 0, custom: null, area: 0, layer: 1, other: true, grid: true, edits: true, zoom: 2, sel: 0 };
  let orig, work, D, tiles, bytes = {}, sec, ram, atlas = [null, null], nBlk = [0, 0], cellIx = new Map(), metaMax = new Map();
  let undo = [], redo = [], stroke = null, saveT = 0;
  // Custom stages (web/stage/stages.js): stages = { id: { name, scene, tileset, enemies, events } }. st.custom is the
  // selected one (null = an original stage). A custom stage runs on an original stage's ground with its own level art
  // (web/stage/tileset.js), enemy list and scripted events (web/stage/events.js); the original stage is not changed.
  // In its art section the picker lists the custom blocks and painting edits the custom maps.
  let stages = {}, tset = null, tmaps = null, native = [null, null], eventSel = -1, eventDrag = null;
  const custom = () => st.custom && stages[st.custom] || null;
  const tileKey = (l, i) => 't' + l + ':' + i;
  const map = $('map'), ctx = map.getContext('2d'), pick = $('pick'), pctx = pick.getContext('2d'), selc = $('selc'), sctx = selc.getContext('2d');
  const hex = (n, w) => '0x' + n.toString(16).padStart(w, '0');
  const msg = t => { $('msg').textContent = t || ''; };

  // ---------- persistence
  function loadBytes() { try { const j = JSON.parse(localStorage.getItem(S.PATCH_KEY) || 'null'); return j && j.bytes && typeof j.bytes === 'object' ? j.bytes : {}; } catch (e) { return {}; } }
  function saveNow() {
    clearTimeout(saveT); saveT = 0;
    try { const n = Object.keys(bytes).length + Object.keys(enemyEdits).length + Object.keys(stages).length; if (n) localStorage.setItem(S.PATCH_KEY, JSON.stringify({ v: 1, bytes, enemies: enemyEdits, stages })); else localStorage.removeItem(S.PATCH_KEY); }
    catch (e) { msg('Could not save edits in this browser: ' + e.message); }
    countEdits();
  }
  const saveSoon = () => { if (!saveT) saveT = setTimeout(saveNow, 250); };
  function savePrefs() { try { localStorage.setItem(PREFS, JSON.stringify(st)); } catch (e) { /* prefs are optional */ } }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
      if (!p || typeof p !== 'object') return;
      for (const k of ['scene', 'area', 'sel']) if (Number.isInteger(p[k]) && p[k] >= 0) st[k] = p[k];
      if (typeof p.custom === 'string') st.custom = p.custom;
      if (p.layer === 0 || p.layer === 1) st.layer = p.layer;
      if (p.zoom === 1 || p.zoom === 2) st.zoom = p.zoom;
      for (const k of ['other', 'grid', 'edits']) if (typeof p[k] === 'boolean') st[k] = p[k];
    } catch (e) { /* defaults */ }
  }
  function touch(off) { for (const i of [off, off + 1]) { if (work[i] === orig[i]) delete bytes[i]; else bytes[i] = work[i]; } saveSoon(); }
  function countEdits() { $('exp').disabled = !Object.keys(bytes).length && !Object.keys(enemyEdits).length && !Object.keys(stages).length; }

  // ---------- data
  const word = off => (work[off] << 8) | work[off + 1];
  const edited = off => work[off] !== orig[off] || work[off + 1] !== orig[off + 1];
  function scanMetaMax() { // largest block number each block table is used with, over every stage and section
    metaMax.clear();
    for (const sc of S.SCENES) for (let a = 0, n = D.sectionCount(sc.st); a < n; a++) for (const L of D.section(sc.st, a).layers) {
      if (!L) continue; let m = metaMax.get(L.meta.rom) || 0;
      for (const s of L.map.screens) for (let i = 0; i < L.map.rows * 8; i++) m = Math.max(m, word(s + 2 * i) & 0x3ff);
      metaMax.set(L.meta.rom, m);
    }
  }
  function buildAtlas(l) {
    const L = sec.layers[l]; if (!L) { atlas[l] = native[l] = null; nBlk[l] = 0; return; }
    const nn = (metaMax.get(L.meta.rom) || 0) + 1, nrows = Math.ceil(nn / 16);
    const c0 = document.createElement('canvas'); c0.width = 16 * CELL; c0.height = nrows * CELL;
    const img0 = new ImageData(c0.width, c0.height);
    for (let i = 0; i < nn; i++) { const b = D.block(L, i); if (b) S.drawBlock(img0.data, c0.width, (i & 15) * CELL, (i >> 4) * CELL, b, l, sec.crb, tiles, ram); }
    c0.getContext('2d').putImageData(img0, 0, 0); native[l] = c0;
    if (!tset) { atlas[l] = c0; nBlk[l] = nn; return; }
    const n = nBlk[l] = tset.layers[l].count, rows = Math.ceil(n / 16);
    const c = document.createElement('canvas'); c.width = 16 * CELL; c.height = rows * CELL;
    const img = new ImageData(c.width, c.height);
    for (let i = 0; i < n; i++) SIMPTILES.drawBlock(img.data, c.width, (i & 15) * CELL, (i >> 4) * CELL, tset, l, i);
    c.getContext('2d').putImageData(img, 0, 0); atlas[l] = c;
  }
  function loadSection() {
    const sc = S.SCENES[st.scene];
    sec = D.section(sc.st, st.area); ram = D.palette(sc);
    const cs = custom(), tv = cs && cs.tileset, ts = tv && SIMPTILES.sets[tv.id];
    tset = ts && ts.area === st.area ? ts : null; tmaps = tset ? tv.maps : null;
    enemyRows = enemyStage() < 0 ? [] : clone((cs ? cs.enemies : enemyEdits[enemyStage()]) || E.read(orig, enemyStage())); enemySelected = -1; enemyHover = -1; eventSel = -1;
    fillNativeKinds(); showEnemyPreview();
    if (!sec.layers[st.layer]) st.layer = sec.layers[0] ? 0 : 1;
    buildAtlas(0); buildAtlas(1);
    cellIx = new Map();
    for (const L of sec.layers) if (L) for (let x = 0; x < L.map.screens.length * 8; x++) for (let y = 0; y < L.map.rows; y++) {
      const off = D.cellOff(L, x, y); (cellIx.get(off) || cellIx.set(off, []).get(off)).push([L.layer, x, y]);
    }
    const Ls = sec.layers.filter(Boolean);
    map.width = Math.max(...Ls.map(L => L.map.screens.length)) * 256; map.height = Math.max(...Ls.map(L => L.map.rows)) * CELL;
    if (st.sel >= nBlk[st.layer]) st.sel = 0;
    if ((enemyStage() < 0 && mode !== 'blocks') || (mode === 'events' && !custom())) setMode('blocks');
    applyZoom(); drawAll(); drawPicker(); drawSel(); syncUi(); syncEnemies(); savePrefs();
  }

  // ---------- drawing
  function drawCell(x, y) {
    const px = x * CELL, py = y * CELL; ctx.clearRect(px, py, CELL, CELL);
    const order = tset ? [0, 1] : st.layer === 1 ? [0, 1] : [1, 0]; // custom level: game order (its back layer is opaque); native: edited layer on top
    for (const l of order) {
      const L = sec.layers[l]; if (!L || (l !== st.layer && !st.other)) continue;
      if (tset) {
        if (x >= tset.cols || y >= tset.rows) continue;
        const i = y * tset.cols + x, id = tmaps[l][i]; ctx.globalAlpha = l === st.layer ? 1 : l === 1 ? 0.6 : 0.45;
        ctx.drawImage(atlas[l], (id & 15) * CELL, (id >> 4) * CELL, CELL, CELL, px, py, CELL, CELL); ctx.globalAlpha = 1;
        if (l === st.layer && st.edits && id !== tset.layers[l].map[i]) { ctx.strokeStyle = '#ff5d8f'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2); }
        continue;
      }
      const off = D.cellOff(L, x, y); if (off < 0) continue;
      const idx = word(off) & 0x3ff; ctx.globalAlpha = l === st.layer ? 1 : 0.35;
      if (idx < nBlk[l]) ctx.drawImage(atlas[l], (idx & 15) * CELL, (idx >> 4) * CELL, CELL, CELL, px, py, CELL, CELL);
      else { ctx.fillStyle = '#a00'; ctx.fillRect(px, py, CELL, CELL); }
      ctx.globalAlpha = 1;
      if (l === st.layer && st.edits && edited(off)) { ctx.strokeStyle = '#ff5d8f'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2); }
    }
    if (st.grid) {
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.strokeRect(px + 0.5, py + 0.5, CELL, CELL);
      if (x % 8 === 0) { ctx.strokeStyle = 'rgba(255,200,97,.7)'; ctx.beginPath(); ctx.moveTo(px + 0.5, py); ctx.lineTo(px + 0.5, py + CELL); ctx.stroke(); }
    }
  }
  function drawAll() { ctx.clearRect(0, 0, map.width, map.height); for (let x = 0; x < map.width / CELL; x++) for (let y = 0; y < map.height / CELL; y++) drawCell(x, y); if (mode === 'enemies' || mode === 'npcs') drawEnemies(); if (mode === 'events') drawEvents(); }
  function redrawOff(off) { for (const [, x, y] of cellIx.get(off) || []) drawCell(x, y); }
  function drawPicker() {
    const n = nBlk[st.layer], rows = Math.max(1, Math.ceil(n / 8));
    pick.width = 8 * CELL; pick.height = rows * CELL; pctx.clearRect(0, 0, pick.width, pick.height);
    for (let i = 0; i < n; i++) pctx.drawImage(atlas[st.layer], (i & 15) * CELL, (i >> 4) * CELL, CELL, CELL, (i & 7) * CELL, (i >> 3) * CELL, CELL, CELL);
    pctx.strokeStyle = '#ffc861'; pctx.lineWidth = 2; pctx.strokeRect((st.sel & 7) * CELL + 1, (st.sel >> 3) * CELL + 1, CELL - 2, CELL - 2);
  }
  function drawSel() {
    sctx.clearRect(0, 0, CELL, CELL); const L = sec.layers[st.layer]; if (!L) return;
    sctx.drawImage(atlas[st.layer], (st.sel & 15) * CELL, (st.sel >> 4) * CELL, CELL, CELL, 0, 0, CELL, CELL);
    if (tset) { const used = tmaps[st.layer].filter(v => v === st.sel).length; $('selinfo').innerHTML = `<b>${tset.name}</b> block <b>#${st.sel}</b><br>used ${used}&times; in this layer<br><span style="color:var(--dim)">${nBlk[st.layer]} custom blocks; collision stays the original stage's</span>`; return; }
    let used = 0; for (const s of L.map.screens) for (let i = 0; i < L.map.rows * 8; i++) if ((word(s + 2 * i) & 0x3ff) === st.sel) used++;
    const b = D.block(L, st.sel);
    $('selinfo').innerHTML = `Block <b>#${st.sel}</b> (${hex(st.sel, 3)})<br>attribute ${hex(b.attr, 2)}<br>used ${used}&times; in this layer<br><span style="color:var(--dim)">set ${hex(L.meta.rom, 5)}, ${nBlk[st.layer]} blocks</span>`;
  }
  function applyZoom() { map.style.width = map.width * st.zoom + 'px'; map.style.height = map.height * st.zoom + 'px'; }
  function syncUi() {
    fillScenes(); fillAreas(); fillTilesets();
    $('stageRename').hidden = $('stageDelete').hidden = !custom();
    $('toolEvents').disabled = !custom();
    $('toolEvents').title = custom() ? 'Place scripted events, or describe a new one in your own words' : 'Scripted events are part of custom stages: make one with New stage';
    for (const l of [0, 1]) { $('l' + l).classList.toggle('on', st.layer === l); $('l' + l).disabled = !sec.layers[l]; }
    $('vOther').classList.toggle('on', st.other); $('vGrid').classList.toggle('on', st.grid); $('vEdits').classList.toggle('on', st.edits); $('vZoom').classList.toggle('on', st.zoom === 2);
    $('undo').disabled = !undo.length; $('redo').disabled = !redo.length; countEdits();
    $('toolEnemies').disabled = enemyStage() < 0;
    $('toolNpcs').disabled = enemyStage() < 0;
    $('toolEnemies').title = enemyStage() < 0 ? 'Enemy placement is available in combat stages' : 'Place and move enemies';
  }
  function fillScenes() {
    const sel = $('scene'); sel.innerHTML = '';
    const add = (parent, value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; parent.appendChild(o); };
    const og = document.createElement('optgroup'); og.label = 'Original stages'; S.SCENES.forEach((sc, i) => add(og, i, sc.name)); sel.appendChild(og);
    const mine = document.createElement('optgroup'); mine.label = 'Your stages'; mine.id = 'customStages';
    for (const [id, cs] of Object.entries(stages)) add(mine, 'c:' + id, `${cs.name} (on ${S.SCENES[SIMPCUSTOM.sceneIndex(cs.scene)].name})`);
    if (Object.keys(stages).length < SIMPCUSTOM.MAX) add(mine, 'new', '+ New stage…');
    sel.appendChild(mine); sel.value = custom() ? 'c:' + st.custom : String(st.scene);
  }
  function fillTilesets() {
    const sel = $('tileset'), cs = custom(), sc = S.SCENES[st.scene], all = cs ? SIMPTILES.forSceneAll(sc.scene) : [], set = all[0];
    sel.length = 1; sel.options[0].textContent = 'Original';
    for (const t of all) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o); }
    sel.disabled = !set; sel.value = cs && cs.tileset ? cs.tileset.id : '';
    sel.title = !cs ? 'Original stages keep their own art. Choose “+ New stage…” to build a level with new art.' : set ? `Background art for ${cs.name} (the ground and collision are ${sc.name}'s)` : `No custom level art for ${sc.name}'s ground yet`;
  }
  function setTileset(id) {
    const cs = custom(), sc = S.SCENES[st.scene], cur = cs && cs.tileset ? cs.tileset.id : '', set = cs && SIMPTILES.sets[id || cur];
    if (!set || set.scene !== sc.scene || cur === id) return;
    if (id && cur && !confirm(`Switch ${cs.name} to the ${set.name} art? Painting done in the current art and its scripted events are replaced.`)) { fillTilesets(); return; }
    if (id) {
      cs.tileset = { id, maps: SIMPTILES.defaults(set) }; cs.events = SIMPEVENTS.defaults(id).concat(cs.events.filter(e => e.type === 'custom'));
      msg(`${cs.name} now uses the ${set.name} art. Paint with its blocks, then press Play.`);
    } else {
      if (!confirm(`Show ${sc.name}'s original art in ${cs.name}? Painting done in ${set.name} and its scripted events are removed.`)) { fillTilesets(); return; }
      cs.tileset = null; cs.events = cs.events.filter(e => e.type === 'custom'); msg(`${cs.name} now shows ${sc.name}'s original art.`);
    }
    undo = []; redo = []; st.area = set.area; st.sel = 0; saveNow(); loadSection();
  }
  // ---------- custom stages
  function openNewStage() {
    const sel = $('nsTemplate'); sel.innerHTML = '';
    SIMPCUSTOM.templates().forEach((t, i) => { const o = document.createElement('option'); o.value = i; o.textContent = t.label; sel.appendChild(o); });
    $('nsName').value = ''; $('newStage').showModal(); $('nsName').focus();
  }
  function createStage(name, t) {
    const set = t.art && SIMPTILES.sets[t.art], nm = (name || '').trim() || (set ? set.name : 'New stage');
    const id = SIMPCUSTOM.newId(stages, nm); stages[id] = SIMPCUSTOM.make(nm, t.scene, t.art);
    st.custom = id; st.scene = SIMPCUSTOM.sceneIndex(t.scene); st.area = set ? set.area : 0; st.sel = 0; undo = []; redo = [];
    saveNow(); loadSection(); msg(`Created ${stages[id].name}. It plays on ${S.SCENES[st.scene].name}'s ground; the original stage is unchanged.`);
    return id;
  }
  $('nsCreate').onclick = e => { e.preventDefault(); const t = SIMPCUSTOM.templates()[+$('nsTemplate').value]; $('newStage').close(); if (t) createStage($('nsName').value, t); };
  $('nsCancel').onclick = e => { e.preventDefault(); $('newStage').close(); syncUi(); };
  $('newStage').addEventListener('close', () => syncUi());
  $('stageRename').onclick = () => {
    const cs = custom(); if (!cs) return; const n = prompt('Stage name', cs.name); if (n === null) return;
    cs.name = n.trim().slice(0, 40) || cs.name; saveNow(); syncUi(); msg(`Renamed to ${cs.name}.`);
  };
  $('stageDelete').onclick = () => {
    const cs = custom(); if (!cs || !confirm(`Delete ${cs.name}? Its art, enemies and events are lost. The original stages are not affected.`)) return;
    delete stages[st.custom]; st.custom = null; st.area = 0; undo = []; redo = []; saveNow(); loadSection(); msg(`Deleted ${cs.name}.`);
  };
  $('tileset').onchange = e => setTileset(e.target.value);
  function fillAreas() {
    const sel = $('area'), n = D.sectionCount(S.SCENES[st.scene].st); sel.innerHTML = '';
    for (let a = 0; a < n; a++) { const o = document.createElement('option'); o.value = a; o.textContent = a === 0 ? 'Main' : 'Part ' + (a + 1); sel.appendChild(o); }
    sel.value = st.area;
  }

  // ---------- editing
  function cellAt(e) {
    const r = map.getBoundingClientRect(), k = CELL * st.zoom;
    return { x: Math.floor((e.clientX - r.left) / k), y: Math.floor((e.clientY - r.top) / k) };
  }
  function paint(x, y) {
    if (custom() && !tset) { msg(`This section is ${S.SCENES[st.scene].name}'s own ground. Paint it on the original stage, or pick the section with ${custom().name}'s art.`); return; }
    if (tset) {
      if (x < 0 || y < 0 || x >= tset.cols || y >= tset.rows) return;
      const i = y * tset.cols + x, before = tmaps[st.layer][i]; if (before === st.sel) return;
      const key = tileKey(st.layer, i), c = stroke.get(key); if (c) c.after = st.sel; else stroke.set(key, { before, after: st.sel });
      setTile(key, st.sel); return;
    }
    const L = sec.layers[st.layer], off = D.cellOff(L, x, y); if (off < 0) return;
    const before = word(off); if ((before & 0x3ff) === st.sel) return;
    D.setBlock(L, x, y, st.sel);
    const c = stroke.get(off); if (c) c.after = word(off); else stroke.set(off, { before, after: word(off) });
    touch(off); redrawOff(off);
  }
  function commit(changes, label) {
    if (!changes.size) return; undo.push({ changes, label }); if (undo.length > 500) undo.shift(); redo = []; syncUi(); saveSoon();
  }
  function setWord(off, w) { work[off] = w >> 8; work[off + 1] = w & 0xff; touch(off); redrawOff(off); }
  function setTile(key, id) { // custom level cell: key = tileKey(layer, index)
    const [l, i] = key.slice(1).split(':').map(Number), tv = custom() && custom().tileset; if (!tv) return;
    tv.maps[l][i] = id; saveSoon();
    if (tset && tv.maps === tmaps) drawCell(i % tset.cols, Math.floor(i / tset.cols));
  }
  function step(from, to, key) {
    const s = from.pop(); if (!s) return;
    if (s.events !== undefined) {
      if (stages[s.events]) stages[s.events].events = clone(s[key]);
      if (s.events === st.custom) { eventSel = -1; syncEvents(); drawAll(); }
      saveSoon();
    } else if (s.enemyStage !== undefined) {
      storeEnemies(s.enemyStage, s.custom, s[key]);
      if (s.enemyStage === enemyStage() && (s.custom || null) === (st.custom || null)) { enemyRows = clone(s[key]); enemySelected = -1; syncEnemies(); drawAll(); }
      saveSoon();
    } else for (const [off, c] of s.changes) typeof off === 'string' ? setTile(off, c[key]) : setWord(off, c[key]);
    to.push(s); scanMetaMax(); syncUi(); drawSel(); msg((key === 'before' ? 'Undid ' : 'Redid ') + s.label);
  }
  function pickAt(x, y) {
    const L = sec.layers[st.layer], off = D.cellOff(L, x, y); if (off < 0) return;
    st.sel = tset ? (tmaps[st.layer][y * tset.cols + x] ?? 0) : word(off) & 0x3ff; drawPicker(); drawSel(); savePrefs();
  }
  function hover(e) {
    const { x, y } = cellAt(e), L = sec.layers[st.layer], off = L ? D.cellOff(L, x, y) : -1;
    $('hover').innerHTML = off < 0 ? '&nbsp;' : `<b>${L.name}</b> screen ${x >> 3} &middot; column ${x & 7} &middot; row ${y} &middot; block <b>#${word(off) & 0x3ff}</b> &middot; map word ${hex(word(off), 4)} at ROM ${hex(off, 5)}${edited(off) ? ' &middot; <b style="color:#ff5d8f">edited</b>' : ''}`;
  }
  map.addEventListener('contextmenu', e => e.preventDefault());
  map.addEventListener('pointerdown', e => {
    if (!sec) return;
    if (mode === 'events') { eventDown(e); return; }
    if (mode !== 'blocks') { enemyDown(e); return; }
    const { x, y } = cellAt(e);
    if (e.button === 2 || e.altKey) { pickAt(x, y); return; }
    if (e.button !== 0) return;
    map.setPointerCapture(e.pointerId); stroke = new Map(); paint(x, y);
  });
  map.addEventListener('pointermove', e => {
    if (!sec) return;
    if (mode === 'events') {
      const p = enemyPoint(e); $('hover').textContent = `Event trigger: X ${p.x}`;
      if (eventDrag && custom()) { custom().events[eventSel].x = p.x; syncEvents(); drawAll(); }
      return;
    }
    if (mode !== 'blocks') {
      const p = enemyPoint(e); $('hover').textContent = `Enemy placement: X ${p.x}, Y ${p.y}`;
      if (!enemyDrag) {
        let near = -1, best = 24; enemyRows.forEach((row, i) => { if (!visibleEntity(row)) return; const a = E.position(row), d = Math.hypot(p.x - a.x, p.y - a.y); if (d < best) { best = d; near = i; } });
        if (near !== enemyHover) { enemyHover = near; if (near >= 0) $('hover').textContent = enemyName(enemyRows[near]) + ` · X ${p.x}, Y ${p.y}`; drawAll(); }
      }
      if (enemyDrag) { E.move(enemyRows[enemySelected], p.x, p.y); syncEnemies(); drawAll(); } return;
    }
    hover(e); if (stroke) { const { x, y } = cellAt(e); paint(x, y); }
  });
  const end = () => {
    if (eventDrag) { const d = eventDrag; eventDrag = null; commitEvents(d.before, 'Move ' + SIMPEVENTS.nameOf(custom().events[eventSel]), eventSel); return; }
    if (enemyDrag) { const before = enemyDrag; enemyDrag = null; commitEnemies(before, 'move enemy'); return; }
    if (!stroke) return; const s = stroke; stroke = null; commit(s, `paint (${s.size} block${s.size === 1 ? '' : 's'})`); if (s.size) { scanMetaMax(); drawSel(); }
  };
  map.addEventListener('pointerup', end); map.addEventListener('pointercancel', end);
  pick.addEventListener('click', e => {
    if (!sec) return;
    const r = pick.getBoundingClientRect(), k = r.width / pick.width;
    const i = Math.floor((e.clientY - r.top) / k / CELL) * 8 + Math.floor((e.clientX - r.left) / k / CELL);
    if (i >= 0 && i < nBlk[st.layer]) { st.sel = i; drawPicker(); drawSel(); savePrefs(); }
  });

  // ---------- enemies (the original eight-byte spawn stream, with optional custom skin metadata)
  const enemyPreview = $('enemyPreview'), assets = window.SIMPENEMY_ASSETS, thumbnails = {};
  for (const asset of Object.values(assets)) {
    const pixels = E.decode(asset), image = new ImageData(asset.width, asset.height), canvas = document.createElement('canvas');
    canvas.width = asset.width; canvas.height = asset.height;
    for (let i = 0; i < asset.width * asset.height; i++) {
      const pen = pixels[i]; if (!pen) continue;
      const [r, g, b] = S.rgb(asset.palette, pen); image.data.set([r, g, b, 255], i * 4);
    }
    canvas.getContext('2d').putImageData(image, 0, 0); thumbnails[asset.id] = canvas;
  }
  function fillNativeKinds() { // the stage's own object types (characters, props) that can be placed
    const sel = $('enemyKind'); sel.querySelector('#nativeKinds')?.remove();
    const stage = enemyStage(); if (stage < 0) return;
    const group = document.createElement('optgroup'); group.id = 'nativeKinds'; group.label = 'This stage’s own characters & props';
    const seen = new Set();
    for (const row of E.read(orig, stage)) {
      const id = row.data[7]; if (E.kind(row) !== 'character' || seen.has(id)) continue; seen.add(id);
      const o = document.createElement('option'); o.value = 'native:' + id; o.textContent = E.label(row, enemyStage()); group.appendChild(o);
    }
    if (group.children.length) sel.appendChild(group);
    if (!sel.value) sel.value = 'rivet';
  }
  function makeEntity(kind, x, y, role) {
    if (!kind.startsWith('native:')) return E.make(kind, x, y, role);
    const id = +kind.slice(7), src = E.read(orig, enemyStage()).find(r => r.data[7] === id && E.kind(r) === 'character');
    const row = { data: src.data.slice() }; E.move(row, x, y); return row;
  }
  function showEnemyPreview() {
    const kind = $('enemyKind').value, asset = assets[kind], c = enemyPreview.getContext('2d'); c.clearRect(0, 0, enemyPreview.width, enemyPreview.height);
    const pv = kind.startsWith('native:') ? nativePreview(+kind.slice(7)) : null;
    if (pv) { const k = Math.min(1, enemyPreview.width / pv.canvas.width, enemyPreview.height / pv.canvas.height); c.imageSmoothingEnabled = false; c.drawImage(pv.canvas, (enemyPreview.width - pv.canvas.width * k) / 2, enemyPreview.height - pv.canvas.height * k, pv.canvas.width * k, pv.canvas.height * k); }
    enemyPreview.hidden = !asset && !pv; if (pv) return;
    if (asset) { enemyPreview.setAttribute('aria-label', asset.name + ' enemy preview'); c.drawImage(thumbnails[asset.id], 0, 0); }
  }
  $('enemyKind').onchange = showEnemyPreview; showEnemyPreview();
  // The game's own objects: tools/capture_native_sprites.js recorded their sprite entries (web/stage/native_sprites.js);
  // the picture is rendered here from the ROM's sprite graphics with palettes read from prog.bin at recorded offsets.
  let romFiles = null, nativeVid = null, enemyHover = -1; const nativeCache = new Map();
  function nativeCapture(id) {
    const lib = window.SIMPNATIVE_SPRITES || {};
    // other stages' captures only stand in for ids that are the same everywhere (basic enemies, the purple-suit goon)
    return lib[enemyStage() + ':' + id] || (id <= 4 || id === 0x25 ? Object.entries(lib).find(([k]) => +k.split(':')[1] === id)?.[1] : null) || null;
  }
  function nativePreview(id) {
    const cap = nativeCapture(id); if (!cap || !romFiles || !window.SimpsonsVideo) return null;
    if (nativeCache.has(cap)) return nativeCache.get(cap);
    if (!nativeVid) nativeVid = new SimpsonsVideo.Video({ obj: romFiles['gfx_sprites.bin'], chr: new Uint8Array(32), sprDst: new Uint16Array(0x800), k46: new Uint8Array(8) });
    const v = nativeVid, b = v.b; b.sprDst.fill(0); cap.pieces.forEach((p, i) => b.sprDst.set(p, i * 8)); b.k46.set(cap.k46);
    v.bmp.fill(0); v.pri.fill(0); v.drawSprites(cap.colorbase, [255, 255, 255]);
    let x0 = 320, y0 = 264, x1 = -1, y1 = -1;
    for (let y = 0; y < 264; y++) for (let x = 0; x < 320; x++) if (v.pri[y * 320 + x] === 31) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    let res = null;
    if (x1 >= 0) {
      const w = x1 - x0 + 1, h = y1 - y0 + 1, c = document.createElement('canvas'); c.width = w; c.height = h;
      const img = new ImageData(w, h), c5 = n => (n << 3) | (n >> 2);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y0 + y) * 320 + x0 + x; if (v.pri[i] !== 31) continue;
        const pen = v.bmp[i] & 2047, off = cap.pal[pen >> 4]; if (off === undefined) continue;
        const o = off + (pen & 15) * 2, col = (orig[o] << 8) | orig[o + 1], k = (y * w + x) * 4;
        img.data[k] = c5(col & 31); img.data[k + 1] = c5((col >> 5) & 31); img.data[k + 2] = c5((col >> 10) & 31); img.data[k + 3] = 255;
      }
      c.getContext('2d').putImageData(img, 0, 0); res = { canvas: c, ax: cap.anchor[0] - x0, ay: cap.anchor[1] - y0 };
    }
    nativeCache.set(cap, res); return res;
  }
  window.SIMPEDITOR_TEST = { nativePreview, createStage: (name, art, scene) => createStage(name, { art, scene }), get stages() { return stages; } }; // for test/test_native_characters.py
  const enemyName = row => row.role === 'npc' ? (row.npcName || assets[row.skin]?.name) : assets[row.skin]?.name || E.label(row, enemyStage());
  function drawEnemies() {
    ctx.imageSmoothingEnabled = false;
    enemyRows.forEach((row, i) => {
      if (!visibleEntity(row)) return;
      const { x, y } = E.position(row), selected = i === enemySelected;
      const asset = assets[row.skin], k0 = E.kind(row), pv = !asset && k0 !== 'script' ? nativePreview(row.data[7]) : null;
      const size = asset ? E.display(asset) : pv ? { width: pv.canvas.width, height: pv.canvas.height, anchor: [pv.ax, pv.ay] } : { width:32, height:56, anchor:[16,52] };
      if (asset) ctx.drawImage(thumbnails[row.skin], x - size.anchor[0], y - size.anchor[1], size.width, size.height);
      else if (pv) ctx.drawImage(pv.canvas, x - pv.ax, y - pv.ay);
      const k = k0, color = row.role === 'npc' ? '#7ad0ff' : k === 'character' ? '#8ef08e' : k === 'script' ? '#9a9a9a' : '#ff5d8f';
      ctx.strokeStyle = selected ? '#fff' : color; ctx.fillStyle = selected ? '#ffc861' : color; ctx.lineWidth = 2;
      if (k === 'script') ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.ellipse(x, y, 12, 5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (!asset && !pv && k !== 'script') { ctx.globalAlpha = .55; ctx.fillStyle = color; ctx.fillRect(x - 10, y - 46, 20, 44); ctx.globalAlpha = 1; }
      if (selected || i === enemyHover) { // names only for the selected or hovered marker (the list on the right has them all)
        ctx.font = '10px system-ui'; const name = enemyName(row), tw = ctx.measureText(name).width + 8;
        ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillRect(x - tw / 2, y + 8, tw, 14);
        ctx.fillStyle = selected ? '#ffc861' : '#fff'; ctx.fillText(name, x - tw / 2 + 4, y + 19);
      }
      if (selected) ctx.strokeRect(x - size.anchor[0] - 1, y - size.anchor[1] - 1, size.width + 2, size.height + 2);
    });
  }
  function syncEnemies() {
    const list = $('enemyList'); list.innerHTML = '';
    enemyRows.forEach((row, i) => {
      if (!visibleEntity(row)) return;
      const o = document.createElement('option'), p = E.position(row); o.value = i;
      o.textContent = `${enemyName(row)} · ${p.x}, ${p.y}`; list.appendChild(o);
    });
    list.value = enemySelected;
    const row = enemyRows[enemySelected], selected = row && visibleEntity(row);
    for (const id of ['enemyY', 'enemyMove', 'enemyDelete']) $(id).disabled = !selected || !E.movable(row);
    $('enemyX').disabled = !selected; $('eventDup').disabled = !selected || mode === 'npcs';
    $('enemyInfo').textContent = !selected ? '' : E.kind(row) === 'script' ? `${E.label(row, enemyStage())}: a stage script record (its exact behaviour is only partly decoded). It cannot be moved, but “Duplicate group to X” copies it with the records next to it (experimental).` : E.kind(row) === 'character' ? `The stage's own ${E.label(row, enemyStage())} (native art and behaviour). Drag to move it; it appears when the camera reaches its X.` : '';
    $('enemyX').value = selected ? E.position(row).x : ''; $('enemyY').value = selected ? E.position(row).y : '';
    $('npcFields').hidden = mode !== 'npcs';
    for (const id of ['npcName','npcDialogue','npcApply']) $(id).disabled = !selected;
    $('npcName').value = selected && row.role === 'npc' ? row.npcName || '' : '';
    $('npcDialogue').value = selected && row.role === 'npc' ? row.dialogue || '' : '';
  }
  function storeEnemies(stage, cid, rows) { // a custom stage keeps its own list; null = the original stage's list
    const same = JSON.stringify(rows) === JSON.stringify(E.read(orig, stage));
    if (cid) { if (stages[cid]) stages[cid].enemies = same ? null : clone(rows); return; }
    if (same) delete enemyEdits[stage]; else enemyEdits[stage] = clone(rows);
  }
  function commitEnemies(before, label) {
    if (JSON.stringify(before) === JSON.stringify(enemyRows)) return;
    const stage = enemyStage(); storeEnemies(stage, st.custom, enemyRows);
    undo.push({ enemyStage: stage, custom: st.custom, before, after: clone(enemyRows), label }); if (undo.length > 500) undo.shift(); redo = [];
    saveSoon(); syncUi(); syncEnemies(); drawAll(); msg(label + (custom() ? `. Saved in ${custom().name}.` : '. Saved for this stage.'));
  }
  function enemyPoint(e) {
    const r = map.getBoundingClientRect();
    return { x: Math.round(Math.max(0, Math.min(map.width - 1, (e.clientX - r.left) / st.zoom))), y: Math.round(Math.max(0, Math.min(map.height - 1, (e.clientY - r.top) / st.zoom)) / 8) * 8 };
  }
  function enemyDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    if (st.area !== 0) { msg('Select Main to place enemies. The spawn list applies to the whole stage.'); return; }
    const p = enemyPoint(e);
    let found = -1, distance = Infinity;
    enemyRows.forEach((row, i) => {
      if (!visibleEntity(row)) return; const a = E.position(row), d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d < 24 && d < distance) { found = i; distance = d; }
    });
    if (found >= 0) {
      enemySelected = found;
      if (!E.movable(enemyRows[found])) { syncEnemies(); drawAll(); return; }
      if (e.button === 2) { deleteEnemy(); return; }
      enemyDrag = clone(enemyRows); map.setPointerCapture(e.pointerId); syncEnemies(); drawAll(); return;
    }
    if (e.button !== 0) return;
    if (enemyRows.length >= 255) { msg('This stage has reached its 255-spawn limit.'); return; }
    const before = clone(enemyRows); enemyRows.push(makeEntity($('enemyKind').value, p.x, p.y, mode === 'npcs' ? 'npc' : undefined)); enemySelected = enemyRows.length - 1;
    commitEnemies(before, 'Add ' + (mode === 'npcs' ? 'NPC ' : '') + enemyName(enemyRows[enemySelected]));
  }
  function deleteEnemy() {
    if (enemySelected < 0 || !enemyRows[enemySelected] || !E.movable(enemyRows[enemySelected])) return;
    const before = clone(enemyRows); enemyRows.splice(enemySelected, 1); enemySelected = -1; commitEnemies(before, 'Delete enemy');
  }
  $('enemyList').onchange = e => {
    enemySelected = +e.target.value; syncEnemies(); drawAll();
    const p = E.position(enemyRows[enemySelected]); $('mapwrap').scrollLeft = Math.max(0, p.x * st.zoom - $('mapwrap').clientWidth / 2);
  };
  $('enemyDelete').onclick = deleteEnemy;
  $('eventDup').onclick = () => { // copy an event with the records that sit next to it (same X +- 40) to a new X
    const row = enemyRows[enemySelected], x = Number($('enemyX').value); if (!row || !Number.isFinite(x)) return;
    const x0 = E.position(row).x, dx = Math.round(x) - x0;
    if (!dx) { msg('Enter a different X to copy the group to.'); return; }
    const group = enemyRows.filter(r => r.role !== 'npc' && Math.abs(E.position(r).x - x0) <= 40);
    if (enemyRows.length + group.length > 255) { msg('This stage would exceed its 255-spawn limit.'); return; }
    const before = clone(enemyRows);
    for (const r of group) { const c = clone(r), nx = Math.max(0, Math.min(0xfeff, E.position(c).x + dx)); c.data[0] = nx >> 8; c.data[1] = nx & 255; c.edited = true; enemyRows.push(c); } // X only; other bytes kept
    enemySelected = enemyRows.length - group.length + group.indexOf(row);
    commitEnemies(before, `Duplicate group (${group.length} record${group.length === 1 ? '' : 's'}) to X ${x0 + dx}`);
  };
  $('enemyMove').onclick = () => {
    const x = Number($('enemyX').value), y = Number($('enemyY').value);
    if (enemySelected < 0 || !Number.isFinite(x) || !Number.isFinite(y) || !E.movable(enemyRows[enemySelected])) return;
    const before = clone(enemyRows); E.move(enemyRows[enemySelected], x, y); commitEnemies(before, 'Move enemy');
  };
  function saveNpcDetails() {
    const row=enemyRows[enemySelected]; if(mode!=='npcs'||!row||row.role!=='npc')return;
    const before=clone(enemyRows); row.npcName=$('npcName').value.trim().slice(0,40); row.dialogue=$('npcDialogue').value.trim().slice(0,200); commitEnemies(before,'Update NPC dialogue');
  }
  $('npcApply').onclick=saveNpcDetails;
  $('npcName').onchange=saveNpcDetails; $('npcDialogue').onchange=saveNpcDetails;
  // ---------- scripted events (custom stages): markers at their trigger X; an event fires when the camera brings that X
  // to the middle of the screen
  const eventTypes = () => { const cs = custom(); return cs && cs.tileset ? SIMPEVENTS.typesFor(cs.tileset.id) : []; };
  const EVCOL = { ball: '#ff5d5d', pins: '#f3f3f3', cosmic: '#d98cff', frenzy: '#7ad0ff', custom: '#8ff58a' };
  const made = []; // recipes described in this session, offered in the Place menu as "made:<i>"
  function drawEvents() {
    const cs = custom(); if (!cs) return;
    cs.events.forEach((ev, i) => {
      const sel = i === eventSel, col = EVCOL[ev.type] || '#ffc861', name = (ev.type === 'custom' ? '✨ ' : '') + SIMPEVENTS.nameOf(ev);
      ctx.strokeStyle = col; ctx.lineWidth = sel ? 3 : 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(ev.x + 0.5, 0); ctx.lineTo(ev.x + 0.5, map.height); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = 'bold 11px system-ui'; const w = ctx.measureText(name).width + 10, y = 8 + (i % 3) * 18;
      ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillRect(ev.x + 3, y, w, 15); ctx.strokeStyle = sel ? '#fff' : col; ctx.lineWidth = 1; ctx.strokeRect(ev.x + 3.5, y + 0.5, w - 1, 14);
      ctx.fillStyle = col; ctx.fillText(name, ev.x + 8, y + 11);
    });
  }
  function syncEvents() {
    const cs = custom(), list = $('eventList'), types = eventTypes(); list.innerHTML = '';
    const kind = $('eventType'), keep = kind.value; kind.innerHTML = '';
    for (const t of types) { const o = document.createElement('option'); o.value = t; o.textContent = SIMPEVENTS.TYPES[t].name; kind.appendChild(o); }
    made.forEach((m, i) => { const o = document.createElement('option'); o.value = 'made:' + i; o.textContent = '✨ ' + m.recipe.name; kind.appendChild(o); });
    if ([...kind.options].some(o => o.value === keep)) kind.value = keep;
    const pending = madeOf(kind.value);
    $('eventText').textContent = pending ? SIMPRECIPE.describe(pending.recipe) : kind.value ? SIMPEVENTS.TYPES[kind.value].text : 'Describe an event above to make one.';
    (cs ? cs.events : []).forEach((ev, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${ev.type === 'custom' ? '✨ ' : ''}${SIMPEVENTS.nameOf(ev)} · X ${ev.x}`; list.appendChild(o); });
    list.value = eventSel; $('eventX').value = eventSel >= 0 && cs ? cs.events[eventSel].x : '';
    for (const id of ['eventX', 'eventMove', 'eventDelete']) $(id).disabled = eventSel < 0;
    // a selected described event can be read back and remade from an edited description
    const sel = cs && eventSel >= 0 ? cs.events[eventSel] : null, own = sel && sel.type === 'custom';
    $('aiMake').textContent = own ? 'Remake selected event' : 'Create event';
    if (own && aiShown !== sel) { $('aiPrompt').value = sel.prompt || ''; $('aiResult').textContent = SIMPRECIPE.describe(sel.recipe) + (sel.recipe.summary ? ' ' + sel.recipe.summary : ''); }
    aiShown = own ? sel : null;
  }
  let aiShown = null, aiBusy = false;
  const madeOf = v => typeof v === 'string' && v.startsWith('made:') ? made[+v.slice(5)] : null;
  function newEvent(type, x) {
    const m = madeOf(type);
    return m ? { type: 'custom', x, prompt: m.prompt, recipe: clone(m.recipe) } : { type, x };
  }
  try { $('aiKey').value = localStorage.getItem('simpsons.claudeKey') || ''; } catch (e) {}
  $('aiKey').onchange = () => { try { const k = $('aiKey').value.trim(); if (k) localStorage.setItem('simpsons.claudeKey', k); else localStorage.removeItem('simpsons.claudeKey'); } catch (e) {} };
  $('aiMake').onclick = async () => {
    const cs = custom(), prompt = $('aiPrompt').value.trim(); if (!cs || aiBusy) return;
    if (!prompt) { $('aiStatus').textContent = 'Describe the event first.'; $('aiPrompt').focus(); return; }
    const key = $('aiKey').value.trim(); let recipe = null, note = '';
    aiBusy = true; $('aiMake').disabled = true; $('aiStatus').textContent = key ? 'Asking Claude…' : 'Reading…';
    try {
      if (key) {
        try { recipe = await SIMPRECIPE.generate(prompt, key); }
        catch (e) { note = `Claude could not make it (${(e && e.message) || e}). The built-in reader made this instead. `; recipe = SIMPRECIPE.fromText(prompt); }
      } else recipe = SIMPRECIPE.fromText(prompt);
    } finally { aiBusy = false; $('aiMake').disabled = false; }
    if (!recipe) { $('aiStatus').textContent = ''; $('aiResult').textContent = note + 'That description did not match anything the built-in reader knows. Try words like rain, roll, explosion, lights out, shake or heal, or add a Claude API key.'; return; }
    $('aiStatus').textContent = '';
    $('aiResult').textContent = note + SIMPRECIPE.describe(recipe) + (recipe.summary && !note ? ' ' + recipe.summary : '');
    made.push({ prompt, recipe }); const value = 'made:' + (made.length - 1);
    const before = clone(cs.events), sel = eventSel >= 0 ? cs.events[eventSel] : null;
    if (sel && sel.type === 'custom') { sel.prompt = prompt; sel.recipe = clone(recipe); aiShown = sel; commitEvents(before, 'Remake ' + recipe.name, eventSel); return; }
    if (cs.events.length >= 24) { syncEvents(); $('eventType').value = value; syncEvents(); msg('A stage can have up to 24 scripted events. Delete one, then place this with a click.'); return; }
    // place it in the middle of the visible map; drag it or click to place more copies
    const wrap = $('mapwrap'), x = Math.max(0, Math.min(map.width - 1, Math.round((wrap.scrollLeft + wrap.clientWidth / 2) / st.zoom)));
    cs.events.push(newEvent(value, x)); aiShown = cs.events[cs.events.length - 1];
    syncEvents(); $('eventType').value = value;
    commitEvents(before, 'Add ' + recipe.name, cs.events.length - 1);
  };
  function commitEvents(before, label, select) {
    const cs = custom(); if (JSON.stringify(before) === JSON.stringify(cs.events)) return;
    const moved = cs.events[select]; cs.events.sort((a, b) => a.x - b.x); eventSel = moved ? cs.events.indexOf(moved) : -1;
    undo.push({ events: st.custom, before, after: clone(cs.events), label }); if (undo.length > 500) undo.shift(); redo = [];
    saveSoon(); syncUi(); syncEvents(); drawAll(); msg(`${label}. Saved in ${cs.name}.`);
  }
  function eventDown(e) {
    const cs = custom(); if (!cs || e.button !== 0 && e.button !== 2) return;
    const p = enemyPoint(e); let found = -1, best = 10;
    cs.events.forEach((ev, i) => { const d = Math.abs(ev.x - p.x); if (d < best) { best = d; found = i; } });
    if (found >= 0) {
      eventSel = found; if (e.button === 2) { deleteEvent(); return; }
      eventDrag = { before: clone(cs.events) }; map.setPointerCapture(e.pointerId); syncEvents(); drawAll(); return;
    }
    if (e.button !== 0 || !$('eventType').value) return;
    if (cs.events.length >= 24) { msg('A stage can have up to 24 scripted events.'); return; }
    const before = clone(cs.events), ev = newEvent($('eventType').value, p.x); cs.events.push(ev);
    commitEvents(before, 'Add ' + SIMPEVENTS.nameOf(ev), cs.events.length - 1);
  }
  function deleteEvent() {
    const cs = custom(); if (!cs || eventSel < 0) return;
    const before = clone(cs.events), name = SIMPEVENTS.nameOf(cs.events[eventSel]); cs.events.splice(eventSel, 1); eventSel = -1; commitEvents(before, 'Delete ' + name, -1);
  }
  $('eventType').onchange = () => syncEvents();
  $('eventList').onchange = e => { eventSel = +e.target.value; syncEvents(); drawAll(); const x = custom().events[eventSel].x; $('mapwrap').scrollLeft = Math.max(0, x * st.zoom - $('mapwrap').clientWidth / 2); };
  $('eventDelete').onclick = deleteEvent;
  $('eventMove').onclick = () => {
    const cs = custom(), x = Math.round(Number($('eventX').value)); if (!cs || eventSel < 0 || !Number.isFinite(x)) return;
    const before = clone(cs.events); cs.events[eventSel].x = Math.max(0, Math.min(map.width - 1, x)); commitEvents(before, 'Move ' + SIMPEVENTS.nameOf(cs.events[eventSel]), eventSel);
  };

  function setMode(value) {
    saveNpcDetails(); end(); mode = value; enemySelected=-1;
    $('toolBlocks').classList.toggle('on', mode === 'blocks'); $('toolEnemies').classList.toggle('on', mode === 'enemies'); $('toolNpcs').classList.toggle('on',mode==='npcs'); $('toolEvents').classList.toggle('on', mode === 'events');
    const native=$('enemyKind').querySelector('option[value="grunt"]'); native.disabled=mode==='npcs'; $('enemyKind').querySelectorAll('#nativeKinds option').forEach(o=>{o.disabled=mode==='npcs';}); if(mode==='npcs'&&($('enemyKind').value==='grunt'||$('enemyKind').value.startsWith('native:')))$('enemyKind').value='rivet'; showEnemyPreview();
    for (const el of [$('sel'), $('pickwrap'), document.querySelector('#side h2')]) el.style.display = mode !== 'blocks' ? 'none' : '';
    $('enemyPanel').hidden = mode === 'blocks' || mode === 'events'; $('eventPanel').hidden = mode !== 'events'; eventSel = -1; drawAll(); syncEnemies(); syncEvents();
    $('entityHint').textContent=mode==='npcs'?'NPCs are friendly, cannot be attacked, and never count toward wave completion. Press E nearby to talk.':'Custom enemies use the standard enemy’s AI, attacks and collisions.';
    msg(mode === 'events' ? 'Describe a new event, or click the map to place the chosen one at that X. Drag a marker to move it; right-click deletes.' : mode === 'npcs' ? 'Click empty map space to add a friendly NPC. Select it to edit its name and dialogue.' : mode==='enemies'?'Click empty map space to add an enemy. Drag a marker to move it.':'Pick a block, then paint on the map.');
  }
  $('toolBlocks').onclick = () => setMode('blocks'); $('toolEnemies').onclick = () => setMode('enemies');
  $('toolNpcs').onclick = () => setMode('npcs'); $('toolEvents').onclick = () => setMode('events');
  $('showScripts').onchange = () => { enemySelected = -1; syncEnemies(); drawAll(); };

  // ---------- toolbar
  function setLayer(l) { if (!sec.layers[l] || l === st.layer) return; st.layer = l; if (st.sel >= nBlk[l]) st.sel = 0; drawAll(); drawPicker(); drawSel(); syncUi(); savePrefs(); }
  const toggle = k => { st[k] = !st[k]; drawAll(); syncUi(); savePrefs(); };
  function zoom() { st.zoom = st.zoom === 2 ? 1 : 2; applyZoom(); syncUi(); savePrefs(); }
  $('scene').onchange = e => {
    const v = e.target.value;
    if (v === 'new') { openNewStage(); return; }
    if (v.startsWith('c:')) { const cs = stages[v.slice(2)]; if (!cs) return; st.custom = v.slice(2); st.scene = SIMPCUSTOM.sceneIndex(cs.scene); const set = cs.tileset && SIMPTILES.sets[cs.tileset.id]; st.area = set ? set.area : 0; }
    else { st.custom = null; st.scene = +v; st.area = 0; }
    undo = []; redo = []; loadSection();
  };
  $('area').onchange = e => { st.area = +e.target.value; loadSection(); };
  $('l0').onclick = () => setLayer(0); $('l1').onclick = () => setLayer(1);
  $('vOther').onclick = () => toggle('other'); $('vGrid').onclick = () => toggle('grid'); $('vEdits').onclick = () => toggle('edits'); $('vZoom').onclick = zoom;
  $('undo').onclick = () => step(undo, redo, 'before'); $('redo').onclick = () => step(redo, undo, 'after');
  $('revert').onclick = () => {
    if (custom()) { // custom art: back to the set's default layout; the original ground is never painted from here
      if (!tset) { msg('This section is the original ground and has no edits in this stage.'); return; }
      const ch = new Map(), def = tset.layers[st.layer].map;
      tmaps[st.layer].forEach((id, i) => { if (id !== def[i]) { const key = tileKey(st.layer, i); ch.set(key, { before: id, after: def[i] }); setTile(key, def[i]); } });
      commit(ch, `revert ${st.layer ? 'front' : 'back'} layer`); msg(ch.size ? `Reverted ${ch.size} block${ch.size === 1 ? '' : 's'}.` : 'Nothing to revert in this layer.'); return;
    }
    const L = sec.layers[st.layer], ch = new Map();
    for (const s of L.map.screens) for (let i = 0; i < L.map.rows * 8; i++) {
      const off = s + 2 * i; if (!edited(off) || ch.has(off)) continue;
      const before = word(off), after = (orig[off] << 8) | orig[off + 1]; ch.set(off, { before, after }); setWord(off, after);
    }
    commit(ch, `revert ${L.name.toLowerCase()} layer`); msg(ch.size ? `Reverted ${ch.size} block${ch.size === 1 ? '' : 's'}.` : 'Nothing to revert in this layer.');
  };
  $('reset').onclick = () => {
    const n = Object.keys(bytes).length, en = Object.keys(enemyEdits).length, cn = Object.keys(stages).length; if (!n && !en && !cn) { msg('There are no edits.'); return; }
    if (!confirm(`Clear every stage edit (${n} changed bytes, ${en} enemy stages, ${cn} custom stages)? This cannot be undone.`)) return;
    work.set(orig); bytes = {}; enemyEdits = {}; stages = {}; st.custom = null; undo = []; redo = []; saveNow(); scanMetaMax(); loadSection(); msg('All edits cleared.');
  };
  $('exp').onclick = () => {
    saveNow();
    const blob = new Blob([JSON.stringify({ format: 'simpsons-stage-edits', v: 1, bytes, enemies: enemyEdits, stages }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'simpsons-stage-edits.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('imp').onclick = () => $('impf').click();
  $('impf').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); if (j && j.bytes) { SIMPTILES.migrate(j, orig); SIMPCUSTOM.migrate(j); } if (!j || j.format !== 'simpsons-stage-edits' || j.v !== 1 || !j.bytes || typeof j.bytes !== 'object' || Array.isArray(j.bytes)) throw new Error('not a supported stage edits file');
      const r = S.applyPatch(orig, j.bytes);
      if (r.n !== Object.keys(j.bytes).length) throw new Error('invalid ROM offsets or byte values');
      const importedEnemies = E.validate(j.enemies || {}), importedStages = SIMPCUSTOM.validate(j.stages || {});
      work.set(r.prog); bytes = S.diff(orig, work); enemyEdits = importedEnemies; stages = importedStages; if (!custom()) st.custom = null; undo = []; redo = [];
      saveNow(); scanMetaMax(); loadSection(); msg(`Imported ${r.n} bytes.`);
    } catch (err) { msg('Import failed: ' + err.message); }
  };
  $('play').onclick = () => { saveNpcDetails(); saveNow(); window.open(custom() ? 'index.html?custom=' + st.custom + '&play=1' : 'index.html?scene=' + S.SCENES[st.scene].scene + '&play=1', '_blank'); };
  addEventListener('keydown', e => {
    if (!sec) return;
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? $('redo').click() : $('undo').click(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); $('redo').click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (mode === 'events' && (k === 'delete' || k === 'backspace')) { e.preventDefault(); deleteEvent(); return; }
    if (mode !== 'blocks' && (k === 'delete' || k === 'backspace')) { e.preventDefault(); deleteEnemy(); return; }
    if (k === '1') setLayer(0); else if (k === '2') setLayer(1);
    else if (k === 'g') toggle('grid'); else if (k === 'o') toggle('other'); else if (k === 'e') toggle('edits'); else if (k === 'z') zoom();
    else if (k === '[' || k === ']') { const n = nBlk[st.layer]; st.sel = (st.sel + (k === ']' ? 1 : n - 1)) % n; drawPicker(); drawSel(); }
  });
  addEventListener('beforeunload', () => { if (saveT) saveNow(); });

  // ---------- start
  const controls = [...document.querySelectorAll('#bar button, #bar select')];
  controls.forEach(c => { c.disabled = true; });
  (async () => {
    try {
      const files = await SSRROM.ensure(); romFiles = files;
      orig = files['prog.bin']; await SIMPTILES.ready;
      let doc = {}, migrated = false; try { doc = JSON.parse(localStorage.getItem(S.PATCH_KEY) || '{}') || {}; SIMPTILES.migrate(doc, orig); migrated = !!doc.tilesets && Object.keys(doc.tilesets).length > 0; SIMPCUSTOM.migrate(doc); } catch (e) { doc = {}; }
      bytes = doc.bytes && typeof doc.bytes === 'object' && !Array.isArray(doc.bytes) ? doc.bytes : {}; work = S.applyPatch(orig, bytes).prog; bytes = S.diff(orig, work);
      try { enemyEdits = E.validate(doc.enemies || {}); } catch (e) { enemyEdits = {}; }
      stages = SIMPCUSTOM.validate(doc.stages || {});
      D = S.open(work); tiles = S.decodeTiles(files['gfx_tiles.bin']);
      loadPrefs(); if (!(st.scene >= 0 && st.scene < S.SCENES.length)) st.scene = 0;
      if (st.custom && !stages[st.custom]) st.custom = null;
      if (custom()) st.scene = SIMPCUSTOM.sceneIndex(custom().scene);
      if (migrated) { saveNow(); msg('Your custom level art is now a custom stage; the original stages show their own art again.'); }
      if (!(st.area >= 0 && st.area < D.sectionCount(S.SCENES[st.scene].st))) st.area = 0;
      scanMetaMax(); controls.forEach(c => { c.disabled = false; }); loadSection();
      const n = Object.keys(bytes).length; if (!migrated) msg(n ? `${n} edited bytes loaded from this browser.` : 'Pick a block on the right, then paint on the map, or choose “+ New stage…” to build a new level.');
    } catch (e) { console.error(e); msg('Could not start: ' + e.message); }
  })();
})();
