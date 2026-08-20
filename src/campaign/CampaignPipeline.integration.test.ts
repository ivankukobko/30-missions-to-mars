import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { worldAt } from './Missions.ts';
import { planColonies, missionWorlds, campaignPadSites } from './ColonyPlan.ts';
import { checkLayout } from './Layout.ts';
import { resolveTerrainAnchoredDigs, applyDigAttachments } from './TerrainDigs.ts';
import { CanyonGenerator } from '../world/CanyonGenerator.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CANYON } from '../world/CanyonSpec.ts';
import { boreDirection, isFloorMounted } from '../world/Shaft.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import type { Prop } from '../world/Colony.ts';

/**
 * The real pipeline, end to end, against real terrain — `Game.loadMission`'s own
 * sequence, exercised outside the renderer. Everything in `Missions.test.ts` and
 * `ColonyGeneration.test.ts` deliberately stays terrain-free or fakes it for speed;
 * this is the one place that has to build an actual canyon per case to be worth
 * anything, so it stays deliberately small — a handful of mission ids spanning the
 * campaign's real terrain milestones (pre-dig, first floor dig, the wall-mounted
 * cavern dig, the shaft's two deepenings, fully built) rather than the full 30, and two seeds
 * rather than a wide sweep. `mastX` is fixed at 0 throughout: colony geometry never
 * depends on it (only the collider-less `radar` prop does), so sweeping it here would
 * just rebuild the same terrain repeatedly for no new coverage.
 */
const IDS = [1, 15, 19, 20, 25, 30];
/**
 * 631729407 is here for a specific reason: it is a narrow canyon whose wall rises 12 units
 * clear of Helion's mouth band at the front edge of the cavern's own z-extent. That row
 * used to make `wallHoleBoundary` bail for the *whole* dig, so the cavern rendered as a
 * raw hole with no collar bridging it to the terrain — visible on screen, invisible to a
 * suite that only checked seeds where every row happened to be in band.
 */
const SEEDS = [0, 12345, 631729407];

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
      const { digs, props } = runPipeline(20, seed);
      /**
       * Located by the deck bolted to it, rather than by hunting for two dig records that
       * share an x — which is how this used to find the shaft, and which quietly stopped
       * working when the second record moved to mission 21. That idiom was testing "the
       * campaign happens to have deepened this bore by mission 20", which is a fact about
       * the ledger's staging and not the property this test is named for.
       */
      const deck = props.find(
        (p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad' && p.id === 'kessler-shaft',
      );
      expect(deck, `seed ${seed}: no Kessler shaft deck to locate the bore by`).toBeDefined();
      const shaft = digs.find((d) => Math.abs(d.x - deck!.x) < 1);
      expect(shaft, `seed ${seed}: deck at x=${deck!.x} sits in no dig`).toBeDefined();
      expect(isFloorMounted(boreDirection(shaft!).dir), `seed ${seed}`).toBe(true);
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
 * The excavation is **flyable along a corridor and solid across it** — the one property the
 * whole underground exists to provide, checked against real terrain on every seed.
 *
 * This replaces a test of `wallHoleBoundary`/`buildCollar`, the mesh stitching between the
 * terrain's cut hole and a bore's mouth ring. That machinery is gone: `AntFarm` carves on the
 * colony grid and samples the terrain per column for its own top edge, so the face starts at
 * the ground instead of reaching for it and there is no seam left to bridge. The old test
 * still passes — it builds its own `Shaft` — which is exactly why it had to go rather than be
 * left green: it was guarding geometry the game no longer builds.
 *
 * What is asserted instead is what a pilot actually depends on. A collider missing from a
 * corridor wall is a hole you fall through; a collider *across* the corridor is a mission
 * that cannot be flown. Both are invisible in a screenshot and neither is expressible as a
 * property of a mesh seam.
 */
describe('a carved excavation is open along its axis and closed across it', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: Kessler's shaft can be descended and its walls stop you`, () => {
      const physics = new PhysicsWorld(-6);
      const canyon = new CanyonGenerator(new THREE.Scene(), physics, seed);
      const world = worldAt(20, 0);
      const resolved = resolveTerrainAnchoredDigs(world.digs, canyon);
      canyon.build(resolved.digs, []);

      const dig = resolved.digs.find((d) => !d.direction || d.direction.y < -0.9);
      expect(dig, `seed ${seed}: expected a floor-mounted dig in this ledger`).toBeDefined();

      // The mouth, computed the way `CanyonGenerator.build` computes its own: the natural
      // floor, full stop. The heightfield no longer dips into a dig, so there is no pit
      // floor to walk back up from.
      const mouthY = canyon.heightAt(dig!.x, 0);
      const top = mouthY - CANYON.CELL;
      const bottom = mouthY - dig!.depth + CANYON.CELL * 2;

      // Down the axis: open. A radius well under the corridor half-width, so this is asking
      // whether the shaft is flyable rather than whether it is generously wide.
      expect(
        physics.sweep(dig!.x, top, dig!.x, bottom, 1),
        `seed ${seed}: the shaft is blocked somewhere down its own axis`,
      ).toBeNull();

      // Across it: solid. Swept from the axis out past the carve, so a wall that failed to
      // emit a collider shows up as a sweep that never touches anything.
      const mid = (top + bottom) / 2;
      expect(
        physics.sweep(dig!.x, mid, dig!.x + dig!.halfWidth + CANYON.CELL * 3, mid, 1),
        `seed ${seed}: swept out of the shaft without hitting a wall`,
      ).not.toBeNull();
    });
  }
});
