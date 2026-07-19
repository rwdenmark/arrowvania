#!/usr/bin/env python3
"""
Rebuild archer_sheet.png, bowarm_strip.png, and ../assets/js/assets.js from the craftpix
Spriter rig (archer 1) in craftpix-993351-2d-fantasy-archer-sprite-sheets.

Usage:
    python3 build_sheet.py <path-to-extracted-craftpix-pack>

Sheet rows (10 frames of 144x128 each):
    0 IDLE   1 WALK   2 RUN   3 JUMP        full body, used when not attacking
    4 ATTACK torso                          body/head/draw arm/quiver, no legs, no bow arm
    5 LEGS idle  6 LEGS walk  7 LEGS run  8 LEGS jump   legs only, played under the attack torso
bowarm_strip.png: 10 frames of the bow arm assembly (arm left + fingers + bow + nocked
arrow) baked around the shoulder pivot, rotated at runtime toward the aim.
"""
import sys, math, base64, io, re, os
import xml.etree.ElementTree as ET
from PIL import Image

SS = 2                    # supersample: sheet is baked at 2x and drawn at half size
FRAME_W, FRAME_H, FRAMES = 144*SS, 128*SS, 10
ANCHOR_X, ANCHOR_Y = 32*SS, 125*SS
FEET_Y = 126.0*SS         # frame y of the idle feet baseline
TARGET_IDLE_W = 62.0*SS   # widest idle frame fits inside one 64px tile on screen

class T:
    __slots__=('x','y','a','sx','sy','alpha')
    def __init__(s,x=0,y=0,a=0,sx=1,sy=1,alpha=1): s.x,s.y,s.a,s.sx,s.sy,s.alpha=x,y,a,sx,sy,alpha

def combine(p, c):
    px = c.x*p.sx; py = c.y*p.sy
    co, si = math.cos(math.radians(p.a)), math.sin(math.radians(p.a))
    return T(p.x + px*co - py*si, p.y + px*si + py*co, p.a + c.a, p.sx*c.sx, p.sy*c.sy, p.alpha*c.alpha)

def lerp(a,b,f): return a+(b-a)*f
def alerp(a,b,spin,f):
    if spin==0 or f==0: return a
    if spin>=1 and b<a: b+=360
    if spin<=-1 and b>a: b-=360
    return a+(b-a)*f

class Scml:
    def __init__(self, path):
        r = ET.parse(path).getroot()
        self.files = {}
        for fo in r.findall('folder'):
            for f in fo.findall('file'):
                self.files[(int(fo.get('id')), int(f.get('id')))] = {
                    'name': f.get('name'), 'w': int(f.get('width')), 'h': int(f.get('height')),
                    'px': float(f.get('pivot_x',0)), 'py': float(f.get('pivot_y',1))}
        self.anims = {a.get('name'): a for a in r.find('entity').findall('animation')}

    def _tkey(self, k):
        el = k.find('bone') if k.find('bone') is not None else k.find('object')
        d = {'time': int(k.get('time','0')), 'spin': int(k.get('spin','1')),
             'x': float(el.get('x',0)), 'y': float(el.get('y',0)), 'a': float(el.get('angle',0)),
             'sx': float(el.get('scale_x',1)), 'sy': float(el.get('scale_y',1)),
             'alpha': float(el.get('a',1))}
        if el.tag=='object':
            d['folder']=int(el.get('folder',0)); d['file']=int(el.get('file',0))
            d['px']=el.get('pivot_x'); d['py']=el.get('pivot_y')
        return d

    def sample(self, name, t):
        anim = self.anims[name]; L = int(anim.get('length'))
        looping = anim.get('looping','true')=='true'
        t = t % L if looping else min(t, L)
        ml = anim.find('mainline').findall('key')
        mk = ml[0]
        for k in ml:
            if int(k.get('time','0')) <= t: mk = k
        tls = {int(tl.get('id')): tl for tl in anim.findall('timeline')}
        def interp(tlid):
            keys = [self._tkey(k) for k in tls[tlid].findall('key')]
            i = 0
            for j,kd in enumerate(keys):
                if kd['time'] <= t: i = j
            k1 = keys[i]
            if i+1 >= len(keys):
                if looping and len(keys)>1 and keys[0]['time']==0:
                    k2 = dict(keys[0]); k2['time'] = L
                else: k2 = k1
            else: k2 = keys[i+1]
            dt = k2['time']-k1['time']
            f = 0 if dt<=0 else (t-k1['time'])/dt
            out = dict(k1)
            out['x']=lerp(k1['x'],k2['x'],f); out['y']=lerp(k1['y'],k2['y'],f)
            out['a']=alerp(k1['a'],k2['a'],k1['spin'],f)
            out['sx']=lerp(k1['sx'],k2['sx'],f); out['sy']=lerp(k1['sy'],k2['sy'],f)
            out['alpha']=lerp(k1['alpha'],k2['alpha'],f)
            return out
        bones = {}
        for br in mk.findall('bone_ref'):
            d = interp(int(br.get('timeline')))
            loc = T(d['x'],d['y'],d['a'],d['sx'],d['sy'])
            par = br.get('parent')
            bones[int(br.get('id'))] = combine(bones[int(par)], loc) if par is not None else loc
        out = []
        for orf in sorted(mk.findall('object_ref'), key=lambda o: int(o.get('z_index'))):
            d = interp(int(orf.get('timeline')))
            loc = T(d['x'],d['y'],d['a'],d['sx'],d['sy'],d['alpha'])
            par = orf.get('parent')
            w = combine(bones[int(par)], loc) if par is not None else loc
            fi = self.files[(d['folder'], d['file'])]
            px = float(d['px']) if d['px'] is not None else fi['px']
            py = float(d['py']) if d['py'] is not None else fi['py']
            out.append({'file': fi, 'T': w, 'px': px, 'py': py})
        return out, bones

