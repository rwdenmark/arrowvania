#!/usr/bin/env python3
"""
Generate the sandbox3 castle tiles and inject them into ../assets/js/assets.js.
Three 64x64 tiles, chunky 2px texels, all seamless:
  castle_cap  - mossy capstone walk surface (grass slot), 3D lip + contact
                shadow over the sett fill in the same tile
  castle_fill - granite setts (dirt slot)
  castle_wall - ivy ashlar in the same granite palette (map value 6)
Also writes tiles/castle_*.png as source copies. Idempotent.
Usage: python3 build_castle_tiles.py   (needs Pillow)
Chosen 7/18/2026: granite setts floor, ivy ashlar wall, mossy caps.
"""
import base64, io, math, os, re
from PIL import Image, ImageDraw

T, S = 32, 2          # 32 texels at 2px = 64px tile
CAP_H = 11            # cap band height in texels

here = os.path.dirname(os.path.abspath(__file__))
aj = os.path.join(here, 'js', 'assets.js')
s = open(aj, encoding='utf-8').read()

def h2(x, y, salt=0):
    n = (x*73856093) ^ (y*19349663) ^ (salt*83492791)
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0x7fffffff) / 0x7fffffff

def P(d, x, y, c):
    x %= T
    d.rectangle([x*S, (y % T)*S, x*S+S-1, (y % T)*S+S-1], fill=c)

MORTAR = (78, 80, 86)
SETTS = [(140,142,148), (122,124,130), (154,156,162)]
IVY_D, IVY_M, IVY_L = (48,84,44), (54,110,58), (74,140,66)

def setts_tile():
    im = Image.new('RGB', (T*S, T*S), MORTAR)
    d = ImageDraw.Draw(im)
    BW, BH = 8, 4                      # both divide 32, so the wrap is seam-free
    for r in range(T//BH):
        y0 = r*BH
        off = (r % 2)*(BW//2)
        for b in range(T//BW):
            x0 = b*BW + off
            ci = int(h2(b, r, 7)*3)
            for yy in range(BH-1):
                for xx in range(BW-1):
                    c = SETTS[ci]
                    if yy == 0: c = tuple(min(255, v+18) for v in c)
                    if yy == BH-2 or xx == BW-2: c = tuple(max(0, v-16) for v in c)
                    if h2((x0+xx) % T, (y0+yy) % T, 9) > 0.92: c = tuple(max(0, v-12) for v in c)
                    P(d, x0+xx, y0+yy, c)
    return im

def wall_tile():
    im = Image.new('RGB', (T*S, T*S), MORTAR)
    d = ImageDraw.Draw(im)
    BW, BH = 16, 8
    blocks = [SETTS[0], SETTS[1]]
    for r in range(T//BH):
        y0 = r*BH
        off = (r % 2)*(BW//2)
        for b in range(T//BW):
            x0 = b*BW + off
            ci = int(h2(b, r, 101)*2)
            for yy in range(BH-1):
                for xx in range(BW-1):
                    c = blocks[ci]
                    if yy == 0 or xx == 0: c = tuple(min(255, v+20) for v in c)
                    if yy == BH-2 or xx == BW-2: c = tuple(max(0, v-20) for v in c)
                    if h2((x0+xx) % T, (y0+yy) % T, 106) > 0.9: c = tuple(max(0, v-12) for v in c)
                    P(d, x0+xx, y0+yy, c)
    # ivy vines: x(y) is periodic in y (two sine harmonics), so a vine leaving the
    # bottom of one tile enters the top of the next at the same texel
    for vi, vx in enumerate([3, 12, 22, 28]):
        a1 = 1.6 + h2(vi, 0, 201)*1.0
        a2 = 0.5 + h2(vi, 1, 202)*0.5
        p1 = h2(vi, 2, 203)*math.tau
        p2 = h2(vi, 3, 204)*math.tau
        xs = [vx + round(a1*math.sin(math.tau*y/T + p1) + a2*math.sin(2*math.tau*y/T + p2)) for y in range(T)]
        for y in range(T):
            x = xs[y]
            P(d, x, y, IVY_D)
            dx = xs[(y+1) % T] - x
            if dx: P(d, x + dx, y, IVY_D)
            if h2(x, y, 113) > 0.35:
                lx = x + (2 if h2(x, y, 114) > 0.5 else -2)
                P(d, lx, y, IVY_L if h2(lx, y, 115) > 0.5 else IVY_M)
            if h2(x, y, 116) > 0.7:
                P(d, x + (1 if h2(x, y, 117) > 0.5 else -1), y, IVY_M)
    return im

def cap_tile(fill):
    im = fill.copy()
    d = ImageDraw.Draw(im)
    for x in range(T):                 # contact shadow onto the setts below the cap
        for y, f in ((CAP_H, 0.55), (CAP_H+1, 0.78)):
            px = im.getpixel((x*S, y*S))
            P(d, x, y, tuple(int(v*f) for v in px[:3]))
    top, face, joint, dark = (128,132,130), (98,102,100), (72,76,74), (62,66,64)
    for x in range(T):
        P(d, x, 0, tuple(min(255, v+22) for v in top))
        P(d, x, 1, top)
        for y in range(2, CAP_H-1):
            c = face
            if h2(x, y, 55) > 0.9: c = tuple(max(0, v-10) for v in c)
            P(d, x, y, c)
        P(d, x, CAP_H-1, dark)
    for jx in range(2, T+11, 11):      # capstone joints
        for y in range(2, CAP_H-1):
            P(d, jx % T, y, joint)
    for x in range(T):                 # moss creeping over the lit edge
        if h2(x, 0, 77) > 0.45: P(d, x, 0, IVY_L)
        if h2(x, 1, 78) > 0.72: P(d, x, 1, IVY_M)
    return im

fill = setts_tile()
tiles = {
    'castle_fill': fill,
    'castle_wall': wall_tile(),
    'castle_cap':  cap_tile(fill),
}
os.makedirs(os.path.join(here, 'tiles'), exist_ok=True)
for k, im in tiles.items():
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True)
    im.save(os.path.join(here, 'tiles', k + '.png'), optimize=True)
    durl = 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()
    if '"%s":' % k in s:
        s = re.sub('"%s": "data:image/png;base64,[^"]+"' % k, '"%s": "%s"' % (k, durl), s)
    else:
        s = s.replace('"grass":', '"%s": "%s", "grass":' % (k, durl), 1)
open(aj, 'w', encoding='utf-8', newline='').write(s)
print('baked:', ', '.join(tiles))
