/* Arrowvania pure logic: collision, movement, pathfinding, and the jump solve.
   No DOM or canvas here, so it loads as a plain <script> in the browser and as a
   CommonJS module under Node for the tests in test/logic.test.js. */
(function (root) {
  'use strict';

  // per-frame launch velocity that reaches exactly `h` under gravity `grav`,
  // solving the discrete integration so the apex is exact in-game
  function solveJumpV(grav, h) {
    return Math.sqrt(grav * grav / 4 + 2 * grav * h) + grav / 2;
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Everything that needs the level geometry is bound to one map/dimensions set.
  // Call sites keep the same names via destructuring, so the game reads unchanged.
  function createPhysics(opts) {
    const TILE = opts.TILE, EPS = opts.EPS, LW = opts.LW, LH = opts.LH, map = opts.map;

    // everything collides except soft leaves (4). 5 is the invisible tree wall,
    // solid to entities but transparent to arrows (handled at the arrow check).
    // off-map is solid below the floor, open to the sides
    const solid = (tx, ty) =>
      tx < 0 || ty < 0 || tx >= LW || ty >= LH ? (ty >= LH) : (map[ty][tx] > 0 && map[ty][tx] !== 4);

    // a cell an entity can stand on: floor below, two tiles of headroom above
    const standable = (tx, ty) =>
      tx >= 0 && tx < LW && ty >= 1 && ty < LH &&
      solid(tx, ty) && !solid(tx, ty - 1) && !solid(tx, ty - 2);

    function moveAxis(E, dx, dy) {
      if (dx !== 0) {
        E.x += dx;
        const y0 = Math.floor(E.y / TILE), y1 = Math.floor((E.y + E.h - EPS) / TILE);
        if (dx > 0) {
          const tx = Math.floor((E.x + E.w - EPS) / TILE);
          for (let ty = y0; ty <= y1; ty++) if (solid(tx, ty)) { E.x = tx * TILE - E.w; E.vx = 0; break; }
        } else {
          const tx = Math.floor(E.x / TILE);
          for (let ty = y0; ty <= y1; ty++) if (solid(tx, ty)) { E.x = (tx + 1) * TILE; E.vx = 0; break; }
        }
      }
      if (dy !== 0) {
        E.y += dy;
        const x0 = Math.floor(E.x / TILE), x1 = Math.floor((E.x + E.w - EPS) / TILE);
        if (dy > 0) {
          const ty = Math.floor((E.y + E.h) / TILE);
          for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) { E.y = ty * TILE - E.h; E.vy = 0; break; }
        } else {
          const ty = Math.floor(E.y / TILE);
          for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) { E.y = (ty + 1) * TILE; E.vy = 0; break; }
        }
      }
    }
    // half-tile substeps so high speeds can't tunnel
    function moveSwept(E, dx, dy) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      const steps = Math.max(1, Math.ceil(m / (TILE / 2)));
      for (let i = 0; i < steps; i++) moveAxis(E, dx / steps, dy / steps);
    }
    function grounded(E) {
      const ty = Math.floor((E.y + E.h + 1) / TILE);
      const x0 = Math.floor(E.x / TILE), x1 = Math.floor((E.x + E.w - EPS) / TILE);
      for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) return true;
      return false;
    }
    function bboxSolid(x, y, w, h) {
      const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - EPS) / TILE);
      const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - EPS) / TILE);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) return true;
      return false;
    }

    // BFS over standable cells with the knight's legal moves: walk, fall off edges,
    // and jumps up to 3 tiles high across gaps up to 2 tiles. Returns a prev[] map,
    // or null when the goal is unreachable.
    function bfsRoute(start, goal, allowJumps) {
      const prev = new Int32Array(LW * LH).fill(-1);
      const q = [start]; prev[start] = start;
      for (let qi = 0; qi < q.length && prev[goal] < 0; qi++) {
        const n = q[qi], tx = n % LW, ty = (n - tx) / LW;
        const push = m => { if (prev[m] < 0) { prev[m] = n; q.push(m); } };
        for (const dx of [-1, 1]) {
          const nx = tx + dx;
          if (nx < 0 || nx >= LW) continue;
          if (standable(nx, ty)) push(ty * LW + nx);
          else if (!solid(nx, ty - 1) && !solid(nx, ty - 2)) {
            for (let fy = ty; fy < LH; fy++) if (standable(nx, fy)) { push(fy * LW + nx); break; }
          }
        }
        if (!allowJumps) continue;
        for (let up = 1; up <= 3; up++) {
          const ny = ty - up;
          if (ny < 1) break;
          let clear = true;
          for (let r2 = ny - 2; r2 <= ty - 1 && clear; r2++) if (solid(tx, r2)) clear = false;
          if (!clear) break;
          for (const dx of [-3, -2, -1, 1, 2, 3]) {
            if (up === 3 && Math.abs(dx) === 3) continue;   // arc can't cover 3 up AND 3 across
            const nx = tx + dx;
            if (!standable(nx, ny)) continue;
            const wide = Math.abs(dx) >= 2;   // wide jumps arc higher, need more headroom
            if (wide && solid(tx, ny - 3)) continue;
            let ok3 = true;
            const sg = Math.sign(dx);
            for (let cx = tx + sg; cx !== nx && ok3; cx += sg) {
              if (standable(cx, ny)) ok3 = false;               // a nearer edge exists, land there
              if (solid(cx, ny - 1) || solid(cx, ny - 2)) ok3 = false;
              if (wide && solid(cx, ny - 3)) ok3 = false;
            }
            if (ok3) push(ny * LW + nx);
          }
        }
        // flat and descending hops across small gaps (a 1-col gap flat, up to 2 cols
        // wide when dropping a tile or two)
        for (const dx of [-3, -2, 2, 3]) {
          const nx = tx + dx;
          if (nx < 0 || nx >= LW) continue;
          for (let dy = 0; dy <= 2; dy++) {
            if (dy === 0 && Math.abs(dx) === 3) continue;   // flat arc can't cover 3 across
            const ny2 = ty + dy;
            if (!standable(nx, ny2)) continue;
            let gap = true;
            const sg = Math.sign(dx);
            for (let cx = tx + sg; cx !== nx && gap; cx += sg) {
              for (let ry = ty; ry <= ny2 && gap; ry++) if (standable(cx, ry)) gap = false;
              if (solid(cx, ty - 1) || solid(cx, ty - 2)) gap = false;
              if (Math.abs(dx) === 3 && solid(cx, ty - 3)) gap = false;
            }
            if (gap) push(ny2 * LW + nx);
            break;
          }
        }
      }
      return prev[goal] < 0 ? null : prev;
    }

    return { solid, standable, moveAxis, moveSwept, grounded, overlaps, bboxSolid, bfsRoute };
  }

  const LOGIC = { solveJumpV, overlaps, createPhysics };
  if (typeof module !== 'undefined' && module.exports) module.exports = LOGIC;
  else root.LOGIC = LOGIC;
})(typeof window !== 'undefined' ? window : globalThis);
