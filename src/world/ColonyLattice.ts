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

/** What a lattice needs from `CanyonGenerator` — narrow so this module never has to
 *  import the concrete class, the same boundary `TerrainDigs.ts` already draws. */
export interface LatticeTerrain {
  lowestFloorY(): number;
  canyonWidthAt(y: number): { west: number; east: number };
}

export interface Lattice {
  cellSize: number;
  colLo: number;
  colHi: number;
  cols: number;
  rows: number;
  /** World y the bottom face of row 0 rests on. */
  baseY: number;
  /** Cell *centre*, both axes — never a corner, so nothing downstream has to remember
   *  which convention a given call used. */
  worldX(col: number): number;
  worldY(row: number): number;
  colAt(x: number): number;
  rowAt(y: number): number;
  inBounds(col: number, row: number): boolean;
  /** Dense index for keying a Map or a typed array. Only valid in bounds. */
  index(col: number, row: number): number;
  colOf(index: number): number;
  rowOf(index: number): number;
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

  return {
    cellSize,
    colLo,
    colHi,
    cols,
    rows,
    baseY,
    worldX: (col) => col * cellSize,
    worldY: (row) => baseY + cellSize / 2 + row * cellSize,
    colAt: (x) => Math.round(x / cellSize),
    rowAt: (y) => Math.floor((y - baseY) / cellSize),
    inBounds: (col, row) => col >= colLo && col <= colHi && row >= 0 && row < rows,
    index: (col, row) => (col - colLo) * rows + row,
    colOf: (index) => Math.floor(index / rows) + colLo,
    rowOf: (index) => index % rows,
  };
}
