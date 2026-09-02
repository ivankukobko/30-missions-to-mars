import { describe, expect, it } from 'vitest';
import { MISSIONS, airframeFor, PROLOGUE } from './Missions.ts';
import { budgetFor, type FuelBudget } from './FuelBudget.ts';
import { builtCanyon } from '../testing/canyonFixture.ts';

/**
 * How much of each tank the mission spends on itself, before anybody flies it.
 *
 * Fuel is 60 to 70 of the 100 points a landing is scored on, so `fuelRemaining /
 * fuelCapacity` is very nearly the rank — which makes the size of a tank against what the
 * run unavoidably costs the strongest balance lever in the game. It was twenty-nine
 * numbers typed by hand with nothing measuring them.
 *
 * `COLONY_REPORT=1` prints the table these are drawn from; see `npm run fuel:report`.
 */
const REPORT =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.COLONY_REPORT === '1';

const SEEDS = [0, 12345, 631729407];

/**
 * The worst case across seeds — terrain moves the pads, so a tank has to cover all of them.
 *
 * Memoised: four assertions each want every mission, and each mission means three canyon
 * builds. Without it this file alone was forty seconds, which is longer than the whole
 * suite.
 */
const measured = new Map<number, FuelBudget>();

function worstCase(missionId: number): FuelBudget {
  const hit = measured.get(missionId);
  if (hit) return hit;
  const computed = computeWorstCase(missionId);
  measured.set(missionId, computed);
  return computed;
}

function computeWorstCase(missionId: number): FuelBudget {
  const mission = MISSIONS.find((m) => m.id === missionId)!;
  let worst: FuelBudget | null = null;
  for (const seed of SEEDS) {
    const { canyon, world } = builtCanyon(seed, mission.id);
    const pad = world.props.find((p) => p.kind === 'pad' && p.id === mission.target);
    const targetY =
      pad && pad.kind === 'pad'
        ? (pad.y ?? canyon.heightAt(pad.x, 0, true) + 1.3)
        : canyon.heightAt(mission.start.x, 0, true);
    const targetX = pad && pad.kind === 'pad' ? pad.x : mission.start.x;
    const budget = budgetFor(mission, targetY, targetX);
    if (!worst || budget.minimumFuel > worst.minimumFuel) worst = budget;
  }
  return worst!;
}

/** The prologue is deliberately extravagant and ungauged — it has no fuel readout at all. */
const SCORED = MISSIONS.filter((m) => m.id !== PROLOGUE.id);

describe('every mission can actually be flown', () => {
  it('leaves real discretionary fuel on top of what physics demands', () => {
    for (const mission of SCORED) {
      const budget = worstCase(mission.id);
      if (REPORT) {
        console.log(
          `m${String(mission.id).padStart(2)} ${airframeFor(mission).padEnd(7)} ` +
            `cap ${String(budget.capacity).padStart(4)}  ` +
            `descent ${budget.descentFuel.toFixed(0).padStart(3)}  ` +
            `crossing ${budget.crossingFuel.toFixed(0).padStart(3)}  ` +
            `unavoidable ${(budget.unavoidable * 100).toFixed(0).padStart(2)}%  ` +
            `hover ${budget.hoverSeconds.toFixed(0).padStart(3)}s`,
        );
      }
      /**
       * Half the tank, which is a floor rather than a target. A mission whose unavoidable
       * cost passed this would be one where the *optimal* profile — a profile no player
       * flies — already spends most of the fuel, and the fuel term of the score would
       * have almost no range left to report anything with.
       */
      expect(
        budget.unavoidable,
        `mission ${mission.id} spends ${(budget.unavoidable * 100).toFixed(0)}% of its tank just arriving`,
      ).toBeLessThan(0.5);
    }
  });

  /** Enough time to think, on the mission with the least of it. */
  it('buys at least half a minute of hovering on every mission', () => {
    for (const mission of SCORED) {
      expect(worstCase(mission.id).hoverSeconds, `mission ${mission.id}`).toBeGreaterThan(30);
    }
  });
});

describe('the same flying should score the same on every mission', () => {
  /**
   * **A ratchet, not an endorsement.** The spread is about 30 points today — 15% of the
   * tank unavoidable on mission 2 against 45% on mission 13 — and that is too wide: waste
   * the same *share* of your discretionary fuel on both and you land with 50% in one tank
   * and 30% in the other, which is a rank boundary for identical piloting.
   *
   * This is pinned at slightly above where it stands so that it cannot quietly get worse
   * while the real fix is decided. The fix is a decision about what the margin curve
   * across the campaign should be, which is a design question and not this test's to make.
   */
  it('does not let the margin spread widen further', () => {
    const shares = SCORED.map((m) => worstCase(m.id).unavoidable);
    const spread = Math.max(...shares) - Math.min(...shares);
    if (REPORT) {
      console.log(
        `\nunavoidable share: min ${(Math.min(...shares) * 100).toFixed(0)}%  ` +
          `max ${(Math.max(...shares) * 100).toFixed(0)}%  ` +
          `spread ${(spread * 100).toFixed(0)} points`,
      );
    }
    expect(spread).toBeLessThan(0.32);
  });

  /**
   * The hauler is charged twice for the same thing: it burns `11/cos 30°` ≈ 12.7 a second
   * against the lander's 11 for identical lift, *and* carries `fuelScale: 0.9`. That is
   * most of why its missions cluster at the tight end of the spread and the lander's at
   * the loose end, and it is worth pinning as a known shape rather than rediscovering.
   */
  it('still shows the hauler paying more per unit of lift than the lander', () => {
    const byFrame = (id: string) =>
      SCORED.filter((m) => airframeFor(m) === id).map((m) => worstCase(m.id).unavoidable);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    expect(mean(byFrame('hauler'))).toBeGreaterThan(mean(byFrame('lander')));
  });
});
