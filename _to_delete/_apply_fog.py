import sys
OLD='    fogBand(500, 74, 0.30);\n    fogBand(592, 66, 0.42);\n    g.restore();'
NEW="    fogBand(500, 74, 0.30);\n    fogBand(592, 66, 0.42);\n    // haze settles into the low ground so pits and holes read as fog, not black.\n    // Reaches well past the bottom so the per-room raise never lifts it off screen.\n    const lowFog = g.createLinearGradient(0, 540, 0, 760);\n    lowFog.addColorStop(0, 'rgba(188,198,208,0)');\n    lowFog.addColorStop(0.55, 'rgba(182,193,205,0.22)');\n    lowFog.addColorStop(1, 'rgba(176,189,201,0.34)');\n    g.fillStyle = lowFog;\n    g.fillRect(0, 540, VIEW_W, 260);\n    g.restore();"
p='game.js'; s=open(p,encoding='utf-8').read()
c=s.count(OLD)
if c!=1:
    print('ABORT anchor count',c); sys.exit(1)
open(p,'w',encoding='utf-8',newline='').write(s.replace(OLD,NEW))
print('OK low-fog applied, size',len(s.replace(OLD,NEW)))
