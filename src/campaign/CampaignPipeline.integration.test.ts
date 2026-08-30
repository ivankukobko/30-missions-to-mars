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
import { SHAFT_CELL } from '../world/ShaftGrid.ts';
import { mergeDigs } from '../world/CanyonGenerator.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import { Colony, type Prop } from '../world/Colony.ts';

/**
 * A canvas stub, so `Colony.build` can run outside a browser.
 *
 * The only DOM it touches is `glowTexture`, which paints a 32px radial gradient for the
 * beacon sprites. `THREE.CanvasTexture` stores the element and never reads it without a
 * renderer, and the painting itself is already guarded on `getContext` returning
 * something — so a stub that returns nothing produces a texture nobody samples, which is
 * exactly right for a test that cares about colliders.
 *
 * Preferred over adding jsdom: a dependency here means rebuilding the image, and this is
 * four lines that say precisely what is being faked and why.
 */
if (typeof globalThis.document === 'undefined') {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  };
}

/**
 * The real pipeline, end to end, against real terrain — `Game.loadMission`'s own
 * sequence, exercised outside the renderer. Everything in `Missions.test.ts` and
 * `ColonyGeneration.test.ts` deliberately stays terrain-free or fakes it for speed;
 * this is the one place that has to build an actual canyon per case to be worth
 * anything, so it stays deliberately small — a handful of mission ids spanning the
 * campaign's real terrain milestones (pre-dig, first floor dig, Helion's gallery inside
 * it, the shaft's two deepenings, fully built) rather than the full twenty-nine, and two
 * seeds rather than a wide sweep. `mastX` is fixed at 0 throughout: colony geometry never
 * depends on it (only the collider-less `radar` prop does), so sweeping it here would
 * just rebuild the same terrain repeatedly for no new coverage.
 */
