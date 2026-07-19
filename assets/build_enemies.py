#!/usr/bin/env python3
"""
Rebake the enemy sheets (knights 2-3, trolls 1-3, skeletons 1-3, necromancers
1-3, orcs 1-3, elves 1-3, warriors 1-3, pirates 1-3) and write one asset file
per family (assets_knights.js, assets_trolls.js, assets_skeletons.js,
assets_necromancers.js, assets_orcs.js, assets_elves.js, assets_warriors.js,
assets_pirates.js), each extending ASSETS. Needs Pillow, numpy, and the seven
craftpix zips:

  python3 build_enemies.py KNIGHT_ZIP TROLLS_ZIP NECROMANCER_ZIP ORC_ZIP ELF_ZIP WARRIOR_ZIP PIRATE_ZIP

Frames are read straight out of the zips. Oversized packs are pre-shrunk in
memory before the shared bake, which scales every enemy so its idle height
matches the archer's and anchors the feet line at y250. The feet-strip center
is the anchor/flip pivot so held-out weapons don't skew it. Frame width is per
enemy (widest pose wins). Pirates ship 7 frames per row, resampled to 10 so
the engine's FRAMES=10 assumption holds. Ranged attackers (elf1, elf3,
warrior3, pirate2) get their baked-in flying projectiles clipped from the
ATTACK row, the engine fires its own bolt instead. Built 7/17/2026.
"""
import sys, os, io, re, json, base64, zipfile
import numpy as np
from scipy import ndimage
from PIL import Image

FH, FRAMES, FEET_Y = 256, 10, 250
BASE_ROWS = ['IDLE', 'WALK', 'RUN', 'JUMP', 'ATTACK', 'DIE', 'HURT']
# key -> (launch frame, tight post-launch clip, frame holding the flying
# projectile to lift out as the engine's bolt sprite)
RANGED = {'elf1': (7, True, 8), 'elf3': (7, True, None), 'warrior3': (6, True, 9),
          'pirate2': (8, False, 9)}

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, 'js')   # baked packs live in assets/js
Z = { k: zipfile.ZipFile(p) for k, p in
      zip(['kn', 'tr', 'nc', 'or', 'el', 'wa', 'pi'], sys.argv[1:8]) }

arch = Image.open(os.path.join(here, 'archer_sheet.png')).convert('RGBA')
ab = arch.crop((0, 0, 288, 256)).getbbox()
TARGET_H = ab[3] - ab[1]

