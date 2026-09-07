import { CanyonGenerator, mergeDigs, type Excavation } from '../world/CanyonGenerator.ts';
import { FRONT_Z, BACK_Z } from '../world/AntFarm.ts';
import { SHAFT_CELL, carveFromDig, type ShaftCarve } from '../world/ShaftGrid.ts';
import { boreDirection, isFloorMounted } from '../world/Shaft.ts';
import { COLONY_CELL_SIZE } from '../world/ColonyLattice.ts';
import type { CorpId } from '../world/CanyonSpec.ts';
import type { Prop } from '../world/Colony.ts';
import { MISSIONS } from '../campaign/Missions.ts';
import { planColonies } from '../campaign/ColonyPlan.ts';
import { builtCanyon } from './canyonFixture.ts';

/**
 * What the canyon has become by each mission, as numbers rather than as a screenshot.
 *
 * The excavation and the settlement are the two things in this game that *change across
 * the campaign*, and the only way to judge either used to be to fly to it. That is a bad
 * loop for exactly the questions worth asking about them — how much rock came out this
 * mission, how far a deck sits from the end of the passage it stands in, whether the hole
 * grows at a rate a player would notice — because those are all quantities, and a
 * screenshot can only ever say "looks about right". `ColonyBalance.test.ts` measures the
 * settlement's *size* and nothing measured the hole at all, so the excavation's shape has
 * been judged by eye for its whole life.
 *
 * Measurement only, and deliberately: nothing here decides anything or feeds the game. It
 * reads the same pipeline `Game.loadMission` runs — `missionWorlds` for the resolved
 * ledger, `carveFromDig` for the cells, `planColonies` for the settlement — and reports
 * what it finds. A number out of this file is therefore a fact about the shipping world
 * rather than about a model of it, which is the only thing worth tuning against.
 *
 * Lives in `testing/` with `flyMission` and `Autopilot` for the same reason those do: it
 * is a harness that reads the game, and the game must never read it.
 */

/**
 * How deep a corridor runs into the rock, derived from the two planes `AntFarm` already
 * publishes rather than authored a second time here.
 *
 * A volume computed from a hand-copied 12 would be right until somebody moved
 * `CORRIDOR_DEPTH`, and then it would be wrong quietly and forever — the class of error
 * the house rule about deriving a dimension rather than authoring it exists to close.
 */
const CORRIDOR_DEPTH = FRONT_Z - BACK_Z;

/** Rock taken out per carved cell: a cell square in section, driven `CORRIDOR_DEPTH` into
 *  the face. The unit every spoil figure below is counted in. */
export const ROCK_PER_CELL = SHAFT_CELL * SHAFT_CELL * CORRIDOR_DEPTH;

/** Contiguous carved cells in each direction from a cell, not counting the cell itself. */
export interface OpenRoom {
  above: number;
  below: number;
  west: number;
  east: number;
}

export interface DeckMeasure {
  id: string;
  corp: CorpId;
  x: number;
  y: number;
  /** The drawing cell it was authored into, when it names one — the author's coordinates,
   *  carried only so a report can point at the line that produced the row. */
  cell: { col: number; row: number } | null;
  /** How far below the mouth the deck stands. The number the briefs quote. */
  depthBelowMouth: number;
  open: OpenRoom;
  /**
   * How many of the deck's four neighbours are carved.
   *
   * `1` is a deck at the blind end of a passage. It is the cheapest single number for "is
   * this a place on a route or the face where the digging stopped", and a complex whose
   * every destination scores 1 is a set of tubes cut to hold pads rather than a mine
   * somebody drove and then landed in.
   */
  neighbours: number;
  /** Rock either side at the deck's own height — the reading the shaft gauge takes. */
  clearWest: number;
  clearEast: number;
}

