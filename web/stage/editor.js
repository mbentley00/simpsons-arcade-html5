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
  const st = { scene: 0, area: 0, layer: 1, other: true, grid: true, edits: true, zoom: 2, sel: 0 };
  let orig, work, D, tiles, bytes = {}, sec, ram, atlas = [null, null], nBlk = [0, 0], cellIx = new Map(), metaMax = new Map();
  let undo = [], redo = [], stroke = null, saveT = 0;
  // custom level art (web/stage/tileset.js): tilesets = { scene: { id, maps: [back, front] } }. In a tiled section the
  // picker lists the custom blocks and painting edits the custom maps; the stage's ROM maps (and collision) stay as they are.
  let tilesets = {}, tset = null, tmaps = null, native = [null, null];
  const tileKey = (l, i) => 't' + l + ':' + i;
  const map = $('map'), ctx = map.getContext('2d'), pick = $('pick'), pctx = pick.getContext('2d'), selc = $('selc'), sctx = selc.getContext('2d');
  const hex = (n, w) => '0x' + n.toString(16).padStart(w, '0');
  const msg = t => { $('msg').textContent = t || ''; };

  // ---------- persistence
  function loadBytes() { try { const j = JSON.parse(localStorage.getItem(S.PATCH_KEY) || 'null'); return j && j.bytes && typeof j.bytes === 'object' ? j.bytes : {}; } catch (e) { return {}; } }
  function saveNow() {
    clearTimeout(saveT); saveT = 0;
    try { const n = Object.keys(bytes).length + Object.keys(enemyEdits).length + Object.keys(tilesets).length; if (n) localStorage.setItem(S.PATCH_KEY, JSON.stringify({ v: 1, bytes, enemies: enemyEdits, tilesets })); else localStorage.removeItem(S.PATCH_KEY); }
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
      if (p.layer === 0 || p.layer === 1) st.layer = p.layer;
      if (p.zoom === 1 || p.zoom === 2) st.zoom = p.zoom;
      for (const k of ['other', 'grid', 'edits']) if (typeof p[k] === 'boolean') st[k] = p[k];
    } catch (e) { /* defaults */ }
  }
  function touch(off) { for (const i of [off, off + 1]) { if (work[i] === orig[i]) delete bytes[i]; else bytes[i] = work[i]; } saveSoon(); }
  function countEdits() { $('exp').disabled = !Object.keys(bytes).length && !Object.keys(enemyEdits).length && !Object.keys(tilesets).length; }

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
    const tv = tilesets[sc.scene], ts = tv && SIMPTILES.sets[tv.id];
    tset = ts && ts.area === st.area ? ts : null; tmaps = tset ? tv.maps : null;
    enemyRows = enemyStage() < 0 ? [] : clone(enemyEdits[enemyStage()] || E.read(orig, enemyStage())); enemySelected = -1;
    if (!sec.layers[st.layer]) st.layer = sec.layers[0] ? 0 : 1;
    buildAtlas(0); buildAtlas(1);
    cellIx = new Map();
    for (const L of sec.layers) if (L) for (let x = 0; x < L.map.screens.length * 8; x++) for (let y = 0; y < L.map.rows; y++) {
      const off = D.cellOff(L, x, y); (cellIx.get(off) || cellIx.set(off, []).get(off)).push([L.layer, x, y]);
    }
    const Ls = sec.layers.filter(Boolean);
    map.width = Math.max(...Ls.map(L => L.map.screens.length)) * 256; map.height = Math.max(...Ls.map(L => L.map.rows)) * CELL;
    if (st.sel >= nBlk[st.layer]) st.sel = 0;
    if (enemyStage() < 0 && mode !== 'blocks') setMode('blocks');
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
  function drawAll() { ctx.clearRect(0, 0, map.width, map.height); for (let x = 0; x < map.width / CELL; x++) for (let y = 0; y < map.height / CELL; y++) drawCell(x, y); if (mode !== 'blocks') drawEnemies(); }
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
    $('scene').value = st.scene; fillAreas(); fillTilesets();
    for (const l of [0, 1]) { $('l' + l).classList.toggle('on', st.layer === l); $('l' + l).disabled = !sec.layers[l]; }
    $('vOther').classList.toggle('on', st.other); $('vGrid').classList.toggle('on', st.grid); $('vEdits').classList.toggle('on', st.edits); $('vZoom').classList.toggle('on', st.zoom === 2);
    $('undo').disabled = !undo.length; $('redo').disabled = !redo.length; countEdits();
    $('toolEnemies').disabled = enemyStage() < 0;
    $('toolNpcs').disabled = enemyStage() < 0;
    $('toolEnemies').title = enemyStage() < 0 ? 'Enemy placement is available in combat stages' : 'Place and move enemies';
  }
  function fillTilesets() {
    const sel = $('tileset'), sc = S.SCENES[st.scene], set = SIMPTILES.forScene(sc.scene);
    sel.length = 1; if (set) { const o = document.createElement('option'); o.value = set.id; o.textContent = set.name; sel.appendChild(o); }
    sel.disabled = !set; sel.value = tilesets[sc.scene] ? tilesets[sc.scene].id : '';
    sel.title = set ? `Replace ${sc.name} with the ${set.name} level (new background art; the original collision and enemies stay)` : 'No custom level art for this stage yet';
    [...$('scene').options].forEach((o, i) => { const s2 = S.SCENES[i], tv = tilesets[s2.scene]; o.textContent = tv ? `${SIMPTILES.sets[tv.id].name} (${s2.name} slot)` : s2.name; });
  }
  function setTileset(id) {
    const sc = S.SCENES[st.scene], set = SIMPTILES.forScene(sc.scene); if (!set || (tilesets[sc.scene] ? tilesets[sc.scene].id : '') === id) return;
    if (id) {
      tilesets[sc.scene] = { id, maps: SIMPTILES.defaults(set) }; msg(`${set.name} replaces ${sc.name}. Paint with its blocks, then press Play. Walkable ground and collision stay ${sc.name}'s.`);
    } else {
      if (!confirm(`Remove ${set.name} and show the original ${sc.name} again? Painting done in ${set.name} is lost.`)) { fillTilesets(); return; }
      delete tilesets[sc.scene]; msg(`Restored the original ${sc.name}.`);
    }
    undo = []; redo = []; st.area = set.area; st.sel = 0; saveNow(); loadSection();
  }
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
    const [l, i] = key.slice(1).split(':').map(Number), sc = S.SCENES[st.scene], tv = tilesets[sc.scene]; if (!tv) return;
    tv.maps[l][i] = id; saveSoon();
    if (tset && tv.maps === tmaps) drawCell(i % tset.cols, Math.floor(i / tset.cols));
  }
  function step(from, to, key) {
    const s = from.pop(); if (!s) return;
    if (s.enemyStage !== undefined) {
      enemyEdits[s.enemyStage] = clone(s[key]);
      if (JSON.stringify(enemyEdits[s.enemyStage]) === JSON.stringify(E.read(orig, s.enemyStage))) delete enemyEdits[s.enemyStage];
      if (s.enemyStage === enemyStage()) { enemyRows = clone(s[key]); enemySelected = -1; syncEnemies(); drawAll(); }
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
    if (mode !== 'blocks') { enemyDown(e); return; }
    const { x, y } = cellAt(e);
    if (e.button === 2 || e.altKey) { pickAt(x, y); return; }
    if (e.button !== 0) return;
    map.setPointerCapture(e.pointerId); stroke = new Map(); paint(x, y);
  });
  map.addEventListener('pointermove', e => {
    if (!sec) return;
    if (mode !== 'blocks') {
      const p = enemyPoint(e); $('hover').textContent = `Enemy placement: X ${p.x}, Y ${p.y}`;
      if (enemyDrag) { E.move(enemyRows[enemySelected], p.x, p.y); syncEnemies(); drawAll(); } return;
    }
    hover(e); if (stroke) { const { x, y } = cellAt(e); paint(x, y); }
  });
  const end = () => {
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
  function showEnemyPreview() {
    const asset = assets[$('enemyKind').value], c = enemyPreview.getContext('2d'); c.clearRect(0, 0, enemyPreview.width, enemyPreview.height);
    enemyPreview.hidden = !asset;
    if (asset) { enemyPreview.setAttribute('aria-label', asset.name + ' enemy preview'); c.drawImage(thumbnails[asset.id], 0, 0); }
  }
  $('enemyKind').onchange = showEnemyPreview; showEnemyPreview();
  const enemyName = row => row.role === 'npc' ? (row.npcName || assets[row.skin]?.name) : assets[row.skin]?.name || E.label(row);
  function drawEnemies() {
    ctx.imageSmoothingEnabled = false;
    enemyRows.forEach((row, i) => {
      if (!visibleEntity(row)) return;
      const { x, y } = E.position(row), selected = i === enemySelected;
      const asset = assets[row.skin], size = asset ? E.display(asset) : { width:32, height:56, anchor:[16,52] };
      if (asset) ctx.drawImage(thumbnails[row.skin], x - size.anchor[0], y - size.anchor[1], size.width, size.height);
      const k = E.kind(row), color = row.role === 'npc' ? '#7ad0ff' : k === 'character' ? '#8ef08e' : k === 'script' ? '#9a9a9a' : '#ff5d8f';
      ctx.strokeStyle = selected ? '#fff' : color; ctx.fillStyle = selected ? '#ffc861' : color; ctx.lineWidth = 2;
      if (k === 'script') ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.ellipse(x, y, 12, 5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (!asset && k !== 'script') { ctx.globalAlpha = .55; ctx.fillStyle = color; ctx.fillRect(x - 10, y - 46, 20, 44); ctx.globalAlpha = 1; }
      ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillRect(x - 32, y + 8, 90, 14);
      ctx.fillStyle = selected ? '#ffc861' : '#fff'; ctx.font = '10px system-ui'; ctx.fillText(enemyName(row), x - 29, y + 19);
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
    for (const id of ['enemyX', 'enemyY', 'enemyMove', 'enemyDelete']) $(id).disabled = !selected || !E.movable(row);
    $('enemyInfo').textContent = !selected ? '' : E.kind(row) === 'script' ? 'Stage script or trigger (scroll lock, wave or event). Shown for reference; it cannot be moved.' : E.kind(row) === 'character' ? `The stage's own ${E.label(row)} (native art and behaviour). Drag to move it; it appears when the camera reaches its X.` : '';
    $('enemyX').value = selected ? E.position(row).x : ''; $('enemyY').value = selected ? E.position(row).y : '';
    $('npcFields').hidden = mode !== 'npcs';
    for (const id of ['npcName','npcDialogue','npcApply']) $(id).disabled = !selected;
    $('npcName').value = selected && row.role === 'npc' ? row.npcName || '' : '';
    $('npcDialogue').value = selected && row.role === 'npc' ? row.dialogue || '' : '';
  }
  function commitEnemies(before, label) {
    if (JSON.stringify(before) === JSON.stringify(enemyRows)) return;
    const stage = enemyStage(); enemyEdits[stage] = clone(enemyRows);
    if (JSON.stringify(enemyRows) === JSON.stringify(E.read(orig, stage))) delete enemyEdits[stage];
    undo.push({ enemyStage: stage, before, after: clone(enemyRows), label }); if (undo.length > 500) undo.shift(); redo = [];
    saveSoon(); syncUi(); syncEnemies(); drawAll(); msg(label + '. Saved for this stage.');
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
    const before = clone(enemyRows); enemyRows.push(E.make($('enemyKind').value, p.x, p.y, mode === 'npcs' ? 'npc' : undefined)); enemySelected = enemyRows.length - 1;
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
  function setMode(value) {
    saveNpcDetails(); end(); mode = value; enemySelected=-1;
    $('toolBlocks').classList.toggle('on', mode === 'blocks'); $('toolEnemies').classList.toggle('on', mode === 'enemies'); $('toolNpcs').classList.toggle('on',mode==='npcs');
    const native=$('enemyKind').querySelector('option[value="grunt"]'); native.disabled=mode==='npcs'; if(mode==='npcs'&&$('enemyKind').value==='grunt')$('enemyKind').value='rivet'; showEnemyPreview();
    for (const el of [$('sel'), $('pickwrap'), document.querySelector('#side h2')]) el.style.display = mode !== 'blocks' ? 'none' : '';
    $('enemyPanel').hidden = mode === 'blocks'; drawAll(); syncEnemies();
    $('entityHint').textContent=mode==='npcs'?'NPCs are friendly, cannot be attacked, and never count toward wave completion. Press E nearby to talk.':'Custom enemies use the standard enemy’s AI, attacks and collisions.';
    msg(mode === 'npcs' ? 'Click empty map space to add a friendly NPC. Select it to edit its name and dialogue.' : mode==='enemies'?'Click empty map space to add an enemy. Drag a marker to move it.':'Pick a block, then paint on the map.');
  }
  $('toolBlocks').onclick = () => setMode('blocks'); $('toolEnemies').onclick = () => setMode('enemies');
  $('toolNpcs').onclick = () => setMode('npcs');
  $('showScripts').onchange = () => { enemySelected = -1; syncEnemies(); drawAll(); };

  // ---------- toolbar
  function setLayer(l) { if (!sec.layers[l] || l === st.layer) return; st.layer = l; if (st.sel >= nBlk[l]) st.sel = 0; drawAll(); drawPicker(); drawSel(); syncUi(); savePrefs(); }
  const toggle = k => { st[k] = !st[k]; drawAll(); syncUi(); savePrefs(); };
  function zoom() { st.zoom = st.zoom === 2 ? 1 : 2; applyZoom(); syncUi(); savePrefs(); }
  $('scene').onchange = e => { st.scene = +e.target.value; st.area = 0; loadSection(); };
  $('area').onchange = e => { st.area = +e.target.value; loadSection(); };
  $('l0').onclick = () => setLayer(0); $('l1').onclick = () => setLayer(1);
  $('vOther').onclick = () => toggle('other'); $('vGrid').onclick = () => toggle('grid'); $('vEdits').onclick = () => toggle('edits'); $('vZoom').onclick = zoom;
  $('undo').onclick = () => step(undo, redo, 'before'); $('redo').onclick = () => step(redo, undo, 'after');
  $('revert').onclick = () => {
    const L = sec.layers[st.layer], ch = new Map();
    for (const s of L.map.screens) for (let i = 0; i < L.map.rows * 8; i++) {
      const off = s + 2 * i; if (!edited(off) || ch.has(off)) continue;
      const before = word(off), after = (orig[off] << 8) | orig[off + 1]; ch.set(off, { before, after }); setWord(off, after);
    }
    commit(ch, `revert ${L.name.toLowerCase()} layer`); msg(ch.size ? `Reverted ${ch.size} block${ch.size === 1 ? '' : 's'}.` : 'Nothing to revert in this layer.');
  };
  $('reset').onclick = () => {
    const n = Object.keys(bytes).length, en = Object.keys(enemyEdits).length; if (!n && !en && !Object.keys(tilesets).length) { msg('There are no edits.'); return; }
    if (!confirm(`Clear every stage edit (${n} changed bytes, ${en} enemy stages)? This cannot be undone.`)) return;
    work.set(orig); bytes = {}; enemyEdits = {}; tilesets = {}; undo = []; redo = []; saveNow(); scanMetaMax(); loadSection(); msg('All edits cleared.');
  };
  $('exp').onclick = () => {
    saveNow();
    const blob = new Blob([JSON.stringify({ format: 'simpsons-stage-edits', v: 1, bytes, enemies: enemyEdits, tilesets }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'simpsons-stage-edits.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('imp').onclick = () => $('impf').click();
  $('impf').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); if (j && j.bytes) SIMPTILES.migrate(j, orig); if (!j || j.format !== 'simpsons-stage-edits' || j.v !== 1 || !j.bytes || typeof j.bytes !== 'object' || Array.isArray(j.bytes)) throw new Error('not a supported stage edits file');
      const r = S.applyPatch(orig, j.bytes);
      if (r.n !== Object.keys(j.bytes).length) throw new Error('invalid ROM offsets or byte values');
      const importedEnemies = E.validate(j.enemies || {}), importedTilesets = SIMPTILES.validate(j.tilesets || {});
      work.set(r.prog); bytes = S.diff(orig, work); enemyEdits = importedEnemies; tilesets = importedTilesets; undo = []; redo = [];
      saveNow(); scanMetaMax(); loadSection(); msg(`Imported ${r.n} bytes.`);
    } catch (err) { msg('Import failed: ' + err.message); }
  };
  $('play').onclick = () => { saveNpcDetails(); saveNow(); window.open('index.html?scene=' + S.SCENES[st.scene].scene + '&play=1', '_blank'); };
  addEventListener('keydown', e => {
    if (!sec) return;
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? $('redo').click() : $('undo').click(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); $('redo').click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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
      const files = await SSRROM.ensure();
      orig = files['prog.bin']; await SIMPTILES.ready;
      let doc = {}; try { doc = JSON.parse(localStorage.getItem(S.PATCH_KEY) || '{}') || {}; SIMPTILES.migrate(doc, orig); } catch (e) { doc = {}; }
      bytes = doc.bytes && typeof doc.bytes === 'object' && !Array.isArray(doc.bytes) ? doc.bytes : {}; work = S.applyPatch(orig, bytes).prog; bytes = S.diff(orig, work);
      try { enemyEdits = E.validate(doc.enemies || {}); tilesets = SIMPTILES.validate(doc.tilesets || {}); } catch (e) { enemyEdits = {}; tilesets = {}; }
      D = S.open(work); tiles = S.decodeTiles(files['gfx_tiles.bin']);
      const sel = $('scene'); S.SCENES.forEach((sc, i) => { const o = document.createElement('option'); o.value = i; o.textContent = sc.name; sel.appendChild(o); });
      loadPrefs(); if (!(st.scene >= 0 && st.scene < S.SCENES.length)) st.scene = 0;
      if (!(st.area >= 0 && st.area < D.sectionCount(S.SCENES[st.scene].st))) st.area = 0;
      scanMetaMax(); controls.forEach(c => { c.disabled = false; }); loadSection();
      const n = Object.keys(bytes).length; msg(n ? `${n} edited bytes loaded from this browser.` : 'Pick a block on the right, then paint on the map.');
    } catch (e) { console.error(e); msg('Could not start: ' + e.message); }
  })();
})();
