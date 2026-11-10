#!/usr/bin/env python3
"""Convert characters from a SimpsonsSprites folder (one PNG per animation frame) into custom enemies.

The sprite folder stays outside the repository; only the packed assets web/custom/<id>.js are generated.
Each character picks 16 source frames for the custom-enemy layout (idle 0-3, walk 4-7, attack 8-11,
hit 12-13, fall 14-15). The frames are already pixel art, so they are copied 1:1 into the 64x96 cell
(shrunk only if the widest pose would not fit; a character can use a bigger cell), mirrored to face left like the other custom enemies,
reduced to one shared 15-colour palette, and packed with tools/build_duffman.py. displayScale then
sets their on-screen size: goon-sheet frames are drawn at arcade size already; the cutout characters
are scaled by one common factor so they stand as tall as Fat Tony while keeping their relative heights.

Usage: python tools/build_sheet_enemies.py [SPRITE_FOLDER] [--only id,id] [--out DIR] [--no-pack]
"""
import argparse, os, subprocess, sys, tempfile
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DEFAULT_SRC = os.path.expanduser(r'~\OneDrive\SimpsonsSprites')
CELL = (64, 96)                # default frame size; a character can ask for a bigger 'cell' (multiples of 16)
GOON = 'qwen_goon_sheets/'

def cutout(folder, name, attack=('punch_f00', 'punch_f01', 'punch_f01', 'punch_f02')):
    """Standard cutout rows: idle 2, walk 8, punch 3, hurt 2, knockdown 5 (plus signature moves)."""
    return {'dir': folder, 'name': name, 'kind': 'cutout', 'frames': [
        'idle_f00', 'idle_f00', 'idle_f01', 'idle_f01',
        'walk_f00', 'walk_f02', 'walk_f04', 'walk_f06',
        *attack,
        'hurt_f00', 'hurt_f01',
        'knockdown_f01', 'knockdown_f04']}

def goon(folder, name):
    """Rows of the arcade goon sheet (already facing left): r00 idle, r04 walk (drawn facing right, so mirrored),
    r11 punch, r23 dizzy recoil, r27 knocked head over heels and landing on his back."""
    return {'dir': GOON + folder, 'name': name, 'kind': 'goon', 'frames': [
        'r00_f00', 'r00_f00', 'r00_f01', 'r00_f01',
        '~r04_f00', '~r04_f02', '~r04_f04', '~r04_f06',
        'r11_f00', 'r11_f01', 'r11_f02', 'r11_f03',
        'r23_f01', 'r23_f02',
        'r27_f00', 'r27_f04']}

CHARACTERS = {
    'fat_tony': goon('fat_tony', 'Fat Tony'),
    'rich_texan': goon('rich_texan', 'Rich Texan'),
    'burns': cutout('cast3_stonecutters/26_burns', 'Mr. Burns'),
    'moe': cutout('cast3_stonecutters/25_moe', 'Moe'),
    'wiseguy': cutout('cast1_cutouts/10_wine_mobster', 'Wiseguy'),
    # his punch reaches out with a whole arm and would shrink every frame; the belly slam is compact
    'mob_boss': cutout('cast1_cutouts/12_bald_boss', 'Mob Boss', ('idle_f00', 'belly_slam_f00', 'belly_slam_f01', 'belly_slam_f01')),
    # PixelLab's paddle animation of Jasper (paddle-in-palm taunt as his idle, the overhead whack with its swooshes
    # as his attack) joined to the Stonecutter cutout Jasper's walk, hurt and knockdown: same robe, same pixel scale.
    # The overhead whack is 115 px tall, and the swing spans 107 px, so he gets a 112x128 cell instead of shrinking the art.
    'jasper': {'dir': 'cast3_stonecutters/24_jasper', 'name': 'Jasper', 'kind': 'cutout', 'cell': (112, 128),
               'refs': {'pixellab_jasper': 'ready_f00', 'cast3_stonecutters/24_jasper': 'idle_f00'}, 'frames': [
        'pixellab_jasper/palm_slap_f02', 'pixellab_jasper/palm_slap_f03', 'pixellab_jasper/palm_slap_f04', 'pixellab_jasper/palm_slap_f03',
        'walk_f00', 'walk_f02', 'walk_f04', 'walk_f06',
        'pixellab_jasper/overhead_whack_f02', 'pixellab_jasper/overhead_whack_f04', 'pixellab_jasper/overhead_whack_f05', 'pixellab_jasper/overhead_whack_f06',
        'hurt_f00', 'hurt_f01',
        'knockdown_f01', 'knockdown_f04']},
}
FALL = (14, 15)
SHARED_FEET = (120, 180)   # where multi-folder characters' feet are put on their shared 240x200 canvas

