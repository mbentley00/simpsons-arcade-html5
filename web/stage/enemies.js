// Spawn records in bank 1B: X word, depth/8, height, allocation flags, variant, player gate, enemy/script ID.
// Custom art is presentation-only; custom characters use the original basic enemy's combat behavior.
(function (G) {
  'use strict';
  // SCENES order from stagedata.js -> combat stream. Scenes 5/10/14 lead through intro states to 6/11/15.
  // Scene-to-stream mapping is read by the ROM at BA87 from E88D. Bonus rounds and ending do not use combat streams.
  const STAGES = [0, -1, 1, 3, 4, 5, 6, 8, -1, 9, 11, -1], BASE = 0x36000;
  const SKINS = ['duffman', 'rivet', 'slugger', 'moleman', 'conehead_carl', 'budget_knight', 'comic_book_guy', 'fat_tony', 'rich_texan', 'burns', 'moe', 'wiseguy', 'mob_boss', 'jasper', 'hoodie_girl', 'nanny', 'cat_lady', 'princess', 'jacket_artist', 'purple_suit', 'accordion_guy', 'blonde_woman', 'glasses_woman'];
  const signed = n => (n << 24) >> 24;
  const enemy = row => (row.data[4] & 12) === 0 && row.data[7] <= 4;
  // Every record in the stream, for the editor: basic enemies, the stage's own characters and props (native objects
  // with their own AI/art), and scripts/triggers (scroll locks, waves, events) that should not be moved.
  const kind = row => (row.data[4] & 12) === 12 || row.data[7] >= 0xe0 ? 'script' : enemy(row) ? 'enemy' : 'character';
  const movable = row => kind(row) !== 'script';
  // Names seen in play for native object ids (data[7]); test/native_capture.js regenerates the crops used to name them.
  const NAMES = G.SIMPNATIVE_NAMES || {}, EVENTS = G.SIMPNATIVE_EVENTS || {};
  // Names are keyed "<stage>:<id>" because the same id can be a different object in another stage (0x0c is a door in the
  // street and a goon in the park); a plain "<id>" key applies to every stage.
  const label = (row, stage) => {
    const id = row.data[7], hex = id.toString(16);
    if (kind(row) === 'script') return (row.data[4] & 12) === 12 ? EVENTS.gate || 'Scroll lock' : EVENTS[stage + ':' + id] || EVENTS[id] || `Event 0x${hex}`;
    return NAMES[stage + ':' + id] || NAMES[id] || (enemy(row) ? 'Enemy #' + id : `Character 0x${hex}`);
  };
  function read(prog, stage) {
    if (!Number.isInteger(stage) || stage < 0 || stage >= 12) throw new Error('Invalid enemy stage');
    const word = o => (prog[o] << 8) | prog[o + 1];
    const list = word(0x70000 + 0xefbc + stage * 2), ptr = word(BASE + list - 0x6000), rows = [];
    if (list < 0x6000 || list >= 0x8000 || ptr < 0x6000 || ptr >= 0x8000) throw new Error('Invalid spawn table');
    for (let a = ptr; a + 8 <= 0x8000; a += 8) {
      const o = BASE + a - 0x6000;
      if (prog[o] === 255) return rows;
      rows.push({ data: Array.from(prog.subarray(o, o + 8)) });
    }
    throw new Error('Unterminated spawn table');
  }
  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid enemy edits');
    const out = {};
    for (const [k, rows] of Object.entries(value)) {
      if (!/^(0|[1-9]|10|11)$/.test(k) || !Array.isArray(rows) || rows.length > 255) throw new Error('Invalid enemy stage or too many spawns');
      out[k] = rows.map(row => {
        if (!row || !Array.isArray(row.data) || row.data.length !== 8 || row.data.some(v => !Number.isInteger(v) || v < 0 || v > 255) || row.data[0] === 255) throw new Error('Invalid spawn record');
        if (row.skin !== undefined && (!SKINS.includes(row.skin) || !enemy(row))) throw new Error('Invalid enemy skin');
        if (row.edited !== undefined && typeof row.edited !== 'boolean') throw new Error('Invalid moved spawn'); // scripts too: duplicated events
        if (row.role !== undefined && (row.role !== 'npc' || !row.skin)) throw new Error('NPCs need a custom character');
        for (const [key, limit] of [['npcName',40],['dialogue',200]]) if (row[key] !== undefined && (row.role !== 'npc' || typeof row[key] !== 'string' || row[key].length > limit)) throw new Error('Invalid NPC text');
        return { data: row.data.slice(), ...(row.skin ? { skin: row.skin } : {}), ...(row.edited ? { edited: true } : {}), ...(row.role === 'npc' ? {role:'npc',npcName:(row.npcName||'').trim(),dialogue:(row.dialogue||'').trim()} : {}) };
      });
    }
    return out;
  }
  const position = row => ({ x: (row.data[0] << 8) | row.data[1], y: signed(row.data[2]) * 8 });
  function move(row, x, y) {
    x = Math.max(0, Math.min(0xfeff, Math.round(x))); y = Math.max(0, Math.min(127, Math.round(y / 8)));
    row.data[0] = x >> 8; row.data[1] = x & 255; row.data[2] = y;
    row.edited = true;
  }
  function make(kind, x, y, role) {
    const row = { data: [0, 0, 24, 0, 0, 1, 0, 0] };
    if (SKINS.includes(kind)) row.skin = kind;
    else if (kind !== 'grunt') throw new Error('Unknown enemy type');
    if (role === 'npc') { if(!row.skin) throw new Error('Choose a custom NPC character'); row.role='npc'; row.npcName=G.SIMPENEMY_ASSETS?.[kind]?.name || kind[0].toUpperCase()+kind.slice(1); row.dialogue='Stay sharp out there!'; }
    move(row, x, y); return row;
  }
  function decode(asset) {
    const bytes = typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(asset.tiles, 'base64')) : Uint8Array.from(atob(asset.tiles), c => c.charCodeAt(0));
    if (bytes.length !== asset.frames * asset.tilesPerFrame * 128) throw new Error('Invalid custom sprite tiles');
    const out = new Uint8Array(asset.frames * asset.width * asset.height), xo = [2, 3, 0, 1, 6, 7, 4, 5, 10, 11, 8, 9, 14, 15, 12, 13];
    for (let f = 0; f < asset.frames; f++) for (let ty = 0; ty < asset.height / 16; ty++) for (let tx = 0; tx < asset.width / 16; tx++) {
      const t = f * asset.tilesPerFrame + ty * (asset.width / 16) + tx;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const bp = y * 64 + xo[x] * 4, v = bytes[t * 128 + (bp >> 3)];
        out[f * asset.width * asset.height + (ty * 16 + y) * asset.width + tx * 16 + x] = bp & 4 ? v & 15 : v >> 4;
      }
    }
    return out;
  }
  function display(asset) {
    const scale = asset.displayScale || 1;
    return { width: Math.round(asset.width * scale), height: Math.round(asset.height * scale), anchor: asset.anchor.map(v => Math.round(v * scale)) };
  }
  function pose(asset, anim, elapsed) {
    const frames = asset.animations[anim], tick = Math.max(0, Math.floor(elapsed / 8));
    return frames[(anim === 'fall' || anim === 'hit') ? Math.min(tick, frames.length - 1) : tick % frames.length];
  }
  // Native actor bit 0x40 means facing left, not an artwork-relative flip.
  function facingFlip(asset, flags) {
    return !!(flags & 0x40) !== (asset.facing === 'left');
  }
  function npcPositions(m) {
    if(m.ram[0x800]!==2||m.ram[0x802]!==1||![2,4,6,7,8,9,11,13,15].includes(m.ram[0x803])) return [];
    const rows=m.stageNPCs?.[m.ram[0x867]]||[], r=m.ram;
    const word=o=>((r[o]<<8)|r[o+1])<<16>>16, cameraX=word(0x8ac), cameraY=word(0x8b2);
    return rows.map((row,i)=>({key:m.ram[0x867]+'/'+i,skin:row.skin,name:row.npcName||row.skin,dialogue:row.dialogue,x:position(row).x-cameraX+10,feet:position(row).y-cameraY-26,anim:'idle',elapsed:m.frame}));
  }
  function install(m, video, edits, asset) {
    edits = validate(edits); if (!Object.keys(edits).length) return;
    // Accept a single asset for older callers, or the registry for multiple distinct custom characters.
    const assets = asset?.id ? { [asset.id]: asset } : (asset || {});
    if (video) for (const rows of Object.values(edits)) for (const row of rows) {
      if (row.skin && !assets[row.skin]) throw new Error('Missing enemy artwork: ' + row.skin);
    }
    const tables = {};
    m.stageNPCs = {};
    for (const [stage, rows] of Object.entries(edits)) {
      m.stageNPCs[stage] = rows.filter(r=>r.role==='npc');
      const combatRows = rows.filter(r=>r.role!=='npc');
      // Preserve the exact order of every untouched script/prop/enemy. Only moved or added enemies are inserted by X.
      const sorted = combatRows.filter(r => !r.edited);
      for (const row of combatRows.filter(r => r.edited).sort((a, b) => position(a).x - position(b).x)) {
        const at = sorted.findIndex(r => position(r).x > position(row).x); sorted.splice(at < 0 ? sorted.length : at, 0, row);
      }
      const data = new Uint8Array((sorted.length + 1) * 8); data.fill(255, sorted.length * 8);
      sorted.forEach((r, i) => data.set(r.data, i * 8));
      tables[stage] = { rows: sorted, data, list: (m.prog[0x7efbc + stage * 2] << 8) | m.prog[0x7efbd + stage * 2] };
    }
    const mr = m.mr, mw = m.mw;
    // Plain board data participates in save/load, including cached direct-launch checkpoints.
    m.stageEnemySkins = {}; m.stageEnemyRecords = {};
    m.mr = function (a) {
      const table = tables[this.ram[0x867]];
      // Boot checks read every ROM bank. Expose virtual data only after the main state reaches 1.
      if (this.ram[0x802] === 1 && this.bank === 0x1b && table) {
        if (a === table.list) return 0x78;
        if (a === table.list + 1) return 0;
        if (a >= 0x7800 && a < 0x8000) return table.data[a - 0x7800] ?? 255;
      }
      return mr.call(this, a);
    };
    m.mw = function (a, value) {
      // CA80 completes allocation. X still identifies the eight-byte spawn record here.
      if (a >= 0x4f80 && a < 0x5280 && (a - 0x4f80) % 0x60 === 0 && value === 4 && this.cpu.pc.w === 0xca80) {
        const table = tables[this.ram[0x867]], i = (this.cpu.x.w - 0x7800) / 8;
        delete this.stageEnemySkins[a - 0x4000];
        if (table && Number.isInteger(i) && table.rows[i]?.skin) this.stageEnemySkins[a - 0x4000] = { id: table.rows[i].skin, lastX: null };
      }
      return mw.call(this, a, value);
    };
    if (!video || !Object.keys(assets).length) return;
    const sprites = {}, palettes = [];
    for (const id of Object.keys(assets).sort()) {
      const a = assets[id]; sprites[id] = { asset: a, pixels: decode(a), size: display(a), paletteBase: 4096 + palettes.length * 16 }; palettes.push(a.palette);
    }
    video.customPalettes = palettes; video.pens = new Uint32Array(4096 + palettes.length * 16);
    const dma = m.objectDma;
    m.objectDma = function () {
      const next = {}; let compact = 0;
      for (let i = 0; i < 256; i++) {
        const w = this.spr[i * 8]; if (!(w & 0x8000) || !(w & 255)) continue;
        let actor = -1, skin;
        for (const [key, s] of Object.entries(this.stageEnemySkins)) {
          const o = +key;
          const start = (((this.ram[o + 0x59] << 8) | this.ram[o + 0x5a]) - 0x2000) / 16;
          if (i >= start && i < start + 8) { actor = o; skin = s; break; }
        }
        if (skin && (this.ram[actor] & 0xc0)) {
          const r = this.ram, x = ((r[actor + 12] << 8) | r[actor + 13]) << 16 >> 16;
          const y = (r[actor + 17] << 8) | r[actor + 18];
          const moving = skin.lastX !== null && Math.abs(x - skin.lastX) > 0, jump = r[actor + 23];
          let anim = jump > 8 ? 'fall' : r[actor + 6] >= 4 ? 'hit' : moving ? 'walk' : r[actor + 6] >= 1 ? 'attack' : 'idle';
          if (jump > 8) skin.lastAirFrame = this.frame;
          else if (skin.anim === 'fall' && this.frame - skin.lastAirFrame < 12) anim = 'fall';
          if (skin.anim !== anim) { skin.anim = anim; skin.poseStart = this.frame; }
          next[compact * 8] = { actor, skin: skin.id, x: x - 54, feet: 374 - y - jump, flip: facingFlip(sprites[skin.id].asset, r[actor + 9]), anim, elapsed: this.frame - skin.poseStart };
        }
        compact++;
      }
      for (const [key, skin] of Object.entries(this.stageEnemySkins)) { const actor = +key; skin.lastX = (this.ram[actor + 12] << 8) | this.ram[actor + 13]; }
      this.stageEnemyRecords = next; return dma.call(this);
    };
    const drawn = new Set();
    function drawCustom(v,r,pmask) {
      const sprite = sprites[r.skin]; if (!sprite) return false;
      const { asset, pixels, size, paletteBase } = sprite;
      const frame = pose(asset, r.anim, r.elapsed);
      const ox = r.x - size.anchor[0], oy = r.feet - size.anchor[1] + 16;
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const sx = ox + x, sy = oy + y; if (sx < 0 || sx >= 320 || sy < 16 || sy >= 240) continue;
        const px = Math.floor(x * asset.width / size.width), py = Math.floor(y * asset.height / size.height);
        const pen = pixels[frame * asset.width * asset.height + py * asset.width + (r.flip ? asset.width - 1 - px : px)]; if (!pen) continue;
        const i = sy * 320 + sx, pri = v.pri[i];
        if (((1 << (pri & 31)) & (pmask | (1 << 31))) === 0) v.bmp[i] = paletteBase + pen;
        v.pri[i] = 31;
      }
      return true;
    }
    video.spriteOverride = (v,offs,pmask,first) => {
      if(first) drawn.clear();
      const r=m.stageEnemyRecords[offs]; if(!r) return false;
      if(drawn.has(r.actor)) return true; drawn.add(r.actor);
      return drawCustom(v,r,pmask);
    };
    const after=video.afterSprites;
    video.afterSprites = v => {
      if(after) after(v);
      for(const r of npcPositions(m)) drawCustom(v,r,0xf0);
    };
  }
  const api = { STAGES, enemy, kind, movable, label, NAMES, read, validate, position, move, make, decode, display, pose, facingFlip, npcPositions, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else G.SIMPENEMY = api;
})(typeof window !== 'undefined' ? window : globalThis);
