/* Arrowvania
   A/D move, Shift sprint, Space jump (double after pickup),
   left click shoot, hold to charge (after pickup), Esc pause. */
(() => {
  const TILE = ASSETS.TILE || 32;
  const U = TILE / 16;                 // resolution multiplier vs the original 16px design
  const VIEW_W = TILE * 15, VIEW_H = TILE * 10;
  const SCALE = Math.max(1, Math.round(1920 / VIEW_W));   // 2x internal resolution for crisp sprites

  const canvas = document.getElementById('game');
  canvas.width = VIEW_W * SCALE;
  canvas.height = VIEW_H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---------- load embedded images ----------
  function img(src){ const i = new Image(); i.src = src; return i; }
  const IMG = { archer: img(ASSETS.archer), bowarm: img(ASSETS.bowarm),
                grass: img(ASSETS.grass), dirt: img(ASSETS.dirt), arrow: img(ASSETS.arrow),
                bark: img(ASSETS.bark), leaf: img(ASSETS.leaf), knight: img(ASSETS.knight) };
  // sheet is baked at SS x resolution, all ASSETS pixel metadata is in sheet px
  const SS = ASSETS.SPRITE_SCALE || 1;
  const FW = ASSETS.FRAME_W, FH = ASSETS.FRAME_H, NF = ASSETS.FRAMES;
  const ROW = { IDLE:0, WALK:1, RUN:2, JUMP:3, ATTACK:4,
                LEGS_IDLE:5, LEGS_WALK:6, LEGS_RUN:7, LEGS_JUMP:8, HURT:9 };
  const LEGROW = { IDLE:ROW.LEGS_IDLE, WALK:ROW.LEGS_WALK, RUN:ROW.LEGS_RUN, JUMP:ROW.LEGS_JUMP };
  const AX = ASSETS.anchorX, AY = ASSETS.anchorY;
  // bow arm assembly, rotated toward the aim and drawn behind the body
  const BW = ASSETS.BOWARM_W, BH = ASSETS.BOWARM_H, BPX = ASSETS.BOWARM_PX, BPY = ASSETS.BOWARM_PY;
  const SHOULDER = ASSETS.SHOULDER;
  const JUMP_LEG_DY = 12;   // keeps the jump boots visible under the attack coat

  // ---------- level ----------
  // three screen bands: sky room, surface strip, underground room
  const LW = 60, LH = 32;
  const SURF = 20;                    // surface ground top row
  const SKY_ROWS = 12;                // rows 0..11 belong to the sky screen band
  const map = Array.from({length: LH}, () => new Array(LW).fill(0));
  for (let x = 0; x < LW; x++){ map[SURF][x] = 1; map[SURF+1][x] = 1; }
  for (let x = 22; x < 26; x++){ map[SURF][x] = 0; map[SURF+1][x] = 0; }   // hole down to the room
  const plats = [[8,17,4],[14,15,3],[19,16,3],[28,17,5],[35,15,4],[41,17,3],[46,15,5]];
  for (const [c,r,len] of plats) for (let i=0;i<len;i++) map[r][c+i] = 1;
  for (let x=52;x<60;x++){ map[SURF-1][x]=1; }
  // solid underground with the room carved out
  for (let y=SURF+2; y<LH; y++) for (let x=0; x<LW; x++) map[y][x] = 1;
  for (let y=22; y<29; y++) for (let x=16; x<29; x++) map[y][x] = 0;
  for (let x=21; x<24; x++) map[24][x] = 1;   // exit platform, partially under the hole
  for (let x=22; x<25; x++) map[15][x] = 1;   // floating platform up to the sky room
  // sky room, entered through the gap in its floor
  for (let x=15; x<30; x++){ map[1][x] = 1; map[11][x] = 1; }   // ceiling + floor
  for (let y=1; y<12; y++){ map[y][15] = 1; map[y][29] = 1; }   // side walls
  for (let x=22; x<25; x++) map[11][x] = 0;                     // entry gap in the floor
  // trees: bark=2, leaf core=3 (solid), soft leaves=4 (pass-through)
  const TREE_CROWNS = [];
  function plantTree(cx, groundRow, trunkH){
    for (let r = groundRow - trunkH; r < groundRow; r++) map[r][cx] = 2;
    const top = groundRow - trunkH - 4, tiers = [1, 3, 5, 5];
    for (let i = 0; i < 4; i++)
      for (let x = Math.max(0, cx - (tiers[i]>>1)); x <= Math.min(LW-1, cx + (tiers[i]>>1)); x++)
        map[top+i][x] = (x === cx) ? 3 : 4;   // only the center column collides
    TREE_CROWNS.push({ cx, top });
  }
  plantTree(0, SURF, 4);       // both map edges get a tree instead of an invisible wall
  plantTree(LW-1, SURF-1, 3);
  const solid = (tx,ty) => tx<0||ty<0||tx>=LW||ty>=LH ? (ty>=LH) : (map[ty][tx] > 0 && map[ty][tx] < 4);

  // ---------- player ----------
  const P = {
    x: 2*TILE, y: SURF*TILE - Math.round(1.125*TILE), w: Math.round(0.5*TILE), h: Math.round(1.125*TILE),
    vx: 0, vy: 0, onGround:false, face:1,
    anim:'IDLE', frame:0, ftime:0, attackT:0, pendingShot:false, coyote:0, jumpBuf:0,
    canDouble:false, usedDouble:false, canCharge:false, charging:false, chargeT:0,
    aim:0, legs:'IDLE', lframe:0, ltime:0, hurtT:0, lastStep:-1
  };
  const P_HURT = 14;   // ticks of the player flinch
  const WALK_SPD=0.85*U, RUN_SPD=2.0*U, ACCEL=0.5*U, FRIC=0.5*U;
  // analog jump: hold Space for up to exactly 3 tiles, JUMP_V solves the
  // discrete per-frame integration so the height is exact in-game
  const GRAV = 0.1375*U;
  const JUMP_H_MAX = 3*TILE;
  const JUMP_V = Math.sqrt(GRAV*GRAV/4 + 2*GRAV*JUMP_H_MAX) + GRAV/2;
  const JUMP_CUT = 0.55;   // ascent kept per frame once Space is released
  const GRAV_FALL = 0.5625*GRAV;          // gentler gravity on the way down
  const FALL_MAX = 1.6*U;                 // low terminal velocity, keeps the archer easy to track
  const ARROW_SPD=1.6*U;                  // base bow speed, the player's velocity is added on top
  // draw is quick, the return to rest plays slower with an ease-out
  const DRAW_TICKS=11, RECOVER_TICKS=20, ATTACK_DUR=DRAW_TICKS+RECOVER_TICKS;
  const RELEASE_FRAME=5;                  // baked nocked arrow shows on frame 4, projectile takes over on 5
  // charge shot: hold past the first arrow to charge a second, damage 1..10,
  // electric blue bleaching to a white-hot core at full charge
  const CHARGE_MAX = 180;
  const CHG_TINT = [63,142,252], CHG_CORE = [232,246,255], CHG_TINT_MAX = 0.9;
  const CHG_GLOW = 'rgba(80,160,255,', CHG_GLOW_MAX = 8;

  // ---------- sound effects ----------
  // baked WAVs decode once, the charge hum is synthesized live so it can hold while the button is held
  let AC = null, chargeSnd = null;
  const sfxBuf = {};
  function initAudio(){
    if (AC){ if (AC.state === 'suspended') AC.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();
    for (const k of ['step','jump','fire','dirt','wood']){
      const url = ASSETS['sfx_' + k]; if (!url) continue;
      const bin = atob(url.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      AC.decodeAudioData(bytes.buffer).then(b => { sfxBuf[k] = b; });
    }
  }
  function playSfx(name, vol, rate){
    if (!AC || SND.sfx.muted) return;
    const b = sfxBuf[name]; if (!b) return;
    if (AC.state === 'suspended') AC.resume();
    const src = AC.createBufferSource(); src.buffer = b;
    src.playbackRate.value = rate || 1;
    const g = AC.createGain(); g.gain.value = (vol == null ? 1 : vol)*SND.sfx.vol;
    src.connect(g); g.connect(AC.destination); src.start();
  }
  function chargeSndStart(){
    if (!AC || chargeSnd) return;
    const osc = AC.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 55;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = AC.createGain(); g.gain.value = 0;
    const lfo = AC.createOscillator(); lfo.frequency.value = 3;
    const lfoG = AC.createGain(); lfoG.gain.value = 0;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    osc.connect(lp); lp.connect(g); g.connect(AC.destination);
    osc.start(); lfo.start();
    chargeSnd = { osc, lfo, lfoG, g };
  }
  function chargeSndUpdate(c){
    if (!chargeSnd) return;
    const v = SND.sfx.muted ? 0 : (0.2 + 0.8*c)*0.1*SND.sfx.vol;
    chargeSnd.osc.frequency.value = 55*Math.pow(2, 1.6*c);
    chargeSnd.lfo.frequency.value = 3 + 12*c;
    chargeSnd.g.gain.value = v;
    chargeSnd.lfoG.gain.value = 0.4*v;
  }
  function chargeSndStop(){
    if (!chargeSnd) return;
    chargeSnd.osc.stop(); chargeSnd.lfo.stop(); chargeSnd = null;
  }

  // ---------- input ----------
  const keys = {};
  addEventListener('keydown', e => {
    initAudio();
    keys[e.code] = true;
    if (e.code === 'Escape' && !notice){ paused = !paused; if (!paused) P.jumpBuf = 0; }
    if (e.code === 'F3') debugAI = !debugAI;
    if (e.code === 'Space'){ if (!e.repeat && !paused && !notice) P.jumpBuf = 8; e.preventDefault(); }
  });
  addEventListener('keyup',   e => { keys[e.code] = false; });
  // clear input on focus loss, and cancel a held charge instead of firing it blind
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    if (P.charging){ P.charging = false; P.attackT = RECOVER_TICKS; chargeSndStop(); }
  });
  const mouse = { sx: VIEW_W/2, sy: VIEW_H/2, down:false };
  function toWorldMouse(e){
    const r = canvas.getBoundingClientRect();
    mouse.sx = (e.clientX - r.left) / r.width * VIEW_W;
    mouse.sy = (e.clientY - r.top) / r.height * VIEW_H;
  }
  function faceToMouse(){ P.face = (cam.x + mouse.sx) < (P.x + P.w/2) ? -1 : 1; }
  canvas.addEventListener('mousemove', toWorldMouse);
  canvas.addEventListener('mousedown', e => {
    initAudio();
    if (e.button !== 0) return;
    toWorldMouse(e);
    if (notice){
      const b = noticeBtn;
      if (b && mouse.sx >= b.x && mouse.sx <= b.x + b.w && mouse.sy >= b.y && mouse.sy <= b.y + b.h) dismissNotice();
      return;
    }
    if (paused) return;
    mouse.down = true; faceToMouse(); tryShoot();
  });
  addEventListener('mouseup', e => { if (e.button===0) mouse.down=false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- arrows (fired on the bow release frame) ----------
  const arrows = [];
  const fx = [];   // blue impact bursts from charged arrows (particle scatter)
  function makeBurst(x, y, c){
    const parts = [];
    for (let k = 0; k < 12; k++){
      parts.push({ an: Math.random()*Math.PI*2, dm: 0.8 + Math.random()*1.1,
                   sr: 2.5 + Math.random()*2.5, core: k % 3 === 0 });
    }
    fx.push({ x, y, t: 0, c, parts });
  }
  // arrows that hit terrain stick in it with impact cracks, then fade out
  const stuck = [];
  const STICK_LIFE = 480, STICK_FADE = 60;
  function stickArrow(a){
    // walk back to the surface, then embed the tip
    let bx = a.x, by = a.y, guard = 0;
    const sx2 = a.vx/8 || 0.5, sy2 = a.vy/8 || 0;
    while (solid(Math.floor(bx/TILE), Math.floor(by/TILE)) && guard++ < 48){ bx -= sx2; by -= sy2; }
    const embed = 14;
    const cx = bx + Math.cos(a.ang)*(embed - ARROW_LEN/2);
    const cy = by + Math.sin(a.ang)*(embed - ARROW_LEN/2);
    const cracks = [];
    const n = 3 + (Math.random()*2|0) + Math.round(a.charge*2);
    for (let i = 0; i < n; i++){
      let dirA = a.ang + (Math.random()-0.5)*2.4;
      let px2 = bx, py2 = by;
      const pts = [[px2, py2]];
      const segs = 2 + (Math.random()*2|0);
      for (let s2 = 0; s2 < segs; s2++){
        const ln = (4 + Math.random()*7) * (1 + a.charge*0.6);
        dirA += (Math.random()-0.5)*1.2;
        px2 += Math.cos(dirA)*ln; py2 += Math.sin(dirA)*ln;
        pts.push([px2, py2]);
      }
      cracks.push(pts);
    }
    stuck.push({ x: cx, y: cy, bx, by, ang: a.ang, charge: a.charge, t: 0, cracks, embed });
  }
  function tryShoot(){
    // recovery is interruptible, so rapid clicks keep the full fire rate
    if (P.attackT > 0 && (P.pendingShot || P.frame < RELEASE_FRAME)) return;
    P.attackT = ATTACK_DUR; P.pendingShot = true;
  }
  function shoulderWorld(){
    const sh = SHOULDER[P.frame] || SHOULDER[0];
    return { x: P.x + P.w/2 + P.face*sh[0]/SS, y: P.y + P.h + sh[1]/SS };
  }
  // GRIP is the nocked arrow's centerline, sheet px relative to the shoulder
  const GRIP = [36, 11];
  function gripWorld(){
    const s = shoulderWorld();
    const c = Math.cos(P.aim), sn = Math.sin(P.aim);
    return { x: s.x + P.face*((GRIP[0]/SS)*c - (GRIP[1]/SS)*sn),
             y: s.y + (GRIP[0]/SS)*sn + (GRIP[1]/SS)*c };
  }
  function aimAtMouse(){
    const s = shoulderWorld();
    const a = Math.atan2((cam.y + mouse.sy) - s.y, ((cam.x + mouse.sx) - s.x) * P.face);
    P.aim = Math.max(-Math.PI/2, Math.min(Math.PI/2, a));
  }
  // white light streaks drawn into the arrow while a power shot charges
  const chargeFx = [];
  function decayStreaks(list){
    for (let i = list.length - 1; i >= 0; i--){
      const q = list[i];
      q.r -= q.vr;
      if (q.r < 5 || (q.k && q.k.dead)) list.splice(i, 1);
    }
  }
  function updateChargeFx(){
    if (P.charging){
      const cg = P.chargeT / CHARGE_MAX;
      if (Math.random() < 0.2 + 0.6*cg)
        chargeFx.push({ an: Math.random()*Math.PI*2, r: 42 + Math.random()*28,
                        vr: 2 + Math.random()*2 + 2*cg, s: 1.2 + Math.random()*1.8 });
    } else if (chargeFx.length) chargeFx.length = 0;
    decayStreaks(chargeFx);
  }
  function spawnArrow(charge){
    const cg = charge || 0;
    const c = Math.cos(P.aim), sn = Math.sin(P.aim);
    const g2 = gripWorld();
    let ax0 = g2.x, ay0 = g2.y;
    if (solid(Math.floor(ax0/TILE), Math.floor(ay0/TILE))){ const s = shoulderWorld(); ax0 = s.x; ay0 = s.y; }
    // momentum adds along the aim only, never against it
    const boost = Math.max(0, P.vx*c*P.face + P.vy*sn);
    const spd = ARROW_SPD + boost;
    arrows.push({ x:ax0, y:ay0, vx:c*P.face*spd, vy:sn*spd, ang:Math.atan2(sn, c*P.face),
                  life:150, charge:cg, dmg:Math.round(1 + 9*cg) });
    playSfx('fire', 0.8 + 0.4*cg, 1 - 0.12*cg);
  }

  // ---------- player health (rolls back to 99 at zero, no death yet) ----------
  const hpEl = document.getElementById('health-value');
  let hp = 99;
  function damage(n){
    hp -= n; if (hp <= 0) hp = 99;
    if (hpEl) hpEl.textContent = hp;
    P.hurtT = P_HURT;
  }

  // ---------- ability pickups (placeholder boxes) ----------
  const pickups = [
    { x: 22*TILE, y: 28*TILE, w: TILE, h: TILE, taken: false, kind: 'double',
      fill: '#8d939c', edge: '#c8cdd4', glow: null,
      title: 'Double Jump', verb: 'Press', key: 'Space', tail: 'in the air to use' },
    { x: 19*TILE, y: 10*TILE, w: TILE, h: TILE, taken: false, kind: 'charge',
      fill: '#e8f6ff', edge: '#3f8efc', glow: 'rgba(80,160,255,0.9)',
      title: 'Power Shot', verb: 'Hold', key: 'L-Click', tail: 'to charge, release to fire' },
  ];
  // pickup notification modal, pauses the game until Continue is clicked
  let notice = null, noticeBtn = null, paused = false;
  function notify(pk){ notice = { title: 'You gained ' + pk.title, verb: pk.verb, key: pk.key, tail: pk.tail }; }
  function dismissNotice(){
    notice = null; noticeBtn = null;
    P.jumpBuf = 0; mouse.down = false;
    if (P.charging){ P.charging = false; P.attackT = RECOVER_TICKS; chargeSndStop(); }
  }

  // ---------- knight enemy ----------
  const KN = ASSETS.KNIGHT;
  const KROW = { IDLE:0, WALK:1, RUN:2, JUMP:3, ATTACK:4, DIE:5, HURT:6 };
  const KN_WALK = 0.45*U, KN_RUN = 0.9*U;
  const KN_ATTACK_DUR = 90, KN_ATK_CD = 50, KN_HURT = 16;
  const KN_REACH = Math.round(1.2*TILE);   // matches the spear thrust
  const KN_CX = 108;                        // body center in sheet px, so a 180 pivots in place
  // lunge: stance for 3s with the spear leveled, then a 6-tile dash for 40 damage
  const KN_LUNGE_WIND = 180, KN_LUNGE_CD = 600, KN_LUNGE_DIST = 6*TILE;
  const KN_LUNGE_SPD = 10, KN_LUNGE_DMG = 40, KN_STANCE = 5, KN_TINT_SPLIT = 190;
  const knights = [
    { x: 54*TILE, y: (SURF-1)*TILE - Math.round(1.125*TILE),
      hx: 54*TILE, hy: (SURF-1)*TILE - Math.round(1.125*TILE),
      w: Math.round(0.6*TILE), h: Math.round(1.125*TILE),
      vx: 0, vy: 0, face: -1, onGround: false, hp: 20,
      anim: 'IDLE', frame: 0, ftime: 0, attackT: 0, didHit: false,
      hurtT: 0, atkCd: 0, aggro: false, running: false, jumpTx: null, jumpTy: 0, jumpGap: false,
      route: null, pathT: 0, lastPN: -1, settleX: null, goalHome: false, patDir: 1, patT: 0,
      jmpCd: 0, wasGround: true, jumpFrom: null, jumpFails: 0, resetting: false,
      lungeCd: 0, lungeT: 0, lungeDash: 0, lungeHit: false, dashPrevX: null,
      stranded: false, dead: false, dieT: 0 }
  ];
  let pDmgCd = 0;   // player damage cooldown so hits land once, not every frame
  let pLastNode = -1;   // the player's last grounded node, stable while they hop
  let debugAI = false;
  function standable(tx, ty){
    return tx >= 0 && tx < LW && ty >= 1 && ty < LH &&
           solid(tx, ty) && !solid(tx, ty-1) && !solid(tx, ty-2);
  }
  function groundNode(E){
    const feet = Math.max(1, Math.floor((E.y + E.h)/TILE));
    const cx2 = Math.max(0, Math.min(LW-1, Math.floor((E.x + E.w/2)/TILE)));
    // try center, then the body edges, so standing on a lip still maps to the
    // platform instead of the ground far below
    for (const tx of [cx2, Math.max(0, Math.floor(E.x/TILE)), Math.min(LW-1, Math.floor((E.x + E.w - 1)/TILE))])
      if (standable(tx, feet)) return feet*LW + tx;
    for (let ty = feet; ty < LH; ty++)
      if (standable(cx2, ty)) return ty*LW + cx2;
    return -1;
  }
  // BFS over standable cells with the knight's legal moves: walk, fall off edges,
  // and jumps up to 3 tiles high across gaps up to 2 tiles. Returns whether the
  // player is reachable at all and the first jump along the way, if any.
  function bfsRoute(start, goal, allowJumps){
    const prev = new Int32Array(LW*LH).fill(-1);
    const q = [start]; prev[start] = start;
    for (let qi = 0; qi < q.length && prev[goal] < 0; qi++){
      const n = q[qi], tx = n % LW, ty = (n - tx) / LW;
      const push = m => { if (prev[m] < 0){ prev[m] = n; q.push(m); } };
      for (const dx of [-1, 1]){
        const nx = tx + dx;
        if (nx < 0 || nx >= LW) continue;
        if (standable(nx, ty)) push(ty*LW + nx);
        else if (!solid(nx, ty-1) && !solid(nx, ty-2)){
          for (let fy = ty; fy < LH; fy++) if (standable(nx, fy)){ push(fy*LW + nx); break; }
        }
      }
      if (!allowJumps) continue;
      for (let up = 1; up <= 3; up++){
        const ny = ty - up;
        if (ny < 1) break;
        let clear = true;
        for (let r2 = ny-2; r2 <= ty-1 && clear; r2++) if (solid(tx, r2)) clear = false;
        if (!clear) break;
        for (const dx of [-3, -2, -1, 1, 2, 3]){
          if (up === 3 && Math.abs(dx) === 3) continue;   // arc can't cover 3 up AND 3 across
          const nx = tx + dx;
          if (!standable(nx, ny)) continue;
          const wide = Math.abs(dx) >= 2;   // wide jumps arc higher, need more headroom
          if (wide && solid(tx, ny-3)) continue;
          let ok3 = true;
          const sg = Math.sign(dx);
          for (let cx = tx + sg; cx !== nx && ok3; cx += sg){
            if (standable(cx, ny)) ok3 = false;               // a nearer edge exists, land there
            if (solid(cx, ny-1) || solid(cx, ny-2)) ok3 = false;
            if (wide && solid(cx, ny-3)) ok3 = false;
          }
          if (ok3) push(ny*LW + nx);
        }
      }
      // flat and descending hops across small gaps (a 1-col gap flat, up to 2 cols
      // wide when dropping a tile or two)
      for (const dx of [-3, -2, 2, 3]){
        const nx = tx + dx;
        if (nx < 0 || nx >= LW) continue;
        for (let dy = 0; dy <= 2; dy++){
          if (dy === 0 && Math.abs(dx) === 3) continue;   // flat arc can't cover 3 across
          const ny2 = ty + dy;
          if (!standable(nx, ny2)) continue;
          let gap = true;
          const sg = Math.sign(dx);
          for (let cx = tx + sg; cx !== nx && gap; cx += sg){
            for (let ry = ty; ry <= ny2 && gap; ry++) if (standable(cx, ry)) gap = false;
            if (solid(cx, ty-1) || solid(cx, ty-2)) gap = false;
            if (Math.abs(dx) === 3 && solid(cx, ty-3)) gap = false;
          }
          if (gap) push(ny2*LW + nx);
          break;
        }
      }
    }
    return prev[goal] < 0 ? null : prev;
  }
  function routeTo(k, target){
    const start = groundNode(k);
    const goal = target === P ? (P.onGround ? groundNode(P) : pLastNode) : groundNode(target);
    if (start < 0 || goal < 0) return { ok: false, jump: null, drop: null };
    if (start === goal) return { ok: true, jump: null, drop: null };
    // prefer plain walking and drops, jump only when there's no other way
    const prev = bfsRoute(start, goal, false) || bfsRoute(start, goal, true);
    if (!prev) return { ok: false, jump: null, drop: null };
    const path = [];
    for (let n = goal; n !== start; n = prev[n]) path.push(n);
    path.push(start); path.reverse();
    for (let i = 0; i + 1 < path.length; i++){
      const a = path[i], b = path[i+1];
      const ax2 = a % LW, bx2 = b % LW;
      const ay = (a - ax2) / LW, by2 = (b - bx2) / LW;
      // any rise, or any move wider than one column, is executed as a jump/hop
      if (by2 < ay || Math.abs(bx2 - ax2) > 1)
        return { ok: true, jump: { lx: ax2, ly: ay, tx: bx2, ty: by2 }, drop: null };
      if (by2 > ay) return { ok: true, jump: null, drop: { tx: bx2 } };
    }
    return { ok: true, jump: null, drop: null };
  }
  // red light streaks pulled into the spear while the lunge charges
  const kFx = [];
  function spearTip(k){
    // the hands gripping the spear, not the tip
    return { x: k.x + k.w/2 + k.face*0.7*TILE, y: k.y + k.h - 0.52*TILE };
  }
  // stance frames with the weapon turning red as the lunge charges
  let LUNGE_TINTS = null;
  function lungeFrame(level){
    if (!LUNGE_TINTS){
      LUNGE_TINTS = [];
      for (let l = 0; l <= 10; l++){
        const cv = document.createElement('canvas');
        cv.width = KN.FW; cv.height = KN.FH;
        const g = cv.getContext('2d');
        g.drawImage(IMG.knight, KN_STANCE*KN.FW, KROW.ATTACK*KN.FH, KN.FW, KN.FH, 0, 0, KN.FW, KN.FH);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = 'rgba(255,40,30,' + (0.75*l/10).toFixed(3) + ')';
        g.fillRect(KN_TINT_SPLIT, 0, KN.FW - KN_TINT_SPLIT, KN.FH);
        LUNGE_TINTS.push(cv);
      }
    }
    return LUNGE_TINTS[Math.max(0, Math.min(10, level))];
  }
  // walk under 3.5 tiles of distance, run past 4.5, sticky in between
  function gait(k, d){
    if (d > 4.5*TILE) k.running = true;
    else if (d < 3.5*TILE) k.running = false;
    return k.running ? KN_RUN : KN_WALK;
  }
  // patrol walk: turn at walls, edges, patrol bounds, and sometimes at random
  function pace(k, anchorX, ranged){
    if (--k.patT <= 0){
      k.patT = 90 + Math.random()*90;
      if (Math.random() < 0.45) k.patDir *= -1;
    }
    const cx2 = k.x + k.w/2;
    if (ranged && (cx2 - anchorX) * k.patDir > 2.5*TILE) k.patDir *= -1;
    const ahead = Math.floor((cx2 + k.patDir*(k.w/2 + 10))/TILE);
    const fr2 = Math.floor((k.y + k.h)/TILE);
    if (solid(ahead, fr2-1) || solid(ahead, fr2-2) || !solid(ahead, fr2)){ k.patDir *= -1; k.patT = 90; }
    k.vx = k.patDir * KN_WALK * 0.8;
    k.face = k.patDir;
  }
  function updateKnights(){
    if (pDmgCd > 0) pDmgCd--;
    decayStreaks(kFx);
    for (let i = knights.length - 1; i >= 0; i--){
      const k = knights[i];
      k.vy += k.vy < 0 ? GRAV : GRAV_FALL;
      if (k.vy > FALL_MAX) k.vy = FALL_MAX;
      if (k.dead){
        k.vx = 0;
        moveSwept(k, 0, k.vy);
        if (grounded(k) && k.vy > 0) k.vy = 0;
        k.anim = 'DIE';
        k.frame = Math.min(KN.FRAMES - 1, Math.floor(++k.dieT / 4));
        if (k.dieT > 140) knights.splice(i, 1);
        continue;
      }
      // aggro on sight (same band and screen column), dropped when the player
      // leaves the band. After a give-up only the spawn screen re-arms him.
      const sameBand = bandOf(P.y + P.h/2) === bandOf(k.y + k.h/2);
      if (k.resetting && !k.stranded){
        if (bandOf(P.y + P.h/2) === bandOf(k.hy + k.h/2) &&
            Math.floor((P.x + P.w/2)/VIEW_W) === Math.floor((k.hx + k.w/2)/VIEW_W)){
          k.resetting = false; k.aggro = true;
        }
      } else if (k.resetting){
        // stranded with no way home: fight anyone who shows up
        if (sameBand && Math.floor((P.x + P.w/2)/VIEW_W) === Math.floor((k.x + k.w/2)/VIEW_W)){
          k.resetting = false; k.aggro = true;
        }
      } else {
        if (sameBand && Math.floor((P.x + P.w/2)/VIEW_W) === Math.floor((k.x + k.w/2)/VIEW_W)) k.aggro = true;
        if (!sameBand) k.aggro = false;
      }
      if (k.atkCd > 0) k.atkCd--;
      if (k.lungeCd > 0 && k.lungeT <= 0 && k.lungeDash <= 0) k.lungeCd--;
      const dxp = (P.x + P.w/2) - (k.x + k.w/2);
      let want = 'IDLE';
      if (k.lungeT > 0){
        // windup: frozen in stance, light streaming into the spear
        k.lungeT--;
        k.vx = 0;
        k.hurtT = 0;
        if (Math.random() < 0.25 + 0.6*(1 - k.lungeT/KN_LUNGE_WIND))
          kFx.push({ k, an: Math.random()*Math.PI*2, r: 42 + Math.random()*28,
                     vr: 2 + Math.random()*3, s: 1.2 + Math.random()*1.8 });
        if (k.lungeT === 0){ k.lungeDash = KN_LUNGE_DIST; k.lungeHit = false; k.dashPrevX = null; }
      } else if (k.lungeDash > 0){
        // the lunge itself (ledges included, he commits), cooldown starts at the end
        k.vx = k.face * KN_LUNGE_SPD;
        k.hurtT = 0;
        let stop = false;
        if (k.dashPrevX != null){
          const moved = Math.abs(k.x - k.dashPrevX);
          k.lungeDash -= moved;
          if (moved < 2 || k.lungeDash <= 0) stop = true;
        }
        if (stop){ k.lungeDash = 0; k.vx = 0; k.atkCd = KN_ATK_CD; k.lungeCd = KN_LUNGE_CD; }
        k.dashPrevX = k.x;
        if (!k.lungeHit && k.lungeDash > 0){
          const front = { x: k.face > 0 ? k.x : k.x - KN_REACH, y: k.y, w: k.w + KN_REACH, h: k.h };
          if (overlaps(front, P)){
            damage(KN_LUNGE_DMG); k.lungeHit = true; pDmgCd = 60;
            P.vx = k.face * 5*U; P.vy = Math.min(P.vy, -2.2*U);
          }
        }
      } else if (k.hurtT > 0){
        k.hurtT--;
        k.vx = 0;
        k.frame = Math.min(KN.FRAMES - 1, Math.floor((KN_HURT - k.hurtT)/KN_HURT*KN.FRAMES));
      } else if (k.attackT > 0){
        k.attackT--;
        if (k.attackT === 0) k.atkCd = KN_ATK_CD;
        k.vx = 0;
        k.frame = Math.min(KN.FRAMES - 1, Math.floor((KN_ATTACK_DUR - k.attackT)/KN_ATTACK_DUR*KN.FRAMES));
        // the swing connects on its middle frames
        if (!k.didHit && k.frame >= 4 && k.frame <= 7){
          const swing = { x: k.face > 0 ? k.x + k.w : k.x - KN_REACH, y: k.y, w: KN_REACH, h: k.h };
          if (overlaps(swing, P)){ damage(20); k.didHit = true; pDmgCd = 60; }
        }
      } else {
        const dist = Math.abs(dxp);
        const level = Math.abs((P.y + P.h) - (k.y + k.h)) < 1.5*TILE;
        if (k.aggro && k.onGround && k.lungeCd <= 0 && level && dist <= 6*TILE){
          k.lungeT = KN_LUNGE_WIND;
          k.lungeCd = KN_LUNGE_CD;
          k.face = dxp < 0 ? -1 : 1;
          k.vx = 0;
        } else if (k.aggro && dist < 0.85*TILE + KN_REACH/2 && level){
          if (Math.abs(dxp) > 8) k.face = dxp < 0 ? -1 : 1;
          if (k.atkCd <= 0){ k.attackT = KN_ATTACK_DUR; k.didHit = false; k.frame = 0; }
          else k.vx = 0;   // catching his breath between swings
        } else if (k.settleX != null){
          // finish a landing by stepping onto the middle of the block
          const sdx = k.settleX - (k.x + k.w/2);
          if (k.onGround && Math.abs(sdx) >= 4){
            k.vx = Math.sign(sdx) * KN_WALK;
            want = 'WALK';
          } else k.settleX = null;
        } else if (k.onGround || k.jumpTx == null){
          // destination: the player when aggroed and reachable, otherwise home,
          // otherwise pace in place. Routes are pinned until the timer runs out or
          // the player's node changes, and skipped mid-jump so a replan can't spin him.
          const pn = P.onGround ? groundNode(P) : pLastNode;
          if (--k.pathT <= 0 || (k.aggro && !k.goalHome && k.lastPN !== pn)){
            k.pathT = 30;
            k.lastPN = pn;
            k.route = null; k.goalHome = false;
            if (k.aggro){
              const rp = routeTo(k, P);
              if (rp.ok) k.route = rp;
              else { k.aggro = false; k.resetting = true; }   // give up and reset
            }
            if (!k.route){
              k.goalHome = true;
              const rh = routeTo(k, { x: k.hx, y: k.hy, w: k.w, h: k.h });
              if (rh.ok) k.route = rh;
            }
            k.stranded = k.goalHome && !k.route;
          }
          const r = k.route;
          const gx2 = k.goalHome ? k.hx + k.w/2 : P.x + P.w/2;
          const gdx = gx2 - (k.x + k.w/2);
          if (!r){
            pace(k, k.x + k.w/2, false);
            want = 'WALK';
          } else if (r.drop){
            const dc = r.drop.tx*TILE + TILE/2;
            const ddx = dc - (k.x + k.w/2);
            k.vx = Math.sign(ddx || gdx || 1) * KN_WALK;
            want = 'WALK';
          } else if (r.jump){
            if (k.onGround) k.face = r.jump.tx > r.jump.lx ? 1 : -1;   // look at the ledge, not the player
            const lc = r.jump.lx*TILE + TILE/2;
            const ddx = lc - (k.x + k.w/2);
            if (k.onGround && k.jmpCd <= 0 && Math.abs(ddx) < 12 && Math.floor((k.y + k.h)/TILE) === r.jump.ly){
              // fire only right at the launch spot, a loose window bonked the lip.
              // apex = rise + 0.9 tiles, wide jumps get extra hang time to cross
              const up2 = Math.max(0, r.jump.ly - r.jump.ty);
              const across = Math.abs(r.jump.lx - r.jump.tx);
              const H2 = (up2 + 0.9 + (across >= 3 ? 0.8 : across === 2 ? 0.3 : 0)) * TILE;
              k.vy = -(Math.sqrt(GRAV*GRAV/4 + 2*GRAV*H2) + GRAV/2);
              k.jumpTx = r.jump.tx*TILE + TILE/2;
              k.jumpTy = r.jump.ty*TILE;
              k.jumpGap = Math.abs(r.jump.lx - r.jump.tx) > 1;
              k.jumpFrom = Math.floor((k.y + k.h)/TILE);   // launch row: any landing this low failed
              k.route = null; k.pathT = 0;
            } else {
              const d2 = Math.abs(ddx);
              const sp = gait(k, d2);
              k.vx = d2 < 6 ? 0 : Math.sign(ddx) * sp;
              want = k.vx === 0 ? 'IDLE' : (k.running ? 'RUN' : 'WALK');
            }
          } else if (Math.abs(gdx) < (k.goalHome ? TILE : 0.4*TILE)){
            if (k.goalHome){ pace(k, k.hx + k.w/2, true); want = 'WALK'; }
            else k.vx = 0;   // right under or over the player, hold steady
          } else {
            const spd = (k.goalHome && !k.aggro) ? KN_WALK : gait(k, Math.abs(gdx));
            k.vx = Math.sign(gdx) * spd;
            want = spd === KN_RUN ? 'RUN' : 'WALK';
          }
          if (k.vx !== 0) k.face = k.vx < 0 ? -1 : 1;
        }
      }
      // mid-air: gap jumps drift toward the landing right away, edge jumps rise
      // straight first so he can't scrape the platform's side
      if (!k.onGround && k.jumpTx != null){
        if (k.jumpGap || k.y + k.h <= k.jumpTy - 2){
          const dd = k.jumpTx - (k.x + k.w/2);
          k.vx = Math.abs(dd) < 6 ? 0 : Math.sign(dd) * KN_RUN;
        } else {
          k.vx = 0;
        }
      }
      moveSwept(k, k.vx, 0);
      moveSwept(k, 0, k.vy);
      k.onGround = grounded(k);
      if (k.onGround){
        if (k.vy > 0) k.vy = 0;
        // settle onto the middle of the block, but only if the jump actually
        // reached it, a failed jump must not drag him back toward the lip
        if (k.jumpTx != null){
          if (Math.floor((k.y + k.h)/TILE)*TILE === k.jumpTy) k.settleX = k.jumpTx;
          k.jumpTx = null;
        }
      }
      if (k.onGround && !k.wasGround){
        k.jmpCd = 30;   // half-second breather after landing
        k.route = null; k.pathT = 0;   // landings invalidate the old plan
        // two failed jumps in a row (no height gained): back off, pace, repath
        if (k.jumpFrom != null){
          if (Math.floor((k.y + k.h)/TILE) >= k.jumpFrom){
            if (++k.jumpFails >= 2){ k.jumpFails = 0; k.route = null; k.pathT = 90; }
          } else k.jumpFails = 0;
          k.jumpFrom = null;
        }
      }
      k.wasGround = k.onGround;
      if (k.jmpCd > 0) k.jmpCd--;
      if (!k.onGround && k.attackT <= 0 && k.hurtT <= 0 && k.lungeT <= 0 && k.lungeDash <= 0) want = 'JUMP';
      // touching the knight hurts and bounces the player off
      const near2 = { x: k.x - 3, y: k.y - 3, w: k.w + 6, h: k.h + 6 };
      if (pDmgCd <= 0 && overlaps(near2, P)){
        damage(10); pDmgCd = 60;
        P.vx = (P.x + P.w/2 < k.x + k.w/2 ? -1 : 1) * 4*U;
        P.vy = Math.min(P.vy, -2.2*U);
      }
      if (k.lungeT > 0 || k.lungeDash > 0){ k.anim = 'ATTACK'; k.frame = KN_STANCE; }
      else if (k.attackT > 0){ k.anim = 'ATTACK'; }
      else if (k.hurtT > 0){ k.anim = 'HURT'; }
      else {
        if (want !== k.anim){ k.anim = want; k.frame = 0; k.ftime = 0; }
        if (k.anim === 'IDLE') k.frame = 0;
        else if (k.anim === 'JUMP') k.frame = k.vy < -1 ? 3 : k.vy > 1 ? 6 : 4;
        else { const sp2 = k.anim === 'RUN' ? 3 : 4;
          k.ftime++; if (k.ftime >= sp2){ k.ftime = 0; k.frame = (k.frame + 1) % KN.FRAMES; } }
      }
    }
  }

  // ---------- camera ----------
  const LEVEL_PX_W = LW*TILE, LEVEL_PX_H = LH*TILE;
  const CAM_SKY_Y  = 2*TILE;
  const CAM_SURF_Y = (SURF+2)*TILE - VIEW_H;
  const CAM_ROOM_Y = LH*TILE - VIEW_H;
  const cam = { x:0, y:CAM_SURF_Y };
  const CAM_TRANS = 45;
  let camRegion = 1, camTrans = 0, camFromX = 0, camFromY = CAM_SURF_Y;
  const SCREENS_X = Math.max(1, Math.floor((LEVEL_PX_W - VIEW_W)/VIEW_W) + 1);
  const SCREENS_Y = 3;
  const SCREEN_BANDS = [[0, SKY_ROWS], [SKY_ROWS, SURF+2], [SURF+2, LH]];
  // a room exists where a screen band has both open space and structure
  const SCREEN_TILES_X = VIEW_W / TILE;
  const rooms = [];
  for (let r = 0; r < SCREENS_Y; r++){
    rooms.push([]);
    for (let c = 0; c < SCREENS_X; c++){
      let open = false, sol = false;
      for (let ty = SCREEN_BANDS[r][0]; ty < SCREEN_BANDS[r][1]; ty++)
        for (let tx = c*SCREEN_TILES_X; tx < (c+1)*SCREEN_TILES_X; tx++)
          if (map[ty][tx] === 0) open = true; else sol = true;
      rooms[r].push(open && sol);
    }
  }
  // band of a world y (0 sky, 1 surface, 2 underground), the sky line sits above
  // the sky-room floor so bonking underneath doesn't count as entering
  function bandOf(y){ return y >= (SURF+2)*TILE ? 2 : y < (SKY_ROWS-1)*TILE ? 0 : 1; }
  // the screen the player counts as being on, camera and minimap agree through this
  function screenPos(){
    const col = Math.min(SCREENS_X-1, Math.max(0, Math.floor((P.x + P.w/2)/VIEW_W)));
    let region = bandOf(P.y + P.h/2);
    if (region !== 1 && !rooms[region][col]) region = 1;
    return { col, region };
  }

  // ---------- physics ----------
  const EPS = 0.01;
  function moveAxis(E, dx, dy){
    if (dx !== 0){
      E.x += dx;
      const y0 = Math.floor(E.y/TILE), y1 = Math.floor((E.y+E.h-EPS)/TILE);
      if (dx > 0){ const tx = Math.floor((E.x+E.w-EPS)/TILE);
        for (let ty=y0;ty<=y1;ty++) if (solid(tx,ty)){ E.x = tx*TILE - E.w; E.vx=0; break; } }
      else { const tx = Math.floor(E.x/TILE);
        for (let ty=y0;ty<=y1;ty++) if (solid(tx,ty)){ E.x = (tx+1)*TILE; E.vx=0; break; } }
    }
    if (dy !== 0){
      E.y += dy;
      const x0 = Math.floor(E.x/TILE), x1 = Math.floor((E.x+E.w-EPS)/TILE);
      if (dy > 0){ const ty = Math.floor((E.y+E.h)/TILE);
        for (let tx=x0;tx<=x1;tx++) if (solid(tx,ty)){ E.y = ty*TILE - E.h; E.vy=0; break; } }
      else { const ty = Math.floor(E.y/TILE);
        for (let tx=x0;tx<=x1;tx++) if (solid(tx,ty)){ E.y = (ty+1)*TILE; E.vy=0; break; } }
    }
  }
  // half-tile substeps so high speeds can't tunnel
  function moveSwept(E, dx, dy){
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.max(1, Math.ceil(m / (TILE/2)));
    for (let i = 0; i < steps; i++) moveAxis(E, dx/steps, dy/steps);
  }
  function grounded(E){
    const ty = Math.floor((E.y+E.h+1)/TILE);
    const x0 = Math.floor(E.x/TILE), x1 = Math.floor((E.x+E.w-EPS)/TILE);
    for (let tx=x0;tx<=x1;tx++) if (solid(tx,ty)) return true;
    return false;
  }
  function overlaps(a, b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function bboxSolid(x, y, w, h){
    const x0 = Math.floor(x/TILE), x1 = Math.floor((x+w-EPS)/TILE);
    const y0 = Math.floor(y/TILE), y1 = Math.floor((y+h-EPS)/TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) return true;
    return false;
  }

  function update(){
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const maxSpd = sprint ? RUN_SPD : WALK_SPD;
    let ix = 0;
    if (keys['KeyA'] || keys['ArrowLeft'])  ix -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
    if (ix !== 0){
      P.vx += ix * ACCEL;
      P.vx = Math.max(-maxSpd, Math.min(maxSpd, P.vx));
      if (P.attackT <= 0) P.face = ix;
    } else {
      if (Math.abs(P.vx) < FRIC) P.vx = 0; else P.vx -= Math.sign(P.vx)*FRIC;
    }

    if (P.vy < 0){
      P.vy += GRAV;
      if (!keys['Space']) P.vy *= JUMP_CUT;   // analog jump height
    } else {
      P.vy += GRAV_FALL;                      // gentle downward acceleration...
      if (P.vy > FALL_MAX) P.vy = FALL_MAX;   // ...capped low so it never runs away
    }
    moveSwept(P, P.vx, 0);
    moveSwept(P, 0, P.vy);
    P.onGround = grounded(P);
    if (P.onGround){
      if (P.vy > 0) P.vy = 0;
      P.coyote = 6;
      const pn0 = groundNode(P); if (pn0 >= 0) pLastNode = pn0;
    } else if (P.coyote>0) P.coyote--;
    if (P.jumpBuf>0) P.jumpBuf--;
    if (P.jumpBuf>0 && P.coyote>0){ P.vy = -JUMP_V; P.onGround=false; P.coyote=0; P.jumpBuf=0; playSfx('jump', 0.1); }
    // double jump: a second Space press in the air, once per airtime, after the pickup
    else if (P.jumpBuf>0 && P.canDouble && !P.usedDouble && !P.onGround){ P.vy = -JUMP_V; P.usedDouble = true; P.jumpBuf = 0; playSfx('jump', 0.1); }
    if (P.onGround) P.usedDouble = false;

    if (P.x < 0){ P.x=0; P.vx=0; }
    if (P.x > LEVEL_PX_W-P.w){ P.x=LEVEL_PX_W-P.w; P.vx=0; }
    if (P.y > LEVEL_PX_H + 40*U){ P.x=2*TILE; P.y=SURF*TILE - P.h; P.vx=P.vy=0; }

    updateKnights();

    // enemies are solid: push the player out along the shallow axis, but never
    // into terrain
    for (const k of knights){
      if (k.dead || !overlaps(P, k)) continue;
      const ox = (P.w + k.w)/2 - Math.abs((P.x + P.w/2) - (k.x + k.w/2));
      const oy = (P.h + k.h)/2 - Math.abs((P.y + P.h/2) - (k.y + k.h/2));
      if (ox < oy){
        const dir = (P.x + P.w/2) < (k.x + k.w/2) ? -1 : 1;
        if (!bboxSolid(P.x + dir*ox, P.y, P.w, P.h)){ P.x += dir*ox; P.vx = 0; }
      } else {
        const dir = (P.y + P.h/2) < (k.y + k.h/2) ? -1 : 1;
        if (!bboxSolid(P.x, P.y + dir*oy, P.w, P.h)){
          P.y += dir*oy;
          if (dir < 0){ if (P.vy > 0) P.vy = 0; } else if (P.vy < 0) P.vy = 0;
        }
      }
    }

    // grab ability pickups
    for (const pk of pickups){
      if (pk.taken) continue;
      if (P.x < pk.x + pk.w && P.x + P.w > pk.x &&
          P.y < pk.y + pk.h && P.y + P.h > pk.y){
        pk.taken = true;
        if (pk.kind === 'double') P.canDouble = true;
        if (pk.kind === 'charge') P.canCharge = true;
        notify(pk);
      }
    }

    // frozen while charging so the drawn pose holds
    if (P.attackT > 0 && !P.charging) P.attackT--;

    if (!P.charging && P.canCharge && mouse.down && P.attackT > 0 && !P.pendingShot && P.frame >= RELEASE_FRAME){
      P.charging = true; P.chargeT = 0;
    }
    if (P.charging){
      P.chargeT = Math.min(P.chargeT + 1, CHARGE_MAX);
      chargeSndStart(); chargeSndUpdate(P.chargeT / CHARGE_MAX);
      if (!mouse.down){
        chargeSndStop();
        spawnArrow(P.chargeT / CHARGE_MAX);
        P.charging = false;
        P.attackT = RECOVER_TICKS;
      }
    }
    updateChargeFx();

    // ---- animation: movement pose drives the body, or the legs when attacking ----
    const move = !P.onGround ? 'JUMP'
               : Math.abs(P.vx) > 0.3*U ? (Math.abs(P.vx) > WALK_SPD + 0.2*U ? 'RUN' : 'WALK')
               : 'IDLE';
    if (P.hurtT > 0) P.hurtT--;
    const want = P.attackT > 0 ? 'ATTACK' : P.hurtT > 0 ? 'HURT' : move;
    if (want !== P.anim){
      if (want === 'ATTACK' && (P.anim === 'WALK' || P.anim === 'RUN')){ P.lframe = P.frame; P.ltime = P.ftime; }
      else { P.lframe = 0; P.ltime = 0; }
      P.anim = want; P.frame = 0; P.ftime = 0;
    }
    if (P.anim === 'ATTACK'){
      if (P.charging){
        // held at full draw, tracking the cursor, turning around is allowed
        faceToMouse();
        P.frame = RELEASE_FRAME - 1;
        aimAtMouse();
      } else {
      const elapsed = ATTACK_DUR - P.attackT;
      if (elapsed < DRAW_TICKS){
        P.frame = Math.min(RELEASE_FRAME, Math.floor(elapsed / DRAW_TICKS * (RELEASE_FRAME + 1)));
      } else {
        const t = (elapsed - DRAW_TICKS) / RECOVER_TICKS;
        const e = 1 - (1 - t) * (1 - t);
        P.frame = Math.min(NF - 1, RELEASE_FRAME + 1 + Math.floor(e * (NF - 1 - RELEASE_FRAME)));
      }
      if (elapsed < DRAW_TICKS || P.pendingShot){
        aimAtMouse();
      } else {
        // ease the arm back to neutral so it never snaps
        const step = P.aim * 0.15 + Math.sign(P.aim) * 0.009;
        P.aim = Math.abs(step) >= Math.abs(P.aim) ? 0 : P.aim - step;
      }
      if (P.pendingShot && P.frame >= RELEASE_FRAME){ spawnArrow(0); P.pendingShot = false; }
      }
      // legs keep following the movement underneath the attack
      P.legs = move;
      if (move === 'WALK' || move === 'RUN'){
        const speed = move === 'RUN' ? 3 : 4;
        P.ltime++; if (P.ltime >= speed){ P.ltime = 0; P.lframe = (P.lframe + 1) % NF; }
      } else if (move === 'JUMP'){ P.lframe = P.vy < -1 ? 3 : P.vy > 1 ? 6 : 4; }
      else { P.lframe = 0; }
    }
    else if (P.anim==='HURT'){ P.frame = Math.min(NF-1, Math.floor((P_HURT - P.hurtT)/P_HURT*NF)); }
    else if (P.anim==='IDLE'){ P.frame = 0; }
    else if (P.anim==='JUMP'){ P.frame = P.vy < -1 ? 3 : P.vy > 1 ? 6 : 4; }
    else { const speed = P.anim==='RUN'?3:4;
      P.ftime++; if (P.ftime>=speed){ P.ftime=0; P.frame=(P.frame+1)%NF; } }

    // footsteps ride the leg animation's contact frames, so cadence tracks walk vs run
    const gaitOn = P.onGround && (P.attackT > 0 ? (P.legs === 'WALK' || P.legs === 'RUN')
                                                : (P.anim === 'WALK' || P.anim === 'RUN'));
    const gaitFrame = P.attackT > 0 ? P.lframe : P.frame;
    if (gaitOn && gaitFrame !== P.lastStep && (gaitFrame === 0 || gaitFrame === 5))
      playSfx('step', 0.025, 0.95 + Math.random()*0.1);
    P.lastStep = gaitOn ? gaitFrame : -1;

    // arrows fly straight (no gravity)
    for (const a of arrows){ a.x+=a.vx; a.y+=a.vy; a.life--;
      for (const k of knights){
        if (k.dead || a.life <= 0) continue;
        if (a.x > k.x && a.x < k.x + k.w && a.y > k.y && a.y < k.y + k.h){
          k.hp -= a.dmg; k.hurtT = KN_HURT; k.attackT = 0;
          k.atkCd = Math.max(k.atkCd, 20);
          if (a.charge > 0.03) makeBurst(a.x, a.y, a.charge);
          if (k.hp <= 0){ k.dead = true; k.dieT = 0; k.attackT = 0; k.lungeT = 0; k.lungeDash = 0; }
          a.life = 0;
        }
      }
      if (a.life > 0 && solid(Math.floor(a.x/TILE), Math.floor(a.y/TILE))){
        const hv = map[Math.floor(a.y/TILE)] ? map[Math.floor(a.y/TILE)][Math.floor(a.x/TILE)] : 1;
        playSfx(hv === 2 || hv === 3 ? 'wood' : 'dirt', hv === 2 || hv === 3 ? 0.45 : 0.9);
        if (a.charge > 0.03) makeBurst(a.x, a.y, a.charge);
        // a full power shot spends itself in the burst, anything less sticks
        if (a.charge < 0.98) stickArrow(a);
        a.life = 0;
      } }
    for (let i=arrows.length-1;i>=0;i--) if (arrows[i].life<=0) arrows.splice(i,1);
    for (let i=fx.length-1;i>=0;i--) if (++fx[i].t > 28) fx.splice(i,1);
    for (let i=stuck.length-1;i>=0;i--) if (++stuck[i].t > STICK_LIFE) stuck.splice(i,1);

    // camera: surface pans, 1x1 rooms lock, regions smoothstep between stops
    const { col: curCol, region } = screenPos();
    const followX = Math.max(0, Math.min(LEVEL_PX_W - VIEW_W, P.x + P.w/2 - VIEW_W/2));
    const lockX = curCol * VIEW_W;
    const tx = region === 1 ? followX : lockX;
    const ty = region === 0 ? CAM_SKY_Y : region === 1 ? CAM_SURF_Y : CAM_ROOM_Y;
    if (region !== camRegion){ camRegion = region; camTrans = CAM_TRANS; camFromX = cam.x; camFromY = cam.y; }
    if (camTrans > 0){
      camTrans--;
      const t = 1 - camTrans/CAM_TRANS;
      const e = t*t*(3 - 2*t);
      cam.x = Math.round(camFromX + (tx - camFromX)*e);
      cam.y = Math.round(camFromY + (ty - camFromY)*e);
    } else {
      cam.x = Math.round(tx);
      cam.y = ty;
    }
  }

  // ---------- rendering ----------
  // daytime backdrop, painted once and repeated for every screen section
  const BG = document.createElement('canvas');
  BG.width = VIEW_W; BG.height = VIEW_H;
  (function paintBG(){
    const g = BG.getContext('2d');
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
    g.fillStyle = '#69a857';
    g.beginPath(); g.ellipse(700, VIEW_H + 60, 420, 260, 0, 0, Math.PI*2); g.fill();
    hillPine(640, 470, 26); hillPine(820, 500, 32); hillPine(930, 545, 24);
    g.fillStyle = '#7fbf6a';
    g.beginPath(); g.ellipse(180, VIEW_H + 40, 340, 220, 0, 0, Math.PI*2); g.fill();
    hillPine(90, 505, 30); hillPine(230, 490, 36); hillPine(340, 545, 26);
  })();
  function drawBackground(){
    const off = ((cam.x % VIEW_W) + VIEW_W) % VIEW_W;
    ctx.drawImage(BG, -off, 0);
    if (off) ctx.drawImage(BG, VIEW_W - off, 0);
  }
  // cloud crown, built once and drawn in front of the player and arrows,
  // anchored by the bottom-center lobe pinned 12px into the trunk top
  let CROWN = null;
  const CROWN_LOBES = [[160,64,58],[95,112,56],[225,112,56],[50,186,50],[160,172,72],[270,186,50],
                       [105,205,55],[215,205,55]];
  const CROWN_SCALE = 1.35;
  const CROWN_W = Math.round(5*TILE*CROWN_SCALE), CROWN_H = Math.round(4*TILE*CROWN_SCALE);
  const CROWN_AX = Math.round(160*CROWN_SCALE), CROWN_AY = Math.round(244*CROWN_SCALE);
  function crownCanvas(){
    if (CROWN) return CROWN;
    const cv = document.createElement('canvas');
    cv.width = CROWN_W; cv.height = CROWN_H;
    const g = cv.getContext('2d');
    for (let y = 0; y < cv.height; y += TILE)
      for (let x = 0; x < cv.width; x += TILE) g.drawImage(IMG.leaf, x, y);
    g.globalCompositeOperation = 'destination-in';
    g.beginPath();
    for (const c of CROWN_LOBES){
      const cx2 = c[0]*CROWN_SCALE, cy2 = c[1]*CROWN_SCALE, r2 = c[2]*CROWN_SCALE;
      g.moveTo(cx2+r2, cy2); g.arc(cx2, cy2, r2, 0, Math.PI*2);
    }
    g.fill();
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, 0, 0, cv.height);
    sh.addColorStop(0.45, 'rgba(10,25,12,0)'); sh.addColorStop(1, 'rgba(10,25,12,0.3)');
    g.fillStyle = sh; g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'source-over';
    return (CROWN = cv);
  }
  function drawKnights(){
    ctx.imageSmoothingEnabled = true;
    for (const k of knights){
      const sx = Math.round(k.x + k.w/2 - cam.x);
      const fy = Math.round(k.y + k.h - cam.y);
      ctx.save();
      ctx.translate(sx, fy);
      if (k.face < 0) ctx.scale(-1, 1);
      if (k.dead) ctx.globalAlpha = Math.max(0, Math.min(1, (140 - k.dieT) / 40));
      if (k.lungeT > 0 || k.lungeDash > 0){
        const prog = k.lungeDash > 0 ? 1 : 1 - k.lungeT/KN_LUNGE_WIND;
        ctx.drawImage(lungeFrame(Math.round(prog*10)), 0, 0, KN.FW, KN.FH,
                      -KN_CX/SS, -KN.anchorY/SS, KN.FW/SS, KN.FH/SS);
      } else {
        ctx.drawImage(IMG.knight, k.frame*KN.FW, KROW[k.anim]*KN.FH, KN.FW, KN.FH,
                      -KN_CX/SS, -KN.anchorY/SS, KN.FW/SS, KN.FH/SS);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = false;
  }
  // light streaks converging on a point, shared by the charge shot and the lunge
  function drawStreaks(list, originOf, stroke, glow, aScale){
    if (!list.length) return;
    ctx.lineCap = 'round';
    for (const q of list){
      const o = originOf(q);
      const c2 = Math.cos(q.an), s3 = Math.sin(q.an);
      const x = o.x + c2*q.r - cam.x, y = o.y + s3*q.r - cam.y;
      const t = 1 - q.r/70;
      ctx.globalAlpha = (0.25 + 0.6*t) * aScale;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = q.s * (0.5 + 0.6*t);
      ctx.shadowColor = glow;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(x + c2*(q.s*4), y + s3*(q.s*4));
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.lineCap = 'butt';
  }
  function drawKFx(){ drawStreaks(kFx, q => spearTip(q.k), '#ff6a55', 'rgba(255,60,40,0.8)', 1); }
  function drawCrowns(){
    const cv = crownCanvas();
    for (const t of TREE_CROWNS){
      const x = t.cx*TILE + TILE/2 - CROWN_AX;
      const y = (t.top+4)*TILE + 12 - CROWN_AY;
      ctx.drawImage(cv, x - cam.x, y - cam.y);
    }
  }
  function drawTiles(){
    const x0 = Math.floor(cam.x/TILE), x1 = Math.floor((cam.x+VIEW_W)/TILE);
    const y0 = Math.floor(cam.y/TILE), y1 = Math.floor((cam.y+VIEW_H)/TILE);
    for (let ty=y0; ty<=y1; ty++) for (let tx=x0; tx<=x1; tx++){
      const v = (ty>=0 && ty<LH && tx>=0 && tx<LW) ? map[ty][tx] : 0;
      if (!v || v >= 3) continue;   // the crown draws the leaf cells
      const sx = tx*TILE - cam.x, sy = ty*TILE - cam.y;
      ctx.drawImage(v === 2 ? IMG.bark : (!solid(tx,ty-1) ? IMG.grass : IMG.dirt), sx, sy);
    }
  }
  function drawPickups(){
    for (const pk of pickups){
      if (pk.taken) continue;
      const x = pk.x - cam.x, y = pk.y - cam.y;
      if (pk.glow){ ctx.shadowColor = pk.glow; ctx.shadowBlur = 12; }
      ctx.fillStyle = pk.fill;
      ctx.fillRect(x + 2*U, y + 2*U, pk.w - 4*U, pk.h - 4*U);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pk.edge;
      ctx.strokeRect(x + 2*U + 0.5, y + 2*U + 0.5, pk.w - 4*U - 1, pk.h - 4*U - 1);
    }
  }
  // muted text with an accent keycap, like the bottom bar hints
  function keycapLine(cx2, ly, verb, key, tail){
    const vw = ctx.measureText(verb + ' ').width;
    const kw = ctx.measureText(key).width + 4*U;
    const aw = ctx.measureText(' ' + tail).width;
    let lx = cx2 - (vw + kw + aw)/2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8a9099';
    ctx.fillText(verb + ' ', lx, ly); lx += vw;
    ctx.strokeStyle = '#60e0d0';
    roundRect(lx, ly - 3*U, kw, 6*U, U); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#60e0d0';
    ctx.fillText(key, lx + kw/2, ly); lx += kw;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8a9099';
    ctx.fillText(' ' + tail, lx, ly);
  }
  function drawNotice(){
    noticeBtn = null;
    if (!notice) return;
    ctx.fillStyle = 'rgba(6,8,12,0.5)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const cx2 = VIEW_W/2, cy2 = VIEW_H/2;
    const f1 = 'bold ' + Math.round(5.5*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    const f2 = Math.round(3.5*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.font = f1;
    const tw = ctx.measureText(notice.title).width;
    ctx.font = f2;
    const lw = ctx.measureText(notice.verb + ' ').width + ctx.measureText(notice.key).width + 4*U + ctx.measureText(' ' + notice.tail).width;
    const w = Math.max(tw, lw) + 16*U, h = 36*U;
    ctx.fillStyle = 'rgba(14,16,19,0.94)';
    roundRect(cx2 - w/2, cy2 - h/2, w, h, 2*U); ctx.fill();
    ctx.strokeStyle = '#60e0d0';
    roundRect(cx2 - w/2, cy2 - h/2, w, h, 2*U); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = f1;
    ctx.fillStyle = '#e8ecf0';
    ctx.fillText(notice.title, cx2, cy2 - 11*U);
    ctx.font = f2;
    keycapLine(cx2, cy2 - 2*U, notice.verb, notice.key, notice.tail);
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
  }
  function drawPaused(){
    if (!paused) return;
    ctx.fillStyle = 'rgba(6,8,12,0.5)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const cx2 = VIEW_W/2, cy2 = VIEW_H/2;
    const w = 60*U, h = 24*U;
    ctx.fillStyle = 'rgba(14,16,19,0.94)';
    roundRect(cx2 - w/2, cy2 - h/2, w, h, 2*U); ctx.fill();
    ctx.strokeStyle = '#60e0d0';
    roundRect(cx2 - w/2, cy2 - h/2, w, h, 2*U); ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = 'bold ' + Math.round(5.5*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = '#e8ecf0';
    ctx.fillText('Paused', cx2, cy2 - 5*U);
    ctx.font = Math.round(3.5*U) + 'px ui-monospace, Menlo, Consolas, monospace';
    keycapLine(cx2, cy2 + 4.5*U, 'Press', 'Esc', 'to resume');
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  // attack draws in layers: bow arm behind, movement legs, attack torso on top
  function drawPlayer(){
    const sx = Math.round(P.x + P.w/2 - cam.x);
    const feetY = Math.round(P.y + P.h - cam.y);
    ctx.save();
    ctx.translate(sx, feetY);
    if (P.face < 0) ctx.scale(-1,1);
    ctx.imageSmoothingEnabled = true;
    if (P.anim === 'ATTACK'){
      const sh = SHOULDER[P.frame] || SHOULDER[0];
      ctx.save();
      ctx.translate(sh[0]/SS, sh[1]/SS);
      ctx.rotate(P.aim);
      ctx.drawImage(IMG.bowarm, P.frame*BW, 0, BW, BH, -BPX/SS, -BPY/SS, BW/SS, BH/SS);
      if (P.charging){
        const cg = P.chargeT / CHARGE_MAX;
        chargeGlow(cg);
        ctx.drawImage(tintedArrow(cg), GRIP[0]/SS - ARROW_LEN*0.55, GRIP[1]/SS - ARROW_THICK/2, ARROW_LEN, ARROW_THICK);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
      const legDY = P.legs === 'JUMP' ? JUMP_LEG_DY : 0;
      ctx.drawImage(IMG.archer, P.lframe*FW, LEGROW[P.legs]*FH, FW, FH, -AX/SS, -AY/SS + legDY, FW/SS, FH/SS);
      ctx.drawImage(IMG.archer, P.frame*FW, ROW.ATTACK*FH, FW, FH, -AX/SS, -AY/SS, FW/SS, FH/SS);
    } else {
      ctx.drawImage(IMG.archer, P.frame*FW, ROW[P.anim]*FH, FW, FH, -AX/SS, -AY/SS, FW/SS, FH/SS);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.restore();
  }
  const ARROW_LEN = 0.95*TILE, ARROW_THICK = ARROW_LEN * (12/88);
  function drawChargeFx(){
    if (!P.charging) return;
    const g2 = gripWorld();
    drawStreaks(chargeFx, () => g2, '#ffffff', CHG_GLOW + '0.8)', 0.45 + 0.55*(P.chargeT/CHARGE_MAX));
  }
  // tinted arrow sprites cached per charge level
  const tintCache = {};
  function tintedArrow(c){
    const k = Math.max(0, Math.min(10, Math.round(c*10)));
    if (k === 0) return IMG.arrow;
    if (tintCache[k]) return tintCache[k];
    const cv = document.createElement('canvas');
    cv.width = IMG.arrow.naturalWidth || 88; cv.height = IMG.arrow.naturalHeight || 12;
    const g = cv.getContext('2d');
    g.drawImage(IMG.arrow, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    const t = Math.max(0, Math.min(1, (k/10)*1.2 - 0.2));
    const col = CHG_TINT.map((v,i) => Math.round(v + (CHG_CORE[i]-v)*t));
    g.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (CHG_TINT_MAX*k/10) + ')';
    g.fillRect(0, 0, cv.width, cv.height);
    tintCache[k] = cv;
    return cv;
  }
  function chargeGlow(c){
    ctx.shadowColor = CHG_GLOW + (0.15 + 0.85*c) + ')';
    ctx.shadowBlur = 4 + CHG_GLOW_MAX*c;
  }
  function drawArrows(){
    ctx.imageSmoothingEnabled = true;
    for (const a of arrows){
      ctx.save();
      ctx.translate(a.x - cam.x, a.y - cam.y);
      ctx.rotate(a.ang);
      if (a.charge > 0.02) chargeGlow(a.charge);
      ctx.drawImage(tintedArrow(a.charge), -ARROW_LEN/2, -ARROW_THICK/2, ARROW_LEN, ARROW_THICK);
      ctx.restore();
    }
    ctx.imageSmoothingEnabled = false;
  }
  function drawStuck(){
    ctx.imageSmoothingEnabled = true;
    for (const s2 of stuck){
      const al = Math.min(1, (STICK_LIFE - s2.t) / STICK_FADE);
      ctx.globalAlpha = al;
      // cracks clip to solid tiles so they never draw on the background
      ctx.save();
      ctx.beginPath();
      const ctx0 = Math.floor((s2.bx - 2*TILE)/TILE), ctx1 = Math.floor((s2.bx + 2*TILE)/TILE);
      const cty0 = Math.floor((s2.by - 2*TILE)/TILE), cty1 = Math.floor((s2.by + 2*TILE)/TILE);
      for (let ty = cty0; ty <= cty1; ty++)
        for (let tx = ctx0; tx <= ctx1; tx++)
          if (solid(tx, ty)) ctx.rect(tx*TILE - cam.x, ty*TILE - cam.y, TILE, TILE);
      ctx.clip();
      ctx.strokeStyle = 'rgba(10,8,6,0.75)';
      ctx.lineWidth = 1.5;
      for (const pts of s2.cracks){
        ctx.beginPath();
        ctx.moveTo(pts[0][0]-cam.x, pts[0][1]-cam.y);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0]-cam.x, pts[k][1]-cam.y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.translate(s2.x - cam.x, s2.y - cam.y);
      ctx.rotate(s2.ang);
      // charged arrows cool back to plain wood over the first second
      const cool = s2.charge * Math.max(0, 1 - s2.t/60);
      if (cool > 0.02) chargeGlow(cool * al);
      // crop the buried tip
      const spr = tintedArrow(cool);
      const IW = spr.width || 88, IH = spr.height || 12;
      const keep = 1 - s2.embed / ARROW_LEN;
      ctx.drawImage(spr, 0, 0, IW*keep, IH, -ARROW_LEN/2, -ARROW_THICK/2, ARROW_LEN*keep, ARROW_THICK);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = false;
  }
  // impact burst: particle scatter with a brief white-hot flash, scaled by charge
  function drawFX(){
    for (const e of fx){
      const p = e.t/28;
      const base = (5 + 24*e.c) * (0.3 + 0.7*p);
      const x = e.x - cam.x, y = e.y - cam.y;
      ctx.globalAlpha = (1 - p) * (0.5 + 0.5*e.c);
      for (const q of e.parts){
        const dist = base * q.dm * (0.5 + p);
        const sr = Math.max(0.5, (1 - p) * q.sr * (0.5 + e.c));
        ctx.fillStyle = q.core ? '#e8f6ff' : 'rgb(' + CHG_TINT.join(',') + ')';
        ctx.beginPath(); ctx.arc(x + Math.cos(q.an)*dist, y + Math.sin(q.an)*dist, sr, 0, Math.PI*2); ctx.fill();
      }
      if (p < 0.5){
        const rc = base * 0.4 * (1 - p*2);
        ctx.fillStyle = '#e8f6ff';
        ctx.beginPath(); ctx.arc(x, y, rc, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  function roundRect(x,y,w,h,r){ ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function drawHUD(){
    const pad=3*U;
    // minimap: a 3x3 window of rooms centered on the current screen
    const bw=10*U, bh=7*U, mp=2*U, gap=U/2;
    const mw=3*bw+2*gap+mp*2, mh=3*bh+2*gap+mp*2;
    const mx=VIEW_W-mw-pad, my=pad;
    ctx.fillStyle='rgba(8,16,28,0.9)'; roundRect(mx,my,mw,mh,2*U); ctx.fill();
    ctx.strokeStyle='#187878'; roundRect(mx,my,mw,mh,2*U); ctx.stroke();
    const { col: curC, region: curR } = screenPos();
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++){
      const c=curC+dc, r=curR+dr;
      const x0=mx+mp+(dc+1)*(bw+gap), y0=my+mp+(dr+1)*(bh+gap);
      const exists = c>=0 && c<SCREENS_X && r>=0 && r<SCREENS_Y && rooms[r][c];
      if (!exists){ ctx.fillStyle='rgba(20,34,47,0.55)'; ctx.fillRect(x0,y0,bw,bh); continue; }
      const cur = dc===0 && dr===0;
      ctx.fillStyle = cur ? '#60e0d0' : '#14324a';
      ctx.fillRect(x0,y0,bw,bh);
      ctx.strokeStyle = cur ? '#d9fff8' : '#1e5a78';
      ctx.strokeRect(x0+0.5,y0+0.5,bw-1,bh-1);
    }
  }
  // F3 overlay: knight state, route markers (green launch, blue landing)
  function drawDebug(){
    if (!debugAI) return;
    ctx.font = '11px ui-monospace, monospace';
    for (const k of knights){
      const x = k.x + k.w/2 - cam.x, y = k.y - cam.y;
      const st = (k.dead ? 'DEAD' : k.aggro ? 'AGGRO' : k.resetting ? 'RESET' : 'idle') +
                 (k.goalHome ? ' home' : '') + ' cd' + k.jmpCd + ' pT' + k.pathT;
      ctx.fillStyle = '#111';
      ctx.fillText(st, x - 40, y - 10);
      const r = k.route;
      if (r && r.jump){
        ctx.strokeStyle = '#20c020';
        ctx.strokeRect(r.jump.lx*TILE - cam.x, r.jump.ly*TILE - cam.y, TILE, TILE);
        ctx.strokeStyle = '#2080ff';
        ctx.strokeRect(r.jump.tx*TILE - cam.x, r.jump.ty*TILE - cam.y, TILE, TILE);
      }
      if (r && r.drop){
        ctx.strokeStyle = '#ff8020';
        ctx.strokeRect(r.drop.tx*TILE - cam.x, Math.floor((k.y+k.h)/TILE)*TILE - cam.y, TILE, TILE);
      }
    }
  }
  function render(){
    ctx.setTransform(SCALE,0,0,SCALE,0,0);
    drawBackground(); drawTiles(); drawStuck(); drawPickups(); drawKnights(); drawKFx(); drawArrows(); drawFX(); drawPlayer(); drawChargeFx(); drawCrowns(); drawHUD(); drawDebug(); drawNotice(); drawPaused();
  }

  // ---------- responsive fit ----------
  const stageEl = document.querySelector('.stage');
  const playAreaEl = document.querySelector('.play-area');
  function fitApp(){
    if (!stageEl || !playAreaEl) return;
    const cs = getComputedStyle(stageEl);
    const availW = stageEl.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stageEl.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
    const s = Math.max(0.01, Math.min(availW/VIEW_W, availH/VIEW_H));
    const dispW = Math.max(1, Math.round(VIEW_W*s)), dispH = Math.max(1, Math.round(VIEW_H*s));
    playAreaEl.style.width = dispW+'px'; playAreaEl.style.height = dispH+'px';
    canvas.style.width = dispW+'px'; canvas.style.height = dispH+'px';
    document.documentElement.style.setProperty('--game-w', dispW+'px');
    playAreaEl.style.visibility = 'visible';
  }
  addEventListener('resize', fitApp);
  addEventListener('load', fitApp);
  fitApp();

  // ---------- sound controls ----------
  const SND = { music: { vol: 0.5, muted: false }, sfx: { vol: 0.5, muted: false } };
  for (const id of ['music','sfx']){
    const btn = document.getElementById(id+'-mute-btn');
    const sld = document.getElementById(id+'-slider');
    if (!btn || !sld) continue;
    const ch = SND[id];
    const apply = () => { btn.textContent = ch.muted ? '\u{1F507}' : '\u{1F50A}'; btn.classList.toggle('muted', ch.muted); sld.disabled = ch.muted; };
    btn.addEventListener('click', () => { ch.muted = !ch.muted; apply(); });
    sld.addEventListener('input', () => { ch.vol = sld.value / 100; });
    apply();
  }

  // ---------- loop ----------
  let loaded = 0; const need = 8;
  for (const k of ['archer','bowarm','grass','dirt','arrow','bark','leaf','knight']){
    IMG[k].onload = () => { if (++loaded===need) requestAnimationFrame(loop); };
    IMG[k].onerror = () => { console.error('asset failed to decode: '+k); if (++loaded===need) requestAnimationFrame(loop); };
  }
  function loop(){ if (!paused && !notice) update(); else chargeSndStop(); render(); requestAnimationFrame(loop); }
})();