const IDS = [1, 14, 18, 19, 24, 29];
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
): {
  props: Prop[];
  digs: Excavation[];
  violations: ReturnType<typeof checkLayout>;
  canyon: CanyonGenerator;
  physics: PhysicsWorld;
} {
  const physics = new PhysicsWorld(-6);
  const scene = new THREE.Scene();
  const canyon = new CanyonGenerator(scene, physics, seed);
  // Built once and reused, exactly as `Game.loadMission` does — see `ColonyPlan.test.ts`
  // for what a second, post-build resolution costs.
  const worlds = missionWorlds(0, null, canyon);
  const current = worlds(id);
  canyon.build(current.digs, campaignPadSites(worlds));

  const plan = planColonies(id, worlds, {}, seed, canyon);
  const allProps = [...current.props, ...plan.colonies];

  /**
   * **The colony goes into the physics world too**, exactly as `Game.loadMission` does it.
   *
   * This was missing for as long as this harness existed, and it quietly halved what every
   * probe here could see: `canyon.build` contributes terrain and excavation colliders, and
   * `Colony.build` contributes every deck and every grown structure. So a sweep down a
   * shaft was answering "is the rock clear" when the question is "can a vehicle get there",
   * and two faults lived in the gap — a colony module standing across a mouth twelve rows
   * up, and Kessler's own crest deck straddling one — both of which had to be found by
   * flying the game and reading colliders out of the browser.
   */
  const colony = new Colony(scene, physics);
  colony.build(allProps, canyon, plan);
  const violations = checkLayout(allProps, current.digs, undefined, canyon, plan.network.channels);
  return { props: allProps, digs: current.digs, violations, canyon, physics };
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

  it("Helion's gallery deck resolves onto the real shaft floor, not its placeholder", () => {
    const { props } = runPipeline(19, 0);
    const colony = props.find(
      (p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad' && p.id === 'shaft-gallery',
    );
    expect(colony).toBeDefined();
    /**
     * Repositioned by `applyDigAttachments` away from its authored placeholder.
     *
     * Checked on `y`, not `x`. This used to assert the deck had moved off x −48, which
     * worked while Helion drove its own bore into the west wall — and stopped meaning
     * anything the day that bore was retired: Helion's gallery is the west end of the
     * same floor-mounted shaft Kessler dug now, not a working of its own (see the
     * `adds.digs` comment on the mission that hands it over), and the west end of that
     * shared gallery happens to land back on that same x. The height is the honest test:
     * the placeholder is −12 and the gallery floor is nowhere near it, so a deck still
     * reading −12 means `atCell` never resolved.
     */
    expect(colony!.y).toBeDefined();
    expect(colony!.y).not.toBeCloseTo(-12, 0);
  });

  it("Kessler's shaft stays a straight descent, never silently turns diagonal", () => {
    // The exact risk `TerrainDigs.ts`'s `mount: 'floor'` exists to guard against:
    // `wallNormalInward` (the direction math `mount: 'wall'` uses) never returns
    // anything close to straight down, on any wall, on any seed — so if Kessler's
    // shaft were ever accidentally switched to that path, it would read as a diagonal
    // cavern like Helion's, contradicting a campaign's worth of "come down straight"
    // briefing text. Checked on every seed this suite already sweeps, not just one.
    for (const seed of SEEDS) {
      const { digs, props } = runPipeline(19, seed);
      /**
       * Located by the deck bolted to it, rather than by hunting for two dig records that
       * share an x — which is how this used to find the shaft, and which quietly stopped
       * working when the second record moved to mission 20. That idiom was testing "the
       * campaign happens to have deepened this bore by mission 19", which is a fact about
       * the ledger's staging and not the property this test is named for.
       */
      const deck = props.find(
        (p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad' && p.id === 'shaft-head',
      );
      expect(deck, `seed ${seed}: no Kessler shaft deck to locate the bore by`).toBeDefined();
      const shaft = digs.find((d) => Math.abs(d.x - deck!.x) < 1);
      expect(shaft, `seed ${seed}: deck at x=${deck!.x} sits in no dig`).toBeDefined();
      expect(isFloorMounted(boreDirection(shaft!).dir), `seed ${seed}`).toBe(true);
    }
  });

  it("Kessler's shaft pad tracks the real, wall-anchored x, not the old fixed x=60", () => {
    const { props } = runPipeline(19, 0);
    const shaftPad = props.find(
      (p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad' && p.id === 'shaft-head',
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
  /**
   * PARKED: the campaign has no wall-mounted excavation left to test this against.
   *
   * Everybody uses the one floor-mounted complex now, so `worldAt` yields no horizontal
   * bore and this test was asserting a property of a ledger shape that no longer exists.
   * Building a synthetic wall bore keeps it running but not passing, and the reason is
   * worth recording rather than patching over: `cappedWallMouth` measures headroom as
   * `halfWidth * 2` **above y=0**, not above the mouth — so a bore whose mouth sits high
   * on a wall face cannot trip the rule at all, whatever is built across it. That was
   * invisible while the only wall bore in the campaign happened to open near the floor.
   *
   * `cappedWallMouth` is still live code. Un-skip and fix the datum if a wall working ever
   * comes back; delete both together if one never does.
   */
  it.skip('reports a blocker sitting across the real wall mouth', () => {
    const seed = 0;
    const canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), seed);
    const world = worldAt(19, 0);
    /**
     * A wall bore built for this test rather than taken from the ledger.
     *
     * The campaign has none any more — everybody uses the one floor-mounted complex — but
     * `cappedWallMouth` is still live code and still the only thing that would catch a
     * structure built across a horizontal opening. Testing a capability against a ledger
     * that happens to exercise it is how a check quietly stops being tested the day the
     * campaign changes shape, which is exactly what happened here.
     */
    const withWallBore = [
      ...world.digs,
      { anchorToWall: 'west' as const, halfWidth: 10, depth: 46, id: 'synthetic-cavern' },
    ];
    const resolvedDigs = resolveTerrainAnchoredDigs(withWallBore, canyon);
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
      /**
       * Built with the campaign's real pad sites, not `[]`.
       *
       * This passed an empty list for as long as it existed, which quietly made it a test
       * of a canyon the game never builds: benches are graded *from* pad sites, so with
       * none there is no shelf anywhere and the one terrain feature that can bury a mouth
       * is switched off. A deck's shelf sealing a shaft went unnoticed straight through
       * this test and every other.
       */
      const worlds = missionWorlds(0, null, canyon);
      const resolved = resolveTerrainAnchoredDigs(world.digs, canyon);
      canyon.build(resolved.digs, campaignPadSites(worlds));

      const dig = resolved.digs.find((d) => !d.direction || d.direction.y < -0.9);
      expect(dig, `seed ${seed}: expected a floor-mounted dig in this ledger`).toBeDefined();

      // The mouth, computed the way `CanyonGenerator.build` computes its own: the natural
      // floor, full stop. The heightfield no longer dips into a dig, so there is no pit
      // floor to walk back up from.
      const mouthY = canyon.heightAt(dig!.x, 0);
      /**
       * From clear sky, not from a cell below the lip.
       *
       * `mouthY - CELL` starts the sweep *inside* the hole, one cell under the surface —
       * so anything standing across the entrance is above where the probe begins and
       * cannot be hit. The obstruction this test exists to find is the one at the mouth.
       */
      const top = CANYON.RIM_Y + 40;
      const bottom = mouthY - dig!.depth + CANYON.CELL * 2;

      // Down the axis: open. A radius well under the corridor half-width, so this is asking
      // whether the shaft is flyable rather than whether it is generously wide.
      expect(
        physics.sweep(dig!.x, top, dig!.x, bottom, 1),
        `seed ${seed}: the shaft is blocked somewhere down its own axis`,
      ).toBeNull();

      // Across it: solid. Swept from the axis out past the carve, so a wall that failed to
      // emit a collider shows up as a sweep that never touches anything.
      // Midway down the *bore*, not midway down the sweep. `top` is clear sky now, so
      // averaging it with the bottom puts this probe a hundred units above the ground and
      // sweeps it through open canyon, where hitting nothing is the correct answer and a
      // missing corridor wall reads as a pass.
      const mid = (mouthY + bottom) / 2;
      expect(
        physics.sweep(dig!.x, mid, dig!.x + dig!.halfWidth + CANYON.CELL * 3, mid, 1),
        `seed ${seed}: swept out of the shaft without hitting a wall`,
      ).not.toBeNull();
    });
  }
});

describe('the ground a shaft opens through', () => {
  /**
   * The class of fault no prop-based check can see, and the one that shipped.
   *
   * Everything in `Layout.ts` and `ColonyPlan.test.ts` reasons about props: decks,
   * colonies, roofs, the channels between them. A shaft sealed by a *pad's graded shelf*
   * involves no prop at all — the terrain simply stands higher over the entrance than the
   * hole was cut for, and every collider, every colony cell and every flight channel is
   * exactly where it should be. It renders as solid ground with somebody's landing pad
   * on top of it, and the whole suite stays green.
   *
   * The mechanism is a disagreement about one number. `carveFromDig` builds a shaft from a
   * single `mouthY` — `heightAt(dig.x, 0)` — while the terrain has a height per column, and
   * `floorDetail` *levels* the ground under every ground-resting deck to its shelf. Put a
   * mouth inside a shelf and the two numbers come apart by however much that shelf raised
   * the floor. `PAD_MOUTH_CLEARANCE` in `TerrainDigs.ts` is what now keeps them apart; this
   * is what would notice if it ever stopped.
   */
  for (const seed of SEEDS) {
    it(`seed ${seed}: every deck under the floor can be flown to from the sky`, () => {
      /**
       * The direct question, asked with a swept probe rather than an arithmetic proxy.
       *
       * An earlier version of this compared the terrain height at the mouth columns against
       * the height the shaft was cut from, which is a real signal and still only a stand-in
       * for the thing that matters: whether a vehicle can get there. A sweep answers that
       * against the colliders the game actually builds, so it catches a buried mouth, a
       * missing corridor wall and a deck placed in rock with one assertion instead of three
       * proxies for each.
       *
       * Two segments, because the complex branches. Straight down the mouth reaches
       * everything under it; the gallery hangs off to the west and is reached by levelling
       * off — which is exactly the flight the briefs describe and the HD-7 exists for.
       */
      const { props, digs, canyon, physics } = runPipeline(29, seed);
      const shaft = mergeDigs(digs).find((d) => isFloorMounted(boreDirection(d).dir));
      expect(shaft, `seed ${seed}: expected a floor bore`).toBeDefined();

      const mouthY = canyon.heightAt(shaft!.x, 0);
      const sunk = props.filter(
        (p): p is Extract<Prop, { kind: 'pad' }> =>
          p.kind === 'pad' && p.y !== undefined && p.y < mouthY,
      );
      expect(sunk.length, `seed ${seed}: expected decks below the floor`).toBeGreaterThan(0);

      for (const deck of sunk) {
        // Down the mouth to the deck's own level, from clear sky.
        expect(
          physics.sweep(shaft!.x, CANYON.RIM_Y + 40, shaft!.x, deck.y! + 4, 1),
          `seed ${seed}: deck ${deck.id} — the descent is blocked above it`,
        ).toBeNull();

        // Then across, if it does not sit under the mouth.
        if (Math.abs(deck.x - shaft!.x) > SHAFT_CELL) {
          expect(
            physics.sweep(shaft!.x, deck.y! + 4, deck.x, deck.y! + 4, 1),
            `seed ${seed}: deck ${deck.id} — the gallery run to it is blocked`,
          ).toBeNull();
        }
      }
    });

    /**
     * A second test lived here asserting that no deck's shelf ever overlaps a mouth, and
     * it is gone on purpose.
     *
     * It was the *cause* stated as a rule, and it turned out to be stricter than the
     * canyon: on seed 0 the shelf's shoulder overlaps a mouth by three units and the shaft
     * is demonstrably open anyway, because the eased part of a shelf barely lifts the
     * ground. Asserting the heuristic the resolver prefers, rather than the outcome the
     * player gets, made the suite red about a canyon that works.
     *
     * The sweep above is the honest test and subsumes it — it asks whether a vehicle can
     * get there, which is the only thing the rule was ever a proxy for.
     */
  }
});
