import sys
OLD='    // save stations: arm when you step off, save once when you land on one\n    for (let i = 0; i < STATIONS.length; i++){\n      const st = STATIONS[i];\n      const r = { x: st.tx*TILE, y: (st.fr-1)*TILE, w: TILE, h: TILE };\n      if (overlaps(P, r)){ if (st.armed && P.onGround){ st.armed = false; doSave(i); } }\n      else st.armed = true;\n    }'
NEW='    // save stations: usable once per visit. A station re-arms only after you leave\n    // its room (screen) and come back, not just by stepping off and back onto the tile\n    const psv = screenPos();\n    for (let i = 0; i < STATIONS.length; i++){\n      const st = STATIONS[i];\n      const r = { x: st.tx*TILE, y: (st.fr-1)*TILE, w: TILE, h: TILE };\n      const scol = Math.min(SCREENS_X-1, Math.max(0, Math.floor((st.tx*TILE + TILE/2)/VIEW_W)));\n      let sreg = bandOf((st.fr-1)*TILE + TILE/2);\n      if (sreg !== 1 && !rooms[sreg][scol]) sreg = 1;\n      if (psv.col !== scol || psv.region !== sreg) st.armed = true;   // left the room, re-arm\n      if (overlaps(P, r) && st.armed && P.onGround){ st.armed = false; doSave(i); }\n    }'
p='game.js'; s=open(p,encoding='utf-8').read()
c=s.count(OLD)
if c!=1:
    print('ABORT: anchor found %d times, expected 1'%c); sys.exit(1)
s=s.replace(OLD,NEW)
open(p,'w',encoding='utf-8',newline='').write(s)
print('OK: save-station edit applied, new size',len(s))
