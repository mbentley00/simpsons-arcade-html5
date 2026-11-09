'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const E = require('../web/stage/enemies.js');
const ctx = { window: {} };
for (const file of fs.readdirSync(require('path').join(__dirname, '../web/custom'))) {
  if (!/^(duffman|rivet|slugger|moleman|conehead_carl|budget_knight)\.js$/.test(file)) continue;
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/custom/' + file), 'utf8'), ctx);
}
for (const asset of Object.values(ctx.window.SIMPENEMY_ASSETS)) {
  assert.equal(asset.facing, 'left', asset.name + ' source sheet faces left');
  assert.equal(E.facingFlip(asset, 0x50), false, asset.name + ' faces left without mirroring');
  assert.equal(E.facingFlip(asset, 0x10), true, asset.name + ' mirrors to face right');
}
assert.equal(E.facingFlip({ facing: 'right' }, 0x50), true);
assert.equal(E.facingFlip({ facing: 'right' }, 0x10), false);
console.log('OK: all six custom sheets follow native facing in both directions; right-facing artwork also supported');
