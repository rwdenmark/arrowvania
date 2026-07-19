/* Headless behavior tests for the enemy AI in src/enemies.js: aggro, chase,
   give-up, re-aggro, ledge rules, casters, and summons, run on the real
   physics from src/logic.js. Math.random is seeded so patrol wandering is
   deterministic. Run with:  npm test  (Node 18+) */
const test = require('node:test');
const assert = require('node:assert/strict');
global.PATHLIB = require('../src/path.js');
const LOGIC = require('../src/logic.js');
global.LOGIC = LOGIC;
const ENLIB = require('../src/enemies.js');

// deterministic RNG: pace() and the lunge sparks call Math.random
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const TILE = 64, U = TILE/16, LW = 60, LH = 32, SURF = 20, SKY_ROWS = 12;
const VIEW_W = TILE*15, GRAV = 0.1375*U;
const SEC = s => Math.round(s*144);
const meta = { FW: 288, FH: 256, FRAMES: 10, CX: 108, anchorY: 250, name: 'stub' };

// a fresh world per test: flat floor at SURF, then per-test terrain via build(map)
function world(build){
  Math.random = mulberry32(1234);
  const map = Array.from({length: LH}, () => new Array(LW).fill(0));
  for (let x = 0; x < LW; x++){ map[SURF][x] = 1; map[SURF+1][x] = 1; }
  if (build) build(map);
  const phys = LOGIC.createPhysics({ TILE, EPS: 0.01, LW, LH, map });
  // faithful copies of game.js bandOf/effBand with no sky or underground rooms
  const SCREENS_X = Math.max(1, Math.floor((LW*TILE - VIEW_W)/VIEW_W) + 1);
  const rooms = [new Array(SCREENS_X).fill(false), null, new Array(SCREENS_X).fill(false)];
  const bandOf = y => y >= (SURF+2)*TILE ? 2 : y < (SKY_ROWS-1)*TILE ? 0 : 1;
  const effBand = (x, y) => {
    let b = bandOf(y);
    const col = Math.min(SCREENS_X-1, Math.max(0, Math.floor(x/VIEW_W)));
    if (b !== 1 && !rooms[b][col]) b = 1;
    return b;
  };
  const P = { x: 0, y: 0, w: Math.round(0.5*TILE), h: Math.round(1.125*TILE),
              vx: 0, vy: 0, onGround: true, face: 1, boost: false, charging: false };
  let dmg = 0;
  const hits = [];
  const EN = ENLIB.create({
    TILE, U, SEC, GRAV, GRAV_FALL: 0.5625*GRAV, FALL_MAX: 1.6*U, P_DMG_CD: SEC(0.4),
    VIEW_W, LW, LH, SS: 2,
    ASSETS: { KNIGHT: meta, ENEMIES: new Proxy({}, { get: () => meta }) },
    IMG: new Proxy({}, { get: () => ({ width: 10, height: 10 }) }),
    ctx: null, cam: { x: 0, y: 0 }, P, map,
    solid: phys.solid, standable: phys.standable, grounded: phys.grounded,
    overlaps: phys.overlaps, moveSwept: phys.moveSwept, bboxSolid: phys.bboxSolid,
    bfsRoute: (s, g, j) => phys.bfsRoute(s, g, j),
    effBand, bandOf, damage: n => { dmg += n; hits.push(n); },
    drawStreaks: () => {},
    decayStreaks: list => { for (let i = list.length - 1; i >= 0; i--){
      const q = list[i]; q.r -= q.vr; if (q.r < 5 || (q.k && q.k.dead)) list.splice(i, 1); } },
  });
  return {
    EN, P, map, rooms, hits,
    dmg: () => dmg,
    placePlayer(tx, row){
      P.x = tx*TILE + Math.round((TILE - P.w)/2); P.y = row*TILE - P.h;
      P.vx = 0; P.vy = 0; P.onGround = true;
    },
    // teleport an enemy onto a tile and clear its plan, like the game never does
    // mid-frame, but exactly like a level layout would place him
    put(k, tx, row, extra){
      k.x = tx*TILE + Math.round((TILE - k.w)/2); k.y = row*TILE - k.h;
      k.vx = 0; k.vy = 0; k.onGround = true; k.wasGround = true;
      k.route = null; k.pathT = 0; k.jumpTx = null; k.settleX = null;
      Object.assign(k, extra || {});
    },
    tick(n){ for (let i = 0; i < (n || 1); i++){ EN.updateKnights(); EN.updateBolts(); EN.notePlayerNode(); } },
    footRow: k => Math.round((k.y + k.h)/TILE),
    col: e => Math.floor((e.x + e.w/2)/TILE),
    spawn(type){ assert.equal(EN.spawnEnemyAt(type), true); return EN.knights[EN.knights.length - 1]; },
  };
}

