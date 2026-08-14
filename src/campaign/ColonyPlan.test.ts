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
          expect(colony.cells.length, `${colony.corp} mission ${id} seed ${seed}`).toBeGreaterThanOrEqual(id === 1 ? 1 : 10);
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
 * **A colony only ever loses ground to a flight route, and only where that route now is.**
 *
 * This is the invariant that replaced "a colony never shrinks", and the replacement was a
 * deliberate trade. Never-shrinking was structural once, bought by rasterising the whole
 * campaign's route network from mission one so the forbidden set could never grow — and
 * paid for with a canyon that was thirty percent keep-out before the second delivery, for
 * approaches nobody had flown. Nothing is reserved before it exists now (`planColonies`),
 * so a new pad's approach genuinely demolishes what stood in it.
 *
 * What still has to hold is that demolition is *lawful*: a cell that was there last
 * mission is either still there, or the reason it is gone is visible in the world — rock,
 * or a channel. A colony that quietly relocated, or lost cells nowhere near a route, fails
 * this exactly as it failed the old one. That is the failure this has always been about:
 * Ixion losing all sixteen cells at mission 2 on seed 12345 and rebuilding elsewhere.
 *
 * Terrain is rebuilt per mission rather than shared, because that is what the game does
 * and because it is the one thing that could break this from outside the growth model: a
 * new mission levels a bench under each new pad, and raising ground under a standing
 * colony turns a cell to rock. That is why rock counts as a lawful cause here and not only
 * a channel.
 *
 * **Every mission, not a handful of checkpoints**, and the difference is not thoroughness.
 * A route is no longer fixed once laid: routes join whichever way is already climbing, so
 * a pad added this mission can re-lay the trunk and the ways that fed it move with it —
 * ground is released as well as taken. Sampling every fifth mission then reports a cell
 * taken by a corridor at 17 as "lost to nothing" at 19, because by 19 the corridor has
 * moved on. Consecutive missions are the only interval where the route that took a cell is
 * still the route standing there.
 */
describe('a colony only loses ground to a route', () => {
  // One seed rather than two: this rebuilds a canyon per mission, which is the expensive
  // half, and the every-mission sweep below covers three seeds against shared terrain.
  for (const seed of [12345]) {
    it(`seed ${seed}: every cell lost is a cell a channel or rock now occupies`, { timeout: 300000 }, () => {
      const seen = new Map<string, Set<string>>();
      for (let id = 1; id <= MISSIONS.length; id++) {
        const { colonies, network, lattice, substrate } = plan(id, seed);
        for (const colony of colonies) {
          const now = new Set(colony.cells.map((c) => `${c.x},${c.y}`));
          for (const cell of seen.get(colony.corp) ?? []) {
            if (now.has(cell)) continue;
            const [x, y] = cell.split(',').map(Number);
            const col = lattice.colAt(x);
            const row = lattice.rowAt(y);
            expect(
              network.blocked(col, row) || substrate.isSolid(col, row),
              `${colony.corp} lost cell ${cell} by mission ${id} on seed ${seed} to nothing`,
            ).toBe(true);
          }
          seen.set(colony.corp, now);
        }
        // A corp that had a colony must still have one. A route can take cells; it can
        // never take a charter's whole presence in the canyon.
        for (const corp of seen.keys()) {
          const first = MISSIONS.find((m) => m.client === corp)!;
          if (first.id > id) continue;
          expect(
            colonies.some((c) => c.corp === corp),
            `${corp} vanished by mission ${id} on seed ${seed}`,
          ).toBe(true);
        }
      }
    });
  }
});

/**
 * The same rule, for every consecutive mission pair rather than a handful of checkpoints.
 *
 * Cheap enough to run all thirty because growth no longer depends on how much of the
 * canyon has been excavated — the substrate is sampled from the natural rock
 * (`ColonySubstrate.ts`) and the ground is graded for the whole campaign at once
 * (`campaignPadSites`), so one canyon per seed is the same terrain every mission grows
 * against in game. That equivalence is not assumed here: the checkpoint suite above
 * rebuilds terrain per mission and asserts the same thing, which is what would catch it if
 * the two ever diverged.
 */
describe('demolition is lawful on every mission pair', () => {
  for (const seed of [1, 7, 12345]) {
    it(`seed ${seed}: no cell disappears without a channel in it`, { timeout: 120000 }, () => {
      const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
      const worlds = missionWorlds(0, null, canyon);
      canyon.build(worlds(MISSIONS.length).digs, campaignPadSites(worlds));

      const seen = new Map<string, Set<string>>();
      for (const m of MISSIONS) {
        const { colonies, network, lattice, substrate } = planColonies(m.id, worlds, {}, seed, canyon);
        for (const corp of seen.keys()) {
          expect(
            colonies.some((c) => c.corp === corp),
            `${corp} vanished at mission ${m.id}`,
          ).toBe(true);
        }
        for (const colony of colonies) {
          const now = new Set(colony.cells.map((c) => `${c.x},${c.y}`));
          for (const cell of seen.get(colony.corp) ?? []) {
            if (now.has(cell)) continue;
            const [x, y] = cell.split(',').map(Number);
            const col = lattice.colAt(x);
            const row = lattice.rowAt(y);
            expect(
              network.blocked(col, row) || substrate.isSolid(col, row),
              `${colony.corp} lost cell ${cell} at mission ${m.id} to nothing`,
            ).toBe(true);
          }
          expect(now.size, `${colony.corp} at mission ${m.id}`).toBeGreaterThanOrEqual(1);
          seen.set(colony.corp, now);
        }
      }
    });
  }
});

/**
 * **Shrink has to be reproducible, which is the whole reason it is allowed at all.**
 *
 * A colony losing cells to a new approach is a legitimate campaign event. A colony losing
 * *different* cells when the player retries the mission is not — it is the one kind of
 * unfairness a player cannot argue with, because the world they crashed into is not the
 * world they get back. Planning the same mission twice must produce byte-identical
 * colonies, demolitions included.
 *
 * Missions 19 and 20 are chosen deliberately: Helion's cavern opens at 19 and Kessler's
 * ledge at 20, so both are missions where the route network genuinely grows.
 */
describe('a replayed mission replays its demolitions', () => {
  for (const seed of [1, 12345]) {
    it(`seed ${seed}: planning the same mission twice is identical`, { timeout: 120000 }, () => {
      const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
      const worlds = missionWorlds(0, null, canyon);
      canyon.build(worlds(MISSIONS.length).digs, campaignPadSites(worlds));

      for (const id of [19, 20, 30]) {
        const a = planColonies(id, worlds, {}, seed, canyon).colonies;
        const b = planColonies(id, worlds, {}, seed, canyon).colonies;
        expect(b, `mission ${id} on seed ${seed}`).toEqual(a);
      }
    });
  }
});
