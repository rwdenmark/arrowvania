/* Arrowvania pathfinding: grounded-node mapping and route planning for the
   enemy AI. Pure of game state, so it can run headlessly under Node.
   create() takes the tile grid geometry plus two callbacks from the physics
   in logic.js: standable(tx, ty) and bfsRoute(start, goal, allowJumps).
   Nodes are tile indices (ty*LW + tx), the same encoding logic.js uses. */
const PATHLIB = (() => {
  function create({ TILE, LW, LH, standable, bfsRoute }){
    // map an entity to the node it is standing on (or would land on)
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
    // plan a route from k toward a goal node and describe the first maneuver:
    // walk (both null), a jump/hop, or a drop off a ledge
    function routeTo(k, goal){
      const start = groundNode(k);
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
    return { groundNode, routeTo };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PATHLIB;
