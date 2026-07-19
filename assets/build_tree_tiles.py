#!/usr/bin/env python3
"""
Bake the pine tree tiles (style C, "pine tiered") and embed them into ../assets/js/assets.js
as ASSETS.bark and ASSETS.leaf. Rerun any time; deterministic seeds.
Usage: python3 build_tree_tiles.py
"""
import random, base64, io, os, re
from PIL import Image, ImageDraw

T, CELL = 64, 8
LEAF_CELL = 4      # finer grain so the canopy reads a bit less blocky
LEAF_PAL = [(48,98,50,255),(41,86,44,255),(35,74,38,255),(56,110,58,255)]
BARK = ((78,54,34,255),(58,40,26,255),(96,68,44,255))   # base, dark, light

def bark_tile(seed=11):
    base, dark, light = BARK
    rnd = random.Random(seed)
    im = Image.new('RGBA', (T, T), (0,0,0,0)); d = ImageDraw.Draw(im)
    for cy in range(T//CELL):
        for cx in range(T//CELL):
            r = rnd.random()
            c = dark if (cx in (0, T//CELL-1) and r < 0.7) else (light if r < 0.12 else (dark if r < 0.3 else base))
            d.rectangle([cx*CELL, cy*CELL, cx*CELL+CELL-1, cy*CELL+CELL-1], fill=c)
    for gx in (CELL*2, CELL*5): d.line([(gx,0),(gx,T)], fill=dark, width=2)
    kx, ky = 3*CELL, 4*CELL
    d.ellipse([kx, ky, kx+CELL, ky+CELL+4], outline=dark, width=2)
    d.rectangle([0,0,T-1,T-1], outline=tuple(int(v*0.6) for v in dark[:3])+(255,), width=2)
    return im

def leaf_tile(seed=23):
    rnd = random.Random(seed)
    im = Image.new('RGBA', (T, T), (0,0,0,0)); d = ImageDraw.Draw(im)
    C = LEAF_CELL
    for cy in range(T//C):
        for cx in range(T//C):
            c = LEAF_PAL[min(len(LEAF_PAL)-1, int(rnd.random()*len(LEAF_PAL)))]
            d.rectangle([cx*C, cy*C, cx*C+C-1, cy*C+C-1], fill=c)
    return im

def durl(img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

here = os.path.dirname(os.path.abspath(__file__))
bark = bark_tile(); leaf = leaf_tile()
bark.save(os.path.join(here, 'tiles', 'bark.png'))
leaf.save(os.path.join(here, 'tiles', 'leaf.png'))
aj = os.path.join(here, 'js', 'assets.js')
s = open(aj).read()
for key, img in (('bark', bark), ('leaf', leaf)):
    if '"%s":' % key in s:
        s = re.sub('"%s": "data:image/png;base64,[^"]+"' % key, '"%s": "%s"' % (key, durl(img)), s)
    else:
        s = s.replace('"grass":', '"%s": "%s", "grass":' % (key, durl(img)), 1)
open(aj, 'w').write(s)
print('bark/leaf embedded in assets.js')
