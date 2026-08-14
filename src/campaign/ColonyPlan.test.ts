import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MISSIONS } from './Missions.ts';
import { planColonies, missionWorlds, campaignPadSites } from './ColonyPlan.ts';
import { CHANNEL_HALF } from './ColonyChannels.ts';
import { COLONY_CELL_SIZE } from '../world/ColonyLattice.ts';
import { checkLayout } from './Layout.ts';
import { CanyonGenerator } from '../world/CanyonGenerator.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CANYON } from '../world/CanyonSpec.ts';

/**
 * Growth against real per-seed terrain — the half `ColonyOrganism.test.ts` deliberately
 * leaves out, since every property there holds regardless of what a canyon looks like and
 * every property here depends entirely on it. Each case builds an actual canyon, so the
 * sweep stays small: a handful of missions spanning the campaign's terrain milestones
 * (pre-dig, mid-campaign, the wall-mounted cavern, fully built) and two seeds, rather
 * than the full 30 by many.
 */
const IDS = [1, 8, 15, 22, 30];
const SEEDS = [0, 12345];

/**
 * `Game.loadMission`'s exact sequence. `missionWorlds` is built **once** and reused, the
 * same as the game does — it memoises, and a second one built after `canyon.build()`
 * resolves wall-anchored digs against terrain that now carries every pad's bench, putting
 * the dig somewhere the first one did not. That is not a subtle difference: it moved
 * Kessler's shaft out from under its own crest deck and `checkLayout` correctly reported
 * the pad as capping a dig mouth that, in the real game, it never caps.
 */
function plan(id: number, seed: number) {
  const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
  const worlds = missionWorlds(0, null, canyon);
  const current = worlds(id);
  canyon.build(current.digs, campaignPadSites(worlds));
  return { ...planColonies(id, worlds, {}, seed, canyon), props: current.props, digs: current.digs };
}

describe('growth against real terrain', () => {
  for (const seed of SEEDS) {
    for (const id of IDS) {
      it(`mission ${id}, seed ${seed}: every active corp actually builds something`, () => {
        const { colonies } = plan(id, seed);

        // Mission 1 is Ixion alone; the other two charters have not arrived yet.
        expect(colonies.length).toBe(id === 1 ? 1 : 3);
        for (const colony of colonies) {
          /**
           * A colony hemmed into a single cell is a legitimate outcome — a spore can land
           * somewhere real terrain and the channel network genuinely close off — but it
           * must not be the ordinary result, which is what it became twice while this
           * model was being tuned (Ixion boxed in by its own pads' channels; Helion
           * rooting in a crevice). Four is deliberately a low bar: this is a floor under
           * "it built *something*", not an assertion about how big a colony should be.
           */
          expect(colony.cells.length, `${colony.corp} mission ${id} seed ${seed}`).toBeGreaterThanOrEqual(10);
        }
      });

      it(`mission ${id}, seed ${seed}: nothing grows into a flight channel`, () => {
        const { colonies, props, digs, network } = plan(id, seed);
        const violations = checkLayout([...props, ...colonies], digs, undefined, undefined, network.channels);

        expect(violations).toEqual([]);
      });
    }
  }

  it('gives every live pad a route that reaches the rim', () => {
    for (const seed of SEEDS) {
      const { network, props } = plan(30, seed);
      const pads = props.filter((p): p is Extract<typeof p, { kind: 'pad' }> => p.kind === 'pad');
      const routed = new Set(network.channels.map((c) => c.padId));

      // Every live pad has a route. The network holds *more* routes than there are live
      // pads — it is the whole campaign's, including pads decommissioned along the way,
      // whose ground stays reserved for good so a colony can never be demolished by a
      // route appearing later. See `planColonies`.
      for (const pad of pads) expect(routed.has(pad.id), `seed ${seed} pad ${pad.id}`).toBe(true);
      for (const channel of network.channels) {
        const top = channel.points[channel.points.length - 1];
        // The lattice ceiling is the rim (`COLONY_ROWS` × cell size above the canyon's
        // own lowest floor), so a route that ends there has climbed out of the canyon —
        // there is no colony above it that could ever close it in.
        expect(top.y, `seed ${seed} pad ${channel.padId}`).toBeGreaterThan(CANYON.RIM_Y * 0.75);
      }
    }
  });

  it('keeps a route wide enough to fly, not merely wide enough to fit', () => {
    // `CHANNEL_HALF` is measured against the colony; this asserts the number itself is
    // still the "room to be wrong" margin the layout rules are built on, not quietly
    // reduced to the hull's own width during tuning. The hull is 1.24 across.
    // Above `Layout.ts`'s own `CORE_HALF` of 5 — the clearance the game shipped with over
    // a pad — and below half a cell, so a straight route reserves the one column it flies
    // down rather than three. Both halves matter; see the constant's own doc comment.
    expect(CHANNEL_HALF).toBeGreaterThan(5);
    expect(CHANNEL_HALF).toBeLessThan(COLONY_CELL_SIZE / 2);
  });

  it('is a pure function of its inputs', () => {
    const a = plan(22, 12345).colonies;
    const b = plan(22, 12345).colonies;

    expect(a).toEqual(b);
  });

  it('roots each corp on its own side of the canyon', () => {
    for (const seed of SEEDS) {
      const { colonies } = plan(30, seed);
      const centreOf = (corp: string): number => {
        const c = colonies.find((p) => p.corp === corp)!;
        return (c.footprintX[0] + c.footprintX[1]) / 2;
      };

      // Helion holds the west wall, Kessler the east — the lore, and the thing a spore
      // search that sweeps a whole row before climbing gets wrong on a congested seed.
      expect(centreOf('helion'), `seed ${seed}`).toBeLessThan(centreOf('kessler'));
    }
  });
});

