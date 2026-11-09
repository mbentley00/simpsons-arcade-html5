// Custom stages: new stages made in the editor that leave the original stages untouched. A custom stage borrows an
// original stage's ground (its ROM maps, so its collision and section scripts) and has its own level art, enemy list
// and scripted events. It is played with index.html?custom=<id>&play=1; without ?custom the game is the original.
// Saved in the editor document (SIMPSTAGE.PATCH_KEY) as
//   stages: { "<id>": { name, scene, tileset: {id, maps} | null, enemies: [spawn rows] | null, events: [{type, x}] } }
// Older documents kept custom art as an override of an original stage ("tilesets": {scene: {id, maps}}); migrate()
// turns each of those into a custom stage.
(function (G) {
  'use strict';
  const MAX = 16;
  const sceneIndex = scene => G.SIMPSTAGE ? SIMPSTAGE.SCENES.findIndex(s => s.scene === scene) : -1;
  const enemyStage = scene => { const i = sceneIndex(scene); return i < 0 || !G.SIMPENEMY ? -1 : SIMPENEMY.STAGES[i]; };
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'stage';
  function newId(stages, name) { const base = slug(name); let id = base, n = 2; while (stages[id]) id = base + '-' + n++; return id; }
  const artEvents = art => art && G.SIMPEVENTS ? SIMPEVENTS.defaults(art) : [];
  function make(name, scene, art) {
    const set = art && G.SIMPTILES ? SIMPTILES.sets[art] : null;
    return { name: String(name || (set ? set.name : 'New stage')).trim().slice(0, 40) || 'New stage', scene, tileset: set ? { id: art, maps: SIMPTILES.defaults(set) } : null, enemies: null, events: artEvents(set && art) };
  }
  // Starting points offered by the editor: every custom art set, plus a plain copy of each combat stage.
  function templates() {
    const out = [];
    if (G.SIMPTILES) for (const set of Object.values(SIMPTILES.sets)) out.push({ art: set.id, scene: set.scene, label: `${set.name} (plays like ${SIMPSTAGE.SCENES[sceneIndex(set.scene)].name})` });
    for (const sc of SIMPSTAGE.SCENES) if (enemyStage(sc.scene) >= 0) out.push({ art: null, scene: sc.scene, label: `Copy of ${sc.name}` });
    return out;
  }
  function validate(value) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [id, s] of Object.entries(value)) {
      if (Object.keys(out).length >= MAX) break;
      if (!/^[a-z0-9-]{1,40}$/.test(id) || !s || typeof s !== 'object') continue;
      const stage = enemyStage(s.scene); if (!Number.isInteger(s.scene) || stage < 0) continue;
      const tv = s.tileset && G.SIMPTILES ? SIMPTILES.validate({ [s.scene]: s.tileset })[s.scene] || null : null;
      let enemies = null;
      if (Array.isArray(s.enemies) && G.SIMPENEMY) try { enemies = SIMPENEMY.validate({ [stage]: s.enemies })[stage] || null; } catch (e) { enemies = null; }
      out[id] = { name: String(s.name || 'Custom stage').trim().slice(0, 40) || 'Custom stage', scene: s.scene, tileset: tv, enemies, events: G.SIMPEVENTS ? SIMPEVENTS.validate(s.events, tv ? tv.id : null) : [] };
    }
    return out;
  }
  function migrate(doc) {
    if (!doc || !doc.tilesets || typeof doc.tilesets !== 'object') return doc;
    const ts = G.SIMPTILES ? SIMPTILES.validate(doc.tilesets) : {};
    if (Object.keys(ts).length) {
      if (!doc.stages || typeof doc.stages !== 'object') doc.stages = {};
      for (const [scene, t] of Object.entries(ts)) { const name = SIMPTILES.sets[t.id].name; doc.stages[newId(doc.stages, name)] = { name, scene: +scene, tileset: t, enemies: null, events: artEvents(t.id) }; }
    }
    delete doc.tilesets; return doc;
  }
  const api = { MAX, make, templates, validate, migrate, newId, enemyStage, sceneIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else G.SIMPCUSTOM = api;
})(typeof window !== 'undefined' ? window : globalThis);
