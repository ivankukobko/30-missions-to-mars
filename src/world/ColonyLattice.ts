/**
 * The one place colony cell coordinates become world coordinates.
 *
 * The model this replaces had five overlapping notions of position — a global column, a
 * grid-local `c`, a `place.x` origin, `colBoundsLo`, and `FLOOR_BASE` standing in for
 * real terrain over in `Layout.ts` — with the conversions between them written out
 * again in four separate files. Two live bugs came from exactly that duplication (a
 * search walking clean past the sampled bounds, a colony growing onto a pad footprint),
 * so the lattice is now a value every other module is handed, and nothing else does
 * arithmetic on a column.
 *
 * Fitted to the real canyon, not to constants: row 0 rests on the canyon's own lowest
 * floor point, and the column range is the real canyon width measured at the lattice's
 * own ceiling — a wall flares outward with altitude, so measuring at the ceiling is what
 * guarantees a colony climbing a wall never needs a column the lattice doesn't have.
 */

/** Edge length of one cell, and the whole reason to keep it at 12: a cell is *one
 *  module*, and pads are 7–12 wide. A cell being building-sized is what makes "the
 *  scaffold you see now is next mission's building" a promise the player can check by
 *  eye. Finer cells would spread one building across many of them and lose that. */
export const COLONY_CELL_SIZE = 12;

/** Floor to rim (`CANYON.RIM_Y` is 240). Was 12 rows when growth could only stand on
 *  the floor; growth climbs walls now, so the ceiling has to be the rim. */
export const COLONY_ROWS = 20;

/**
 * A world x moved onto the nearest column centre.
 *
 * Every pad and every floor bore is snapped with this before anything else looks at it,
 * and it is worth being clear about what it buys, because it is not tidiness. Keep-out is
 * rasterised per cell, so an approach that runs *between* two columns takes both of them —
 * twenty-four units of canyon for a corridor that needs twelve — and the deck keep-out
 * either side of it does the same. Aligned, a pad's deck and the route above it claim
 * exactly the one column they occupy.
 *
 * The lattice's columns are `col * cellSize` with no origin offset (see `worldX`), so this
 * needs no terrain and no lattice instance — which is what lets `TerrainDigs` apply it at
 * resolution time, long before a lattice is fitted.
 */
export function snapToColumn(x: number, cellSize: number = COLONY_CELL_SIZE): number {
  return Math.round(x / cellSize) * cellSize;
}

/** What a lattice needs from `CanyonGenerator` — narrow so this module never has to
 *  import the concrete class, the same boundary `TerrainDigs.ts` already draws. */
export interface LatticeTerrain {
  lowestFloorY(): number;
  canyonWidthAt(y: number): { west: number; east: number };
}

/**
 * Layers, front to back, as offsets from the play plane.
 *
 * The canyon is a cross-section and always was; everything the colony model has fought is
 * the same shortage, which is that a cross-section has no spare volume. Ixion hemmed into
 * a one-column slot, a corridor costing a charter its ground, free cells stranded in
 * pockets nothing can reach — all of it is scarcity, and three layers is three times the
 * buildable volume without widening the canyon by a unit.
 *
 * **Only layer 0 is the play plane.** It carries the colliders, it is the only layer
 * `Layout.ts` judges, and it is the only one a flight channel reserves — so the front and
 * back layers build straight past a corridor, and a route reads as a slot cut through a
 * deep mass rather than a gap the settlement grew around.
 */
export const COLONY_LAYERS = [-1, 0, 1] as const;

export type Layer = (typeof COLONY_LAYERS)[number];

export interface Lattice {
  cellSize: number;
  colLo: number;
  colHi: number;
  cols: number;
  rows: number;
  /** World y the bottom face of row 0 rests on. */
  baseY: number;
  /** Cell *centre*, all three axes — never a corner, so nothing downstream has to
   *  remember which convention a given call used. */
  worldX(col: number): number;
  worldY(row: number): number;
  worldZ(layer: number): number;
  colAt(x: number): number;
  rowAt(y: number): number;
  inBounds(col: number, row: number): boolean;
  /**
   * Dense **2D** index, for keying a typed array over the canyon's cross-section. Only
   * valid in bounds.
   *
   * Deliberately still two-dimensional: the substrate is a rock profile and a flight
   * channel reserves the play plane, so neither has any business knowing that layers
   * exist. Growth keys its cells with `key` instead.
   */
  index(col: number, row: number): number;
  colOf(index: number): number;
  rowOf(index: number): number;
  /** Dense **3D** key, for the one thing that is genuinely volumetric: the cells a colony
   *  has built. Layer varies fastest, so cells in the same column are adjacent. */
  key(col: number, row: number, layer: number): number;
  keyCol(key: number): number;
  keyRow(key: number): number;
  keyLayer(key: number): number;
}

export function buildLattice(
  terrain: LatticeTerrain,
  cellSize: number = COLONY_CELL_SIZE,
  rows: number = COLONY_ROWS,
): Lattice {
  const baseY = terrain.lowestFloorY();
  const width = terrain.canyonWidthAt(baseY + cellSize * rows);
  const colLo = Math.floor(width.west / cellSize) - 1;
  const colHi = Math.ceil(width.east / cellSize) + 1;
  const cols = colHi - colLo + 1;

  const layers = COLONY_LAYERS.length;
  const layerLo = COLONY_LAYERS[0];
  const index = (col: number, row: number): number => (col - colLo) * rows + row;

  return {
    cellSize,
    colLo,
    colHi,
    cols,
    rows,
    baseY,
    worldX: (col) => col * cellSize,
    worldY: (row) => baseY + cellSize / 2 + row * cellSize,
    worldZ: (layer) => layer * cellSize,
    colAt: (x) => Math.round(x / cellSize),
    rowAt: (y) => Math.floor((y - baseY) / cellSize),
    inBounds: (col, row) => col >= colLo && col <= colHi && row >= 0 && row < rows,
    index,
    colOf: (i) => Math.floor(i / rows) + colLo,
    rowOf: (i) => i % rows,
    key: (col, row, layer) => index(col, row) * layers + (layer - layerLo),
    keyCol: (k) => Math.floor(Math.floor(k / layers) / rows) + colLo,
    keyRow: (k) => Math.floor(k / layers) % rows,
    keyLayer: (k) => (k % layers) + layerLo,
  };
}
