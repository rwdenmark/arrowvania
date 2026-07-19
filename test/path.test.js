/* Headless tests for src/path.js (route planning) and src/levels.js (map
   layouts). Zero dependencies, run with:  npm test  (Node 18+) */
const test = require('node:test');
const assert = require('node:assert/strict');
const LOGIC = require('../src/logic.js');
const PATHLIB = require('../src/path.js');
const LEVELS = require('../src/levels.js');

const TILE = 64;

// Small level from an ASCII sketch. '#' is solid, '.' is open. Row 0 is the top.
const rows = [
  '..........',
  '....##....',
  '..........',
  '..........',
  '##########',
];
const LH = rows.length, LW = rows[0].length;
const map = rows.map(r => Array.from(r, ch => (ch === '#' ? 1 : 0)));
const phys = LOGIC.createPhysics({ TILE, EPS: 0.01, LW, LH, map });
const PF = PATHLIB.create({ TILE, LW, LH, standable: phys.standable,
  bfsRoute: (s, g, j) => phys.bfsRoute(s, g, j) });
// an entity whose feet rest on row ty
const ent = (tx, ty) => ({ x: tx*TILE + 10, y: ty*TILE - 40, w: 32, h: 40 });

test('groundNode maps standing entities to their support tile', () => {
  assert.equal(PF.groundNode(ent(2, 4)), 4*LW + 2);        // on the floor
  assert.equal(PF.groundNode(ent(4, 1)), 1*LW + 4);        // on the platform
});

test('routeTo walks flat ground without a maneuver', () => {
  const r = PF.routeTo(ent(1, 4), 4*LW + 8);
  assert.deepEqual(r, { ok: true, jump: null, drop: null });
});

test('routeTo climbs to a platform with a jump', () => {
  const r = PF.routeTo(ent(1, 4), 1*LW + 4);
  assert.equal(r.ok, true);
  assert.notEqual(r.jump, null);
});

test('routeTo leaves a platform with a drop or hop', () => {
  const r = PF.routeTo(ent(4, 1), 4*LW + 1);
  assert.equal(r.ok, true);
  assert.ok(r.drop || r.jump);
});

test('routeTo rejects a missing goal node', () => {
  assert.equal(PF.routeTo(ent(1, 4), -1).ok, false);
});

test('routeTo treats start === goal as arrived', () => {
  assert.deepEqual(PF.routeTo(ent(2, 4), 4*LW + 2), { ok: true, jump: null, drop: null });
});

// ---- levels ----
function freshWorld(){
  const LW2 = 60, LH2 = 32, SURF = 20;
  const map2 = Array.from({length: LH2}, () => new Array(LW2).fill(0));
  const TREE_CROWNS = [], TORCHES = [];
  const LEV = LEVELS.create({ TILE, LW: LW2, LH: LH2, SURF, map: map2, TREE_CROWNS, TORCHES });
  return { LEV, map: map2, TREE_CROWNS, TORCHES, SURF };
}

test('buildCastle boxes the map in and hangs eight sconces', () => {
  const w = freshWorld();
  w.LEV.buildCastle();
  assert.equal(w.TORCHES.length, 8);
  assert.equal(w.map[13][0], 6);    // stone boundary wall
  assert.equal(w.map[5][0], 5);     // invisible wall above it
  assert.equal(w.map[14][44], 6);   // gate wall top course
  assert.equal(w.map[13][44], 0);   // clear above the gate
});

test('buildLevel resets to the forest and plants the edge trees', () => {
  const w = freshWorld();
  w.LEV.buildCastle();
  w.LEV.buildLevel(0, [], []);
  assert.equal(w.TORCHES.length, 0);
  assert.equal(w.map[w.SURF][5], 1);
  assert.equal(w.TREE_CROWNS.length, 2);
});

test('buildLevel places pickups and stations per map', () => {
  const w = freshWorld();
  const pickups = [{ kind: 'double' }, { kind: 'boost' }];
  const stations = [{}, {}];
  w.LEV.buildLevel(2, pickups, stations);
  assert.equal(pickups[0].x, 19*TILE);   // castle double-jump spot
  assert.equal(pickups[1].x, 51*TILE);   // castle boost on the far platform
  assert.equal(stations[0].tx, 40);
  assert.equal(stations[1].fr, 11);
});