test('menu spawns come out aggro with no home post', () => {
  const w = world();
  w.placePlayer(20, SURF);
  const k = w.spawn('knight2');
  assert.equal(k.aggro, true);
  assert.equal(k.noHome, true);
  assert.equal(w.footRow(k), SURF);                       // placed on the ground
  assert.ok(Math.abs(w.col(k) - 20) >= 4, 'spawns several tiles out');
});

test('aggro chase closes on the player and lands hits', () => {
  const w = world();
  w.placePlayer(20, SURF);
  const k = w.spawn('knight2');
  const d0 = Math.abs((k.x + k.w/2) - (w.P.x + w.P.w/2));
  w.tick(SEC(4));
  const d1 = Math.abs((k.x + k.w/2) - (w.P.x + w.P.w/2));
  assert.ok(d1 < d0, 'distance shrinks: ' + d0 + ' -> ' + d1);
  assert.ok(d1 < 2*TILE, 'gets within striking distance, ended at ' + d1 + 'px');
  assert.ok(w.dmg() > 0, 'player takes damage');
});

test('idle wanderer never leaves its platform', () => {
  const w = world(map => { for (let x = 8; x < 13; x++) map[17][x] = 1; });
  w.placePlayer(35, SURF);                                 // two screens away: never aggro
  const k = w.spawn('troll1');
  w.placePlayer(50, SURF);                                 // spawn used the player, now move him far off
  w.put(k, 10, 17, { aggro: false });
  for (let i = 0; i < SEC(30); i++){
    w.tick(1);
    assert.equal(w.footRow(k), 17, 'stays on the platform (tick ' + i + ')');
    assert.ok(k.x > 7*TILE && k.x < 13*TILE, 'stays inside the platform span (tick ' + i + ')');
  }
  assert.equal(k.aggro, false);
});

test('idle wanderer actually wanders, no frozen stare and no stutter-spin', () => {
  const w = world();
  w.placePlayer(50, SURF);
  const k = w.spawn('orc1');
  w.put(k, 10, SURF, { aggro: false });
  const xs = new Set();
  let flips = 0, last = k.face;
  for (let i = 0; i < SEC(20); i++){
    w.tick(1);
    xs.add(Math.round(k.x));
    if (k.face !== last){ flips++; last = k.face; }
  }
  assert.ok(xs.size > 10, 'moves around while idle');
  assert.ok(flips < 60, 'no per-tick face flicker, flipped ' + flips + ' times in 20s');
});

test('aggro enemy drops off a ledge to chase, idle one would not', () => {
  const w = world(map => { for (let x = 8; x < 13; x++) map[17][x] = 1; });
  w.placePlayer(16, SURF);                                 // below, same screen
  const k = w.spawn('skel1');
  w.put(k, 10, 17, { aggro: true });
  w.tick(SEC(8));
  assert.equal(w.footRow(k), SURF, 'dropped down to the floor');
  assert.ok(w.dmg() > 0, 'and reached the player');
});

test('chase jumps up onto a reachable platform', () => {
  const w = world(map => { for (let x = 8; x < 11; x++) map[17][x] = 1; });
  w.placePlayer(9, 17);                                    // on the platform, rise 3
  const k = w.spawn('warrior1');
  w.put(k, 5, SURF, { aggro: true });
  let reached = false;
  for (let i = 0; i < SEC(12) && !reached; i++){ w.tick(1); reached = w.footRow(k) === 17; }
  assert.ok(reached, 'jumped up to the platform');
});

test('unreachable player: give up after the hold, then wander instead of staring', () => {
  const w = world(map => { map[16][9] = 1; });             // lone pillar, rise 4: no jump reaches it
  w.placePlayer(9, 16);
  const k = w.spawn('elf2');
  w.put(k, 4, SURF, { aggro: true });
  w.tick(SEC(2));
  assert.equal(k.aggro, true, 'still watching before the hold runs out');
  w.tick(SEC(8));
  assert.equal(k.gaveUp, true, 'gave up on the unreachable spot');
  assert.equal(k.aggro, false);
  // he wanders now, and does not re-aggro while the player holds the same node
  const xs = new Set();
  for (let i = 0; i < SEC(10); i++){ w.tick(1); xs.add(Math.round(k.x)); }
  assert.equal(k.aggro, false, 'no re-aggro while the player sits still');
  assert.ok(xs.size > 10, 'wanders while given up');
});

