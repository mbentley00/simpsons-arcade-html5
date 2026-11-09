#!/usr/bin/env python3
"""Draw the original bowling alley background art and pack it as a custom stage tileset.

Same pipeline as tools/build_tileset_school.py (whose drawing/packing helpers it reuses), laid out for the Stage 2
slot (the amusement park's main section: 72 columns x 8 rows of 32x32 blocks; the screen shows rows 0-6 and the
walkable floor starts near y = 128):
  back  (layer 0): ceiling, back wall, twenty lanes seen down their length with pin decks and pinsetter masks, the
                   approach, the patterned carpet floor, and a snack bar / shoe rental / arcade wing
  front (layer 1): hanging score monitors, ball returns, a pro shop alcove, counters, arcade cabinets, exit doors
Writes web/custom/tileset_bowling.js (window.SIMPTILESETS.bowling). No ROM data is read or embedded.

Usage: python tools/build_tileset_bowling.py [--preview DIR]
"""
import argparse, json, os, random
from PIL import Image
import build_tileset_school as T

W = T.W = 2304  # the shared Canvas/pack helpers read the module's W
H, CELL = T.H, T.CELL
ROOT = T.ROOT
LANES_A, PRO, LANES_B, WING = (40, 680), (680, 840), (840, 1480), 1480
FLOOR = 132   # approach ends / carpet starts

T.C.update({
    'ceil': (34, 26, 52), 'ceil2': (52, 40, 78), 'lamp': (255, 244, 200), 'wallB': (46, 36, 92), 'wallB2': (62, 48, 118),
    'neonP': (255, 70, 190), 'neonC': (60, 230, 255), 'neonY': (255, 236, 90), 'neonG': (110, 255, 120),
    'lane0': (222, 172, 104), 'lane1': (200, 148, 84), 'lane2': (240, 196, 132), 'gutter': (40, 34, 44), 'gutter2': (70, 62, 76),
    'deck': (236, 220, 190), 'pin': (250, 250, 250), 'pinR': (220, 40, 50), 'pinS': (196, 196, 204),
    'mask0': (240, 90, 40), 'mask1': (40, 120, 220), 'mask2': (250, 200, 40), 'mask3': (140, 70, 200),
    'appr0': (232, 190, 130), 'appr1': (214, 170, 112), 'dot': (90, 60, 40),
    'carp0': (40, 30, 74), 'carp1': (150, 70, 130), 'carp2': (60, 120, 150), 'carp3': (150, 130, 70), 'carp4': (52, 40, 92),
    'ret0': (90, 96, 112), 'ret1': (60, 64, 78), 'ret2': (150, 156, 170),
    'ball0': (220, 40, 60), 'ball1': (40, 90, 220), 'ball2': (40, 180, 90), 'ball3': (250, 170, 30), 'ball4': (150, 60, 200), 'ballH': (255, 255, 255),
    'crt': (20, 30, 40), 'crtG': (90, 240, 160), 'crtF': (70, 74, 86),
    'tile0': (230, 226, 214), 'tile1': (200, 60, 70), 'chrome': (210, 214, 224), 'chrome2': (150, 156, 168),
    'cab0': (40, 40, 60), 'cab1': (220, 60, 60), 'cab2': (60, 120, 230), 'scr': (30, 200, 120),
    'shoe0': (200, 60, 50), 'shoe1': (60, 110, 200), 'shoe2': (240, 240, 230), 'wood3': (110, 70, 40),
})
T.FONT.update({
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'], 'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'], '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'], '.': ['.....'] * 6 + ['..#..'],
})
rng = random.Random(300)
tw = T.text_width


