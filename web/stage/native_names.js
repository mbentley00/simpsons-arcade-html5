// Editor labels for the game's own spawn-stream records (object id = byte 7 of a spawn record).
// Keys are "<stage>:<id>" (the same id can be a different object in another stage) or a plain "<id>" for every stage.
// Only objects identified by watching them in play (tools/capture_native_sprites.js previews) are named; the rest
// show as "Character 0xNN" / "Event 0xNN".
(function (G) {
  G.SIMPNATIVE_NAMES = {
    0x25: 'Goon (purple suit)', 0x0c: 'Goon (green suit)', 0x34: 'Goon (green suit)',
    // Stage 1 - street
    '0:6': 'Tree with birds', '0:8': 'Woman in apron', '0:12': 'Door (orange)', '0:17': 'Street lamp', '0:18': 'Glass doors',
    '0:21': 'Pig', '0:26': 'Fence panel', '0:41': 'Principal Skinner', '0:42': 'Kid in red shirt',
    // Stage 2 - amusement park
    '1:3': 'Dog', '1:38': 'Goon (purple suit)', '1:43': 'Goon (purple suit)', '1:53': 'Balloon lady',
    // Stage 3 - cemetery
    '3:1': 'Skull', '3:17': 'Ghost on a rope', '3:46': 'Goon (purple suit)', '3:59': 'Goon in hat',
    // Stage 4 part 2
    '5:1': 'Goon in hat', '5:29': 'Woman in apron', '5:39': 'Pie', '5:40': 'Woman in pink',
    // Stage 5 - gorge
    '6:18': 'Woman in pink',
    // Stage 7 - TV studio
    '9:1': 'Soda can', '9:56': 'Door (pink)',
  };
  // Script records: events and triggers (flag-12 records are named "gate").
  G.SIMPNATIVE_EVENTS = {
    gate: 'Stage trigger',            // flag-12 records: one controller object at RAM 0x1640; probably wave/scroll control, not decoded
    '0:233': 'Police car arrives',     // 0xe9 at the fire station
    '0:235': 'Goon entrance',          // 0xeb: a goon enters (leaps out of a doorway or walks in)
  };
})(typeof window !== 'undefined' ? window : globalThis);