test('re-aggro only when the player moves somewhere reachable', () => {
  const w = world(map => { map[16][9] = 1; map[16][13] = 1; });   // two lone pillars
  w.placePlayer(9, 16);
  const k = w.spawn('elf2');
  w.put(k, 4, SURF, { aggro: true });
  w.tick(SEC(10));
  assert.equal(k.gaveUp, true);
  w.placePlayer(13, 16);                                   // new node, still unreachable
  w.tick(SEC(3));
  assert.equal(k.aggro, false, 'a new unreachable spot does not wake him');
  w.placePlayer(12, SURF);                                 // down to the open floor
  w.tick(SEC(3));
  assert.equal(k.aggro, true, 'reachable ground wakes him');
  assert.equal(k.gaveUp, false);
});

test('sky jump over open ground never drops aggro', () => {
  const w = world();
  w.placePlayer(20, SURF);
  const k = w.spawn('knight3');
  w.tick(SEC(1));
  assert.equal(k.aggro, true);
  w.P.y = 3*TILE; w.P.onGround = false;                    // way above the screen, band-0 heights
  w.tick(SEC(2));
  assert.equal(k.aggro, true, 'airtime above open ground keeps the chase');
  w.placePlayer(20, SURF);                                 // land again
  w.tick(SEC(2));
  assert.equal(k.aggro, true);
});

test('a real band change does drop aggro', () => {
  const w = world();
  w.rooms[2][1] = true;                                    // an underground room exists on screen col 1
  w.placePlayer(20, SURF);
  const k = w.spawn('troll3');
  w.tick(SEC(1));
  assert.equal(k.aggro, true);
  w.P.x = 20*TILE; w.P.y = 26*TILE; w.P.onGround = false;  // into the underground band
  w.tick(2);
  assert.equal(k.aggro, false, 'player left the band, knight stands down');
});

test('caster shoots an unreachable player it can see, and never gives up doing it', () => {
  const w = world(map => { map[16][9] = 1; });             // pillar in cast range of the floor
  w.placePlayer(9, 16);
  const k = w.spawn('elf3');
  w.put(k, 5, SURF, { aggro: true });
  let sawBolt = false;
  for (let i = 0; i < SEC(10); i++){ w.tick(1); sawBolt = sawBolt || w.EN.bolts.length > 0; }
  assert.ok(sawBolt, 'loosed at least one bolt');
  assert.ok(w.dmg() >= 20, 'a bolt found the player');
  assert.equal(k.gaveUp, false, 'shooting counts as engagement');
});

test('no line of sight means no bolts, and opening it re-engages the caster', () => {
  const w = world(map => {
    map[16][9] = 1;                                        // player pillar
    for (let y = 13; y < SURF; y++) map[y][7] = 1;         // wall between caster and pillar
  });
  w.placePlayer(9, 16);
  const k = w.spawn('elf3');
  w.put(k, 4, SURF, { aggro: true });
  w.tick(SEC(10));
  assert.equal(w.EN.bolts.length, 0, 'never fires through the wall');
  assert.equal(w.dmg(), 0);
  assert.equal(k.gaveUp, true, 'blind and blocked: he gives up');
  for (let y = 13; y < SURF; y++) w.map[y][7] = 0;         // wall comes down
  let woke = false, sawBolt = false;
  for (let i = 0; i < SEC(6); i++){ w.tick(1); woke = woke || k.aggro; sawBolt = sawBolt || w.EN.bolts.length > 0; }
  assert.ok(woke, 'a hittable player wakes the caster');
  assert.ok(sawBolt, 'and he starts shooting');
});

test('necromancer summons its skeleton, capped at two alive', () => {
  const w = world(map => { map[16][9] = 1; });
  w.placePlayer(9, 16);                                    // safe pillar keeps the necro casting
  const k = w.spawn('necro1');
  w.put(k, 5, SURF, { aggro: true });
  let maxAlive = 0;
  for (let i = 0; i < SEC(30); i++){
    w.tick(1);
    let alive = 0;
    for (const e of w.EN.knights) if (e.summoner === k && !e.dead) alive++;
    maxAlive = Math.max(maxAlive, alive);
    assert.ok(alive <= 2, 'never more than two summons alive');
  }
  assert.ok(maxAlive >= 1, 'summoned at least one skeleton');
  const s = w.EN.knights.find(e => e.summoner === k);
  assert.equal(s.type, 'skel1', 'necro 1 raises skeleton 1');
  assert.equal(s.noHome, true, 'summons own no post either');
});

