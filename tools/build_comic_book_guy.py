#!/usr/bin/env python3
"""Build the Comic Book Guy enemy atlas (drawn here, no reference image needed), then pack it.

Pipeline:
  1. Every body part (ponytail, arms, legs, shorts, belly, shirt, hair, face, glasses, ear, rolled-up comic) is drawn
     with flat sprite pens at 4x the cell size, facing left like the other custom enemies.
  2. 16 frames are posed by moving and rotating the parts (nearest neighbour): idle 0-3, walk 4-7, attack 8-11
     (swats with a rolled-up comic), hit 12-13, fall 14-15.
  3. Each frame is reduced to a 64x96 cell by voting per output pixel. Ink outlines are then drawn at the cell's own
     resolution, 1 px wide, around the silhouette and wherever a part in front meets a part behind it; cel shading
     darkens the lower right edges.
  4. The 4x4 atlas is packed with tools/build_duffman.py (same format as Duffman, Rivet, Hans Moleman).

Usage: python tools/build_comic_book_guy.py [--out DIR] [--no-pack]
"""
import argparse, os, shutil, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CW, CH, K = 64, 96, 4           # cell size, drawing scale
OX, OY = 32, 40                  # cell origin inside the drawing canvas (room for rotated poses), in cell pixels
W, H = (CW + 2 * OX) * K, (CH + 2 * OY) * K
ANCHOR = (32, 91)                # feet in the cell

BG, INK, SKIN, SKIN2, SHIRT, SHIRT2, SHORTS, SHORTS2, HAIR, HAIR2, STUB, WHITE, SHOE, LENS, COMIC, COMIC2 = range(16)
PALETTE = ['000000', '14141c', 'ffd820', 'c89a10', '78c8e0', '3c8cac', 'd8b878', '9c7c44', '7c4c24', '4c2c14',
           'd0aa62', 'ffffff', '4a3a30', 'c4e4f8', 'e83838', '9c1c24']
SHADE = {SKIN: SKIN2, SHIRT: SHIRT2, SHORTS: SHORTS2, HAIR: HAIR2, COMIC: COMIC2}


def P(x, y): return ((x + OX) * K, (y + OY) * K)
def box(x0, y0, x1, y1): return [*P(x0, y0), *P(x1, y1)]


def layer(): return Image.new('L', (W, H), 0)


def thick(d, pts, w, pen):
    """A round-capped thick polyline (w in cell pixels)."""
    r = w * K / 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(max(abs(x1 - x0), abs(y1 - y0)) * 2))
        for i in range(n + 1):
            x, y = P(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)
            d.ellipse([x - r, y - r, x + r, y + r], fill=pen)


# ---------- parts, neutral pose, facing left; each returns (pen layer, extra ink layer or None)
def ponytail(p):
    im = layer(); d = ImageDraw.Draw(im)
    thick(d, [(36, 17), (41, 22), (43, 29), (42, 36)], 4, HAIR)
    thick(d, [(40.5, 22.5), (41.5, 23.5)], 4.4, HAIR2)  # hair tie
    return im


def arm(side, p):
    """Arm hanging down from the shoulder pivot; the sleeve is part of the arm so it rotates with it."""
    im = layer(); d = ImageDraw.Draw(im)
    sx, sy = PIVOT['arm_' + side]
    thick(d, [(sx, sy + 2), (sx, sy + 16)], 6.5, SKIN)
    d.ellipse(box(sx - 4.5, sy + 15, sx + 4.5, sy + 23), fill=SKIN)       # fist
    d.ellipse(box(sx - 5.5, sy - 4, sx + 5.5, sy + 8), fill=SHIRT)        # sleeve
    return im


def comic(p):
    """Rolled-up comic book in the front hand (attack frames only)."""
    im = layer(); d = ImageDraw.Draw(im)
    sx, sy = PIVOT['arm_f']
    thick(d, [(sx - 1, sy + 18), (sx - 1, sy + 34)], 5, COMIC)
    for y in (sy + 23, sy + 29):
        thick(d, [(sx - 3, y), (sx + 1, y)], 1.4, WHITE)
    return im


