#!/usr/bin/env python3
"""Build the Hans Moleman enemy atlas from a reference drawing (white background), then pack it.

The reference stays outside the repository; only the packed asset web/custom/moleman.js is generated.
Pipeline (all at the reference's full resolution, so line art survives the reduction):
  1. Cut the character out: near-white pixels connected to the image border are background.
  2. Label every pixel with a sprite pen: ink (dark line art), skin, shirt, tie, trousers, shoes, cane, lenses.
     A few colours are only accepted in the body area they belong to (shoes, cane, lenses), so anti-aliased
     grey edges become ink rather than shoe grey.
  3. Pose 16 frames by moving labelled body parts (head, raised arm, cane hand, legs) with nearest-neighbour
     rotation and offsets: idle 0-3, walk 4-7, attack 8-11 (punch), hit 12-13, fall 14-15.
  4. Reduce each frame to a 64x96 cell by voting per output pixel (ink wins when it covers enough of the box),
     mirror it to face left like the other custom enemies, close the silhouette with a 1 px ink border and add
     cel shading on the right/bottom edges.
  5. Write the 4x4 atlas PNG and pack it with tools/build_duffman.py (same format as Duffman, Rivet and Slugger).

Usage: python tools/build_moleman.py [REFERENCE.png] [--out DIR] [--no-pack]
"""
import argparse, os, shutil, subprocess, sys, tempfile
from collections import deque
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DEFAULT_REF = os.path.expanduser(r'~\.claude\uploads\be1e2f4f-664d-4505-a420-6a27a7d87f5f\f54fcf01-image.png')
CW, CH = 64, 96
ANCHOR_OUT = (32, 91)          # feet position in the cell (same as the other custom enemies)
PAD = 400                      # margin added around the reference so rotated poses stay on the canvas
ANCHOR_SRC = (505 + PAD, 742 + PAD)  # feet position (between the shoes, on the ground)
SRC_H = 728                    # reference character height in pixels
OUT_H = 72                     # target height in the cell
CENTER = (-6, 0)               # before mirroring: moves the figure so the reaching fist stays inside the cell
S = SRC_H / OUT_H              # reference pixels per sprite pixel

# pens (palette order)
BG, INK, SKIN, SKIN2, SHIRT, SHIRT2, TIE, TIE2, PANTS, PANTS2, SHOE, SHOE2, CANE, CANE2, LENS, WHITE = range(16)
PALETTE = ['000000', '14141c', 'ffd820', 'c89a10', 'fbfbf4', 'b4b8c4', 'f4ac80', 'c47850', '1f8a30', '125a1e',
           'a0a4ac', '686c76', '6e5a36', '463822', 'c4e4f8', 'ffffff']
RGB = {SKIN: (249, 222, 7), SHIRT: (253, 253, 253), TIE: (246, 176, 122), PANTS: (14, 111, 30), SHOE: (148, 151, 152), CANE: (85, 82, 49), LENS: (190, 220, 240)}
SHADE = {SKIN: SKIN2, SHIRT: SHIRT2, TIE: TIE2, PANTS: PANTS2, SHOE: SHOE2, CANE: CANE2}


