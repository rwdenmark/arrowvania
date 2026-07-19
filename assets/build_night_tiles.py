#!/usr/bin/env python3
"""
Regenerate the sandbox2 night tiles and re-inject them into ../assets/js/assets.js.
The night theme is a palette remap of the embedded sandbox1 day tiles, so the
texture stays pixel-identical. Also writes tiles/night_*.png as source copies.
Usage: python3 build_night_tiles.py   (needs Pillow)
Chosen 7/17/2026: fog silver grass on charcoal ash dirt, graphite bark,
ashgray leaf (cloud-oak crown shape, unchanged lobes).
"""
import base64, io, os, re
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
aj = os.path.join(here, 'js', 'assets.js')
s = open(aj, encoding='utf-8').read()

def grab(key):
    m = re.search('"%s": "data:image/png;base64,([^"]+)"' % key, s)
    return Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert('RGBA')

def remap(im, mapping):
    out = im.copy(); px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            p = px[x, y]
            if p[:3] in mapping and p[3] > 0:
                px[x, y] = mapping[p[:3]] + (p[3],)
    return out

G_GREEN = [(38,92,40), (66,140,54), (120,196,84), (150,220,110)]
D_COLS  = [(107,70,42), (74,48,28), (140,96,58)]
B_COLS  = [(78,54,34), (58,40,26), (34,24,15), (96,68,44)]
L_COLS  = [(35,74,38), (41,86,44), (48,98,50), (56,110,58)]

CHARCOAL   = [(54,54,58),(34,34,38),(78,78,84)]      # dirt: charcoal ash
FOG_SILVER = [(58,64,60),(90,98,92),(124,134,126),(160,172,162)]   # grass cap
GRAPHITE_B = [(48,48,52),(34,34,38),(18,18,21),(64,64,70)]         # bark
ASHGRAY_L  = [(44,46,48),(52,54,56),(60,63,66),(70,73,77)]         # leaf

tiles = {
    'night_grass': remap(grab('grass'), dict(list(zip(G_GREEN, FOG_SILVER)) + list(zip(D_COLS, CHARCOAL)))),
    'night_dirt':  remap(grab('dirt'),  dict(zip(D_COLS, CHARCOAL))),
    'night_bark':  remap(grab('bark'),  dict(zip(B_COLS, GRAPHITE_B))),
    'night_leaf':  remap(grab('leaf'),  dict(zip(L_COLS, ASHGRAY_L))),
}
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
