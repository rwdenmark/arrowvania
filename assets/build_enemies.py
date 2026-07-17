#!/usr/bin/env python3
"""
Rebake the eleven enemy sheets (knights 2-3, trolls 1-3, skeletons 1-3,
necromancers 1-3) and write one asset file per family (assets_knights.js, assets_trolls.js,
assets_skeletons.js, assets_necromancers.js), each extending ASSETS. Needs Pillow and the three craftpix zips:

  python3 build_enemies.py KNIGHT_ZIP TROLLS_ZIP NECROMANCER_ZIP

Frames are read straight out of the zips. The necromancer pack ships 4000x1600
frames, so those are pre-shrunk in memory (necromancer 25%, skeleton 30%)
before the shared bake, which scales every enemy so its idle height matches
the archer's and anchors the feet line at y250. The feet-strip center is the
anchor/flip pivot so held-out weapons don't skew it. Frame width is per enemy
(widest pose wins). Built 7/17/2026.
"""
import sys, os, io, re, json, base64, zipfile, collections
from PIL import Image

FH, FRAMES, FEET_Y = 256, 10, 250
BASE_ROWS = ['IDLE', 'WALK', 'RUN', 'JUMP', 'ATTACK', 'DIE', 'HURT']

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
kn_zip, tr_zip, nc_zip = sys.argv[1], sys.argv[2], sys.argv[3]

arch = Image.open(os.path.join(here, 'archer_sheet.png')).convert('RGBA')
ab = arch.crop((0, 0, 288, 256)).getbbox()
TARGET_H = ab[3] - ab[1]

Z = { 'kn': zipfile.ZipFile(kn_zip), 'tr': zipfile.ZipFile(tr_zip), 'nc': zipfile.ZipFile(nc_zip) }
# key, name, zip, path prefix, filename pattern, rows, row->source alias, preshrink
ENEMIES = [
  ('knight2', 'Knight 2', 'kn', '_PNG/2_KNIGHT/Knight_02__%s_', BASE_ROWS, {}, 1.0),
  ('knight3', 'Knight 3', 'kn', '_PNG/3_KNIGHT/Knight_03__%s_', BASE_ROWS, {}, 1.0),
  ('troll1', 'Troll 1', 'tr', '_PNG/1_TROLL/Troll_01_1_%s_', BASE_ROWS, {}, 1.0),
  ('troll2', 'Troll 2', 'tr', '_PNG/2_TROLL/Troll_02_1_%s_', BASE_ROWS, {}, 1.0),
  ('troll3', 'Troll 3', 'tr', '_PNG/3_TROLL/Troll_03_1_%s_', BASE_ROWS, {}, 1.0),
  ('skel1', 'Skeleton 1', 'nc', 'Skeleton/_PNG/1/Skeleton_01__%s_', BASE_ROWS, {}, 0.30),
  ('skel2', 'Skeleton 2', 'nc', 'Skeleton/_PNG/2/Skeleton_02__%s_', BASE_ROWS, {}, 0.30),
  ('skel3', 'Skeleton 3', 'nc', 'Skeleton/_PNG/3/Skeleton_03__%s_', BASE_ROWS, {}, 0.30),
  ('necro1', 'Necromancer 1', 'nc', 'Necromancer/_PNG/1/Necromancer_01__%s_', BASE_ROWS + ['ATTACK2'],
   {'ATTACK': 'ATTACK_01', 'ATTACK2': 'ATTACK_02'}, 0.25),
  ('necro2', 'Necromancer 2', 'nc', 'Necromancer/_PNG/2/Necromancer_02__%s_', BASE_ROWS + ['ATTACK2'],
   {'ATTACK': 'ATTACK_01', 'ATTACK2': 'ATTACK_02'}, 0.25),
  ('necro3', 'Necromancer 3', 'nc', 'Necromancer/_PNG/3/Necromancer_03__%s_', BASE_ROWS + ['ATTACK2'],
   {'ATTACK': 'ATTACK_01', 'ATTACK2': 'ATTACK_02'}, 0.25),
]

