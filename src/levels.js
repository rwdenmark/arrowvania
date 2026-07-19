/* Arrowvania level layouts. Builds each map into the shared tile grid so the
   physics closure in logic.js keeps working untouched. Tile legend: 1 ground,
   2 bark, 3 leaf core, 4 soft leaf (pass-through), 5 invisible wall (blocks
   entities, passes arrows), 6 castle wall (solid to everything).
   create() takes the grid plus the shared TREE_CROWNS / TORCHES arrays the
   renderer reads; buildLevel also places pickups and save stations. */
const LEVELS = (() => {
  function create({ TILE, LW, LH, SURF, map, TREE_CROWNS, TORCHES }){
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
  function buildLevel(mi, pickups, STATIONS){
    const castle = mi === 2;
    for (let y = 0; y < LH; y++) map[y].fill(0);
    TREE_CROWNS.length = 0; TORCHES.length = 0;
    (castle ? buildCastle : buildForest)();
    const spots = PICKUP_SPOTS[castle ? 1 : 0], stns = STATION_SPOTS[castle ? 1 : 0];
    for (const pk of pickups){ pk.x = spots[pk.kind][0]*TILE; pk.y = spots[pk.kind][1]*TILE; }
    for (let i = 0; i < STATIONS.length; i++){ STATIONS[i].tx = stns[i][0]; STATIONS[i].fr = stns[i][1]; }
  }
    return { plantTree, buildForest, buildCastle, buildLevel, PICKUP_SPOTS, STATION_SPOTS };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LEVELS;