def leg(side, p):
    im = layer(); d = ImageDraw.Draw(im)
    x = 28 if side == 'f' else 38
    d.rectangle(box(x - 3.5, 74, x + 3.5, 86), fill=SKIN)
    d.rectangle(box(x - 3.5, 82, x + 3.5, 87), fill=WHITE)              # socks
    d.ellipse(box(x - 7.5, 85, x + 4.5, 92), fill=SHOE)                 # shoe, toe to the left
    return im


def shorts(p):
    im = layer(); d = ImageDraw.Draw(im)
    d.polygon([P(17, 66), P(48, 66), P(47, 80), P(36, 81), P(33, 76), P(31, 81), P(21, 80)], fill=SHORTS)
    return im


def belly(p):
    im = layer(); d = ImageDraw.Draw(im)
    d.ellipse(box(13, 62, 36, 73), fill=SKIN)                            # belly showing under the shirt
    return im


def torso(p):
    im = layer(); d = ImageDraw.Draw(im)
    b = p.get('breath', 0)
    d.ellipse(box(14, 32, 50, 70), fill=SHIRT)
    d.ellipse(box(9 - b, 42, 39, 68 + b * 0.5), fill=SHIRT)              # the belly pushes the shirt forward
    d.rectangle(box(22, 31, 44, 40), fill=SHIRT)
    return im


def hair(p):
    im = layer(); d = ImageDraw.Draw(im)
    d.ellipse(box(23, 9, 40, 32), fill=HAIR)
    return im


def head(p):
    im = layer(); d = ImageDraw.Draw(im)
    d.ellipse(box(14, 10, 35, 37), fill=SKIN)                            # face
    d.ellipse(box(16, 29, 37, 41), fill=SKIN)                            # double chin and neck
    d.polygon([P(13, 26), P(20, 26), P(26, 31), P(33, 30), P(33, 37), P(24, 40), P(16, 37)], fill=STUB)  # stubble
    d.ellipse(box(10, 22, 17, 28), fill=SKIN)                            # nose
    thick(d, [(15, 32), (19, 32.5), (21, 31.5)], 1.1, INK)              # smirk
    thick(d, [(16, 10.5), (26, 9), (33, 13)], 1.6, HAIR)                 # thin hair on top
    return im


def glasses(p):
    im = layer(); d = ImageDraw.Draw(im)
    d.ellipse(box(14.5, 15.5, 21.5, 23), fill=LENS); d.ellipse(box(22, 15.5, 28, 22.5), fill=LENS)
    blink = p.get('blink')
    for cx in (18, 25):
        if blink: thick(d, [(cx - 1.5, 19.5), (cx + 1.5, 19.5)], 1, INK)
        else: d.rectangle(box(cx - 1.3 + p.get('look', 0), 18, cx + 0.7 + p.get('look', 0), 21), fill=INK)
    thick(d, [(28, 19), (31, 19.5)], 1, INK)                             # temple arm
    return im


def ear(p):
    im = layer(); d = ImageDraw.Draw(im)
    d.ellipse(box(29, 19, 34, 26), fill=SKIN)
    return im


# draw order, back to front: (name, maker, transform group)
PARTS = [('ponytail', ponytail, 'head'), ('arm_b', lambda p: arm('b', p), 'arm_b'), ('leg_b', lambda p: leg('b', p), 'leg_b'),
         ('leg_f', lambda p: leg('f', p), 'leg_f'), ('shorts', shorts, 'hips'), ('belly', belly, 'body'), ('torso', torso, 'body'),
         ('hair', hair, 'head'), ('head', head, 'head'), ('glasses', glasses, 'head'), ('ear', ear, 'head'),
         ('arm_f', lambda p: arm('f', p), 'arm_f'), ('comic', comic, 'arm_f')]
PIVOT = {'arm_f': (31, 39), 'arm_b': (43, 38), 'head': (27, 38), 'body': (32, 70), 'hips': (32, 74), 'leg_f': (28, 74), 'leg_b': (38, 74)}
BASE_ROT = {'arm_f': 22, 'arm_b': 8}   # arms rest on the sides of the belly, hands out a little
HEAD_SCALE = 1.2                         # big head, in the show's proportions
FIGURE_SCALE = 0.86                     # whole figure, so he stands about as tall as the other enemies


def offset(p, g):
    """Total offset of a transform group: the body carries the head and arms."""
    ox, oy = p.get(g, (0, 0))
    if g in ('head', 'arm_f', 'arm_b'):
        bx, by = p.get('body', (0, 0)); ox += bx; oy += by
    return ox, oy


