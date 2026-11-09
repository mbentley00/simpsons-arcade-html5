// Real-ROM spawn/render regression. node test/enemy_check.js (requires local simpsons.zip and unzip on PATH).
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const E = require('../web/stage/enemies.js'), { Board } = require('../web/sim/simpsons.js'), { Video } = require('../web/sim/video.js');
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(require.resolve('../web/custom/duffman.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(require.resolve('../web/custom/rivet.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(require.resolve('../web/custom/slugger.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(require.resolve('../web/custom/moleman.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(require.resolve('../web/custom/comic_book_guy.js'), 'utf8'), ctx);
// custom palettes are given 16-pen slots from 4096 in sorted asset-id order (enemies.js install)
const inSlot = (p, id) => { const b = 4096 + Object.keys(ctx.window.SIMPENEMY_ASSETS).sort().indexOf(id) * 16; return p >= b && p < b + 16; };
const asset = ctx.window.SIMPDUFFMAN, pixels = E.decode(asset);
assert.equal(pixels.length, 16 * 64 * 96); assert(Math.max(...pixels.subarray(0, 6144)) < 16);
assert.equal(asset.palette.length, 32); assert(pixels.some(p => p === 0)); assert(pixels.some(p => p > 0));
const rivet = ctx.window.SIMPRIVET, rivetPixels = E.decode(rivet);
assert.equal(rivetPixels.length,16*64*96); assert(rivetPixels.every(p=>p<16));
assert.equal(rivet.palette.length,32); assert.deepEqual(E.display(rivet),{width:48,height:72,anchor:[24,68]});
const moleman=ctx.window.SIMPMOLEMAN,molePixels=E.decode(moleman);assert.equal(molePixels.length,16*64*96);assert.equal(moleman.palette.length,32);assert.equal(moleman.name,'Hans Moleman');
for(let f=0;f<16;f++){let n=0;for(let y=0;y<96;y++){assert.equal(molePixels[f*6144+y*64],0,'Moleman frame '+f+' must not touch the left edge');assert.equal(molePixels[f*6144+y*64+63],0,'Moleman frame '+f+' must not touch the right edge');for(let x=0;x<64;x++)if(molePixels[f*6144+y*64+x])n++;}assert(n>500,'Moleman frame '+f+' must be a full pose');}
const cbg=ctx.window.SIMPCOMIC_BOOK_GUY,cbgPixels=E.decode(cbg);assert.equal(cbg.name,'Comic Book Guy');assert.equal(cbgPixels.length,16*64*96);assert.equal(cbg.palette.length,32);
for(let f=0;f<16;f++){let n=0;for(let y=0;y<96;y++){assert.equal(cbgPixels[f*6144+y*64],0,'Comic Book Guy frame '+f+' must not touch the left edge');assert.equal(cbgPixels[f*6144+y*64+63],0,'Comic Book Guy frame '+f+' must not touch the right edge');for(let x=0;x<64;x++)if(cbgPixels[f*6144+y*64+x])n++;}assert(n>700,'Comic Book Guy frame '+f+' must be a full pose');}
const slugger=ctx.window.SIMPSLUGGER;assert.equal(E.decode(slugger).length,16*64*96);assert.equal(slugger.palette.length,32);
assert.equal(E.pose(asset,'fall',0),14);assert.equal(E.pose(asset,'fall',8),15);assert.equal(E.pose(asset,'fall',800),15,'a fallen enemy must not loop back to the airborne pose');
for(let f=12;f<16;f++)for(let y=0;y<96;y++){assert.equal(pixels[f*6144+y*64],0,'repaired pose must not bleed across the left cell edge');assert.equal(pixels[f*6144+y*64+63],0,'repaired pose must not include pixels from its neighbor');}
assert.throws(() => E.validate({ 12: [] }));
assert.throws(() => E.validate({ 0: [{ data: [0, 0, 24, 0, 0, 1, 0, -1] }] }));
assert.throws(() => E.validate({ 0: [{ data: [0, 0, 24, 0, 0, 1, 0, 0], skin: 'unknown' }] }));
const files = require('./roms.js')(), original = files['prog.bin'].slice();
for (let stage = 0; stage < 12; stage++) assert(E.read(original, stage).length <= 255);
const b = new Board(files), v = new Video(b), rows = E.read(original, 0);
rows.push(E.make('duffman', 200, 192), E.make('rivet', 260, 216),E.make('slugger',300,160),E.make('moleman',340,200));
E.install(b, v, { 0: rows }, ctx.window.SIMPENEMY_ASSETS);
const events = fs.readFileSync(require.resolve('./input/coin_start_walk.txt'), 'utf8').split('\n').map(l => /^\s*(\d+)\s+([A-Z]+\d?)\s+([0-9a-f]+)/i.exec(l)).filter(Boolean);
b.onFrame = () => { for (const e of events) if (+e[1] + 1 === b.frame) b.inputs[e[2]] = 255 & ~parseInt(e[3], 16); };
while (b.frame < 2480) b.runFrames(1);
assert.equal(b.ram[0x803], 2); assert.equal(b.ram[0x875], 0x82);
assert.deepEqual(b.prog, original, 'virtual spawn tables must not alter the ROM or its checksum');
v.render(); const customPixels = v.bmp.filter(p => p >= 4096).length;
for (const record of Object.values(b.stageEnemyRecords)) {
  const artwork = ctx.window.SIMPENEMY_ASSETS[record.skin];
  assert.equal(record.flip, E.facingFlip(artwork, b.ram[record.actor + 9]), 'DMA must use artwork-relative facing');
}
assert(customPixels > 200, 'custom enemies must be visible in the native priority compositor');
assert(v.bmp.filter(p=>inSlot(p,'duffman')).length>20,'Duffman retains his own palette');
assert(v.bmp.filter(p=>inSlot(p,'rivet')).length>20,'Rivet renders alongside Duffman with his own palette');
assert(v.bmp.filter(p=>inSlot(p,'slugger')).length>20,'Slugger renders as a native enemy with his own palette');
{const mb=new Board(files),mv=new Video(mb);E.install(mb,mv,{0:rows},ctx.window.SIMPENEMY_ASSETS);mb.load(b.save());const k=Object.keys(mb.stageEnemySkins).find(k=>mb.stageEnemySkins[k].id==='duffman');mb.stageEnemySkins[k].id='moleman';mb.runFrames(1);mv.render();assert(mv.bmp.filter(p=>inSlot(p,'moleman')).length>200,'Hans Moleman renders with his own palette');assert.equal(mv.bmp.filter(p=>inSlot(p,'duffman')).length,0);}
{const mb=new Board(files),mv=new Video(mb);E.install(mb,mv,{0:rows},ctx.window.SIMPENEMY_ASSETS);mb.load(b.save());const k=Object.keys(mb.stageEnemySkins).find(k=>mb.stageEnemySkins[k].id==='duffman');mb.stageEnemySkins[k].id='comic_book_guy';mb.runFrames(1);mv.render();
 const used=mv.bmp.filter(p=>inSlot(p,'comic_book_guy')&&(p&15)===4);assert(used.length>100,'Comic Book Guy renders with his T-shirt colour ('+used.length+' px)');
 assert.equal(mv.bmp.filter(p=>inSlot(p,'duffman')).length,0,'Duffman is gone from that record');}
assert(v.toRGB().some(p => p !== 0));
const restored = new Board(files), restoredVideo = new Video(restored);
E.install(restored,restoredVideo,{0:rows},ctx.window.SIMPENEMY_ASSETS); restored.load(b.save()); restoredVideo.render();
assert.deepEqual(restoredVideo.toRGB(),v.toRGB(),'both skins and palettes survive fresh-board save/load');
const npc=E.make('slugger',160,192,'npc');npc.npcName='Coach';npc.dialogue='Keep moving!';
const friendly=new Board(files),friendlyVideo=new Video(friendly);E.install(friendly,friendlyVideo,{0:[...E.read(original,0),npc]},ctx.window.SIMPENEMY_ASSETS);friendly.load(b.save());
// The fixture's loaded state predates the NPC edit, so restore its authored NPC collection explicitly.
friendly.stageNPCs={0:[npc]};friendlyVideo.render();
assert.equal(E.npcPositions(friendly)[0].name,'Coach');
assert(friendlyVideo.bmp.some(p=>inSlot(p,'slugger')),'friendly mascot must render with his palette');
const np=new Board(files);E.install(np,null,{0:[...E.read(original,0),npc]});np.ram[0x802]=1;np.ram[0x867]=0;np.bank=0x1b;
assert.equal(np.mr(0x7800+E.read(original,0).length*8),255,'NPCs never enter the native enemy spawn stream');
// Original records retain byte-for-byte order, including a deliberately non-monotonic stage table.
const testBoard = new Board(files), table = E.read(original, 9), added = E.make('duffman', 100, 192);
E.install(testBoard, null, { 9: [...table, added] }); testBoard.bank = 0x1b; testBoard.ram[0x867] = 9; testBoard.ram[0x802] = 1;
const stream = [];
for (let i = 0; i <= table.length; i++) stream.push(Array.from({length: 8}, (_, k) => testBoard.mr(0x7800 + i * 8 + k)));
const at = stream.findIndex(r => r.every((n, i) => n === added.data[i])); assert(at >= 0); stream.splice(at, 1);
assert.deepEqual(stream, table.map(r => r.data));
console.log(`OK: 12 spawn tables, two 4bpp atlases/palettes, save/load, validation, ROM/script order, and ${customPixels} visible custom pixels`);
