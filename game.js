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
  function plantTree(cx, groundRow, trunkH){
    for (let r = groundRow - trunkH; r < groundRow; r++) map[r][cx] = 2;
    const top = groundRow - trunkH - 4, tiers = [1, 3, 5, 5];
    for (let i = 0; i < 4; i++)
      for (let x = Math.max(0, cx - (tiers[i]>>1)); x <= Math.min(LW-1, cx + (tiers[i]>>1)); x++)
        map[top+i][x] = (x === cx) ? 3 : 4;   // only the center column collides
    // invisible wall (5) above the canopy so trees can't be jumped, blocks the player but passes arrows
    for (let r = 0; r < top; r++) if (map[r][cx] === 0) map[r][cx] = 5;
    TREE_CROWNS.push({ cx, top });
  }
  // sandbox1/2 share this forest layout; sandbox3 builds the castle courtyard
  function buildForest(){
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
    plantTree(0, SURF, 4);       // both map edges get a tree instead of an invisible wall
    plantTree(LW-1, SURF-1, 3);
  }
  // sandbox3 castle courtyard: stone walls (6, drawn with the wall tile) box the
  // map in, a two-room dungeon below, a stone tower room in the sky band, and a
  // mid-courtyard gate wall only a double jump clears
  function buildCastle(){
    for (let x = 0; x < LW; x++){ map[SURF][x] = 1; map[SURF+1][x] = 1; }
    for (let y = SURF+2; y < LH; y++) for (let x = 0; x < LW; x++) map[y][x] = 1;
    // boundary walls, two tiles thick: stone through the surface band, then the
    // same invisible wall (5) the trees use, so they can't be jumped from anywhere
    for (const x of [0, 1, LW-2, LW-1]){
      for (let y = 12; y < SURF; y++) map[y][x] = 6;
      for (let y = 0; y < 12; y++) map[y][x] = 5;
    }
    // courtyard platforms
    const plats = [[5,17,3],[10,15,3],[15,17,3],[22,15,3],[28,17,4],[33,15,3],[50,17,3]];
    for (const [c,r,len] of plats) for (let i=0;i<len;i++) map[r][c+i] = 1;
    // gate wall: 6 tiles tall, top at row 14, so only a double jump clears it
    for (let y = 14; y < SURF; y++){ map[y][44] = 6; map[y][45] = 6; }
    // hole down to the dungeon
    for (let x = 22; x < 25; x++){ map[SURF][x] = 0; map[SURF+1][x] = 0; }
    // two dungeon rooms joined by a low tunnel
    for (let y = 22; y < 29; y++) for (let x = 17; x < 29; x++) map[y][x] = 0;
    for (let y = 26; y < 29; y++){ map[y][29] = 0; map[y][30] = 0; }
    for (let y = 22; y < 29; y++) for (let x = 31; x < 43; x++) map[y][x] = 0;
    for (let x = 21; x < 24; x++) map[24][x] = 1;   // exit platform under the hole
    // stone tower room in the sky band
    for (let x = 15; x < 30; x++){ map[1][x] = 6; map[11][x] = 6; }   // ceiling + floor
    for (let y = 1; y < 12; y++){ map[y][15] = 6; map[y][29] = 6; }   // side walls
    for (let x = 22; x < 25; x++) map[11][x] = 0;                     // entry gap in the floor
    // wall sconces, each centered on the outer wall tile it hangs from
    TORCHES.push(
      { x: 1.5*TILE, y: 16.4*TILE },  { x: (LW-1.5)*TILE, y: 16.4*TILE },   // boundary walls
      { x: 44.5*TILE, y: 15.4*TILE }, { x: 45.5*TILE, y: 15.4*TILE },       // gate wall
      { x: 16.5*TILE, y: 25.4*TILE }, { x: 43.5*TILE, y: 25.4*TILE },       // dungeon rooms
      { x: 15.5*TILE, y: 7.4*TILE },  { x: 29.5*TILE, y: 7.4*TILE }         // tower room
    );
  }
  // per-map pickup and save-station spots (tile coords)
  const PICKUP_SPOTS = [
    { double: [22,28], charge: [19,10], bomb: [25,10], boost: [25,28] },   // forest maps
    { double: [19,28], charge: [18,10], bomb: [26,10], boost: [51,16] },   // castle
  ];
  const STATION_SPOTS = [ [[18,29],[17,11]], [[40,29],[27,11]] ];
  // (re)build the level for a map index. Mutates the shared map array in place,
  // so the physics closure in logic.js keeps working untouched.
  function buildLevel(mi){
    const castle = mi === 2;
    for (let y = 0; y < LH; y++) map[y].fill(0);
    TREE_CROWNS.length = 0; TORCHES.length = 0;
    (castle ? buildCastle : buildForest)();
    const spots = PICKUP_SPOTS[castle ? 1 : 0], stns = STATION_SPOTS[castle ? 1 : 0];
    for (const pk of pickups){ pk.x = spots[pk.kind][0]*TILE; pk.y = spots[pk.kind][1]*TILE; }
    for (let i = 0; i < STATIONS.length; i++){ STATIONS[i].tx = stns[i][0]; STATIONS[i].fr = stns[i][1]; }
  }
  buildForest();
  // collision, movement and pathfinding live in logic.js so they can be tested headlessly
  const phys = LOGIC.createPhysics({ TILE, EPS: 0.01, LW, LH, map });
  const { solid, standable, moveAxis, moveSwept, grounded, overlaps, bboxSolid } = phys;
  const bfsRoute = (start, goal, allowJumps) => phys.bfsRoute(start, goal, allowJumps);

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
  const WALK_SPD=1.02*U, ACCEL=0.5*U, FRIC=0.5*U;   // walk is 20% faster than before, no sprint
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

  // ---------- sound effects ----------
  // master mix, SFX_GAIN halves every effect on top of the SFX slider
  const SFX_GAIN = 0.5;
  const SND = { music: { vol: 0.5, muted: false }, sfx: { vol: 0.5, muted: false } };
  // persist the player's sound settings
  try {
    const p = JSON.parse(localStorage.getItem('arrowvania.audio') || '{}');
    if (typeof p.musicVol === 'number') SND.music.vol = p.musicVol;
    if (typeof p.musicMuted === 'boolean') SND.music.muted = p.musicMuted;
    if (typeof p.sfxVol === 'number') SND.sfx.vol = p.sfxVol;
    if (typeof p.sfxMuted === 'boolean') SND.sfx.muted = p.sfxMuted;
  } catch (_) {}
  function saveAudioPrefs(){
    try { localStorage.setItem('arrowvania.audio', JSON.stringify({
      musicVol: SND.music.vol, musicMuted: SND.music.muted,
      sfxVol: SND.sfx.vol, sfxMuted: SND.sfx.muted })); } catch (_) {}
  }
  // baked WAVs decode once, the charge hum is synthesized live so it can hold while the button is held
  let AC = null, chargeSnd = null;
  const sfxBuf = {};
  const sfxReady = [];   // decode promises, the first-load gate waits on these
  // same loading system as Recurve / Astro Siege: build the context and start every
  // decode at load (the context sleeps until the first gesture resumes it), so the
  // Play click can never race its own sound
  (function setupAudio(){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx({ latencyHint: 'interactive' });
    for (const k of ['step','jump','fire','dirt','wood']){
      const url = ASSETS['sfx_' + k]; if (!url) continue;
      const bin = atob(url.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      sfxReady.push(AC.decodeAudioData(bytes.buffer)
        .then(b => { sfxBuf[k] = b; })
        .catch(err => console.error('sfx failed to decode: ' + k, err)));
    }
    sfxReady.push(fetch('card_select.mp3').then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b))
      .then(b => { sfxBuf['select'] = b; })
      .catch(err => console.error('sfx failed to decode: select', err)));
  })();
  function initAudio(){ if (AC && AC.state === 'suspended') AC.resume(); }
  function playSfx(name, vol, rate){
    if (!AC || SND.sfx.muted) return;
    const b = sfxBuf[name]; if (!b) return;
    if (AC.state === 'suspended') AC.resume();
    const src = AC.createBufferSource(); src.buffer = b;
    src.playbackRate.value = rate || 1;
    const g = AC.createGain(); g.gain.value = (vol == null ? 1 : vol)*SND.sfx.vol*SFX_GAIN;
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
    const v = SND.sfx.muted ? 0 : (0.2 + 0.8*c)*0.1*SND.sfx.vol*SFX_GAIN;
    chargeSnd.osc.frequency.value = 55*Math.pow(2, 1.6*c);
    chargeSnd.lfo.frequency.value = 3 + 12*c;
    chargeSnd.g.gain.value = v;
    chargeSnd.lfoG.gain.value = 0.4*v;
  }
  function chargeSndStop(){
    if (!chargeSnd) return;
    chargeSnd.osc.stop(); chargeSnd.lfo.stop(); chargeSnd = null;
  }
  // power-shot impact, a deep boom synthesized live and mixed like the terrain hits
  let boomNoise = null;
  function playBoom(){
    if (!AC || SND.sfx.muted) return;
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime;
    if (!boomNoise){
      const len = Math.floor(AC.sampleRate * 0.5);
      boomNoise = AC.createBuffer(1, len, AC.sampleRate);
      const d = boomNoise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random()*2 - 1;
    }
    const out = AC.createGain();
    out.gain.value = 0.7 * SND.sfx.vol * SFX_GAIN;   // in line with the wood/dirt impacts
    out.connect(AC.destination);
    const o = AC.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const og = AC.createGain(); og.gain.setValueAtTime(1.0, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.65);
    const n = AC.createBufferSource(); n.buffer = boomNoise;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.4);
    const ng = AC.createGain(); ng.gain.setValueAtTime(0.55, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    n.connect(lp).connect(ng).connect(out); n.start(t); n.stop(t + 0.5);
  }
  // bomb detonation: the sci-fi orb sound, stretched to ~1 second
  function playBombSound(){
    if (!AC || SND.sfx.muted) return;
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime;
    const out = AC.createGain(); out.gain.value = 0.8 * SND.sfx.vol * SFX_GAIN; out.connect(AC.destination);
    const sub = AC.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(100, t); sub.frequency.exponentialRampToValueAtTime(36, t + 1.0);
    const sg = AC.createGain(); sg.gain.setValueAtTime(0.9, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
    sub.connect(sg).connect(out); sub.start(t); sub.stop(t + 1.1);
    const car = AC.createOscillator(); car.type = 'sawtooth';
    car.frequency.setValueAtTime(220, t); car.frequency.exponentialRampToValueAtTime(80, t + 1.0);
    const mod = AC.createOscillator(); mod.type = 'sine'; mod.frequency.value = 120;
    const ring = AC.createGain(); ring.gain.value = 0; mod.connect(ring.gain); car.connect(ring);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(300, t + 1.0);
    const rg = AC.createGain(); rg.gain.setValueAtTime(0.4, t); rg.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
    ring.connect(lp).connect(rg).connect(out); car.start(t); mod.start(t); car.stop(t + 1.1); mod.stop(t + 1.1);
  }
  // speed-booster loop: a darker/lower warp shimmer, held while boosting
  let boostSnd = null;
  function boostSndStart(){
    if (!AC || boostSnd) return;
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime;
    const vol = AC.createGain(); vol.gain.setValueAtTime(0.0001, t); vol.connect(AC.destination);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = AC.createGain(); g.gain.value = 0.35; lp.connect(g).connect(vol);   // tremolo rides on g
    const oscs = [];
    [147,147,220,294].forEach((f,i) => {
      const s = AC.createOscillator(); s.type = 'sine'; s.frequency.value = f;
      s.detune.value = (i%2 ? 1 : -1) * 14 * (1 + i*0.35);
      const sg = AC.createGain(); sg.gain.value = 0.25;
      s.connect(sg).connect(lp); s.start(t); oscs.push(s);
    });
    const trem = AC.createOscillator(); trem.type = 'sine'; trem.frequency.value = 5;
    const td = AC.createGain(); td.gain.value = 0.13; trem.connect(td).connect(g.gain); trem.start(t);
    boostSnd = { vol, oscs, trem };
  }
  function boostSndUpdate(){
    if (!boostSnd) return;
    const lvl = SND.sfx.muted ? 0 : 1.2 * SND.sfx.vol * SFX_GAIN;
    boostSnd.vol.gain.setTargetAtTime(lvl, AC.currentTime, 0.03);   // smooth fade in / mute
  }
  function boostSndStop(){
    if (!boostSnd) return;
    for (const s of boostSnd.oscs) s.stop();
    boostSnd.trem.stop();
    boostSnd = null;
  }

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
    if (e.code === 'Digit2' && !e.repeat && !paused && !notice && !gameOver && !spawnMenu) debugAI = !debugAI;   // enemy info overlay, was F3
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
  let toast = null;
  function showToast(text){ toast = { text, until: performance.now() + 1600 }; }
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
  const SPAWN_LIST = ['knight1','knight2','knight3','troll1','troll2','troll3',
                      'skel1','skel2','skel3','necro1','necro2','necro3',
                      'orc1','orc2','orc3','elf1','elf2','elf3',
                      'warrior1','warrior2','warrior3','pirate1','pirate2','pirate3'];
  // spawn placement: 6 tiles ahead, else 6 behind, else the nearest standable
  // column about 6 tiles out. standable() already demands two clear tiles above
  function spawnSpotNear(){
    const pt = Math.floor((P.x + P.w/2)/TILE);
    const pf = Math.floor((P.y + P.h - 1)/TILE) + 1;
    const pband = effBand(P.x + P.w/2, P.y + P.h/2);
    function spotAt(col){
      if (col < 1 || col > LW - 2) return null;
      let best = null;
      for (let row = 2; row < LH; row++){
        if (!standable(col, row)) continue;
        if (bandOf((row - 1)*TILE) !== pband) continue;   // stay in the player's band
        if (best === null || Math.abs(row - pf) < Math.abs(best - pf)) best = row;
      }
      return best === null ? null : { col, row: best };
    }
    const dirs = P.face >= 0 ? [1, -1] : [-1, 1];
    for (const s of dirs){ const sp = spotAt(pt + s*6); if (sp) return sp; }
    for (const d of [5, 7, 4, 8, 3, 9, 2, 10])
      for (const s of dirs){ const sp = spotAt(pt + s*d); if (sp) return sp; }
    return null;
  }
  function spawnEnemyAt(type){
    const sp = spawnSpotNear();
    if (!sp) return false;
    const w = Math.round(0.6*TILE), h = Math.round(1.125*TILE);
    const e = makeEnemy(type, sp.col*TILE + Math.round((TILE - w)/2), sp.row*TILE - h);
    e.aggro = true;   // menu spawns come out hunting, never loitering at their spawn
    e.noHome = true;  // and they own no post: on de-aggro they wander where they are
    knights.push(e);
    return true;
  }
  let menu = true, quitBtn = null, resumeBtn = null;
  const menuMusic = new Audio('menu.mp3'); menuMusic.loop = true;   // created at load so it prefetches
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
  function startMenuMusic(){
    if (!menu) return;
    menuMusic.volume = SND.music.muted ? 0 : SND.music.vol;
    menuMusic.play().catch(() => {});
  }
  function stopMenuMusic(){ menuMusic.pause(); menuMusic.currentTime = 0; }
  function updateMusicVol(){ menuMusic.volume = SND.music.muted ? 0 : SND.music.vol; }
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

  // ---------- knight enemy ----------
  const KN = ASSETS.KNIGHT;
  const KROW = { IDLE:0, WALK:1, RUN:2, JUMP:3, ATTACK:4, DIE:5, HURT:6, ATTACK2:7 };
  const KN_WALK = 0.45*U, KN_RUN = 0.9*U;
  const KN_ATTACK_DUR = SEC(0.5), KN_ATK_CD = SEC(0.35), KN_HURT = SEC(0.11);
  const KN_JMP_CD = SEC(0.25);                            // breather after a landing
  const AI_REPATH = SEC(0.2), AI_REPATH_SLOW = SEC(0.6);  // how often the knight replans / paces
  const KN_GIVEUP = SEC(5);   // stand watching an unreachable player this long, then return home
  const KN_REACH = Math.round(1.2*TILE);   // lunge reach
  const KN_CX = 108;                        // body center in sheet px, so a 180 pivots in place
  // lunge: stance for 3s with the spear leveled, then a 6-tile dash for 40 damage
  const KN_LUNGE_WIND = SEC(2), KN_LUNGE_CD = SEC(5), KN_LUNGE_DIST = 6*TILE;
  const KN_LUNGE_SPD = 10, KN_LUNGE_DMG = 40, KN_STANCE = 5, KN_TINT_SPLIT = 190;
  // the sheet stores the craftpix attack loop starting mid-thrust. Play it rotated
  // so the swing reads windup first: raise (2-4), drive (5-7), impact (8-9), settle (0-1)
  const KN_ATK_SEQ = [2, 3, 4, 5, 6, 7, 8, 9, 0, 1];
  // trans A: ready-up in, settle out, chained swings from guard skip the entry
  const KN_READY = SEC(0.12), KN_SETTLE = SEC(0.07);
  // ---------- enemy roster ----------
  // every enemy runs on the knight-1 chassis with the same stats. Only knight 1
  // keeps the lunge. Casters swap melee for a bolt, necromancers also summon
  const CAST_RANGE = 6*TILE;                     // casters fight from range
  const SUMMON_CD = SEC(8), SUMMON_MAX = 2;      // one summon owed every 8s, 2 alive per caster
  const ETYPES = {
    knight1: { img: 'knight', meta: KN, cx: KN_CX, name: 'Knight 1', seq: KN_ATK_SEQ, entry: [0, 1], lunge: true },
    knight2: { img: 'knight2' }, knight3: { img: 'knight3' },
    troll1: { img: 'troll1' }, troll2: { img: 'troll2' }, troll3: { img: 'troll3' },
    skel1: { img: 'skel1' }, skel2: { img: 'skel2' }, skel3: { img: 'skel3' },
    necro1: { img: 'necro1', caster: true, summon: 'skel1', bolt: '#4db8ff' },
    necro2: { img: 'necro2', caster: true, summon: 'skel2', bolt: '#7ef07e' },
    necro3: { img: 'necro3', caster: true, summon: 'skel3', bolt: '#ff6a5e' },
    orc1: { img: 'orc1', dmg: [7, 9] }, orc2: { img: 'orc2', dmg: [8, 9] },
    orc3: { img: 'orc3', dmg: [7, 9] },
    elf1: { img: 'elf1', caster: true, boltImg: 'elf1_bolt', boltLevel: true, castFrame: 7 },
    elf2: { img: 'elf2' },
    elf3: { img: 'elf3', caster: true, bolt: '#57c8ff', castFrame: 7 },
    warrior1: { img: 'warrior1' }, warrior2: { img: 'warrior2' },
    warrior3: { img: 'warrior3', caster: true, boltImg: 'warrior3_bolt', boltLevel: true, castFrame: 6 },
    pirate1: { img: 'pirate1', dmg: [8, 9] },
    pirate2: { img: 'pirate2', caster: true, boltImg: 'pirate2_bolt', boltScale: 2, castFrame: 8 },
    pirate3: { img: 'pirate3', dmg: [8, 9] },
  };
  for (const ek in ETYPES){
    const t = ETYPES[ek];
    t.key = ek;
    if (!t.meta){ t.meta = ASSETS.ENEMIES[ek]; t.cx = t.meta.CX; }
    t.name = t.name || t.meta.name;
    // these packs store their attack rows windup-first, so they play in file order.
    // The ready pose doubles as the trans-A entry telegraph
    t.seq = t.seq || [0,1,2,3,4,5,6,7,8,9];
    t.entry = t.entry || [t.seq[0]];
    t.dmg = t.dmg || [4, 7];   // progs whose strips hit, tuned so overhead swings land on the way down
  }
  // weapon hitboxes measured from the sheets as vertical strips hugging the
  // weapon, world px [dx from center, dy from feet (negative up), w, h]
  const KN_WEAPON = {
    knight1: [[[12, -66, 8, 64], [20, -55, 8, 32], [28, -34, 62, 10]], [[12, -63, 8, 61], [20, -46, 40, 16], [60, -47, 24, 9]], [[12, -58, 8, 56], [20, -52, 8, 15], [28, -57, 24, 13], [52, -58, 24, 9]], [[12, -64, 8, 62], [20, -54, 16, 16], [36, -56, 40, 11]], [[12, -72, 8, 70], [20, -60, 8, 22], [28, -54, 48, 11]], [[12, -74, 8, 73], [20, -70, 8, 46], [28, -50, 40, 10]], [[12, -74, 8, 72], [20, -73, 8, 53], [28, -58, 8, 20], [36, -48, 32, 11]], [[12, -74, 8, 73], [20, -72, 8, 44], [28, -52, 40, 15], [68, -44, 8, 4]], [[12, -74, 8, 73], [20, -70, 8, 42], [28, -48, 48, 14], [76, -40, 8, 2]], [[12, -74, 8, 73], [20, -63, 8, 36], [28, -39, 56, 11]]],
    knight2: [[[12, -48, 16, 29], [28, -40, 16, 21]], [[12, -66, 24, 28]], [[12, -81, 8, 26]], [], [], [[12, -79, 8, 20]], [[12, -66, 8, 34], [20, -62, 16, 23]], [[12, -44, 24, 29], [36, -30, 8, 11]], [[12, -43, 24, 29], [36, -28, 8, 10]], [[12, -46, 24, 30], [36, -31, 8, 10]]],
    knight3: [[[12, -71, 16, 52], [28, -47, 8, 24], [36, -53, 16, 22], [52, -52, 8, 1]], [[12, -71, 8, 42], [20, -78, 8, 47], [28, -80, 8, 40]], [[12, -75, 8, 38], [20, -70, 8, 26]], [[12, -71, 8, 14]], [[12, -86, 8, 52], [20, -69, 8, 28]], [[12, -66, 16, 42], [28, -64, 8, 33], [36, -68, 8, 26], [44, -68, 8, 14]], [[12, -68, 24, 57], [36, -30, 16, 15], [52, -28, 8, 6]], [[12, -66, 24, 53], [36, -36, 16, 17], [52, -34, 8, 8]], [[12, -68, 16, 52], [28, -40, 16, 20], [44, -41, 16, 14]], [[12, -70, 16, 53], [28, -46, 16, 26], [44, -46, 8, 15], [52, -46, 8, 7]]],
    troll1: [[[12, -74, 16, 72], [28, -68, 16, 30], [44, -94, 16, 49], [60, -92, 8, 23]], [[12, -74, 16, 72], [28, -74, 8, 37], [36, -105, 24, 53]], [[12, -74, 8, 73], [20, -110, 8, 106], [28, -114, 8, 78], [36, -114, 16, 54], [52, -83, 8, 14]], [[12, -117, 16, 116], [28, -114, 8, 78], [36, -98, 16, 32]], [[12, -114, 8, 112], [20, -105, 8, 102], [28, -100, 8, 66], [36, -96, 8, 24]], [[12, -74, 16, 72], [28, -72, 8, 37], [36, -68, 8, 22], [44, -95, 24, 50], [68, -92, 8, 12]], [[12, -74, 16, 72], [28, -72, 8, 56], [36, -42, 32, 27], [68, -36, 8, 14]], [[12, -74, 16, 73], [28, -70, 8, 50], [36, -48, 16, 28], [52, -54, 24, 25]], [[12, -74, 16, 72], [28, -70, 8, 38], [36, -54, 16, 26], [52, -64, 8, 33], [60, -68, 16, 26], [76, -60, 8, 6]], [[12, -74, 16, 72], [28, -68, 8, 30], [36, -61, 16, 24], [52, -81, 8, 43], [60, -81, 8, 28], [68, -79, 8, 18]]],
    troll2: [[[12, -64, 8, 20], [20, -86, 24, 43], [44, -82, 8, 18]], [[12, -97, 32, 45]], [[12, -106, 24, 50]], [[12, -112, 8, 75], [20, -104, 8, 38], [28, -86, 8, 7]], [[12, -96, 8, 62], [20, -88, 8, 12]], [[12, -66, 8, 30], [20, -88, 24, 45], [44, -84, 8, 28], [52, -82, 8, 13]], [[12, -64, 8, 50], [20, -42, 24, 30], [44, -34, 8, 20]], [[12, -62, 8, 43], [20, -44, 8, 26], [28, -53, 24, 32], [52, -36, 8, 8]], [[12, -56, 16, 29], [28, -64, 16, 36], [44, -62, 8, 26], [52, -54, 8, 15]], [[12, -59, 8, 22], [20, -68, 8, 34], [28, -75, 16, 40], [44, -74, 16, 24]]],
    troll3: [[[12, -74, 8, 72], [20, -69, 8, 34], [28, -93, 24, 52], [52, -64, 8, 20]], [[12, -74, 8, 72], [20, -98, 8, 64], [28, -102, 16, 52], [44, -80, 8, 28], [52, -70, 8, 16]], [[12, -108, 8, 106], [20, -108, 8, 75], [28, -101, 8, 45], [36, -88, 16, 28], [52, -68, 8, 1]], [[12, -106, 8, 104], [20, -98, 8, 66], [28, -95, 8, 34], [36, -92, 8, 23], [44, -84, 8, 9]], [[12, -98, 8, 97], [20, -98, 8, 69], [28, -95, 8, 26], [36, -92, 8, 9]], [[12, -74, 8, 72], [20, -72, 8, 42], [28, -61, 8, 19], [36, -90, 24, 53]], [[12, -74, 8, 72], [20, -72, 8, 62], [28, -28, 8, 18], [36, -34, 24, 17]], [[12, -74, 8, 72], [20, -72, 8, 61], [28, -42, 8, 28], [36, -34, 8, 18], [44, -48, 16, 22], [60, -46, 8, 12]], [[12, -74, 8, 72], [20, -72, 8, 46], [28, -48, 16, 31], [44, -62, 8, 37], [52, -64, 8, 23], [60, -63, 8, 14]], [[12, -74, 8, 72], [20, -70, 8, 36], [28, -56, 16, 28], [44, -79, 8, 52], [52, -80, 8, 40], [60, -72, 8, 2]]],
    skel1: [[[12, -62, 8, 60], [20, -53, 8, 34], [28, -54, 16, 20]], [[12, -68, 16, 38], [28, -67, 8, 20]], [[12, -76, 16, 40]], [[12, -80, 8, 38], [20, -60, 8, 10]], [[12, -74, 8, 34], [20, -59, 8, 7]], [[12, -74, 24, 40]], [[12, -74, 8, 70], [20, -68, 8, 52], [28, -37, 16, 20], [44, -34, 8, 9]], [[12, -71, 8, 68], [20, -64, 8, 49], [28, -38, 16, 20], [44, -36, 8, 9]], [[12, -68, 8, 66], [20, -62, 8, 46], [28, -44, 16, 20], [44, -40, 8, 6]], [[12, -66, 8, 64], [20, -60, 8, 43], [28, -49, 16, 21]]],
    skel2: [[[12, -56, 8, 52], [20, -55, 8, 32], [28, -55, 8, 15], [36, -50, 8, 2]], [[12, -66, 16, 40], [28, -62, 8, 2]], [[12, -74, 16, 39]], [[12, -66, 16, 22]], [[12, -62, 16, 20]], [[12, -71, 16, 39], [28, -45, 8, 2]], [[12, -68, 8, 65], [20, -63, 8, 46], [28, -40, 16, 14]], [[12, -68, 8, 64], [20, -31, 8, 14], [28, -41, 16, 15]], [[12, -67, 8, 64], [20, -36, 8, 16], [28, -46, 16, 17]], [[12, -64, 8, 61], [20, -49, 8, 29], [28, -50, 8, 18], [36, -49, 8, 8]]],
    skel3: [[[12, -70, 8, 56], [20, -70, 8, 38]], [[12, -76, 8, 50], [20, -48, 8, 24]], [[12, -66, 8, 41], [20, -56, 8, 20], [28, -38, 8, 5]], [[12, -66, 8, 41], [20, -59, 8, 14], [28, -48, 8, 6]], [[12, -74, 8, 51], [20, -58, 8, 13], [28, -51, 8, 5]], [[12, -76, 8, 56], [20, -54, 8, 30]], [[12, -74, 8, 58], [20, -72, 8, 47], [28, -49, 16, 21]], [[12, -74, 8, 57], [20, -70, 8, 45], [28, -52, 16, 20]], [[12, -73, 8, 57], [20, -66, 8, 38], [28, -60, 16, 20]], [[12, -72, 8, 56], [20, -66, 8, 36], [28, -65, 8, 16]]],
    orc1: [[[12, -64, 8, 52], [20, -39, 16, 28], [36, -30, 8, 18]], [[12, -64, 8, 52], [20, -48, 24, 34], [44, -36, 8, 15]], [[12, -64, 8, 46], [20, -58, 16, 40], [36, -56, 16, 26], [52, -46, 8, 9]], [[12, -68, 32, 42], [44, -64, 16, 18]], [[12, -81, 32, 44], [44, -80, 8, 16]], [[12, -88, 8, 51], [20, -93, 16, 46], [36, -82, 8, 31]], [[12, -98, 8, 61], [20, -92, 8, 38], [28, -76, 8, 16]], [[12, -66, 8, 28], [20, -74, 24, 42], [44, -74, 8, 18]], [[12, -65, 8, 54], [20, -38, 8, 20], [28, -40, 16, 28], [44, -22, 8, 6]], [[12, -64, 8, 52], [20, -39, 24, 28]]],
    orc2: [[[12, -72, 8, 60], [20, -64, 8, 52], [28, -31, 16, 19], [44, -43, 16, 22]], [[12, -73, 8, 52], [20, -64, 8, 49], [28, -40, 16, 23], [44, -49, 8, 21], [52, -56, 8, 23]], [[12, -73, 8, 46], [20, -64, 8, 40], [28, -45, 16, 25], [44, -68, 8, 42], [52, -66, 8, 26]], [[12, -73, 8, 46], [20, -65, 8, 32], [28, -51, 8, 21], [36, -80, 16, 51], [52, -70, 8, 16]], [[12, -73, 8, 46], [20, -88, 24, 53], [44, -79, 8, 38]], [[12, -92, 8, 65], [20, -91, 8, 56], [28, -89, 8, 43], [36, -75, 8, 26], [44, -68, 8, 16]], [[12, -91, 8, 64], [20, -86, 8, 52], [28, -79, 8, 26], [36, -72, 8, 10]], [[12, -74, 8, 47], [20, -66, 8, 31], [28, -85, 24, 50]], [[12, -73, 8, 61], [20, -65, 8, 52], [28, -32, 16, 20], [44, -38, 8, 18], [52, -45, 8, 21]], [[12, -73, 8, 61], [20, -64, 8, 52], [28, -30, 16, 18], [44, -44, 16, 22]]],
    orc3: [[[12, -66, 8, 52], [20, -40, 24, 30]], [[12, -66, 8, 50], [20, -49, 24, 30], [44, -33, 8, 10]], [[12, -66, 8, 46], [20, -59, 16, 40], [36, -59, 8, 30], [44, -48, 8, 16], [52, -45, 8, 2]], [[12, -70, 24, 44], [36, -64, 16, 22]], [[12, -81, 32, 44], [44, -72, 8, 7]], [[12, -84, 8, 48], [20, -92, 16, 45]], [[12, -94, 8, 58], [20, -82, 8, 28], [28, -68, 8, 7]], [[12, -70, 8, 34], [20, -76, 16, 44], [36, -74, 8, 35], [44, -74, 8, 20]], [[12, -66, 8, 53], [20, -41, 24, 30], [44, -22, 8, 4]], [[12, -66, 8, 52], [20, -40, 24, 30], [44, -20, 8, 2]]],
    elf2: [[[12, -70, 8, 67], [20, -59, 8, 38], [28, -62, 8, 32]], [[12, -72, 8, 70], [20, -69, 8, 42], [28, -46, 8, 14]], [[12, -68, 8, 64], [20, -57, 8, 22], [28, -44, 8, 2]], [[12, -68, 8, 31], [20, -56, 8, 12]], [[12, -70, 8, 67], [20, -68, 8, 45], [28, -64, 8, 29]], [[12, -72, 8, 68], [20, -63, 8, 42], [28, -32, 16, 11]], [[12, -72, 8, 69], [20, -64, 8, 40], [28, -38, 16, 12]], [[12, -72, 8, 68], [20, -64, 8, 46], [28, -43, 16, 14]], [[12, -72, 8, 68], [20, -45, 8, 24], [28, -50, 16, 18]], [[12, -71, 8, 68], [20, -56, 16, 35], [36, -56, 8, 11]]],
    warrior1: [[[12, -64, 8, 62], [20, -55, 8, 35], [28, -54, 8, 25]], [[12, -64, 8, 62], [20, -60, 8, 35], [28, -38, 8, 11]], [[12, -63, 8, 61], [20, -54, 8, 26], [28, -42, 8, 12]], [[12, -64, 8, 62], [20, -52, 8, 18]], [[12, -64, 8, 62]], [[12, -66, 8, 64], [20, -59, 8, 30], [28, -43, 8, 8]], [[12, -66, 8, 64], [20, -61, 8, 44], [28, -50, 8, 26]], [[12, -66, 8, 64], [20, -61, 8, 45], [28, -30, 16, 8]], [[12, -66, 8, 64], [20, -60, 8, 41], [28, -28, 16, 8]], [[12, -66, 8, 64], [20, -36, 8, 20], [28, -42, 8, 14], [36, -43, 8, 4]]],
    warrior2: [[[12, -68, 8, 66], [20, -50, 8, 28]], [[12, -68, 8, 66], [20, -51, 8, 23]], [[12, -68, 8, 66], [20, -50, 8, 16]], [[12, -68, 8, 66], [20, -52, 8, 12]], [[12, -68, 8, 66], [20, -50, 8, 8]], [[12, -70, 8, 67], [20, -51, 8, 18]], [[12, -70, 8, 68], [20, -66, 8, 44], [28, -42, 8, 10]], [[12, -70, 8, 68], [20, -66, 8, 44], [28, -32, 8, 4]], [[12, -70, 8, 68], [20, -64, 8, 42], [28, -30, 8, 1]], [[12, -69, 8, 66], [20, -48, 8, 26]]],
    pirate1: [[[12, -72, 8, 70], [20, -62, 8, 52], [28, -33, 8, 18], [36, -43, 8, 19], [44, -56, 8, 28], [52, -52, 8, 16]], [[12, -72, 8, 70], [20, -62, 8, 52], [28, -33, 8, 18], [36, -43, 8, 19], [44, -56, 8, 28], [52, -52, 8, 16]], [[12, -68, 8, 64], [20, -76, 16, 54], [36, -72, 8, 30]], [[12, -80, 8, 76], [20, -73, 8, 40], [28, -48, 8, 10]], [[12, -80, 8, 76], [20, -73, 8, 40], [28, -48, 8, 10]], [[12, -60, 16, 54]], [[12, -81, 8, 78], [20, -80, 8, 64], [28, -71, 8, 38]], [[12, -81, 8, 78], [20, -80, 8, 64], [28, -71, 8, 38]], [[12, -70, 24, 70], [36, -62, 8, 59], [44, -20, 24, 18]], [[12, -72, 8, 70], [20, -72, 8, 64], [28, -62, 8, 50], [36, -30, 16, 16], [52, -39, 8, 22], [60, -39, 8, 14]]],
    pirate3: [[[12, -52, 8, 50], [20, -39, 8, 30], [28, -36, 8, 7]], [[12, -52, 8, 50], [20, -39, 8, 30], [28, -36, 8, 7]], [[12, -54, 8, 50], [20, -54, 8, 20], [28, -44, 8, 15]], [[12, -62, 8, 56], [20, -59, 16, 8]], [[12, -62, 8, 56], [20, -59, 16, 8]], [[12, -66, 8, 60], [20, -12, 8, 2]], [[12, -61, 16, 58], [28, -53, 8, 10]], [[12, -61, 16, 58], [28, -53, 8, 10]], [[12, -70, 8, 70], [20, -68, 8, 62], [28, -55, 8, 1]], [[12, -70, 8, 70], [20, -28, 8, 19], [28, -26, 8, 8]]]
  };
  for (const ek in KN_WEAPON){
    const t = ETYPES[ek];
    t.weapon = KN_WEAPON[ek];
    // reach counts only the damage-window frames, or he'd stop at windup range and whiff
    t.reachBoxes = [];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let pIdx = t.dmg[0]; pIdx <= t.dmg[1]; pIdx++) for (const b of t.weapon[t.seq[pIdx]]){
      t.reachBoxes.push(b);
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]);
    }
    t.reach = [x0, y0, x1 - x0, y1 - y0];   // union bbox, debug overlay only
  }
  function weaponRect(k, box, dir){
    if (!box) return null;
    const bcx = k.x + k.w/2, d = dir || k.face;
    return { x: d > 0 ? bcx + box[0] : bcx - box[0] - box[2],
             y: k.y + k.h + box[1], w: box[2], h: box[3] };
  }
  function meleeInReach(k, dir){
    const boxes = k.T.reachBoxes;
    if (!boxes) return false;
    // exactly the damage geometry: any grace here would let him stop where every swing whiffs
    const bcx = k.x + k.w/2, fy = k.y + k.h;
    for (const b of boxes){
      const x0 = dir > 0 ? bcx + b[0] : bcx - b[0] - b[2];
      const y0 = fy + b[1];
      if (P.x < x0 + b[2] && P.x + P.w > x0 && P.y < y0 + b[3] && P.y + P.h > y0) return true;
    }
    return false;
  }
  function beginAttack(k, kind){
    k.castKind = kind;
    if (kind === 2){ k.summonCX = k.x + k.w/2 + k.face*0.9*TILE; k.summonFace = k.face; k.summonRise = 0; }
    if (k.wasGuard){ k.attackT = KN_ATTACK_DUR; k.didHit = false; k.frame = k.T.seq[0]; }
    else { k.readyT = KN_READY; k.frame = 0; }
  }
  function makeEnemy(type, x, y){
    // hx/hy is the enemy's patrol home. Menu spawns and summons set noHome and
    // never use it, but KEEP the home logic: level-placed enemies (guard posts,
    // future story maps) rely on it to return to their spot after a chase
    return { type, T: ETYPES[type],
      x, y, hx: x, hy: y,
      w: Math.round(0.6*TILE), h: Math.round(1.125*TILE),
      vx: 0, vy: 0, face: -1, onGround: false, hp: 20,
      anim: 'IDLE', frame: 0, ftime: 0, attackT: 0, didHit: false,
      hurtT: 0, atkCd: 0, aggro: false, running: false, jumpTx: null, jumpTy: 0, jumpGap: false,
      route: null, pathT: 0, routeAge: 0, lastPN: -1, settleX: null, goalHome: false, patDir: 1, patT: 0,
      jmpCd: 0, wasGround: true, jumpFrom: null, jumpFails: 0,
      lungeCd: 0, lungeT: 0, lungeDash: 0, lungeHit: false, dashPrevX: null,
      readyT: 0, settleT: 0, wasGuard: false, reengageT: 0, gaveUpPN: -1,
      castKind: 0, summonCd: 0, summoner: null,
      stranded: false, gaveUp: false, dead: false, dieT: 0, holdT: 0 };
  }
  // the sandbox starts empty now, enemies come from the spawn menu (key 1)
  function freshKnights(){ return []; }
  const knights = freshKnights();
  const bolts = [];   // caster projectiles
  function liveSummons(k){
    let n = 0;
    for (const e of knights) if (e.summoner === k && !e.dead) n++;
    return n;
  }
  function castBolt(k){
    // BOLT_FROM (baked) is the sheet arrow's launch point, so the engine
    // projectile continues exactly where the animation's arrow was
    const bf = k.T.meta.BOLT_FROM;
    const sx = k.x + k.w/2 + k.face*(bf ? bf[0] : 0.55*TILE);
    const sy = bf ? k.y + k.h + bf[1] : k.y + 0.35*k.h;
    const dx = (P.x + P.w/2) - sx, dy = (P.y + P.h/2) - sy;
    const d = Math.hypot(dx, dy) || 1;
    const spd = 0.9*U;
    let vx = dx/d*spd, vy = dy/d*spd;
    // archers loose flat like their animation when the target is near their level
    if (k.T.boltLevel && Math.abs(dy) < 0.35*TILE){ vx = (dx < 0 ? -1 : 1)*spd; vy = 0; }
    bolts.push({ x: sx, y: sy, vx, vy, life: SEC(3), col: k.T.bolt, img: k.T.boltImg, scl: k.T.boltScale || 1 });
  }
  // straight-line sight check from the caster's bolt origin to the player,
  // stepping half a tile at a time. Tile 5 (invisible tree wall) lets bolts
  // through, matching the bolt's own collision rule
  function boltClear(k){
    const dxp2 = (P.x + P.w/2) - (k.x + k.w/2);
    const fdir = dxp2 < 0 ? -1 : 1;
    const bf = k.T.meta.BOLT_FROM;
    const sx = k.x + k.w/2 + fdir*(bf ? bf[0] : 0.55*TILE);
    const sy = bf ? k.y + k.h + bf[1] : k.y + 0.35*k.h;
    const tx2 = P.x + P.w/2, ty2 = P.y + P.h/2;
    const steps = Math.max(1, Math.ceil(Math.hypot(tx2 - sx, ty2 - sy)/(TILE/2)));
    for (let i = 1; i <= steps; i++){
      const x = Math.floor((sx + (tx2 - sx)*i/steps)/TILE);
      const y = Math.floor((sy + (ty2 - sy)*i/steps)/TILE);
      const tv = map[y] ? map[y][x] : 1;
      if (tv !== 5 && solid(x, y)) return false;
    }
    return true;
  }
  function summonSkeleton(k){
    const h = Math.round(1.125*TILE), w = Math.round(0.6*TILE);
    let x = (k.summonCX != null ? k.summonCX : k.x + k.w/2 + k.face*0.9*TILE) - w/2;
    x = Math.max(TILE, Math.min(LW*TILE - TILE - w, x));
    const y = k.y + k.h - h;
    if (bboxSolid(x, y, w, h)) x = k.x + k.w/2 - w/2;   // blocked in front: rise at the caster
    const e = makeEnemy(k.T.summon, x, y);
    e.summoner = k; e.aggro = true; e.face = k.face;
    e.noHome = true;   // summons have no post either
    knights.push(e);
  }
  function updateBolts(){
    for (let i = bolts.length - 1; i >= 0; i--){
      const b = bolts[i];
      b.x += b.vx; b.y += b.vy;
      const tv = map[Math.floor(b.y/TILE)] ? map[Math.floor(b.y/TILE)][Math.floor(b.x/TILE)] : 1;
      if (tv !== 5 && solid(Math.floor(b.x/TILE), Math.floor(b.y/TILE))){ bolts.splice(i, 1); continue; }
      if (!P.boost && pDmgCd <= 0 && b.x > P.x && b.x < P.x + P.w && b.y > P.y && b.y < P.y + P.h){
        damage(20); pDmgCd = P_DMG_CD;
        bolts.splice(i, 1); continue;
      }
      if (--b.life <= 0) bolts.splice(i, 1);
    }
  }
  let pDmgCd = 0;   // player damage cooldown so hits land once, not every frame
  let pLastNode = -1;   // the player's last grounded node, stable while they hop
  let debugAI = false;
  function groundNode(E){
    const feet = Math.max(1, Math.floor((E.y + E.h)/TILE));
    const cx2 = Math.max(0, Math.min(LW-1, Math.floor((E.x + E.w/2)/TILE)));
    // try center then body edges so a lip-standing entity maps to its platform
    for (const tx of [cx2, Math.max(0, Math.floor(E.x/TILE)), Math.min(LW-1, Math.floor((E.x + E.w - 1)/TILE))])
      if (standable(tx, feet)) return feet*LW + tx;
    for (let ty = feet; ty < LH; ty++)
      if (standable(cx2, ty)) return ty*LW + cx2;
    return -1;
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
  // patrol walk: turn at walls, edges, patrol bounds, and sometimes at random.
  // blocked() treats a missing floor tile ahead exactly like a wall, so a
  // wandering/idle enemy can NEVER hop off a ledge (it might not be able to
  // jump back up). Only aggro chases and go-home routes take drops on purpose.
  // The ledge guard in updateKnights backs this up as a second net
  function pace(k, anchorX, ranged){
    if (--k.patT <= 0){
      k.patT = AI_REPATH_SLOW + Math.random()*AI_REPATH_SLOW;
      if (Math.random() < 0.45) k.patDir *= -1;
    }
    const cx2 = k.x + k.w/2;
    if (ranged && (cx2 - anchorX) * k.patDir > 2.5*TILE) k.patDir *= -1;
    const fr2 = Math.floor((k.y + k.h)/TILE);
    const blocked = dir => {
      const ahead = Math.floor((cx2 + dir*(k.w/2 + 10))/TILE);
      return solid(ahead, fr2-1) || solid(ahead, fr2-2) || !solid(ahead, fr2);
    };
    if (blocked(k.patDir)){
      // pinned on both sides: stand still instead of mirroring every tick
      if (blocked(-k.patDir)){ k.vx = 0; return; }
      k.patDir *= -1; k.patT = AI_REPATH_SLOW;
    }
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
      // aggro on sight in the same band and screen, dropped when the player
      // truly leaves the band (effBand ignores brief airtime over open ground).
      // A knight who gave up on an unreachable player doesn't stare forever: he
      // wanders, and re-engages the moment the player moves somewhere new
      // (different ground node) or becomes reachable
      const sameBand = effBand(P.x + P.w/2, P.y + P.h/2) === effBand(k.x + k.w/2, k.y + k.h/2);
      const sameScreen = sameBand && Math.floor((P.x + P.w/2)/VIEW_W) === Math.floor((k.x + k.w/2)/VIEW_W);
      let canEngage = k.aggro || !k.gaveUp;
      if (!canEngage && sameScreen){
        const pn2 = P.onGround ? groundNode(P) : pLastNode;
        // wake only for a spot he can actually reach: a node change (or the
        // slow periodic recheck) runs the path test, and a new-but-still-
        // unreachable spot is remembered so the grid isn't flooded every frame
        if (pn2 !== k.gaveUpPN || --k.reengageT <= 0){
          k.reengageT = AI_REPATH;
          // reachable on foot, or (for casters) hittable with a bolt: either wakes him
          canEngage = routeTo(k, P).ok ||
                      (k.T.caster && Math.hypot((P.x + P.w/2) - (k.x + k.w/2), (P.y + P.h/2) - (k.y + k.h/2)) <= CAST_RANGE && boltClear(k));
          if (!canEngage) k.gaveUpPN = pn2;
        }
      }
      if (sameScreen && canEngage){ k.aggro = true; k.gaveUp = false; }
      else if (!sameBand) k.aggro = false;
      if (k.atkCd > 0) k.atkCd--;
      if (k.summonCd > 0) k.summonCd--;
      if (k.lungeCd > 0 && k.lungeT <= 0 && k.lungeDash <= 0) k.lungeCd--;
      // time spent aggro with no way to reach the player, drives the give-up-and-go-home
      if (!k.aggro || k.attackT > 0 || k.lungeT > 0 || k.lungeDash > 0 || (k.route && !k.goalHome)) k.holdT = 0;
      else k.holdT = Math.min(k.holdT + 1, KN_GIVEUP);
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
          if (!P.boost && overlaps(front, P)){
            damage(KN_LUNGE_DMG); k.lungeHit = true; pDmgCd = P_DMG_CD;
            P.vx = k.face * 5*U; P.vy = Math.min(P.vy, -2.2*U);
          }
        }
      } else if (k.hurtT > 0){
        k.hurtT--;
        k.vx = 0;
        k.frame = Math.min(KN.FRAMES - 1, Math.floor((KN_HURT - k.hurtT)/KN_HURT*KN.FRAMES));
      } else if (k.readyT > 0){
        // ready-up telegraph, committed like the swing
        k.readyT--;
        k.vx = 0;
        if (k.readyT === 0){ k.attackT = KN_ATTACK_DUR; k.didHit = false; k.frame = k.T.seq[0]; }
      } else if (k.attackT > 0){
        k.attackT--;
        if (k.attackT === 0) k.atkCd = KN_ATK_CD;
        k.vx = 0;
        const prog = Math.min(KN.FRAMES - 1, Math.floor((KN_ATTACK_DUR - k.attackT)/KN_ATTACK_DUR*KN.FRAMES));
        k.frame = k.T.seq[prog];
         if (k.castKind === 2) k.summonRise = Math.max(0, Math.min(1, (prog - 6) / 2));
        if (k.castKind){
          // the bolt fires on its launch frame, the summon as it rises
          if (!k.didHit && prog >= (k.castKind === 2 ? 9 : (k.T.castFrame || 5))){
            k.didHit = true;
            if (k.castKind === 2) summonSkeleton(k); else castBolt(k);
          }
        } else if (!k.didHit && prog >= k.T.dmg[0] && prog <= k.T.dmg[1]){
          // this frame's weapon strips do the hitting
          if (!P.boost && k.T.weapon){
            for (const b of k.T.weapon[k.frame] || []){
              if (overlaps(weaponRect(k, b), P)){ damage(20); k.didHit = true; pDmgCd = P_DMG_CD; break; }
            }
          }
        }
      } else {
        const dist = Math.abs(dxp);
        const level = Math.abs((P.y + P.h) - (k.y + k.h)) < 1.5*TILE;
        // ranged enemies shoot anyone in range they can SEE, reachable or not:
        // true 2D range plus line of sight, height difference welcome. Firing
        // counts as engagement, so a shooting caster never hits the give-up
        const castOK = k.T.caster && k.aggro &&
                       Math.hypot(dxp, (P.y + P.h/2) - (k.y + k.h/2)) <= CAST_RANGE && boltClear(k);
        // the lunge commits off ledges, so only fire it when solid ground runs to the player
        let lungeClear = k.onGround && level && dist <= 6*TILE;
        if (lungeClear){
          const lf = Math.floor((k.y + k.h + 1)/TILE);
          const lc = Math.floor((k.x + k.w/2)/TILE);
          const pc = Math.floor((P.x + P.w/2)/TILE);   // check ground up to the player's tile, not past it
          const step = pc >= lc ? 1 : -1;
          for (let c = lc + step; c !== pc + step; c += step) if (!solid(c, lf)){ lungeClear = false; break; }
        }
        if (k.T.lunge && k.aggro && k.lungeCd <= 0 && lungeClear){
          k.lungeT = KN_LUNGE_WIND;
          k.lungeCd = KN_LUNGE_CD;
          k.face = dxp < 0 ? -1 : 1;
          k.vx = 0;
        } else if (castOK){
          // casters hold ground, a summon when one is owed, else a bolt
          k.face = dxp < 0 ? -1 : 1;
          k.vx = 0;
          if (k.atkCd <= 0){
            const kind = (k.T.summon && k.summonCd <= 0 && liveSummons(k) < SUMMON_MAX) ? 2 : 1;
            if (kind === 2) k.summonCd = SUMMON_CD;
            beginAttack(k, kind);
          }
        } else if (!k.T.caster && k.aggro && meleeInReach(k, dxp < 0 ? -1 : 1)){
          if (Math.abs(dxp) > 8) k.face = dxp < 0 ? -1 : 1;
          if (k.atkCd <= 0) beginAttack(k, 0);
          else k.vx = 0;   // catching his breath between swings
        } else if (k.settleX != null){
          // finish a landing by stepping onto the middle of the block
          const sdx = k.settleX - (k.x + k.w/2);
          if (k.onGround && Math.abs(sdx) >= 4){
            k.vx = Math.sign(sdx) * KN_WALK;
            want = 'WALK';
          } else k.settleX = null;
        } else if (k.onGround || k.jumpTx == null){
          // destination is the player if reachable, else home, else pace. routes pinned until the timer or the player's node changes
          const pn = P.onGround ? groundNode(P) : pLastNode;
          // a planned jump or drop stays committed while the goal holds still. Replanning
          // mid-approach let BFS tie-breaks flip the first hop (drop left vs jump right)
          // as the start tile changed, so the knight bounced between two plans forever.
          const hopPending = !!(k.route && (k.route.jump || k.route.drop));
          const goalMoved = k.aggro && !k.goalHome && k.lastPN !== pn;
          if (--k.pathT <= 0 && hopPending && !goalMoved && ++k.routeAge < 15){
            k.pathT = AI_REPATH;   // recheck soon, but keep the committed hop
          } else if (k.pathT <= 0 || goalMoved){
            k.routeAge = 0;
            k.pathT = AI_REPATH;
            k.lastPN = pn;
            k.route = null; k.goalHome = false; k.stranded = false;
            if (k.aggro){
              const rp = routeTo(k, P);
              if (rp.ok){ k.route = rp; k.gaveUp = false; }              // reachable: chase
              else if (k.holdT >= KN_GIVEUP){
                // watched long enough with no way in: wander until the player
                // moves off this node or becomes reachable
                k.aggro = false; k.gaveUp = true;
                k.gaveUpPN = P.onGround ? groundNode(P) : pLastNode;
              }
              // else: still watching, route stays null and holdT keeps climbing
            }
            // not aggro: spawned/summoned enemies have no post, they just wander
            // where they are. Placed enemies head home if a path exists
            if (!k.aggro && !k.route){
              if (k.noHome) k.stranded = true;
              else {
                const rh = routeTo(k, { x: k.hx, y: k.hy, w: k.w, h: k.h });
                if (rh.ok){ k.goalHome = true; k.route = rh; }
                else k.stranded = true;
              }
            }
          }
          const r = k.route;
          const gx2 = k.goalHome ? k.hx + k.w/2 : P.x + P.w/2;
          const gdx = gx2 - (k.x + k.w/2);
          if (!r){
            if (k.aggro && !k.goalHome && !k.stranded){
              // still watching, close toward the player while the edge guard holds him at the gap
              k.vx = Math.abs(gdx) < 6 ? 0 : Math.sign(gdx) * KN_WALK;
              want = k.vx === 0 ? 'IDLE' : 'WALK';
              k.face = dxp < 0 ? -1 : 1;
            } else {
              // can't reach the player and can't get home either: wander aimlessly
              pace(k, k.x + k.w/2, false);
              want = k.vx === 0 ? 'IDLE' : 'WALK';
            }
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
              // fire only at the launch spot. apex = rise + 0.9 tiles, wide jumps get extra hang time
              const up2 = Math.max(0, r.jump.ly - r.jump.ty);
              const across = Math.abs(r.jump.lx - r.jump.tx);
              const H2 = (up2 + 0.9 + (across >= 3 ? 0.8 : across === 2 ? 0.3 : 0)) * TILE;
              k.vy = -LOGIC.solveJumpV(GRAV, H2);
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
            if (k.goalHome){ pace(k, k.hx + k.w/2, true); want = k.vx === 0 ? 'IDLE' : 'WALK'; }
            else k.vx = 0;   // right under or over the player, hold steady
          } else {
            const spd = (k.goalHome && !k.aggro) ? KN_WALK : gait(k, Math.abs(gdx));
            k.vx = Math.sign(gdx) * spd;
            want = spd === KN_RUN ? 'RUN' : 'WALK';
          }
          // on foot, hold at a ledge unless the route drops or jumps here. the lunge is separate so a charge still commits
          if (k.onGround && k.vx !== 0 && !(r && (r.drop || r.jump))){
            const dir = k.vx < 0 ? -1 : 1;
            const ahead = Math.floor((k.x + k.w/2 + dir*(k.w/2 + 4)) / TILE);
            const foot = Math.floor((k.y + k.h + 1) / TILE);
            if (!solid(ahead, foot)){ k.vx = 0; want = 'IDLE'; }
          }
          if (k.vx !== 0) k.face = k.vx < 0 ? -1 : 1;
        }
      }
      // gap jumps drift to the landing right away, edge jumps rise straight first
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
        // settle onto the middle of the block, only if the jump reached it
        if (k.jumpTx != null){
          if (Math.floor((k.y + k.h)/TILE)*TILE === k.jumpTy) k.settleX = k.jumpTx;
          k.jumpTx = null;
        }
      }
      if (k.onGround && !k.wasGround){
        k.jmpCd = KN_JMP_CD;   // breather after landing
        k.route = null; k.pathT = 0;   // landings invalidate the old plan
        // two failed jumps in a row (no height gained): back off, pace, repath
        if (k.jumpFrom != null){
          if (Math.floor((k.y + k.h)/TILE) >= k.jumpFrom){
            if (++k.jumpFails >= 2){ k.jumpFails = 0; k.route = null; k.pathT = AI_REPATH_SLOW; }
          } else k.jumpFails = 0;
          k.jumpFrom = null;
        }
      }
      k.wasGround = k.onGround;
      if (k.jmpCd > 0) k.jmpCd--;
      if (!k.onGround && k.attackT <= 0 && k.hurtT <= 0 && k.lungeT <= 0 && k.lungeDash <= 0) want = 'JUMP';
      // touching the knight hurts and bounces the player off
      const near2 = { x: k.x - 3, y: k.y - 3, w: k.w + 6, h: k.h + 6 };
      if (P.boost && overlaps(near2, P)){
        k.hp = 0; k.dead = true; k.dieT = 0; k.attackT = 0; k.lungeT = 0; k.lungeDash = 0;   // plowed through
      } else if (pDmgCd <= 0 && overlaps(near2, P)){
        damage(10); pDmgCd = P_DMG_CD;
        P.vx = (P.x + P.w/2 < k.x + k.w/2 ? -1 : 1) * 4*U;
        P.vy = Math.min(P.vy, -2.2*U);
      }
      if (k.lungeT > 0 || k.lungeDash > 0){ k.anim = 'ATTACK'; k.frame = KN_STANCE; }
      else if (k.attackT > 0){ k.anim = k.castKind === 2 ? 'ATTACK2' : 'ATTACK'; }
      else if (k.hurtT > 0){ k.anim = 'HURT'; }
      else if (k.readyT > 0){
        k.anim = k.castKind === 2 ? 'ATTACK2' : 'ATTACK';
        const es = k.T.entry;
        k.frame = es[Math.min(es.length - 1, Math.floor((KN_READY - k.readyT)/KN_READY*es.length))];
      }
      else if (k.atkCd > 0 && k.aggro && k.onGround && k.vx === 0){
        // guard hold between chained swings
        k.anim = 'ATTACK'; k.frame = k.T.seq[KN.FRAMES - 1];
        k.wasGuard = true;
      }
      else {
        // leaving guard while standing: trans-A settle
        if (k.wasGuard){ k.wasGuard = false; if (k.vx === 0 && k.onGround) k.settleT = KN_SETTLE; }
        if (k.settleT > 0 && k.vx === 0){
          k.settleT--; k.anim = 'ATTACK'; k.frame = 0;
        } else {
          k.settleT = 0;
          if (want !== k.anim){ k.anim = want; k.frame = 0; k.ftime = 0; }
          if (k.anim === 'IDLE') k.frame = 0;
          else if (k.anim === 'JUMP') k.frame = k.vy < -1 ? 3 : k.vy > 1 ? 6 : 4;
          else { const sp2 = k.anim === 'RUN' ? 3 : 4;
            k.ftime++; if (k.ftime >= sp2){ k.ftime = 0; k.frame = (k.frame + 1) % KN.FRAMES; } }
        }
      }
    }
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
              k.hp -= BOMB_DMG; k.hurtT = KN_HURT; k.attackT = 0; k.atkCd = Math.max(k.atkCd, SEC(0.14));
              if (k.hp <= 0){ k.dead = true; k.dieT = 0; k.attackT = 0; k.lungeT = 0; k.lungeDash = 0; }
            }
          }
        }
      } else if (++b.boomT >= BOMB_BOOM){
        bombs.splice(i, 1);
      }
    }
  }
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
      const pn0 = groundNode(P); if (pn0 >= 0) pLastNode = pn0;
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
            k.hp -= a.dmg; k.hurtT = KN_HURT; k.attackT = 0;
            k.atkCd = Math.max(k.atkCd, SEC(0.14));
            if (a.charge > 0.03) makeBurst(a.x, a.y, a.charge);
            if (k.hp <= 0){ k.dead = true; k.dieT = 0; k.attackT = 0; k.lungeT = 0; k.lungeDash = 0; }
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
  // daytime backdrop, painted once and repeated for every screen section
  const ROOM_RAISE = [0, TILE, 2*TILE];   // per region 0/1/2: bg ground meets a floor 1/2/3 tiles up
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
  const BG_R = ROOM_RAISE.map(makeBG);
  const BG = BG_R[0];
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
  const BG_NIGHT_R = ROOM_RAISE.map(makeNightBG);
  const BG_NIGHT = BG_NIGHT_R[0];
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
  const BG_CASTLE_R = ROOM_RAISE.map(makeCastleBG);
  const BG_CASTLE = BG_CASTLE_R[0];
  // per-map theme: tiles, tree colors (the crown bakes lazily per theme), backdrop, weather
  const THEMES = [
    { grass: IMG.grass,  dirt: IMG.dirt,  bark: IMG.bark,  leaf: IMG.leaf,  bg: BG,       bgR: BG_R,       rain: false, crown: null },
    { grass: IMG.ngrass, dirt: IMG.ndirt, bark: IMG.nbark, leaf: IMG.nleaf, bg: BG_NIGHT, bgR: BG_NIGHT_R, rain: true,  crown: null },
    { grass: IMG.ccap,   dirt: IMG.cfill, bark: IMG.cwall, leaf: IMG.leaf,  bg: BG_CASTLE, bgR: BG_CASTLE_R, rain: false, crown: null,
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
  function drawKnights(){
    ctx.imageSmoothingEnabled = true;
    for (const k of knights){
      const sx = Math.round(k.x + k.w/2 - cam.x);
      // +2 seats the feet into the grass, never a gap
      const fy = Math.round(k.y + k.h - cam.y) + 2;
      ctx.save();
      ctx.translate(sx, fy);
      if (k.face < 0) ctx.scale(-1, 1);
      if (k.dead) ctx.globalAlpha = Math.max(0, Math.min(1, (140 - k.dieT) / 40));
      const M = k.T.meta;
      if (k.lungeT > 0 || k.lungeDash > 0){
        const prog = k.lungeDash > 0 ? 1 : 1 - k.lungeT/KN_LUNGE_WIND;
        ctx.drawImage(lungeFrame(Math.round(prog*10)), 0, 0, KN.FW, KN.FH,
                      -KN_CX/SS, -KN.anchorY/SS, KN.FW/SS, KN.FH/SS);
      } else {
        ctx.drawImage(IMG[k.T.img], k.frame*M.FW, KROW[k.anim]*M.FH, M.FW, M.FH,
                      -k.T.cx/SS, -M.anchorY/SS, M.FW/SS, M.FH/SS);
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
  function drawBolts(){
    for (const b of bolts){
      ctx.save();
      ctx.translate(b.x - cam.x, b.y - cam.y);
      if (b.img){
        // the projectile lifted from this enemy's own sheet, flown along the shot
        ctx.rotate(Math.atan2(b.vy, b.vx));
        const im = IMG[b.img], w = im.width/SS*b.scl, h = im.height/SS*b.scl;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(im, -w/2, -h/2, w, h);
        ctx.imageSmoothingEnabled = false;
      } else {
        ctx.shadowColor = b.col; ctx.shadowBlur = 12;
        ctx.fillStyle = b.col;
        ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
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
  function drawNotice(){
    noticeBtn = null; noticeCodeBtn = null;
    if (!notice) return;
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
  function drawPaused(){
    quitBtn = null; resumeBtn = null;
    if (!paused) return;
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
  }
  function drawSpawnMenu(){
    spawnBtns = null; spawnPanel = null;
    if (!spawnMenu) return;
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
  function drawMenu(){
    mapBtns = null; godBtn = null; contBtn = null; newBtn = null; codeBtn = null; codeBackBtn = null; codeStartBtn = null;
    if (!menu) return;
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
      return;
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
  }
  function drawGameOver(){
    gameOverBtn = null; gameOverLoadBtn = null;
    if (!gameOver) return;
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
  }
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
      ctx.translate(Math.round(e.x + P.w/2 - cam.x), Math.round(e.y + P.h - cam.y));
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
    const feetY = Math.round(P.y + P.h - cam.y);
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
  // key-2 overlay: enemy state, route markers, weapon strips
  function drawDebug(){
    if (!debugAI) return;
    ctx.font = '11px ui-monospace, monospace';
    for (const k of knights){
      const x = k.x + k.w/2 - cam.x, y = k.y - cam.y;
      const st = (k.dead ? 'DEAD' : k.aggro ? 'AGGRO' : 'idle') +
                 (k.goalHome ? ' home' : '') + (k.stranded ? ' lost' : '') + ' cd' + k.jmpCd + ' pT' + k.pathT;
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
      // weapon strips: reach envelope faint, live frame solid red
      if (!k.dead && k.T.reach){
        const env = weaponRect(k, k.T.reach);
        ctx.strokeStyle = 'rgba(255,160,40,0.5)';
        ctx.strokeRect(env.x - cam.x, env.y - cam.y, env.w, env.h);
        if (k.attackT > 0 && !k.castKind){
          ctx.strokeStyle = '#ff3030';
          for (const b of k.T.weapon[k.frame] || []){
            const wb = weaponRect(k, b);
            ctx.strokeRect(wb.x - cam.x, wb.y - cam.y, wb.w, wb.h);
          }
        }
      }
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
  // rising summon preview: the real skeleton sprite emerges from a portal at the
  // spawn spot during a necromancer cast, so the spawned enemy takes over with no pop
  function drawSummonRise(){
    for (const k of knights){
      if (k.dead || k.castKind !== 2 || k.attackT <= 0 || k.didHit || !(k.summonRise > 0)) continue;
      const T2 = ETYPES[k.T.summon]; if (!T2 || !T2.meta) continue;
      const M = T2.meta;
      const cx = k.summonCX - cam.x, groundY = Math.round(k.y + k.h - cam.y) + 2, rise = k.summonRise;
      ctx.save();
      const gr = ctx.createRadialGradient(cx, groundY, 2, cx, groundY, 0.62*TILE);
      gr.addColorStop(0, k.T.bolt); gr.addColorStop(1, 'rgba(10,20,30,0)');
      ctx.globalAlpha = 0.55 * (1 - 0.35*rise);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.ellipse(cx, groundY, 0.62*TILE, 0.24*TILE, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, VIEW_W, groundY + 1); ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.translate(Math.round(cx), Math.round(groundY + (1 - rise) * (M.FH/SS)));
      if (k.summonFace < 0) ctx.scale(-1, 1);
      ctx.globalAlpha = Math.min(1, 0.4 + rise);
      ctx.drawImage(IMG[T2.img], 0, 0, M.FW, M.FH, -T2.cx/SS, -M.anchorY/SS, M.FW/SS, M.FH/SS);
      ctx.restore();
    }
    ctx.imageSmoothingEnabled = false;
  }
  function render(){
    ctx.setTransform(SCALE,0,0,SCALE,0,0);
    ctx.lineWidth = 1;   // menu/pause buttons stroke at 1.5, don't let it leak into the world's strokes
    drawBackground(); drawTiles(); drawTorches(); drawStuck(); drawPickups(); drawStations(); drawKnights(); drawSummonRise(); drawKFx(); drawBolts(); drawArrows(); drawFX(); drawBoostFx(); drawPlayer(); drawChargeFx(); drawBombs(); drawCrowns(); drawHUD(); drawDebug(); drawNotice(); drawSpawnMenu(); drawPaused(); drawGameOver(); drawToast(); drawMenu();
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

  // ---------- sound controls ----------
  for (const id of ['music','sfx']){
    const btn = document.getElementById(id+'-mute-btn');
    const sld = document.getElementById(id+'-slider');
    if (!btn || !sld) continue;
    const ch = SND[id];
    sld.value = Math.round(ch.vol * 100);   // restore the saved slider position
    const apply = () => { btn.textContent = ch.muted ? '\u{1F507}' : '\u{1F50A}'; btn.classList.toggle('muted', ch.muted); sld.disabled = ch.muted; };
    btn.addEventListener('click', () => { ch.muted = !ch.muted; apply(); saveAudioPrefs(); if (id === 'music') updateMusicVol(); });
    sld.addEventListener('input', () => { ch.vol = sld.value / 100; saveAudioPrefs(); if (id === 'music') updateMusicVol(); });
    apply();
  }

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
    knights.length = 0; for (const k of freshKnights()) knights.push(k);
    hp = 99; if (hpEl) hpEl.textContent = hp;
    arrows.length = 0; fx.length = 0; stuck.length = 0; bombs.length = 0; chargeFx.length = 0; kFx.length = 0; bolts.length = 0;
    spawnMenu = false; spawnBtns = null;
    for (const pk of pickups) pk.taken = false;
    pDmgCd = 0; pLastNode = -1;
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
