/* Arrowvania
   A/D move, Space jump (double after pickup), S fast-fall in the air / crouch on the ground,
   left click shoot, hold to charge (after pickup),
   Shift dash, Q drop bomb, 1 spawn menu, 2 enemy info, Esc pause. */
(() => {
  const TILE = ASSETS.TILE || 32;
  const U = TILE / 16;                 // resolution multiplier vs the original 16px design
  const VIEW_W = TILE * 15, VIEW_H = TILE * 10;
  const SCALE = Math.max(1, Math.round(1920 / VIEW_W));   // 2x internal resolution for crisp sprites
  const SIM_HZ = 144;   // fixed simulation rate
  const SEC = s => Math.round(s * SIM_HZ);   // seconds -> ticks, so every delay below reads in real seconds

  const canvas = document.getElementById('game');
  canvas.width = VIEW_W * SCALE;
  canvas.height = VIEW_H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---------- load embedded images ----------
  function img(src){ const i = new Image(); i.src = src; return i; }
  const IMG = { archer: img(ASSETS.archer), bowarm: img(ASSETS.bowarm),
                grass: img(ASSETS.grass), dirt: img(ASSETS.dirt), arrow: img(ASSETS.arrow),
                bark: img(ASSETS.bark), leaf: img(ASSETS.leaf), knight: img(ASSETS.knight),
                ngrass: img(ASSETS.night_grass), ndirt: img(ASSETS.night_dirt),
                nbark: img(ASSETS.night_bark), nleaf: img(ASSETS.night_leaf),
                ccap: img(ASSETS.castle_cap), cfill: img(ASSETS.castle_fill),
                cwall: img(ASSETS.castle_wall) };
  for (const ek of ['knight2','knight3','troll1','troll2','troll3','skel1','skel2','skel3','necro1','necro2','necro3',
                  'orc1','orc2','orc3','elf1','elf2','elf3','warrior1','warrior2','warrior3','pirate1','pirate2','pirate3',
                  'elf1_bolt','warrior3_bolt','pirate2_bolt']) IMG[ek] = img(ASSETS[ek]);
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
  // trees: bark=2, leaf core=3 (solid), soft leaves=4 (pass-through)
  const TREE_CROWNS = [];
  // wall sconces (sandbox3), world px of each torch cup center
  const TORCHES = [];
  // level layouts live in src/levels.js; they mutate this shared map in place
  const LEV = LEVELS.create({ TILE, LW, LH, SURF, map, TREE_CROWNS, TORCHES });
  const buildLevel = mi => LEV.buildLevel(mi, pickups, STATIONS);
  LEV.buildForest();
  // collision and movement live in src/logic.js so they can be tested headlessly
  const phys = LOGIC.createPhysics({ TILE, EPS: 0.01, LW, LH, map });
  const { solid, standable, moveSwept, grounded, overlaps, bboxSolid, bfsRoute } = phys;

  // ---------- player ----------
  function freshPlayer(){ return {
    x: 2*TILE, y: SURF*TILE - Math.round(1.125*TILE), w: Math.round(0.5*TILE), h: Math.round(1.125*TILE),
    vx: 0, vy: 0, onGround:false, face:1,
    anim:'IDLE', frame:0, ftime:0, attackT:0, pendingShot:false, coyote:0, jumpBuf:0,
    canDouble:false, usedDouble:false, canCharge:false, canBomb:false, charging:false, chargeT:0,
    aim:0, legs:'IDLE', lframe:0, ltime:0, hurtT:0, lastStep:-1,
    canBoost:false, boost:false, boostDir:1, boostIdle:0, runDir:0, runStartTile:0, trail:[],
    crouch:false, crouchT:0, dashT:0, dashDir:1, dashCd:0, dashFx:0
  }; }
  const P = freshPlayer();
  const P_HURT = SEC(0.1);         // player flinch
  const P_COYOTE = SEC(0.04);      // still jump briefly after leaving a ledge
  const P_JUMP_BUF = SEC(0.055);   // remember a jump pressed just before landing
  const P_DMG_CD = SEC(0.4);       // i-frames after the player takes a hit
  const WALK_SPD=1.02*U, ACCEL=0.5*U, FRIC=0.5*U;   // no sprint, walking is the base gait
  // crouch: hold S on the ground, half height, slower walk. STAND_H mirrors freshPlayer's h
  const STAND_H = Math.round(1.125*TILE), CROUCH_H = Math.round(0.5625*TILE);
  const CROUCH_SPD = 0.55*WALK_SPD;
  // dash (Shift): 5-tile burst, ground or air (altitude held). A wall or a jump ends it
  const DASH_TICKS = SEC(0.185);
  const DASH_SPD = 5*TILE / DASH_TICKS;          // covers exactly 5 tiles, same burst speed
  const DASH_CD = SEC(5);                        // cooldown between dashes
  const DASH_FADE = SEC(0.06);                   // echo trail fade-out after the dash
  const BOOST_SPD=2.6*U, BOOST_TILES=8, BOOST_IDLE=SEC(0.5);   // run 8 tiles to charge, release A/D 0.5s to stop
  // analog jump, hold Space up to 3 tiles. JUMP_V solves the discrete integration so the apex is exact
  const GRAV = 0.1375*U;
  const JUMP_H_MAX = 3*TILE;
  const JUMP_V = LOGIC.solveJumpV(GRAV, JUMP_H_MAX);
  const JUMP_CUT = 0.55;   // ascent kept per frame once Space is released
  const GRAV_FALL = 0.5625*GRAV;          // gentler gravity on the way down
  const FALL_MAX = 1.6*U;                 // low terminal velocity, keeps the archer easy to track
  const ARROW_SPD=1.6*U;                  // base bow speed, the player's velocity is added on top
  const ARROW_LEN = 0.95*TILE, ARROW_THICK = ARROW_LEN * (12/88);
  // draw is quick, the return to rest plays slower with an ease-out
  const DRAW_TICKS=11, RECOVER_TICKS=20, ATTACK_DUR=DRAW_TICKS+RECOVER_TICKS;
  const RELEASE_FRAME=5;                  // baked nocked arrow shows on frame 4, projectile takes over on 5
  // charge shot, hold past the first arrow to charge a second, damage 1 to 10
  const CHARGE_MAX = SEC(2);   // wind-up start to full power (the charge hum tracks this)
  const CHARGE_MIN = 1/3;   // releasing below a third of full charge cancels the power shot, no arrow
  const CHARGE_DELAY = SEC(0.5);   // hold left click this long before a power shot winds up
  const CHG_TINT = [63,142,252], CHG_CORE = [232,246,255], CHG_TINT_MAX = 0.9;
  const CHG_GLOW = 'rgba(80,160,255,', CHG_GLOW_MAX = 8;
  // bombs (Q to drop): up to 3 live at once, 3s fuse, cyan blast over 1s
  const BOMB_SIZE = Math.round(TILE/3);
  const BOMB_FUSE = SEC(3), BOMB_BOOM = SEC(1);
  const BOMB_RADIUS = 0.5*TILE, BOMB_DMG = 10, BOMB_MAX = 3;
  const bombs = [];

  // sound effects, synth, music, and the volume controls live in src/audio.js
  const AUD = AUDIOLIB.create({ ASSETS, canPlayMusic: () => menu });
  const { sfxReady, initAudio, playSfx,
          chargeSndStart, chargeSndUpdate, chargeSndStop,
          playBoom, playBombSound,
          boostSndStart, boostSndUpdate, boostSndStop,
          startMenuMusic, stopMenuMusic } = AUD;
  // ---------- input ----------
  const keys = {};
  addEventListener('keydown', e => {
    initAudio();
    keys[e.code] = true;
    if (menu){
      startMenuMusic();
      if (codeEntry){
        if (e.code === 'Escape'){ codeEntry = null; }
        else if (e.code === 'Backspace'){ codeEntry.text = codeEntry.text.slice(0, -1); codeEntry.err = false; }
        else if (e.code === 'Enter' || e.code === 'NumpadEnter'){ submitCode(); }
        else if (e.key && e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && codeEntry.text.length < 8 &&
                 !e.ctrlKey && !e.metaKey){   // let Ctrl+V reach the paste handler untyped
          codeEntry.text += e.key.toUpperCase(); codeEntry.err = false;
        }
      }
      return;
    }
    if (e.code === 'Escape' && !notice && !gameOver && !e.repeat){
      if (spawnMenu) spawnMenu = false;
      else { paused = !paused; if (!paused){ P.jumpBuf = 0; cancelStaleCharge(); } }
    }
    if (e.code === 'Digit2' && !e.repeat && !paused && !notice && !gameOver && !spawnMenu) EN.toggleDebug();   // enemy info overlay
    if (e.code === 'Digit1' && !e.repeat && !paused && !notice && !gameOver){ spawnMenu = !spawnMenu; if (spawnMenu) P.jumpBuf = 0; }
    if (e.code === 'KeyQ' && !e.repeat && !paused && !notice && !gameOver && !spawnMenu) tryDropBomb();
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat && !paused && !notice && !gameOver && !spawnMenu) tryDash();
    if (e.code === 'KeyS' && P.boost) P.boost = false;   // press S to stop the speed booster immediately
    if (e.code === 'Space'){ if (!e.repeat && !paused && !notice && !gameOver && !spawnMenu) P.jumpBuf = P_JUMP_BUF; e.preventDefault(); }
  });
  addEventListener('keyup',   e => { keys[e.code] = false; });
  // paste a save code into the Enter Code panel (Ctrl+V). Replaces what's typed;
  // dashes, spacing, and case are forgiven the same way typed codes are
  addEventListener('paste', e => {
    if (!menu || !codeEntry) return;
    const txt = (e.clipboardData || window.clipboardData).getData('text') || '';
    const norm = txt.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (norm){ codeEntry.text = norm; codeEntry.err = false; }
    e.preventDefault();
  });
  // clear input on focus loss, and cancel a held charge instead of firing it blind
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    P.boost = false; boostSndStop();
    if (P.charging){ P.charging = false; P.attackT = RECOVER_TICKS; chargeSndStop(); }
  });
  const mouse = { sx: VIEW_W/2, sy: VIEW_H/2, down:false, downT:0 };
  function toWorldMouse(e){
    const r = canvas.getBoundingClientRect();
    mouse.sx = (e.clientX - r.left) / r.width * VIEW_W;
    mouse.sy = (e.clientY - r.top) / r.height * VIEW_H;
  }
  function faceToMouse(){ P.face = (cam.x + mouse.sx) < (P.x + P.w/2) ? -1 : 1; }
  let audioPrimed = false;
  canvas.addEventListener('mousemove', e => { if (!audioPrimed){ audioPrimed = true; initAudio(); } toWorldMouse(e); });
  canvas.addEventListener('mousedown', e => {
    initAudio();
    if (e.button !== 0) return;
    toWorldMouse(e);
    if (menu){
      startMenuMusic();
      if (codeEntry){
        if (inRect(mouse, codeBackBtn)){ playSfx('select', 1.5); codeEntry = null; }
        else if (inRect(mouse, codeStartBtn)){ submitCode(); }
        return;   // otherwise the code panel is keyboard driven
      }
      if (mapBtns) for (let i = 0; i < MAPS.length; i++){
        if (!MAPS[i].locked && inRect(mouse, mapBtns[i])){ selectedMap = i; playSfx('select', 1.5); return; }
      }
      if (inRect(mouse, godBtn)){ godMode = !godMode; playSfx('select', 1.5); return; }
      if (inRect(mouse, contBtn) && saveData){ selectedMap = saveData.map; playSfx('select', 1.5); startRun(saveData); return; }
      if (inRect(mouse, newBtn) && selectedMap >= 0 && !MAPS[selectedMap].locked){ playSfx('select', 1.5); startRun(null); return; }
      if (inRect(mouse, codeBtn)){ playSfx('select', 1.5); codeEntry = { text: '', err: false }; return; }
      return;
    }
    if (notice){
      if (noticeCodeBtn && inRect(mouse, noticeCodeBtn)){ copySaveCode(notice.code); return; }
      if (inRect(mouse, noticeBtn)) dismissNotice();
      return;
    }
    if (gameOver){
      if (inRect(mouse, gameOverLoadBtn) && saveData){
        playSfx('select', 1.5);
        resetGame();                    // clean slate, then straight back into the run
        selectedMap = saveData.map;
        startRun(saveData);
      }
      else if (inRect(mouse, gameOverBtn)){ playSfx('select', 1.5); resetGame(); }
      return;
    }
    if (spawnMenu){
      if (spawnBtns) for (const b of spawnBtns){
        if (inRect(mouse, b)){
          playSfx('select', 1.5);
          if (spawnEnemyAt(b.type)) spawnMenu = false;
          return;
        }
      }
      if (spawnPanel && inRect(mouse, spawnPanel)) return;   // panel body: stay open
      spawnMenu = false;   // a click outside the panel closes it
      return;
    }
    if (paused){
      if (inRect(mouse, resumeBtn)){ playSfx('select', 1.5); paused = false; P.jumpBuf = 0; cancelStaleCharge(); }
      else if (inRect(mouse, quitBtn)){ playSfx('select', 1.5); resetGame(); }
      return;
    }
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
  const STICK_LIFE = SEC(5), STICK_FADE = SEC(0.4), STICK_MAX = 8;   // lifetime, fade, and max solid arrows
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
    // keep at most STICK_MAX solid arrows, retire the oldest into the fade
    const fadeStart = STICK_LIFE - STICK_FADE;
    let solidN = 0;
    for (const s of stuck) if (s.t < fadeStart) solidN++;
    for (let i = 0; solidN > STICK_MAX && i < stuck.length; i++)
      if (stuck[i].t < fadeStart){ stuck[i].t = fadeStart; solidN--; }
  }
  function tryDropBomb(){
    if (!P.canBomb || P.boost) return;   // no bombs while boosting
    let live = 0; for (const b of bombs) if (!b.exploding) live++;
    if (live >= BOMB_MAX) return;
    bombs.push({ x: P.x + P.w/2 - BOMB_SIZE/2, y: P.y + P.h - BOMB_SIZE, w: BOMB_SIZE, h: BOMB_SIZE,
                 vy: 0, fuseT: BOMB_FUSE, exploding: false, boomT: 0 });
  }
  function tryDash(){
    if (P.dashT > 0 || P.dashCd > 0 || P.boost || P.crouch) return;
    let dir = 0;
    if (keys['KeyA'] || keys['ArrowLeft'])  dir -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) dir += 1;
    P.dashDir = dir || P.face;
    P.dashT = DASH_TICKS; P.dashCd = DASH_CD; P.dashFx = DASH_TICKS + DASH_FADE;
    playSfx('jump', 0.12, 0.55);   // placeholder whoosh, a low-pitched jump
  }
  function tryShoot(){
    if (P.boost) return;   // no shooting while boosting
    // recovery is interruptible, so rapid clicks keep the full fire rate
    if (P.attackT > 0 && (P.pendingShot || P.frame < RELEASE_FRAME)) return;
    P.attackT = ATTACK_DUR; P.pendingShot = true;
  }
  // ---------- crouch pose (D "kneel lean") ----------
  // LEGS layer squashed about the feet line + torso region leant over a hip pivot.
  // Sheet px, tuned against the approved v4 strip
  const CR_REG_TOP = 105, CR_REG_H = 125;        // torso region inside a frame
  const CR_PIV = [82, 119];                      // hip pivot in region coords
  const CR_TORSO_SCL = 0.70;                     // torso height scale after the lean
  const CR_LEGS_W = 1.20, CR_LEGS_H = 42;        // boots widen, content height in the LEGS rows
  const CR_BASE_FWD = 5;                         // boots ride slightly forward under the lean
  // attack reaction per frame [lean deg, torso dx, boots dx, boots squash]:
  // 0-4 brace into the draw, 5 snaps back on release, 6-9 ease home
  const CR_PARAMS = [[-8,0,0,.45],[-9,1,1,.45],[-10,2,2,.45],[-11,3,2,.45],[-11.5,3,3,.45],
                     [-6,-3,0,.41],[-7,-2,1,.43],[-7.5,-1,0,.44],[-8,0,0,.45],[-8,0,0,.45]];
  const CR_IDLE_POSE = [-8,0,0,.45];
  function crouchPose(){ return (P.anim === 'ATTACK' && CR_PARAMS[P.frame]) || CR_IDLE_POSE; }
  function crouchPivot(pose){
    return [CR_PIV[0] + 6 + pose[1] - AX, 6 - Math.round(CR_LEGS_H*pose[3])];
  }
  // where the bow shoulder lands once the torso region is leant and squashed
  function crouchShoulder(pose){
    const sh = SHOULDER[P.frame] || SHOULDER[0];
    const th = -pose[0]*Math.PI/180;
    const dx = AX + sh[0] - CR_PIV[0], dy = AY + sh[1] - CR_REG_TOP - CR_PIV[1];
    const pv = crouchPivot(pose);
    return [pv[0] + dx*Math.cos(th) - dy*Math.sin(th),
            pv[1] + CR_TORSO_SCL*(dx*Math.sin(th) + dy*Math.cos(th))];
  }
  function standFromCrouch(){
    if (!P.crouch) return true;
    if (bboxSolid(P.x, P.y - (STAND_H - CROUCH_H), P.w, STAND_H)) return false;
    P.crouch = false; P.y -= STAND_H - CROUCH_H; P.h = STAND_H;
    return true;
  }
  function shoulderWorld(){
    if (P.crouch){
      const cs = crouchShoulder(crouchPose());
      return { x: P.x + P.w/2 + P.face*cs[0]/SS, y: P.y + P.h + cs[1]/SS };
    }
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
  const chargeFx = [];
  function decayStreaks(list){
    for (let i = list.length - 1; i >= 0; i--){
      const q = list[i];
      q.r -= q.vr;
      if (q.r < 5 || (q.k && q.k.dead)) list.splice(i, 1);
    }
  }
  function updateChargeFx(){
    if (P.charging && mouse.downT >= CHARGE_DELAY){
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
    const boost = LOGIC.aimBoost(P.vx, P.vy, c, sn, P.face);
    const spd = ARROW_SPD + boost;
    arrows.push({ x:ax0, y:ay0, vx:c*P.face*spd, vy:sn*spd, ang:Math.atan2(sn, c*P.face),
                  life:150, charge:cg, dmg:LOGIC.arrowDamage(cg) });
    playSfx('fire', 0.8 + 0.4*cg, 1 - 0.12*cg);
  }

  // ---------- player health: death at 0 shows game over (god mode refills) ----------
  const hpEl = document.getElementById('health-value');
  let hp = 99;
  function damage(n){
    hp -= n;
    if (hp <= 0){
      if (godMode) hp = 99;   // god mode: straight back to full instead of dying
      else {
        hp = 0;
        if (hpEl) hpEl.textContent = hp;
        gameOver = true;
        chargeSndStop(); boostSndStop();
        return;
      }
    }
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
      title: 'Power Shot', verb: 'Hold', key: 'M-L', tail: 'to charge, release to fire' },
    { x: 25*TILE, y: 10*TILE, w: TILE, h: TILE, taken: false, kind: 'bomb',
      fill: '#1f7aa6', edge: '#a6ecff', glow: 'rgba(120,230,255,0.9)',
      title: 'Bombs', verb: 'Press', key: 'Q', tail: 'to drop, up to 3' },
    { x: 25*TILE, y: 28*TILE, w: TILE, h: TILE, taken: false, kind: 'boost',
      fill: '#c04b7a', edge: '#ffe27a', glow: 'rgba(255,120,200,0.9)',
      title: 'Speed Booster', verb: 'Run', key: '8 tiles', tail: 'straight to charge' },
  ];
  // ---------- save stations: touch one to save + heal, the code restores anywhere ----------
  const STATIONS = [
    { tx: 18, fr: 29, armed: true },   // underground room
    { tx: 17, fr: 11, armed: true },   // sky room
  ];
  const ABILITY_BITS = { double: 1, charge: 2, bomb: 4, boost: 8 };
  function abilitiesMask(){
    return (P.canDouble ? 1 : 0) | (P.canCharge ? 2 : 0) | (P.canBomb ? 4 : 0) | (P.canBoost ? 8 : 0);
  }
  function applyAbilities(mask){
    P.canDouble = !!(mask & 1); P.canCharge = !!(mask & 2);
    P.canBomb = !!(mask & 4); P.canBoost = !!(mask & 8);
    for (const pk of pickups) pk.taken = !!(mask & ABILITY_BITS[pk.kind]);
  }
  // the save lives in localStorage, and the code alone can rebuild it (logic.js)
  function loadSave(){
    try {
      const d = JSON.parse(localStorage.getItem('arrowvania.save') || 'null');
      if (d && d.version === 1 && MAPS[d.map] && STATIONS[d.station] && typeof d.abilities === 'number') return d;
    } catch (_) {}
    return null;
  }
  function writeSave(d){
    saveData = d;
    try { localStorage.setItem('arrowvania.save', JSON.stringify(d)); } catch (_) {}
  }
  function doSave(i){
    writeSave({ version: 1, map: selectedMap, station: i, abilities: abilitiesMask() });
    hp = 99; if (hpEl) hpEl.textContent = hp;   // stations heal to full
    playSfx('select', 1.2, 0.85);
    notice = { title: 'Game Saved', code: LOGIC.encodeSave(saveData) };
  }
  // pickup notification modal, pauses the game until Continue is clicked
  let notice = null, noticeBtn = null, noticeCodeBtn = null, paused = false;
  // clicking the save code copies it; a short toast confirms. Falls back to a
  // hidden textarea for contexts without the async clipboard API.
  function copySaveCode(code){
    playSfx('select', 1.5);
    const done = () => showToast('Code copied');
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(code).then(done, () => fallbackCopy(code, done));
    else fallbackCopy(code, done);
  }
  function fallbackCopy(code, done){
    const ta = document.createElement('textarea');
    ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    if (ok) done(); else showToast('Copy failed');
  }
  let spawnMenu = false, spawnBtns = null, spawnPanel = null;
  let menu = true, quitBtn = null, resumeBtn = null;
  // map selection. sandbox2 shares sandbox1's layout for now, its own look via THEMES
  const MAPS = [{ name: 'sandbox1', locked: false }, { name: 'sandbox2', locked: false },
                { name: 'sandbox3', locked: false }];
  let selectedMap = -1, mapBtns = null;   // no map picked until the player chooses one
  let godMode = false, godBtn = null;         // menu checkbox: all abilities, health refills
  let gameOver = false, gameOverBtn = null, gameOverLoadBtn = null;   // 0 hp shows the game-over screen
  let contBtn = null, newBtn = null, codeBtn = null, codeBackBtn = null, codeStartBtn = null;
  let codeEntry = null;                       // { text, err } while the Enter Code panel is open
  // Enter or the Start button both try to load the typed code
  function submitCode(){
    const d = LOGIC.decodeSave(codeEntry.text);
    if (d && d.version === 1 && MAPS[d.map] && !MAPS[d.map].locked && STATIONS[d.station]){
      writeSave(d); selectedMap = d.map;
      playSfx('select', 1.5);
      startRun(d);
    } else codeEntry.err = true;
  }
  let saveData = loadSave();                  // last save, kept in sync by writeSave
  const inRect = (m, b) => !!b && m.sx >= b.x && m.sx <= b.x + b.w && m.sy >= b.y && m.sy <= b.y + b.h;
  function notify(pk){ notice = { title: 'You gained ' + pk.title, verb: pk.verb, key: pk.key, tail: pk.tail }; }
  function dismissNotice(){
    notice = null; noticeBtn = null;
    P.jumpBuf = 0; mouse.down = false;
    if (P.charging){ P.charging = false; P.attackT = RECOVER_TICKS; chargeSndStop(); }
  }
  // a charge whose button was released while paused would fire blind on resume, cancel it instead
  function cancelStaleCharge(){
    if (P.charging && !mouse.down){ P.charging = false; P.attackT = RECOVER_TICKS; }
  }

  // ---------- camera ----------
  const LEVEL_PX_W = LW*TILE, LEVEL_PX_H = LH*TILE;
  const CAM_SKY_Y  = 2*TILE;
  const CAM_SURF_Y = (SURF+2)*TILE - VIEW_H;
  const CAM_ROOM_Y = LH*TILE - VIEW_H;
  const cam = { x:0, y:CAM_SURF_Y };
  const CAM_TRANS = SEC(0.3);   // camera pan between regions
  let camRegion = 1, camTrans = 0, camFromX = 0, camFromY = CAM_SURF_Y;
  const SCREENS_X = Math.max(1, Math.floor((LEVEL_PX_W - VIEW_W)/VIEW_W) + 1);
  const SCREENS_Y = 3;
  const SCREEN_BANDS = [[0, SKY_ROWS], [SKY_ROWS, SURF+2], [SURF+2, LH]];
  // a room exists where a screen band has both open space and structure
  const SCREEN_TILES_X = VIEW_W / TILE;
  const rooms = [];
  function computeRooms(){
    rooms.length = 0;
    for (let r = 0; r < SCREENS_Y; r++){
      rooms.push([]);
      for (let c = 0; c < SCREENS_X; c++){
        let open = false, sol = false;
        for (let ty = SCREEN_BANDS[r][0]; ty < SCREEN_BANDS[r][1]; ty++)
          for (let tx = c*SCREEN_TILES_X; tx < (c+1)*SCREEN_TILES_X; tx++){
            const mv = map[ty][tx];
            if (mv === 0 || mv === 5) open = true;   // 5 is the invisible tree wall, not real structure
            else sol = true;
          }
        rooms[r].push(open && sol);
      }
    }
  }
  computeRooms();
  // band of a world y (0 sky, 1 surface, 2 underground)
  function bandOf(y){ return y >= (SURF+2)*TILE ? 2 : y < (SKY_ROWS-1)*TILE ? 0 : 1; }
  // effective band: the sky or underground band only counts if that screen
  // column really has a room there (the same rule the camera uses). A jump arc
  // clipping the sky band over open courtyard is still "surface", so enemies
  // don't deaggro just because the player jumped high
  function effBand(x, y){
    let b = bandOf(y);
    const col = Math.min(SCREENS_X-1, Math.max(0, Math.floor(x/VIEW_W)));
    if (b !== 1 && !rooms[b][col]) b = 1;
    return b;
  }
  // the screen the player counts as being on, camera and minimap agree through this
  function screenPos(){
    const col = Math.min(SCREENS_X-1, Math.max(0, Math.floor((P.x + P.w/2)/VIEW_W)));
    let region = bandOf(P.y + P.h/2);
    if (region !== 1 && !rooms[region][col]) region = 1;
    return { col, region };
  }

  function updateBombs(){
    for (let i = bombs.length - 1; i >= 0; i--){
      const b = bombs[i];
      if (!b.exploding){
        b.vy += b.vy < 0 ? GRAV : GRAV_FALL;
        if (b.vy > FALL_MAX) b.vy = FALL_MAX;
        moveSwept(b, 0, b.vy);
        if (grounded(b) && b.vy > 0) b.vy = 0;
        if (--b.fuseT <= 0){
          b.exploding = true; b.boomT = 0;
          const bx = b.x + b.w/2, by = b.y + b.h/2;
          if (bx >= cam.x - TILE && bx <= cam.x + VIEW_W + TILE && by >= cam.y - TILE && by <= cam.y + VIEW_H + TILE)
            playBombSound();   // same rule as arrows: only heard on-screen plus a tile
          for (const k of knights){
            if (k.dead) continue;
            if (Math.abs((k.x + k.w/2) - bx) < BOMB_RADIUS + k.w/2 &&
                Math.abs((k.y + k.h/2) - by) < BOMB_RADIUS + k.h/2){
              hurtEnemy(k, BOMB_DMG);
            }
          }
        }
      } else if (++b.boomT >= BOMB_BOOM){
        bombs.splice(i, 1);
      }
    }
  }
  // the enemy roster, AI, projectiles, and enemy drawing live in src/enemies.js
  const EN = ENLIB.create({ TILE, U, SEC, GRAV, GRAV_FALL, FALL_MAX, P_DMG_CD, VIEW_W, LW, LH, SS, ASSETS, IMG, ctx, cam, P, map,
                            solid, standable, grounded, overlaps, moveSwept, bboxSolid, bfsRoute,
                            effBand, bandOf, damage, drawStreaks, decayStreaks });
  const { knights, ETYPES, SPAWN_LIST, hurtEnemy,
          spawnEnemyAt, updateKnights, updateBolts,
          drawKnights, drawKFx, drawBolts, drawDebug, drawSummonRise } = EN;
  function update(){
    let ix = 0;
    if (keys['KeyA'] || keys['ArrowLeft'])  ix -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
    if (keys['KeyS'] && P.onGround && !P.boost && P.dashT <= 0){
      if (!P.crouch){ P.crouch = true; P.y += STAND_H - CROUCH_H; P.h = CROUCH_H; }
    } else if (P.crouch) standFromCrouch();
    P.crouchT = Math.max(0, Math.min(1, P.crouchT + (P.crouch ? 1 : -1)/SEC(0.05)));
    if (P.boost){
      if (ix !== 0){ P.boostDir = ix; P.boostIdle = 0; }        // steerable, but always full speed
      else if (++P.boostIdle >= BOOST_IDLE) P.boost = false;    // let go of A/D for 0.5s -> stop
      if (P.boost){ P.vx = P.boostDir * BOOST_SPD; if (P.attackT <= 0) P.face = P.boostDir; }
    } else if (ix !== 0){
      const spdCap = P.crouch ? CROUCH_SPD : WALK_SPD;
      P.vx += ix * ACCEL;
      P.vx = Math.max(-spdCap, Math.min(spdCap, P.vx));
      if (P.attackT <= 0) P.face = ix;
    } else {
      if (Math.abs(P.vx) < FRIC) P.vx = 0; else P.vx -= Math.sign(P.vx)*FRIC;
    }

    // dash overrides steering
    if (P.dashT > 0){
      P.dashT--;
      P.vx = P.dashDir * DASH_SPD;
      if (P.attackT <= 0) P.face = P.dashDir;
    }
    if (P.dashCd > 0) P.dashCd--;
    if (P.dashFx > 0) P.dashFx--;
    const fastFall = keys['KeyS'] && !P.onGround;   // hold S in the air to drop faster
    if (P.dashT > 0){
      P.vy = 0;   // the dash holds altitude, gravity waits
    } else if (P.vy < 0){
      P.vy += GRAV * (fastFall ? 1.5 : 1);
      if (!keys['Space']) P.vy *= JUMP_CUT;   // analog jump height
    } else {
      P.vy += GRAV_FALL * (fastFall ? 1.6 : 1);   // gentle downward acceleration, steeper with S
      const cap = FALL_MAX * (fastFall ? 1.5 : 1);
      if (P.vy > cap) P.vy = cap;             // capped low so it never runs away, higher with S
    }
    moveSwept(P, P.vx, 0);
    if (P.dashT > 0 && P.vx === 0) P.dashT = 0;   // a wall ends the dash
    const vyPre = P.vy;                 // upward speed before the move, to detect a ceiling hit
    moveSwept(P, 0, P.vy);
    P.onGround = grounded(P);
    if (P.onGround){
      if (P.vy > 0) P.vy = 0;
      P.coyote = P_COYOTE;
      EN.notePlayerNode();
    } else if (P.coyote>0) P.coyote--;
    // speed booster keeps going through jumps and ledges. It only ends on a wall or
    // ceiling (below), on the 0.5s A/D release, or on S.
    // charge it by running BOOST_TILES straight tiles, grounded, no jump/fall/damage
    if (P.canBoost && !P.boost){
      const btx = Math.floor((P.x + P.w/2)/TILE);
      if (P.onGround && ix !== 0 && P.vx !== 0 && P.hurtT <= 0 && !P.charging && !P.crouch){
        if (ix !== P.runDir){ P.runDir = ix; P.runStartTile = btx; }
        if ((btx - P.runStartTile) * ix >= BOOST_TILES){
          P.boost = true; P.boostDir = ix; P.boostIdle = 0;
          P.attackT = 0; P.pendingShot = false; P.charging = false; chargeSndStop();   // abilities off during boost
        }
      } else { P.runDir = 0; P.runStartTile = btx; }
    }
    if (P.jumpBuf>0) P.jumpBuf--;
    if (P.jumpBuf>0 && P.coyote>0 && standFromCrouch()){ P.dashT = 0; P.vy = -JUMP_V; P.onGround=false; P.coyote=0; P.jumpBuf=0; playSfx('jump', 0.1); }
    // double jump: a second Space press in the air, once per airtime, after the pickup
    else if (P.jumpBuf>0 && P.canDouble && !P.usedDouble && !P.onGround && standFromCrouch()){ P.dashT = 0; P.vy = -JUMP_V; P.usedDouble = true; P.jumpBuf = 0; playSfx('jump', 0.1); }
    if (P.onGround) P.usedDouble = false;

    if (P.x < 0){ P.x=0; P.vx=0; }
    if (P.x > LEVEL_PX_W-P.w){ P.x=LEVEL_PX_W-P.w; P.vx=0; }
    if (P.y > LEVEL_PX_H + 40*U){ P.x=2*TILE; P.y=SURF*TILE - P.h; P.vx=P.vy=0; }
    if (P.boost && (P.vx === 0 || (vyPre < 0 && P.vy === 0))) P.boost = false;   // wall, level edge, or ceiling ends the boost
    if (P.boost){ boostSndStart(); boostSndUpdate(); } else boostSndStop();

    updateKnights();
    updateBolts();
    updateBombs();

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

    for (const pk of pickups){
      if (pk.taken) continue;
      if (P.x < pk.x + pk.w && P.x + P.w > pk.x &&
          P.y < pk.y + pk.h && P.y + P.h > pk.y){
        pk.taken = true;
        if (pk.kind === 'double') P.canDouble = true;
        if (pk.kind === 'charge') P.canCharge = true;
        if (pk.kind === 'bomb') P.canBomb = true;
        if (pk.kind === 'boost') P.canBoost = true;
        notify(pk);
      }
    }

    // save stations: usable once per visit. A station re-arms only once it has
    // scrolled completely off screen, so it can't relight during a screen transition
    for (let i = 0; i < STATIONS.length; i++){
      const st = STATIONS[i];
      const r = { x: st.tx*TILE, y: (st.fr-1)*TILE, w: TILE, h: TILE };
      const sx = st.tx*TILE - cam.x, sy = st.fr*TILE - cam.y;   // station footprint in screen space
      const offScreen = sx + TILE <= 0 || sx >= VIEW_W || sy <= 0 || sy - TILE >= VIEW_H;
      if (offScreen) st.armed = true;
      if (overlaps(P, r) && st.armed && P.onGround){ st.armed = false; doSave(i); }
    }

    // how long left click has been held, so a power shot winds up only on a deliberate hold
    mouse.downT = mouse.down ? mouse.downT + 1 : 0;

    // frozen while charging so the drawn pose holds
    if (P.attackT > 0 && !P.charging) P.attackT--;

    if (!P.charging && P.canCharge && mouse.down && P.attackT > 0 && !P.pendingShot && P.frame >= RELEASE_FRAME){
      P.charging = true; P.chargeT = 0;
    }
    if (P.charging){
      // hold the drawn bow silently for the first half second, then the power shot winds up
      if (mouse.downT >= CHARGE_DELAY){
        P.chargeT = Math.min(P.chargeT + 1, CHARGE_MAX);
        chargeSndStart(); chargeSndUpdate(P.chargeT / CHARGE_MAX);
      }
      if (!mouse.down){
        chargeSndStop();
        const cg = P.chargeT / CHARGE_MAX;
        if (cg >= CHARGE_MIN) spawnArrow(cg);   // too little charge, the release fires nothing
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
    if (!P.boost && gaitOn && gaitFrame !== P.lastStep && (gaitFrame === 0 || gaitFrame === 5))
      playSfx('step', 0.025, 0.95 + Math.random()*0.1);
    P.lastStep = gaitOn ? gaitFrame : -1;

    // speed-booster stream: remember recent poses for the rainbow trail
    if (P.boost){
      P.trail.push({ x: P.x, y: P.y, face: P.face, anim: P.anim === 'ATTACK' ? 'RUN' : P.anim, frame: P.frame });
      if (P.trail.length > 10) P.trail.shift();
    } else if (P.trail.length) P.trail.shift();

    // arrows fly straight, swept in half-tile substeps so fast shots can't tunnel
    for (const a of arrows){
      const dist = Math.hypot(a.vx, a.vy);
      const steps = Math.max(1, Math.ceil(dist / (TILE/2)));
      const sx = a.vx/steps, sy = a.vy/steps;
      for (let s = 0; s < steps && a.life > 0; s++){
        a.x += sx; a.y += sy;
        for (const k of knights){
          if (k.dead) continue;
          if (a.x > k.x && a.x < k.x + k.w && a.y > k.y && a.y < k.y + k.h){
            hurtEnemy(k, a.dmg);
            if (a.charge > 0.03) makeBurst(a.x, a.y, a.charge);
            a.life = 0;
            break;
          }
        }
        const hv = map[Math.floor(a.y/TILE)] ? map[Math.floor(a.y/TILE)][Math.floor(a.x/TILE)] : 1;
        if (a.life > 0 && hv !== 5 && solid(Math.floor(a.x/TILE), Math.floor(a.y/TILE))){
          if (a.x >= cam.x - TILE && a.x <= cam.x + VIEW_W + TILE && a.y >= cam.y - TILE && a.y <= cam.y + VIEW_H + TILE){
            if (a.charge > 0.03) playBoom();   // power shot lands with a deep boom instead of the plain thud
            else playSfx(hv === 2 || hv === 3 ? 'wood' : 'dirt', hv === 2 || hv === 3 ? 0.45 : 0.9);
          }
          if (a.charge > 0.03) makeBurst(a.x, a.y, a.charge);
          // a full power shot spends itself in the burst, anything less sticks
          if (a.charge < 0.98) stickArrow(a);
          a.life = 0;
        }
      }
      if (a.life > 0) a.life--;   // lifetime ticks once per frame, not per sub-step
    }
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
  // backdrops are painted in src/bg.js, once per region raise
  const ROOM_RAISE = [0, TILE, 2*TILE];   // per region 0/1/2: bg ground meets a floor 1/2/3 tiles up
  const BGS = BGLIB.create({ VIEW_W, VIEW_H });
  const BG_R = ROOM_RAISE.map(BGS.makeBG);
  const BG_NIGHT_R = ROOM_RAISE.map(BGS.makeNightBG);
  const BG_CASTLE_R = ROOM_RAISE.map(BGS.makeCastleBG);
  const { CASTLE_FX, CASTLE_POLE } = BGS;   // anchors for the live pennant + sconce flames
  // per-map theme: tiles, tree colors (the crown bakes lazily per theme), backdrop, weather
  const THEMES = [
    { grass: IMG.grass,  dirt: IMG.dirt,  bark: IMG.bark,  leaf: IMG.leaf,  bgR: BG_R,        rain: false, crown: null },
    { grass: IMG.ngrass, dirt: IMG.ndirt, bark: IMG.nbark, leaf: IMG.nleaf, bgR: BG_NIGHT_R,  rain: true,  crown: null },
    { grass: IMG.ccap,   dirt: IMG.cfill, bark: IMG.cwall, leaf: IMG.leaf,  bgR: BG_CASTLE_R, rain: false, crown: null,
      wall: IMG.cwall, castle: true },
  ];
  let theme = THEMES[0];
  // storm rain, advanced on real time like the star field so speed ignores refresh rate
  const rain = [];
  for (let i = 0; i < 90; i++)
    rain.push({ x: Math.random()*VIEW_W, y: Math.random()*VIEW_H, s: 380 + Math.random()*260 });
  let rainLastT = 0;
  function drawRain(){
    const t = performance.now();
    const dt = rainLastT ? Math.min(80, t - rainLastT) : 7;
    rainLastT = t;
    ctx.strokeStyle = 'rgba(150,165,185,0.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of rain){
      r.y += r.s*dt/1000; r.x -= r.s*0.16*dt/1000;
      if (r.y > VIEW_H + 6){ r.y -= VIEW_H + 26; r.x = Math.random()*VIEW_W; }
      if (r.x < -6) r.x += VIEW_W + 12;
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - 3, r.y + 13);
    }
    ctx.stroke();
  }
  function drawBackground(){
    const bg = theme.bgR[Math.max(0, Math.min(theme.bgR.length - 1, camRegion))];   // ground raised to meet this room's floor
    const off = ((cam.x % VIEW_W) + VIEW_W) % VIEW_W;
    ctx.drawImage(bg, -off, 0);
    if (off) ctx.drawImage(bg, VIEW_W - off, 0);
    if (theme.castle) drawCastleFx(off);             // pennant + sconce flames over the bake
    if (theme.rain && camRegion !== 2) drawRain();   // no rain down in the underground band
  }
  // shared flame flicker (backdrop sconces and level torches): four poses
  // advanced on real time, so the flicker speed ignores the refresh rate
  function drawFlame(x, y, ph, s){
    const f = (Math.floor(performance.now()/140) + ph) % 4;
    const lean = [-2, 0.5, 2, 0][f]*s, h = [20, 26, 23, 17][f]*s;
    const gg = ctx.createRadialGradient(x, y - 9*s, 2, x, y - 9*s, 26*s);
    gg.addColorStop(0, 'rgba(255,180,70,0.30)'); gg.addColorStop(1, 'rgba(255,180,70,0)');
    ctx.fillStyle = gg; ctx.fillRect(x - 26*s, y - 35*s, 52*s, 52*s);
    ctx.fillStyle = '#e05820';
    ctx.beginPath(); ctx.moveTo(x - 6*s, y); ctx.lineTo(x + 6*s, y); ctx.lineTo(x + lean, y - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe482';
    ctx.beginPath(); ctx.moveTo(x - 3.5*s, y); ctx.lineTo(x + 3.5*s, y); ctx.lineTo(x + lean*0.6, y - h*0.62); ctx.closePath(); ctx.fill();
  }
  // pennant + sconce flames animate over the baked castle backdrop, tracking
  // both the parallax offset and the per-region raise
  function drawCastleFx(off){
    const R = ROOM_RAISE[Math.max(0, Math.min(ROOM_RAISE.length - 1, camRegion))];
    for (const bx of [-off, VIEW_W - off]){
      for (const fx2 of CASTLE_FX) drawFlame(bx + fx2.x, fx2.y + 6 - R, (fx2.x/100)|0, 1);
      // waving pennant, hoist pinned at the pole top, tip flutter grows outward
      const px2 = bx + CASTLE_POLE.x + 6, py2 = CASTLE_POLE.top - R;
      const phase = (performance.now() % 900) / 900;
      const L = 54, HOIST = 13, N = 14, bot = [];
      ctx.beginPath();
      for (let i = 0; i < N; i++){
        const t2 = i/(N-1);
        const wob = 6.5*t2*Math.sin(Math.PI*2*(1.35*t2 - phase));
        const cy2 = py2 + HOIST + wob, hh = HOIST*(1 - t2), tx2 = px2 + t2*L;
        if (i === 0) ctx.moveTo(tx2, Math.max(py2, cy2 - hh));
        else ctx.lineTo(tx2, Math.max(py2, cy2 - hh));
        bot.push([tx2, cy2 + hh]);
      }
      for (let i = N - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.closePath();
      ctx.fillStyle = '#aa2832';
      ctx.fill();
    }
  }
  // wall sconces placed by the castle layout, drawn in world space
  function drawTorches(){
    for (const tc of TORCHES){
      const x = tc.x - cam.x, y = tc.y - cam.y;
      if (x < -TILE || x > VIEW_W + TILE || y < -TILE*1.5 || y > VIEW_H + TILE) continue;
      ctx.fillStyle = '#7a5632'; ctx.fillRect(x - 3, y + 2, 6, 17);   // wood shaft
      ctx.fillStyle = '#5e4226'; ctx.fillRect(x, y + 2, 3, 17);
      ctx.fillStyle = '#56565e'; ctx.fillRect(x - 6, y - 5, 12, 3);   // iron collar
      ctx.fillStyle = '#3a3a42'; ctx.fillRect(x - 8, y - 3, 16, 6);   // cup
      drawFlame(x, y - 4, (tc.x/64)|0, 1);
    }
  }
  // cloud crown, drawn in front of the player and arrows, pinned into the trunk top.
  // Baked once per theme (theme.crown) from that theme's leaf tile.
  const CROWN_LOBES = [[160,64,58],[95,112,56],[225,112,56],[50,186,50],[160,172,72],[270,186,50],
                       [105,205,55],[215,205,55]];
  const CROWN_SCALE = 1.35;
  const CROWN_W = Math.round(5*TILE*CROWN_SCALE), CROWN_H = Math.round(4*TILE*CROWN_SCALE);
  const CROWN_AX = Math.round(160*CROWN_SCALE), CROWN_AY = Math.round(244*CROWN_SCALE);
  function crownCanvas(){
    if (theme.crown) return theme.crown;
    const cv = document.createElement('canvas');
    cv.width = CROWN_W; cv.height = CROWN_H;
    const g = cv.getContext('2d');
    for (let y = 0; y < cv.height; y += TILE)
      for (let x = 0; x < cv.width; x += TILE) g.drawImage(theme.leaf, x, y);
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
    return (theme.crown = cv);
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
      if (!v || (v >= 3 && v !== 6)) continue;   // the crown draws the leaf cells
      const sx = tx*TILE - cam.x, sy = ty*TILE - cam.y;
      ctx.drawImage(v === 6 ? (theme.wall || theme.bark)
                  : v === 2 ? theme.bark
                  : (!solid(tx,ty-1) ? theme.grass : theme.dirt), sx, sy);
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
  // save stations: a floor plate with a floating beacon, dimmer right after a save
  function drawStations(){
    const t = performance.now()*0.003;
    for (const st of STATIONS){
      const x = st.tx*TILE - cam.x, y = st.fr*TILE - cam.y;
      if (x < -TILE || x > VIEW_W + TILE || y < -TILE*2 || y > VIEW_H + TILE) continue;
      const p = 0.5 + 0.5*Math.sin(t + st.tx);
      ctx.save();
      ctx.fillStyle = '#0e2a30';
      ctx.fillRect(x + 2*U, y - 2.5*U, TILE - 4*U, 2.5*U);
      ctx.strokeStyle = st.armed ? '#60e0d0' : '#2f8f85'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 2*U + 0.5, y - 2.5*U + 0.5, TILE - 4*U - 1, 2.5*U - 1);
      const cx3 = x + TILE/2, cy3 = y - 7*U - 1.5*U*p;
      ctx.shadowColor = 'rgba(96,224,208,' + (0.35 + 0.45*p).toFixed(3) + ')';
      ctx.shadowBlur = 6 + 6*p;
      ctx.fillStyle = st.armed ? '#60e0d0' : '#2f8f85';
      ctx.beginPath();
      ctx.moveTo(cx3, cy3 - 3*U); ctx.lineTo(cx3 + 2.2*U, cy3);
      ctx.lineTo(cx3, cy3 + 3*U); ctx.lineTo(cx3 - 2.2*U, cy3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  // menus, overlays, and shared widgets live in src/ui.js. Screens return
  // their clickable rects; the vars below stay the source input reads
  const UIS = UILIB.create({ ctx, VIEW_W, VIEW_H, U, mouse, inRect });
  const { showToast, drawToast, drawNotice, drawPaused, drawSpawnMenu,
          drawMenu, drawGameOver, roundRect } = UIS;
  // speed-booster rainbow trail, hue-shifted run strips baked once so drawing is plain blits
  const BOOST_HUES = 12;
  let boostCache = null;
  function buildBoostCache(){
    boostCache = [];
    const fw = Math.round(FW/SS), fh = Math.round(FH/SS);
    // Safari has no canvas filter, so probe once and hue-blend there instead
    const probe = document.createElement('canvas').getContext('2d');
    probe.filter = 'hue-rotate(90deg)';
    const hasFilter = typeof probe.filter === 'string' && probe.filter !== 'none';
    for (let hi = 0; hi < BOOST_HUES; hi++){
      const cv = document.createElement('canvas'); cv.width = fw*NF; cv.height = fh;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = true;
      const hue = Math.round(hi/BOOST_HUES*360);
      if (hasFilter){
        g.filter = 'hue-rotate(' + hue + 'deg) saturate(3) brightness(1.3)';
        g.drawImage(IMG.archer, 0, ROW.RUN*FH, FW*NF, FH, 0, 0, fw*NF, fh);
      } else {
        // paint the frames, blend every pixel to this entry's hue, then cut the
        // silhouette back out. Not identical to hue-rotate but the trail still cycles.
        g.drawImage(IMG.archer, 0, ROW.RUN*FH, FW*NF, FH, 0, 0, fw*NF, fh);
        g.globalCompositeOperation = 'hue';
        g.fillStyle = 'hsl(' + hue + ',100%,60%)';
        g.fillRect(0, 0, fw*NF, fh);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(IMG.archer, 0, ROW.RUN*FH, FW*NF, FH, 0, 0, fw*NF, fh);
        g.globalCompositeOperation = 'source-over';
      }
      boostCache.push(cv);
    }
  }
  function drawBoostFx(){
    if (!P.boost && !P.trail.length) return;
    if (!boostCache) buildBoostCache();
    const tm = performance.now() * 0.001;
    const fw = Math.round(FW/SS), fh = Math.round(FH/SS);
    if (P.boost){   // cheap rainbow glow behind the ranger, one gradient fill
      const gx = P.x + P.w/2 - cam.x, gy = P.y + P.h*0.5 - cam.y, gr = 22, h = Math.round((tm*300) % 360);
      const grd = ctx.createRadialGradient(gx, gy, 1, gx, gy, gr);
      grd.addColorStop(0, 'hsla(' + h + ',100%,65%,0.5)'); grd.addColorStop(1, 'hsla(' + h + ',100%,65%,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI*2); ctx.fill();
    }
    for (let i = 0; i < P.trail.length; i++){
      const e = P.trail[i];
      const spr = boostCache[(Math.floor(tm*10) + i) % BOOST_HUES];
      ctx.save();
      ctx.translate(Math.round(e.x + P.w/2 - cam.x), Math.round(e.y + P.h - cam.y) + 2);   // same seat as the live ranger
      if (e.face < 0) ctx.scale(-1, 1);
      ctx.globalAlpha = (i / P.trail.length) * 0.55;
      ctx.drawImage(spr, (e.frame % NF)*fw, 0, fw, fh, -AX/SS, -AY/SS, fw, fh);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  // body frame at the origin, shared by drawPlayer and the dash echoes
  function drawArcherFrame(){
    if (P.anim === 'ATTACK'){
      const legDY = P.legs === 'JUMP' ? JUMP_LEG_DY : 0;
      ctx.drawImage(IMG.archer, P.lframe*FW, LEGROW[P.legs]*FH, FW, FH, -AX/SS, -AY/SS + legDY, FW/SS, FH/SS);
      ctx.drawImage(IMG.archer, P.frame*FW, ROW.ATTACK*FH, FW, FH, -AX/SS, -AY/SS, FW/SS, FH/SS);
    } else {
      ctx.drawImage(IMG.archer, P.frame*FW, ROW[P.anim]*FH, FW, FH, -AX/SS, -AY/SS, FW/SS, FH/SS);
    }
  }
  function drawPlayer(){
    const sx = Math.round(P.x + P.w/2 - cam.x);
    // +2 seats the boots into the grass like the enemies, never a floating gap
    const feetY = Math.round(P.y + P.h - cam.y) + 2;
    // dash echoes, fading out after the dash
    if (P.dashFx > 0 && P.crouchT <= 0){
      const fade = Math.min(1, P.dashFx / DASH_FADE);
      ctx.imageSmoothingEnabled = true;
      for (let k = 4; k >= 1; k--){
        ctx.save();
        ctx.translate(Math.round(sx - P.dashDir*13*k), feetY);
        if (P.face < 0) ctx.scale(-1,1);
        ctx.globalAlpha = 0.42*(1 - k/5.5)*fade;
        drawArcherFrame();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
    }
    ctx.save();
    ctx.translate(sx, feetY);
    if (P.face < 0) ctx.scale(-1,1);
    ctx.imageSmoothingEnabled = true;
    if (P.crouchT >= 1){
      drawCrouchPose();
    } else {
    // brief squash tween between standing and the crouch composite
    if (P.crouchT > 0) ctx.scale(1 + 0.08*P.crouchT, 1 - 0.37*P.crouchT);
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
    }
    ctx.imageSmoothingEnabled = false;
    ctx.restore();
  }
  // the crouch composite in the player's face-local space, origin at (center, feet)
  function drawCrouchPose(){
    const pose = crouchPose();
    const th = -pose[0]*Math.PI/180;
    const pv = crouchPivot(pose);
    if (P.anim === 'ATTACK'){
      // bow arm behind, aim stays exact
      const cs = crouchShoulder(pose);
      ctx.save();
      ctx.translate(cs[0]/SS, cs[1]/SS);
      ctx.rotate(P.aim);
      ctx.drawImage(IMG.bowarm, P.frame*BW, 0, BW, BH, -BPX/SS, -BPY/SS, BW/SS, BH/SS);
      if (P.charging){
        const cg = P.chargeT / CHARGE_MAX;
        chargeGlow(cg);
        ctx.drawImage(tintedArrow(cg), GRIP[0]/SS - ARROW_LEN*0.55, GRIP[1]/SS - ARROW_THICK/2, ARROW_LEN, ARROW_THICK);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }
    // boots squashed about the feet line
    let lrow, lfr;
    if (P.anim === 'ATTACK'){ lrow = LEGROW[P.legs] || ROW.LEGS_IDLE; lfr = P.lframe; }
    else if (P.anim === 'WALK' || P.anim === 'RUN'){ lrow = ROW.LEGS_WALK; lfr = P.frame; }
    else { lrow = ROW.LEGS_IDLE; lfr = 0; }
    const fwd = CR_BASE_FWD + pose[2];
    ctx.drawImage(IMG.archer, lfr*FW, lrow*FH, FW, FH,
                  (fwd - AX*CR_LEGS_W)/SS, -AY*pose[3]/SS, FW*CR_LEGS_W/SS, FH*pose[3]/SS);
    // torso leant over the hip pivot, then squashed
    const trow = P.anim === 'ATTACK' ? ROW.ATTACK
               : P.anim === 'HURT' ? ROW.HURT
               : (P.anim === 'WALK' || P.anim === 'RUN') ? ROW.WALK : ROW.IDLE;
    ctx.save();
    ctx.translate(pv[0]/SS, pv[1]/SS);
    ctx.scale(1, CR_TORSO_SCL);
    ctx.rotate(th);
    ctx.drawImage(IMG.archer, P.frame*FW, trow*FH + CR_REG_TOP, FW, CR_REG_H,
                  -CR_PIV[0]/SS, -CR_PIV[1]/SS, FW/SS, CR_REG_H/SS);
    ctx.restore();
  }
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
  let BOMB_SPRITE = null;
  function bombSprite(){
    if (BOMB_SPRITE) return BOMB_SPRITE;
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
    const g = cv.getContext('2d');
    const disc = (cx, cy, r, col) => { g.fillStyle = col; for (let y=-Math.ceil(r); y<=r; y++) for (let x=-Math.ceil(r); x<=r; x++) if (x*x+y*y<=r*r) g.fillRect(cx+x, cy+y, 1, 1); };
    disc(8,10,5,'#123039'); disc(8,10,3,'#1f7aa6'); disc(8,10,1.5,'#a6ecff');
    g.fillStyle = '#e6fbff'; g.fillRect(7,8,1,1);
    g.fillStyle = '#0a1c22'; g.fillRect(3,10,11,1);
    return (BOMB_SPRITE = cv);
  }
  function drawBombs(){
    for (const b of bombs){
      if (!b.exploding){
        const pulse = 0.5 + 0.5*Math.sin(b.fuseT * (0.15 + 0.5*(1 - b.fuseT/BOMB_FUSE)));
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.shadowColor = 'rgba(120,230,255,' + (0.35 + 0.5*pulse).toFixed(3) + ')';
        ctx.shadowBlur = 3 + 7*pulse;
        ctx.drawImage(bombSprite(), b.x - cam.x, b.y - cam.y, b.w, b.h);
        ctx.restore();
      } else {
        const p = Math.min(1, b.boomT / BOMB_BOOM);
        const cx = b.x + b.w/2 - cam.x, cy = b.y + b.h/2 - cam.y;
        const r = BOMB_RADIUS * Math.min(1, p / 0.6);
        const a = Math.min(1, (1 - p) / 0.35);
        ctx.save();
        const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(1, r));
        grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.45, '#a6ecff'); grad.addColorStop(1, '#1f7aa6');
        ctx.globalAlpha = a;
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#dffcff'; ctx.lineWidth = Math.max(1, 3.5*a);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
  }
  function render(){
    ctx.setTransform(SCALE,0,0,SCALE,0,0);
    ctx.lineWidth = 1;   // menu/pause buttons stroke at 1.5, don't let it leak into the world's strokes
    drawBackground(); drawTiles(); drawTorches(); drawStuck(); drawPickups(); drawStations(); drawKnights(); drawSummonRise(); drawKFx(); drawBolts(); drawArrows(); drawFX(); drawBoostFx(); drawPlayer(); drawChargeFx(); drawBombs(); drawCrowns(); drawHUD(); drawDebug();
    const nr = drawNotice(notice); noticeBtn = nr.btn; noticeCodeBtn = nr.codeBtn;
    const sr = drawSpawnMenu(spawnMenu, SPAWN_LIST, ETYPES); spawnBtns = sr.spawnBtns; spawnPanel = sr.spawnPanel;
    const pr = drawPaused(paused, P); resumeBtn = pr.resumeBtn; quitBtn = pr.quitBtn;
    const gr = drawGameOver(gameOver, saveData); gameOverBtn = gr.btn; gameOverLoadBtn = gr.loadBtn;
    drawToast();
    const mr = drawMenu({ menu, MAPS, selectedMap, saveData, godMode, codeEntry });
    mapBtns = mr.mapBtns; godBtn = mr.godBtn; contBtn = mr.contBtn; newBtn = mr.newBtn;
    codeBtn = mr.codeBtn; codeBackBtn = mr.codeBackBtn; codeStartBtn = mr.codeStartBtn;
  }

  // ---------- responsive fit ----------
  const stageEl = document.querySelector('.stage');
  const playAreaEl = document.querySelector('.play-area');
  function fitOnce(){
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
  // the bars scale with --game-w, which fitOnce sets, which changes the space left
  // for the game. Run to a fixed point so a maximize lands back at full size instead
  // of one layout step behind.
  function fitApp(){ for (let i = 0; i < 3; i++) fitOnce(); }
  addEventListener('resize', fitApp);
  addEventListener('load', fitApp);
  fitApp();

  // leave the menu and begin a run, fresh or from a save station
  function startRun(save){
    menu = false; stopMenuMusic(); codeEntry = null;
    buildLevel(selectedMap); computeRooms();   // castle vs forest geometry per map
    theme = THEMES[selectedMap] || THEMES[0];
    if (save){
      applyAbilities(save.abilities);
      const st = STATIONS[save.station] || STATIONS[0];
      st.armed = false;   // don't instantly re-save on the spawn frame
      P.x = st.tx*TILE + Math.round((TILE - P.w)/2);
      P.y = st.fr*TILE - P.h;
      P.vx = 0; P.vy = 0;
      const sp = screenPos();
      camRegion = sp.region; camTrans = 0;
      cam.y = sp.region === 0 ? CAM_SKY_Y : sp.region === 1 ? CAM_SURF_Y : CAM_ROOM_Y;
      cam.x = sp.region === 1 ? Math.max(0, Math.min(LEVEL_PX_W - VIEW_W, P.x + P.w/2 - VIEW_W/2)) : sp.col*VIEW_W;
    }
    if (godMode){
      // god mode wins: every ability regardless of what the save had
      P.canDouble = P.canCharge = P.canBomb = P.canBoost = true;
      for (const pk of pickups) pk.taken = true;
    }
  }

  // Quit to Main Menu: reset everything in memory and show the menu (no page reload)
  function resetGame(){
    Object.assign(P, freshPlayer());
    EN.resetEnemies();   // clears knights, bolts, and lunge streaks too
    hp = 99; if (hpEl) hpEl.textContent = hp;
    arrows.length = 0; fx.length = 0; stuck.length = 0; bombs.length = 0; chargeFx.length = 0;
    spawnMenu = false; spawnBtns = null;
    for (const pk of pickups) pk.taken = false;
    notice = null; noticeBtn = null; paused = false;
    gameOver = false; gameOverBtn = null; gameOverLoadBtn = null;
    codeEntry = null;
    for (const st of STATIONS) st.armed = true;
    cam.x = 0; cam.y = CAM_SURF_Y; camRegion = 1; camTrans = 0; camFromX = 0; camFromY = CAM_SURF_Y;
    mouse.down = false; mouse.downT = 0;
    for (const key in keys) keys[key] = false;
    chargeSndStop(); boostSndStop();
    menu = true; startMenuMusic();
  }

  // ---------- loop ----------
  const STEP_MS = 1000/SIM_HZ, MAX_ACC = STEP_MS*8;
  let acc = 0, lastT = null;
  function loop(now){
    if (lastT == null) lastT = now;
    acc = Math.min(acc + (now - lastT), MAX_ACC);
    lastT = now;
    if (!menu && !paused && !notice && !gameOver && !spawnMenu){
      while (acc >= STEP_MS){ update(); acc -= STEP_MS; }
    } else { chargeSndStop(); boostSndStop(); acc = 0; }
    render();
    requestAnimationFrame(loop);
  }
  // first-load gate, same system as Recurve / Astro Siege: the LOADING overlay sits
  // over the canvas until the images and every sound have landed, and for at least
  // LOADING_MIN_MS so a fast load doesn't flash it. Failed decodes still resolve,
  // so the gate can't hang.
  const LOADING_MIN_MS = 2000;
  const loadingStart = performance.now();
  const loadingEl = document.getElementById('loading-overlay');
  const imgKeys = ['archer','bowarm','grass','dirt','arrow','bark','leaf','knight','ngrass','ndirt','nbark','nleaf','ccap','cfill','cwall'].concat(['knight2','knight3','troll1','troll2','troll3','skel1','skel2','skel3','necro1','necro2','necro3',
    'orc1','orc2','orc3','elf1','elf2','elf3','warrior1','warrior2','warrior3','pirate1','pirate2','pirate3',
    'elf1_bolt','warrior3_bolt','pirate2_bolt']);
  const imagesReady = Promise.all(imgKeys.map(k => new Promise(res => {
    IMG[k].onload = res;
    IMG[k].onerror = () => { console.error('asset failed to decode: ' + k); res(); };
  })));
  Promise.allSettled([imagesReady, ...sfxReady]).then(() => {
    const wait = Math.max(0, LOADING_MIN_MS - (performance.now() - loadingStart));
    setTimeout(() => {
      if (loadingEl) loadingEl.classList.add('hidden');
      requestAnimationFrame(loop);
    }, wait);
  });
})();
