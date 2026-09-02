import * as THREE from 'three';
import { CanyonGenerator } from '../world/CanyonGenerator.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { campaignPadSites, missionWorlds, type MissionWorld } from '../campaign/ColonyPlan.ts';

/**
 * A built canyon, shared between tests that only read it.
 *
 * A canyon build is ~450 ms and dominates the whole suite: `ColonyPlan.test.ts` alone
 * was 29 s of a 31 s run, and one test inside it — the every-mission demolition sweep —
 * was 14 s of that, because it rebuilt terrain twenty-nine times, once per mission.
 *
 * **It is the digs that make a mission's terrain, not the mission id.** Excavations are
 * carved into the heightfield, so mission 3's canyon and mission 24's really are
 * different landscapes on the same seed and the sweep is right to rebuild. But the
 * campaign only ever reaches five distinct dig states — nothing, Ixion's working, then
 * the shaft at 58, 172 and 303 — so twenty-nine ids collapse onto five builds. Keying on
 * the dig signature keeps every test looking at exactly the terrain it was looking at
 * before, and skips the twenty-four rebuilds that produced a heightfield already in hand.
 *
 * One generator per seed rather than one per build. `missionWorlds` memoises against the
 * generator it was handed, and its resolution is safe to reuse across builds for the
 * reason its own doc comment gives: `resolveTerrainAnchoredDigs` reads only `floorEdgeAt`
 * and `heightAt`, which are pure functions of the seed rather than of anything `build()`
 * sets up. So the worlds are stable while the heightfield underneath them is rebuilt.
 *
 * **Read-only by contract, and rebuilt in place.** The returned generator is shared, and
 * a later call with a different signature rebuilds *that same object* — so a test must
 * finish with it before the next one asks. That holds because tests within a file run
 * sequentially. Anything that writes to the canyon's `PhysicsWorld`, disposes it, or
 * needs to hold it across an await must call `freshCanyon` instead.
 */
export interface CanyonFixture {
  canyon: CanyonGenerator;
  worlds: (id: number) => MissionWorld;
}

interface Entry extends CanyonFixture {
  /** The dig signature the heightfield currently carries, or null before the first build. */
  builtFor: string | null;
}

const perSeed = new Map<number, Entry>();

/** An unshared generator, for a test that writes to the physics world or disposes it. */
export function freshCanyon(seed: number): CanyonFixture {
  const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
  return { canyon, worlds: missionWorlds(0, null, canyon) };
}

/**
 * The canyon as it stands for one mission, built if this seed's generator is not already
 * carrying that exact terrain.
 *
 * The pad sites are campaign-wide and so never part of the signature — `campaignPadSites`
 * grades every ground-resting deck the campaign will ever have, on every mission, which
 * is the whole reason growth can be strictly additive. See its own doc comment.
 */
export function builtCanyon(seed: number, id: number): CanyonFixture & { world: MissionWorld } {
  let entry = perSeed.get(seed);
  if (!entry) {
    entry = { ...freshCanyon(seed), builtFor: null };
    perSeed.set(seed, entry);
  }

  const world = entry.worlds(id);
  const signature = world.digs
    .map((d) => `${d.x.toFixed(1)}:${d.depth.toFixed(1)}`)
    .sort()
    .join('|');

  if (entry.builtFor !== signature) {
    entry.canyon.build(world.digs, campaignPadSites(entry.worlds));
    entry.builtFor = signature;
  }

  return { canyon: entry.canyon, worlds: entry.worlds, world };
}
