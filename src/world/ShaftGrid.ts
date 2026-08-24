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
 * An excavation drawn as characters: `0` is rock taken out, `x` is rock left in.
 *
 * The campaign authors the shape of a dig rather than a generator producing one, and that
 * is a deliberate trade. A generator has to *prove* that three landing pads end up
 * reachable, with clearance, on every seed the game can roll — a property you can only
 * ever sample. Authored cells make the same question a set of assertions over data, which
 * is why the invariants in `Missions.test.ts` can be exhaustive instead of representative.
 *
 * Whitespace is stripped rather than significant. A leading space would silently shift
 * every cell on its row one column east, and YAML block scalars are exactly the place that
 * kind of edit happens by accident — so rock is spelled, never implied.
 *
 * Column 0 here is the left edge of the drawing, not a world column. Nothing downstream
 * ever sees these coordinates: `anchorCells` moves the whole shape onto the mouth before
 * it becomes a carve. That is what lets you add three characters of rock to the left of a
 * drawing without moving the excavation an inch.
 */
export function parseCells(art: string): Carved[] {
  const cells: Carved[] = [];
  const lines = art.split('\n').map((l) => l.replace(/\s+/g, ''));
  // A trailing newline is what a YAML block scalar always ends with, and an empty row is
  // not a row of rock — dropping it here keeps `rowHi` honest.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  for (let row = 0; row < lines.length; row++) {
    for (let col = 0; col < lines[row].length; col++) {
      const c = lines[row][col];
      if (c === '0') cells.push({ col, row });
      else if (c !== 'x') {
        throw new Error(`excavation art: unexpected "${c}" at row ${row}, column ${col}`);
      }
    }
  }
  return cells;
}

/**
 * The contiguous run of carved cells on row 0 — the mouth the excavation opens through.
 *
 * The drawing anchors on its own entrance rather than on an authored origin column, so
 * placement stays where placement already lives (`anchorToWall`, `snapToColumn`) and the
 * art is purely a shape. The alternative was an explicit `col0`, which is one number that
 * can silently disagree with the picture beside it.
 *
 * **Exactly one run, and it must be on row 0.** Two runs would be two mouths with no way
 * to say which one anchors, and a drawing whose top row is solid has no entrance at all.
 * Both are rejected here rather than resolved by a rule nobody would remember.
 */
export function mouthRun(cells: Carved[]): { lo: number; hi: number } {
  const top = cells.filter((c) => c.row === 0).map((c) => c.col).sort((a, b) => a - b);
  if (top.length === 0) throw new Error('excavation art: row 0 is solid, so there is no mouth');
  for (let i = 1; i < top.length; i++) {
    if (top[i] !== top[i - 1] + 1) {
      throw new Error(`excavation art: row 0 has two mouths, at ${top[i - 1]} and ${top[i]}`);
    }
  }
  return { lo: top[0], hi: top[top.length - 1] };
}

/**
 * Moves a drawing onto the grid so its mouth straddles `mouthCol`.
 *
 * An even-width mouth cannot be centred on a column, so it is placed the same way
 * `carveFromDig` places an even bore: the run starts half its width to the west, which
 * puts `mouthCol` on the eastern of the two centre cells. Consistency with the rasteriser
 * is what lets an authored drawing replace a tube without the shaft moving six units.
 */
export function anchorCells(cells: Carved[], mouthCol: number): Carved[] {
  const { lo, hi } = mouthRun(cells);
  const width = hi - lo + 1;
  const shift = mouthCol - lo - Math.floor(width / 2);
  return cells.map((c) => ({ col: c.col + shift, row: c.row }));
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

  // A drawn excavation is used as drawn, anchored on the mouth the ledger resolved. The
  // rasteriser below is only for digs the campaign still describes as tubes.
  if (dig.cells) {
    return carveOf(grid, anchorCells(dig.cells, grid.colAt(snapToColumn(dig.x))));
  }

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
