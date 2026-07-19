#!/usr/bin/env python3
"""
Bake the Knight 1 sheet from the craftpix 2D Fantasy Knight pack and embed it in
../assets/js/assets.js as ASSETS.knight plus ASSETS.KNIGHT metadata. The knight is scaled
so its idle height matches the archer's.

Usage: python3 build_knight.py <path-to-extracted-knight-pack>
"""
import sys, os, io, base64, re, json, glob
from PIL import Image

FW, FH, FRAMES = 288, 256, 10
FEET_Y = 250
ROWS = ['IDLE', 'WALK', 'RUN', 'JUMP', 'ATTACK', 'DIE', 'HURT']

here = os.path.dirname(os.path.abspath(__file__))
pack = os.path.join(sys.argv[1], '_PNG', '1_KNIGHT')

# archer idle content height sets the knight scale
arch = Image.open(os.path.join(here, 'archer_sheet.png')).convert('RGBA')
ab = arch.crop((0, 0, 288, 256)).getbbox()
target_h = ab[3] - ab[1]

def frames(anim):
    return [Image.open(f).convert('RGBA') for f in
            sorted(glob.glob(os.path.join(pack, 'Knight_01__%s_*.png' % anim)))]

idle0 = frames('IDLE')[0]
ib = idle0.getbbox()
S = target_h / (ib[3] - ib[1])
print('scale %.4f (archer h %d, knight h %d)' % (S, target_h, ib[3]-ib[1]))

# first pass on a wide canvas: feet baseline and feet-center from idle frame 0
def scaled(img):
    return img.resize((max(1, round(img.width*S)), max(1, round(img.height*S))), Image.LANCZOS)

si = scaled(idle0); sib = si.getbbox()
feet_cx = (sib[0] + sib[2]) / 2
feet_y = sib[3]

WIDE, PAD = 576, 144
def place(img):
    im = Image.new('RGBA', (WIDE, FH), (0,0,0,0))
    sc = scaled(img)
    im.alpha_composite(sc, (round(PAD + 288/2 - feet_cx), round(FEET_Y - feet_y)))
    return im

wide_rows, minx, maxx = [], WIDE, 0
for anim in ROWS:
    row = [place(f) for f in frames(anim)]
    for im in row:
        b = im.getbbox()
        if b: minx, maxx = min(minx, b[0]), max(maxx, b[2])
    wide_rows.append(row)
x0 = minx - 4
assert maxx - x0 <= FW, 'knight content wider than frame: %d' % (maxx - x0)
anchor_x = round(PAD + 288/2 - x0)

sheet = Image.new('RGBA', (FW*FRAMES, FH*len(ROWS)), (0,0,0,0))
for r, row in enumerate(wide_rows):
    for c, im in enumerate(row):
        sheet.alpha_composite(im.crop((x0, 0, x0+FW, FH)), (c*FW, r*FH))
sheet.save(os.path.join(here, 'knight_sheet.png'))

def durl(img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

meta = { 'FW': FW, 'FH': FH, 'FRAMES': FRAMES, 'ROWS': ROWS,
         'anchorX': anchor_x, 'anchorY': FEET_Y }
aj = os.path.join(here, 'js', 'assets.js')
s = open(aj).read()
s = re.sub(r'"knight": "data:image/png;base64,[^"]+", ', '', s)
s = re.sub(r'"KNIGHT": \{[^}]*\}, ', '', s)
s = s.replace('"grass":', '"knight": "%s", "KNIGHT": %s, "grass":' % (durl(sheet), json.dumps(meta)), 1)
open(aj, 'w').write(s)
print('knight sheet', sheet.size, 'anchor', anchor_x, FEET_Y)
