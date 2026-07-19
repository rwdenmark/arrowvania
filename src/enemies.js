/* Arrowvania enemies: the whole roster runs on one chassis (knight-1 stats).
   This module owns the enemy data (types, weapon strips), spawning and
   summoning, the AI (patrol, aggro, routes via src/path.js, casters), the
   caster projectiles, and all enemy drawing. game.js passes the world it
   needs: geometry, physics callbacks, the camera, the player, and damage().
   State lives here: knights / bolts / kFx arrays, the player route node,
   the player-hit cooldown, and the key-2 debug flag. */
const ENLIB = (() => {
  function create({ TILE, U, SEC, GRAV, GRAV_FALL, FALL_MAX, P_DMG_CD, VIEW_W, LW, LH, SS, ASSETS, IMG, ctx, cam, P, map,
                    solid, standable, grounded, overlaps, moveSwept, bboxSolid, bfsRoute,
                    effBand, bandOf, damage, drawStreaks, decayStreaks }){
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
      stranded: false, gaveUp: false, noHome: false, dead: false, dieT: 0, holdT: 0 };
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
  // grounded-node mapping and route planning live in src/path.js
  const PF = PATHLIB.create({ TILE, LW, LH, standable, bfsRoute });
  const groundNode = PF.groundNode;
  function routeTo(k, target){
    // chasing the player targets their last grounded node while they are airborne
    const goal = target === P ? (P.onGround ? groundNode(P) : pLastNode) : groundNode(target);
    return PF.routeTo(k, goal);
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
  function drawKnights(){
    ctx.imageSmoothingEnabled = true;
    for (const k of knights){
      const sx = Math.round(k.x + k.w/2 - cam.x);
      // +4 seats the feet into the grass, never a gap
      const fy = Math.round(k.y + k.h - cam.y) + 4;
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
  // rising summon preview: the real skeleton sprite emerges from a portal at the
  // spawn spot during a necromancer cast, so the spawned enemy takes over with no pop
  function drawSummonRise(){
    for (const k of knights){
      if (k.dead || k.castKind !== 2 || k.attackT <= 0 || k.didHit || !(k.summonRise > 0)) continue;
      const T2 = ETYPES[k.T.summon]; if (!T2 || !T2.meta) continue;
      const M = T2.meta;
      const cx = k.summonCX - cam.x, groundY = Math.round(k.y + k.h - cam.y) + 4, rise = k.summonRise;   // same seat as drawKnights
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
  // one hit pipeline for the player's weapons (arrows, bombs): flinch,
  // interrupt whatever the enemy was doing, and handle death
  function hurtEnemy(k, dmg){
    k.hp -= dmg; k.hurtT = KN_HURT; k.attackT = 0;
    k.atkCd = Math.max(k.atkCd, SEC(0.14));
    if (k.hp <= 0){ k.dead = true; k.dieT = 0; k.lungeT = 0; k.lungeDash = 0; }
  }
  // the hooks game.js drives each frame / on reset
  function notePlayerNode(){ const n = groundNode(P); if (n >= 0) pLastNode = n; }
  function toggleDebug(){ debugAI = !debugAI; }
  function resetEnemies(){
    knights.length = 0; bolts.length = 0; kFx.length = 0;
    pDmgCd = 0; pLastNode = -1;
  }
  return { knights, bolts, kFx, ETYPES, SPAWN_LIST, hurtEnemy,
           spawnEnemyAt, updateKnights, updateBolts,
           drawKnights, drawKFx, drawBolts, drawDebug, drawSummonRise,
           notePlayerNode, toggleDebug, resetEnemies };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ENLIB;
