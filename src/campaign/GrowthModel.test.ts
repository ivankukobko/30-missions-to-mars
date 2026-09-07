import { describe, expect, it } from 'vitest';
import { MISSIONS } from './Missions.ts';
import { simulateGrowth, formatGrowth, ROCK_PER_CELL } from '../testing/GrowthModel.ts';
import { LANDER } from '../entities/LanderBody.ts';

/**
 * The campaign's world, walked headlessly and measured.
 *
 * This is the loop that did not exist. Everything about how the excavation *reads* — the
 * rate it deepens at, where its blind ends are, how much rock it has displaced, whether a
 * deck stands on a route or at the face where the digging stopped — was judged by flying
 * to it and looking, which cannot answer any of those questions and can only say "looks
 * about right". `ColonyBalance.test.ts` does this for the settlement's size; the hole had
 * nothing.
 *
 * The assertions here are deliberately thin, and only about facts that must hold whatever
 * the excavation is later reshaped into: it never un-digs itself, its decks are in cells
 * that exist, and a deck the campaign sends you to has room for the vehicle. Nothing here
 * asserts the *current* shape is right — that is the open question, and a test that froze
 * today's answer would be the thing standing in the way of it.
 *
 * **Set `COLONY_REPORT=1` to print the tables.** See `npm run growth:report`.
 */
const REPORT =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.COLONY_REPORT === '1';

/** Kept small: each entry walks the campaign and rebuilds terrain at every dig stage. */
const SEEDS = [0, 12345, 631729407];

const walked = new Map<number, ReturnType<typeof simulateGrowth>>();
function growth(seed: number) {
  const hit = walked.get(seed);
  if (hit) return hit;
  const steps = simulateGrowth(seed);
  walked.set(seed, steps);
  return steps;
}

describe('the excavation, measured', () => {
  it('reports the campaign without a renderer', { timeout: 600000 }, () => {
    for (const seed of SEEDS) {
      const steps = growth(seed);
      expect(steps).toHaveLength(MISSIONS.length);
      if (REPORT) console.log(`\n${formatGrowth(steps, seed)}\n`);
    }
  });

  /**
   * Rock does not go back in the hole.
   *
   * The drawings are authored cumulatively — each stage draws the whole complex as it
   * stands — and this is the property that convention exists to give. Getting it wrong is
   * a single dropped `0` in a YAML block, which is invisible in the source, invisible in
   * a screenshot of any one mission, and reads in play as a passage that was there last
   * time and is not now.
   */
  it('only ever grows', { timeout: 600000 }, () => {
    for (const seed of SEEDS) {
      let previous = 0;
      for (const step of growth(seed)) {
        const cells = step.excavation?.cells ?? 0;
        expect(
          cells,
          `seed ${seed}: mission ${step.mission} carries ${cells} cells, mission ${step.mission - 1} had ${previous}`,
        ).toBeGreaterThanOrEqual(previous);
        expect(step.spoil).toBeGreaterThanOrEqual(0);
        previous = cells;
      }
    }
  });

  /**
   * Every mission that delivers into the hole delivers somewhere the hole actually is.
   *
   * `measureDecks` finds a deck by asking the grid which cell its *resolved* position
   * landed in, so a deck the campaign believes is down the shaft and that resolution put
   * in rock simply does not appear in `decks` — and its mission's `target.inExcavation`
   * comes out false. That makes this a real check on `atCell` anchoring rather than a
   * restatement of the ledger.
   */
  it('puts every in-shaft destination in a carved cell', { timeout: 600000 }, () => {
    const inShaft = new Set(['shaft-head', 'shaft-gallery', 'shaft-ledge', 'shaft-deep']);
    for (const seed of SEEDS) {
      for (const step of growth(seed)) {
        if (!step.target || !inShaft.has(step.target.id)) continue;
        expect(
          step.target.inExcavation,
          `seed ${seed}: mission ${step.mission} targets ${step.target.id}, which resolved outside the carve`,
        ).toBe(true);
      }
    }
  });

  /**
   * Room to be wrong, at every deck, on every seed.
   *
   * The hull is 1.24 across and the narrowest passage is one cell — a deck centred in it
   * has just under six units either side. Asserted at four hull radii rather than at one,
   * because "it fits" is not the bar: this is a vehicle that answers the stick slowly
   * under load, arriving at the bottom of a dark hole.
   */
  it('leaves the vehicle room at every deck it can reach', { timeout: 600000 }, () => {
    for (const seed of SEEDS) {
      for (const step of growth(seed)) {
        for (const deck of step.decks) {
          const room = Math.min(deck.clearWest, deck.clearEast);
          expect(
            room,
            `seed ${seed}: mission ${step.mission}, deck ${deck.id} has ${room.toFixed(2)} to its nearest wall`,
          ).toBeGreaterThan(LANDER.RADIUS * 4);
        }
      }
    }
  });

  /**
   * The spoil figure, stated once so it cannot be quietly lost.
   *
   * `docs/lore.md` records that the canyon shows holes with no piles, and the reason that
   * gap survived is that nobody had the number: it is one cell of rock times however many
   * cells the drawing took out, and the drawing is the only place it was written down.
   * Fixing it against the constant makes the report's spoil column mean something the next
   * reader can check rather than a figure they have to trust.
   */
  it('knows how much rock came out', { timeout: 600000 }, () => {
    for (const seed of SEEDS) {
      const last = growth(seed)[MISSIONS.length - 1];
      expect(last.excavation).not.toBeNull();
      expect(last.excavation!.rockRemoved).toBe(last.excavation!.cells * ROCK_PER_CELL);
      if (REPORT) {
        console.log(
          `seed ${seed}: ${last.excavation!.cells} cells out, ${last.excavation!.rockRemoved.toLocaleString()} of rock, none of it anywhere in the canyon`,
        );
      }
    }
  });
});
