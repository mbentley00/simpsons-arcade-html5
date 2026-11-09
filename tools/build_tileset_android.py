#!/usr/bin/env python3
"""Draw the original Android's Dungeon background art and pack it as a custom stage tileset.

Same pipeline as tools/build_tileset_school.py (whose drawing/packing helpers it reuses) and the same Stage 1 slot
(56 columns x 8 rows of 32x32 blocks, walkable ground in rows 4-7):
  back  (layer 0): sky and rooftops, the sidewalk and street outside; inside the shop the green walls, shelves of
                   boxed action figures in teal blister packs, posters, a pennant, the back-room doorway, plank floor
  front (layer 1): red-brick neighbours, the green comic shop with its sign, striped awning, display window with the
                   cardboard robot, glass door with OPEN sign and 507, a dumpster; indoors the glass counter with the
                   blue register, comic racks and longboxes (transparent gaps)
Writes web/custom/tileset_android.js (window.SIMPTILESETS.android). No ROM data is read or embedded.

Usage: python tools/build_tileset_android.py [--preview DIR]
"""
import argparse, json, os, random
from PIL import Image
import build_tileset_school as T

W, H, CELL = T.W, T.H, T.CELL   # 1792 x 256, the Stage 1 slot
ROOT = T.ROOT
INDOOR = 1248      # the shop interior starts here
STREET = 144       # storefronts end / sidewalk starts
CURB = 194
FLOOR = 136        # indoors: wall ends / floor starts

T.C.update({
    'gbr0': (62, 126, 52), 'gbr1': (46, 104, 42), 'gbr2': (84, 148, 66), 'gmort': (36, 78, 34), 'gtrim': (28, 64, 30),
    'aw0': (128, 32, 140), 'aw1': (240, 230, 244), 'aw2': (96, 20, 108), 'awS': (200, 186, 210),
    'sign': (240, 236, 218), 'signR': (140, 24, 30), 'signF': (34, 72, 34),
    'robot0': (186, 150, 130), 'robot1': (150, 116, 100), 'robot2': (110, 84, 74), 'robotE': (220, 40, 40), 'robotB': (90, 120, 200),
    'bubble': (250, 250, 250), 'cb0': (220, 60, 60), 'cb1': (60, 120, 220), 'cb2': (240, 200, 60), 'cb3': (80, 180, 90), 'cb4': (160, 90, 200),
    'ledge': (150, 104, 60), 'shopdk': (36, 70, 64), 'shoplt': (80, 120, 112),
    'curtain': (240, 120, 170), 'curtain2': (210, 90, 140), 'road0': (96, 96, 102), 'road1': (84, 84, 90), 'road2': (110, 110, 116),
    'dump0': (60, 110, 210), 'dump1': (40, 80, 170), 'dump2': (110, 160, 240),
    'wallG0': (98, 156, 92), 'wallG1': (84, 138, 80), 'wallG2': (122, 178, 110), 'ceilG': (60, 70, 60),
    'shelf0': (180, 128, 76), 'shelf1': (146, 98, 56), 'shelf2': (210, 160, 104),
    'pack0': (110, 200, 196), 'pack1': (80, 160, 160), 'pack2': (170, 232, 228), 'hdr': (240, 110, 40),
    'plank0': (170, 116, 70), 'plank1': (150, 100, 58), 'plank2': (190, 136, 86),
    'glassC': (170, 220, 230), 'glassC2': (130, 190, 204), 'glassC3': (210, 240, 246),
    'reg0': (40, 90, 200), 'reg1': (28, 64, 150), 'reg2': (100, 150, 240), 'tan': (232, 196, 140),
})
T.FONT.update({
    "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
    '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'], 'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'], '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '.': ['.....'] * 6 + ['..#..'], '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'], 'J': ['....#', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
    'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
})
rng = random.Random(507)
tw = T.text_width