# key, name, zip, filename pattern, rows, row->source alias, preshrink, native frames
ENEMIES = [
  ('knight2', 'Knight 2', 'kn', '_PNG/2_KNIGHT/Knight_02__%s_', BASE_ROWS, {}, 1.0, 10),
  ('knight3', 'Knight 3', 'kn', '_PNG/3_KNIGHT/Knight_03__%s_', BASE_ROWS, {}, 1.0, 10),
  ('troll1', 'Troll 1', 'tr', '_PNG/1_TROLL/Troll_01_1_%s_', BASE_ROWS, {}, 1.0, 10),
  ('troll2', 'Troll 2', 'tr', '_PNG/2_TROLL/Troll_02_1_%s_', BASE_ROWS, {}, 1.0, 10),
  ('troll3', 'Troll 3', 'tr', '_PNG/3_TROLL/Troll_03_1_%s_', BASE_ROWS, {}, 1.0, 10),
  ('skel1', 'Skeleton 1', 'nc', 'Skeleton/_PNG/1/Skeleton_01__%s_', BASE_ROWS, {}, 0.30, 10),
  ('skel2', 'Skeleton 2', 'nc', 'Skeleton/_PNG/2/Skeleton_02__%s_', BASE_ROWS, {}, 0.30, 10),
  ('skel3', 'Skeleton 3', 'nc', 'Skeleton/_PNG/3/Skeleton_03__%s_', BASE_ROWS, {}, 0.30, 10),
  ('necro1', 'Necromancer 1', 'nc', 'Necromancer/_PNG/1/Necromancer_01__%s_', BASE_ROWS + ['ATTACK2'],
   {'ATTACK': 'ATTACK_01', 'ATTACK2': 'ATTACK_02'}, 0.25, 10),
  ('necro2', 'Necromancer 2', 'nc', 'Necromancer/_PNG/2/Necromancer_02__%s_', BASE_ROWS + ['ATTACK2'],
   {'ATTACK': 'ATTACK_01', 'ATTACK2': 'ATTACK_02'}, 0.25, 10),
  ('necro3', 'Necromancer 3', 'nc', 'Necromancer/_PNG/3/Necromancer_03__%s_', BASE_ROWS + ['ATTACK2'],
   {'ATTACK': 'ATTACK_01', 'ATTACK2': 'ATTACK_02'}, 0.25, 10),
  ('orc1', 'Orc 1', 'or', '_PNG/1_ORK/ORK_01_%s_', BASE_ROWS, {'ATTACK': 'ATTAK'}, 0.35, 10),
  ('orc2', 'Orc 2', 'or', '_PNG/2_ORK/ORK_02_%s_', BASE_ROWS, {'ATTACK': 'ATTAK'}, 0.35, 10),
  ('orc3', 'Orc 3', 'or', '_PNG/3_ORK/ORK_03_%s_', BASE_ROWS, {'ATTACK': 'ATTAK'}, 0.35, 10),
  ('elf1', 'Elf 1', 'el', '_PNG/1/Elf_01__%s_', BASE_ROWS, {}, 0.35, 10),
  ('elf2', 'Elf 2', 'el', '_PNG/2/Elf_02__%s_', BASE_ROWS, {}, 0.35, 10),
  ('elf3', 'Elf 3', 'el', '_PNG/3/Elf_03__%s_', BASE_ROWS, {}, 0.35, 10),
  ('warrior1', 'Warrior 1', 'wa', '_PNG/1/Warrior_01__%s_', BASE_ROWS, {}, 0.30, 10),
  ('warrior2', 'Warrior 2', 'wa', '_PNG/2/Warrior_02__%s_', BASE_ROWS, {}, 0.30, 10),
  ('warrior3', 'Warrior 3', 'wa', '_PNG/3/Warrior_03__%s_', BASE_ROWS, {}, 0.30, 10),
  ('pirate1', 'Pirate 1', 'pi', 'PNG/1/1_entity_000_%s_', BASE_ROWS, {}, 0.30, 7),
  ('pirate2', 'Pirate 2', 'pi', 'PNG/2/2_entity_000_%s_', BASE_ROWS, {}, 0.30, 7),
  ('pirate3', 'Pirate 3', 'pi', 'PNG/3/3_3-PIRATE_%s_', BASE_ROWS, {}, 0.30, 7),
]