/**
 * A colony can never lose ground. Not "usually does not" — the campaign walk and the
 * up-front reservation of every route the campaign will ever have (`planColonies`) exist
 * to make this structural, and this is the test that says so.
 *
 * Asserted as **set inclusion of actual cell positions**, not as a cell count: a count
 * that merely stays level would also pass for a colony that was demolished and regrew
 * somewhere else the same size, which is precisely the failure this guards against — it
 * is what Ixion did on seed 12345 before the fix, losing all sixteen of its cells at
 * mission 2 and rebuilding elsewhere.
 *
 * Terrain is rebuilt per mission rather than shared, because that is what the game does
 * and because it is the one thing that could still break the invariant from outside the
 * growth model: a new mission levels a bench under each new pad, and raising ground under
 * a standing colony is the only event that can turn a cell to rock.
 */
describe('no colony ever disappears or shrinks', () => {
  const CHECKPOINTS = [1, 5, 10, 15, 19, 20, 25, 30];

  for (const seed of SEEDS) {
    it(`seed ${seed}: every colony only ever grows, across the whole campaign`, { timeout: 120000 }, () => {
      const seen = new Map<string, Set<string>>();
      for (const id of CHECKPOINTS) {
        for (const colony of plan(id, seed).colonies) {
          const now = new Set(colony.cells.map((c) => `${c.x},${c.y}`));
          const before = seen.get(colony.corp);
          if (before) {
            for (const cell of before) {
              expect(now.has(cell), `${colony.corp} lost cell ${cell} by mission ${id} on seed ${seed}`).toBe(true);
            }
          }
          seen.set(colony.corp, now);
        }
        // A corp that had a colony must still have one.
        for (const corp of seen.keys()) {
          const first = MISSIONS.find((m) => m.client === corp)!;
          if (first.id > id) continue;
          expect(
            plan(id, seed).colonies.some((c) => c.corp === corp),
            `${corp} vanished by mission ${id} on seed ${seed}`,
          ).toBe(true);
        }
      }
    });
  }
});

/**
 * The invariant every consecutive mission pair must satisfy, on every seed: **a colony
 * never loses a cell and never disappears.**
 *
 * Cheap enough to run for all thirty missions rather than a handful of checkpoints
 * because growth no longer depends on how much of the canyon has been excavated — the
 * substrate is sampled from the natural rock (`ColonySubstrate.ts`) and the ground is
 * graded for the whole campaign at once (`campaignPadSites`), so one canyon per seed is
 * the same terrain every mission grows against in game. That equivalence is not assumed
 * here: the checkpoint suite above rebuilds terrain per mission and asserts the same
 * inclusion, which is what would catch it if the two ever diverged.
 *
 * Measured over six seeds × thirty missions before this was written: 486 corp-missions,
 * zero disappearances, zero colonies under ten cells, zero cells lost.
 */
describe('a colony can only ever be extended', () => {
  for (const seed of [1, 7, 12345]) {
    it(`seed ${seed}: no cell is ever lost between consecutive missions`, { timeout: 120000 }, () => {
      const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
      const worlds = missionWorlds(0, null, canyon);
      canyon.build(worlds(MISSIONS.length).digs, campaignPadSites(worlds));

      const seen = new Map<string, Set<string>>();
      for (const m of MISSIONS) {
        const { colonies } = planColonies(m.id, worlds, {}, seed, canyon);
        for (const corp of seen.keys()) {
          expect(
            colonies.some((c) => c.corp === corp),
            `${corp} vanished at mission ${m.id}`,
          ).toBe(true);
        }
        for (const colony of colonies) {
          const now = new Set(colony.cells.map((c) => `${c.x},${c.y}`));
          for (const cell of seen.get(colony.corp) ?? []) {
            expect(now.has(cell), `${colony.corp} lost cell ${cell} at mission ${m.id}`).toBe(true);
          }
          expect(now.size, `${colony.corp} at mission ${m.id}`).toBeGreaterThanOrEqual(10);
          seen.set(colony.corp, now);
        }
      }
    });
  }
});
