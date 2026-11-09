#!/usr/bin/env python3
"""Draw the original Springfield Elementary background art and pack it as a custom stage tileset.

The art is drawn procedurally at native resolution (1 px = 1 game pixel) as two layers that follow the layout of
the stage slot it replaces (Stage 1: 56 columns x 8 rows of 32x32 blocks, walkable ground in rows 4-7):
  back  (layer 0): sky, distant trees, lawn, sidewalk and schoolyard blacktop; hallway wall and floor indoors
  front (layer 1): school building, sign, bus, gym, fence, playground, lockers and classroom doors (transparent gaps)
Each layer is cut into 32x32 blocks, identical blocks are shared, and the result is written as
web/custom/tileset_school.js (window.SIMPTILESETS.school). No ROM data is read or embedded.

Usage: python tools/build_tileset_school.py [--preview DIR]
"""
import argparse, base64, json, os, random, zlib
from PIL import Image, ImageDraw

W, H, CELL = 1792, 256, 32
INDOOR = 1248  # the hallway starts here (the original stage's bridge section)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

C = {
    'sky0': (118, 186, 240), 'sky1': (142, 200, 244), 'sky2': (168, 214, 248), 'cloud': (250, 250, 255), 'cloudsh': (206, 222, 240),
    'tree0': (40, 110, 60), 'tree1': (60, 140, 72), 'tree2': (88, 168, 84), 'trunk': (110, 74, 44),
    'grass0': (72, 160, 64), 'grass1': (96, 184, 76), 'grass2': (54, 128, 52),
    'walk0': (214, 214, 206), 'walk1': (186, 186, 178), 'curb': (150, 150, 146), 'curbtop': (236, 236, 228),
    'tar0': (92, 94, 102), 'tar1': (82, 84, 92), 'tar2': (104, 106, 114), 'paintY': (240, 204, 64), 'paintW': (236, 236, 236),
    'brick0': (178, 72, 52), 'brick1': (156, 60, 46), 'brick2': (198, 92, 64), 'mortar': (204, 176, 150),
    'stone0': (226, 214, 186), 'stone1': (196, 182, 150), 'stone2': (160, 146, 118),
    'frame': (244, 240, 230), 'glass0': (150, 208, 236), 'glass1': (196, 232, 248), 'glass2': (96, 160, 200),
    'door0': (40, 132, 132), 'door1': (28, 104, 108), 'metal0': (176, 182, 190), 'metal1': (128, 134, 144), 'metal2': (84, 90, 100),
    'red': (214, 52, 48), 'orange': (240, 140, 40), 'yellow': (252, 214, 56), 'green': (74, 176, 74), 'blue': (60, 110, 210), 'purple': (150, 84, 190),
    'pink': (240, 150, 180), 'white': (255, 255, 255), 'black': (24, 24, 30), 'navy': (34, 48, 96), 'brown': (120, 80, 48),
    'bus0': (250, 190, 30), 'bus1': (216, 150, 20), 'bus2': (172, 112, 16), 'tire': (40, 40, 44), 'hub': (170, 170, 176),
    'gym0': (220, 196, 150), 'gym1': (198, 172, 126), 'gym2': (170, 144, 100), 'fence0': (190, 196, 200), 'fence1': (140, 146, 152),
    'wall0': (238, 226, 190), 'wall1': (220, 206, 166), 'wall2': (120, 170, 160), 'ceil0': (232, 232, 224), 'ceil1': (206, 206, 196), 'light': (255, 255, 236),
    'floor0': (226, 220, 200), 'floor1': (96, 160, 150), 'floor2': (200, 194, 172), 'base': (70, 96, 92),
    'locker0': (86, 128, 196), 'locker1': (64, 100, 166), 'locker2': (120, 160, 220), 'wood0': (176, 120, 70), 'wood1': (146, 96, 54), 'wood2': (204, 150, 96),
    'cork': (196, 150, 96), 'gold': (240, 196, 60), 'gold1': (196, 150, 40),
}
FONT = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], 'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], 'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], 'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'], 'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'], 'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'], 'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'], 'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'], 'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], 'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], 'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'], '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'], '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    ' ': ['.....'] * 7,
}