def frame(src, ch, f):
    """One frame, hard alpha, mirrored as needed. 'folder/name' takes a frame from another folder of the same root."""
    # Cutouts face right and are all mirrored; a '~' prefix flips a single frame of a left-facing sheet.
    flip = (ch['kind'] == 'cutout') != f.startswith('~')
    folder, name = f.lstrip('~').rsplit('/', 1) if '/' in f else (ch['dir'], f.lstrip('~'))
    im = Image.open(os.path.join(src, folder, 'frames', name + '.png')).convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
    return folder, (im.transpose(Image.FLIP_LEFT_RIGHT) if flip else im)

def feet_of(im):
    """Feet line (lowest opaque row) and the centre of the opaque pixels in the three rows above it."""
    bb = im.getbbox(); a = im.getchannel('A').load(); xs = [x for y in range(bb[3] - 3, bb[3]) for x in range(im.width) if a[x, y]]
    return sum(xs) / len(xs), bb[3]

def load(src, ch):
    out = [frame(src, ch, f) for f in ch['frames']]
    if 'refs' not in ch: return [im for _, im in out]
    # Frames from different folders: put each folder's reference stance (feet line, centre of the feet) on one spot
    # of a shared canvas, so idle, walk and attack frames line up.
    W, H, (X0, Y0) = 240, 200, SHARED_FEET; shift = {}
    for folder, name in ch['refs'].items():
        cx, fy = feet_of(frame(src, ch, folder + '/' + name if folder != ch['dir'] else name)[1]); shift[folder] = (round(X0 - cx), Y0 - fy)
    res = []
    for folder, im in out:
        c = Image.new('RGBA', (W, H)); c.paste(im, shift[folder], im); res.append(c)
    return res

def idle_height(frames):
    bb = frames[0].getbbox(); return bb[3] - bb[1]

def layout(frames, cell=CELL, centre=None):
    """Registration from the idle frame (body centre x, feet y), or a given feet point. Returns the fit scale and extents."""
    bb = frames[0].getbbox(); cx, feet = centre or ((bb[0] + bb[2]) / 2, bb[3])
    stand = [f.getbbox() for i, f in enumerate(frames) if i not in FALL]
    L = max(cx - b[0] for b in stand); R = max(b[2] - cx for b in stand)
    U = max(feet - b[1] for b in stand); D = max(b[3] - feet for b in stand)
    fit_w, fit_h = cell[0] - 2, cell[1] - 2           # keep a transparent column/row at the cell edges
    k = min(1.0, fit_w / (L + R), fit_h / (U + D))   # lying poses are fitted on their own in place()
    return cx, feet, L, R, U, D, k

