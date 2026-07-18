#!/usr/bin/env python3
"""
Bake a seamless 64x64 dirt tile and embed it into ../assets.js as ASSETS.dirt.
Keeps the original dirt look (a fine even 3-brown speckle at the same densities)
but places the dark and light specks with wrap-aware spacing, so no two same-color
pixels ever touch, not even across the tile edges or corners. That removes the
same-color blobs the old tile showed where tiles met, and lets a dirt field sync
seamlessly. Palette is unchanged, so build_night_tiles.py still remaps it to the
charcoal night dirt with no other edits.
Usage: python3 build_dirt_tile.py   (needs Pillow + numpy)
Deterministic seed.
"""
import base64, io, os, re
import numpy as np
from PIL import Image

N = 64
BASE  = (107, 70, 42)
DARK  = (74, 48, 28)
LIGHT = (140, 96, 58)
N_DARK, N_LIGHT = 483, 342          # exact original counts (11.8% / 8.3%)

occ = np.zeros((N, N), dtype=np.uint8)   # 0 base, 1 dark, 2 light
rng = np.random.default_rng(7)

def touches(y, x, val):
    # any same-color pixel in the 8-neighborhood, wrapping at the tile edges
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if (dy or dx) and occ[(y + dy) % N, (x + dx) % N] == val:
                return True
    return False

def scatter(val, count):
    order = [(y, x) for y in range(N) for x in range(N)]
    rng.shuffle(order)
    placed = 0
    for y, x in order:
        if placed >= count:
            break
        if occ[y, x] == 0 and not touches(y, x, val):
            occ[y, x] = val
            placed += 1
    return placed

d = scatter(1, N_DARK)
l = scatter(2, N_LIGHT)

img = np.empty((N, N, 3), dtype=np.uint8)
img[:] = BASE
img[occ == 1] = DARK
img[occ == 2] = LIGHT
print('placed dark %d/%d, light %d/%d' % (d, N_DARK, l, N_LIGHT))

im = Image.fromarray(img, 'RGB').convert('RGBA')
here = os.path.dirname(os.path.abspath(__file__))
im.save(os.path.join(here, 'tiles', 'dirt.png'), optimize=True)

b = io.BytesIO(); im.save(b, 'PNG', optimize=True)
durl = 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()
aj = os.path.join(os.path.dirname(here), 'assets.js')
s = open(aj, encoding='utf-8').read()
s = re.sub('"dirt": "data:image/png;base64,[^"]+"', '"dirt": "%s"' % durl, s)
open(aj, 'w', encoding='utf-8', newline='').write(s)
print('embedded dirt in assets.js')
