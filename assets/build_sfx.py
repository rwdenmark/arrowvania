#!/usr/bin/env python3
"""
Bake the chosen sound effects into ../assets/js/assets.js as sfx_* data URLs.
Sources live in _sfx/ (see _sfx/synth*.py). Rerun after changing a pick.
Usage: python3 build_sfx.py
"""
import base64, os, re

here = os.path.dirname(os.path.abspath(__file__))
PICKS = {
    'sfx_step': '_sfx/step_grass.wav',  # Ryan's walk-on-grass sample, trimmed
    'sfx_jump': '_sfx/jump3_b.wav',     # jump + double jump
    'sfx_fire': '_sfx/fire3_a.wav',     # recurve bow release, trimmed
    'sfx_dirt': '_sfx/dirt_a.wav',
    'sfx_wood': '_sfx/wood_final.wav',  # trimmed bullet-impact-wood sample
}
aj = os.path.join(here, 'js', 'assets.js')
s = open(aj).read()
for key, rel in PICKS.items():
    data = 'data:audio/wav;base64,' + base64.b64encode(open(os.path.join(here, rel), 'rb').read()).decode()
    if '"%s":' % key in s:
        s = re.sub('"%s": "data:audio/wav;base64,[^"]+"' % key, '"%s": "%s"' % (key, data), s)
    else:
        s = s.replace('"grass":', '"%s": "%s", "grass":' % (key, data), 1)
open(aj, 'w').write(s)
print('baked:', ', '.join(PICKS))
