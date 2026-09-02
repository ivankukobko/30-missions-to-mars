import { describe, expect, it } from 'vitest';
import { MISSIONS } from './Missions.ts';
import { planColonies } from './ColonyPlan.ts';
import { builtCanyon } from '../testing/canyonFixture.ts';
import { COLONY_CELL_SIZE } from '../world/ColonyLattice.ts';
import type { CorpId } from '../world/CanyonSpec.ts';

/**
 * What the campaign's *pacing* looks like, as opposed to whether it is legal.
 *
 * `ColonyPlan.test.ts` asserts the rules a colony may never break — nothing in a channel,
 * nothing floating, nothing lost except to a route. Everything here is about whether the
 * result is any good to play: does the canyon actually close in as the player is told it
 * does, does flying well buy anything visible, and is a deck the player lands on standing
 * on something.
 *
 * All three went unmeasured for a long time and all three were wrong. The colony was
 * static across thirteen missions of the middle campaign, every existing test planned at
 * zero points so the entire scored half of growth was unexercised, and the raised decks
 * were floating on 61% of the missions they stood.
 *
 * **Set `COLONY_REPORT=1` to print the tables** these assertions are drawn from, rather
 * than only the failures. That is the tuning loop: change a coefficient in `ColonyPlan`,
 * run this, read the shape of the campaign off the output.
 */
const REPORT =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.COLONY_REPORT === '1';

/** Kept small on purpose — each entry is a canyon build. `builtCanyon` caches per seed. */
const SEEDS = [0, 1, 12345, 631729407];

function scoresAt(points: number): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const m of MISSIONS) scores[String(m.id)] = points;
  return scores;
}

/**
 * Memoised on everything it reads. Planning mission 29 walks all twenty-nine missions
 * forward, so it is the expensive call in this file, and the assertions below ask for the
 * same `(id, seed, points)` from several directions — the campaign-shape sweep and the
 * rank-comparison both want mission 29 at zero points.
 */
const measured = new Map<string, Record<CorpId, number>>();

function sizes(id: number, seed: number, points: number): Record<CorpId, number> {
  const key = `${id}:${seed}:${points}`;
  const hit = measured.get(key);
  if (hit) return hit;
  const { canyon, worlds } = builtCanyon(seed, id);
  const plan = planColonies(id, worlds, scoresAt(points), seed, canyon);
  const by = { outpost: 0, helion: 0, kessler: 0 } as Record<CorpId, number>;
  for (const c of plan.colonies) by[c.corp] = c.cells.length;
  measured.set(key, by);
  return by;
}

describe('the canyon closes in as the campaign runs', () => {
  /**
   * The promise mission 8 makes in so many words — "the gap you fly closes a little more
   * each mission. It will keep closing" — measured against what the canyon actually does.
   *
   * It did not, for thirteen missions. `colonyBudget` was being used as a floor on
   * missions 6 and 7 to get stack under a crest deck, `cellBudget` then dropped a
   * charter's *second* mission back to `FIRST_MISSION_CELLS`, and because growth never
   * removes cells the colony simply sat at the floor until the formula caught up eight
   * missions later. Total cells across all three corps at C-rank went 92 at mission 8 and
   * 91 at mission 20.
   */
  it('grows the settlement across every stretch of the campaign', () => {
    /**
     * Eight missions apart, not four, and the difference is a real campaign event rather
     * than slack in the test. A mission that opens a new approach demolishes whatever
     * stood in it, and over a short window that can cancel everything the same window
     * built — measured on seed 631729407, where mission 15's shaft deck took back exactly
     * what missions 13 to 16 put up and the total sat at 68 either side.
     *
     * Eight missions is still far tighter than the failure this exists to catch, which
     * was thirteen consecutive missions of a canyon that did not move at all.
     */
    const checkpoints = [8, 16, 24, 29];
    for (const seed of SEEDS) {
      const totals = checkpoints.map((id) => {
        const by = sizes(id, seed, 0);
        return by.outpost + by.helion + by.kessler;
      });
      if (REPORT) {
        const fine = [8, 12, 16, 20, 24, 29].map((id) => {
          const by = sizes(id, seed, 0);
          return `m${id}=${by.outpost + by.helion + by.kessler}`;
        });
        console.log(`seed ${seed}: ${fine.join(' ')}`);
      }
      for (let i = 1; i < totals.length; i++) {
        expect(
          totals[i],
          `seed ${seed}: mission ${checkpoints[i - 1]} had ${totals[i - 1]} cells, mission ${checkpoints[i]} has ${totals[i]}`,
        ).toBeGreaterThan(totals[i - 1]);
      }
    }
  });

  /**
   * A charter's colony moves on that charter's own missions.
   *
   * Frozen missions are excluded because they are the deliberate exception — the
   * injunction at 9 and 10 delivers the cargo and builds nothing with it, and that dent
   * is meant to be visible for the rest of the campaign. Mission 2 is excluded because
   * its `colonyBudget` is a deliberate cap holding the canyon unclaimed for the run that
   * plants the radar.
   */
  it('moves a charter on its own missions', () => {
    for (const seed of [0, 12345]) {
      const previous: Partial<Record<CorpId, number>> = {};
      for (const mission of MISSIONS) {
        const by = sizes(mission.id, seed, 0);
        const corp = mission.client;
        const before = previous[corp];
        const frozen = (mission.colonyFrozen ?? []).includes(corp);
        if (before !== undefined && !frozen && mission.colonyBudget?.[corp] === undefined) {
          expect(
            by[corp],
            `seed ${seed}: ${corp} flew mission ${mission.id} and built nothing (${before} cells before and after)`,
          ).toBeGreaterThan(before);
        }
        for (const c of Object.keys(by) as CorpId[]) previous[c] = by[c];
      }
    }
  });
});

