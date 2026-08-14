import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { worldAt } from './Missions.ts';
import { planColonies, missionWorlds, campaignPadSites } from './ColonyPlan.ts';
import { checkLayout } from './Layout.ts';
import { resolveTerrainAnchoredDigs, applyDigAttachments } from './TerrainDigs.ts';
import { CanyonGenerator } from '../world/CanyonGenerator.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CANYON } from '../world/CanyonSpec.ts';
import { Shaft, boreDirection, isFloorMounted } from '../world/Shaft.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import type { Prop } from '../world/Colony.ts';

/**
 * The real pipeline, end to end, against real terrain — `Game.loadMission`'s own
 * sequence, exercised outside the renderer. Everything in `Missions.test.ts` and
 * `ColonyGeneration.test.ts` deliberately stays terrain-free or fakes it for speed;
 * this is the one place that has to build an actual canyon per case to be worth
 * anything, so it stays deliberately small — a handful of mission ids spanning the
 * campaign's real terrain milestones (pre-dig, first floor dig, the wall-mounted
 * cavern dig, the deep shaft, fully built) rather than the full 30, and two seeds
 * rather than a wide sweep. `mastX` is fixed at 0 throughout: colony geometry never
 * depends on it (only the collider-less `radar` prop does), so sweeping it here would
 * just rebuild the same terrain repeatedly for no new coverage.
 */
const IDS = [1, 15, 19, 20, 30];
const SEEDS = [0, 12345];

function runPipeline(
  id: number,
  seed: number,
): { props: Prop[]; digs: Excavation[]; violations: ReturnType<typeof checkLayout> } {
  const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
  // Built once and reused, exactly as `Game.loadMission` does — see `ColonyPlan.test.ts`
  // for what a second, post-build resolution costs.
  const worlds = missionWorlds(0, null, canyon);
  const current = worlds(id);
  canyon.build(current.digs, campaignPadSites(worlds));

  const plan = planColonies(id, worlds, {}, seed, canyon);
  const allProps = [...current.props, ...plan.colonies];
  const violations = checkLayout(allProps, current.digs, undefined, canyon, plan.network.channels);
  return { props: allProps, digs: current.digs, violations };
}