test('hopping player never strands the chase: pLastNode keeps the route alive', () => {
  const w = world();
  w.placePlayer(24, SURF);
  const k = w.spawn('pirate1');
  w.put(k, 14, SURF, { aggro: true });
  // the player bunny-hops in place: airborne most ticks, grounded in slivers
  let minD = Infinity;
  for (let i = 0; i < SEC(8); i++){
    w.P.onGround = (i % 40) < 6;
    w.P.y = w.P.onGround ? SURF*TILE - w.P.h : SURF*TILE - w.P.h - 2*TILE;
    w.tick(1);
    minD = Math.min(minD, Math.abs((k.x + k.w/2) - (w.P.x + w.P.w/2)));
  }
  assert.ok(minD < 2*TILE, 'closed in on a hopping player, best gap ' + Math.round(minD) + 'px');
});

test('knight 1 lunge: winds up in stance, then the dash lands the 40 hit', () => {
  const w = world();
  w.placePlayer(20, SURF);
  const k = w.spawn('knight1');
  let wound = false;
  for (let i = 0; i < SEC(3) && !wound; i++){ w.tick(1); wound = k.lungeT > 0; }
  assert.ok(wound, 'the lunge winds up on clear level ground');
  w.tick(SEC(4));
  assert.ok(w.hits.includes(40), 'the lunge dash hit for 40, hits: ' + w.hits.join(','));
});

test('player i-frames pace every damage source, no per-tick shredding', () => {
  const w = world();
  w.placePlayer(20, SURF);
  const k = w.spawn('orc1');
  w.put(k, 21, SURF, { aggro: true });     // parked on top of the player
  let last = -1, lastAt = -1e9, minGap = Infinity;
  for (let i = 0; i < SEC(6); i++){
    w.tick(1);
    if (w.dmg() !== last){ minGap = Math.min(minGap, i - lastAt); lastAt = i; last = w.dmg(); }
  }
  assert.ok(w.dmg() > 0, 'contact damage lands at all');
  assert.ok(minGap >= SEC(0.4) - 1, 'hits spaced by the damage cooldown, tightest gap ' + minGap + ' ticks');
});

test('speed booster plows through an enemy and kills it', () => {
  const w = world();
  w.placePlayer(20, SURF);
  const k = w.spawn('troll2');
  w.put(k, 20, SURF, { aggro: true });     // overlapping the player
  w.P.boost = true;
  w.tick(2);
  assert.equal(k.dead, true, 'boost contact is lethal to the enemy');
  assert.equal(w.dmg(), 0, 'and costs the player nothing');
  w.P.boost = false;
});

test('bolts pass the invisible tree wall (tile 5) like arrows do', () => {
  const w = world(map => {
    map[16][9] = 1;                                        // player pillar
    for (let y = 12; y < SURF; y++) map[y][7] = 5;         // invisible wall between
  });
  w.placePlayer(9, 16);
  const k = w.spawn('elf3');
  w.put(k, 4, SURF, { aggro: true });
  let sawBolt = false;
  for (let i = 0; i < SEC(10); i++){ w.tick(1); sawBolt = sawBolt || w.EN.bolts.length > 0; }
  assert.ok(sawBolt, 'line of sight ignores tile 5');
  assert.ok(w.dmg() >= 20, 'and the bolt flies through it to the player');
});

test('hurtEnemy flinches, interrupts, and kills at zero', () => {
  const w = world();
  w.placePlayer(20, SURF);
  const k = w.spawn('skel2');
  k.attackT = 30; k.lungeT = 10;
  w.EN.hurtEnemy(k, 5);
  assert.equal(k.hp, 15);
  assert.ok(k.hurtT > 0, 'flinches');
  assert.equal(k.attackT, 0, 'swing interrupted');
  assert.equal(k.dead, false);
  w.EN.hurtEnemy(k, 15);
  assert.equal(k.dead, true, 'dies at zero');
  assert.equal(k.lungeT, 0, 'death cancels the lunge');
});

test('dead enemies fall out of the roster and reset clears everything', () => {
  const w = world();
  w.placePlayer(20, SURF);
  const k = w.spawn('knight2');
  k.hp = 0; k.dead = true; k.dieT = 0;
  w.tick(SEC(2));
  assert.equal(w.EN.knights.includes(k), false, 'corpse despawned');
  w.spawn('orc2'); w.spawn('orc3');
  w.EN.resetEnemies();
  assert.equal(w.EN.knights.length, 0);
  assert.equal(w.EN.bolts.length, 0);
});