export interface ExcavationMeasure {
  mouthX: number;
  mouthY: number;
  cells: number;
  colLo: number;
  colHi: number;
  rowLo: number;
  rowHi: number;
  /** Mouth down to the floor of the deepest carved row — what a brief means by "depth". */
  depth: number;
  /** Volume of rock taken out, cumulative across the campaign so far. */
  rockRemoved: number;
  /**
   * Carved cells with exactly one carved neighbour.
   *
   * A real working has them — a face is one — but each is a place the digging stopped, so
   * the count and *where* they are is most of what says whether a complex is being worked
   * or was cut to a finished plan.
   */
  blindEnds: number;
  /** The widest run of carved cells on any single row, in cells. */
  widestRun: number;
  /** Rows holding more than one carved cell: galleries rather than plain bore. */
  galleryRows: number;
}

export interface GrowthStep {
  mission: number;
  /** The sol it flies on, so a rate can be read against the fiction's own clock rather
   *  than against mission number, which is not time. */
  sol: number;
  colony: Record<CorpId, number>;
  colonyTotal: number;
  /** Cells the settlement gained, or lost to a route that opened this mission. */
  colonyDelta: number;
  excavation: ExcavationMeasure | null;
  /** Rock taken out *this* mission — the spoil `docs/lore.md` records as missing. */
  spoil: number;
  /** Every deck standing inside the excavation this mission. */
  decks: DeckMeasure[];
  target: { id: string; inExcavation: boolean } | null;
}

export interface GrowthOptions {
  /** Last mission to walk to. Defaults to the whole campaign. */
  through?: number;
  /**
   * Points earned per mission, as `Progress` records them.
   *
   * Growth is scored, so the campaign a good pilot builds is not the one a bad pilot
   * builds and a report that does not say which it measured is not saying much. Defaults
   * to zero everywhere — the floor case, and the same default `ColonyBalance` reports at.
   */
  scores?: Readonly<Record<string, number>>;
}

/** Where a dig's mouth sits, by exactly the rule `CanyonGenerator.build` uses to carve
 *  it. Duplicating the *choice* rather than the arithmetic: both sides call the same two
 *  public methods, so the two can disagree only if this line is edited alone. */
function mouthYOf(dig: Excavation, canyon: CanyonGenerator): number {
  return isFloorMounted(boreDirection(dig).dir) ? canyon.heightAt(dig.x, 0) : canyon.wallMouthY(dig);
}

function neighbourCount(carve: ShaftCarve, col: number, row: number): number {
  let n = 0;
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (carve.has(col + dc, row + dr)) n++;
  }
  return n;
}

function openRun(carve: ShaftCarve, col: number, row: number, dc: number, dr: number): number {
  let n = 0;
  while (carve.has(col + dc * (n + 1), row + dr * (n + 1))) n++;
  return n;
}

/**
 * The excavation standing at a mission, measured on the cells the game actually carves.
 *
 * `carveFromDig` at `mouthYOf` is the same call `CanyonGenerator.build` makes with the
 * same mouth, so these are the cells the player flies down rather than a second reading of
 * the drawing that could quietly disagree with them.
 */
export function measureExcavation(dig: Excavation, canyon: CanyonGenerator): ExcavationMeasure {
  const mouthY = mouthYOf(dig, canyon);
  const carve = carveFromDig(dig, mouthY);
  const g = carve.grid;

  let blindEnds = 0;
  for (const cell of carve.cells) {
    if (neighbourCount(carve, cell.col, cell.row) === 1) blindEnds++;
  }

  let widestRun = 0;
  let galleryRows = 0;
  for (let row = carve.rowLo; row <= carve.rowHi; row++) {
    let run = 0;
    let onRow = 0;
    // One column past the end so a run that reaches `colHi` is closed by the loop rather
    // than needing its own case after it.
    for (let col = carve.colLo; col <= carve.colHi + 1; col++) {
      if (carve.has(col, row)) {
        run++;
        onRow++;
      } else {
        widestRun = Math.max(widestRun, run);
        run = 0;
      }
    }
    if (onRow > 1) galleryRows++;
  }

  return {
    mouthX: dig.x,
    mouthY,
    cells: carve.cells.length,
    colLo: carve.colLo,
    colHi: carve.colHi,
    rowLo: carve.rowLo,
    rowHi: carve.rowHi,
    // The floor of the deepest row, not its centre — that is the surface a deck rests on
    // and the number a brief is quoting when it says three hundred metres of hole.
    depth: mouthY - (g.worldY(carve.rowHi) - SHAFT_CELL / 2),
    rockRemoved: carve.cells.length * ROCK_PER_CELL,
    blindEnds,
    widestRun,
    galleryRows,
  };
}

