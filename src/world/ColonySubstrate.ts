import { clamp01 } from './Noise.ts';
import type { Lattice } from './ColonyLattice.ts';

/**
 * What each cell of the lattice is made of, measured from the real per-seed terrain
 * after `canyon.build()` — the terrain-first half of "generate the landscape, fit a
 * lattice to it, then grow on what's there."
 *
 * The model this replaces asked one question, "is this cell off-limits", which is all a
 * mass extruded upward from an anchor ever needed to know. A mycelium needs the opposite
 * fact as well: **where the rock is**, because a filament creeps *along* a surface. The
 * absence of that idea is the whole reason nothing could ever cling to a wall.
 *
 *   - `solid`  — real terrain covers the cell (>50% by area, the same coverage test the
 *                old availability mask used, kept because it was the part that worked).
 *   - `surface`— open air touching rock. The growable skin: canyon floor, wall faces,
 *                terrace benches, a dig's shoulder.
 *   - `open`   — air with no rock adjacency. Reachable only by building out from
 *                something already standing.
 */
export type Substrate = 'solid' | 'surface' | 'open';

/** `heightAt(x, 0)` for many `x` with the z=0 row resolved once — see
 *  `CanyonGenerator.sampleFloorRow`. The only terrain call this module makes. */
export interface SubstrateTerrain {
  sampleFloorRow(xs: number[], includeDigs?: boolean): number[];
}

export interface SubstrateField {
  at(col: number, row: number): Substrate;
  /** Out of bounds counts as solid: a column nobody measured is not verified open air.
   *  The old mask learned this the hard way — it returned "available" outside its own
   *  sampled range, and an anchor search walked 240 units past the far canyon wall onto
   *  ground that had never been looked at. */
  isSolid(col: number, row: number): boolean;
}

/** Samples across a cell's width, as fractions of `cellSize` so the rule survives a
 *  different cell size rather than being quietly calibrated to 12. */
const SAMPLES = [-0.5, -0.25, 0, 0.25, 0.5];

export function buildSubstrate(terrain: SubstrateTerrain, lattice: Lattice): SubstrateField {
  const { cellSize, colLo, colHi, rows } = lattice;

  // One row derivation, then a few hundred cheap samples — not one row derivation per
  // cell, which is what naive per-x `heightAt` calls would cost.
  const xs: number[] = [];
  for (let col = colLo; col <= colHi; col++) {
    for (const frac of SAMPLES) xs.push(lattice.worldX(col) + frac * cellSize);
  }
  /**
   * **The natural canyon, excavations excluded.** Two reasons, and the second is the one
   * that forced it:
   *
   * A colony has no business growing inside a bore — that volume is the shaft's own
   * geometry and its own colliders, and the route down it is reserved airspace anyway.
   *
   * More importantly, sampling the *excavated* canyon makes the substrate change every
   * time the campaign digs, and `ColonyPlan` replays the whole campaign's growth on each
   * load. Replaying history against present terrain means history itself changes: on seed
   * 7 the mission-15 shaft altered the ground near x=60 enough to flip a race Ixion had
   * won for fourteen missions, and twelve of its cells came back as Kessler's instead.
   * Nothing was demolished — the cells were simply never built, by a colony recomputing a
   * past it no longer had. Excavations only ever *remove* rock, so ignoring them makes
   * the substrate a pure function of the seed, the replay identical every mission, and
   * growth strictly additive.
   */
  const heights = terrain.sampleFloorRow(xs, false);

  const solid = new Uint8Array(lattice.cols * rows);
  for (let col = colLo; col <= colHi; col++) {
    const off = (col - colLo) * SAMPLES.length;
    for (let row = 0; row < rows; row++) {
      const yLo = lattice.worldY(row) - cellSize / 2;
      let covered = 0;
      for (let s = 0; s < SAMPLES.length; s++) covered += clamp01((heights[off + s] - yLo) / cellSize);
      if (covered / SAMPLES.length > 0.5) solid[lattice.index(col, row)] = 1;
    }
  }

  const isSolid = (col: number, row: number): boolean => {
    // Below row 0 is beneath the canyon's own lowest floor point, so it is rock
    // everywhere by construction — which is also what makes every open row-0 cell a
    // surface cell without a special case for "resting on the ground".
    if (row < 0) return true;
    if (!lattice.inBounds(col, row)) return true;
    return solid[lattice.index(col, row)] === 1;
  };

  return {
    isSolid,
    at(col, row) {
      if (isSolid(col, row)) return 'solid';
      const touching =
        isSolid(col, row - 1) || isSolid(col, row + 1) || isSolid(col - 1, row) || isSolid(col + 1, row);
      return touching ? 'surface' : 'open';
    },
  };
}
