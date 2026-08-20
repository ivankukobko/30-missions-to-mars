import { COLONY_CELL_SIZE, snapToColumn } from './ColonyLattice.ts';
import type { Excavation } from './CanyonGenerator.ts';
import { boreDirection, isFloorMounted } from './Shaft.ts';

/**
 * The grid an excavation is carved on, and the set of cells it has taken out of the rock.
 *
 * The shaft used to be a *tube*: two side walls converging on a far cap, meandering, with a
 * collar stitching its mouth to whatever the terrain happened to do there. Every seam bug
 * this canyon has had came out of that mismatch — the bore was built from one vocabulary and
 * the ground it opens into from another, so the two could only ever be *bridged*, never
 * joined. Carving on the colony's own grid removes the mismatch instead of patching it.
 *
 * **Columns are shared with the colony.** `worldX` here is `col * COLONY_CELL_SIZE`, exactly
 * as `ColonyLattice` defines it and exactly what `snapToColumn` already snaps pads and floor
 * bores to. So a shaft, a deck and a colony module all stand on the same lines, and a
 * corridor two cells wide is 24 units — the bore width the KD-9 was designed to translate
 * down (`docs/lore.md`).
 *
 * **Rows are its own, counting down from the mouth.** They cannot be shared: the colony
 * lattice puts row 0 on the canyon's lowest floor point and climbs to the rim, while a shaft
 * bottoms out 300 units *below* that. Row 0 here is the first cell under the mouth and rows
 * increase downward, which keeps every shaft's arithmetic local and leaves the colony's
 * lattice untouched.
 */
export const SHAFT_CELL = COLONY_CELL_SIZE;

export interface ShaftGrid {
  /** Y of the top face of row 0 — the ground the shaft opens through. */
  topY: number;
  /** Cell centres. */
  worldX(col: number): number;
  worldY(row: number): number;
  colAt(x: number): number;
  rowAt(y: number): number;
}

export function shaftGrid(topY: number): ShaftGrid {
  return {
    topY,
    worldX: (col) => col * SHAFT_CELL,
    // Row 0 spans [topY - CELL, topY], so its centre is half a cell below the surface and
    // row r's centre is r cells further down. Written as a subtraction rather than a
    // negative-row convention because every consumer here counts depth, not altitude.
    worldY: (row) => topY - (row + 0.5) * SHAFT_CELL,
    colAt: (x) => Math.round(x / SHAFT_CELL),
    rowAt: (y) => Math.floor((topY - y) / SHAFT_CELL),
  };
}

/** One cell taken out of the rock. */
export interface Carved {
  col: number;
  row: number;
}

export interface ShaftCarve {
  grid: ShaftGrid;
  cells: Carved[];
  has(col: number, row: number): boolean;
  /** Inclusive cell bounds of everything carved. */
  colLo: number;
  colHi: number;
  rowLo: number;
  rowHi: number;
}

const key = (col: number, row: number): string => `${col}|${row}`;

/** A carve built from an explicit cell list — the form authored runs will produce. */
export function carveOf(grid: ShaftGrid, cells: Carved[]): ShaftCarve {
  const taken = new Set(cells.map((c) => key(c.col, c.row)));
  // Sorted so the geometry is emitted in a stable order regardless of how the runs that
  // produced it were listed — the same determinism rule `colonyRuns` keeps.
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const cols = sorted.map((c) => c.col);
  const rows = sorted.map((c) => c.row);
  return {
    grid,
    cells: sorted,
    has: (col, row) => taken.has(key(col, row)),
    colLo: Math.min(...cols),
    colHi: Math.max(...cols),
    rowLo: Math.min(...rows),
    rowHi: Math.max(...rows),
  };
}

/**
 * The carve an existing `Excavation` describes, rasterised onto the grid.
 *
 * A shim, and deliberately a thin one. The ledger still authors digs as tubes — an `x`, a
 * half-width, a depth and a direction — and rewriting that into authored runs is a separate
 * change to a file eighteen modules read. Rasterising here means the new geometry can be
 * built, seen and judged against the campaign that exists, and when runs do arrive only this
 * function is replaced.
 *
 * Both bore directions collapse to the same expression: walk the axis from the mouth for
 * `depth`, and take every cell within `halfWidth` of the axis on the perpendicular.
 */
export function carveFromDig(dig: Excavation, mouthY: number): ShaftCarve {
  const grid = shaftGrid(mouthY);
  const { dir } = boreDirection(dig);
  const vertical = isFloorMounted(dir);
  const cells: Carved[] = [];

  // Half-width in whole cells, at least one either side of the axis, so the narrowest bore
  // the campaign authors still comes out two cells across — the KD-9's own gauge.
  const halfCells = Math.max(1, Math.round(dig.halfWidth / SHAFT_CELL));
  const alongCells = Math.max(1, Math.round(dig.depth / SHAFT_CELL));
  const axisCol = grid.colAt(snapToColumn(dig.x));

  for (let s = 0; s < alongCells; s++) {
    for (let k = -halfCells; k < halfCells; k++) {
      if (vertical) {
        // Straight down: `s` is the row, `k` steps across columns. The `+ k` runs from
        // `-halfCells` to `halfCells - 1` so an even width straddles the axis evenly rather
        // than coming out a cell wider on one side.
        cells.push({ col: axisCol + k, row: s });
      } else {
        // Straight in: `s` steps along x from the mouth, `k` across rows.
        cells.push({ col: axisCol + Math.sign(dir.x) * s, row: k + halfCells });
      }
    }
  }
  return carveOf(grid, cells);
}