# ---------------------------------------------------------------- back layer
def draw_back(b):
    for y in range(0, STREET):
        b.rect(0, y, INDOOR, y + 1, 'sky0' if y < 40 else 'sky1' if y < 80 else 'sky2')
    for cx, cy, s in [(80, 18, 1.0), (380, 12, 1.2), (700, 20, 0.9), (1000, 10, 1.1)]:
        for dx, dy, r in [(0, 6, 10), (12, 0, 13), (28, 4, 11), (40, 8, 8)]:
            rr = int(r * s); x, y = cx + int(dx * s), cy + int(dy * s)
            b.ellipse(x - rr, y - rr + 2, x + rr, y + rr + 2, 'cloudsh'); b.ellipse(x - rr, y - rr, x + rr, y + rr - 2, 'cloud')
    x = -10   # treetops peeking over the roofs
    while x < INDOOR:
        r = rng.randint(10, 18); top = 52 - r
        b.ellipse(x, top, x + 2 * r, top + 2 * r, 'tree0'); b.ellipse(x + 4, top + 2, x + 2 * r - 6, top + r + 2, 'tree1')
        x += r + rng.randint(10, 30)
    b.rect(0, 50, INDOOR, STREET, 'tree0')
    # sidewalk slabs, curb, street
    b.rect(0, STREET, INDOOR, CURB, 'walk0'); b.rect(0, STREET, INDOOR, STREET + 2, 'curbtop')
    for x in range(0, INDOOR, 56): b.line(x, STREET + 2, x + 14, CURB - 1, 'walk1')
    b.rect(0, 168, INDOOR, 169, 'walk1')
    b.rect(0, CURB, INDOOR, CURB + 2, 'curbtop'); b.rect(0, CURB + 2, INDOOR, CURB + 6, 'curb')
    b.rect(0, CURB + 6, INDOOR, H, 'road0')
    for i in range(2200):
        b.dot(rng.randrange(INDOOR), rng.randrange(CURB + 6, H), rng.choice(['road1', 'road2']))
    for x in range(0, INDOOR, 64): b.rect(x, 236, x + 34, 239, 'paintY')
    # litter: a dropped comic on the sidewalk
    b.rect(470, 176, 482, 184, 'white'); b.rect(472, 178, 480, 182, 'cb1')
    draw_shop_back(b)


def figure_pack(b, x, y, k):
    """One boxed action figure: orange header card, teal blister with a little figure inside."""
    b.rect(x, y, x + 14, y + 20, 'pack1'); b.rect(x + 1, y + 1, x + 13, y + 19, 'pack0'); b.rect(x, y, x + 14, y + 4, 'hdr')
    b.dot(x + 7, y + 1, 'black')
    col = ['cb0', 'cb1', 'cb2', 'cb3', 'cb4', 'robot1'][k % 6]
    b.ellipse(x + 5, y + 5, x + 9, y + 9, 'tan'); b.rect(x + 4, y + 9, x + 10, y + 15, col); b.rect(x + 5, y + 15, x + 7, y + 18, 'navy'); b.rect(x + 8, y + 15, x + 10, y + 18, 'navy')
    b.line(x + 2, y + 17, x + 4, y + 6, 'pack2')


