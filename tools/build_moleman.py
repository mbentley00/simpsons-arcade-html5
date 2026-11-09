#!/usr/bin/env python3
"""Draw the Hans Moleman enemy atlas: 16 original pixel-art frames (4x4 grid of 64x96 cells, facing left).

Frame order matches the other custom enemies: idle 0-3, walk 4-7, attack 8-11 (cane swing and jab), hit 12-13,
fall 14-15 (falling back, lying down). Feet rest on y=91 (anchor 32,91). Every part is drawn as a flat shape with
a one-pixel dark border, back to front, so overlapping parts keep bold outlines like the game's sprites.

Usage: python tools/build_moleman.py OUTPUT.png
Then:  python tools/build_duffman.py OUTPUT.png DIR --id moleman --name "Hans Moleman" --colors <COLORS below>
"""
import math, sys
from PIL import Image, ImageDraw

CW, CH, BASE = 64, 96, 91
PAL = {
    'ink': '101820', 'skin': 'ffd429', 'skin2': 'c89918', 'shirt': 'fff8ed', 'shirt2': 'c2c5c0', 'pants': '2f8a36',
    'pants2': '1d5a22', 'tie': 'f2b07c', 'tie2': 'c8804e', 'shoe': 'a2a6ac', 'shoe2': '6a6e74', 'cane': '7a5530',
    'cane2': '4a3018', 'lens': 'd8ecf6', 'white': 'ffffff',
}
COLORS = ','.join(['000000'] + list(PAL.values()))
RGB = {k: tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,) for k, v in PAL.items()}


class Sprite:
    """Big work canvas; parts are stamped with an inner ink border."""
    S = 160

    def __init__(self):
        self.im = Image.new('RGBA', (self.S, self.S), (0, 0, 0, 0))

    def part(self, fill, draw_fn, border=True, shade=None):
        m = Image.new('L', (self.S, self.S), 0); d = ImageDraw.Draw(m); draw_fn(d)
        mp = m.load(); px = self.im.load()
        sh = shade[1] if shade else None
        for y in range(1, self.S - 1):
            for x in range(1, self.S - 1):
                if not mp[x, y]: continue
                edge = border and not (mp[x - 1, y] and mp[x + 1, y] and mp[x, y - 1] and mp[x, y + 1])
                if edge: px[x, y] = RGB['ink']
                elif sh and sh(x, y): px[x, y] = RGB[shade[0]]
                else: px[x, y] = RGB[fill]

    def dot(self, x, y, c):
        self.im.putpixel((int(x), int(y)), RGB[c])

    def line(self, pts, c, w=1):
        ImageDraw.Draw(self.im).line(pts, fill=RGB[c], width=w)


O = 48  # work-canvas offset: cell (x, y) is drawn at (x + O, y + O - 16)


def P(x, y): return (x + O, y + O - 16)


def poly(pts): return lambda d: d.polygon([P(*p) for p in pts], fill=255)


def ell(x0, y0, x1, y1): return lambda d: d.ellipse([P(x0, y0), P(x1, y1)], fill=255)


def thick(pts, w): return lambda d: d.line([P(*p) for p in pts], fill=255, width=w, joint='curve')


def limb(a, b, w):  # rounded segment
    def f(d):
        d.line([P(*a), P(*b)], fill=255, width=w)
        r = w / 2 - 0.5
        for (x, y) in (a, b):
            X, Y = P(x, y); d.ellipse([X - r, Y - r, X + r, Y + r], fill=255)
    return f


def cane(s, hand, ang, length=27):
    """Cane from the crook in the hand; ang in degrees (90 = straight down)."""
    a = math.radians(ang); hx, hy = hand
    tip = (hx + math.cos(a) * length, hy + math.sin(a) * length)
    s.part('cane', limb((hx, hy), tip, 4), shade=('cane2', lambda x, y: False))
    # crook: a small hook curling back over the hand
    ca = a + math.pi
    cx, cy = hx + math.cos(ca) * 2, hy + math.sin(ca) * 2
    perp = a - math.pi / 2
    k1 = (cx + math.cos(perp) * 4, cy + math.sin(perp) * 4)
    k2 = (k1[0] + math.cos(a) * 4, k1[1] + math.sin(a) * 4)
    s.part('cane', limb((hx, hy), (cx, cy), 4)); s.part('cane', limb((cx, cy), k1, 4)); s.part('cane', limb(k1, k2, 4))
    return tip