describe('the real pipeline against real terrain', () => {
  for (const seed of SEEDS) {
    for (const id of IDS) {
      it(`mission ${id}, seed ${seed}: layout is clean`, () => {
        const { violations, props } = runPipeline(id, seed);
        expect(
          violations.map((v) => `${v.rule}: ${v.prop} -> ${v.pad}: ${v.detail}`),
          `mission ${id} seed ${seed}`,
        ).toEqual([]);

        // `checkLayout` only ever compares props to *each other*, so a colony that grew
        // somewhere absurd — onto ground nobody actually sampled, the failure mode the
        // old availability mask had — trips no rule at all: there is nothing out there
        // to violate against. Checked directly instead: every cell of every colony sits
        // inside the canyon it was fitted to.
        for (const p of props) {
          if (p.kind !== 'colony') continue;
          for (const cell of p.cells) {
            expect(
              Math.abs(cell.x),
              `mission ${id} seed ${seed} ${p.corp} colony cell at x=${cell.x}`,
            ).toBeLessThan(CANYON.PLAY_HALF_X * 2);
          }
        }
      });
    }
  }

  it("Helion's cavern shaft is wall-mounted, not straight down", () => {
    const { props } = runPipeline(19, 0);
    const colony = props.find(
      (p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad' && p.id === 'helion-cavern',
    );
    expect(colony).toBeDefined();
    // Repositioned by `applyDigAttachments` away from its authored placeholder
    // (x: -48, y: -12) — if this ever reads as still sitting at the placeholder, the
    // dig resolved but the pad never picked up its real endpoint.
    expect(colony!.x).not.toBeCloseTo(-48, 0);
  });

  it("Kessler's shaft stays a straight descent, never silently turns diagonal", () => {
    // The exact risk `TerrainDigs.ts`'s `mount: 'floor'` exists to guard against:
    // `wallNormalInward` (the direction math `mount: 'wall'` uses) never returns
    // anything close to straight down, on any wall, on any seed — so if Kessler's
    // shaft were ever accidentally switched to that path, it would read as a diagonal
    // cavern like Helion's, contradicting a campaign's worth of "come down straight"
    // briefing text. Checked on every seed this suite already sweeps, not just one.
    for (const seed of SEEDS) {
      const { digs } = runPipeline(20, seed);
      const kesslerX = digs.find((d, i) => digs.some((o, j) => j !== i && Math.abs(o.x - d.x) < 1))?.x;
      expect(kesslerX, `seed ${seed}: expected two dig records sharing an x`).toBeDefined();
      const shaft = digs.find((d) => Math.abs(d.x - kesslerX!) < 1)!;
      expect(isFloorMounted(boreDirection(shaft).dir), `seed ${seed}`).toBe(true);
    }
  });

  it("Kessler's shaft pad tracks the real, wall-anchored x, not the old fixed x=60", () => {
    const { props } = runPipeline(20, 0);
    const shaftPad = props.find(
      (p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad' && p.id === 'kessler-shaft',
    );
    expect(shaftPad).toBeDefined();
    expect(shaftPad!.x).not.toBeCloseTo(60, 0);
  });

  it("Helion's anchor search doesn't wander past the mask's own sampled bounds and land " +
    'on unverified ground', () => {
    // The exact live failure this regression pins: mission 26, seed 1676745065.
    // `findAnchorX` correctly rejected a long real stretch of cells near Helion's own
    // dig and this mission's accumulated pad corridors, searched outward past the
    // mask's precomputed column range, and — because `isLandscapeCovered` used to treat
    // an unsampled column as "available" instead of "unverified" — accepted x=240, deep
    // past the canyon's opposite wall, on ground never actually measured. Fixed in
    // `ColonyAvailability.ts`; this is the pipeline-level trip-wire for it, alongside
    // the direct unit test in `ColonyAvailability.test.ts`.
    //
    // Not asserting Helion *has* a colony this call: with the fix, the search now
    // correctly exhausts its budget against real, legitimately-blocking terrain here
    // and returns "no room yet" rather than a fabricated position — `findAnchorX`'s own
    // documented contract, and the correct outcome. The regression is specifically that
    // *if* a colony exists, its anchor is real, sampled ground, not a distance check on
    // whether one exists at all.
    const { props } = runPipeline(26, 1676745065);
    const helion = props.find((p): p is Extract<Prop, { kind: 'colony' }> => p.kind === 'colony' && p.corp === 'helion');
    if (helion) {
      for (const cell of helion.cells) expect(Math.abs(cell.x)).toBeLessThan(CANYON.PLAY_HALF_X * 2);
    }
  });
});

/**
 * `cappedMouths`'s wall-mount branch (`Layout.ts`), the direct analogue of the
 * existing "Helion drove its cavern under its own crest deck" floor-mount regression —
 * same failure shape, the other orientation. Built against real terrain deliberately:
 * a wall mouth's position only means anything once `wallMouthY` can measure it.
 */
describe('a wall-mounted mouth can still be capped, and is caught', () => {
  it('reports a blocker sitting across the real wall mouth', () => {
    const seed = 0;
    const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
    const world = worldAt(19, 0);
    const resolvedDigs = resolveTerrainAnchoredDigs(world.digs, canyon);
    const propsAttached = applyDigAttachments(world.props, resolvedDigs.endpoints);
    canyon.build(resolvedDigs.digs, []);

    const cavernDig = resolvedDigs.digs.find((d) => d.direction && d.direction.y > -0.9)!;
    expect(cavernDig, 'expected a wall-mounted dig in this ledger').toBeDefined();
    const mouthY = canyon.wallMouthY(cavernDig);

    // Stacked slabs spanning the whole mouth band (each `caveRoof` is only 4 units
    // tall — `cappedWallMouth` measures the widest *gap*, so one slab anywhere in a
    // 2×halfWidth-tall opening leaves the rest of it wide open) — standing in for a
    // hand-authored structure built across the mouth, the same shape of mistake the
    // floor-mount regression already records, just facing sideways.
    const low = mouthY - cavernDig.halfWidth;
    const high = mouthY + cavernDig.halfWidth;
    const blockers: Prop[] = [];
    for (let y = low; y < high; y += 4) {
      blockers.push({ kind: 'caveRoof', corp: 'helion', x: cavernDig.x, halfWidth: 2, y });
    }

    const violations = checkLayout([...propsAttached, ...blockers], resolvedDigs.digs, undefined, canyon);
    expect(violations.some((v) => v.rule === 'mouth')).toBe(true);
  });

  it('reports nothing when the same mouth is left clear', () => {
    const seed = 0;
    const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
    const world = worldAt(19, 0);
    const resolvedDigs = resolveTerrainAnchoredDigs(world.digs, canyon);
    const propsAttached = applyDigAttachments(world.props, resolvedDigs.endpoints);
    canyon.build(resolvedDigs.digs, []);

    const violations = checkLayout(propsAttached, resolvedDigs.digs, undefined, canyon).filter(
      (v) => v.rule === 'mouth',
    );
    expect(violations).toEqual([]);
  });
});

/**
 * `wallHoleBoundary`/`buildCollar` (`CanyonGenerator.ts`, `Shaft.ts`) — the mesh-seam
 * stitching between the terrain's own cut hole and a wall-mounted bore's mouth ring.
 * Built against real terrain deliberately, same reasoning as the mouth-capping block
 * above: the boundary only means anything once real `heightAt`/`wallMouthY` exist to
 * measure it against.
 */
describe("a wall mount's hole boundary lines up with the bore's own mouth ring", () => {
  it("resolves cleanly for Helion's real cavern, on every seed checked", () => {
    for (const seed of SEEDS) {
      const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
      const world = worldAt(19, 0);
      const resolvedDigs = resolveTerrainAnchoredDigs(world.digs, canyon);
      canyon.build(resolvedDigs.digs, []);

      const dig = resolvedDigs.digs.find((d) => d.direction && d.direction.y > -0.9)!;
      expect(dig, `seed ${seed}: expected a wall-mounted dig in this ledger`).toBeDefined();

      const hole = canyon.wallHoleBoundary(dig);
      expect(
        hole,
        `seed ${seed}: a real, already-flown dig should resolve — a null here means the ` +
          'collar silently stopped covering it',
      ).not.toBeNull();

      // The low edge closes on a genuine terrain crossing on every seed measured while
      // building this (see `wallHoleBoundary`'s own doc comment) — pinned specifically,
      // not just "resolves at all", so a terrain change that quietly breaks the
      // crossing walk shows up here rather than only by eye.
      const mouthY = canyon.wallMouthY(dig);
      for (const p of hole!.low.points) {
        expect(Math.abs(p.y - mouthY), `seed ${seed} low edge at z=${p.z}`).toBeLessThanOrEqual(
          dig.halfWidth + 0.5,
        );
      }

      // The shaft's own mouth ring — a standalone `Shaft`, built the exact way
      // `CanyonGenerator.build()` builds its own, so this doesn't need `canyon`'s
      // private `shafts` list exposed just for the test to reach one.
      const shaft = new Shaft(new THREE.Scene(), dig, mouthY, seed);
      const { neg, pos } = shaft.mouthEdges();
      const negIsLow = neg[0].x <= pos[0].x;
      const lowRing = negIsLow ? neg : pos;
      const highRing = negIsLow ? pos : neg;

      // Both curves are built on the same `CANYON.CELL` z-lattice by construction — the
      // structural assumption `buildCollar`'s z-matching depends on — checked here
      // rather than assumed.
      for (const ringPt of lowRing) {
        const nearestZ = Math.min(...hole!.low.points.map((p) => Math.abs(p.z - ringPt.z)));
        expect(nearestZ, `seed ${seed} low ring z=${ringPt.z}`).toBeLessThanOrEqual(CANYON.CELL);
      }
      for (const ringPt of highRing) {
        const nearestZ = Math.min(...hole!.high.points.map((p) => Math.abs(p.z - ringPt.z)));
        expect(nearestZ, `seed ${seed} high ring z=${ringPt.z}`).toBeLessThanOrEqual(CANYON.CELL);
      }
    }
  });
});
