/* Arrowvania backdrops: one painter per theme (day forest, night graveyard,
   castle courtyard), each painted once per region raise R and repeated for
   every screen section. Pure of game state beyond the canvas size, so the
   painters live here instead of game.js. CASTLE_FX / CASTLE_POLE are the
   anchor points the live overlay (drawCastleFx in game.js) animates over
   the castle bake. */
const BGLIB = (() => {
  function create({ VIEW_W, VIEW_H }){
  // daytime backdrop (sandbox1)
  function makeBG(R){
    const cv = document.createElement('canvas');
    cv.width = VIEW_W; cv.height = VIEW_H;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#4e9fe0'); grad.addColorStop(0.7, '#a8d8f4'); grad.addColorStop(1, '#cdeffc');
    g.fillStyle = grad; g.fillRect(0, 0, VIEW_W, VIEW_H);
    function cloud(cx, cy, s){
      g.fillStyle = 'rgba(178,205,228,0.9)';
      for (const q of [[-0.8,0.22,0.5],[0,0.28,0.72],[0.85,0.22,0.55]]){
        g.beginPath(); g.ellipse(cx + q[0]*s, cy + q[1]*s, q[2]*s, q[2]*s*0.5, 0, 0, Math.PI*2); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.95)';
      for (const q of [[-1.15,0.05,0.42],[-0.6,-0.28,0.58],[0,-0.42,0.72],[0.55,-0.2,0.6],[1.1,0.05,0.45],[0,0.05,0.9]]){
        g.beginPath(); g.ellipse(cx + q[0]*s, cy + q[1]*s, q[2]*s, q[2]*s*0.62, 0, 0, Math.PI*2); g.fill();
      }
      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(cx - 0.15*s, cy - 0.45*s, 0.5*s, 0.3*s, 0, 0, Math.PI*2); g.fill();
    }
    function wisp(cx, cy, s){
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (const q of [[-1,0,0.5],[0,-0.15,0.65],[1,0,0.5]]){
        g.beginPath(); g.ellipse(cx + q[0]*s, cy + q[1]*s, q[2]*s*1.4, q[2]*s*0.4, 0, 0, Math.PI*2); g.fill();
      }
    }
    cloud(150, 110, 46); cloud(470, 70, 38); cloud(760, 150, 52);
    wisp(300, 190, 26); wisp(620, 230, 22); wisp(60, 60, 20);
    function hillPine(x, y, s){
      g.fillStyle = '#2f6b34';
      g.beginPath(); g.moveTo(x, y - s*1.6); g.lineTo(x - s*0.75, y - s*0.55); g.lineTo(x + s*0.75, y - s*0.55); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x, y - s*1.1); g.lineTo(x - s, y); g.lineTo(x + s, y); g.closePath(); g.fill();
      g.fillStyle = '#5b4226';
      g.fillRect(x - s*0.12, y, s*0.24, s*0.45);
    }
    // raised-cosine hills: crest at (cx, crestY), flanks flatten out into the
    // ground like real hills instead of curving back under like an ellipse.
    // Wraps at +/- one screen so the silhouette is continuous where the
    // backdrop repeats horizontally (no seam at the screen boundary)
    const gHill = (cx, crestY, halfW) => {
      const bot = VIEW_H + 40;
      for (const ox of [0, -VIEW_W, VIEW_W]){
        g.beginPath();
        g.moveTo(cx + ox - halfW, VIEW_H + 200);
        for (let i = 0; i <= 48; i++){
          const dx = -halfW + halfW*i/24;
          const y = crestY + (bot - crestY)*(1 - Math.cos(Math.PI*Math.abs(dx)/halfW))/2;
          g.lineTo(cx + ox + dx, y);
        }
        g.lineTo(cx + ox + halfW, VIEW_H + 200);
        g.closePath(); g.fill();
      }
    };
    // ground (hills + pines) rides up per room so it meets that room's floor; the
    // sky and clouds stay put, so the empty gap between them just shrinks
    g.save(); g.translate(0, -R);
    g.fillStyle = '#69a857';
    gHill(700, 440, 560);
    hillPine(640, 470, 26); hillPine(820, 500, 32); hillPine(930, 545, 24);
    g.fillStyle = '#7fbf6a';
    gHill(180, 460, 500);
    hillPine(90, 505, 30); hillPine(230, 490, 36); hillPine(340, 545, 26);
    g.restore();
    return cv;
  }
  // sandbox2 backdrop, painted once like BG. Only the rain animates
  function makeNightBG(R){
    const cv = document.createElement('canvas');
    cv.width = VIEW_W; cv.height = VIEW_H;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#0e1014'); grad.addColorStop(1, '#282e32');
    g.fillStyle = grad; g.fillRect(0, 0, VIEW_W, VIEW_H);
    // hazy moon (fixed, never raised, so it stays in view)
    const mg = g.createRadialGradient(160, 90, 6, 160, 90, 80);
    mg.addColorStop(0, 'rgba(200,206,214,0.45)'); mg.addColorStop(0.45, 'rgba(200,206,214,0.14)'); mg.addColorStop(1, 'rgba(200,206,214,0)');
    g.fillStyle = mg; g.fillRect(50, -20, 220, 220);
    g.fillStyle = '#c8ced6';
    g.beginPath(); g.arc(160, 90, 30, 0, Math.PI*2); g.fill();
    // everything below the moon (hills, chapel, gravestones, fog) rides up per room
    g.save(); g.translate(0, -R);
    // raised-cosine hills like the day backdrop: flanks flatten out into the
    // ground instead of curving back under like an ellipse. Wraps at +/- one
    // screen so they stay continuous where the backdrop repeats horizontally
    // (this is the seam the graveyard sky used to show)
    const gHill = (cx, crestY, halfW) => {
      const bot = VIEW_H + 40;
      for (const ox of [0, -VIEW_W, VIEW_W]){
        g.beginPath();
        g.moveTo(cx + ox - halfW, VIEW_H + 200);
        for (let i = 0; i <= 48; i++){
          const dx = -halfW + halfW*i/24;
          const y = crestY + (bot - crestY)*(1 - Math.cos(Math.PI*Math.abs(dx)/halfW))/2;
          g.lineTo(cx + ox + dx, y);
        }
        g.lineTo(cx + ox + halfW, VIEW_H + 200);
        g.closePath(); g.fill();
      }
    };
    g.fillStyle = '#141a1c';
    gHill(180, 432, 480);
    gHill(470, 458, 480);   // mid rise fills the hard valley left of the chapel
    gHill(800, 455, 480);
    gHill(655, 493, 340);   // gentle knoll under the chapel, fills the saddle to ~503
    // chapel silhouette on the far hill: gabled body, bell tower, concave
    // witch-hat roof with the cross planted right on the peak
    g.fillStyle = '#0e1214';
    g.fillRect(605, 448, 100, 67);                                                                       // body, base y=515
    g.beginPath(); g.moveTo(601, 448); g.lineTo(709, 448); g.lineTo(655, 413); g.closePath(); g.fill();  // gable roof
    g.fillRect(641, 388, 28, 60);                                                                        // bell tower
    // witch-hat roof: the curve stops at a flat 4px peak column so the cross
    // upright continues it exactly, one clean centered line, no lumpy tip
    g.beginPath();
    for (let i = 0; i <= 10; i++){
      const t = 0.736*i/10;
      const hx = 655 - Math.max(2, 22*Math.pow(1-t, 1.8)), hy = 392 - 44*t;
      if (i === 0) g.moveTo(hx, hy); else g.lineTo(hx, hy);
    }
    for (let i = 10; i >= 0; i--){
      const t = 0.736*i/10;
      g.lineTo(655 + Math.max(2, 22*Math.pow(1-t, 1.8)), 392 - 44*t);
    }
    g.closePath(); g.fill();
    g.fillRect(653, 333, 4, 30);                                                                         // cross upright, runs into the peak column
    g.fillRect(646, 340, 18, 5);                                                                         // cross arm
    // the chapel base melts into the hill color instead of ending on a hard edge
    const cf = g.createLinearGradient(0, 462, 0, 517);
    cf.addColorStop(0, 'rgba(20,26,28,0)'); cf.addColorStop(1, 'rgba(20,26,28,1)');
    g.fillStyle = cf; g.fillRect(596, 462, 118, 55);
    // gravestones
    g.fillStyle = '#1e2626';
    for (const gx of [200, 300, 770, 860]){
      g.fillRect(gx, 519, 22, 26);
      g.beginPath(); g.ellipse(gx + 11, 519, 11, 9, 0, 0, Math.PI*2); g.fill();
    }
    // fog bands, soft radial blobs
    function fogBand(cy, ry, alpha){
      for (const c of [[VIEW_W*0.28, VIEW_W*0.55], [VIEW_W*0.78, VIEW_W*0.55]])
        for (const ox of [0, -VIEW_W, VIEW_W]){   // wrap so the fog has no seam either
          g.save();
          g.translate(c[0] + ox, cy); g.scale(c[1]/100, ry/100);
          const fg = g.createRadialGradient(0, 0, 10, 0, 0, 100);
          fg.addColorStop(0, 'rgba(190,200,210,' + alpha + ')');
          fg.addColorStop(1, 'rgba(190,200,210,0)');
          g.fillStyle = fg;
          g.beginPath(); g.arc(0, 0, 100, 0, Math.PI*2); g.fill();
          g.restore();
        }
    }
    fogBand(500, 74, 0.30);
    fogBand(592, 66, 0.42);
    // haze settles into the low ground so pits and holes read as fog, not black.
    // Reaches well past the bottom so the per-room raise never lifts it off screen.
    const lowFog = g.createLinearGradient(0, 540, 0, 760);
    lowFog.addColorStop(0, 'rgba(188,198,208,0)');
    lowFog.addColorStop(0.55, 'rgba(182,193,205,0.22)');
    lowFog.addColorStop(1, 'rgba(176,189,201,0.34)');
    g.fillStyle = lowFog;
    g.fillRect(0, 540, VIEW_W, 260);
    g.restore();
    return cv;
  }
  // sandbox3 backdrop: courtyard curtain wall with the keep behind it, in the
  // granite palette of the castle tiles. Painted once per region raise; only the
  // pennant and the two sconce flames animate (drawCastleFx, over the bake).
  const CASTLE_FX = [{ x: 250, y: 494 }, { x: 710, y: 494 }];   // baked sconce brackets, door height
  const CASTLE_POLE = { x: 480, top: 104 };                     // pennant anchor
  function makeCastleBG(R){
    const cv = document.createElement('canvas');
    cv.width = VIEW_W; cv.height = VIEW_H;
    const g = cv.getContext('2d');
    const W = VIEW_W, H = VIEW_H;
    const WALL_M = '#989aa0', WALL_D = '#787a80', LINE = '#70727a';
    const KEEP = '#86888e', KEEP_D = '#76787e', KEEP_L = '#94969c';
    const ROOF = '#566884', ROOF_D = '#4a5a74', ROOF_L = '#627492';
    const SLOT = '#34363c', WOOD = '#604a34', WOOD_D = '#483728';
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#4e9fe0'); grad.addColorStop(0.7, '#a8d8f4'); grad.addColorStop(1, '#cdeffc');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    function cloud(cx, cy, s){
      g.fillStyle = 'rgba(178,205,228,0.9)';
      for (const q of [[-0.8,0.22,0.5],[0,0.28,0.72],[0.85,0.22,0.55]]){
        g.beginPath(); g.ellipse(cx + q[0]*s, cy + q[1]*s, q[2]*s, q[2]*s*0.5, 0, 0, Math.PI*2); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.95)';
      for (const q of [[-1.15,0.05,0.42],[-0.6,-0.28,0.58],[0,-0.42,0.72],[0.55,-0.2,0.6],[1.1,0.05,0.45],[0,0.05,0.9]]){
        g.beginPath(); g.ellipse(cx + q[0]*s, cy + q[1]*s, q[2]*s, q[2]*s*0.62, 0, 0, Math.PI*2); g.fill();
      }
    }
    cloud(150, 80, 40); cloud(560, 60, 36); cloud(840, 120, 44);
    // everything below rides up per room like the day hills
    g.save(); g.translate(0, -R);
    function crenel(x0, x1, y, hgt, col, tooth, gap){
      g.fillStyle = col;
      for (let x = x0; x < x1; x += tooth + gap) g.fillRect(x, y - hgt, Math.min(tooth, x1 - x), hgt);
    }
    // slate-shingled cone roof (same texture idea as the tile shingles)
    function coneRoof(ax, ay, by, half){
      g.fillStyle = ROOF;
      g.beginPath(); g.moveTo(ax - half, by); g.lineTo(ax + half, by); g.lineTo(ax, ay); g.closePath(); g.fill();
      const hgt = by - ay;
      g.fillStyle = ROOF_D;
      let ri = 0;
      for (let y = ay + 8; y < by - 2; y += 11, ri++){
        const w2 = half*(y - ay)/hgt - 2;
        if (w2 <= 2) continue;
        g.fillRect(ax - w2, y, 2*w2, 2);
        for (let x = ax - w2 + (ri % 2 ? 4 : 0); x < ax + w2; x += 9){
          const nw = half*(Math.min(y + 11, by) - ay)/hgt - 2;
          if (Math.abs(x - ax) < nw) g.fillRect(x, y, 1, Math.min(8, by - 2 - y));
        }
      }
      g.strokeStyle = ROOF_L; g.lineWidth = 2;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax - half, by); g.stroke();
    }
    // tiny deterministic PRNG so the baked ivy never changes between loads
    function sRand(seed){
      let s2 = seed >>> 0;
      return () => {
        s2 = (s2 + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s2 ^ (s2 >>> 15), 1 | s2);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function ivyFall(x, top, ln){
      const rnd = sRand(x*7 + ln), cols = ['#4a8c42', '#366e3a', '#30542c'];
      for (let i = 0; i < ln; i++){
        const yy = top + i*9, w2 = Math.max(0, 14*(1 - i/(ln*1.15)));
        for (let k = 0; k < 3; k++){
          const lx = x + Math.floor(rnd()*(2*Math.floor(w2) + 1)) - Math.floor(w2);
          g.fillStyle = cols[Math.floor(rnd()*3)];
          g.beginPath(); g.ellipse(lx, yy, 5, 4, 0, 0, Math.PI*2); g.fill();
        }
      }
    }
    const kx = 480;
    // flag pole first so the keep occludes its base (the pennant animates live)
    g.fillStyle = '#60626a'; g.fillRect(kx-6, 104, 12, 146);
    g.fillStyle = '#6e7076'; g.fillRect(kx-6, 104, 4, 146);
    // two tall side towers with full ashlar blockwork
    for (const [tx, th2] of [[240, 500], [720, 530]]){
      g.fillStyle = WALL_D; g.fillRect(tx-48, H-th2, 96, th2+200);
      g.fillStyle = '#64666c'; g.fillRect(tx+38, H-th2, 10, th2+200);
      const bands = [];
      for (let by = H-th2+10; by < 356; by += 31) bands.push(by);
      g.fillStyle = '#72747a';
      bands.forEach((by, bi) => {
        if (bi % 3 !== 1) return;
        for (let jx = tx-36+(bi % 2 ? 15 : 0); jx < tx+24; jx += 60) g.fillRect(jx, by, 29, 31);
      });
      g.fillStyle = '#6c6e74';
      bands.forEach((by, bi) => {
        g.fillRect(tx-48, by, 96, 1);
        for (let jx = tx-36+(bi % 2 ? 15 : 0); jx < tx+42; jx += 30) g.fillRect(jx, by, 1, Math.min(31, 355 - by));
      });
      g.fillStyle = '#64666c';
      for (let cx2 = tx-45; cx2 < tx+42; cx2 += 12) g.fillRect(cx2, H-th2+2, 6, 8);   // corbels
      coneRoof(tx, H-th2-84, H-th2, 60);
      for (let wy2 = H-th2+50; wy2 < 340; wy2 += 90){   // framed arched windows
        g.fillStyle = '#8c8e94';
        g.fillRect(tx-9, wy2-4, 18, 32);
        g.beginPath(); g.ellipse(tx, wy2-4, 9, 8, 0, 0, Math.PI*2); g.fill();
        g.fillStyle = SLOT;
        g.fillRect(tx-6, wy2, 12, 26);
        g.beginPath(); g.ellipse(tx, wy2, 6, 6, 0, 0, Math.PI*2); g.fill();
        g.fillStyle = '#64666c'; g.fillRect(tx-10, wy2+26, 20, 5);
      }
    }
    // rear turrets peeking over the keep
    for (const bx of [kx-62, kx+62]){
      g.fillStyle = '#7e8086'; g.fillRect(bx-12, 164, 24, 46);
      g.fillStyle = '#72747a'; g.fillRect(bx+6, 164, 6, 46);
      g.fillStyle = '#747678';
      for (const by of [176, 190, 204]) g.fillRect(bx-12, by, 24, 1);
      coneRoof(bx, 136, 164, 16);
      g.fillStyle = SLOT; g.fillRect(bx-3, 178, 6, 18);
    }
    // connecting curtain walls between the towers and the keep
    for (const [x0, x1] of [[288, 366], [594, 672]]){
      g.fillStyle = '#7e8086'; g.fillRect(x0, 306, x1-x0, H+200-306);
      crenel(x0, x1, 306, 14, '#7e8086', 14, 10);
      g.fillStyle = LINE;
      g.fillRect(x0, 340, x1-x0, 2);
      for (let bi = 0; bi < 2; bi++){
        const ya = bi ? 340 : 306, yb = bi ? 360 : 340;
        for (let jx = x0+10+(bi ? 10 : 0); jx < x1-4; jx += 20) g.fillRect(jx, ya+2, 1, yb-ya-4);
      }
      g.fillStyle = SLOT; g.fillRect((x0+x1)/2 - 4, 320, 8, 22);
    }
    // the keep: toned ashlar blocks first so every line sits on top
    g.fillStyle = KEEP; g.fillRect(kx-120, 200, 240, H+200-200);
    g.fillStyle = '#80828a';
    for (const [bx0, by0, bh2] of [[408,246,54],[504,200,46],[432,300,48],[552,300,48],[360,200,46],[384,348,12]])
      g.fillRect(bx0, by0, 48, bh2);
    crenel(kx-126, kx+126, 200, 20, KEEP, 20, 14);
    g.fillStyle = KEEP_D;
    for (const yy of [246, 300, 348]) g.fillRect(kx-120, yy, 240, 2);
    g.fillStyle = '#7c7e84';
    for (let bi = 0; bi < 4; bi++){
      const ya = [200,246,300,348][bi], yb = [246,300,348,360][bi];
      for (let jx = 384+(bi % 2 ? 24 : 0); jx < 600; jx += 48) g.fillRect(jx, ya+2, 1, yb-ya-3);
    }
    g.fillStyle = KEEP_D;
    for (let k = -3; k <= 3; k++) g.fillRect(kx + k*30 - 5, 224, 10, 10);   // machicolations
    // corner turrets with three stacked slits
    for (const tx2 of [kx-120, kx+120]){
      g.fillStyle = KEEP_L; g.fillRect(tx2-18, 176, 36, H+200-176);
      g.fillStyle = KEEP; g.fillRect(tx2+10, 176, 8, H+200-176);
      g.fillStyle = '#8a8c92';
      let bi = 0;
      for (let by = 196; by < 356; by += 30, bi++){
        g.fillRect(tx2-18, by, 36, 1);
        g.fillRect(tx2 + (bi % 2 ? 7 : -7), by, 1, 30);
      }
      coneRoof(tx2, 132, 176, 24);
      g.fillStyle = SLOT;
      for (const wy4 of [194, 252, 310]) g.fillRect(tx2-4, wy4, 8, 26);
    }
    // central arched window
    g.fillStyle = KEEP_L;
    g.beginPath(); g.ellipse(kx, 274, 26, 26, 0, 0, Math.PI*2); g.fill();
    g.fillRect(kx-26, 274, 52, 42);
    g.fillStyle = '#3a4a60';
    g.beginPath(); g.ellipse(kx, 274, 18, 18, 0, 0, Math.PI*2); g.fill();
    g.fillRect(kx-18, 274, 36, 34);
    g.fillStyle = KEEP_D; g.fillRect(kx-1, 260, 3, 48);
    g.fillRect(kx-24, 308, 48, 8);
    // cross arrow loops flanking the window
    g.fillStyle = SLOT;
    for (const c of [kx-64, kx+64]){ g.fillRect(c-4, 256, 8, 30); g.fillRect(c-11, 266, 22, 7); }
    // front curtain wall: crenel + coursework periods divide 960, so the
    // backdrop repeats with no seam. The wall ENDS at the courtyard ground
    // line GY, which the per-room raise puts exactly at that room's floor
    // height, same contract as the hills (bg ground meets a floor 1/2/3
    // tiles up per region)
    // the wall blocks run straight past the ground line, deep enough that the
    // raise never lifts them off screen. GY only anchors what stands on the
    // floor (doors); floor holes look down at the same wall masonry
    const wy = 360, GY = H - 64;
    g.fillStyle = WALL_M; g.fillRect(0, wy, W, H+200-wy);
    crenel(-8, W+8, wy, 26, WALL_M, 24, 16);
    g.fillStyle = LINE;
    let r2 = 0;
    for (let yy = wy; yy < H+160; yy += 46, r2++){
      g.fillRect(0, yy, W, 2);
      for (let x = (r2 % 2 ? 60 : 0); x < W+120; x += 120) g.fillRect(x, yy, 2, Math.min(46, H+160-yy));
    }
    // wood arch doors standing full-height on the ground line, iron bars full width
    for (const ax of [160, 800]){
      const top = GY - 140;   // same 140px door as the approved concept, base on the ground
      g.fillStyle = WOOD;
      g.fillRect(ax-42, top+44, 84, GY-(top+44));
      g.beginPath(); g.ellipse(ax, top+44, 42, 44, 0, 0, Math.PI*2); g.fill();
      g.strokeStyle = WOOD_D; g.lineWidth = 3;
      g.beginPath(); g.moveTo(ax, top+12); g.lineTo(ax, GY); g.stroke();
      g.lineWidth = 2;
      for (const px3 of [ax-20, ax+20]){ g.beginPath(); g.moveTo(px3, top+26); g.lineTo(px3, GY); g.stroke(); }
      g.strokeStyle = '#3c3c42'; g.lineWidth = 4;
      for (const yy of [top+60, top+120]){ g.beginPath(); g.moveTo(ax-42, yy); g.lineTo(ax+42, yy); g.stroke(); }
    }
    // arrow slits + hung shields
    g.fillStyle = SLOT;
    for (const wx of [330, 480, 630]){
      g.fillRect(wx-5, 430, 10, 50);
      g.beginPath(); g.ellipse(wx, 432, 5, 10, 0, 0, Math.PI*2); g.fill();
    }
    for (const [sx, c1] of [[405, '#aa2832'], [555, '#284696']]){
      g.fillStyle = c1;
      g.beginPath(); g.moveTo(sx-20, 505); g.lineTo(sx+20, 505); g.lineTo(sx+20, 535);
      g.lineTo(sx, 555); g.lineTo(sx-20, 535); g.closePath(); g.fill();
      g.strokeStyle = '#dcaa3c'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(sx-20, 520); g.lineTo(sx+20, 520); g.stroke();
    }
    // ivy spilling over the crenellations
    ivyFall(60, 340, 12); ivyFall(280, 344, 9); ivyFall(430, 340, 14);
    ivyFall(700, 342, 10); ivyFall(920, 338, 13);
    // sconce brackets (the flames animate live in drawCastleFx)
    for (const fx2 of CASTLE_FX){
      g.fillStyle = '#3c3024'; g.fillRect(fx2.x-3, fx2.y+4, 6, 22);
      g.fillStyle = '#34343c'; g.fillRect(fx2.x-8, fx2.y+24, 16, 7);
      g.fillStyle = '#484852'; g.fillRect(fx2.x-2, fx2.y+30, 4, 10);
    }
    g.restore();
    return cv;
  }
    return { makeBG, makeNightBG, makeCastleBG, CASTLE_FX, CASTLE_POLE };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BGLIB;