def figure(p):
    """Draw one pose. p: dict of offsets (see POSES)."""
    s = Sprite()
    dx, bob = p.get('dx', 0), p.get('bob', 0)
    X = lambda v: v + dx
    hipy = 66 + bob
    # --- legs (far first): baggy green trousers ending in cuffs and grey shoes
    for far, (fx, lift) in ((True, p.get('back', (40, 0))), (False, p.get('front', (27, 0)))):
        hip = (X(40 if far else 33), hipy)
        foot = (X(fx), BASE - 4 - lift)
        s.part('pants2' if far else 'pants', limb(hip, (foot[0], foot[1] - 4), 13))
        s.part('pants2' if far else 'pants', poly([(foot[0] - 6, foot[1] - 7), (foot[0] + 5, foot[1] - 7), (foot[0] + 6, foot[1] - 1), (foot[0] - 7, foot[1] - 1)]))
        s.part('shoe2' if far else 'shoe', ell(foot[0] - 9, foot[1] - 2, foot[0] + 5, foot[1] + 4))
    # trouser seat covering the hips
    s.part('pants', poly([(X(27), hipy - 9), (X(48), hipy - 11), (X(51), hipy + 2), (X(49), hipy + 8), (X(27), hipy + 8), (X(26), hipy)]),
           shade=('pants2', lambda x, y: x > P(X(46), 0)[0]))
    # --- far arm (raised fist), behind the torso
    fs = (X(42), 50 + bob); fist = p.get('fist', (X(10), 55 + bob))
    elbow = p.get('felbow', ((fs[0] + fist[0]) / 2 + 3, (fs[1] + fist[1]) / 2 + 5))
    s.part('shirt2', limb(fs, elbow, 8)); s.part('shirt2', limb(elbow, fist, 7))
    s.part('skin', ell(fist[0] - 4, fist[1] - 4, fist[0] + 4, fist[1] + 4), shade=('skin2', lambda x, y, f=fist: x > P(*f)[0] + 1))
    # --- hunched torso: white shirt, rounded back
    sy = 44 + bob
    s.part('shirt', poly([(X(29), sy + 5), (X(35), sy + 1), (X(42), sy - 1), (X(48), sy + 2), (X(52), sy + 8), (X(52), sy + 14), (X(49), hipy - 8), (X(29), hipy - 8), (X(27), sy + 12)]),
           shade=('shirt2', lambda x, y: x > P(X(45), 0)[0]))
    # tie
    tie = [(X(31), sy + 5), (X(35), sy + 4), (X(34), sy + 8), (X(36), sy + 17), (X(32), sy + 20), (X(30), sy + 16), (X(32), sy + 8)]
    s.part('tie', poly(tie), shade=('tie2', lambda x, y: x > P(X(35), 0)[0]))
    # --- head: big bald dome pushed forward, huge glasses, droopy nose and overbite
    hx, hy = X(p.get('hx', 24)), p.get('hy', 40) + bob
    s.part('skin', ell(hx - 11, hy - 14, hx + 11, hy + 8), shade=('skin2', lambda x, y, c=P(hx, hy): x > c[0] + 7))
    s.part('skin', ell(hx + 8, hy - 3, hx + 13, hy + 3))  # ear
    s.part('skin', ell(hx - 13, hy - 1, hx + 4, hy + 13), shade=('skin2', lambda x, y, c=P(hx, hy): y > c[1] + 10))  # muzzle
    nose = p.get('nose', 0)
    s.part('skin', ell(hx - 18, hy + 1 + nose, hx - 7, hy + 9 + nose))
    # mouth wrinkles / overbite line
    m = p.get('mouth', 'flat')
    if m == 'open': s.part('ink', ell(hx - 9, hy + 8, hx - 3, hy + 13), border=False)
    else:
        s.line([P(hx - 8, hy + 10), P(hx - 2, hy + 9)], 'ink'); s.line([P(hx - 4, hy + 12), P(hx + 1, hy + 11)], 'skin2')
    # hair strands
    for (ax, ay, bx, by) in ((hx + 1, hy - 14, hx - 1, hy - 18), (hx + 4, hy - 13, hx + 5, hy - 17), (hx + 7, hy - 12, hx + 9, hy - 15)):
        s.line([P(ax, ay), P(bx, by)], 'ink')
    # glasses: two big round lenses with dark rims
    g = p.get('glasses', 0)
    for (cx, cy, r) in ((hx - 8, hy - 3 + g, 6), (hx + 2, hy - 4, 5)):
        s.part('lens', ell(cx - r, cy - r, cx + r, cy + r))
        s.dot(*P(cx - r + 2, cy - r + 2), 'white')
        if p.get('eyes', 'down') == 'down': s.dot(*P(cx - 2, cy + 2), 'ink'); s.dot(*P(cx - 1, cy + 2), 'ink')
        else: s.dot(*P(cx - 1, cy - 1), 'ink'); s.dot(*P(cx, cy), 'ink'); s.dot(*P(cx - 1, cy), 'ink'); s.dot(*P(cx, cy - 1), 'ink')
    s.line([P(hx - 2, hy - 4), P(hx - 3, hy - 4)], 'ink')
    # --- near arm holding the cane
    ns = (X(36), 51 + bob); hand = p.get('hand', (X(21), 66 + bob))
    nel = p.get('nelbow', ((ns[0] + hand[0]) / 2 + 4, (ns[1] + hand[1]) / 2 + 2))
    tip_first = p.get('cane_behind', False)
    if tip_first: cane(s, hand, p.get('cane', 92), p.get('clen', 27))
    s.part('shirt', limb(ns, nel, 8), shade=('shirt2', lambda x, y: False)); s.part('shirt', limb(nel, hand, 7))
    if not tip_first: cane(s, hand, p.get('cane', 92), p.get('clen', 27))
    s.part('skin', ell(hand[0] - 4, hand[1] - 4, hand[0] + 4, hand[1] + 4), shade=('skin2', lambda x, y, h=hand: y > P(*h)[1] + 1))
    return s.im


