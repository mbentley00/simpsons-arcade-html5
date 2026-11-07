#!/usr/bin/env python3
# TODO(simpsons): still the ssriders layout; adapt to simpsons.zip (see NOTES.md ROM table).
"""Build the ssriders 68000 program image (0xc0000 bytes) from your own ROM zip.
Writes assets_extracted/prog.bin and web/assets/prog.bin (+ eeprom.bin from ssriders_eac.nv) (both gitignored; never commit them).
Layout (MAME tmnt2.cpp): 064eac02.8e/064eac03.8g even/odd at 0x00000, 064eab04.10e/064eab05.10g at 0x80000."""
import sys, zipfile, os
z = zipfile.ZipFile(sys.argv[1] if len(sys.argv) > 1 else 'roms/ssriders.zip')
out = bytearray(0xc0000)
for base, ev, od in ((0, '064eac02.8e', '064eac03.8g'), (0x80000, '064eab04.10e', '064eab05.10g')):
    e, o = z.read(ev), z.read(od)
    out[base:base + 2 * len(e):2] = e; out[base + 1:base + 2 * len(o):2] = o
for p in ('assets_extracted/prog.bin', 'web/assets/prog.bin'):
    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(out)
print('prog.bin', hex(len(out)))
nv = z.read('ssriders_eac.nv')  # default EEPROM image (settings the boot code reads into 0x104380)
for p in ('assets_extracted/eeprom.bin', 'web/assets/eeprom.bin'): open(p, 'wb').write(nv)
print('eeprom.bin', len(nv))
# Raw gfx ROM regions (MAME ROM_LOAD32_WORD interleave), needed only because the boot ROM test reads them through the chips.
def load32w(a, b):
    a, b = z.read(a), z.read(b); r = bytearray(2 * len(a))
    for i in range(0, len(a), 2): r[2*i:2*i+2] = a[i:i+2]; r[2*i+2:2*i+4] = b[i:i+2]
    return r
for name, (a, b) in (('gfx_tiles.bin', ('064e12.16k', '064e11.12k')), ('gfx_sprites.bin', ('064e09.7l', '064e07.3l'))):
    d = load32w(a, b)
    for p in ('assets_extracted/' + name, 'web/assets/' + name): open(p, 'wb').write(d)
    print(name, hex(len(d)))
# Sound board: Z80 program (64 KB) and K053260 sample ROM (1 MB).
for name, src in (('z80.bin', '064e01.2f'), ('k053260.bin', '064e06.1d')):
    d = z.read(src)
    for p in ('assets_extracted/' + name, 'web/assets/' + name): open(p, 'wb').write(d)
    print(name, hex(len(d)))