def frames_for(z, prefix, anim, alias, pre, native):
    want = prefix % alias.get(anim, anim)
    names = sorted(n for n in z.namelist() if want in n and n.lower().endswith('.png'))
    assert len(names) == native, '%s: %d frames' % (want, len(names))
    out = []
    for n in names:
        im = Image.open(io.BytesIO(z.read(n))).convert('RGBA')
        if pre != 1.0:
            im = im.resize((max(1, round(im.width*pre)), max(1, round(im.height*pre))), Image.LANCZOS)
        out.append(im)
    if native != FRAMES:
        out = [out[i*native//FRAMES] for i in range(FRAMES)]
    return out

def clip_beyond(img, limit):
    a = np.array(img)
    if a.shape[1] <= limit: return img
    fade = np.ones(a.shape[1])
    fade[limit:] = 0.0
    lo = max(0, limit - 12)
    fade[lo:limit] = np.linspace(1.0, 0.0, limit - lo, endpoint=False)
    a[..., 3] = (a[..., 3] * fade[None, :]).astype(np.uint8)
    return Image.fromarray(a)

def level_bolt(im):
    # straighten the lifted projectile: the packs draw the flying arrow at a
    # slight tilt. Pick the rotation that minimizes content height
    best, bh = im, 1e9
    for d10 in range(-120, 121, 5):
        r = im.rotate(d10/10, resample=Image.BICUBIC, expand=True)
        b = r.getbbox()
        if b and (b[3] - b[1]) < bh: best, bh = r.crop(b), b[3] - b[1]
    return best

def split_flyers(img):
    # detached blobs flying ahead of the body: (cleaned frame, biggest blob crop)
    a = np.array(img)
    mask = a[..., 3] > 50
    lab, n = ndimage.label(mask)
    if n < 2: return img, None, None
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    body = int(np.argmax(sizes)) + 1
    body_max_x = np.where((lab == body).any(axis=0))[0].max()
    best = None
    for c in range(1, n + 1):
        if c == body: continue
        xs = np.where((lab == c).any(axis=0))[0]
        if xs.min() <= body_max_x: continue
        if best is None or sizes[c - 1] > sizes[best - 1]: best = c
        a[lab == c] = 0
    crop, cy = None, None
    if best is not None and sizes[best - 1] > 40:
        m2 = np.array(img); m2[lab != best] = 0
        bb = Image.fromarray(m2).getbbox()
        crop = Image.fromarray(m2).crop(bb)
        cy = (bb[1] + bb[3]) / 2
    return Image.fromarray(a), crop, cy

def strip_projectiles(frames, launch, tight, bolt_frame):
    # the flying arrow/orb/bullet is alpha-bridged to the body, so a component
    # split can't isolate it. Before launch, clip columns beyond the pre-launch
    # frames' extent (weapon fully presented, nocked arrow included). From the
    # launch frame on the engine draws the projectile, so tight types (bows,
    # the staff) clip at the early frames' extent, removing the baked shot
    # instead of leaving a floating piece of it. A short fade softens the cut
    bolt, spawn = None, None
    cleaned, flew = [], []
    for i, f in enumerate(frames):
        if i >= launch:
            f, crop, cy = split_flyers(f)
            if crop is not None: flew.append((cy, crop.height))
            if i == bolt_frame and crop is not None: bolt = crop
        cleaned.append(f)
    ext = lambda fs: max((f.getbbox()[2] for f in fs if f.getbbox()), default=0)
    pre = ext(cleaned[:launch]) + 8
    post = (ext(cleaned[:3]) + 8) if tight else pre
    if tight and bolt is not None:
        # the nock band: shaft content just past the bow on the frame nearest
        # release. Its center height is the true launch height, and copying the
        # clean last frame's band over the post-launch frames removes the
        # arrow still painted across the bow (the pose there is static)
        band = None
        for i in (launch, launch - 1):
            arr = np.array(cleaned[i])
            ys = np.where((arr[:, post:, 3] > 50).any(axis=1))[0]
            if len(ys): band = (int(ys.min()), int(ys.max())); break
        if band is not None:
            # cover the arrow's whole vertical travel: some frames leave an
            # attached piece (fletching) above the nock band
            y0, y1 = band[0] - 6, band[1] + 7
            for cy, h in flew:
                y0 = min(y0, int(cy - h/2) - 8)
                y1 = max(y1, int(cy + h/2) + 9)
            x0 = max(0, post - bolt.width - 12)
            ref = np.array(cleaned[9])
            for i in range(launch, 9):
                arr = np.array(cleaned[i])
                arr[y0:y1, x0:] = ref[y0:y1, x0:]
                cleaned[i] = Image.fromarray(arr)
            spawn = ((pre - 8) - bolt.width / 2, (band[0] + band[1]) / 2)
    return [clip_beyond(f, pre if i < launch else post) for i, f in enumerate(cleaned)], bolt, spawn

meta_all, urls, bolt_from = {}, {}, {}
for key, name, zk, prefix, rows, alias, pre, native in ENEMIES:
    z = Z[zk]
    idle0 = frames_for(z, prefix, 'IDLE', alias, pre, native)[0]
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
        frames = frames_for(z, prefix, anim, alias, pre, native)
        if key in RANGED and anim == 'ATTACK':
            frames, bolt, spawn = strip_projectiles(frames, *RANGED[key])
            if bolt is not None:
                bolt = level_bolt(bolt)
                sc = bolt.resize((max(1, round(bolt.width*S)), max(1, round(bolt.height*S))), Image.LANCZOS)
                bio = io.BytesIO(); sc.save(bio, 'PNG', optimize=True)
                urls[key + '_bolt'] = 'data:image/png;base64,' + base64.b64encode(bio.getvalue()).decode()
                print(key, 'bolt sprite', sc.size)
            if spawn is not None and RANGED[key][1]:
                # launch point as world px offsets from body center and feet
                # (raw -> wide canvas via the place() transform, sheet is 2x world)
                ox = round(PAD + 150 - feet_cx); oy = round(FEET_Y - feet_y)
                bolt_from[key] = [round((ox + spawn[0]*S - (PAD + 150))/2),
                                  round((oy + spawn[1]*S - FEET_Y)/2)]
        row = [place(f) for f in frames]
        for im in row:
            b = im.getbbox()
            if b: minx, maxx = min(minx, b[0]), max(maxx, b[2])
        wide_rows.append(row)
    # ground the death animation: several packs (trolls, elves) lift the
    # toppling body off the baseline, leaving the corpse floating in game.
    # Shift any DIE frame whose content ends above the feet line down onto it.
    # elf3's pack also ends on a bad final frame (the corpse pops back
    # upright), so it holds frame 8 instead
    die = rows.index('DIE')
    if key == 'elf3': wide_rows[die][9] = wide_rows[die][8].copy()
    for c, im in enumerate(wide_rows[die]):
        b = im.getbbox()
        if b and b[3] < FEET_Y:
            nf = Image.new('RGBA', im.size, (0,0,0,0))
            nf.paste(im, (0, FEET_Y - b[3]))   # no mask: exact copy, no alpha blend
            wide_rows[die][c] = nf
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
    if key in bolt_from: meta_all[key]['BOLT_FROM'] = bolt_from[key]
    print(key, 'FW', FW, 'anchorX', anchor_x, 'png KB', len(b.getvalue())//1024)

FAMILIES = [
  ('assets_knights.js', 'knights 2-3', ['knight2','knight3']),
  ('assets_trolls.js', 'trolls 1-3', ['troll1','troll2','troll3']),
  ('assets_skeletons.js', 'skeletons 1-3', ['skel1','skel2','skel3']),
  ('assets_necromancers.js', 'necromancers 1-3', ['necro1','necro2','necro3']),
  ('assets_orcs.js', 'orcs 1-3', ['orc1','orc2','orc3']),
  ('assets_elves.js', 'elves 1-3', ['elf1','elf2','elf3']),
  ('assets_warriors.js', 'warriors 1-3', ['warrior1','warrior2','warrior3']),
  ('assets_pirates.js', 'pirates 1-3', ['pirate1','pirate2','pirate3']),
]
for fname, label, keys in FAMILIES:
    parts = ['  "%s": "%s",' % (k, urls[k]) for k in keys]
    parts += ['  "%s_bolt": "%s",' % (k, urls[k + '_bolt']) for k in keys if k + '_bolt' in urls]
    fam_meta = { k: meta_all[k] for k in keys }
    out = ('// %s sheets and metadata, baked by assets/build_enemies.py from the\n'
           '// craftpix zips. Loaded after assets.js, before game.js.\n'
           'Object.assign(ASSETS, {\n' + '\n'.join(parts) + '\n});\n'
           'ASSETS.ENEMIES = Object.assign(ASSETS.ENEMIES || {}, %s);\n') % (label, json.dumps(fam_meta))
    open(os.path.join(root, fname), 'w', encoding='utf-8', newline='').write(out)
    print('wrote', fname, 'MB %.1f' % (len(out)/1e6))