def place(im, rot=0, squash=1.0):
    """Rotate around the feet (NEAREST), then crop to the cell with the lowest pixel on the baseline."""
    if rot:
        fx, fy = P(32, BASE)
        im = im.rotate(rot, resample=Image.NEAREST, center=(fx, fy), expand=False)
    bb = im.getbbox(); body = im.crop(bb)
    if squash != 1.0 or body.width > CW - 2:
        sc = min(squash, (CW - 2) / body.width)
        body = body.resize((max(1, round(body.width * sc)), max(1, round(body.height * sc))), Image.NEAREST)
    cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    ox = (CW - body.width) // 2 if rot else bb[0] - O
    if rot: ox = max(0, min(CW - body.width, ox))
    cell.alpha_composite(body, (ox, BASE + 1 - body.height))
    return cell


def poses():
    F = []
    # idle: breathing bob, shaking fist, cane planted
    for i, (b, fy) in enumerate([(0, 0), (0, -1), (1, -2), (0, -1)]):
        F.append((dict(bob=b, fist=(10, 55 + b + fy), cane=92), 0))
    # walk: short shuffling steps, cane swinging forward and planting
    walk = [((24, 0), (42, 2), 96, 0), ((28, 1), (38, 0), 88, 1), ((32, 2), (35, 0), 84, 0), ((28, 0), (40, 1), 90, 1)]
    for (front, back, ca, b) in walk:
        F.append((dict(front=front, back=back, cane=ca, bob=b, hand=(21 - (ca - 90) // 3, 66 + b), fist=(10, 56 + b)), 0))
    # attack: wind-up overhead, swing, jab, recover
    F.append((dict(hand=(38, 36), nelbow=(42, 44), cane=-130, cane_behind=True, fist=(17, 58), mouth='open', eyes='up', hx=27), 0))
    F.append((dict(hand=(25, 42), nelbow=(32, 44), cane=-160, clen=21, fist=(18, 58), mouth='open', eyes='up', dx=0), 0))
    F.append((dict(hand=(19, 55), nelbow=(28, 53), cane=176, clen=16, fist=(22, 60), dx=-1, front=(24, 0), mouth='open'), 0))
    F.append((dict(hand=(20, 63), cane=130, fist=(12, 56), dx=-1), 0))
    # hit: knocked back, glasses jolted, arms flung up
    F.append((dict(hand=(40, 40), nelbow=(40, 50), cane=-60, fist=(20, 40), felbow=(30, 48), mouth='open', eyes='up', glasses=-2, nose=-1), -8))
    F.append((dict(hand=(44, 36), nelbow=(42, 46), cane=-30, fist=(24, 34), felbow=(32, 44), mouth='open', eyes='up', glasses=-3, front=(25, 5)), -18))
    # fall: tipping over backwards, then flat on his back
    F.append((dict(hand=(44, 38), nelbow=(42, 46), cane=-20, fist=(26, 36), felbow=(34, 44), mouth='open', eyes='up', glasses=-3, front=(24, 8)), -40))
    F.append((dict(hand=(36, 58), cane=10, fist=(24, 60), eyes='down'), -90))
    return F


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'moleman_atlas.png'
    atlas = Image.new('RGBA', (CW * 4, CH * 4), (0, 0, 0, 0))
    for i, (p, rot) in enumerate(poses()):
        cell = place(figure(p), rot)
        atlas.alpha_composite(cell, ((i % 4) * CW, (i // 4) * CH))
    atlas.save(out); print(out); print('colors', COLORS)


if __name__ == '__main__':
    main()