def label(path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.int32)
    h, w, _ = im.shape
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    lum = (r + g + b) / 3; sat = im.max(2) - im.min(2)
    light = (r > 232) & (g > 232) & (b > 232)
    # background flood fill from the border
    bg = np.zeros((h, w), bool); q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if light[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if light[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and light[ny, nx] and not bg[ny, nx]: bg[ny, nx] = True; q.append((ny, nx))
    yy, xx = np.mgrid[0:h, 0:w]
    shoe_zone = yy > 628
    cane_zone = (xx > 412) & (xx < 565) & (yy > 450)
    lens_zone = (xx > 565) & (xx < 755) & (yy > 38) & (yy < 142)
    lab = np.full((h, w), INK, np.uint8)
    best = np.full((h, w), 1e9)
    for pen, (cr, cg, cb) in RGB.items():
        d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
        ok = np.ones((h, w), bool)
        if pen == SHOE: ok = shoe_zone
        if pen == CANE: ok = cane_zone
        if pen == LENS: ok = lens_zone
        m = ok & (d < best); best[m] = d[m]; lab[m] = pen
    # dark or grey anti-aliased edge pixels are ink
    grey_edge = (sat < 30) & (lum < 200) & ~(shoe_zone & (lum > 120))
    lab[((lum < 105) & (sat < 28)) | (lum < 42)] = INK
    lab[grey_edge & ~(shoe_zone & (lum > 120))] = INK
    lab[best > 9000] = INK
    lab[lens_zone & (lab == SHIRT)] = WHITE
    lab[bg] = BG
    return lab


# body parts in reference coordinates (character faces right in the reference)
def masks(lab):
    h, w = lab.shape
    yy, xx = np.mgrid[0:h, 0:w]
    yy, xx = yy - PAD, xx - PAD
    head = (yy < 205) & (xx > 470)
    arm = (xx > 640) & (yy > 200) & (yy < 335)
    cane = (xx > 405) & (xx < 570) & (yy > 405)
    legs = (yy > 585) & ~cane
    leg_back = legs & (xx < 520)
    leg_front = legs & (xx >= 520)
    return {'head': head, 'arm': arm, 'cane': cane, 'leg_back': leg_back, 'leg_front': leg_front}


PIVOT = {k: (x + PAD, y + PAD) for k, (x, y) in {'arm': (630, 255), 'head': (560, 200), 'cane': (470, 440)}.items()}


def place(canvas, lab, mask, dx=0, dy=0, rot=0.0, pivot=None):
    """Stamp the masked part onto the canvas (nonzero pens only), rotated (degrees, counter-clockwise) about pivot."""
    part = np.where(mask, lab, 0).astype(np.uint8)
    if rot:
        im = Image.fromarray(part, 'L')
        im = im.rotate(rot, resample=Image.NEAREST, center=pivot, fillcolor=0)
        part = np.asarray(im)
    ys, xs = np.nonzero(part)
    ty, tx = ys + dy, xs + dx
    ok = (ty >= 0) & (ty < canvas.shape[0]) & (tx >= 0) & (tx < canvas.shape[1])
    canvas[ty[ok], tx[ok]] = part[ys[ok], xs[ok]]


def pose(lab, M, p):
    """p: dict with offsets for body/head/arm/cane/legs and whole-body rotation."""
    body = (lab > 0) & ~M['head'] & ~M['arm'] & ~M['cane'] & ~M['leg_back'] & ~M['leg_front']
    c = np.zeros_like(lab)
    bx, by = p.get('body', (0, 0))
    lb, lf = p.get('leg_back', (0, 0)), p.get('leg_front', (0, 0))
    place(c, lab, M['leg_back'], lb[0], lb[1])
    place(c, lab, M['leg_front'], lf[0], lf[1])
    place(c, lab, body, bx, by)
    hx, hy = p.get('head', (0, 0))
    place(c, lab, M['head'], bx + hx, by + hy, p.get('head_rot', 0), PIVOT['head'])
    ax, ay = p.get('arm', (0, 0))
    # a reaching arm is stamped along its path so the sleeve stretches instead of leaving a gap at the shoulder
    steps = max(1, int(max(abs(ax), abs(ay)) // 6)) if p.get('reach') else 1
    for k in range(1, steps + 1):
        place(c, lab, M['arm'], bx + ax * k // steps, by + ay * k // steps, p.get('arm_rot', 0), PIVOT['arm'])
    cx, cy = p.get('cane', (0, 0))
    place(c, lab, M['cane'], cx, by + cy, p.get('cane_rot', 0), PIVOT['cane'])
    if p.get('rot'):
        im = Image.fromarray(c, 'L').rotate(p['rot'], resample=Image.NEAREST, center=p.get('rot_center', ANCHOR_SRC), fillcolor=0)
        c = np.array(im)
    return c, p.get('scale', 1.0), p.get('shift', (0, 0))


def reduce(c, scale=1.0, shift=(0, 0)):
    s = S / scale
    shift = (shift[0] + CENTER[0], shift[1] + CENTER[1])
    out = np.zeros((CH, CW), np.uint8)
    h, w = c.shape
    for oy in range(CH):
        for ox in range(CW):
            x0 = ANCHOR_SRC[0] + (ox - ANCHOR_OUT[0] - shift[0]) * s; y0 = ANCHOR_SRC[1] + (oy - ANCHOR_OUT[1] - 1 - shift[1]) * s
            xa, xb, ya, yb = int(round(x0)), int(round(x0 + s)), int(round(y0)), int(round(y0 + s))
            if xb <= 0 or yb <= 0 or xa >= w or ya >= h: continue
            box = c[max(0, ya):min(h, yb), max(0, xa):min(w, xb)].ravel()
            if not box.size: continue
            n = np.bincount(box, minlength=16); tot = box.size
            if n[CANE] >= 0.22 * tot: out[oy, ox] = CANE  # the thin cane would otherwise turn to ink
            elif n[INK] >= 0.20 * tot and n[BG] < 0.85 * tot: out[oy, ox] = INK
            elif n[BG] >= 0.5 * tot: continue
            else:
                n2 = n.copy(); n2[BG] = 0; n2[INK] = 0
                if n2[LENS] + n2[WHITE] > 0.25 * tot: out[oy, ox] = LENS if n2[LENS] > n2[WHITE] else WHITE
                else: out[oy, ox] = int(n2.argmax())
    return out


def finish(cell):
    cell = cell[:, ::-1].copy()  # face left
    h, w = cell.shape
    op = cell > 0
    pad = np.pad(op, 1)
    edge = op & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    out = cell.copy(); out[edge & (cell != INK)] = INK
    # remove single ink specks with no ink/colour neighbours
    for y in range(h):
        for x in range(w):
            if out[y, x] == INK:
                nb = [out[yy, xx] for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)) if 0 <= yy < h and 0 <= xx < w]
                if not any(nb): out[y, x] = 0
    # cel shading: light from the upper left
    sh = out.copy()
    for y in range(h):
        for x in range(w):
            p = out[y, x]
            if p in SHADE:
                right = out[y, x + 1] if x + 1 < w else 0
                below = out[y + 1, x] if y + 1 < h else 0
                if right in (INK, 0) or below in (INK, 0) or (x + 2 < w and out[y, x + 2] in (INK, 0) and p in (PANTS, SHIRT)):
                    sh[y, x] = SHADE[p]
    return sh


FRAMES = [
    # idle: breathing bob, fist shake
    {}, {'body': (0, 6), 'head': (0, 2), 'arm_rot': 4}, {'body': (0, 10), 'head': (0, 4), 'arm_rot': -3}, {'body': (0, 6), 'head': (0, 2), 'arm_rot': 2},
    # walk: legs and cane shuffle, body bob
    {'leg_back': (-18, 0), 'leg_front': (16, 0), 'cane': (-18, -8), 'body': (0, 4)},
    {'leg_back': (-12, -6), 'leg_front': (10, 0), 'cane': (-8, 0), 'body': (0, 10), 'head': (0, 2)},
    {'leg_back': (16, 0), 'leg_front': (-18, -6), 'cane': (16, 0), 'body': (0, 4)},
    {'leg_back': (10, 0), 'leg_front': (-12, 0), 'cane': (8, -6), 'body': (0, 10), 'head': (0, 2)},
    # attack: wind up (fist raised and pulled back), punch out, full reach, recover
    {'arm_rot': 30, 'arm': (-40, -6), 'body': (-12, 4), 'head': (-8, 2), 'shift': (-3, 0)},
    {'arm_rot': 4, 'arm': (30, 0), 'reach': True, 'body': (12, 6), 'head': (10, 4), 'shift': (-5, 0)},
    {'arm_rot': -2, 'arm': (62, 6), 'reach': True, 'body': (22, 8), 'head': (16, 6), 'leg_front': (16, 0), 'shift': (-8, 0)},
    {'arm_rot': 2, 'arm': (20, 2), 'reach': True, 'body': (8, 4), 'head': (6, 2), 'shift': (-3, 0)},
    # hit: knocked back, head snaps, glasses jolt
    {'rot': 8, 'head_rot': 10, 'arm_rot': 35, 'arm': (-30, -20), 'shift': (2, 0)},
    {'rot': 14, 'head_rot': 16, 'arm_rot': 50, 'arm': (-40, -30), 'head': (-10, -6), 'shift': (4, 0)},
    # fall: tipping over backwards, then lying flat (scaled a little so he fits the cell)
    {'rot': 45, 'arm_rot': 60, 'arm': (-30, -30), 'cane_rot': -30, 'scale': 0.86, 'shift': (20, -10)},
    {'rot': 88, 'arm_rot': 70, 'arm': (-20, -40), 'cane_rot': -60, 'cane': (40, 30), 'scale': 0.72, 'shift': (34, -16)},
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('reference', nargs='?', default=DEFAULT_REF)
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'simpsons_moleman'))
    ap.add_argument('--no-pack', action='store_true')
    a = ap.parse_args()
    lab = np.pad(label(a.reference), PAD); M = masks(lab)
    os.makedirs(a.out, exist_ok=True)
    rgb = [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in PALETTE]
    atlas = Image.new('RGBA', (CW * 4, CH * 4), (0, 0, 0, 0)); px = atlas.load(); bad = []
    for f, p in enumerate(FRAMES):
        c, scale, shift = pose(lab, M, p)
        cell = finish(reduce(c, scale, shift))
        ys, xs = np.nonzero(cell)
        if not (len(xs) and xs.min() > 0 and xs.max() < CW - 1 and ys.min() > 0): bad.append(f)
        print(f'frame {f:2d}: x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()}')
        for y, x in zip(ys, xs): px[(f % 4) * CW + x, (f // 4) * CH + y] = rgb[cell[y, x]] + (255,)
    src = os.path.join(a.out, 'moleman_atlas.png'); atlas.save(src)
    print('atlas', src)
    if bad: raise SystemExit(f'frames touching the cell edge: {bad}')
    if a.no_pack: return
    subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_duffman.py'), src, a.out, '--id', 'moleman', '--name', 'Hans Moleman', '--colors', ','.join(PALETTE)], check=True)
    shutil.copyfile(os.path.join(a.out, 'moleman.js'), os.path.join(ROOT, 'web', 'custom', 'moleman.js'))
    print('wrote web/custom/moleman.js')


if __name__ == '__main__':
    main()