def compose(p):
    pens = np.zeros((H, W), np.uint8); ids = np.zeros((H, W), np.uint8)
    for i, (name, make, g) in enumerate(PARTS, 1):
        if name == 'comic' and not p.get('comic'): continue
        im = make(p)
        if g == 'head':  # enlarge about the neck
            cx, cy = P(*PIVOT['head']); k = 1 / HEAD_SCALE
            im = im.transform(im.size, Image.AFFINE, (k, 0, cx - k * cx, 0, k, cy - k * cy), resample=Image.NEAREST, fillcolor=0)
        rot = p.get(g + '_rot', 0) + BASE_ROT.get(g, 0)
        if rot: im = im.rotate(rot, resample=Image.NEAREST, center=P(*PIVOT[g]), fillcolor=0)
        a = np.asarray(im); dx, dy = offset(p, g)
        a = np.roll(np.roll(a, int(round(dy * K)), 0), int(round(dx * K)), 1)
        m = a > 0; pens[m] = a[m]; ids[m] = i
    if p.get('rot'):
        c = P(*p.get('rot_center', ANCHOR))
        pens = np.asarray(Image.fromarray(pens).rotate(p['rot'], resample=Image.NEAREST, center=c, fillcolor=0))
        ids = np.asarray(Image.fromarray(ids).rotate(p['rot'], resample=Image.NEAREST, center=c, fillcolor=0))
    return pens, ids


def reduce(pens, ids, scale=1.0, shift=(0, 0)):
    s = K / scale
    ax, ay = P(*ANCHOR)
    out = np.zeros((CH, CW), np.uint8); oid = np.zeros((CH, CW), np.uint8)
    for oy in range(CH):
        for ox in range(CW):
            x0 = ax + (ox - ANCHOR[0] - shift[0]) * s; y0 = ay + (oy - ANCHOR[1] - shift[1]) * s
            xa, xb, ya, yb = int(round(x0)), int(round(x0 + s)), int(round(y0)), int(round(y0 + s))
            if xb <= 0 or yb <= 0 or xa >= W or ya >= H: continue
            bp = pens[max(0, ya):min(H, yb), max(0, xa):min(W, xb)].ravel()
            bi = ids[max(0, ya):min(H, yb), max(0, xa):min(W, xb)].ravel()
            if not bp.size: continue
            n = np.bincount(bp, minlength=16); tot = bp.size
            if n[BG] >= 0.5 * tot: continue
            if n[INK] >= 0.25 * tot: out[oy, ox] = INK
            else: n[BG] = 0; n[INK] = 0; out[oy, ox] = int(n.argmax())
            ni = np.bincount(bi[bi > 0]); oid[oy, ox] = int(ni.argmax()) if ni.size else 0
    return out, oid


def finish(cell, oid):
    h, w = cell.shape
    out = cell.copy()
    for y in range(h):
        for x in range(w):
            if not cell[y, x]: continue
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                nb = oid[yy, xx] if 0 <= yy < h and 0 <= xx < w else 0
                # silhouette edge, or this part sits in front of the neighbouring one
                if (nb == 0 or nb < oid[y, x]) and not (nb and cell[yy, xx] == INK):
                    out[y, x] = INK; break
    for y in range(h):  # single specks
        for x in range(w):
            if out[y, x] == INK and not any(out[yy, xx] for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)) if 0 <= yy < h and 0 <= xx < w):
                out[y, x] = 0
    sh = out.copy()  # cel shading, light from the upper left
    for y in range(h):
        for x in range(w):
            p = out[y, x]
            if p in SHADE:
                right = out[y, x + 1] if x + 1 < w else 0
                below = out[y + 1, x] if y + 1 < h else 0
                if right in (INK, 0) or below in (INK, 0) or (x + 2 < w and out[y, x + 2] in (INK, 0) and p in (SHIRT, SHORTS)):
                    sh[y, x] = SHADE[p]
    return sh


