#!/usr/bin/env python3
# TODO(simpsons): still the ssriders layout; adapt to simpsons.zip (see NOTES.md ROM table).
"""Sunset Riders graphics extraction (run locally on your own ROM set; outputs are gitignored).

Decodes, following MAME konami/k052109.cpp + k053244_k053245.cpp (+ tmnt2.cpp ROM_LOAD32_WORD):
  K052109 tiles  : 064e12.16k (even words) + 064e11.12k (odd words) -> 32768 x 8x8 4bpp
  K053245 sprites: 064e09.7l  (even words) + 064e07.3l (odd words)  -> 16384 x 16x16 4bpp
gfx_layout planeoffset {24,16,8,0}: each 8-pixel row is one 32-bit group; byte 3 = plane 0 (MSB of the pixel), byte 0 = plane 3 (LSB);
leftmost pixel = bit 7.  Sprites: 16x16 = four 8x8 quadrants: +32 bytes = right half, +64 bytes = bottom half (128 bytes/sprite).

Outputs (web/assets/gfx/):
  tiles.png    indexed (pixel = pen 0..15) atlas, 128 tiles per row  (tile n at x=(n%128)*8,  y=(n//128)*8)
  sprites.png  indexed atlas, 64 sprites per row                    (code n at x=(n%64)*16, y=(n//64)*16)
  tiles.bin / sprites.bin  raw 1 byte per pixel (same order as decode: tile-major, row-major)
  gfx.json     metadata
Usage: tools/extract_gfx.py [roms/ssriders.zip] [outdir]
"""
import sys, os, zipfile, json
import numpy as np
from PIL import Image

def load32_word(a, b):
    a = np.frombuffer(a, np.uint8).reshape(-1, 2); b = np.frombuffer(b, np.uint8).reshape(-1, 2)
    return np.concatenate([a, b], axis=1).reshape(-1)  # a0 a1 b0 b1 ...

def decode_rows(data):
    """data: N*4 bytes, each 32-bit group = one 8-pixel row -> (N, 8) pens"""
    g = data.reshape(-1, 4)
    bits = np.unpackbits(g, axis=1).reshape(-1, 4, 8)  # [row, byte, pixel] MSB first
    # byte3 -> plane bit3 ... byte0 -> bit0  (planeoffset 24,16,8,0 with plane[0] as MSB)
    return (bits[:, 3] << 3 | bits[:, 2] << 2 | bits[:, 1] << 1 | bits[:, 0]).astype(np.uint8)

def decode_tiles(rom):
    return decode_rows(rom).reshape(-1, 8, 8)

def decode_sprites(rom):
    q = decode_rows(rom).reshape(-1, 4, 8, 8)  # per 128 bytes: 4 quadrants of 8 rows (32 bytes each): TL, TR, BL, BR
    out = np.zeros((q.shape[0], 16, 16), np.uint8)
    out[:, :8, :8] = q[:, 0]; out[:, :8, 8:] = q[:, 1]; out[:, 8:, :8] = q[:, 2]; out[:, 8:, 8:] = q[:, 3]
    return out

def atlas(t, per_row):
    n, h, w = t.shape
    rows = (n + per_row - 1) // per_row
    a = np.zeros((rows * h, per_row * w), np.uint8)
    for i in range(n):
        y, x = divmod(i, per_row); a[y*h:(y+1)*h, x*w:(x+1)*w] = t[i]
    return a

def save_indexed(a, path):
    im = Image.fromarray(a, 'P')
    im.putpalette([v for i in range(256) for v in (min(255, i*17),)*3])
    im.save(path, optimize=True)

def load(zip_path):
    z = zipfile.ZipFile(zip_path)
    r = lambda n: z.read(n)
    tiles = decode_tiles(load32_word(r('064e12.16k'), r('064e11.12k')))
    sprites = decode_sprites(load32_word(r('064e09.7l'), r('064e07.3l')))
    return tiles, sprites

if __name__ == '__main__':
    zp = sys.argv[1] if len(sys.argv) > 1 else 'roms/ssriders.zip'
    out = sys.argv[2] if len(sys.argv) > 2 else 'web/assets/gfx'
    os.makedirs(out, exist_ok=True)
    tiles, sprites = load(zp)
    save_indexed(atlas(tiles, 128), f'{out}/tiles.png')
    save_indexed(atlas(sprites, 64), f'{out}/sprites.png')
    tiles.tofile(f'{out}/tiles.bin'); sprites.tofile(f'{out}/sprites.bin')
    json.dump({'tiles': {'count': len(tiles), 'w': 8, 'h': 8, 'perRow': 128},
               'sprites': {'count': len(sprites), 'w': 16, 'h': 16, 'perRow': 64},
               'pixel': 'pen 0..15 (0 = transparent); color = palette[colorIndex*16 + pen]'}, open(f'{out}/gfx.json', 'w'), indent=1)
    print('tiles', tiles.shape, 'sprites', sprites.shape, '->', out)