def frames_for(z, prefix, anim, alias, pre):
    src = alias.get(anim, anim)
    names = sorted(n for n in z.namelist()
                   if n.startswith(prefix.replace('%s', src) if '%s' in prefix else prefix)
                   and n.lower().endswith('.png'))
    # prefix has %s for the anim slot
    want = prefix % src
    names = sorted(n for n in z.namelist() if want in n and n.lower().endswith('.png'))
    assert len(names) == FRAMES, '%s: %d frames' % (want, len(names))
    out = []
    for n in names:
        im = Image.open(io.BytesIO(z.read(n))).convert('RGBA')
        if pre != 1.0:
            im = im.resize((max(1, round(im.width*pre)), max(1, round(im.height*pre))), Image.LANCZOS)
        out.append(im)
    return out

meta_all, urls = {}, {}
for key, name, zk, prefix, rows, alias, pre in ENEMIES:
    z = Z[zk]
    idle0 = frames_for(z, prefix, 'IDLE', alias, pre)[0]
    ib = idle0.getbbox()
    S = TARGET_H / (ib[3] - ib[1])
    def scaled(img):
        return img.resize((max(1, round(img.width*S)), max(1, round(img.height*S))), Image.LANCZOS)
    si = scaled(idle0); sib = si.getbbox()
    feet_y = sib[3]
    strip = si.crop((0, max(0, feet_y - 24), si.width, feet_y))
    stb = strip.getbbox()
    feet_cx = (stb[0] + stb[2]) / 2
    WIDE, PAD = 900, 300
    def place(img):
        im = Image.new('RGBA', (WIDE, FH), (0,0,0,0))
        sc = scaled(img)
        im.alpha_composite(sc, (round(PAD + 150 - feet_cx), round(FEET_Y - feet_y)))
        return im
    wide_rows, minx, maxx = [], WIDE, 0
    for anim in rows:
        row = [place(f) for f in frames_for(z, prefix, anim, alias, pre)]
        for im in row:
            b = im.getbbox()
            if b: minx, maxx = min(minx, b[0]), max(maxx, b[2])
        wide_rows.append(row)
    x0 = minx - 4
    FW = maxx - x0 + 4
    FW += FW % 2
    anchor_x = round(PAD + 150 - x0)
    sheet = Image.new('RGBA', (FW*FRAMES, FH*len(rows)), (0,0,0,0))
    for r, row in enumerate(wide_rows):
        for c, im in enumerate(row):
            sheet.alpha_composite(im.crop((x0, 0, x0 + FW, FH)), (c*FW, r*FH))
    b = io.BytesIO(); sheet.save(b, 'PNG', optimize=True)
    urls[key] = 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()
    meta_all[key] = { 'FW': FW, 'FH': FH, 'FRAMES': FRAMES, 'ROWS': rows,
                      'anchorX': anchor_x, 'anchorY': FEET_Y, 'CX': anchor_x, 'name': name }
    print(key, 'FW', FW, 'anchorX', anchor_x, 'png KB', len(b.getvalue())//1024)

FAMILIES = [
  ('assets_knights.js', 'knights 2-3', ['knight2','knight3']),
  ('assets_trolls.js', 'trolls 1-3', ['troll1','troll2','troll3']),
  ('assets_skeletons.js', 'skeletons 1-3', ['skel1','skel2','skel3']),
  ('assets_necromancers.js', 'necromancers 1-3', ['necro1','necro2','necro3']),
]
for fname, label, keys in FAMILIES:
    parts = ['  "%s": "%s",' % (k, urls[k]) for k in keys]
    fam_meta = { k: meta_all[k] for k in keys }
    out = ('// %s sheets and metadata, baked by assets/build_enemies.py from the\n'
           '// craftpix zips. Loaded after assets.js, before game.js.\n'
           'Object.assign(ASSETS, {\n' + '\n'.join(parts) + '\n});\n'
           'ASSETS.ENEMIES = Object.assign(ASSETS.ENEMIES || {}, %s);\n') % (label, json.dumps(fam_meta))
    open(os.path.join(root, fname), 'w', encoding='utf-8', newline='').write(out)
    print('wrote', fname, 'MB %.1f' % (len(out)/1e6))
