import { describe, expect, it } from 'vitest';
import { MISSIONS, airframeFor, PROLOGUE } from './Missions.ts';
import { scoreLanding } from './Progress.ts';
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
    const budget = budgetFor(
      mission,
      targetY,
      targetX,
      pad && pad.kind === 'pad' ? pad.width / 2 : null,
    );
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

describe('every rank is arithmetically reachable', () => {
  /**
   * **The ceiling of a mission, which is not the same question as its cost.**
   *
   * A flawless arrival — the optimal brake, the optimal crossing, a 0.6 u/s kiss dead
   * centre — banks the whole 25 for softness and the whole 15 for centring. So an S at 82
   * needs `fuelPct` of at least 0.70, which means the mission's unavoidable cost has to
   * come in under 30% of the tank. If it does not, no pilot reaches S there. Ever.
   *
   * Measured before this was fixed: **S was unreachable on fourteen of the twenty-eight
   * scored missions**, and they were precisely the manoeuvre-heavy charter runs — every
   * hauler mission but one among them. Most of it was `fuelScale` charging the hauler
   * twice for its canted engines; the rest was sixteen tanks that were simply too small
   * for what the run costs.
   *
   * This is the invariant that stops it coming back. It is deliberately about what is
   * *possible* rather than what is likely: whether an S is hard is a tuning question for
   * playtests, but whether it exists at all is arithmetic, and arithmetic can be asserted.
   */
  function ceilingFor(missionId: number) {
    const mission = MISSIONS.find((m) => m.id === missionId)!;
    const budget = worstCase(missionId);
    // The pad this mission delivers to, for the centring term's denominator.
    const half = mission.target === null ? null : budget.padHalfWidth;
    return scoreLanding(budget.capacity - budget.minimumFuel, budget.capacity, 0.6, 0, half);
  }

  it('leaves an S on the table for a flawless flight, on every mission', () => {
    for (const mission of SCORED) {
      const ceiling = ceilingFor(mission.id);
      if (REPORT) {
        console.log(
          `m${String(mission.id).padStart(2)} ${airframeFor(mission).padEnd(7)} ceiling ` +
            `${String(ceiling.points).padStart(3)} pts ${ceiling.rank}`,
        );
      }
      expect(
        ceiling.rank,
        `mission ${mission.id} tops out at ${ceiling.points} points — an S is not reachable there at all`,
      ).toBe('S');
    }
  });

  /** And an A should be comfortable, not a ceiling anybody is scraping. */
  it('leaves an A well clear of the ceiling everywhere', () => {
    for (const mission of SCORED) {
      expect(ceilingFor(mission.id).points, `mission ${mission.id}`).toBeGreaterThan(66 + 10);
    }
  });
});

describe('the same flying should score the same on every mission', () => {
  /**
   * **A ratchet.** It was 27 points — 15% of the tank unavoidable on mission 2 against
   * 42% on mission 13 — which meant wasting the same *share* of your discretionary fuel
   * on both left you with 50% in one tank and 30% in the other: a rank boundary, for
   * identical piloting.
   *
   * Correcting `fuelScale` against each frame's burn rate and raising sixteen tanks
   * brought it to 11. Pinned just above that so it cannot quietly widen again. Closing it
   * further is a tuning question for playtests rather than an arithmetic one.
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
    expect(spread).toBeLessThan(0.14);
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
