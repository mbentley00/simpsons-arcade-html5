// Simpsons video: K052109 tilemaps, K053247 sprites, K053251 mixing (mirrors MAME simpsons screen_update, bitmap_ind16 path)
(function (G) {
  'use strict';
  const W = 320, H = 224, Y0 = 16;
  const SXO = [2, 3, 0, 1, 6, 7, 4, 5, 10, 11, 8, 9, 14, 15, 12, 13];
  const XOFF = [0, 1, 4, 5, 16, 17, 20, 21], YOFF = [0, 2, 8, 10, 32, 34, 40, 42];
  const SH = Math.fround(0.6);

  class Video {
    constructor(board) {
      this.b = board;
      this.tiles = decodeTiles(board.chr);
      this.sprites = decodeSprites(board.obj);
      this.bmp = new Uint16Array(W * 264); this.pri = new Uint8Array(W * 264); // rows indexed by absolute screen y
      this.rgb = new Uint32Array(W * H); // 0x00RRGGBB
      this.pens = new Uint32Array(4112);
    }
    buildPens() {
      const p = this.b.pal, c5 = v => (v << 3) | (v >> 2), sh = v => Math.trunc(Math.fround(v * SH));
      for (let i = 0; i < 2048; i++) {
        const w = (p[2 * i] << 8) | p[2 * i + 1];
        const r = c5(w & 31), g = c5((w >> 5) & 31), b = c5((w >> 10) & 31);
        this.pens[i] = (r << 16) | (g << 8) | b;
        this.pens[i + 2048] = (sh(r) << 16) | (sh(g) << 8) | sh(b);
      }
      for (let j = 0; j < (this.customPalettes || []).length; j++) for (let i = 0; i < 16; i++) {
        const pal = this.customPalettes[j], w = (pal[2 * i] << 8) | pal[2 * i + 1];
        this.pens[4096 + j * 16 + i] = (c5(w & 31) << 16) | (c5((w >> 5) & 31) << 8) | c5((w >> 10) & 31);
      }
    }
    render() {
      const b = this.b, k = b.k51;
      const idx = [32 * (k[9] & 3), 32 * ((k[9] >> 2) & 3), 32 * ((k[9] >> 4) & 3), 16 * (k[10] & 7), 16 * ((k[10] >> 3) & 7)];
      const cb = [idx[2], idx[3], idx[4]], lp = [k[2], k[3], k[4]];
      const layer = [0, 1, 2], pri = lp.slice();
      const sw = (a, c) => { if (pri[a] < pri[c]) { let t = pri[a]; pri[a] = pri[c]; pri[c] = t; t = layer[a]; layer[a] = layer[c]; layer[c] = t; } };
      sw(0, 1); sw(0, 2); sw(1, 2);
      this.bmp.fill(16 * idx[0]); this.pri.fill(0);
      this.drawLayer(layer[0], cb, 1); this.drawLayer(layer[1], cb, 2); this.drawLayer(layer[2], cb, 4);
      this.drawSprites(idx[1], pri);
      if (this.afterSprites) this.afterSprites(this);
      return this.toRGB();
    }
    toRGB() { // ind16 -> RGB with the current palette (MAME resolves pens when the frame is shown)
      this.buildPens();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.rgb[y * W + x] = this.pens[this.bmp[(y + Y0) * W + x]];
      return this.rgb;
    }
    tilePix(layer, cb, tx, ty) {
      const b = this.b, v = b.vram, ti = ((ty >> 3) << 6) | (tx >> 3), o = layer * 0x800;
      let color = v[o + ti]; const code0 = v[0x2000 + o + ti] + 256 * v[0x4000 + o + ti];
      let bank = b.crb[(color & 0x0c) >> 2];
      if (!(b.addrmap & 0x40)) color = (color & 0xf3) | ((bank & 3) << 2);
      bank >>= 2;
      const flipy = (color & 2) && (b.tileflip & 4);
      const code = (code0 | ((color & 0x3f) << 8) | (bank << 14)) & 0x7fff;
      let r = ty & 7; if (flipy) r = 7 - r;
      const pix = this.tiles[(code << 6) | (r << 3) | (tx & 7)];
      return pix ? ((cb[layer] + ((color & 0xc0) >> 6)) << 4) | pix : -1;
    }
    // One screen row of a tile layer, a tile at a time (same pixels as tilePix): tx = (tx0 + sx) & 511 across the row;
    // ty is the row's tile y, or for column scroll sy + colOff[tile column]. Look-ups are done once per 8-pixel tile.
    rowFast(layer, cb, prio, sy, tx0, ty, colOff) {
      const b = this.b, v = b.vram, o = layer * 0x800, tiles = this.tiles, bmp = this.bmp, pr = this.pri, crb = b.crb;
      const remap = !(b.addrmap & 0x40), tflip = b.tileflip & 4, cbl = cb[layer], row = sy * W;
      for (let sx = 0; sx < W;) {
        const tx = (tx0 + sx) & 511, tcol = tx >> 3, y = (colOff ? sy + colOff[tcol] : ty) & 255, ti = ((y >> 3) << 6) | tcol;
        let color = v[o + ti]; const code0 = v[0x2000 + o + ti] + 256 * v[0x4000 + o + ti];
        let bank = crb[(color & 0x0c) >> 2];
        if (remap) color = (color & 0xf3) | ((bank & 3) << 2);
        bank >>= 2;
        const code = (code0 | ((color & 0x3f) << 8) | (bank << 14)) & 0x7fff;
        let r = y & 7; if ((color & 2) && tflip) r = 7 - r;
        const base = (code << 6) | (r << 3), pal = (cbl + ((color & 0xc0) >> 6)) << 4;
        const first = tx & 7, n = Math.min(8 - first, W - sx);
        for (let k = 0; k < n; k++) { const pix = tiles[base + first + k]; if (pix) { const i = row + sx + k; bmp[i] = pal | pix; pr[i] |= prio; } }
        sx += n;
      }
    }
    drawLayer(layer, cb, prio) {
      const b = this.b, bmp = this.bmp, pr = this.pri;
      // Speed: the per-pixel path below calls tilePix ~215,000 times a frame. Unless tilePix has been replaced (custom
      // level art, web/stage/tileset.js), draw a tile at a time instead; the result is identical.
      if (this.tilePix === Video.prototype.tilePix) return this.drawLayerFast(layer, cb, prio);
      const put = (sx, sy, tx, ty) => { const c = this.tilePix(layer, cb, tx & 511, ty & 255); if (c >= 0) { const i = sy * W + sx; bmp[i] = c; pr[i] |= prio; } };
      if (layer === 0) { for (let sy = Y0; sy < Y0 + H; sy++) for (let sx = 0; sx < W; sx++) put(sx, sy, sx + 96, sy); return; }
      const m = layer === 2 ? 0x2000 : 0, sy_ = b.vram.subarray(0x1800 | m), sx_ = b.vram.subarray(0x1a00 | m);
      const ctrl = (b.scrollctrl >> ((layer - 1) * 3)) & 7, rows = [1, 1, 32, 256][ctrl & 3], cols = ctrl & 4 ? 64 : 1;
      if (cols === 1) {
        const ys = sy_[12], rs = new Int32Array(256);
        if (rows === 1) rs.fill(sx_[0] + 256 * sx_[1]);
        else { const mk = rows === 256 ? 0xff : 0xf8; for (let o = 0; o < 256; o++) rs[(o + ys) & 0xff] = sx_[2 * (o & mk)] + 256 * sx_[2 * (o & mk) + 1]; }
        for (let sy = Y0; sy < Y0 + H; sy++) { const ty = (sy + ys) & 255; for (let sx = 0; sx < W; sx++) put(sx, sy, sx + 90 + rs[ty], ty); }
      } else if (rows === 1) {
        const xs = sx_[0] + 256 * sx_[1], cs = new Int32Array(64), x8 = Math.trunc(xs / 8);
        for (let o = 0; o < 64; o++) cs[(o + x8) & 0x3f] = sy_[o];
        for (let sy = Y0; sy < Y0 + H; sy++) for (let sx = 0; sx < W; sx++) { const tx = (sx + 90 + xs) & 511; put(sx, sy, tx, sy + cs[tx >> 3]); }
      } else {
        // mixed row/col scroll: approximate (MAME tile_blitter); not seen in attract so far
        this.mixed = (this.mixed || 0) + 1;
        const xs = sx_[0] + 256 * sx_[1];
        for (let sy = Y0; sy < Y0 + H; sy++) for (let sx = 0; sx < W; sx++) { const tx = (sx + 90 + xs) & 511; put(sx, sy, tx, sy + sy_[tx >> 3]); }
      }
    }
    drawLayerFast(layer, cb, prio) {
      const b = this.b;
      if (layer === 0) { for (let sy = Y0; sy < Y0 + H; sy++) this.rowFast(0, cb, prio, sy, 96, sy, null); return; }
      const m = layer === 2 ? 0x2000 : 0, sy_ = b.vram.subarray(0x1800 | m), sx_ = b.vram.subarray(0x1a00 | m);
      const ctrl = (b.scrollctrl >> ((layer - 1) * 3)) & 7, rows = [1, 1, 32, 256][ctrl & 3], cols = ctrl & 4 ? 64 : 1;
      if (cols === 1) {
        const ys = sy_[12], rs = new Int32Array(256);
        if (rows === 1) rs.fill(sx_[0] + 256 * sx_[1]);
        else { const mk = rows === 256 ? 0xff : 0xf8; for (let o = 0; o < 256; o++) rs[(o + ys) & 0xff] = sx_[2 * (o & mk)] + 256 * sx_[2 * (o & mk) + 1]; }
        for (let sy = Y0; sy < Y0 + H; sy++) { const ty = (sy + ys) & 255; this.rowFast(layer, cb, prio, sy, 90 + rs[ty], ty, null); }
      } else if (rows === 1) {
        const xs = sx_[0] + 256 * sx_[1], cs = new Int32Array(64), x8 = Math.trunc(xs / 8);
        for (let o = 0; o < 64; o++) cs[(o + x8) & 0x3f] = sy_[o];
        for (let sy = Y0; sy < Y0 + H; sy++) this.rowFast(layer, cb, prio, sy, 90 + xs, 0, cs);
      } else {
        this.mixed = (this.mixed || 0) + 1;
        const xs = sx_[0] + 256 * sx_[1];
        for (let sy = Y0; sy < Y0 + H; sy++) this.rowFast(layer, cb, prio, sy, 90 + xs, 0, sy_);
      }
    }
    drawSprites(colorbase, lp) {
      const b = this.b, ram = b.sprDst, k46 = b.k46, list = [];
      for (let o = 0; o < 0x800; o += 8) if (ram[o] & 0x8000) list.push(o);
      const w = list.length, h = w - 1;
      for (let y = 0; y < h; y++) {
        let offs = list[y], z = ram[offs] & 0xff;
        for (let x = y + 1; x < w; x++) { const t = list[x], c = ram[t] & 0xff; if (z <= c) { z = c; list[x] = offs; list[y] = offs = t; } }
      }
      const offx = ((k46[0] << 8) | k46[1]) << 16 >> 16, offy = ((k46[2] << 8) | k46[3]) << 16 >> 16;
      for (let n = w - 1; n >= 0; n--) {
        const offs = list[n];
        let code = ram[offs + 1]; const col = ram[offs + 6];
        const p = (col & 0x0f80) >> 6;
        const pmask = p <= lp[2] ? 0 : p <= lp[1] ? 0xf0 : p <= lp[0] ? 0xfc : 0xfe;
        if (this.spriteOverride && this.spriteOverride(this, offs, pmask, n === w - 1)) continue;
        const color = colorbase + (col & 0x1f);
        let xa = 0, ya = 0;
        if (code & 1) xa += 1; if (code & 2) ya += 1; if (code & 4) xa += 2; if (code & 8) ya += 2; if (code & 0x10) xa += 4; if (code & 0x20) ya += 4;
        code &= ~0x3f;
        const t4 = ram[offs];
        let oy = ram[offs + 2] & 0x3ff, ox = ram[offs + 3] & 0x3ff;
        let scaley = ram[offs + 4] & 0x3ff, zoomy = scaley ? Math.trunc((0x400000 + (scaley >> 1)) / scaley) : 0x800000, scalex, zoomx;
        if (!(t4 & 0x4000)) { scalex = ram[offs + 5] & 0x3ff; zoomx = scalex ? Math.trunc((0x400000 + (scalex >> 1)) / scalex) : 0x800000; } else { zoomx = zoomy; scalex = scaley; }
        let nozoom = scalex === 0x40 && scaley === 0x40;
        let flipx = t4 & 0x1000, flipy = t4 & 0x2000;
        const mirrorx = col & 0x4000, mirrory = col & 0x8000; if (mirrorx) flipx = 0;
        if (k46[5] & 8) { zoomx >>= 1; ox = (ox >> 1) + 1; nozoom = false; }
        ox = (ox - offx) & 1023; oy = (-oy - offy) & 1023;
        if (ox >= 1024 - 384) ox -= 1024; if (oy >= 1024 - 512) oy -= 1024;
        const tt = (t4 >> 8) & 15, width = 1 << (tt & 3), height = 1 << ((tt >> 2) & 3);
        ox += -43; oy -= 23;
        ox -= (zoomx * width) >> 13; oy -= (zoomy * height) >> 13;
        const shadow = (col >> 10) & 3;
        for (let y = 0; y < height; y++) {
          const sy = oy + ((zoomy * y + 2048) >> 12), zh = (oy + ((zoomy * (y + 1) + 2048) >> 12)) - sy;
          for (let x = 0; x < width; x++) {
            const sx = ox + ((zoomx * x + 2048) >> 12), zw = (ox + ((zoomx * (x + 1) + 2048) >> 12)) - sx;
            let tc = code, fx, fy;
            if (mirrorx) { if ((!flipx) ^ ((x << 1) < width)) { tc += XOFF[(width - 1 - x + xa) & 7]; fx = 1; } else { tc += XOFF[(x + xa) & 7]; fx = 0; } }
            else { tc += XOFF[(flipx ? width - 1 - x + xa : x + xa) & 7]; fx = flipx ? 1 : 0; }
            if (mirrory) { if ((!flipy) ^ ((y << 1) >= height)) { tc += YOFF[(height - 1 - y + ya) & 7]; fy = 1; } else { tc += YOFF[(y + ya) & 7]; fy = 0; } }
            else { tc += YOFF[(flipy ? height - 1 - y + ya : y + ya) & 7]; fy = flipy ? 1 : 0; }
            const sxz = nozoom ? 0x10000 : zw << 12, syz = nozoom ? 0x10000 : zh << 12;
            this.zoom(tc, color, fx, fy, sx, sy, sxz, syz, pmask, shadow);
            if (mirrory && height === 1) this.zoom(tc, color, fx, fy ? 0 : 1, sx, sy, sxz, syz, pmask, shadow);
          }
        }
      }
    }
    zoom(code, color, flipx, flipy, destx, desty, scalex, scaley, pmask, shadow) {
      pmask |= 1 << 31;
      const dw = (scalex * 16 + 0x8000) >>> 16, dh = (scaley * 16 + 0x8000) >>> 16;
      if (dw < 1 || dh < 1) return;
      let dx = Math.trunc((16 << 16) / dw), dy = Math.trunc((16 << 16) / dh);
      const L = 0, R = W - 1, T = Y0, B = Y0 + H - 1;
      let ex = destx + dw - 1; if (destx > R || ex < L) return;
      let srcx = 0; if (destx < L) { srcx = (L - destx) * dx; destx = L; } if (ex > R) ex = R;
      let ey = desty + dh - 1; if (desty > B || ey < T) return;
      let srcy = 0; if (desty < T) { srcy = (T - desty) * dy; desty = T; } if (ey > B) ey = B;
      if (flipx) { srcx = (dw - 1) * dx - srcx; dx = -dx; }
      if (flipy) { srcy = (dh - 1) * dy - srcy; dy = -dy; }
      const src = this.sprites, base = (code & 0x7fff) << 8, cbase = (color & 127) << 4, bmp = this.bmp, pr = this.pri;
      for (let y = desty; y <= ey; y++) {
        const row = base + ((srcy >> 16) << 4); srcy += dy; let cx = srcx;
        for (let x = destx; x <= ex; x++, cx += dx) {
          const s = src[row + (cx >> 16)];
          if (!s) continue;
          const i = y * W + x, pd = pr[i];
          if (s !== 15 || !shadow) {
            if (((1 << (pd & 0x1f)) & pmask) === 0) bmp[i] = (pd & 0xc0) === 0xc0 ? (cbase + s) + 2048 : cbase + s;
            pr[i] = 31;
          } else if ((pd & 0x80) === 0 && ((1 << (pd & 0x1f)) & pmask) === 0) {
            const c0 = bmp[i]; // custom background pens (web/stage/tileset.js) have their shadow copy 0x100 above
            bmp[i] = c0 < 2048 ? c0 + 2048 : c0 >= 0x2000 && c0 < 0x2100 ? c0 + 0x100 : c0; pr[i] = pd | 0x80;
          }
        }
      }
    }
  }
  function decodeTiles(chr) {
    const n = chr.length >> 5, out = new Uint8Array(n * 64);
    for (let t = 0; t < n; t++) for (let r = 0; r < 8; r++) {
      const o = t * 32 + r * 4, b0 = chr[o], b1 = chr[o + 1], b2 = chr[o + 2], b3 = chr[o + 3];
      for (let x = 0; x < 8; x++) { const s = 7 - x; out[(t << 6) | (r << 3) | x] = (((b3 >> s) & 1) << 3) | (((b2 >> s) & 1) << 2) | (((b1 >> s) & 1) << 1) | ((b0 >> s) & 1); }
    }
    return out;
  }
  function decodeSprites(obj) {
    const n = obj.length >> 7, out = new Uint8Array(n * 256);
    for (let t = 0; t < n; t++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const bp = y * 64 + SXO[x] * 4, v = obj[t * 128 + (bp >> 3)];
      out[(t << 8) | (y << 4) | x] = bp & 4 ? v & 15 : v >> 4;
    }
    return out;
  }
  const api = { Video, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else G.SimpsonsVideo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
