/* Headless tests for the pure game logic in src/logic.js.
   Zero dependencies, run with:  node --test  (Node 18+) */
const test = require('node:test');
const assert = require('node:assert/strict');
const LOGIC = require('../src/logic.js');

const TILE = 64, EPS = 0.01;

// Build a small level from an ASCII sketch. '#' is solid, '.' is open.
// Row 0 is the top. Returns { map, LW, LH } shaped like the game's map.
function level(rows) {
  const LH = rows.length, LW = rows[0].length;
  const map = rows.map(r => Array.from(r, ch => (ch === '#' ? 1 : 0)));
  return { map, LW, LH };
}
function physFor(rows) {
  const { map, LW, LH } = level(rows);
  return LOGIC.createPhysics({ TILE, EPS, LW, LH, map });
}
const node = (LW, tx, ty) => ty * LW + tx;

test('solveJumpV reaches the requested height under gravity', () => {
  const grav = 0.55, h = 3 * TILE;
  const v0 = LOGIC.solveJumpV(grav, h);
  // integrate exactly as the game does on ascent: add gravity, then move
  let y = 0, vy = -v0, peak = 0;
  for (let i = 0; i < 1000; i++) { vy += grav; y += vy; peak = Math.min(peak, y); if (vy > 0) break; }
  assert.ok(Math.abs(-peak - h) <= grav, `apex ${-peak} within one step of ${h}`);
});

