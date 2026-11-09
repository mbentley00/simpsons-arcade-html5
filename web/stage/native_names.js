// Editor labels for the game's own spawn-stream characters (object id = byte 7 of a spawn record).
// Only ids confirmed by watching them spawn in play are named; the rest show as "Character 0xNN".
(function (G) {
  G.SIMPNATIVE_NAMES = {
    0x0c: 'Goon (green suit)',
    0x25: 'Goon (purple suit)',
    0x26: 'Dog',
  };
})(typeof window !== 'undefined' ? window : globalThis);