def render(parts, imgdir, size, ox, oy, S, names=None, keep_arrow=False, cache={}):
    canvas = Image.new('RGBA', size, (0,0,0,0))
    for p in parts:
        nm = p['file']['name']
        base = nm.rsplit('.',1)[0].split('_',1)[-1]  # '1_arm left.png' -> 'arm left'
        if names is not None and base not in names: continue
        # 'arrow' is both the nocked arrow and (as arrow_000) the released one flying
        # off. The game spawns its own projectile, so the baked assembly only keeps
        # the arrow while it is actually nocked (keep_arrow set on that frame).
        if base == 'arrow' and not keep_arrow: continue
        fi = p['file']; tr = p['T']
        if nm not in cache: cache[nm] = Image.open(os.path.join(imgdir, nm)).convert('RGBA')
        img = cache[nm]
        if tr.alpha < 1:
            img = img.copy(); img.putalpha(img.getchannel('A').point(lambda v: int(v*tr.alpha)))
        qx = p['px']*fi['w']; qy = (1-p['py'])*fi['h']
        th = math.radians(tr.a); co, si = math.cos(th), math.sin(th)
        a11 = S*tr.sx*co; a12 = S*tr.sy*si
        a21 = -S*tr.sx*si; a22 = S*tr.sy*co
        c1 = ox + S*tr.x - a11*qx - a12*qy
        c2 = oy - S*tr.y - a21*qx - a22*qy
        det = a11*a22 - a12*a21
        inv = (a22/det, -a12/det, -(a22*c1 - a12*c2)/det,
               -a21/det, a11/det, -(-a21*c1 + a11*c2)/det)
        canvas.alpha_composite(img.transform(size, Image.AFFINE, inv, resample=Image.BICUBIC))
    return canvas

TORSO = {'head','body','arm right','hand right','quiver'}
LEGS  = {'leg left','leg right'}
BOWARM = {'arm left','fingers left','bow1','bow2','arrow'}