test('overlaps is symmetric and edge-exclusive', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(LOGIC.overlaps(a, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(LOGIC.overlaps(a, { x: 10, y: 0, w: 10, h: 10 }), false); // touching edge only
  assert.equal(LOGIC.overlaps(a, { x: 20, y: 0, w: 5, h: 5 }), false);
});

test('solid treats off-map sides as open and the floor as closed', () => {
  const { solid } = physFor([
    '....',
    '####',
  ]);
  assert.equal(solid(1, 1), true);   // the floor tile
  assert.equal(solid(1, 0), false);  // open air
  assert.equal(solid(-1, 0), false); // left of the map is open
  assert.equal(solid(0, 99), true);  // below the map is solid
});

test('soft leaves (4) pass through but the invisible wall (5) blocks entities', () => {
  const { map, LW, LH } = level(['....', '####']);
  map[0][0] = 4;   // soft leaf
  map[0][1] = 5;   // invisible tree wall
  const { solid } = LOGIC.createPhysics({ TILE, EPS, LW, LH, map });
  assert.equal(solid(0, 0), false); // arrows and bodies pass soft leaves
  assert.equal(solid(1, 0), true);  // the wall stops bodies (arrows are excluded at the arrow check)
});

test('standable is the floor tile itself with two clear tiles above it', () => {
  const { standable } = physFor([
    '....',
    '#..#',
    '####',
  ]);
  assert.equal(standable(1, 2), true);  // floor tile, open air above
  assert.equal(standable(0, 1), true);  // top of the left wall, clear above
  assert.equal(standable(1, 1), false); // air, nothing solid to stand on
  assert.equal(standable(1, 0), false); // air with no floor below
});

test('moveSwept stops an entity at a wall instead of tunneling through it', () => {
  const { moveSwept } = physFor([
    '.....',
    '..#..',   // wall at column 2, same row the body occupies
    '.....',
    '#####',
  ]);
  const E = { x: 0, y: 1 * TILE, w: TILE * 0.5, h: TILE, vx: 0, vy: 0 };
  moveSwept(E, 10 * TILE, 0); // hurl it right, far past the wall
  assert.ok(E.x + E.w <= 2 * TILE + 0.001, `stopped before the wall, got ${E.x}`);
  assert.equal(E.vx, 0);
});

test('grounded is true resting on a floor and false in the air', () => {
  const { grounded } = physFor(['....', '....', '####']);
  const onFloor = { x: TILE, y: 1 * TILE, w: TILE * 0.5, h: TILE };
  const inAir = { x: TILE, y: 0, w: TILE * 0.5, h: TILE };
  assert.equal(grounded(onFloor), true);
  assert.equal(grounded(inAir), false);
});

test('bfsRoute walks a flat floor and reconstructs the path', () => {
  const rows = ['........', '########'];
  const { bfsRoute } = physFor(rows);
  const LW = rows[0].length;
  const start = node(LW, 1, 1), goal = node(LW, 6, 1); // nodes are the floor tiles
  const prev = bfsRoute(start, goal, false);
  assert.ok(prev, 'a route exists along the floor');
  let n = goal, hops = 0;
  while (n !== start && hops < 100) { n = prev[n]; hops++; }
  assert.equal(n, start);
});

test('bfsRoute needs a jump to climb a one-tile step', () => {
  // left floor at row 3, a step up to a platform whose top is row 2
  const rows = [
    '......',
    '......',
    '...###',
    '######',
  ];
  const { bfsRoute } = physFor(rows);
  const LW = rows[0].length;
  const start = node(LW, 1, 3); // left floor tile
  const goal = node(LW, 4, 2);  // platform tile, one up and blocked by the step
  assert.equal(bfsRoute(start, goal, false), null, 'the step blocks a plain walk');
  assert.ok(bfsRoute(start, goal, true), 'reachable once jumps are allowed');
});

test('bfsRoute returns null when the goal is walled off', () => {
  const rows = [
    '...#...',
    '...#...',
    '...#...',
    '#######',
  ];
  const { bfsRoute } = physFor(rows);
  const LW = rows[0].length;
  const start = node(LW, 1, 3), goal = node(LW, 5, 3);
  assert.equal(bfsRoute(start, goal, true), null);
});

test('arrowDamage maps charge 0..1 onto damage 1..10', () => {
  assert.equal(LOGIC.arrowDamage(0), 1);      // a plain click
  assert.equal(LOGIC.arrowDamage(1), 10);     // full charge
  assert.equal(LOGIC.arrowDamage(0.5), 6);    // round(1 + 4.5) = 6
  assert.equal(LOGIC.arrowDamage(), 1);       // missing charge behaves like 0
});

test('aimBoost adds motion along the aim and never against it', () => {
  // aim straight right (c=1, sn=0), facing right
  assert.equal(LOGIC.aimBoost(2, 0, 1, 0, 1), 2);   // moving into the shot: full boost
  assert.equal(LOGIC.aimBoost(-2, 0, 1, 0, 1), 0);  // moving against it: clamped to 0
  // facing left (face=-1) and moving left is still motion along the aim
  assert.equal(LOGIC.aimBoost(-2, 0, 1, 0, -1), 2);
  // vertical: aim straight down (c=0, sn=1) while falling adds the fall speed
  assert.equal(LOGIC.aimBoost(0, 3, 0, 1, 1), 3);
});

test('save codes round-trip for every map, station, and ability mask', () => {
  for (let map = 0; map < 2; map++)
    for (let station = 0; station < 3; station++)
      for (let abilities = 0; abilities < 16; abilities++){
        const s = { version: 1, map, station, abilities };
        const code = LOGIC.encodeSave(s);
        assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
        assert.deepEqual(LOGIC.decodeSave(code), s);
      }
});

test('decodeSave forgives case, spacing, and lookalike characters', () => {
  const s = { version: 1, map: 0, station: 2, abilities: 11 };
  const code = LOGIC.encodeSave(s);
  const sloppy = (' ' + code.toLowerCase().replace('-', '  ') + ' ').replace(/0/g, 'o');
  assert.deepEqual(LOGIC.decodeSave(sloppy), s);
});

test('decodeSave rejects corrupted or malformed codes', () => {
  const code = LOGIC.encodeSave({ version: 1, map: 0, station: 1, abilities: 3 });
  const bad = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
  assert.equal(LOGIC.decodeSave(bad), null);
  assert.equal(LOGIC.decodeSave('ABCD'), null);
  assert.equal(LOGIC.decodeSave(''), null);
  assert.equal(LOGIC.decodeSave(null), null);
  assert.equal(LOGIC.decodeSave('!!!!-!!!!'), null);
});

test('moveSwept lands on a floor and stops under a ceiling', () => {
  const { moveSwept } = physFor([
    '####',
    '....',
    '....',
    '####',
  ]);
  const E = { x: TILE, y: 1.2 * TILE, w: TILE * 0.5, h: TILE, vx: 0, vy: 0 };
  moveSwept(E, 0, 10 * TILE);   // slam it down
  assert.ok(Math.abs(E.y + E.h - 3 * TILE) < 0.01, `rests on the floor, got ${E.y}`);
  assert.equal(E.vy, 0);
  moveSwept(E, 0, -10 * TILE);  // hurl it up
  assert.ok(Math.abs(E.y - TILE) < 0.01, `stopped under the ceiling, got ${E.y}`);
});

test('bfsRoute drops off a ledge without needing jumps', () => {
  // upper platform on the left, floor below to the right
  const rows = [
    '......',
    '##....',
    '......',
    '######',
  ];
  const { bfsRoute } = physFor(rows);
  const LW = rows[0].length;
  const start = node(LW, 0, 1);   // on the platform
  const goal = node(LW, 4, 3);    // on the low floor
  assert.ok(bfsRoute(start, goal, false), 'falling is a legal move without jumps');
  assert.equal(bfsRoute(goal, start, false), null, 'no route back up without jumps');
});
