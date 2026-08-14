import { describe, it, expect } from 'vitest';
import { buildLattice, type Lattice } from './ColonyLattice.ts';
import { growColony, LINK, type OrganismCell, type Spore } from './ColonyOrganism.ts';
import type { SubstrateField } from './ColonySubstrate.ts';
import type { CorpId } from './CanyonSpec.ts';

/**
 * The organism against a hand-built substrate rather than real terrain — deliberately,
 * because the properties worth pinning here (determinism, no floating cells, nothing in
 * reserved airspace, growth that only ever extends) are all independent of what any
 * particular seed's canyon looks like, and a synthetic substrate makes each of them a
 * one-line setup instead of a canyon build. `ColonyPlan.test.ts` is where real terrain
 * comes in.
 */

function lattice(rows = 12): Lattice {
  return buildLattice({ lowestFloorY: () => 0, canyonWidthAt: () => ({ west: -120, east: 120 }) }, 12, rows);
}

/** Flat ground: rock below row 0, open air above it. */
function flat(): SubstrateField {
  const isSolid = (_col: number, row: number): boolean => row < 0;
  return { isSolid, at: (col, row) => (isSolid(col, row) ? 'solid' : row === 0 ? 'surface' : 'open') };
}

/** Flat ground with a vertical cliff at and beyond `wallCol` — the case wall-clinging
 *  exists for, and the one the previous model could not express at all. */
function cliff(wallCol: number): SubstrateField {
  const isSolid = (col: number, row: number): boolean => row < 0 || col >= wallCol;
  return {
    isSolid,
    at: (col, row) => {
      if (isSolid(col, row)) return 'solid';
      const touching = isSolid(col, row - 1) || isSolid(col, row + 1) || isSolid(col - 1, row) || isSolid(col + 1, row);
      return touching ? 'surface' : 'open';
    },
  };
}

function grow(
  options: {
    substrate?: SubstrateField;
    spores?: Spore[];
    budget?: Partial<Record<CorpId, number>>;
    forbidden?: (col: number, row: number) => boolean;
    seed?: number;
    rows?: number;
  } = {},
): { cells: Map<number, OrganismCell>; lattice: Lattice } {
  const grid = lattice(options.rows);
  const cells = growColony({
    lattice: grid,
    substrate: options.substrate ?? flat(),
    forbidden: options.forbidden ?? (() => false),
    spores: options.spores ?? [{ corp: 'outpost', col: 0, row: 0 }],
    budget: { outpost: 40, helion: 40, kessler: 40, ...options.budget },
    attractors: {},
    seed: options.seed ?? 7,
  });
  return { cells, lattice: grid };
}

describe('determinism', () => {
  it('produces an identical colony from identical inputs', () => {
    const a = grow();
    const b = grow();

    expect([...a.cells.entries()]).toEqual([...b.cells.entries()]);
  });

  it('produces a different colony from a different seed', () => {
    const a = grow({ seed: 1 });
    const b = grow({ seed: 2 });

    expect([...a.cells.keys()]).not.toEqual([...b.cells.keys()]);
  });
});

describe('reserved airspace', () => {
  it('never builds in a forbidden cell, whatever the seed', () => {
    // A vertical slab through the middle of the colony's reach, which is the shape a
    // flight channel actually takes.
    const forbidden = (_r: number, col: number): boolean => Math.abs(col - 3) <= 1;
    for (let seed = 0; seed < 40; seed++) {
      const { cells, lattice: grid } = grow({ seed, forbidden: (col, row) => forbidden(row, col) });
      for (const index of cells.keys()) {
        expect(Math.abs(grid.colOf(index) - 3), `seed ${seed}`).toBeGreaterThan(1);
      }
    }
  });

  /**
   * A channel ends up walled on both sides, which is what makes a descent read as
   * threaded rather than merely bounded — but *not* because one colony grows around it.
   * A filament moves cell by cell and a channel is forbidden, so it genuinely cannot
   * cross one, and it should not be able to: crossing would mean a walkway drawn through
   * the airspace the whole model exists to keep clear. Both sides get walled because
   * both sides have a colony of their own, which in the real canyon is exactly the
   * arrangement — Helion west, Kessler east, the routes between them.
   */
  it('walls a reserved channel from both sides, one colony each', () => {
    const { cells, lattice: grid } = grow({
      spores: [
        { corp: 'helion', col: -4, row: 0 },
        { corp: 'kessler', col: 4, row: 0 },
      ],
      forbidden: (col) => col === 0,
    });
    const cols = [...cells.keys()].map((i) => grid.colOf(i));

    expect(cols.some((c) => c < 0)).toBe(true);
    expect(cols.some((c) => c > 0)).toBe(true);
    expect(cols.some((c) => c === 0)).toBe(false);
  });
});

