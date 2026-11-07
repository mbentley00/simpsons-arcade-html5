// TODO(simpsons): ported from the Sunset Riders remake (K053245, 288 wide). Simpsons uses K053246/K053247 sprites (LOAD64_WORD, set_config(NORMAL_PLANE_ORDER,-43,23), pri=(color&0x0f80)>>6), K052109 tile cb code|=((color&0x3f)<<8)|(bank<<14), K053251 CI2/CI3/CI4 layers, CI0 bg, CI1 sprites; 320x224 visible (screen x 0-319, y 16-239).
// Konami ssriders video renderer: K052109 tilemaps + K053245 sprites + K053251 priority, shadows/highlights,
// palette dimming. Port of tools/render_frame.py (verified pixel-exact vs MAME 0.289 tmnt2.cpp).
'use strict';
const SSRV = (() => {
  const BW = 384, BH = 264, NPEN = 2048, f32 = Math.fround;
  const G06 = f32(0.6), GROUP = [1, G06, f32(1 / G06)];
  let tiles = null, sprites = null; // Uint8Array, 64 / 256 bytes per code
  const bmp = new Int32Array(BW * BH), pri = new Uint8Array(BW * BH);
  function setGfx(t, s) { tiles = t; sprites = s; } // decoded in the browser from the user's ROM zip (romload.js)
  async function loadGfx(base = 'assets/gfx/') {
    if (tiles && sprites) return;
    const get = async n => new Uint8Array(await (await fetch(base + n)).arrayBuffer());
    [tiles, sprites] = await Promise.all([get('tiles.bin'), get('sprites.bin')]);
  }
  async function loadDump(prefix) { // prefix like assets/dumps/dump/f3800
    const names = ['k052109', 'k052109_regs', 'k053251', 'k053244', 'k053245_buf', 'pal', 'misc'];
    const st = {};
    await Promise.all(names.map(async n => {
      const r = await fetch(`${prefix}_${n}.bin`);
      if (r.ok) st[n] = new Uint8Array(await r.arrayBuffer());
    }));
    if (!st.misc) st.misc = new Uint8Array([0x10, 0]);
    return st;
  }
  // st: {k052109 (ram), k052109_regs, k053251, k053244, k053245_buf (big-endian words), pal (LE words), misc [dim_c, dim_v]}
  function render(st, out /* Uint32Array 288*224 RGBA little-endian */) {
    const ram = st.k052109, regs = st.k052109_regs, k51 = st.k053251, k44 = st.k053244, bb = st.k053245_buf, pal = st.pal;
    const buf = i => (bb[2 * i] << 8) | bb[2 * i + 1];
    const charrombank = regs.subarray(0, 4), addrmap = regs[8], tileflip = regs[9], scrollctrl = regs[10];
    const dim_c = st.misc[0], dim_v = st.misc[1];
    const shadow_mode = (~dim_c >> 4) & 1, sdraw = shadow_mode ? 3 : 2, shadd = NPEN << shadow_mode;
    const pidx = [32 * (k51[9] & 3), 32 * ((k51[9] >> 2) & 3), 32 * ((k51[9] >> 4) & 3), 16 * (k51[10] & 7), 16 * ((k51[10] >> 3) & 7)];
    const CI = [2, 4, 3], colorbase = CI.map(c => pidx[c]), layerpri = CI.map(c => k51[c]);
    const bg = pidx[0], scb = pidx[1];
    bmp.fill(16 * bg); pri.fill(0);
    const order = [0, 1, 2].sort((a, b) => layerpri[b] - layerpri[a] || a - b);
    const spri = layerpri.slice().sort((a, b) => b - a);
    const tcode = new Int32Array(2048), tcol = new Int32Array(2048), tfy = new Uint8Array(2048);
    const rs = new Int32Array(256), cs = new Int32Array(64);
    order.forEach((l, n) => {
      const cb = 0x800 * l, v1 = 0x2000 + 0x800 * l, v2 = 0x4000 + 0x800 * l;
      for (let i = 0; i < 2048; i++) {
        let color = ram[cb + i], code = ram[v1 + i] + 256 * ram[v2 + i];
        let bank = charrombank[(color & 0x0c) >> 2];
        if (!(addrmap & 0x40)) color = (color & 0xf3) | ((bank & 3) << 2);
        bank >>= 2;
        tfy[i] = (color & 2) && (tileflip & 4) ? 1 : 0;
        code |= ((color & 3) << 8) | ((color & 0x10) << 6) | ((color & 0x0c) << 9) | (bank << 13);
        tcode[i] = (code & 0x7fff) * 64; tcol[i] = (colorbase[l] + ((color & 0xe0) >> 5)) * 16;
      }
      let mode = 0, yscroll = 0, xscroll0 = 0, xo = 96;
      if (l) {
        const sc = (scrollctrl >> ((l - 1) * 3)) & 7, m = l === 2 ? 0x2000 : 0, sy = 0x1800 | m, sx = 0x1a00 | m;
        const rows = [1, 1, 32, 256][sc & 3], cols = sc & 4 ? 64 : 1;
        yscroll = ram[sy + 12]; xscroll0 = ram[sx] + 256 * ram[sx + 1]; xo = 90;
        if (rows > 1 && cols > 1) throw new Error('mixed row+col scroll');
        if (rows > 1) {
          mode = 1; const mask = rows === 256 ? 0xff : 0xf8;
          for (let o = 0; o < 256; o++) { const q = o & mask; rs[(o + yscroll) & 0xff] = ram[sx + 2 * q] + 256 * ram[sx + 2 * q + 1]; }
        } else if (cols > 1) {
          mode = 2;
          for (let o = 0; o < 64; o++) cs[(o + (xscroll0 >> 3)) & 0x3f] = ram[sy + o];
        }
      }
      const bit = 1 << n;
      for (let y = 0; y < BH; y++) {
        let ty = (y + (mode === 2 ? 0 : yscroll)) & 255;
        const xs = xo + (mode === 1 ? rs[ty] : xscroll0), row = y * BW;
        for (let x = 0; x < BW; x++) {
          const tx = (x + xs) & 511;
          if (mode === 2) ty = (y + cs[tx >> 3]) & 255;
          const ti = (ty >> 3) * 64 + (tx >> 3);
          const py = tfy[ti] ? 7 - (ty & 7) : ty & 7;
          const v = tiles[tcode[ti] + py * 8 + (tx & 7)];
          if (v) { bmp[row + x] = tcol[ti] + v; pri[row + x] |= bit; }
        }
      }
    });
    // sprites
    const flipX = k44[5] & 1, flipY = k44[5] & 2, offX = (k44[0] << 8) | k44[1], offY = (k44[2] << 8) | k44[3];
    const sorted = new Int32Array(128).fill(-1);
    for (let offs = 0; offs < 0x400; offs += 8) {
      let pc = buf(offs);
      if (pc & 0x8000) { pc &= 0x7f; if (offs && pc === 0) continue; if (sorted[pc] < 0) sorted[pc] = offs; }
    }
    let nspr = 0;
    for (let pc = 127; pc >= 0; pc--) {
      const offs = sorted[pc]; if (offs < 0) continue;
      const b0 = buf(offs), b6 = buf(offs + 6);
      let code = buf(offs + 1);
      code = (code & 0xffe1) + ((code & 0x10) >> 2) + ((code & 8) << 1) + ((code & 4) >> 1) + ((code & 2) << 2);
      let color = b6 & 0xff;
      const p = 0x20 | ((color & 0x60) >> 2);
      let pmask = p <= spri[2] ? 0 : p <= spri[1] ? 0xf0 : p <= spri[0] ? 0xfc : 0xfe;
      color = (scb + (color & 0x1f)) * 16;
      const size = (b0 & 0x0f00) >> 8, w = 1 << (size & 3), h = 1 << ((size >> 2) & 3);
      let zy = buf(offs + 4), zx;
      if (zy > 0x2000) continue;
      zy = zy ? Math.floor((0x400000 + (zy >> 1)) / zy) : 0x800000;
      if (!(b0 & 0x4000)) { zx = buf(offs + 5); if (zx > 0x2000) continue; zx = zx ? Math.floor((0x400000 + (zx >> 1)) / zx) : 0x800000; }
      else zx = zy;
      let ox = buf(offs + 3) + offX - 96, oy = buf(offs + 2);
      let flipx = b0 & 0x1000 ? 1 : 0, flipy = b0 & 0x2000 ? 1 : 0;
      const mirrorx = b6 & 0x100, mirrory = b6 & 0x200, shadow = b6 & 0x80;
      if (mirrorx) flipx = 0;
      if (flipX) { ox = 320 - ox; if (!mirrorx) flipx ^= 1; }
      if (flipY) { oy = -oy; if (!mirrory) flipy ^= 1; }
      ox = (ox + 0x5d) & 0x3ff; if (ox >= 768) ox -= 1024;
      oy = (-(oy + offY + 7)) & 0x3ff; if (oy >= 640) oy -= 1024;
      ox -= Math.floor(zx * w / 8192); oy -= Math.floor(zy * h / 8192);
      nspr++;
      for (let y = 0; y < h; y++) {
        const sy0 = oy + ((zy * y + 2048) >> 12), zh = oy + ((zy * (y + 1) + 2048) >> 12) - sy0;
        for (let x = 0; x < w; x++) {
          const sx0 = ox + ((zx * x + 2048) >> 12), zw = ox + ((zx * (x + 1) + 2048) >> 12) - sx0;
          let c, fx, fy;
          if (mirrorx) { if ((flipx === 0) !== (2 * x < w)) { c = code + (w - x - 1); fx = 1; } else { c = code + x; fx = 0; } }
          else { c = code + (flipx ? w - 1 - x : x); fx = flipx; }
          if (mirrory) { if ((flipy === 0) !== (2 * y >= h)) { c += 8 * (h - y - 1); fy = 1; } else { c += 8 * y; fy = 0; } }
          else { c += 8 * (flipy ? h - 1 - y : y); fy = flipy; }
          c = (c & 0x3f) | (code & ~0x3f);
          if (zw <= 0 || zh <= 0) continue;
          const tb = (c & 0x3fff) * 256, dxs = Math.floor((16 << 16) / zw), dys = Math.floor((16 << 16) / zh);
          for (let yy = 0; yy < zh; yy++) {
            const Y = sy0 + yy; if (Y < 0 || Y >= BH) continue;
            const syi = (fy ? (zh - 1 - yy) * dys : yy * dys) >> 16, srow = tb + syi * 16, row = Y * BW;
            for (let xx = 0; xx < zw; xx++) {
              const X = sx0 + xx; if (X < 0 || X >= BW) continue;
              const v = sprites[srow + ((fx ? (zw - 1 - xx) * dxs : xx * dxs) >> 16)];
              if (!v) continue;
              const i = row + X, pd = pri[i], pl = pd & 0x1f;
              const masked = pl === 31 || ((pmask >> pl) & 1);
              if (shadow && v === 15) {
                if (!(pd & 0x80) && !masked) { if (bmp[i] < NPEN) bmp[i] += shadd; pri[i] = pd | (sdraw << 6); }
              } else {
                if (!masked) { const pen = color + v; bmp[i] = (pd & 0xc0) === 0xc0 ? pen + shadd : pen; }
                pri[i] = 31;
              }
            }
          }
        }
      }
    }
    // palette + dimming LUT (ssriders screen_update)
    const enable = k51[5]; let dimpal = 0;
    if (enable !== 0x3e) {
      dimpal |= 1 << ((colorbase[1] >> 4) & 7);
      if (!(enable & 0x10)) { for (let i = 0; i < 2; i++) dimpal |= 1 << (((scb >> 4) | i) & 7); dimpal |= 1 << ((colorbase[2] >> 4) & 7); }
    }
    const factor = dim_v | ((~dim_c & 0x10) >> 1);
    const brt = f32(1 - (1 - G06) * factor / 8);
    const lut = getLut(pal, dimpal, brt);
    for (let y = 0; y < 224; y++) { const s = (y + 16) * BW + 16, d = y * 288; for (let x = 0; x < 288; x++) out[d + x] = lut[bmp[s + x]]; }
    return { sprites: nspr, dim_c, dim_v, factor, dimpal };
  }
  const lut = new Uint32Array(3 * NPEN);
  function getLut(pal, dimpal, brt) {
    for (let p = 0; p < NPEN; p++) {
      const w = pal[2 * p] | (pal[2 * p + 1] << 8), c5 = v => (v << 3) | (v >> 2);
      const r = c5(w & 31), g = c5((w >> 5) & 31), b = c5((w >> 10) & 31);
      const e = (dimpal >> (p >> 8)) & 1 ? brt : 1;
      for (let k = 0; k < 3; k++) {
        const c = f32(GROUP[k] * e), cl = v => Math.min(255, Math.trunc(f32(v * c)));
        lut[k * NPEN + p] = 0xff000000 | (cl(b) << 16) | (cl(g) << 8) | cl(r);
      }
    }
    return lut;
  }
  return { setGfx, loadGfx, loadDump, render, W: 288, H: 224 };
})();