def main():
    pack = sys.argv[1]
    scml_dir = os.path.join(pack, '_SCML', '1')
    sc = Scml(os.path.join(scml_dir, '1_ARCHER.scml'))

    # World-space calibration: scale so the widest IDLE frame fits a tile,
    # baseline and center from IDLE frame 0.
    wmax = 0
    for f in range(FRAMES):
        p,_ = sc.sample('_IDLE', f*100)
        b = render(p, scml_dir, (4000,3000), 2000, 1500, 1.0).getbbox()
        wmax = max(wmax, b[2]-b[0])
    S = TARGET_IDLE_W / wmax
    parts,_ = sc.sample('_IDLE', 0)
    probe = render(parts, scml_dir, (4000,3000), 2000, 1500, 1.0)
    bb = probe.getbbox()
    legs = render(parts, scml_dir, (4000,3000), 2000, 1500, 1.0, names=LEGS)
    lb = legs.getbbox()
    cx_canvas = (lb[0]+lb[2])/2          # feet center x (canvas px, ox=2000)
    feet_canvas = bb[3]                  # lowest pixel
    OX = ANCHOR_X - S*(cx_canvas-2000)   # fx = OX + S*wx_canvasunits
    OY = FEET_Y - S*(feet_canvas-1500)
    def bake(anim, t, names=None, size=(FRAME_W,FRAME_H), ox=None, oy=None, keep_arrow=False):
        parts,bones = sc.sample(anim, t)
        return render(parts, scml_dir, size, OX if ox is None else ox, OY if oy is None else oy, S,
                      names=names, keep_arrow=keep_arrow), bones

    # First pass on a wide canvas to find the widest content, then choose one global
    # crop window so no row clips and every layer shares the same mapping.
    WIDE = 288*SS; PAD = 72*SS
    specs = [('_IDLE',None),('_WALK',None),('_RUN',None),('_JUMP',None),
             ('_ATTACK',TORSO),
             ('_IDLE',LEGS),('_WALK',LEGS),('_RUN',LEGS),('_JUMP',LEGS),
             ('_HURT',None)]
    wide_rows, minx, maxx = [], WIDE, 0
    for anim, names in specs:
        row = []
        for f in range(FRAMES):
            im,_ = bake(anim, f*100, names=names, size=(WIDE,FRAME_H), ox=OX+PAD)
            b = im.getbbox()
            if b: minx, maxx = min(minx,b[0]), max(maxx,b[2])
            row.append(im)
        wide_rows.append(row)
    x0 = minx - 4
    assert maxx - x0 <= FRAME_W, 'content wider than frame: %d' % (maxx-x0)
    anchor_x = int(round(ANCHOR_X + PAD - x0))

    sheet = Image.new('RGBA', (FRAME_W*FRAMES, FRAME_H*len(wide_rows)), (0,0,0,0))
    for r,row in enumerate(wide_rows):
        for c,im in enumerate(row):
            sheet.alpha_composite(im.crop((x0,0,x0+FRAME_W,FRAME_H)), (c*FRAME_W, r*FRAME_H))
    sheet.save(os.path.join(os.path.dirname(__file__), 'archer_sheet.png'))

    # Shoulder pivot (arm left object position) per attack frame, in frame coords.
    shoulders = []
    for f in range(FRAMES):
        parts,_ = sc.sample('_ATTACK', f*100)
        arm = next(p for p in parts if p['file']['name'].endswith('arm left.png'))
        fx = OX + S*arm['T'].x
        fy = OY - S*arm['T'].y
        shoulders.append((fx, fy))

    # Bow arm assembly frames baked around the shoulder pivot.
    K = 96*SS; PV = K//2
    strip = Image.new('RGBA', (K*FRAMES, K), (0,0,0,0))
    for f in range(FRAMES):
        sx, sy = shoulders[f]
        im,_ = bake('_ATTACK', f*100, names=BOWARM, size=(K,K), ox=OX-(sx-PV), oy=OY-(sy-PV),
                    keep_arrow=(f==4))
        strip.alpha_composite(im, (f*K, 0))
    strip.save(os.path.join(os.path.dirname(__file__), 'bowarm_strip.png'))

    # Regenerate assets/js/assets.js, reusing the existing tile/arrow data URLs.
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js')
    old = open(os.path.join(root,'assets.js')).read()
    def keep(key):
        m = re.search('"%s": "(data:image/png;base64,[^"]+)"' % key, old)
        return m.group(1) if m else None
    def durl(img):
        b = io.BytesIO(); img.save(b,'PNG',optimize=True)
        return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()
    sh = [[round(x-ANCHOR_X,1), round(y-ANCHOR_Y,1)] for x,y in shoulders]  # anchor-relative, x uses feet-center
    import json
    meta = {
        'FRAME_W': FRAME_W, 'FRAME_H': FRAME_H, 'FRAMES': FRAMES,
        'ROWS': ['IDLE','WALK','RUN','JUMP','ATTACK_TORSO','LEGS_IDLE','LEGS_WALK','LEGS_RUN','LEGS_JUMP','HURT'],
        'TILE': 64, 'anchorX': anchor_x, 'anchorY': ANCHOR_Y, 'bodyH': 128, 'bodyW': 64,   # anchors in sheet px
        'SPRITE_SCALE': SS,
        'BOWARM_W': K, 'BOWARM_H': K, 'BOWARM_PX': PV, 'BOWARM_PY': PV,
        'SHOULDER': sh,
        'archer': durl(sheet), 'bowarm': durl(strip),
        'grass': keep('grass'), 'dirt': keep('dirt'), 'arrow': keep('arrow'),
        'bark': keep('bark'), 'leaf': keep('leaf'), 'knight': keep('knight'),
    }
    mk = re.search(r'"KNIGHT": (\{[^}]*\})', old)
    if mk: meta['KNIGHT'] = json.loads(mk.group(1))
    for m in re.finditer(r'"(sfx_\w+)": "(data:audio/wav;base64,[^"]+)"', old):
        meta[m.group(1)] = m.group(2)   # keep baked sound effects
    meta = {k: v for k, v in meta.items() if v is not None}
    js = '// Auto-generated game assets (base64 PNGs + sprite metadata). Rebuild: assets/build_sheet.py\nconst ASSETS = ' + json.dumps(meta) + ';\n'
    open(os.path.join(root,'assets.js'),'w').write(js)
    print('sheet', sheet.size, 'strip', strip.size)
    print('shoulder rel anchor', sh)

if __name__ == '__main__':
    main()