def draw_shop_back(b):
    x0 = INDOOR
    b.rect(x0, 0, W, 14, 'ceilG')
    for x in range(x0 + 30, W, 120): b.rect(x, 4, x + 50, 9, 'light')
    b.rect(x0, 14, W, FLOOR, 'wallG0'); b.rect(x0, 14, W, 18, 'wallG1')
    for x in range(x0, W, 48): b.rect(x, 18, x + 1, FLOOR, 'wallG1')
    # back-room doorway
    dx = x0 + 230
    b.rect(dx - 4, 40, dx + 44, FLOOR, 'wallG2'); b.rect(dx, 44, dx + 40, FLOOR, 'shopdk'); b.rect(dx + 4, 60, dx + 12, FLOOR, 'shoplt')
    b.rect(dx + 34, 90, dx + 37, 94, 'gold')
    # shelving walls full of boxed figures
    for sx0, sx1 in ((x0 + 16, x0 + 222), (x0 + 286, x0 + 470)):
        b.rect(sx0 - 4, 24, sx1 + 4, FLOOR - 6, 'shelf1')
        k = 0
        for y in (28, 56, 84):
            for x in range(sx0, sx1 - 12, 16): figure_pack(b, x, y, k + (y // 28)); k += 1
            b.rect(sx0 - 4, y + 22, sx1 + 4, y + 26, 'shelf0'); b.rect(sx0 - 4, y + 22, sx1 + 4, y + 23, 'shelf2')
        b.rect(sx0 - 4, 110, sx1 + 4, FLOOR - 6, 'shelf0')
        for x in range(sx0, sx1, 22): b.rect(x, 114, x + 18, FLOOR - 8, 'shelf1')
    # posters and the pennant on the far wall
    px = W - 66
    b.rect(px, 24, px + 50, 92, 'black'); b.rect(px + 2, 26, px + 48, 90, 'navy')
    b.ellipse(px + 14, 36, px + 36, 58, 'yellow'); b.poly([(px + 25, 56), (px + 12, 86), (px + 38, 86)], 'red')
    b.text(px + 25 - tw('X') // 2, 64, 'X', 'yellow')
    pn = dx - 14
    b.poly([(pn, 34), (pn + 70, 27), (pn, 20)], 'white'); b.rect(pn - 4, 18, pn, 36, 'brown')
    b.text(pn + 4, 24, 'GO TOPE', 'navy')
    # plank floor
    b.rect(x0, FLOOR, W, H, 'plank0')
    for y in range(FLOOR, H, 10):
        b.rect(x0, y, W, y + 1, 'plank1')
        for x in range(x0 + (y // 10 % 3) * 26, W, 78): b.rect(x, y, x + 1, y + 10, 'plank1')
    for y in range(FLOOR + 4, H, 30): b.rect(x0, y, W, y + 2, 'plank2')
    b.rect(x0, FLOOR - 2, W, FLOOR, 'gtrim')
    b.rect(x0, 0, x0 + 8, H, 'gtrim')   # door frame between the street and the shop


# ---------------------------------------------------------------- front layer
def red_brick(f, x0, y0, x1, y1):
    T.brick_wall(f, x0, y0, x1, y1)


def green_brick(f, x0, y0, x1, y1):
    f.rect(x0, y0, x1, y1, 'gmort')
    for row, y in enumerate(range(y0, y1, 6)):
        off = 0 if row % 2 else 6
        for x in range(x0 - off, x1, 12):
            c = 'gbr0' if (x // 12 + row) % 5 else 'gbr1'
            if (x * 5 + row * 7) % 13 == 0: c = 'gbr2'
            f.rect(max(x, x0), y, min(x + 11, x1), min(y + 5, y1), c)


def awning(f, x0, x1, y):
    stripe = 16
    for i, x in enumerate(range(x0, x1, stripe)):
        c = 'aw0' if i % 2 == 0 else 'aw1'
        f.poly([(x + 6, y), (x + stripe + 6, y), (x + stripe, y + 18), (x, y + 18)], c)
        f.ellipse(x, y + 12, x + stripe, y + 26, c)
        f.rect(x, y + 18, x + stripe, y + 19, 'aw2' if c == 'aw0' else 'awS')
    f.rect(x0 + 6, y - 2, x1 + 6, y, 'aw2')
    for ax in (x0 + 4, x1 - 4):  # support arms
        f.line(ax, y + 22, ax - 10, y + 44, 'metal1'); f.line(ax + 1, y + 22, ax - 9, y + 44, 'metal1')


def robot(f, x, y):
    """The cardboard robot cutout waving in the window."""
    f.rect(x + 6, y, x + 26, y + 16, 'robot0'); f.outline(x + 6, y, x + 26, y + 16, 'robot2')
    f.ellipse(x + 9, y + 4, x + 15, y + 10, 'white'); f.ellipse(x + 17, y + 4, x + 23, y + 10, 'white')
    f.dot(x + 12, y + 7, 'robotE'); f.dot(x + 20, y + 7, 'robotE'); f.rect(x + 11, y + 12, x + 21, y + 14, 'robot2')
    f.rect(x + 14, y - 5, x + 18, y, 'robot1'); f.dot(x + 16, y - 6, 'robotE')
    f.rect(x + 4, y + 18, x + 28, y + 40, 'robot0'); f.outline(x + 4, y + 18, x + 28, y + 40, 'robot2')
    f.rect(x + 9, y + 22, x + 23, y + 30, 'robot1'); f.dot(x + 11, y + 24, 'robotE'); f.dot(x + 15, y + 24, 'robotB'); f.dot(x + 19, y + 24, 'cb2')
    f.rect(x + 4, y + 36, x + 28, y + 38, 'cb2')
    f.rect(x - 6, y + 10, x + 4, y + 16, 'robot1'); f.rect(x - 8, y, x - 2, y + 12, 'robot1')   # raised arm
    f.rect(x + 28, y + 20, x + 38, y + 26, 'robot1'); f.rect(x + 34, y + 26, x + 40, y + 36, 'robot1')
    f.rect(x + 7, y + 40, x + 13, y + 46, 'robot1'); f.rect(x + 19, y + 40, x + 25, y + 46, 'robot1')
    f.rect(x + 4, y + 45, x + 14, y + 49, 'robotB'); f.rect(x + 18, y + 45, x + 28, y + 49, 'robotB')


def comic(f, x, y, k):
    cols = ['cb0', 'cb1', 'cb2', 'cb3', 'cb4']
    f.rect(x, y, x + 14, y + 18, 'white'); f.rect(x + 1, y + 1, x + 13, y + 5, cols[k % 5]); f.rect(x + 2, y + 7, x + 12, y + 17, cols[(k + 2) % 5])
    f.ellipse(x + 4, y + 8, x + 10, y + 14, 'tan')


def shop_front(f, x0, x1):
    top = 12
    green_brick(f, x0, top, x1, STREET)
    f.rect(x0 - 4, top - 6, x1 + 4, top, 'gtrim'); f.rect(x0 - 4, top - 2, x1 + 4, top, 'gbr2')
    f.rect(x0, top, x0 + 6, STREET, 'gtrim'); f.rect(x1 - 6, top, x1, STREET, 'gtrim')
    # sign: THE ANDROID'S DUNGEON / & BASEBALL CARD SHOP
    sx0, sx1 = x0 + 18, x1 - 18
    f.rect(sx0 - 3, top + 4, sx1 + 3, top + 46, 'signF'); f.rect(sx0, top + 7, sx1, top + 43, 'sign')
    cx = (sx0 + sx1) // 2
    for i, line in enumerate(("THE ANDROID'S DUNGEON", '& BASEBALL CARD SHOP')):
        f.text(cx - tw(line, 2) // 2, top + 10 + i * 17, line, 'signR', scale=2)
    # display window with the robot, speech bubble and comics on a ledge
    wx0, wx1, wy0, wy1 = x0 + 16, x0 + 214, 86, 140
    f.rect(wx0 - 4, wy0 - 4, wx1 + 4, wy1 + 2, 'gtrim'); f.rect(wx0, wy0, wx1, wy1, 'glass0')
    for x in range(wx0 + 6, wx1, 24): f.rect(x, wy0 + 2, x + 18, wy0 + 30, 'glass2')   # shelves seen through the glass
    f.rect(wx0, wy1 - 12, wx1, wy1, 'ledge'); f.rect(wx0, wy1 - 12, wx1, wy1 - 11, 'shelf2')
    for k, x in enumerate(range(wx0 + 8, wx0 + 140, 22)): comic(f, x, wy1 - 26, k)
    robot(f, wx0 + 150, wy0 + 6)
    bx, by = wx0 + 10, wy0 + 6
    f.ellipse(bx - 2, by - 2, bx + 122, by + 34, 'black'); f.ellipse(bx, by, bx + 120, by + 32, 'bubble')
    f.poly([(bx + 108, by + 20), (bx + 128, by + 14), (bx + 112, by + 28)], 'bubble')
    for i, line in enumerate(('"TAKE ME TO YOUR', 'COMIC BOOKS!"')): f.text(bx + 60 - tw(line) // 2, by + 7 + i * 10, line, 'black')
    for x in (wx0 + 40, wx0 + 150): f.line(x, wy1 - 14, x + 16, wy0 + 2, 'glass1')
    # glass door with OPEN sign; 507 plaque
    dx0, dx1 = x0 + 226, x0 + 268
    f.rect(dx0 - 3, 80, dx1 + 3, STREET, 'black'); f.rect(dx0, 83, dx1, STREET, 'glass0')
    f.line(dx0 + 4, 130, dx0 + 20, 96, 'glass1'); f.rect(dx0 + 2, 116, dx0 + 6, 120, 'metal0')
    f.rect(dx0 + 5, 100, dx1 - 5, 112, 'white'); f.outline(dx0 + 5, 100, dx1 - 5, 112, 'black')
    f.text((dx0 + dx1) // 2 - tw('OPEN') // 2, 103, 'OPEN', 'orange')
    f.rect(dx1 + 8, 96, dx1 + 30, 108, 'sign'); f.outline(dx1 + 8, 96, dx1 + 30, 108, 'black'); f.text(dx1 + 9, 99, '507', 'black')
    awning(f, x0 + 8, x1 - 10, 60)
    # box of comics on the sidewalk by the wall
    f.rect(x0 - 26, 128, x0 - 2, 144, 'wood1'); f.rect(x0 - 26, 128, x0 - 2, 130, 'wood2')
    for k, x in enumerate(range(x0 - 24, x0 - 4, 4)): f.rect(x, 120 + k % 2 * 2, x + 3, 130, ['cb0', 'cb1', 'cb2', 'cb3', 'cb4'][k % 5])


def neighbour(f, x0, x1, top, curtain=False, sign=None):
    red_brick(f, x0, top, x1, STREET)
    f.rect(x0 - 2, top - 6, x1 + 2, top, 'stone1'); f.rect(x0 - 2, top - 6, x1 + 2, top - 4, 'stone0')
    for x in range(x0 + 16, x1 - 50, 64):
        T.window(f, x, top + 16, w=40, h=26)
    if curtain:   # big shop window with a pink curtain, like the store next door
        wx0, wx1 = x0 + 20, x1 - 20
        f.rect(wx0 - 4, 86, wx1 + 4, 136, 'frame'); f.rect(wx0, 90, wx1, 132, 'glass0')
        for x in range(wx0, wx1, 6): f.rect(x, 110, x + 4, 132, 'curtain'); f.rect(x + 4, 110, x + 6, 132, 'curtain2')
        f.rect(wx0, 108, wx1, 110, 'metal1'); f.line(wx0 + 6, 106, wx0 + 26, 92, 'glass1')
    if sign:
        f.rect(x0 + 20, top + 50, x0 + 20 + tw(sign) + 12, top + 64, 'navy'); f.text(x0 + 26, top + 54, sign, 'white')
    f.rect(x0, STREET - 6, x1, STREET, 'stone1')


def dumpster(f, x):
    f.rect(x, 108, x + 54, 140, 'dump0'); f.rect(x - 2, 102, x + 56, 110, 'dump1'); f.rect(x + 2, 104, x + 54, 106, 'dump2')
    for k in range(3): f.rect(x + 6 + k * 16, 114, x + 14 + k * 16, 134, 'dump1')
    f.ellipse(x + 4, 136, x + 12, 144, 'tire'); f.ellipse(x + 42, 136, x + 50, 144, 'tire')


def draw_front(f):
    neighbour(f, 0, 300, 20, sign='LAUNDROMAT')
    shop_front(f, 330, 650)
    neighbour(f, 680, 1000, 40, curtain=True)
    # alley with a dumpster and a wall of flyers
    f.rect(1000, 60, 1018, STREET, 'mortar'); red_brick(f, 1018, 60, 1240, STREET)
    f.rect(1016, 54, 1242, 60, 'stone1')
    for k, (px, py) in enumerate([(1120, 78), (1150, 72), (1182, 84)]):
        f.rect(px, py, px + 24, py + 30, ['white', 'glass1', 'cb2'][k]); f.rect(px + 4, py + 4, px + 20, py + 12, ['cb4', 'cb1', 'cb0'][k])
    f.rect(1210, 74, 1236, 108, 'navy'); f.ellipse(1214, 78, 1232, 96, 'yellow'); f.rect(1216, 94, 1230, 106, 'red')  # comic hero poster
    dumpster(f, 1040)
    # gaps between buildings
    for gx in (300, 650, 1000): f.rect(gx, 70, gx + (30 if gx < 1000 else 0), 74, 'stone1')
    draw_shop_front(f)


def counter(f, x0, x1):
    top, bot = 92, FLOOR + 14
    f.rect(x0, top, x1, bot, 'glassC2'); f.rect(x0 + 3, top + 3, x1 - 3, bot - 6, 'glassC')
    f.rect(x0, top, x1, top + 3, 'glassC3'); f.rect(x0, (top + bot) // 2, x1, (top + bot) // 2 + 2, 'glassC2')
    f.rect(x0, bot - 6, x1, bot, 'shelf1')
    k = 0
    for x in range(x0 + 10, x1 - 80, 22):     # figurines on the top shelf, boxes on the bottom
        col = ['cb0', 'cb1', 'cb3', 'robot1', 'cb4'][k % 5]; k += 1
        f.ellipse(x + 2, top + 8, x + 8, top + 14, 'tan'); f.rect(x + 1, top + 14, x + 9, top + 22, col); f.rect(x + 2, top + 22, x + 4, top + 26, 'navy'); f.rect(x + 6, top + 22, x + 8, top + 26, 'navy')
        f.rect(x, (top + bot) // 2 + 6, x + 16, (top + bot) // 2 + 16, ['cb2', 'pack0', 'cb0'][k % 3])
    f.ellipse(x1 - 70, top + 8, x1 - 20, top + 20, 'metal0'); f.ellipse(x1 - 60, top + 4, x1 - 30, top + 14, 'metal1')  # flying saucer
    for x in range(x0 + 12, x1, 40): f.line(x, bot - 8, x + 14, top + 5, 'glassC3')
    # the blue register on top
    rx = x0 + 40
    f.rect(rx, top - 26, rx + 40, top, 'reg0'); f.rect(rx + 4, top - 22, rx + 36, top - 14, 'reg1'); f.rect(rx + 8, top - 20, rx + 30, top - 16, 'crt' if 'crt' in T.C else 'black')
    f.rect(rx - 4, top - 6, rx + 44, top, 'reg1'); f.rect(rx + 2, top - 26, rx + 38, top - 24, 'reg2')


def rack(f, x):
    """A spinner-style comic rack: three tiers of comics."""
    f.rect(x + 22, 62, x + 26, FLOOR + 10, 'metal1')
    for r, y in enumerate((62, 84, 106)):
        f.rect(x, y + 20, x + 48, y + 22, 'metal0')
        for k in range(3): comic(f, x + 2 + k * 16, y, r * 3 + k)
    f.rect(x + 12, FLOOR + 8, x + 36, FLOOR + 12, 'metal2')


def longbox(f, x, y):
    f.rect(x, y, x + 36, y + 16, 'white'); f.rect(x, y, x + 36, y + 3, 'stone1'); f.text(x + 4, y + 6, 'BACK', 'black')


def draw_shop_front(f):
    x0 = INDOOR
    rack(f, x0 + 30)
    longbox(f, x0 + 96, FLOOR - 8); longbox(f, x0 + 134, FLOOR - 8); longbox(f, x0 + 115, FLOOR - 22)
    counter(f, x0 + 330, x0 + 520)
    f.rect(x0 + 300, 20, x0 + 470, 34, 'black'); f.text(x0 + 385 - tw('NEW ISSUES WED.') // 2, 24, 'NEW ISSUES WED.', 'cb2')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--preview'); a = ap.parse_args()
    back, front = T.Canvas(), T.Canvas()
    draw_back(back); draw_front(front)
    pal, layers = T.pack([back.im, front.im])
    doc = {
        'id': 'android', 'name': "The Android's Dungeon", 'scene': 2, 'st': 0x82, 'area': 0, 'cols': W // CELL, 'rows': H // CELL,
        'groups': [{'name': 'Street', 'from': 0, 'to': INDOOR // CELL}, {'name': 'Shop interior', 'from': INDOOR // CELL, 'to': W // CELL}],
        'palette': pal, 'layers': layers,
    }
    out = os.path.join(ROOT, 'web', 'custom', 'tileset_android.js')
    with open(out, 'w', newline='\n') as fh:
        fh.write("// Generated by tools/build_tileset_android.py: original Android's Dungeon background art (no ROM data).\n")
        fh.write('(function(G){(G.SIMPTILESETS=G.SIMPTILESETS||{}).android=' + json.dumps(doc, separators=(',', ':')) + ';'
                 "if(typeof module!=='undefined'&&module.exports)module.exports=G.SIMPTILESETS.android;})(typeof window!=='undefined'?window:globalThis);\n")
    print(f'{out}: {len(pal) // 3 - 1} colours, blocks back={layers[0]["count"]} front={layers[1]["count"]}, {os.path.getsize(out)} bytes')
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        img = Image.new('RGBA', (W, H), (40, 40, 60, 255)); img.alpha_composite(back.im); img.alpha_composite(front.im)
        img = img.convert('RGB'); img.save(os.path.join(a.preview, 'android_composite.png'))
        for i, (x0, x1) in enumerate([(0, 700), (600, 1300), (1200, 1792)]):
            img.crop((x0, 0, x1, H)).resize(((x1 - x0) * 2, H * 2), Image.NEAREST).save(os.path.join(a.preview, f'android_part{i}.png'))


if __name__ == '__main__':
    main()