/**
 * The decks standing inside an excavation, located by the cell they actually occupy.
 *
 * The cell is recovered from the deck's **resolved world position** rather than read off
 * its authored `atCell`, and the difference is the point: `atCell` is in the drawing's own
 * coordinates, which `anchorCells` then shifts onto the mouth. Asking the grid where the
 * deck ended up asks the same question the geometry answers, so a resolution fault shows
 * up here as a deck in no carved cell at all — where reading the author's intention back
 * out would paper over exactly that.
 */
export function measureDecks(props: Prop[], dig: Excavation, canyon: CanyonGenerator): DeckMeasure[] {
  const mouthY = mouthYOf(dig, canyon);
  const carve = carveFromDig(dig, mouthY);
  const g = carve.grid;
  const out: DeckMeasure[] = [];

  for (const p of props) {
    if (p.kind !== 'pad' || p.y === undefined) continue;
    const col = g.colAt(p.x);
    const row = g.rowAt(p.y);
    if (!carve.has(col, row)) continue;

    const west = openRun(carve, col, row, -1, 0);
    const east = openRun(carve, col, row, 1, 0);
    out.push({
      id: p.id,
      corp: p.corp,
      x: p.x,
      y: p.y,
      cell: p.atCell ?? null,
      depthBelowMouth: mouthY - p.y,
      open: {
        above: openRun(carve, col, row, 0, -1),
        below: openRun(carve, col, row, 0, 1),
        west,
        east,
      },
      neighbours: neighbourCount(carve, col, row),
      clearWest: p.x - (g.worldX(col - west) - SHAFT_CELL / 2),
      clearEast: g.worldX(col + east) + SHAFT_CELL / 2 - p.x,
    });
  }
  return out.sort((a, b) => a.depthBelowMouth - b.depthBelowMouth);
}

/**
 * The whole campaign walked once, measured at every mission.
 *
 * **One colony walk, not one per mission.** `planColonies` grows forward from mission 1
 * whatever you ask it for, so twenty-nine separate calls would spend 435 growth steps
 * producing exactly what one call reports through `onMission` — bit-identical, because the
 * pipeline is deterministic end to end. The terrain behind it is rebuilt only when the
 * digs change it, which over this campaign is five times rather than twenty-nine;
 * `builtCanyon` owns that caching and this reuses it rather than repeating it.
 */
export function simulateGrowth(seed: number, options: GrowthOptions = {}): GrowthStep[] {
  const through = options.through ?? MISSIONS.length;
  const scores = options.scores ?? {};

  const colonyAt = new Map<number, Record<CorpId, number>>();
  {
    // Any mission's fixture carries the same `worlds` resolver and the same generator; the
    // walk only needs the resolver, and `planColonies` reads terrain through pure
    // seed-derived functions (see `missionWorlds`) rather than through the built mesh.
    const { canyon, worlds } = builtCanyon(seed, through);
    planColonies(through, worlds, scores, seed, canyon, (m, cells) => {
      const by = { outpost: 0, helion: 0, kessler: 0 } as Record<CorpId, number>;
      for (const cell of cells.values()) by[cell.corp]++;
      colonyAt.set(m, by);
    });
  }

  const steps: GrowthStep[] = [];
  let lastRock = 0;
  let lastColony = 0;

  for (let m = 1; m <= through; m++) {
    /**
     * Rebuilt per mission through the fixture, which no-ops unless this mission's digs
     * differ from the terrain it is already carrying. It matters that this is that
     * mission's terrain: a floor-mounted mouth is sampled off the heightfield, and the
     * heightfield is what the digs cut — so measuring mission 24's shaft against mission
     * 3's ground puts its mouth several units out and every depth below it with it.
     */
    const { canyon, world } = builtCanyon(seed, m);

    /**
     * **Merged first, exactly as `CanyonGenerator.build` merges.**
     *
     * `world.digs` is the ledger's own records — five of them by mission 24, one per stage
     * that widened the hole — and index 0 is Ixion's opening cut. Reading that one
     * reported a three-cell working at depth 24 for all twenty-nine missions, on every
     * seed: the campaign's whole excavation arc, flat. `mergeDigs` is what collapses the
     * stages into the single hole the game carves, and its last-drawing-wins rule is the
     * only thing that knows a later stage supersedes an earlier one's picture.
     *
     * One excavation out the far side, which the campaign asserts (`Missions.test.ts`).
     * Taking the first of *those* keeps every number below about **the** hole — a total
     * over two would move for reasons a reader of the table cannot see.
     */
    const dig = mergeDigs(world.digs)[0] ?? null;
    const excavation = dig ? measureExcavation(dig, canyon) : null;
    const decks = dig ? measureDecks(world.props, dig, canyon) : [];

    const colony = colonyAt.get(m) ?? { outpost: 0, helion: 0, kessler: 0 };
    const colonyTotal = colony.outpost + colony.helion + colony.kessler;
    const rock = excavation?.rockRemoved ?? 0;

    const mission = MISSIONS.find((x) => x.id === m);
    const target = mission?.target ?? null;

    steps.push({
      mission: m,
      sol: mission?.sol ?? 0,
      colony,
      colonyTotal,
      colonyDelta: colonyTotal - lastColony,
      excavation,
      spoil: rock - lastRock,
      decks,
      target: target ? { id: target, inExcavation: decks.some((d) => d.id === target) } : null,
    });

    lastRock = rock;
    lastColony = colonyTotal;
  }

  return steps;
}

