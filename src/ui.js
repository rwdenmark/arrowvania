/* Arrowvania menus and overlay screens: the main menu (map picker, save,
   Enter Code panel, god mode), pause, spawn menu, game over, the pickup/save
   notice modal, the copy toast, and the shared widgets (buttons, keycaps,
   the starfield backdrop). Screens are pure draw calls: each takes the state
   it shows and returns the clickable button rects, so game.js keeps owning
   the state and the input handling. */
const UILIB = (() => {
  function create({ ctx, VIEW_W, VIEW_H, U, mouse, inRect }){
  // toast: transient confirmation line, fades at the end of its run
  let toast = null;
  function showToast(text){ toast = { text, until: performance.now() + 1600 }; }
  function roundRect(x,y,w,h,r){ ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  // muted text with an accent keycap, like the bottom bar hints
  function keycapLine(cx2, ly, verb, key, tail){
    const isMouse = key === 'M-L';   // drawn as a mouse pictogram, not a keycap
    const vw = ctx.measureText(verb + ' ').width;
    const kw = isMouse ? 5.5*U : ctx.measureText(key).width + 4*U;
    const aw = ctx.measureText(' ' + tail).width;
    let lx = cx2 - (vw + kw + aw)/2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8a9099';
    ctx.fillText(verb + ' ', lx, ly); lx += vw;
    if (isMouse){
      mouseIcon(lx + 0.25*U, ly - 3.4*U, 5*U, 6.8*U);
    } else {
      ctx.strokeStyle = '#60e0d0';
      roundRect(lx, ly - 3*U, kw, 6*U, U); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#60e0d0';
      ctx.fillText(key, lx + kw/2, ly);
    }
    lx += kw;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8a9099';
    ctx.fillText(' ' + tail, lx, ly);
  }
  function drawNotice(notice){
    let noticeBtn = null, noticeCodeBtn = null;
    if (!notice) return { btn: null, codeBtn: null };
    ctx.fillStyle = 'rgba(6,8,12,0.5)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const cx2 = VIEW_W/2, cy2 = VIEW_H/2;
    const f1 = 'bold ' + Math.round(5.5*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    const f2 = Math.round(3.5*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    const f3 = 'bold ' + Math.round(6*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.font = f1;
    const tw = ctx.measureText(notice.title).width;
    let lw;
    if (notice.code){
      ctx.font = f3;
      lw = ctx.measureText(notice.code).width + 8*U;
    } else {
      ctx.font = f2;
      lw = ctx.measureText(notice.verb + ' ').width + ctx.measureText(notice.key).width + 4*U + ctx.measureText(' ' + notice.tail).width;
    }
    const w = Math.max(tw, lw) + 16*U, h = 36*U;
    ctx.fillStyle = 'rgba(14,16,19,0.94)';
    roundRect(cx2 - w/2, cy2 - h/2, w, h, 2*U); ctx.fill();
    ctx.strokeStyle = '#60e0d0';
    roundRect(cx2 - w/2, cy2 - h/2, w, h, 2*U); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = f1;
    ctx.fillStyle = '#e8ecf0';
    ctx.fillText(notice.title, cx2, cy2 - 11*U);
    if (notice.code){
      // the code itself is the whole message: a click copies it
      const kw = lw, kh = 9*U, kx2 = cx2 - kw/2, ky2 = cy2 - 6.5*U;
      const hovC = mouse.sx >= kx2 && mouse.sx <= kx2 + kw && mouse.sy >= ky2 && mouse.sy <= ky2 + kh;
      ctx.fillStyle = hovC ? 'rgba(96,224,208,0.22)' : 'rgba(24,120,120,0.14)';
      roundRect(kx2, ky2, kw, kh, U); ctx.fill();
      ctx.strokeStyle = hovC ? '#d9fff8' : '#60e0d0';
      roundRect(kx2, ky2, kw, kh, U); ctx.stroke();
      ctx.font = f3;
      ctx.fillStyle = hovC ? '#eafffb' : '#60e0d0';
      ctx.fillText(notice.code, cx2, ky2 + kh/2);
      noticeCodeBtn = { x: kx2, y: ky2, w: kw, h: kh };
    } else {
      ctx.font = f2;
      keycapLine(cx2, cy2 - 2*U, notice.verb, notice.key, notice.tail);
    }
    const bw2 = 24*U, bh2 = 7*U, bx = cx2 - bw2/2, by = cy2 + 6*U;
    const hov = mouse.sx >= bx && mouse.sx <= bx + bw2 && mouse.sy >= by && mouse.sy <= by + bh2;
    ctx.fillStyle = hov ? 'rgba(96,224,208,0.35)' : 'rgba(24,120,120,0.28)';
    roundRect(bx, by, bw2, bh2, U); ctx.fill();
    ctx.strokeStyle = hov ? '#d9fff8' : '#60e0d0';
    roundRect(bx, by, bw2, bh2, U); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = 'bold ' + Math.round(3.8*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = hov ? '#eafffb' : '#60e0d0';
    ctx.fillText('Continue', cx2, by + bh2/2);
    noticeBtn = { x: bx, y: by, w: bw2, h: bh2 };
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    return { btn: noticeBtn, codeBtn: noticeCodeBtn };
  }
  function drawToast(){
    if (!toast) return;
    const left = toast.until - performance.now();
    if (left <= 0){ toast = null; return; }
    ctx.globalAlpha = Math.min(1, left/400);   // fade out over the last 0.4s
    ctx.font = 'bold ' + Math.round(3.5*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    const w = ctx.measureText(toast.text).width + 8*U, h = 8*U;
    const x = VIEW_W/2 - w/2, y = VIEW_H - 26*U;
    ctx.fillStyle = 'rgba(14,16,19,0.95)';
    roundRect(x, y, w, h, 2*U); ctx.fill();
    ctx.strokeStyle = '#60e0d0'; ctx.lineWidth = 1.5;
    roundRect(x, y, w, h, 2*U); ctx.stroke();
    ctx.fillStyle = '#d9fff8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(toast.text, VIEW_W/2, y + h/2);
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  const MONO = 'px ui-monospace, Menlo, Consolas, monospace';
  // expanded pause menu: keybinds as keycaps, abilities added as picked up, resume + quit
  // mouse pictogram, left button lit
  function mouseIcon(x, y, w, h){
    const bh = h*0.44;   // the buttons end at the grip
    ctx.save();
    roundRect(x, y, w, h, w*0.48); ctx.clip();
    ctx.fillStyle = '#60e0d0';
    ctx.fillRect(x, y, w/2, bh);   // the left button, lit
    ctx.restore();
    ctx.strokeStyle = '#60e0d0'; ctx.lineWidth = 1;
    roundRect(x, y, w, h, w*0.48); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w/2, y); ctx.lineTo(x + w/2, y + bh);
    ctx.moveTo(x, y + bh); ctx.lineTo(x + w, y + bh);
    ctx.stroke();
  }
  // keycap: teal border and label only (no filled key face)
  function keycap(x, y, w, h, label){
    ctx.strokeStyle = '#60e0d0'; ctx.lineWidth = 1; roundRect(x, y, w, h, 2*U); ctx.stroke();
    ctx.fillStyle = '#c4f5ec'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w/2, y + h/2 + 0.5);
  }
  function menuButton(x, y, w, h, label, primary, disabled){
    if (disabled){
      ctx.fillStyle = 'rgba(60,66,76,0.22)';
      roundRect(x, y, w, h, 2*U); ctx.fill();
      ctx.strokeStyle = '#3c4b4b'; ctx.lineWidth = 1.5; roundRect(x, y, w, h, 2*U); ctx.stroke();
      ctx.fillStyle = '#5f6d70';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + Math.round(4.2*U) + MONO;
      ctx.fillText(label, x + w/2, y + h/2);
      return;
    }
    const hov = inRect(mouse, { x, y, w, h });
    ctx.fillStyle = primary ? (hov ? 'rgba(96,224,208,0.5)' : 'rgba(96,224,208,0.26)')
                            : (hov ? 'rgba(96,224,208,0.2)' : 'rgba(24,120,120,0.22)');
    roundRect(x, y, w, h, 2*U); ctx.fill();
    ctx.strokeStyle = hov ? '#d9fff8' : '#60e0d0'; ctx.lineWidth = 1.5; roundRect(x, y, w, h, 2*U); ctx.stroke();
    ctx.fillStyle = primary ? (hov ? '#eafffb' : '#d9fff8') : '#aef3ea';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + Math.round(4.2*U) + MONO;
    ctx.fillText(label, x + w/2, y + h/2);
  }
  function drawPaused(paused, P){
    let quitBtn = null, resumeBtn = null;
    if (!paused) return { resumeBtn: null, quitBtn: null };
    drawStarField();
    const rows = [
      { label:'Move', keys:['A','D'] },
      { label:'Jump', keys:['Space'] },
      { label:'Crouch', keys:['S'] },
      { label:'Dash', keys:['Shift'] },
      { label:'Spawn enemy', keys:['1'] },
      { label:'Enemy info', keys:['2'] },
      { label:'Aim / Shoot', keys:['M-L'] },
    ];
    if (P.canCharge) rows.push({ label:'Power shot', prefix:'Hold', keys:['M-L'] });
    if (P.canBomb)   rows.push({ label:'Bomb', keys:['Q'] });
    const rowFont = Math.round(3.7*U) + MONO, keyFont = 'bold ' + Math.round(3.5*U) + MONO;
    const keyPadX = 3*U, keyH = 7.5*U, sepW = 3.4*U, rowH = 10*U, sideM = 9*U, midGap = 12*U;
    const headH = 16*U, footH = 34*U;
    const keyW = k => { if (k === 'M-L') return 5.5*U; ctx.font = keyFont; return Math.max(7.5*U, ctx.measureText(k).width + 2*keyPadX); };
    function groupW(r){
      let w = 0;
      if (r.prefix){ ctx.font = rowFont; w += ctx.measureText(r.prefix + ' ').width; }
      for (let i = 0; i < r.keys.length; i++){ w += keyW(r.keys[i]); if (i) w += sepW; }
      if (r.suffix){ ctx.font = rowFont; w += ctx.measureText(' ' + r.suffix).width; }
      return w;
    }
    ctx.font = rowFont;
    let maxLabel = 0, maxGroup = 0;
    for (const r of rows){ maxLabel = Math.max(maxLabel, ctx.measureText(r.label).width); maxGroup = Math.max(maxGroup, groupW(r)); }
    const panelW = Math.max(100*U, sideM*2 + maxLabel + midGap + maxGroup);
    const panelH = headH + rows.length*rowH + footH;
    const cx2 = VIEW_W/2, px = cx2 - panelW/2, py = VIEW_H/2 - panelH/2;
    ctx.fillStyle = 'rgba(14,16,19,0.97)'; roundRect(px, py, panelW, panelH, 3*U); ctx.fill();
    ctx.strokeStyle = '#60e0d0'; ctx.lineWidth = 1.5; roundRect(px, py, panelW, panelH, 3*U); ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillStyle = '#e8ecf0'; ctx.font = 'bold ' + Math.round(7*U) + MONO;
    ctx.fillText('Paused', cx2, py + headH*0.52);
    let ly = py + headH + rowH*0.5;
    for (const r of rows){
      ctx.font = rowFont; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#c8cdd4';
      ctx.fillText(r.label, px + sideM, ly);
      let gx = px + panelW - sideM - groupW(r);
      if (r.prefix){ ctx.font = rowFont; ctx.fillStyle = '#8a9099'; ctx.textAlign = 'left'; ctx.fillText(r.prefix + ' ', gx, ly); gx += ctx.measureText(r.prefix + ' ').width; }
      for (let i = 0; i < r.keys.length; i++){
        if (i) gx += sepW;
        const w = keyW(r.keys[i]);
        if (r.keys[i] === 'M-L') mouseIcon(gx + 0.25*U, ly - keyH/2, 5*U, keyH);
        else keycap(gx, ly - keyH/2, w, keyH, r.keys[i]);
        gx += w;
      }
      if (r.suffix){ ctx.font = rowFont; ctx.fillStyle = '#8a9099'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(' ' + r.suffix, gx, ly); }
      ly += rowH;
    }
    const bw = panelW - sideM*2, bx = px + sideM;
    const rbh = 11*U, ry = py + panelH - footH + 4*U; menuButton(bx, ry, bw, rbh, 'Resume', true);
    resumeBtn = { x: bx, y: ry, w: bw, h: rbh };
    const qbh = 9.5*U, qy = ry + rbh + 4*U; menuButton(bx, qy, bw, qbh, 'Quit to Main Menu', false);
    quitBtn = { x: bx, y: qy, w: bw, h: qbh };
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    return { resumeBtn, quitBtn };
  }
  function drawSpawnMenu(spawnMenu, SPAWN_LIST, ETYPES){
    let spawnBtns = null, spawnPanel = null;
    if (!spawnMenu) return { spawnBtns: null, spawnPanel: null };
    ctx.fillStyle = 'rgba(8,10,14,0.82)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const cols = 3;
    const bw = 52*U, bh = 10*U, gapX = 4*U, gapY = 3.4*U;
    const rows = Math.ceil(SPAWN_LIST.length / cols);
    const panelW = cols*bw + (cols - 1)*gapX + 12*U;
    const panelH = 14*U + rows*bh + (rows - 1)*gapY + 8*U;
    const px = VIEW_W/2 - panelW/2, py = VIEW_H/2 - panelH/2;
    spawnPanel = { x: px, y: py, w: panelW, h: panelH };
    ctx.fillStyle = 'rgba(14,16,19,0.97)'; roundRect(px, py, panelW, panelH, 3*U); ctx.fill();
    ctx.strokeStyle = '#60e0d0'; ctx.lineWidth = 1.5; roundRect(px, py, panelW, panelH, 3*U); ctx.stroke();
    ctx.fillStyle = '#e8ecf0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.round(5.5*U) + MONO;
    ctx.fillText('Spawn Enemy', VIEW_W/2, py + 7*U);
    spawnBtns = [];
    for (let i = 0; i < SPAWN_LIST.length; i++){
      const bx = px + 6*U + (i % cols)*(bw + gapX);
      const by = py + 12*U + Math.floor(i / cols)*(bh + gapY);
      menuButton(bx, by, bw, bh, ETYPES[SPAWN_LIST[i]].name, false);
      spawnBtns.push({ x: bx, y: by, w: bw, h: bh, type: SPAWN_LIST[i] });
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    return { spawnBtns, spawnPanel };
  }
  // dark twinkling-star backdrop for the menu and pause, animates while paused via performance.now()
  const STARS = [];
  for (let i = 0; i < 150; i++)
    STARS.push({ x: Math.random()*VIEW_W, y: Math.random()*VIEW_H, r: 0.5 + Math.random()*1.3, ph: Math.random()*7, sp: 1 + Math.random()*2 });
  // comets streak all the way across at random angles/speeds, removed only once fully off screen
  const comets = [];
  let cometNextT = 0, cometLastT = 0;
  function spawnComet(t){
    cometNextT = t + 2500 + Math.random()*6000;
    const edge = (Math.random()*4)|0;   // enter from a random edge, aimed inward with spread
    let x, y, base;
    if (edge === 0){ x = Math.random()*VIEW_W; y = 0; base = Math.PI/2; }
    else if (edge === 1){ x = VIEW_W; y = Math.random()*VIEW_H; base = Math.PI; }
    else if (edge === 2){ x = Math.random()*VIEW_W; y = VIEW_H; base = -Math.PI/2; }
    else { x = 0; y = Math.random()*VIEW_H; base = 0; }
    const ang = base + (Math.random() - 0.5)*1.4, spd = 0.12 + Math.random()*0.20;
    comets.push({ x, y, ux: Math.cos(ang), uy: Math.sin(ang), spd,
                  len: 42 + Math.random()*80, w: 1.2 + Math.random()*1.8, entered: false });
  }
  function drawStarField(){
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#0a1420'); grad.addColorStop(0.55, '#070b12'); grad.addColorStop(1, '#04060a');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const t = performance.now();
    // real elapsed time drives the drift (and the comets below), so the speed
    // doesn't follow the display's refresh rate. 0.0216 px/ms = the old
    // 0.15 px/frame at 144 Hz.
    const dt = cometLastT ? Math.min(80, t - cometLastT) : 7;
    cometLastT = t;
    for (const st of STARS){
      // wrap only once the whole glow has cleared the edge, so stars slide off
      // instead of popping out while still partly visible
      st.x += 0.0216 * dt;
      const sm = st.r*2 + 2;
      if (st.x > VIEW_W + sm) st.x = -sm;
      const tw = 0.35 + 0.65*Math.abs(Math.sin(t*0.001*st.sp + st.ph));
      ctx.fillStyle = 'rgba(150,205,255,' + tw.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r*(0.7 + 0.5*tw), 0, Math.PI*2); ctx.fill();
    }
    // comets: spawn on a randomized timer, cross fully then leave
    if (t >= cometNextT) spawnComet(t);
    ctx.lineCap = 'round';
    for (let i = comets.length - 1; i >= 0; i--){
      const c = comets[i];
      c.x += c.ux * c.spd * dt; c.y += c.uy * c.spd * dt;
      if (c.x >= 0 && c.x <= VIEW_W && c.y >= 0 && c.y <= VIEW_H) c.entered = true;
      const m = c.len + 24;
      if (c.entered && (c.x < -m || c.x > VIEW_W + m || c.y < -m || c.y > VIEW_H + m)){ comets.splice(i, 1); continue; }
      const tailX = c.x - c.ux * c.len, tailY = c.y - c.uy * c.len;
      const gr = ctx.createLinearGradient(c.x, c.y, tailX, tailY);
      gr.addColorStop(0, 'rgba(190,225,255,0.9)'); gr.addColorStop(1, 'rgba(190,225,255,0)');
      ctx.strokeStyle = gr; ctx.lineWidth = c.w;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(tailX, tailY); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;   // comets vary the width, don't let it bleed into the menu strokes
  }
  function drawMenuBg(){ drawStarField(); }
  function drawMenu({ menu, MAPS, selectedMap, saveData, godMode, codeEntry }){
    let mapBtns = null, godBtn = null, contBtn = null, newBtn = null,
        codeBtn = null, codeBackBtn = null, codeStartBtn = null;
    const rects = () => ({ mapBtns, godBtn, contBtn, newBtn, codeBtn, codeBackBtn, codeStartBtn });
    if (!menu) return rects();
    drawMenuBg();   // dark twinkling-star backdrop
    const cx2 = VIEW_W/2, cy2 = VIEW_H/2;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.save(); ctx.shadowColor = 'rgba(96,224,208,0.45)'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#60e0d0'; ctx.font = 'bold ' + Math.round(13*U) + MONO;
    ctx.fillText('ARROWVANIA', cx2, cy2 - 24*U);
    ctx.restore();
    const mw = 30*U, mh = 9*U, mgap = 4*U;
    const mx0 = cx2 - (MAPS.length*mw + (MAPS.length-1)*mgap)/2, my0 = cy2 - 9*U;
    mapBtns = [];
    for (let i = 0; i < MAPS.length; i++){
      const b = { x: mx0 + i*(mw + mgap), y: my0, w: mw, h: mh };
      mapBtns.push(b);
      const m = MAPS[i];
      const hovM = !m.locked && inRect(mouse, b);
      const sel = i === selectedMap && !m.locked;
      if (m.locked){
        ctx.fillStyle = 'rgba(70,76,84,0.18)';
        ctx.strokeStyle = '#3c434c';
      } else {
        ctx.fillStyle = sel ? (hovM ? 'rgba(96,224,208,0.4)' : 'rgba(96,224,208,0.26)')
                            : (hovM ? 'rgba(96,224,208,0.18)' : 'rgba(24,120,120,0.18)');
        ctx.strokeStyle = sel ? (hovM ? '#d9fff8' : '#60e0d0') : (hovM ? '#8ceade' : '#2f8f85');
      }
      ctx.lineWidth = sel ? 2 : 1.5;
      roundRect(b.x, b.y, b.w, b.h, 2*U); ctx.fill();
      roundRect(b.x, b.y, b.w, b.h, 2*U); ctx.stroke();
      ctx.fillStyle = m.locked ? '#5b636c' : sel ? '#eafffb' : '#9adbd3';
      ctx.font = 'bold ' + Math.round(3.8*U) + MONO;
      ctx.fillText(m.name, b.x + b.w/2, b.y + b.h/2);
    }
    if (codeEntry){
      // Enter Code panel: type the code, Enter loads it, Back or Esc backs out
      const pw = 62*U, ph = 33*U, px2 = cx2 - pw/2, py2 = cy2 + 3*U;
      ctx.fillStyle = 'rgba(14,16,19,0.97)'; ctx.lineWidth = 1.5;
      roundRect(px2, py2, pw, ph, 3*U); ctx.fill();
      ctx.strokeStyle = '#60e0d0'; roundRect(px2, py2, pw, ph, 3*U); ctx.stroke();
      ctx.fillStyle = '#e8ecf0'; ctx.font = 'bold ' + Math.round(4.5*U) + MONO;
      ctx.fillText('Enter Code', cx2, py2 + 5*U);
      const raw = codeEntry.text;
      const shown = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
      const caret = performance.now() % 1000 < 500 ? '_' : ' ';
      const ibw = 40*U, ibh = 9*U, ibx = cx2 - ibw/2, iby = py2 + 9*U;
      ctx.fillStyle = 'rgba(8,16,28,0.9)'; roundRect(ibx, iby, ibw, ibh, 2*U); ctx.fill();
      ctx.strokeStyle = codeEntry.err ? '#ff6a55' : '#2f8f85'; roundRect(ibx, iby, ibw, ibh, 2*U); ctx.stroke();
      ctx.fillStyle = '#d9fff8'; ctx.font = 'bold ' + Math.round(5*U) + MONO;
      ctx.fillText(shown + (raw.length < 8 ? caret : ''), cx2, iby + ibh/2);
      ctx.font = Math.round(3.2*U) + MONO;
      if (codeEntry.err){ ctx.fillStyle = '#ff6a55'; ctx.fillText('invalid code', cx2, py2 + 20.5*U); }
      // Back pinned left, Start pinned right on the same line. Enter also starts
      const cbw = 26*U, cbh = 8.5*U, cby = py2 + 23*U;
      menuButton(px2 + 4*U, cby, cbw, cbh, 'Back', false);
      codeBackBtn = { x: px2 + 4*U, y: cby, w: cbw, h: cbh };
      menuButton(px2 + pw - 4*U - cbw, cby, cbw, cbh, 'Start', false);
      codeStartBtn = { x: px2 + pw - 4*U - cbw, y: cby, w: cbw, h: cbh };
      ctx.lineWidth = 1;
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      return rects();
    }
    // Continue rides the save and loads its map. New Game needs a map picked
    const bw = 46*U, bx = cx2 - bw/2;
    let yy = cy2 + 4*U;
    const hasSave = !!saveData;
    menuButton(bx, yy, bw, 9*U, 'Continue', false, !hasSave);
    contBtn = hasSave ? { x: bx, y: yy, w: bw, h: 9*U } : null;
    yy += 12*U;
    menuButton(bx, yy, bw, 9*U, 'New Game', false, selectedMap < 0);
    newBtn = selectedMap >= 0 ? { x: bx, y: yy, w: bw, h: 9*U } : null;
    yy += 12*U;
    menuButton(bx, yy, bw, 9*U, 'Enter Code', false);
    codeBtn = { x: bx, y: yy, w: bw, h: 9*U }; yy += 15*U;
    // god mode: every ability from the start, health refills instead of dying
    ctx.font = Math.round(3.5*U) + MONO;
    const gLabel = 'God Mode';
    const gs = 4*U;
    const gw = gs + 2*U + ctx.measureText(gLabel).width;
    const gx = cx2 - gw/2, gy = yy;
    godBtn = { x: gx - 2*U, y: gy - 3.5*U, w: gw + 4*U, h: 7*U };
    const gHov = inRect(mouse, godBtn);
    ctx.lineWidth = 1.5;
    ctx.fillStyle = godMode ? 'rgba(96,224,208,0.26)' : 'rgba(24,120,120,0.15)';
    ctx.strokeStyle = gHov ? '#d9fff8' : (godMode ? '#60e0d0' : '#2f8f85');
    roundRect(gx, gy - gs/2, gs, gs, U); ctx.fill();
    roundRect(gx, gy - gs/2, gs, gs, U); ctx.stroke();
    if (godMode){
      ctx.strokeStyle = '#eafffb'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(gx + gs*0.24, gy + gs*0.02);
      ctx.lineTo(gx + gs*0.44, gy + gs*0.26);
      ctx.lineTo(gx + gs*0.78, gy - gs*0.26);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = godMode ? '#c4f5ec' : '#8a9099';
    ctx.fillText(gLabel, gx + gs + 2*U, gy);
    ctx.lineWidth = 1;
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    return rects();
  }
  function drawGameOver(gameOver, saveData){
    let gameOverBtn = null, gameOverLoadBtn = null;
    if (!gameOver) return { btn: null, loadBtn: null };
    drawStarField();
    const cx2 = VIEW_W/2, cy2 = VIEW_H/2;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.save(); ctx.shadowColor = 'rgba(96,224,208,0.45)'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#60e0d0'; ctx.font = 'bold ' + Math.round(11*U) + MONO;
    ctx.fillText('GAME OVER', cx2, cy2 - 10*U);
    ctx.restore();
    const bw = 46*U, bh = 9*U, bx = cx2 - bw/2;
    let by = cy2 + 4*U;
    menuButton(bx, by, bw, bh, 'Load Last Save', false, !saveData);
    gameOverLoadBtn = saveData ? { x: bx, y: by, w: bw, h: bh } : null;
    by += 12*U;
    menuButton(bx, by, bw, bh, 'Main Menu', false);
    gameOverBtn = { x: bx, y: by, w: bw, h: bh };
    ctx.lineWidth = 1;
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    return { btn: gameOverBtn, loadBtn: gameOverLoadBtn };
  }
  return { showToast, drawToast, drawNotice, drawPaused, drawSpawnMenu,
           drawMenu, drawGameOver, roundRect };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = UILIB;