def place(frames, cx, feet, L, R, U, D, k, cell=CELL):
    CW, CH = cell; FIT_W = CW - 2
    ax = max(1 + round(L * k), min(CW - 2 - round(R * k), CW // 2))   # centred if the poses allow
    ay = CH - 2 - round(D * k)
    atlas = Image.new('RGBA', (CW * 4, CH * 4))
    for i, f in enumerate(frames):
        fk = k
        if i in FALL:   # a lying pose wider than the cell is shrunk on its own rather than shrinking every frame
            b = f.getbbox(); fk = min(k, (FIT_W - 1) / (b[2] - b[0]))
        if fk < 1: f = f.resize((max(1, round(f.width * fk)), max(1, round(f.height * fk))), Image.NEAREST)
        x0, y0 = ax - round(cx * fk), ay - round(feet * fk)
        if i in FALL:   # lying poses: keep them on the ground line, slide sideways to stay in the cell
            b = f.getbbox()
            x0 = min(max(x0, 1 - b[0]), CW - 1 - b[2]); y0 = min(y0, CH - 1 - b[3])
        cell = Image.new('RGBA', (CW, CH)); cell.paste(f, (x0, y0), f)
        b = cell.getbbox(); assert b[0] >= 1 and b[2] <= CW - 1 and b[1] >= 1 and b[3] <= CH - 1, (i, b)
        atlas.paste(cell, ((i % 4) * CW, (i // 4) * CH))
    return atlas, (ax, ay)

def palette(atlas):
    """Exact colours when there are 15 or fewer, otherwise a median-cut reduction of the opaque pixels."""
    opaque = [p[:3] for p in atlas.getdata() if p[3]]
    colours = sorted(set(opaque))
    if len(colours) > 15:
        strip = Image.new('RGB', (len(opaque), 1)); strip.putdata(opaque)
        q = strip.quantize(15, method=Image.Quantize.MEDIANCUT).getpalette()[:45]
        colours = [tuple(q[i:i + 3]) for i in range(0, 45, 3)]
    colours += [(0, 0, 0)] * (15 - len(colours))
    return ['000000'] + ['%02x%02x%02x' % c for c in colours]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', nargs='?', default=DEFAULT_SRC)
    ap.add_argument('--only'); ap.add_argument('--out', default=os.path.join(ROOT, 'web', 'custom'))
    ap.add_argument('--no-pack', action='store_true')
    a = ap.parse_args()
    ids = a.only.split(',') if a.only else list(CHARACTERS)
    loaded = {i: load(a.source, CHARACTERS[i]) for i in CHARACTERS if i in ids or (CHARACTERS[i]['kind'] == 'cutout' and 'refs' not in CHARACTERS[i]) or i == 'fat_tony'}
    # Cutouts share one factor: the median cutout idle height is drawn as tall as Fat Tony.
    cut = sorted(idle_height(f) for i, f in loaded.items() if CHARACTERS[i]['kind'] == 'cutout' and 'refs' not in CHARACTERS[i])
    cutout_scale = idle_height(loaded['fat_tony']) / cut[len(cut) // 2]
    tmp = tempfile.mkdtemp()
    for i in ids:
        frames = loaded[i]; cell = CHARACTERS[i].get('cell', CELL); cx, feet, L, R, U, D, k = layout(frames, cell, SHARED_FEET if 'refs' in CHARACTERS[i] else None)
        atlas, anchor = place(frames, cx, feet, L, R, U, D, k, cell)
        source_scale = 1.0 if CHARACTERS[i]['kind'] == 'goon' else cutout_scale
        scale = round(source_scale / k, 4)
        colours = palette(atlas)
        png = os.path.join(tmp, i + '.png'); atlas.save(png)
        print(f'{i}: fit {k:.3f}, displayScale {scale}, anchor {anchor}, on-screen height {idle_height(frames) * source_scale:.0f} px')
        if a.no_pack: atlas.save(os.path.join(a.out, i + '_atlas.png')); continue
        subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_duffman.py'), png, tmp, '--id', i,
                        '--name', CHARACTERS[i]['name'], '--colors', ','.join(colours), '--scale', str(scale),
                        '--anchor', '%d,%d' % anchor, '--cell', '%dx%d' % cell], check=True)
        os.replace(os.path.join(tmp, i + '.js'), os.path.join(a.out, i + '.js'))

if __name__ == '__main__':
    main()