describe('nothing floats', () => {
  /**
   * Support is a bounded *reach*, not a binary — a cell may cantilever up to
   * `MAX_CANTILEVER` bays from real load-bearing before it needs a leg, which is the rule
   * that lets an arm leave a strand sideways instead of every colony growing as a pole.
   * Asserted the way the model actually defines it: walk back from each cell toward
   * something that carries load and check the walk is short.
   */
  it('keeps every cell within a short reach of something that carries load', () => {
    for (let seed = 0; seed < 25; seed++) {
      const { cells, lattice: grid } = grow({ seed, substrate: cliff(5) });
      const substrate = cliff(5);
      const DIRS = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const;
      // Breadth-first from every genuinely grounded cell; nothing may be more than
      // `MAX_CANTILEVER` steps away through occupied cells.
      const MAX_CANTILEVER = 2;
      const depth = new Map<number, number>();
      const queue: number[] = [];
      for (const index of cells.keys()) {
        const col = grid.colOf(index);
        const row = grid.rowOf(index);
        const grounded =
          substrate.isSolid(col, row - 1) ||
          cells.has(grid.index(col, row - 1)) ||
          DIRS.some(([dc, dr]) => substrate.isSolid(col + dc, row + dr));
        if (grounded) {
          depth.set(index, 0);
          queue.push(index);
        }
      }
      for (let i = 0; i < queue.length; i++) {
        const index = queue[i];
        const col = grid.colOf(index);
        const row = grid.rowOf(index);
        for (const [dc, dr] of DIRS) {
          if (!grid.inBounds(col + dc, row + dr)) continue;
          const n = grid.index(col + dc, row + dr);
          if (!cells.has(n) || depth.has(n)) continue;
          depth.set(n, depth.get(index)! + 1);
          queue.push(n);
        }
      }
      for (const index of cells.keys()) {
        expect(
          depth.get(index),
          `seed ${seed} cell ${grid.colOf(index)},${grid.rowOf(index)} is unsupported`,
        ).toBeLessThanOrEqual(MAX_CANTILEVER);
      }
    }
  });
});

describe('growth order is the campaign clock', () => {
  /**
   * The property the whole maturity model rests on: a later mission runs the same
   * sequence further, so what a colony built by mission 8 is still exactly there at
   * mission 30 — it never re-rolls into a different shape. Asserted as set inclusion
   * *and* identical build order, because either alone would pass a model that quietly
   * rebuilt the same cells in a different sequence.
   */
  it('extends an earlier colony rather than regrowing it', () => {
    for (let seed = 0; seed < 20; seed++) {
      const early = grow({ seed, budget: { outpost: 12 } });
      const late = grow({ seed, budget: { outpost: 45 } });

      expect(late.cells.size, `seed ${seed}`).toBeGreaterThanOrEqual(early.cells.size);
      for (const [index, cell] of early.cells) {
        expect(late.cells.get(index)?.order, `seed ${seed} cell ${index}`).toBe(cell.order);
      }
    }
  });
});

describe('climbing', () => {
  it('creeps up a rock face instead of only spreading along the floor', () => {
    const { cells, lattice: grid } = grow({ substrate: cliff(4), spores: [{ corp: 'outpost', col: 3, row: 0 }] });
    const highest = Math.max(...[...cells.keys()].map((i) => grid.rowOf(i)));

    expect(highest).toBeGreaterThan(1);
  });

  it('stops short of cresting the rim, however hard the apex pulls', () => {
    /**
     * The measured failure this pins: before the height cost and the score floor, a
     * filament that touched a wall climbed every remaining row, because "up" was the only
     * legal move and the model always took the best legal one.
     *
     * The bound is deliberately loose — two rows, not six. `W_APEX` exists to pull growth
     * toward the top centre of the lattice, so climbing high is now the intent rather than
     * the bug; what must not happen is a colony reaching the lattice ceiling, which is the
     * canyon rim. This case is the hardest one for that: a bare cliff, no pads pulling the
     * colony back down to its own hardware, and budget to spare.
     */
    for (let seed = 0; seed < 20; seed++) {
      const rows = 20;
      const { cells, lattice: grid } = grow({
        seed,
        rows,
        substrate: cliff(4),
        spores: [{ corp: 'outpost', col: 3, row: 0 }],
        budget: { outpost: 90 },
      });
      const highest = Math.max(...[...cells.keys()].map((i) => grid.rowOf(i)));

      expect(highest, `seed ${seed}`).toBeLessThan(rows - 1);
    }
  });
});

describe('three organisms, one canyon', () => {
  it('never gives one cell to two corps', () => {
    const { cells } = grow({
      spores: [
        { corp: 'helion', col: -6, row: 0 },
        { corp: 'outpost', col: 0, row: 0 },
        { corp: 'kessler', col: 6, row: 0 },
      ],
    });

    // A Map cannot hold two values at one key, so the real assertion is that every corp
    // actually got somewhere — a "no overlap" that holds because two of them built
    // nothing would be worthless.
    const corps = new Set([...cells.values()].map((c) => c.corp));
    expect(corps.size).toBe(3);
  });

  it('links only ever join two cells of the same corp, in both directions', () => {
    const { cells, lattice: grid } = grow({
      spores: [
        { corp: 'helion', col: -3, row: 0 },
        { corp: 'kessler', col: 3, row: 0 },
      ],
    });

    for (const [index, cell] of cells) {
      const col = grid.colOf(index);
      const row = grid.rowOf(index);
      for (const [link, back, dc, dr] of [
        [LINK.east, LINK.west, 1, 0],
        [LINK.west, LINK.east, -1, 0],
        [LINK.up, LINK.down, 0, 1],
        [LINK.down, LINK.up, 0, -1],
      ] as const) {
        if ((cell.links & link) === 0) continue;
        const other = cells.get(grid.index(col + dc, row + dr));
        expect(other, `cell ${col},${row} links to nothing`).toBeDefined();
        expect(other!.corp).toBe(cell.corp);
        expect(other!.links & back).toBeTruthy();
      }
    }
  });
});
