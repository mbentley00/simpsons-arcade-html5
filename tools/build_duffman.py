"""Convert the generated 4x4 animation atlas into K053247 4bpp tiles and RGB555 palette.
Usage: python tools/build_duffman.py SOURCE.png OUTPUT_DIR [--id rivet --name Rivet --colors HEX,...]
The JS asset is portable project code; the .4bpp/.pal files are standalone native-format exports.
"""
import base64
import argparse
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path); parser.add_argument('destination', type=Path)
parser.add_argument('--id', default='duffman'); parser.add_argument('--name', default='Duffman')
parser.add_argument('--colors', help='16 comma-separated RGB hex colours, including transparent pen zero')
parser.add_argument('--scale', type=float, default=0.75, help='on-screen size of one cell pixel (displayScale)')
parser.add_argument('--anchor', default='32,91', help='feet position in the cell, as X,Y')
parser.add_argument('--cell', default='64x96', help='frame size in pixels, WxH, multiples of 16 (default 64x96)')
args = parser.parse_args()
source, destination = args.source, args.destination
destination.mkdir(parents=True, exist_ok=True)
im = Image.open(source).convert('RGBA')
assert im.width % 4 == 0 and im.height % 4 == 0
# Pen zero is transparent. All visible colours round-trip through the board's 5-bit channels.
colors = ['000000', '101820', 'ffd429', 'c89918', 'fff8ed', 'c2c5c0', '767b79', 'ec2632',
          '941c28', '63c5e5', '2789ae', '173e50', 'ef9e26', '753b1d', 'e9babe', 'ffffff']
if args.colors: colors = args.colors.split(',')
assert len(colors) == 16 and all(len(c) == 6 for c in colors)
assert args.id.isidentifier(), 'asset ID must be a JavaScript identifier'
CW, CH = (int(v) for v in args.cell.lower().split('x'))
assert CW % 16 == 0 and CH % 16 == 0, 'cell size must be a multiple of 16'
palette = [tuple(int(h[i:i+2], 16) >> 3 for i in (0, 2, 4)) for h in colors]
rgb = [tuple((c << 3) | (c >> 2) for c in p) for p in palette]
pal = b''.join((r | (g << 5) | (b << 10)).to_bytes(2, 'big') for r, g, b in palette)
preview = Image.new('RGBA', (4 * CW, 4 * CH))
tiles = bytearray()
sx = [2, 3, 0, 1, 6, 7, 4, 5, 10, 11, 8, 9, 14, 15, 12, 13]
for frame in range(16):
    col, row = frame % 4, frame // 4
    crop = im.crop((col*im.width//4, row*im.height//4, (col+1)*im.width//4, (row+1)*im.height//4)).resize((CW, CH), Image.Resampling.NEAREST)
    pens = []
    for y in range(CH):
        for x in range(CW):
            r, g, b, a = crop.getpixel((x, y))
            pen = 0 if a < 128 else min(range(1, 16), key=lambda i: sum((v-w)**2 for v, w in zip((r, g, b), rgb[i])))
            pens.append(pen)
            if pen: preview.putpixel((col*CW+x, row*CH+y), (*rgb[pen], 255))
    for ty in range(CH // 16):
        for tx in range(CW // 16):
            tile = bytearray(128)
            for y in range(16):
                for x in range(16):
                    bp = y*64+sx[x]*4
                    tile[bp//8] |= pens[(ty*16+y)*CW+tx*16+x] << (0 if bp & 4 else 4)
            tiles.extend(tile)
asset = {'id': args.id, 'name': args.name, 'width': CW, 'height': CH, 'frames': 16,
         'tileWidth': 16, 'tileHeight': 16, 'tilesPerFrame': (CW // 16) * (CH // 16), 'format': 'k053247-4bpp',
         'anchor': [int(v) for v in args.anchor.split(',')], 'displayScale': args.scale, 'facing': 'left', 'palette': list(pal),
         'animations': {'idle': [0, 1, 2, 3], 'walk': [4, 5, 6, 7], 'attack': [8, 9, 10, 11], 'hit': [12, 13], 'fall': [14, 15]},
         'tiles': base64.b64encode(tiles).decode()}
name = 'SIMP' + args.id.upper()
(destination/(args.id+'.js')).write_text('// Custom art only. 16x16 K053247 tiles, 16-colour RGB555 palette, pen 0 transparent.\nwindow.'+name+' = '+json.dumps(asset, separators=(',', ':'))+';\n(window.SIMPENEMY_ASSETS ||= {})['+json.dumps(args.id)+'] = window.'+name+';\n', encoding='utf-8')
(destination/(args.id+'.4bpp')).write_bytes(tiles)
(destination/(args.id+'.pal')).write_bytes(pal)
(destination/(args.id+'.json')).write_text(json.dumps({k:v for k,v in asset.items() if k != 'tiles'}, indent=2), encoding='utf-8')
preview.save(destination/(args.id+'.png'))
print(f'{len(tiles)} packed bytes; 16 frames of {CW}x{CH}; 16-colour palette ({len(pal)} bytes)')