# ---------------------------------------------------------------- back layer
def lane(b, x, n):
    """One lane seen down its length: gutters, oiled boards narrowing to the pin deck, ten pins, pinsetter mask."""
    top, bot, wtop, wbot = 70, FLOOR - 4, 34, 58
    cx = x + 32
    for y in range(top, bot):
        t = (y - top) / (bot - top); hw = int((wtop + (wbot - wtop) * t) / 2); gw = 3 + int(3 * t)
        b.rect(cx - hw - gw, y, cx - hw, y + 1, 'gutter'); b.rect(cx + hw, y, cx + hw + gw, y + 1, 'gutter')
        for xx in range(cx - hw, cx + hw):
            board = (xx - cx + hw) * 13 // max(1, 2 * hw)
            b.dot(xx, y, 'lane2' if board in (3, 9) and (y // 3) % 2 else 'lane0' if board % 2 else 'lane1')
        b.dot(cx - hw - gw, y, 'gutter2'); b.dot(cx + hw + gw - 1, y, 'gutter2')
    # target arrows on the lane
    for k in (-2, -1, 0, 1, 2):
        ax, ay = cx + k * 6, 104 + abs(k) * 3
        b.poly([(ax - 2, ay + 3), (ax, ay), (ax + 2, ay + 3)], 'dot')
    # pin deck and pins (triangle: rows of 4, 3, 2, 1 from the back)
    b.rect(cx - 19, 60, cx + 19, 72, 'deck')
    for row, cnt in enumerate((4, 3, 2, 1)):
        for i in range(cnt):
            px, py = cx - (cnt - 1) * 4 + i * 8, 58 + row * 3
            b.rect(px - 1, py, px + 2, py + 7, 'pin'); b.rect(px - 1, py + 2, px + 2, py + 3, 'pinR'); b.dot(px + 1, py + 5, 'pinS')
    # pinsetter mask with the lane number
    b.rect(cx - 24, 30, cx + 24, 56, ['mask0', 'mask1', 'mask2', 'mask3'][n % 4]); b.rect(cx - 24, 54, cx + 24, 56, 'black')
    b.poly([(cx - 24, 30), (cx - 8, 30), (cx - 24, 46)], 'neonY' if n % 2 else 'neonC')
    b.ellipse(cx + 6, 34, cx + 22, 50, 'white'); b.text(cx + 14 - tw(str(n)) // 2, 39, str(n), 'black')


def carpet(b, x0, x1):
    b.rect(x0, FLOOR + 8, x1, 256, 'carp0')
    for y in range(FLOOR + 8, 256, 32):
        for x in range(x0 - (y // 32 % 2) * 32, x1, 64):
            b.rect(x + 4, y + 4, x + 10, y + 6, 'carp1'); b.rect(x + 6, y + 2, x + 8, y + 8, 'carp1')     # plus
            b.ellipse(x + 26, y + 10, x + 34, y + 18, 'carp2'); b.ellipse(x + 28, y + 12, x + 32, y + 16, 'carp0')  # ring
            b.poly([(x + 14, y + 20), (x + 20, y + 14), (x + 22, y + 22)], 'carp3')  # triangle
            b.line(x + 38, y + 2, x + 44, y + 8, 'carp4'); b.line(x + 39, y + 2, x + 45, y + 8, 'carp4')
    b.rect(x0, FLOOR + 6, x1, FLOOR + 8, 'black')


def draw_back(b):
    # ceiling with lamp rows, back wall
    b.rect(0, 0, W, 22, 'ceil')
    for x in range(0, W, 16): b.rect(x, 0, x + 1, 22, 'ceil2')
    for x in range(20, W, 80): b.rect(x, 8, x + 28, 12, 'lamp')
    b.rect(0, 22, W, FLOOR, 'wallB')
    for x in range(0, W, 24): b.rect(x, 22, x + 2, 30, 'wallB2')
    # neon stripe along the wall
    b.rect(0, 24, W, 26, 'neonP'); b.rect(0, 27, W, 28, 'neonC')
    # lanes
    n = 1
    for x0, x1 in (LANES_A, LANES_B):
        for x in range(x0, x1, 64): lane(b, x, n); n += 1
    # approach (light maple with locator dots) and foul line
    b.rect(0, FLOOR - 4, WING, FLOOR + 6, 'appr0')
    for x in range(0, WING, 8): b.dot(x + 3, FLOOR + 2, 'dot')
    b.rect(0, FLOOR - 4, WING, FLOOR - 3, 'black')
    for x in range(0, WING, 64): b.rect(x + 2, FLOOR - 2, x + 4, FLOOR + 6, 'appr1')
    # pro shop alcove wall
    px0, px1 = PRO
    b.rect(px0, 22, px1, FLOOR - 4, 'wallB2')
    for y in range(40, 112, 18): b.rect(px0 + 10, y, px1 - 10, y + 2, 'wood1')
    # wing: snack bar / shoes / arcade wall with checker tiles and menu boards
    b.rect(WING, 22, W, FLOOR + 6, 'tile0')
    for y in range(80, FLOOR + 6, 8):
        for x in range(WING + (y // 8 % 2) * 8, W, 16): b.rect(x, y, x + 8, y + 8, 'tile1')
    b.rect(WING, 76, W, 80, 'chrome2')
    for i, (label, price) in enumerate([('PIZZA', '$2'), ('HOT DOGS', '$1'), ('SODA', '.50'), ('NACHOS', '$2')]):
        mx = WING + 40 + i * 84
        b.rect(mx, 34, mx + 74, 66, 'black'); b.outline(mx, 34, mx + 74, 66, 'chrome')
        b.text(mx + 37 - tw(label) // 2, 40, label, 'neonY'); b.text(mx + 37 - tw(price) // 2, 52, price, 'neonG')
    carpet(b, 0, W)
    b.rect(WING, FLOOR - 4, WING + 4, FLOOR + 6, 'chrome2')


# ---------------------------------------------------------------- front layer
def monitor(f, x, n):
    f.rect(x + 30, 0, x + 34, 8, 'chrome2')
    f.rect(x + 6, 8, x + 58, 22, 'crtF'); f.rect(x + 8, 10, x + 56, 20, 'crt')
    for k in range(6): f.rect(x + 9 + k * 8, 11, x + 9 + k * 8 + 1, 19, 'crtF')
    f.text(x + 10, 12, ['X', '9', '-', 'X', '7', '8'][n % 6], 'crtG')


def ball_return(f, x):
    f.rect(x - 10, 108, x + 10, FLOOR - 2, 'ret1'); f.ellipse(x - 12, 100, x + 12, 120, 'ret0'); f.rect(x - 12, 110, x + 12, 116, 'ret0')
    f.ellipse(x - 7, 103, x + 7, 113, 'ret1')
    for k, c in enumerate(('ball0', 'ball1', 'ball3')):
        bx = x - 14 + k * 9 if k != 1 else x - 5
        f.ellipse(bx, 118 - (k == 1) * 2, bx + 9, 127 - (k == 1) * 2, c); f.dot(bx + 2, 120 - (k == 1) * 2, 'ballH')
    f.rect(x - 14, FLOOR - 4, x + 16, FLOOR - 2, 'ret2')


def arcade_cab(f, x, c):
    f.rect(x, 60, x + 28, FLOOR + 4, 'cab0'); f.rect(x, 60, x + 28, 70, c); f.rect(x + 4, 74, x + 24, 94, 'black'); f.rect(x + 6, 76, x + 22, 92, 'scr')
    for k in range(3): f.rect(x + 8 + k * 4, 80 + k * 3, x + 11 + k * 4, 83 + k * 3, 'neonY')
    f.rect(x - 2, 96, x + 30, 104, 'cab0'); f.dot(x + 8, 99, 'red'); f.dot(x + 14, 100, 'neonC'); f.dot(x + 18, 100, 'neonY')


def draw_front(f):
    n = 1
    for x0, x1 in (LANES_A, LANES_B):
        for x in range(x0, x1, 64):
            if not 3 <= n <= 6: monitor(f, x, n)  # the hanging sign is over lanes 3-6
            if n % 2 == 0: ball_return(f, x)
            n += 1
    # big hanging neon sign
    f.rect(176, 2, 424, 21, 'black'); f.outline(176, 2, 424, 21, 'neonP'); f.outline(178, 4, 422, 19, 'neonC')
    name = 'SPRINGFIELD LANES'; f.text(300 - tw(name) // 2, 8, name, 'neonY')
    # pro shop alcove: ball racks, window and sign
    px0, px1 = PRO
    f.rect(px0, 22, px0 + 6, FLOOR, 'wood3'); f.rect(px1 - 6, 22, px1, FLOOR, 'wood3')
    f.rect(px0 + 20, 30, px1 - 20, 44, 'black'); f.text((px0 + px1) // 2 - tw('PRO SHOP') // 2, 34, 'PRO SHOP', 'neonG')
    for r, y in enumerate((52, 74, 96)):
        f.rect(px0 + 12, y + 12, px1 - 12, y + 14, 'chrome2')
        for k, x in enumerate(range(px0 + 16, px1 - 24, 14)):
            f.ellipse(x, y, x + 12, y + 12, ['ball0', 'ball1', 'ball2', 'ball3', 'ball4'][(k + r) % 5]); f.dot(x + 3, y + 3, 'ballH')
    f.rect(px0 + 10, 118, px1 - 10, FLOOR, 'wood1'); f.rect(px0 + 10, 116, px1 - 10, 118, 'wood2')
    # wing: snack bar counter with stools
    sx0 = WING + 30
    f.rect(sx0, 98, sx0 + 330, FLOOR - 2, 'red'); f.rect(sx0 - 4, 94, sx0 + 334, 98, 'chrome')
    for x in range(sx0 + 10, sx0 + 330, 20): f.rect(x, 102, x + 10, FLOOR - 6, 'tile1')
    f.rect(sx0 + 100, 104, sx0 + 230, 124, 'white'); f.outline(sx0 + 100, 104, sx0 + 230, 124, 'black')
    f.text(sx0 + 165 - tw('SNACK BAR', 2) // 2, 107, 'SNACK BAR', 'red', scale=2)
    for x in [x for x in range(sx0 + 20, sx0 + 330, 44) if not sx0 + 86 < x < sx0 + 232]:
        f.rect(x + 6, 120, x + 8, FLOOR + 2, 'chrome2'); f.ellipse(x, 114, x + 14, 122, 'red'); f.rect(x + 1, 118, x + 13, 120, 'tile1')
    f.ellipse(sx0 + 40, 86, sx0 + 56, 94, 'orange'); f.rect(sx0 + 120, 84, sx0 + 128, 94, 'white'); f.rect(sx0 + 120, 84, sx0 + 128, 87, 'red')
    # shoe rental counter with cubbies
    hx0 = WING + 390
    f.rect(hx0, 30, hx0 + 160, 92, 'wood1')
    for r in range(4):
        for c in range(8):
            x, y = hx0 + 4 + c * 19, 34 + r * 14
            f.rect(x, y, x + 17, y + 12, 'wood3')
            if (r * 8 + c) % 3 != 2:
                col = ('shoe0', 'shoe1')[(r + c) % 2]
                f.rect(x + 2, y + 6, x + 15, y + 10, col); f.rect(x + 2, y + 9, x + 15, y + 11, 'shoe2'); f.rect(x + 8, y + 4, x + 14, y + 7, col)
    f.rect(hx0 - 6, 98, hx0 + 166, FLOOR - 2, 'wood0'); f.rect(hx0 - 8, 94, hx0 + 168, 98, 'wood2')
    f.text(hx0 + 80 - tw('SHOE RENTAL') // 2, 108, 'SHOE RENTAL', 'white')
    # arcade corner and exit doors
    for k, x in enumerate(range(WING + 590, WING + 720, 34)): arcade_cab(f, x, ('cab1', 'cab2', 'neonP', 'cab1')[k % 4])
    f.rect(WING + 590, 36, WING + 720, 50, 'black'); f.text(WING + 655 - tw('ARCADE') // 2, 40, 'ARCADE', 'neonP')
    ex = W - 70
    f.rect(ex - 4, 40, ex + 60, FLOOR + 4, 'chrome2')
    for dx in (0, 29):
        f.rect(ex + dx, 44, ex + dx + 27, FLOOR + 4, 'door1'); f.rect(ex + dx + 5, 52, ex + dx + 22, 90, 'glass0'); f.rect(ex + dx + 4, 98, ex + dx + 23, 101, 'chrome')
    f.rect(ex + 8, 28, ex + 48, 38, 'red'); f.text(ex + 28 - tw('EXIT') // 2, 30, 'EXIT', 'white')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--preview'); a = ap.parse_args()
    back, front = T.Canvas(), T.Canvas()
    draw_back(back); draw_front(front)
    pal, layers = T.pack([back.im, front.im])
    doc = {
        'id': 'bowling', 'name': 'Bowling Alley', 'scene': 4, 'st': 0x84, 'area': 0, 'cols': W // CELL, 'rows': H // CELL,
        'groups': [{'name': 'Lanes', 'from': 0, 'to': WING // CELL}, {'name': 'Snack bar & arcade', 'from': WING // CELL, 'to': W // CELL}],
        'palette': pal, 'layers': layers,
    }
    out = os.path.join(ROOT, 'web', 'custom', 'tileset_bowling.js')
    with open(out, 'w', newline='\n') as fh:
        fh.write('// Generated by tools/build_tileset_bowling.py: original bowling alley background art (no ROM data).\n')
        fh.write('(function(G){(G.SIMPTILESETS=G.SIMPTILESETS||{}).bowling=' + json.dumps(doc, separators=(',', ':')) + ';'
                 "if(typeof module!=='undefined'&&module.exports)module.exports=G.SIMPTILESETS.bowling;})(typeof window!=='undefined'?window:globalThis);\n")
    print(f'{out}: {len(pal) // 3 - 1} colours, blocks back={layers[0]["count"]} front={layers[1]["count"]}, {os.path.getsize(out)} bytes')
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        img = Image.new('RGBA', (W, H), (40, 40, 60, 255)); img.alpha_composite(back.im); img.alpha_composite(front.im)
        img.convert('RGB').save(os.path.join(a.preview, 'bowling_composite.png'))


if __name__ == '__main__':
    main()