class Canvas:
    def __init__(self):
        self.im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); self.px = self.im.load(); self.d = ImageDraw.Draw(self.im)

    def rect(self, x0, y0, x1, y1, c):  # half-open box
        if x1 > x0 and y1 > y0: self.d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=C[c] + (255,))

    def outline(self, x0, y0, x1, y1, c):
        self.d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=C[c] + (255,))

    def dot(self, x, y, c):
        if 0 <= x < W and 0 <= y < H: self.px[x, y] = C[c] + (255,)

    def line(self, x0, y0, x1, y1, c):
        self.d.line([x0, y0, x1, y1], fill=C[c] + (255,))

    def ellipse(self, x0, y0, x1, y1, c):
        self.d.ellipse([x0, y0, x1 - 1, y1 - 1], fill=C[c] + (255,))

    def poly(self, pts, c):
        self.d.polygon(pts, fill=C[c] + (255,))

    def text(self, x, y, s, c, scale=1):
        for ch in s:
            g = FONT[ch]
            for gy, row in enumerate(g):
                for gx, v in enumerate(row):
                    if v == '#': self.rect(x + gx * scale, y + gy * scale, x + (gx + 1) * scale, y + (gy + 1) * scale, c)
            x += 6 * scale
        return x

    def clear(self, x0, y0, x1, y1):
        self.d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(0, 0, 0, 0))


def text_width(s, scale=1): return len(s) * 6 * scale - scale


rng = random.Random(1989)


