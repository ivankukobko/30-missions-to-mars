import { describe, expect, it } from 'vitest';
import { MISSIONS, PROLOGUE, airframeFor } from './Missions.ts';
import { flyMission, type FlightOutcome } from '../testing/flyMission.ts';

/**
 * The campaign flown, on the real physics, by one pilot that flies the same way every
 * time.
 *
 * `FuelBudget` bounds what a mission *costs*; this measures what a run *scores*, which is
 * the number the balance question is actually about. The pilot is not good — it is
 * consistent, which is the property that matters: any difference between two missions is
 * a difference in the missions.
 *
 * **It lands 20 of 29.** The nine it does not are the pads whose approach is not vertical
 * — `shaft-gallery` is reached by descending the bore and turning west — and flying those
 * needs a path follower rather than the descend-and-translate profile here. They are
 * excluded rather than pretended about; see `FlightOptions.followRoute`.
 *
 * `COLONY_REPORT=1` prints the table. See `npm run pilot:report`.
 */
const REPORT =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.COLONY_REPORT === '1';

const SEED = 12345;

/**
 * Missions the reference profile cannot fly, by measurement rather than by assumption.
 *
 * Every one of them is a delivery whose approach bends: the four gallery runs go down the
 * shaft and turn, and the crest decks sit against a wall the route climbs around. A pilot
 * that descends a column arrives through whatever is beside it.
 */
const NEEDS_PATH_FOLLOWING = new Set([2, 7, 10, 13, 14, 18, 21, 25, 28]);

const flown = new Map<number, FlightOutcome>();
function fly(id: number): FlightOutcome {
  const hit = flown.get(id);
  if (hit) return hit;
  const outcome = flyMission(MISSIONS.find((m) => m.id === id)!, SEED);
  flown.set(id, outcome);
  return outcome;
}

const REACHABLE = MISSIONS.filter((m) => !NEEDS_PATH_FOLLOWING.has(m.id));

describe('a consistent pilot flying the whole campaign', () => {
  it('lands every mission whose approach is a straight descent', { timeout: 300000 }, () => {
    for (const mission of REACHABLE) {
      const outcome = fly(mission.id);
      if (REPORT && outcome.kind === 'landed') {
        console.log(
          `m${String(mission.id).padStart(2)} ${airframeFor(mission).padEnd(7)} ` +
            `fuel ${(outcome.score.fuelPct * 100).toFixed(0).padStart(3)}%  ` +
            `${outcome.score.touchdownSpeed.toFixed(2)} u/s  ` +
            `off ${outcome.score.offset.toFixed(1).padStart(4)}  ` +
            `${String(outcome.score.points).padStart(3)} pts  ${outcome.score.rank}`,
        );
      }
      expect(
        outcome.kind === 'landed' && outcome.onTarget,
        `mission ${mission.id}: ${JSON.stringify(outcome)}`,
      ).toBe(true);
    }
  });

  /**
   * **The finding this exists for.** The same flying used to score 64 to 78 — a
   * fourteen-point spread straddling the A/B boundary at 66, so which mission you were on
   * moved you across a rank by itself, with the deep hauler runs at the bottom exactly as
   * `FuelBudget` predicted from the unavoidable share.
   *
   * Correcting `fuelScale` and raising sixteen tanks closed it to 67-78: eleven points,
   * entirely above the A cut, and what is left of it is mostly the pilot rather than the
   * mission — mission 27 scores lowest on 76% fuel because it arrives at 1.46 u/s and 2.1
   * off centre, which is the score working correctly.
   */
  it('does not let the score spread between missions widen', { timeout: 300000 }, () => {
    /**
     * The prologue is left out. It is scored on open ground with no centring term at all,
     * on a tank deliberately extravagant enough that it carries no fuel gauge — it comes
     * out at 85 and is not measuring the same thing as a delivery.
     */
    const points = REACHABLE.filter((m) => m.id !== PROLOGUE.id).map((m) => {
      const outcome = fly(m.id);
      return outcome.kind === 'landed' ? outcome.score.points : 0;
    });
    const spread = Math.max(...points) - Math.min(...points);
    if (REPORT) {
      console.log(
        `\nreference pilot: ${Math.min(...points)}-${Math.max(...points)} points, ` +
          `spread ${spread} across ${points.length} missions`,
      );
    }
    expect(spread).toBeLessThanOrEqual(13);
  });

  /** Nobody should be able to make a delivery unflyable without this going red. */
  it('never runs a tank dry on a mission it can reach', { timeout: 300000 }, () => {
    for (const mission of REACHABLE) {
      const outcome = fly(mission.id);
      if (outcome.kind !== 'landed') continue;
      expect(outcome.score.fuelPct, `mission ${mission.id}`).toBeGreaterThan(0.2);
    }
  });
});