/**
 * The campaign as two fixed-width tables — one row per mission, then one row per deck.
 *
 * Fixed-width rather than CSV because the reader is a person scanning for a shape: does
 * the hole grow steadily, does the settlement stall for a stretch, is every deck's `nb` a
 * 1. **A column that reads the same all the way down is the finding**, and that is a thing
 * you see in a monospaced block and not in a spreadsheet you have to open.
 */
export function formatGrowth(steps: GrowthStep[], seed: number): string {
  const out: string[] = [];
  out.push(
    `seed ${seed} — ${COLONY_CELL_SIZE}-unit grid, corridor ${CORRIDOR_DEPTH} deep, ${ROCK_PER_CELL} of rock per carved cell`,
  );
  out.push('');
  out.push('  m   sol   cells   depth  widest  gallery  blind      spoil   colony  ix/he/ke     Δ');
  for (const s of steps) {
    const e = s.excavation;
    const n = (v: number | string | null, w: number): string => String(v ?? '·').padStart(w);
    out.push(
      [
        n(s.mission, 3),
        n(s.sol, 6),
        n(e?.cells ?? null, 8),
        n(e ? e.depth.toFixed(0) : null, 8),
        n(e?.widestRun ?? null, 8),
        n(e?.galleryRows ?? null, 9),
        n(e?.blindEnds ?? null, 7),
        n(s.spoil ? s.spoil.toFixed(0) : null, 11),
        n(s.colonyTotal, 9),
        `  ${s.colony.outpost}/${s.colony.helion}/${s.colony.kessler}`.padEnd(12),
        n(s.colonyDelta >= 0 ? `+${s.colonyDelta}` : s.colonyDelta, 4),
      ].join(''),
    );
  }

  out.push('');
  out.push('decks inside the excavation — nb counts carved neighbours of four, so 1 is a blind end');
  out.push('  m  deck             corp     depth   nb   up  down  west  east    clear W/E');
  for (const s of steps) {
    for (const d of s.decks) {
      out.push(
        [
          String(s.mission).padStart(3),
          `  ${d.id}${s.target?.id === d.id ? ' ←' : ''}`.padEnd(19),
          d.corp.padEnd(8),
          d.depthBelowMouth.toFixed(0).padStart(6),
          String(d.neighbours).padStart(5),
          String(d.open.above).padStart(5),
          String(d.open.below).padStart(6),
          String(d.open.west).padStart(6),
          String(d.open.east).padStart(6),
          `${d.clearWest.toFixed(1)} / ${d.clearEast.toFixed(1)}`.padStart(13),
        ].join(''),
      );
    }
  }
  return out.join('\n');
}