FRAMES = [
    # idle: breathing, belly heave, a blink, a sideways look
    {}, {'body': (0, 0.5), 'head': (0, 0.5), 'breath': 1, 'arm_f_rot': -3}, {'body': (0, 1), 'head': (0, 1), 'breath': 2, 'blink': True, 'arm_f_rot': -5},
    {'body': (0, 0.5), 'head': (0, 0.5), 'breath': 1, 'look': -0.7},
    # walk: waddle with swinging arms and a side-to-side tilt
    {'leg_f': (-4, 0), 'leg_b': (4, -1), 'arm_f_rot': 14, 'arm_b_rot': -12, 'body': (0, 0), 'rot': -2},
    {'leg_f': (-1, -2), 'leg_b': (1, 0), 'arm_f_rot': 5, 'arm_b_rot': -4, 'body': (0, 1), 'head': (0, 0.5)},
    {'leg_f': (4, -1), 'leg_b': (-4, 0), 'arm_f_rot': -14, 'arm_b_rot': 12, 'body': (0, 0), 'rot': 2},
    {'leg_f': (1, 0), 'leg_b': (-1, -2), 'arm_f_rot': -5, 'arm_b_rot': 4, 'body': (0, 1), 'head': (0, 0.5)},
    # attack: pulls a rolled-up comic back over his head, swats down and forward, follows through, recovers
    {'comic': True, 'arm_f_rot': 135, 'arm_f': (3, -2), 'body': (2, 0), 'head': (2, 0), 'arm_b_rot': 10},
    {'comic': True, 'arm_f_rot': 165, 'arm_f': (0, -3), 'body': (1, -1), 'head': (1, -1)},
    {'comic': True, 'arm_f_rot': -112, 'arm_f': (-1, 0), 'body': (-3, 1), 'head': (-4, 1), 'leg_f': (-3, 0), 'arm_b_rot': -15, 'shift': (5, 0)},
    {'comic': True, 'arm_f_rot': -70, 'arm_f': (-2, 0), 'body': (-1, 0), 'head': (-2, 0)},
    # hit: knocked back, head snaps, arms fly up
    {'rot': -8, 'head_rot': -10, 'head': (1, 0), 'arm_f_rot': 120, 'arm_b_rot': -100, 'blink': True, 'shift': (-1, 0)},
    {'rot': -14, 'head_rot': -16, 'head': (2, -1), 'arm_f_rot': 150, 'arm_b_rot': -130, 'blink': True, 'shift': (-2, 0)},
    # fall: tipping over backwards, then flat on his back
    {'rot': -45, 'arm_f_rot': 140, 'arm_b_rot': -120, 'blink': True, 'scale': 0.82, 'rot_center': (32, 60), 'shift': (-6, 3)},
    {'rot': -88, 'arm_f_rot': 170, 'arm_b_rot': -160, 'leg_f': (0, -2), 'blink': True, 'scale': 0.7, 'rot_center': (32, 60), 'shift': (-7, 8)},
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'simpsons_comic_book_guy'))
    ap.add_argument('--no-pack', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rgb = [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in PALETTE]
    atlas = Image.new('RGBA', (CW * 4, CH * 4), (0, 0, 0, 0)); px = atlas.load(); bad = []
    for f, p in enumerate(FRAMES):
        pens, ids = compose(p)
        cell = finish(*reduce(pens, ids, FIGURE_SCALE * p.get('scale', 1.0), p.get('shift', (0, 0))))
        ys, xs = np.nonzero(cell)
        if not (len(xs) and xs.min() > 0 and xs.max() < CW - 1 and ys.min() > 0 and ys.max() < CH - 1): bad.append(f)
        print(f'frame {f:2d}: x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()}')
        for y, x in zip(ys, xs): px[(f % 4) * CW + x, (f // 4) * CH + y] = rgb[cell[y, x]] + (255,)
    src = os.path.join(a.out, 'comic_book_guy_atlas.png'); atlas.save(src)
    print('atlas', src)
    if bad: raise SystemExit(f'frames touching the cell edge: {bad}')
    if a.no_pack: return
    subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_duffman.py'), src, a.out, '--id', 'comic_book_guy', '--name', 'Comic Book Guy', '--colors', ','.join(PALETTE)], check=True)
    shutil.copyfile(os.path.join(a.out, 'comic_book_guy.js'), os.path.join(ROOT, 'web', 'custom', 'comic_book_guy.js'))
    print('wrote web/custom/comic_book_guy.js')


if __name__ == '__main__':
    main()
