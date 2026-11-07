// Minimal CommonJS loader for the browser: fetches the sim modules (written for Node's require) and evaluates each in
// a function scope with module/exports/require, so the same files run in Node tests and in the page without a bundler.
//   await SIMCJS.load('sim/', ['simpsons.js', 'video.js'])  -> { 'simpsons.js': exports, ... }
(function (G) {
  'use strict';
  const src = {}, cache = {};
  const norm = (base, p) => (base + p).replace(/\/\.\//g, '/').replace(/^\.\//, '');
  const dir = p => p.slice(0, p.lastIndexOf('/') + 1);
  async function fetchTree(path) {
    if (path in src) return; src[path] = null;
    const r = await fetch(path); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    const t = await r.text(); src[path] = t;
    const deps = [...t.matchAll(/require\(\s*'(\.\/[^']+)'\s*\)/g)].map(m => norm(dir(path), m[1].slice(2)));
    await Promise.all(deps.map(fetchTree));
  }
  function req(path) {
    if (path in cache) return cache[path].exports;
    const module = { exports: {} }; cache[path] = module;
    const fn = new Function('module', 'exports', 'require', src[path] + `\n//# sourceURL=${location.origin}/${path}`);
    fn.call(G, module, module.exports, p => req(norm(dir(path), p.replace(/^\.\//, ''))));
    return module.exports;
  }
  async function load(base, names) {
    await Promise.all(names.map(n => fetchTree(base + n)));
    const out = {}; for (const n of names) out[n] = req(base + n); return out;
  }
  G.SIMCJS = { load };
})(window);