describe('flying well is visible in the canyon', () => {
  /**
   * The entire scored half of growth — `PER_POINT_CELLS`, worth up to about a third of a
   * colony — had no test at all: every case in the suite planned with an empty score
   * record, so a change that disconnected points from growth would have gone unnoticed.
   */
  it('builds more for a campaign flown well than for one scraped through', () => {
    for (const seed of SEEDS) {
      const scraped = sizes(29, seed, 0);
      const flawless = sizes(29, seed, 100);
      const low = scraped.outpost + scraped.helion + scraped.kessler;
      const high = flawless.outpost + flawless.helion + flawless.kessler;
      if (REPORT) console.log(`seed ${seed}: C-rank ${low} cells, S-rank ${high} (+${(((high - low) / low) * 100).toFixed(0)}%)`);
      expect(high, `seed ${seed}`).toBeGreaterThan(low * 1.2);
      for (const corp of Object.keys(scraped) as CorpId[]) {
        expect(flawless[corp], `seed ${seed} ${corp}`).toBeGreaterThanOrEqual(scraped[corp]);
      }
    }
  });

  /** Points may never *cost* a charter ground, at any point in the campaign. */
  it('never shrinks a colony for scoring better', () => {
    for (const id of [8, 16, 22, 29]) {
      for (const seed of [0, 12345]) {
        const low = sizes(id, seed, 0);
        const high = sizes(id, seed, 100);
        for (const corp of Object.keys(low) as CorpId[]) {
          expect(high[corp], `mission ${id} seed ${seed} ${corp}`).toBeGreaterThanOrEqual(low[corp]);
        }
      }
    }
  });
});

describe('nothing the player lands on is floating', () => {
  /**
   * Every raised deck is held up by its own charter's structure — from below, or from
   * alongside within a cell, which is how a room bracketed off a wall reads.
   *
   * This was 39% when it was first measured, over 208 deck-missions on eight seeds, and
   * the two causes were separate. Growth had no obligation to reach a deck at all, only a
   * gravity term leaning it that way; and the crest decks were authored at a fixed x that
   * the seed moves the canyon out from under — on seed 0 Helion's deck sat thirty units
   * clear of Helion's entire colony, where no growth rule could ever have reached it.
   * `spine` fixed the first and `xFromWall` the second.
   */
  it('stands every raised deck on its own charter', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      for (let id = 6; id <= 20; id++) {
        const { canyon, worlds, world } = builtCanyon(seed, id);
        const plan = planColonies(id, worlds, {}, seed, canyon);
        for (const p of world.props) {
          if (p.kind !== 'pad' || p.y === undefined || p.attachToDig !== undefined) continue;
          checked++;
          const own = plan.colonies.find((c) => c.corp === p.corp);
          const half = p.width / 2;
          const held = (own?.cells ?? []).some((cell) => {
            const clear = Math.max(0, Math.abs(cell.x - p.x) - half - COLONY_CELL_SIZE / 2);
            const rise = cell.y - p.y!;
            const under = clear === 0 && rise <= 1 && rise >= -COLONY_CELL_SIZE * 1.5;
            const beside = clear > 0 && clear <= COLONY_CELL_SIZE && Math.abs(rise) <= COLONY_CELL_SIZE;
            return under || beside;
          });
          expect(held, `seed ${seed} mission ${id}: ${p.id} at (${p.x}, ${p.y}) has no ${p.corp} structure holding it up`).toBe(true);
        }
      }
    }
    expect(checked, 'no raised decks were examined — the sweep is looking in the wrong place').toBeGreaterThan(100);
  });
});
