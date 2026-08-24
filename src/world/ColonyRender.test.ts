import { describe, it, expect } from 'vitest';
import { colonyRuns } from './ColonyRender.ts';
import { LINK, TRAIT, type PlacedCell } from './ColonyOrganism.ts';

const SIZE = 12;

/** A built, ground-touching cell — the only kind that may merge. Links are supplied by the
 *  caller because whether two neighbours are *joined* is the whole question. */
function cell(col: number, row: number, links: number, over: Partial<PlacedCell> = {}): PlacedCell {
  return {
    x: col * SIZE,
    y: row * SIZE,
    z: 0,
    links,
    scaffold: false,
    traits: TRAIT.grounded,
    // Standing on rock, as the doc comment above says every fixture here does.
    reach: 0,
    ...over,
  };
}

/** A joined west-to-east row, the shape a lying pipe is made of. */
function row(cols: number[], rowIndex = 0, over: Partial<PlacedCell> = {}): PlacedCell[] {
  return cols.map((c, i) =>
    cell(c, rowIndex, (i > 0 ? LINK.west : 0) | (i < cols.length - 1 ? LINK.east : 0), over),
  );
}

/** A joined bottom-to-top column, the shape a standing pipe is made of. */
function column(rows: number[], colIndex = 0, over: Partial<PlacedCell> = {}): PlacedCell[] {
  return rows.map((r, i) =>
    cell(colIndex, r, (i > 0 ? LINK.down : 0) | (i < rows.length - 1 ? LINK.up : 0), over),
  );
}

const shape = (runs: ReturnType<typeof colonyRuns>): string =>
  runs.map((r) => `${r.axis}${r.cells.length}`).join(' ');

describe('colonyRuns', () => {
  it('merges a joined, grounded column into one standing vessel', () => {
    expect(shape(colonyRuns(column([0, 1, 2]), SIZE))).toBe('y3');
  });

  it('merges a joined row into one lying vessel', () => {
    expect(shape(colonyRuns(row([0, 1, 2]), SIZE))).toBe('x3');
  });

  /**
   * The priority rule, and the reason two axes need one at all. These four cells are joined
   * every way, so they are two standing pipes or two lying ones and nothing in the geometry
   * prefers either — the choice has to be made here or the same cell is drawn twice. Vertical
   * wins because that is the silhouette the colony is short of.
   */
  it('prefers vertical when a block could go either way', () => {
    const all = LINK.east | LINK.west | LINK.up | LINK.down;
    const block = [cell(0, 0, all), cell(1, 0, all), cell(0, 1, all), cell(1, 1, all)];
    expect(shape(colonyRuns(block, SIZE))).toBe('y2 y2');
  });

  /**
   * The safety property everything else rests on. The vessel is drawn over a run while the
   * colliders stay per-cell, so a run that dropped a cell would leave a collider with nothing
   * drawn on it, and one that listed a cell twice would draw two hulls over one. Neither is
   * visible on screen — both are lethal to fly into.
   */
  it('partitions the cells exactly, whatever the input contains', () => {
    const cells = [
      ...row([0, 1, 2, 3, 4, 5]),
      ...column([2, 3, 4], 8),
      cell(9, 2, 0),
      cell(4, 3, LINK.east, { scaffold: true }),
      cell(5, 3, LINK.west),
    ];
    const flat = colonyRuns(cells, SIZE).flatMap((r) => r.cells);
    expect(flat).toHaveLength(cells.length);
    expect(new Set(flat).size).toBe(cells.length);
    for (const c of cells) expect(flat).toContain(c);
  });

  it('never exceeds the four-cell bound', () => {
    expect(shape(colonyRuns(column([0, 1, 2, 3, 4, 5, 6, 7, 8]), SIZE))).toBe('y4 y4 y1');
  });

  it('does not merge across a gap', () => {
    expect(shape(colonyRuns([...column([0, 1]), ...column([4, 5])], SIZE))).toBe('y2 y2');
  });

  /**
   * Adjacency is not enough. Two filaments that grew separately and happen to meet are two
   * vessels sharing a wall; the link mask is the only surviving record of which of the two
   * happened, and merging on position alone would erase it.
   */
  it('does not merge neighbours that are not joined', () => {
    expect(shape(colonyRuns([cell(0, 0, 0), cell(0, 1, 0)], SIZE))).toBe('y1 y1');
  });

  it('leaves scaffold and cantilevered cells unmerged', () => {
    expect(shape(colonyRuns(column([0, 1, 2], 0, { scaffold: true }), SIZE))).toBe('y1 y1 y1');
    expect(shape(colonyRuns(column([0, 1, 2], 0, { traits: 0 }), SIZE))).toBe('y1 y1 y1');
  });

  it('does not merge across columns', () => {
    expect(shape(colonyRuns([...column([0, 1]), ...column([0, 1], 1)], SIZE))).toBe('y2 y2');
  });

  /**
   * The greedy scan is only deterministic if its input order is, and `ColonyPlan`'s emission
   * order is not this module's to depend on — it sorts by x first today, which would make
   * this correct by coincidence. A colony that merged differently on a retry is the same
   * unfairness a shifting demolition would be.
   */
  it('is independent of the order cells arrive in', () => {
    const cells = [...column([0, 1, 2, 3, 4]), ...row([1, 2], 7), cell(7, 0, 0)];
    const identity = (input: PlacedCell[]): string =>
      colonyRuns(input, SIZE)
        .map((r) => `${r.axis}:${r.cells.map((c) => `${c.x}/${c.y}`).join('+')}`)
        .join(' ');

    const forwards = identity(cells);
    expect(identity([...cells].reverse())).toBe(forwards);
    // A fixed, arbitrary shuffle rather than a random one, so a failure is reproducible.
    expect(identity([cells[3], cells[0], cells[6], cells[5], cells[2], cells[7], cells[1], cells[4]])).toBe(
      forwards,
    );
  });
});