# ---------------------------------------------------------------- back layer
def draw_back(b):
    # sky bands and clouds
    for y in range(0, 128):
        b.rect(0, y, INDOOR, y + 1, 'sky0' if y < 40 else 'sky1' if y < 84 else 'sky2')
    for cx, cy, s in [(60, 30, 1.0), (300, 22, 1.3), (560, 40, 0.9), (820, 18, 1.2), (1080, 34, 1.0)]:
        for dx, dy, r in [(0, 6, 10), (12, 0, 13), (28, 4, 11), (40, 8, 8)]:
            rr = int(r * s); x, y = cx + int(dx * s), cy + int(dy * s)
            b.ellipse(x - rr, y - rr + 2, x + rr, y + rr + 2, 'cloudsh'); b.ellipse(x - rr, y - rr, x + rr, y + rr - 2, 'cloud')
    # distant tree line
    x = -10
    while x < INDOOR:
        r = rng.randint(12, 20); top = 104 - r
        b.ellipse(x, top, x + 2 * r, top + 2 * r, 'tree0'); b.ellipse(x + 4, top + 2, x + 2 * r - 6, top + r + 4, 'tree1')
        x += r + rng.randint(4, 14)
    b.rect(0, 112, INDOOR, 128, 'tree0')
    # lawn
    b.rect(0, 128, INDOOR, 144, 'grass0')
    for i in range(500):
        x, y = rng.randrange(INDOOR), rng.randrange(128, 144); b.dot(x, y, rng.choice(['grass1', 'grass2']))
    # sidewalk with slab joints and a curb
    b.rect(0, 144, INDOOR, 172, 'walk0'); b.rect(0, 144, INDOOR, 146, 'curbtop')
    for x in range(0, INDOOR, 48):
        b.line(x, 146, x + 10, 171, 'walk1')
    b.rect(0, 172, INDOOR, 174, 'curbtop'); b.rect(0, 174, INDOOR, 178, 'curb')
    # blacktop schoolyard
    b.rect(0, 178, INDOOR, 256, 'tar0')
    for i in range(2600):
        x, y = rng.randrange(INDOOR), rng.randrange(178, 256); b.dot(x, y, rng.choice(['tar1', 'tar2']))
    # bus loading zone: yellow curb paint and a lane line
    b.rect(780, 174, 1000, 178, 'paintY')
    for x in range(0, INDOOR, 40): b.rect(x, 216, x + 22, 218, 'paintW')
    # hopscotch
    hx, hy = 250, 186
    for i, (dx, w2) in enumerate([(0, 1), (16, 2), (40, 1), (56, 2), (80, 1), (96, 1)]):
        if w2 == 1: b.outline(hx + dx, hy + 8, hx + dx + 16, hy + 24, 'paintW')
        else: b.outline(hx + dx, hy, hx + dx + 24, hy + 16, 'paintW'); b.outline(hx + dx, hy + 16, hx + dx + 24, hy + 32, 'paintW')
    for i, n in enumerate('123456'):
        b.text(hx + [5, 22, 45, 62, 85, 101][i], hy + [12, 4, 12, 4, 12, 12][i], n, 'paintY')
    # four-square court
    fx, fy = 640, 182
    b.outline(fx, fy, fx + 64, fy + 64, 'paintY'); b.line(fx + 32, fy, fx + 32, fy + 63, 'paintY'); b.line(fx, fy + 32, fx + 63, fy + 32, 'paintY')
    for i, n in enumerate('1234'):
        b.text(fx + 13 + 32 * (i % 2), fy + 12 + 32 * (i // 2), n, 'paintW')
    # storm drain
    b.rect(1100, 176, 1124, 184, 'metal2')
    for x in range(1102, 1124, 4): b.rect(x, 177, x + 2, 183, 'black')
    draw_hall_back(b)


def draw_hall_back(b):
    x0 = INDOOR
    # ceiling with acoustic tiles and light panels
    b.rect(x0, 0, W, 24, 'ceil0')
    for x in range(x0, W, 32): b.line(x, 0, x, 23, 'ceil1')
    for y in (8, 16): b.line(x0, y, W - 1, y, 'ceil1')
    for x in range(x0 + 40, W, 96): b.rect(x, 4, x + 40, 12, 'light'); b.outline(x, 4, x + 40, 12, 'metal0')
    b.rect(x0, 24, W, 28, 'stone1')
    # wall: cream upper, teal stripe, wainscot
    b.rect(x0, 28, W, 96, 'wall0'); b.rect(x0, 96, W, 100, 'wall2'); b.rect(x0, 100, W, 136, 'wall1')
    for y in range(104, 136, 8):
        for x in range(x0 + (0 if (y // 8) % 2 else 8), W, 16): b.line(x, y, x, y + 7, 'wall0')
        b.line(x0, y, W - 1, y, 'wall0')
    b.rect(x0, 136, W, 144, 'base')
    # floor: checker linoleum with a polished highlight stripe
    for y in range(144, 256, 16):
        for x in range(x0, W, 16):
            b.rect(x, y, x + 16, y + 16, 'floor1' if ((x - x0) // 16 + y // 16) % 2 else 'floor0')
    for x in range(x0, W, 16): b.line(x, 144, x, 255, 'floor2')
    b.rect(x0, 196, W, 198, 'floor2')
    # transition: doorway frame between the yard and the hall
    b.rect(x0, 0, x0 + 8, 256, 'brick1')


# ---------------------------------------------------------------- front layer
def brick_wall(f, x0, y0, x1, y1):
    f.rect(x0, y0, x1, y1, 'mortar')
    for row, y in enumerate(range(y0, y1, 6)):
        off = 0 if row % 2 else 6
        for x in range(x0 - off, x1, 12):
            c = 'brick0' if (x // 12 + row) % 5 else 'brick1'
            if (x * 7 + row * 3) % 11 == 0: c = 'brick2'
            f.rect(max(x, x0), y, min(x + 11, x1), min(y + 5, y1), c)


def window(f, x, y, w=36, h=30, art=None):
    f.rect(x - 2, y - 2, x + w + 2, y + h + 4, 'frame'); f.rect(x, y, x + w, y + h, 'glass0')
    f.line(x + 2, y + h - 4, x + 10, y + 4, 'glass1'); f.line(x + 3, y + h - 4, x + 11, y + 4, 'glass1')
    f.rect(x + w // 2 - 1, y, x + w // 2 + 1, y + h, 'frame'); f.rect(x, y + h // 2 - 1, x + w, y + h // 2 + 1, 'frame')
    f.rect(x - 3, y + h + 2, x + w + 3, y + h + 5, 'stone1')
    if art == 'apple':
        f.ellipse(x + 22, y + 3, x + 32, y + 13, 'red'); f.rect(x + 26, y + 1, x + 28, y + 4, 'brown'); f.rect(x + 28, y + 2, x + 31, y + 4, 'green')
    elif art == 'star':
        f.poly([(x + 8, y + 17), (x + 10, y + 22), (x + 15, y + 22), (x + 11, y + 25), (x + 13, y + 30), (x + 8, y + 27), (x + 3, y + 30), (x + 5, y + 25), (x + 1, y + 22), (x + 6, y + 22)], 'yellow')
    elif art == 'sun':
        f.ellipse(x + 23, y + 18, x + 33, y + 28, 'orange'); f.rect(x + 27, y + 16, x + 29, y + 30, 'yellow'); f.rect(x + 21, y + 22, x + 35, y + 24, 'yellow')
    elif art == 'blinds':
        for yy in range(y + 1, y + h, 3): f.line(x, yy, x + w - 1, yy, 'frame')


def shrub(f, x, y, w):
    f.ellipse(x, y, x + w, y + 22, 'tree0'); f.ellipse(x + 3, y + 2, x + w - 3, y + 14, 'tree1'); f.ellipse(x + 6, y + 3, x + w // 2, y + 9, 'tree2')


def draw_front(f):
    # --- welcome sign and flagpole on the lawn (x 0..96)
    f.rect(6, 118, 90, 144, 'stone2'); brick_wall(f, 8, 120, 88, 144)
    f.rect(4, 70, 92, 120, 'navy'); f.rect(7, 73, 89, 117, 'white'); f.rect(4, 66, 92, 70, 'stone1')
    f.text(48 - text_width('WELCOME') // 2, 78, 'WELCOME', 'navy')
    f.text(48 - text_width('STUDENTS') // 2, 90, 'STUDENTS', 'red')
    f.text(48 - text_width('2026') // 2, 103, '2026', 'navy')
    for x in (14, 30, 50, 70): f.ellipse(x, 136, x + 10, 146, 'grass2'); f.dot(x + 5, 139, 'red'); f.dot(x + 3, 141, 'yellow')
    # --- main building (x 96..776)
    bx0, bx1, top = 96, 776, 26
    brick_wall(f, bx0, top + 8, bx1, 144)
    f.rect(bx0 - 4, top, bx1 + 4, top + 8, 'stone0'); f.rect(bx0 - 4, top + 6, bx1 + 4, top + 8, 'stone1')
    f.rect(bx0, 128, bx1, 144, 'stone1'); f.rect(bx0, 128, bx1, 130, 'stone0')
    arts = ['apple', None, 'star', 'blinds', None, 'sun', None, 'apple', 'blinds', 'star', None, 'sun']
    i = 0
    for x in range(bx0 + 14, bx1 - 40, 56):
        if 350 <= x <= 500: continue  # entrance
        window(f, x, 44, art=arts[i % len(arts)]); window(f, x, 88, art=arts[(i + 3) % len(arts)]); i += 1
    # entrance portal with the school name, clock, bell tower and doors
    ex0, ex1 = 360, 520
    f.rect(ex0 - 6, top - 4, ex1 + 6, 144, 'stone1'); f.rect(ex0 - 4, top - 2, ex1 + 4, 144, 'stone0')
    for x in (ex0 - 4, ex1 - 4):
        f.rect(x, 64, x + 8, 136, 'stone1'); f.rect(x + 2, 64, x + 4, 136, 'stone0')
    name = 'SPRINGFIELD ELEMENTARY'
    f.rect(ex0 + 2, 66, ex1 - 2, 80, 'navy'); f.text((ex0 + ex1) // 2 - text_width(name) // 2, 70, name, 'yellow')
    cx = (ex0 + ex1) // 2
    f.ellipse(cx - 13, 34, cx + 13, 60, 'stone2'); f.ellipse(cx - 11, 36, cx + 11, 58, 'white')
    for a, (dx, dy) in enumerate([(0, -9), (9, 0), (0, 9), (-9, 0)]): f.dot(cx + dx, 47 + dy, 'black')
    f.line(cx, 47, cx, 40, 'black'); f.line(cx, 47, cx + 6, 47, 'black')
    # bell tower above the entrance
    f.rect(cx - 18, 0, cx + 18, top - 4, 'frame'); f.rect(cx - 14, 6, cx + 14, top - 4, 'stone2')
    f.ellipse(cx - 7, 8, cx + 7, 22, 'gold'); f.rect(cx - 8, 18, cx + 8, 20, 'gold1')
    f.poly([(cx - 22, 2), (cx, -12), (cx + 22, 2)], 'brick1'); f.rect(cx - 22, 0, cx + 22, 3, 'brick1')
    # doors
    f.rect(cx - 36, 84, cx + 36, 136, 'stone2')
    for dx in (-34, 1):
        f.rect(cx + dx, 86, cx + dx + 33, 136, 'door0'); f.outline(cx + dx, 86, cx + dx + 33, 136, 'door1')
        f.rect(cx + dx + 6, 92, cx + dx + 27, 110, 'glass0'); f.line(cx + dx + 8, 108, cx + dx + 14, 94, 'glass1')
        f.rect(cx + dx + (26 if dx < 0 else 4), 116, cx + dx + (30 if dx < 0 else 8), 120, 'metal0')
    for k, y in enumerate((136, 140)):  # steps
        f.rect(cx - 44 - 4 * k, y, cx + 44 + 4 * k, y + 4, 'stone0' if k == 0 else 'stone1')
    # shrubs along the base and a bike rack
    for x in range(bx0 + 4, bx1 - 30, 46):
        if ex0 - 40 < x < ex1 + 4: continue
        shrub(f, x, 124, 30)
    rx = 560
    f.rect(rx, 140, rx + 64, 142, 'metal1')
    for x in range(rx + 2, rx + 64, 12): f.outline(x, 126, x + 9, 141, 'metal0')
    f.ellipse(rx + 16, 128, rx + 30, 142, 'tire'); f.ellipse(rx + 18, 130, rx + 28, 140, 'hub'); f.ellipse(rx + 36, 128, rx + 50, 142, 'tire'); f.ellipse(rx + 38, 130, rx + 48, 140, 'hub')
    f.line(rx + 23, 135, rx + 33, 128, 'red'); f.line(rx + 33, 128, rx + 43, 135, 'red'); f.line(rx + 33, 128, rx + 31, 124, 'red'); f.rect(rx + 28, 123, rx + 35, 125, 'black')
    # --- school bus in the loading zone (x 790..990)
    sx = 792
    f.rect(sx, 88, sx + 196, 140, 'bus0'); f.rect(sx, 132, sx + 196, 140, 'bus1'); f.rect(sx + 170, 96, sx + 202, 140, 'bus0')
    f.rect(sx, 86, sx + 196, 90, 'bus1'); f.rect(sx + 196, 120, sx + 204, 140, 'black')
    for x in range(sx + 8, sx + 160, 26): f.rect(x, 96, x + 20, 112, 'glass2'); f.rect(x + 2, 98, x + 18, 110, 'glass0')
    f.rect(sx + 172, 98, sx + 194, 114, 'glass0')
    f.rect(sx, 116, sx + 196, 119, 'black'); f.rect(sx, 124, sx + 196, 126, 'black')
    f.rect(sx + 30, 117, sx + 150, 124, 'bus0')
    f.text(sx + 40, 128 - 10, 'SCHOOL BUS', 'black')
    f.rect(sx + 2, 98, sx + 6, 104, 'red'); f.rect(sx + 198, 108, sx + 204, 114, 'white')
    for wx in (sx + 30, sx + 160):
        f.ellipse(wx - 12, 130, wx + 12, 154, 'tire'); f.ellipse(wx - 6, 136, wx + 6, 148, 'hub'); f.rect(wx - 14, 128, wx + 14, 132, 'bus2')
    # brick wing behind the bus
    brick_wall(f, 776, 50, 1000, 88); f.rect(776, 44, 1000, 50, 'stone0')
    for x in range(784, 990, 40): window(f, x, 58, w=28, h=20, art='blinds' if x % 80 else None)
    f.rect(776, 88, 792, 144, 'mortar'); brick_wall(f, 776, 88, 792, 144); brick_wall(f, 988, 88, 1000, 144)
    # --- gymnasium (x 1000..1248)
    gx0, gx1 = 1000, 1240
    f.rect(gx0, 8, gx1, 144, 'gym0')
    for x in range(gx0, gx1, 20): f.rect(x, 8, x + 2, 144, 'gym1')
    f.rect(gx0, 8, gx1, 14, 'gym2'); f.rect(gx0, 128, gx1, 144, 'gym1')
    for x in range(gx0 + 12, gx1 - 20, 34): f.rect(x, 28, x + 26, 42, 'glass2'); f.rect(x + 2, 30, x + 24, 40, 'glass0')
    f.text(gx0 + 100, 52, 'GYM', 'red', scale=3)
    f.rect(gx0 + 90, 92, gx0 + 150, 140, 'metal1')
    for dx in (92, 121):
        f.rect(gx0 + dx, 94, gx0 + dx + 27, 140, 'metal0'); f.rect(gx0 + dx + 4, 98, gx0 + dx + 23, 110, 'glass0'); f.rect(gx0 + dx + 4, 120, gx0 + dx + 23, 122, 'metal2')
    f.text(gx0 + 18, 100, 'GO', 'navy', scale=2); f.text(gx0 + 170, 100, 'TEAM!', 'navy', scale=1)
    f.ellipse(gx0 + 172, 110, gx0 + 200, 138, 'orange'); f.line(gx0 + 186, 110, gx0 + 186, 137, 'black'); f.line(gx0 + 172, 124, gx0 + 199, 124, 'black')
    # chain-link fence along the lawn in front of the gym
    for x in range(gx0, gx1, 4):
        for y in range(122, 144, 4): f.dot(x + (y // 4) % 2 * 2, y, 'fence1')
    f.rect(gx0, 120, gx1, 122, 'fence0')
    for x in range(gx0, gx1, 40): f.rect(x, 116, x + 3, 144, 'fence1')
    draw_hall_front(f)


def locker_bank(f, x0, x1):
    for x in range(x0, x1, 16):
        f.rect(x, 52, x + 16, 136, 'locker0'); f.rect(x, 52, x + 1, 136, 'locker1'); f.rect(x + 15, 52, x + 16, 136, 'locker1')
        f.rect(x + 1, 52, x + 15, 54, 'locker2')
        for y in (58, 62, 66): f.rect(x + 4, y, x + 12, y + 1, 'locker1')
        for y in (106, 110): f.rect(x + 4, y, x + 12, y + 1, 'locker1')
        f.rect(x + 11, 86, x + 13, 92, 'metal0')
        f.rect(x, 92, x + 16, 94, 'locker1')
    f.rect(x0 - 1, 48, x1 + 1, 52, 'metal1')


def classroom_door(f, x, label):
    f.rect(x - 4, 50, x + 36, 136, 'wood1'); f.rect(x, 54, x + 32, 136, 'wood0')
    f.rect(x + 8, 60, x + 24, 82, 'glass0'); f.line(x + 10, 80, x + 16, 62, 'glass1')
    f.rect(x + 26, 96, x + 30, 100, 'gold'); f.rect(x + 4, 120, x + 28, 122, 'wood2')
    f.rect(x - 2, 38, x + 34, 48, 'white'); f.outline(x - 2, 38, x + 34, 48, 'navy')
    f.text(x + 16 - text_width(label) // 2, 40, label, 'navy')


def bulletin(f, x, w):
    f.rect(x, 50, x + w, 90, 'wood1'); f.rect(x + 2, 52, x + w - 2, 88, 'cork')
    cols = ['white', 'yellow', 'pink', 'glass1', 'green']
    for i, px in enumerate(range(x + 6, x + w - 14, 14)):
        py = 56 + (i * 7) % 14; c = cols[i % len(cols)]
        f.rect(px, py, px + 11, py + 14, c); f.dot(px + 5, py + 1, 'red')
        for ly in range(py + 4, py + 13, 3): f.line(px + 2, ly, px + 8, ly, 'metal1')


def trophy_case(f, x, w):
    f.rect(x, 54, x + w, 136, 'wood1'); f.rect(x + 3, 58, x + w - 3, 128, 'glass0')
    for y in (80, 104): f.rect(x + 3, y, x + w - 3, y + 2, 'wood2')
    for i, tx in enumerate(range(x + 8, x + w - 10, 16)):
        for y in (66, 90, 114):
            s = 6 + (i + y) % 3 * 2
            f.rect(tx, y + 12 - s, tx + 8, y + 12 - s + 6, 'gold'); f.rect(tx + 3, y + 10 - s + 6, tx + 5, y + 10, 'gold1'); f.rect(tx + 1, y + 10, tx + 7, y + 12, 'gold1')
    f.rect(x + w // 2 - 24, 44, x + w // 2 + 24, 54, 'navy'); f.text(x + w // 2 - text_width('TROPHIES') // 2, 46, 'TROPHIES', 'gold')


def draw_hall_front(f):
    x = INDOOR + 16
    classroom_door(f, x, '101'); x += 48
    locker_bank(f, x, x + 112); x += 120
    bulletin(f, x, 64); x += 72
    # drinking fountain
    f.rect(x + 4, 96, x + 28, 110, 'metal0'); f.rect(x + 6, 110, x + 26, 136, 'metal1'); f.rect(x + 14, 92, x + 18, 96, 'metal2')
    f.ellipse(x + 8, 40, x + 24, 56, 'white'); f.outline(x + 8, 40, x + 24, 56, 'black'); f.line(x + 16, 48, x + 16, 43, 'black'); f.line(x + 16, 48, x + 20, 48, 'black')
    x += 40
    classroom_door(f, x, '102'); x += 48
    trophy_case(f, x, 96); x += 104
    locker_bank(f, x, W - 4)
    # banner across the top of the wall
    f.rect(INDOOR + 200, 30, INDOOR + 330, 40, 'red'); f.text(INDOOR + 265 - text_width('GO TEAM!') // 2, 32, 'GO TEAM!', 'white')


# ---------------------------------------------------------------- packing
def pack(images):
    colors = {}
    for im in images:
        raw = im.tobytes()
        for i in range(0, len(raw), 4):
            p = tuple(raw[i:i + 4])
            if p[3] >= 128 and p[:3] not in colors: colors[p[:3]] = len(colors) + 1
    if len(colors) > 255: raise SystemExit(f'too many colours: {len(colors)}')
    pal = [0, 0, 0] + [v for c in colors for v in c]
    layers = []
    for im in images:
        data = im.load(); blocks = [bytes(CELL * CELL)]; ix = {blocks[0]: 0}; mp = []
        for cy in range(H // CELL):
            for cx in range(W // CELL):
                buf = bytearray(CELL * CELL)
                for y in range(CELL):
                    for x in range(CELL):
                        p = data[cx * CELL + x, cy * CELL + y]
                        if p[3] >= 128: buf[y * CELL + x] = colors[p[:3]]
                buf = bytes(buf)
                if buf not in ix: ix[buf] = len(blocks); blocks.append(buf)
                mp.append(ix[buf])
        # blocks: zlib-compressed, 1024 palette indices per block (0 = transparent)
        layers.append({'z': base64.b64encode(zlib.compress(b''.join(blocks), 9)).decode(), 'count': len(blocks), 'map': mp})
    return pal, layers


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--preview', help='directory for PNG previews'); a = ap.parse_args()
    back, front = Canvas(), Canvas()
    draw_back(back); draw_front(front)
    pal, layers = pack([back.im, front.im])
    doc = {
        'id': 'school', 'name': 'Springfield Elementary', 'scene': 2, 'st': 0x82, 'area': 0, 'cols': W // CELL, 'rows': H // CELL,
        'groups': [{'name': 'Schoolyard', 'from': 0, 'to': INDOOR // CELL}, {'name': 'Hallway', 'from': INDOOR // CELL, 'to': W // CELL}],
        'palette': pal, 'layers': layers,
    }
    out = os.path.join(ROOT, 'web', 'custom', 'tileset_school.js')
    with open(out, 'w', newline='\n') as fh:
        fh.write('// Generated by tools/build_tileset_school.py: original Springfield Elementary background art (no ROM data).\n')
        fh.write('(function(G){(G.SIMPTILESETS=G.SIMPTILESETS||{}).school=' + json.dumps(doc, separators=(',', ':')) + ';'
                 "if(typeof module!=='undefined'&&module.exports)module.exports=G.SIMPTILESETS.school;})(typeof window!=='undefined'?window:globalThis);\n")
    print(f'{out}: {len(pal) // 3 - 1} colours, blocks back={layers[0]["count"]} front={layers[1]["count"]}, {os.path.getsize(out)} bytes')
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        sky = Image.new('RGBA', (W, H), (40, 40, 60, 255)); sky.alpha_composite(back.im); sky.alpha_composite(front.im)
        sky.convert('RGB').save(os.path.join(a.preview, 'school_composite.png'))
        back.im.save(os.path.join(a.preview, 'school_back.png')); front.im.save(os.path.join(a.preview, 'school_front.png'))


if __name__ == '__main__':
    main()
