import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Noise, clamp01, lerp, smoothstep } from './Noise.ts';
import { CANYON, FACET_CELL, PALETTE } from './CanyonSpec.ts';
import { boreDirection, isFloorMounted, type Vec2 } from './Shaft.ts';
import { AntFarm, BACK_Z, FRONT_Z } from './AntFarm.ts';
import { carveFromDig, type ShaftCarve } from './ShaftGrid.ts';
import { fadeNearLander } from './LanderFade.ts';
import { buildRubble, rubbleAlong, type RubbleSite } from './Rubble.ts';



/**
 * A level bench in the landscape. Rather than carving terrain down to a fixed
 * height — which digs a crater wherever the ground happens to sit high — a shelf
 * levels the ground to *its own* height at the shelf centre and eases back into the
 * surrounding contour. It reads as a river terrace, and it is what gives the floor
 * somewhere flat to put a pad without the map looking quarried.
 */
export interface Shelf {
  x: number;
  halfWidth: number;
  shoulder: number;
}

/**
 * How far either side of a wall-mounted dig the collider profile samples densely.
 *
 * All that is left of a constant that used to do three jobs: this, the width of the mesh's
 * mouth omission, and the band the collider was split over. The other two are gone — the
 * hole is cut from the excavation's own cells now, so it cannot disagree with the geometry
 * the way three independent numbers could.
 */
const WALL_MOUTH_RUN = 30;

/**
 * A hole cut into the canyon.
 *
 * Authored as a tube — an x, a half-width, a depth and a direction — which is what the
 * ledger still writes and what eighteen modules still read. `ShaftGrid.carveFromDig`
 * rasterises it onto the colony grid, and `AntFarm` builds the geometry from those cells;
 * this stays as the bounding description everything that only needs to ask "is there a hole
 * near this x" keeps working from.
 */
export interface Excavation {
  x: number;
  halfWidth: number;
  /** How far the bore runs from its mouth, along `direction`. */
  depth: number;
  /**
   * How far the excavation extends down the canyon. Retained because `mergeDigs` and the
   * campaign's own checks still reason in these terms; the corridors' real depth is set by
   * `AntFarm`, from the grid.
   */
  lengthZ?: number;
  /**
   * Unit-ish vector the bore travels along from its mouth, in the x/y play plane. Defaults
   * to straight down. Needn't be pre-normalised; `boreDirection` normalises it once.
   */
  direction?: { x: number; y: number };
}

/**
 * Collapses excavations that share a bore into one.
 *
 * The campaign deepens the same shaft over several missions — Kessler's runs 58 deep,
 * then 172 — and `worldAt` accumulates both records rather than replacing one with the
 * other. The heightfield never cared, because carving to two depths at the same x just
 * takes the deeper. A built shaft very much cares: each one lays a floor slab at its own
 * bottom, so the shallow record put a lid across the deep bore at y=-58 and sealed every
 * pad below it. Three missions went to 0% reachable before this existed.
 *
 * Exported so the campaign's checks can reason about the digs the way the generator
 * actually builds them, rather than the way the ledger happens to record them.
 */
export function mergeDigs(digs: Excavation[]): Excavation[] {
  const out: Excavation[] = [];
  for (const dig of digs) {
    const shared = out.find((d) => Math.abs(d.x - dig.x) < d.halfWidth + dig.halfWidth);
    if (!shared) {
      out.push({ ...dig });
      continue;
    }
    shared.depth = Math.max(shared.depth, dig.depth);
    shared.halfWidth = Math.max(shared.halfWidth, dig.halfWidth);
    shared.lengthZ = Math.max(
      shared.lengthZ ?? shared.halfWidth * 3,
      dig.lengthZ ?? dig.halfWidth * 3,
    );
    // Direction isn't merged, only carried — two records of the same bore should never
    // disagree on which way it points, so the earlier one wins rather than averaging
    // two vectors into a direction nobody authored.
    shared.direction = shared.direction ?? dig.direction;
  }
  return out;
}

/** An excavation the current slice reaches, with its z-only terms already resolved. */
/**
 * One cross-section's worth of terrain terms that do not vary with x.
 *
 * See `CanyonGenerator.row`. Held as a plain value rather than cached on the instance so
 * that it cannot go stale against a rebuilt shelf or excavation list — a row is built,
 * used for a slice, and thrown away.
 */
interface Row {
  z: number;
  /** Centre of the wandering canyon axis at this depth. */
  centre: number;
  /** Half-width of the floor before the walls begin. */
  floorHalf: number;
  /** Height of the floor itself. */
  floorY: number;
  /** Terrace band phase, which drifts slowly downstream. */
  phase: number;
  /** Height each shelf levels its ground to. Index-aligned with `shelves`. */
  shelfLevel: number[];
}

const tmpColor = new THREE.Color();
const colorA = new THREE.Color();
const colorB = new THREE.Color();

function mixHex(out: THREE.Color, a: number, b: number, t: number): THREE.Color {
  colorA.setHex(a);
  colorB.setHex(b);
  return out.copy(colorA).lerp(colorB, clamp01(t));
}

export class CanyonGenerator {
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private noise: Noise;
  private disposables: THREE.Object3D[] = [];
  private excavations: Excavation[] = [];
  private shelves: Shelf[] = [];
  private shafts: AntFarm[] = [];
  private carves: ShaftCarve[] = [];
  /** Cache for `wallMouthY`, rebuilt each `build()`. */
  private wallMouthCache = new Map<Excavation, number>();
  /** Public so other generators (the colony) can key their own placement off the same
   *  campaign seed instead of carrying a second one — one seed to reason about, per the
   *  determinism rule in CLAUDE.md. */
  readonly seed: number;
  /** The cross-section at the canyon mouth, sampled at CANYON.CELL. */
  profile: { x: number; y: number }[] = [];

  constructor(scene: THREE.Scene, physics: PhysicsWorld, seed: number) {
    this.scene = scene;
    this.physics = physics;
    this.noise = new Noise(seed);
    this.seed = seed;
  }

  // -------------------------------------------------------- canyon axis (Z)

  /**
   * The canyon does not run straight. Its centreline wanders, its floor widens and
   * pinches, and it descends downstream — which is what turns a receding corridor
   * into a landscape with somewhere to go.
   */
  private centreAt(z: number): number {
    return this.noise.fbm(z * 0.0035, 71) * 38;
  }

  private floorHalfAt(z: number): number {
    return CANYON.FLOOR_HALF * (1 + this.noise.fbm(z * 0.006, 83) * 0.42);
  }

  private floorYAt(z: number): number {
    /**
     * Descends away from the mouth, so depth reads as a direction rather than a wall.
     *
     * The ramp is a *smooth* one-sided one, emphatically not `-Math.abs(z)`. Absolute
     * value put a V-shaped kink in the floor at exactly z=0 — the play plane, where the
     * lander flies — and `terrace` amplified it savagely: a 0.06 break in floor slope
     * lands on the steep riser of a strata band and comes out as a slope break of 1.8 on
     * the wall. Measured across the cross-section, that drew a hard line clean across the
     * map along the X axis. It was invisible to every check aimed at the *cross-section*,
     * because the discontinuity is in z, not x.
     *
     * `hypot(z, SOFT) - z` is |z| for z << 0, tapers to 0 for z >> 0, and is smooth
     * everywhere — so the floor still falls away downstream and still stays level toward
     * the mouth, without a foreground floor that rises into frame.
     */
    const SOFT = 90;
    const ramp = -0.5 * (Math.hypot(z, SOFT) - z);
    return ramp * 0.03 + this.noise.fbm(z * 0.009, 91) * 9;
  }

  // ------------------------------------------------------- cross-section (X)

  /**
   * The canyon floor. Uneven in both axes, with a ridged term for rubble and broken
   * slabs — a floor that is merely gently rolling reads as a ramp seen edge-on, which
   * is what made the bottom of the canyon feel flat.
   */
  private floorRelief(x: number, z: number): number {
    const n = this.noise;
    return (
      n.fbm(x * 0.011 + 3, z * 0.009 + 5) * 15 +
      n.ridge(x * 0.034, z * 0.026 + 17) * 6.5 +
      n.fbm(x * 0.088, z * 0.075 + 23) * 3.4
    );
  }

  /**
   * Ledges and buttresses for the canyon walls. Ridged noise gives sharp crests where
   * fbm gives rounded lumps, which is what makes a face read as fractured rock.
   *
   * `side` is what stops the canyon being a mirror. Fed only the distance from the
   * centreline, both walls sampled the identical noise and the canyon came out an exact
   * reflection — measured, heightAt(centre - 65) and heightAt(centre + 65) agreed to
   * 0.000 — so the reflection axis showed as a crease straight down the middle of the
   * frame, right where the lander flies. Offsetting the field per side gives each wall
   * its own rock while keeping the character identical. The switch happens at the
   * centreline, where the facet term is multiplied by zero, so it introduces no step.
   */
  private wallFacets(d: number, z: number, side: number): number {
    const n = this.noise;
    const w = side < 0 ? 0 : 211.3;
    return (
      n.ridge(d * 0.026 + 2, z * 0.01 + 31 + w) * 24 +
      n.ridge(d * 0.075, z * 0.03 + 43 + w) * 13 +
      n.fbm(d * 0.15, z * 0.05 + 53 + w) * 5
    );
  }

  /**
   * The wall relief resolved onto a lattice, so it becomes flat plates rather than a
   * smooth surface with striations painted on it.
   *
   * The cross-section at the play plane is sampled every half unit, which is far finer
   * than the noise features — so the walls came out as continuous curved sheets, read
   * as "perfect parallelograms" and matched nothing about the low-poly floor. Snapping
   * the relief to `FACET_CELL` and interpolating linearly across it makes the height
   * piecewise-linear in x: every cell is a genuine flat facet, meeting its neighbours
   * at a crease. Because this lives in heightAt, the colliders get the same plates the
   * player sees, so nothing can clip geometry that is not there.
   */
  private wallRelief(d: number, z: number, side: number): number {
    const d0 = Math.floor(d / FACET_CELL) * FACET_CELL;
    const t = (d - d0) / FACET_CELL;
    return lerp(
      this.wallFacets(d0, z, side),
      this.wallFacets(d0 + FACET_CELL, z, side),
      t,
    );
  }

  /**
   * Snaps a height toward strata bands, turning a smooth wall into a staircase of
   * benches at constant altitude. Each band rises steeply through the first part of
   * its thickness and then runs flat, so the wall becomes tread-and-riser rather
   * than a slope. The band phase drifts slowly along the canyon, so terraces tilt
   * gently downstream instead of ringing the whole chasm at identical heights.
   */
  private terrace(y: number, phase: number, strength: number): number {
    if (strength <= 0.001) return y;
    const h = CANYON.TERRACE_HEIGHT;
    const b = (y + phase) / h;
    const i = Math.floor(b);
    const stepped = (i + smoothstep((b - i - 0.3) / 0.45)) * h - phase;
    return lerp(y, stepped, strength);
  }

  // ------------------------------------------------------------------- rows

  /**
   * Resolves everything about a cross-section that does not depend on x.
   *
   * The mesh samples 501 columns for each of 426 depth slices — about 213,000 heights per
   * mission load — and the terms below are constant across every column of a row. Left
   * inline they were recomputed for each one: three fbm fields for the centreline, floor
   * width and floor height, another for the terrace phase, and worst of all a full
   * `floorRelief` evaluation per shelf, of which there are one per ground pad plus three
   * natural ones. That last was three fractal evaluations multiplied by seven shelves
   * multiplied by every column in the row, to produce seven numbers.
   *
   * Nothing here changes what the terrain *is* — the same expressions on the same
   * operands, hoisted to where they stop repeating.
   */
  private row(z: number): Row {
    return {
      z,
      centre: this.centreAt(z),
      floorHalf: this.floorHalfAt(z),
      floorY: this.floorYAt(z),
      phase: this.noise.fbm(z * 0.002, 97) * 0.4 * CANYON.TERRACE_HEIGHT,
      shelfLevel: this.shelves.map((s) => this.floorRelief(s.x, z)),
    };
  }

  /**
   * Terrain height anywhere in the canyon.
   *
   * The cross-section is built from the distance to the wandering centreline: flat-ish
   * floor out to `floorHalf`, then a wall climbing to the rim over `WALL_RUN`, then a
   * slow rise beyond into the plateau. Both walls come from the same expression, so
   * the canyon is symmetric in construction and asymmetric only through noise.
   */
  heightAt(x: number, z: number, includeDigs: boolean = true): number {
    return this.heightIn(x, this.row(z), includeDigs);
  }

  /**
   * The cross-section itself, given a resolved row.
   *
   * Split from `heightAt` so a caller sweeping a whole slice — which is every caller
   * that matters for load time — pays for the row once instead of once per column.
   */
  private heightIn(x: number, row: Row, includeDigs: boolean = true): number {
    const d = Math.abs(x - row.centre);
    const side = Math.sign(x - row.centre) || 1;

    // 0 across the floor, 1 at the rim.
    const t = clamp01((d - row.floorHalf) / CANYON.WALL_RUN);

    let y = row.floorY;

    // Floor relief, shelves and excavations only exist on the floor itself.
    const onFloor = 1 - smoothstep(t * 1.6);
    if (onFloor > 0.001) {
      y += this.floorDetail(x, row, includeDigs) * onFloor;
    }

    // The wall, terraced into strata benches, then broken up with facets. Terracing
    // happens before the facets so the benches stay legible instead of being buried
    // under noise.
    y += smoothstep(t) * (CANYON.RIM_Y - row.floorY);
    y = this.terrace(y, row.phase, smoothstep(t / 0.18) * CANYON.TERRACE_STRENGTH);
    y += this.wallRelief(d, row.z, side) * smoothstep(t / 0.14) * smoothstep((1.05 - t) / 0.3);

    // Beyond the rim the canyon gives way to open upland. The handover is wide and
    // the terracing strength eases across it rather than jumping: a short blend
    // between two differently-shaped, differently-terraced surfaces is exactly what
    // made the canyon and the landscape read as two objects bolted together.
    const past = d - row.floorHalf - CANYON.WALL_RUN;
    if (past > 0) {
      const w = smoothstep(past / 110);
      const up = CANYON.RIM_Y + this.plateau(x, row.z);
      const strength = lerp(CANYON.TERRACE_STRENGTH, 0.5, w);
      y = lerp(y, this.terrace(up, row.phase, strength), w);
    }

    return y;
  }

  /**
   * The upland either side of the canyon: broad swells, mesa ridges, hills and rock,
   * all varying in both X and Z so it is a landscape rather than an extrusion. The
   * downside is clamped so the plateau never sinks far below the rim — the canyon
   * should stay the deepest thing in view.
   */
  private plateau(x: number, z: number): number {
    const n = this.noise;
    const relief =
      n.fbm(x * 0.0022, z * 0.0022 + 61) * 62 +
      n.ridge(x * 0.0065, z * 0.0065 + 67) * 58 +
      n.fbm(x * 0.021, z * 0.021 + 73) * 17 +
      // Same frequencies the wall facets use, so the upland is visibly cut from the
      // same rock rather than being a separate noise field laid alongside it.
      //
      // Signed x, emphatically not Math.abs(x). Feeding this the absolute value made
      // the whole upland a mirror about x=0 — and because abs is not differentiable
      // there, it creased along that line: a dead-straight seam running the full length
      // of the landscape, right down the middle of the frame. It survived the wall-facet
      // fix because it lives out here in the plateau, past the rim, not on the wall.
      n.ridge(x * 0.026 + 2, z * 0.01 + 31) * 13 +
      n.fbm(x * 0.075, z * 0.075 + 79) * 4.5;
    return Math.max(relief, -38) + 12;
  }

  /** Floor relief plus the colony's shelves and excavations. */
  private floorDetail(x: number, row: Row, includeDigs: boolean = true): number {
    let y = this.floorRelief(x, row.z);

    // `shelfLevel` is index-aligned with `shelves` — the height each one levels its
    // ground to, which is a property of the shelf and the slice, never of the column.
    for (let i = 0; i < this.shelves.length; i++) {
      const shelf = this.shelves[i];
      const dd = Math.abs(x - shelf.x);
      if (dd < shelf.halfWidth + shelf.shoulder) {
        const t = smoothstep(Math.max(0, dd - shelf.halfWidth) / shelf.shoulder);
        y = lerp(row.shelfLevel[i], y, t);
      }
    }

    /**
     * **The floor no longer dips into a dig.**
     *
     * It used to lerp toward `floorRelief - depth` over a one-cell shoulder, which is what
     * made an excavation a funnel: the quads straddling the rim stretched from natural
     * ground down to the pit floor, and those long dark triangles hanging into the shaft
     * were visible from inside it. A heightfield can only ever express a hole as a steep
     * surface, because it has one y per x.
     *
     * `AntFarm` draws the rock below ground now, so the field does not have to try. The
     * terrain stays at its natural height and is simply *absent* over the carve — a real
     * hole, cut in the mesh and in the collider from the same cells.
     *
     * `includeDigs` survives as a parameter because callers still ask for "natural" height
     * to mean something specific, and it is now trivially true for every caller.
     */
    void includeDigs;
    return y;
  }

  /** Height across the canyon mouth — the plane the game is played on. */
  floorAt(x: number, includeDigs: boolean = true): number {
    return this.heightAt(x, 0, includeDigs);
  }

  /** Surface floor height across the canyon mouth, ignoring shaft/excavation pits. */
  surfaceFloorAt(x: number): number {
    return this.heightAt(x, 0, false);
  }

  /**
   * Room to the rock either side, for a vehicle inside a bore. `null` anywhere else —
   * which is most of a mission, since a hauler descends to a shaft before it enters one.
   *
   * The null is the useful half of this contract. The bore-clearance gauge is the one
   * instrument on the KD-9's panel with nothing to say in open air, and an instrument
   * that keeps reading while its quantity is undefined is worse than one that visibly
   * goes dark: it asserts a wall that is not there. `null` is what lets the gauge fade
   * rather than lie.
   *
   * Bores never overlap — the layout rules reserve entry lanes around each dig — so the
   * first hit is the only hit, and there is no tie to break.
   */
  clearanceAt(x: number, y: number): { left: number; right: number } | null {
    for (const shaft of this.shafts) {
      const clear = shaft.clearanceAt(x, y);
      if (clear) return clear;
    }
    return null;
  }

  /**
   * The real, lowest point of the canyon's natural floor across its full width at the
   * play plane — digs excluded, so a shaft's own pit never counts (a colony's own grid
   * has to rest on rock everywhere, not float over wherever a bore happens to go). This
   * is the *one* shared baseline the whole colony system now measures from: the
   * availability grid's own row-0 datum (`ColonyAvailability.ts`) and every colony's
   * rendered base (`Colony.ts`) both read this, not two independently-sampled ideas of
   * "the floor" that could (and did) disagree — `surfaceFloorAt` at each corp's own,
   * often-far-apart anchor `x` used to be the render datum, and different corps' real
   * local floor noise made neighbouring colonies visibly sink or rise relative to each
   * other. The lowest point is also the only choice that's *safe* everywhere at once:
   * anything higher risks a colony's own footprint dipping into real terrain somewhere
   * else along its width, the same "one flat sample, not per-column" reasoning
   * `Colony.ts`'s own doc comment already gives for why a single sample beats chasing
   * every column's own relief.
   */
  lowestFloorY(): number {
    const centre = this.centreAt(0);
    const half = this.floorHalfAt(0);
    const xs: number[] = [];
    for (let x = centre - half; x <= centre + half; x += 2) xs.push(x);
    return Math.min(...this.sampleFloorRow(xs, false));
  }

  /**
   * Real canyon half-width at a given absolute height, at the play plane — walks
   * outward from the real centreline on each side until the terrain first reaches `y`.
   * A canyon wall flares outward with altitude (`WALL_RUN`'s own rise, then the upland
   * plateau beyond the rim), so this is wider than the floor itself — sizing the colony
   * grid's own horizontal extent from this, not from the floor's own half-width, is
   * what keeps a tall colony from ever needing to reach outside the grid it was fit to.
   */
  canyonWidthAt(y: number): { west: number; east: number } {
    const STEP = 2;
    const MAX = CANYON.WORLD_HALF_X; // the mesh itself never extends past this
    const centre = this.centreAt(0);
    let west = centre;
    while (this.heightAt(west, 0, false) < y && centre - west < MAX) west -= STEP;
    let east = centre;
    while (this.heightAt(east, 0, false) < y && east - centre < MAX) east += STEP;
    return { west, east };
  }

  /**
   * `heightAt(x, 0)` for many `x` at once, resolving the z=0 row a single time.
   *
   * For a caller sweeping the play plane at many x — the colony availability grid,
   * primarily — rather than paying `row(0)`'s cost (centre/floor-half/floor-y/phase
   * fbm plus one `floorRelief` per shelf) on every single sample the way naive
   * per-x `heightAt(x, 0)` calls would. Mirrors the row-once/sample-many pattern
   * `buildCanyon`/`buildProfile` already use internally, exposed here so a caller
   * outside the class can have it too.
   */
  sampleFloorRow(xs: number[], includeDigs: boolean = true, z: number = 0): number[] {
    // `z` defaults to the play plane, which is every caller but the colony substrate's
    // front and back layers. A canyon wall is not a vertical sheet — it flares and wanders
    // in depth as well as height — so a layer twelve units back genuinely has a different
    // rock profile, and growing against the play plane's would put modules inside the wall
    // on one layer and floating clear of it on another.
    const row = this.row(z);
    return xs.map((x) => this.heightIn(x, row, includeDigs));
  }

  /**
   * World x where the flat floor ends and the wall begins, on one side of the canyon's
   * own (wandering) centreline — not a fixed offset from world x=0, since `centreAt`
   * means the floor is rarely centred there. `side` is +1 for the wall in the
   * increasing-x direction, -1 for the other one.
   *
   * For a caller placing something that wants to reach toward a wall without going
   * looking for it by sampling `heightAt` at a dozen x values first.
   */
  floorEdgeAt(z: number, side: 1 | -1): number {
    return this.centreAt(z) + side * this.floorHalfAt(z);
  }

  /** Seed-derived terraces, so the floor has natural benches away from pads. */
  private naturalShelves(): Shelf[] {
    const out: Shelf[] = [];
    const count = 3;
    const lo = -CANYON.PLAY_HALF_X + 14;
    const hi = CANYON.PLAY_HALF_X - 14;

    // Stratified: independent draws clump, and overlapping shelves merge into one
    // plateau while the rest of the floor gets none.
    for (let i = 0; i < count; i++) {
      const jitter = (this.noise.value(i * 7.3 + 0.5, 3.1) - 0.5) * 0.8;
      const u = clamp01((i + 0.5 + jitter) / count);
      out.push({
        x: lerp(lo, hi, u),
        halfWidth: 5 + this.noise.value(i * 3.7 + 0.5, 9.2) * 6,
        shoulder: 9,
      });
    }
    return out;
  }

  private buildProfile(): void {
    this.profile = [];
    // Snapped to whole cells, so the collider samples land exactly on mesh columns.
    // PROFILE_HALF_X is not a multiple of CELL, and iterating from it put the profile on
    // a lattice offset half a cell from the mesh — every collider point then fell between
    // two columns and the "matches bit for bit" guarantee quietly matched nothing.
    const half = Math.floor(CANYON.PROFILE_HALF_X / CANYON.CELL) * CANYON.CELL;
    // The whole profile is one slice, so it resolves one row and sweeps it.
    const row = this.row(0);
    for (let x = -half; x <= half + 1e-6; x += CANYON.CELL) {
      this.profile.push({ x, y: this.heightIn(x, row) });
    }
  }

  /**
   * `this.profile` at CANYON.CELL pitch, but resampled finer near any wall-mounted
   * mouth — for the collider only, never stored back into `this.profile`, which has to
   * stay at exactly the mesh's lattice for `frontY` to match it (see `buildProfile`).
   *
   * `carveWallMouths` removes whole points, which removes the whole segment on either
   * side of one — fine when a cell's height span is smaller than the mouth's own
   * band, wrong when it is not. A wall this steep covers more than a typical
   * `halfWidth` band in a single 4-unit cell, which measured as fifteen-plus units of
   * *solid* rock, well outside the intended opening, going missing from the collider —
   * a hole a lander could pass through where the wall still reads as solid. Resampling
   * at an eighth of a cell only where a wall mouth is nearby bounds that bleed to a
   * couple of units without paying the cost everywhere the terrain has no mouth at all.
   */
  private colliderProfile(): Vec2[] {
    const wallDigs = this.excavations.filter((d) => !isFloorMounted(boreDirection(d).dir));
    if (wallDigs.length === 0) return this.profile;

    const half = Math.floor(CANYON.PROFILE_HALF_X / CANYON.CELL) * CANYON.CELL;
    const row = this.row(0);
    const fine = CANYON.CELL / 8;
    const points: Vec2[] = [];
    for (let x = -half; x < half - 1e-9; x += CANYON.CELL) {
      const dense = wallDigs.some((d) => Math.abs(x - d.x) <= WALL_MOUTH_RUN + CANYON.CELL);
      if (dense) {
        for (let sx = x; sx < x + CANYON.CELL - 1e-9; sx += fine) {
          points.push({ x: sx, y: this.heightIn(sx, row) });
        }
      } else {
        points.push({ x, y: this.heightIn(x, row) });
      }
    }
    points.push({ x: half, y: this.heightIn(half, row) });
    return points;
  }

  /**
   * The natural (un-carved) terrain height at a wall-mounted dig's mouth x, at z=0 —
   * cached because `overShaft` and the collider gap both ask it once per candidate
   * quad/point, and it costs a noise evaluation.
   *
   * Public so `Layout.ts`'s `cappedMouths` can measure a wall mouth's real position
   * too (`MouthTerrain`) — the cache means asking twice, once for rendering and once
   * for the layout check, costs one noise evaluation total, not two.
   */
  wallMouthY(dig: Excavation): number {
    let y = this.wallMouthCache.get(dig);
    if (y === undefined) {
      y = this.heightAt(dig.x, 0);
      this.wallMouthCache.set(dig, y);
    }
    return y;
  }


  /**
   * A wall-mounted dig's real hole boundary — the two z-ordered curves
   * (`low` = lower-x edge, `high` = higher-x edge) where `overShaft`'s own wall-branch
   * test actually starts and stops matching, re-evaluated directly rather than
   * hand-derived from the inequality, so this can't disagree with what the mesh
   * actually renders even if that inequality's shape ever changes.
   *
   * Measured live on Helion's cavern across three seeds before this was written: the
   * height band `overShaft` tests is often wider than `WALL_MOUTH_RUN` itself — the
   * *lower*-x edge (further into the wall) closes on a genuine terrain crossing in
   * every row tested, but the *higher*-x edge (toward the canyon floor, where the wall
   * eases into a wide, gently-terraced blend — `CANYON.WALL_RUN`) routinely never
   * closes within the window at all. `overShaft` clips there regardless — that clip is
   * still a real edge of the rendered hole, not a fallback, so each edge here is
   * whichever comes first walking outward from `dig.x`: a genuine out-of-band crossing,
   * or the `WALL_MOUTH_RUN` window itself.
   *
   * Returns `null` — skip the collar for this dig, not fabricate one — only if `dig.x`
   * isn't in the height band on the play plane itself, which means there is no mouth
   * there to bridge. Out-of-band rows *elsewhere* in the extent are skipped rather than
   * fatal; see the z walk below for why that distinction cost this cavern its collar.
   *
   * Walking outward and stopping at the first exit — on both axes — also makes a
   * fragmented, multi-interval result impossible by construction: what comes back is
   * always the single contiguous in-band run containing `dig.x` at z=0, never a second,
   * disconnected one further out.
   *
   * Public so `CampaignPipeline.integration.test.ts` can verify it resolves cleanly
   * against real terrain — the same "public because a second caller needs it" reason
   * `wallMouthY` is public, not because anything outside `build()` uses it at runtime.
   */

  /**
   * Does this terrain quad sit over a shaft bore?
   *
   * For a floor-mounted dig, tested against the dig's nominal footprint, not the
   * meandering bore, so the hole is a clean rectangle. The bore is full width exactly
   * at the mouth and only insets below it, so the lining's top ring lands on this
   * boundary and there is no rim gap to cover — an inset here would leave terrain
   * draped over the edges of the bore instead.
   *
   * A wall-mounted dig's mouth is not an x/z rectangle the way a pit's is — the wall's
   * height varies with x while the mouth's opening is a band in *height*, not in x —
   * so this branch asks whether the quad's own natural height sits within the dig's
   * half-width of the mouth's height instead. See `WALL_MOUTH_RUN`.
   */
  /** Whether a point in the play cross-section falls in carved-out rock, within the depth
   *  band the corridors actually occupy. The single source for both the mesh hole and the
   *  collider split. */
  private inCarve(x: number, y: number, z: number): boolean {
    // **Exactly the corridor's own z extent**, with no padding. A cell of slack either side
    // cut twelve units of terrain front and back that the corridor does not fill, so the
    // shaft opened into rock that simply stopped existing — walls short of the hole they
    // were cut for. The hole and the thing filling it are the same span by construction now.
    if (z < BACK_Z || z > FRONT_Z) return false;
    for (const carve of this.carves) {
      if (carve.has(carve.grid.colAt(x), carve.grid.rowAt(y))) return true;
    }
    return false;
  }

  private overShaft(x0: number, x1: number, z0: number, z1: number, row: Row): boolean {
    // The quad's own centre, against the carve. One rule for both mounts: the two used to
    // be a half-width band for floor digs and a `WALL_MOUTH_RUN`-wide height band for wall
    // ones, neither of which matched the bore they were cutting for.
    const x = (x0 + x1) / 2;
    return this.inCarve(x, this.heightIn(x, row), (z0 + z1) / 2);
  }

  /**
   * Splits the z=0 collider profile into disjoint runs around any wall-mounted mouth.
   *
   * The profile is one y per x — it cannot represent solid rock, a gap, then solid rock
   * again at the same x, which is exactly what a mouth partway up a wall needs. So this
   * does not try to bend the curve through the opening; it removes the points that fall
   * inside it and lets the run split in two, with `Shaft`'s own colliders (which start
   * exactly at the mouth — see `Shaft.addColliders`) picking up the boundary from there.
   * The criterion matches `overShaft`'s exactly, so the visual hole and the collision
   * hole are the same hole.
   */
  /**
   * Splits the collider profile wherever it crosses carved rock.
   *
   * Was `carveWallMouths`, and only ever cut wall mounts — a floor dig relied on the
   * heightfield dipping instead, so the profile followed a funnel down into the pit. With
   * the dip gone the profile would run straight across every shaft mouth and seal it, so
   * this now cuts both, from the same cells the mesh hole is cut from.
   */
  private carveMouths(points: Vec2[]): Vec2[][] {
    if (this.carves.length === 0) return [points];
    const runs: Vec2[][] = [];
    let current: Vec2[] = [];
    for (const p of points) {
      if (this.inCarve(p.x, p.y, 0)) {
        if (current.length > 1) runs.push(current);
        current = [];
      } else {
        current.push(p);
      }
    }
    if (current.length > 1) runs.push(current);
    return runs;
  }

  /**
   * Mesh columns: the collider profile verbatim across the canyon, then geometrically
   * widening steps out to the horizon. The fine section must match the profile exactly
   * so the lander can never appear to clip geometry it did not hit; the upland is
   * unreachable, so it costs ~90 extra columns instead of thousands.
   */
  private meshColumns(): { xs: number[]; frontY: number[] } {
    const xs: number[] = [];
    for (let x = -CANYON.WORLD_HALF_X; x <= CANYON.WORLD_HALF_X + 1e-6; x += CANYON.CELL) {
      xs.push(x);
    }

    /**
     * The collider profile is a strict subset of these columns — same pitch, same
     * origin, so every profile x is also a mesh x. That is what keeps the play plane
     * matching its colliders now that nothing special is done for the near field: it
     * falls out of the lattice instead of being stitched together from two ranges.
     */
    const profileY = new Map(this.profile.map((p) => [p.x.toFixed(3), p.y]));
    return {
      xs,
      frontY: xs.map((x) => profileY.get(x.toFixed(3)) ?? this.heightAt(x, 0)),
    };
  }

  /**
   * Depth slices from in front of the play plane to far down the canyon, densest
   * around z=0 where the game happens and where the camera flies. z=0 is guaranteed
   * to be a slice, because that row has to match the colliders exactly.
   */
  private depthSlices(): number[] {
    // Uniform, same pitch as the columns. No fine band, no geometric widening, no
    // aspect cap — the grid is square everywhere, so there is nothing to keep in
    // proportion and no rate boundary for a seam to live on.
    const zs: number[] = [];
    for (let z = CANYON.FRONT_Z; z > -CANYON.LENGTH - 1e-6; z -= CANYON.CELL) {
      // Snap to exactly zero when we pass it: that row carries the colliders.
      zs.push(Math.abs(z) < CANYON.CELL / 2 ? 0 : z);
    }
    return zs;
  }

  // ------------------------------------------------------------------ build

  /**
   * `padSites` are the X positions of pads that rest on the ground. Each gets a
   * shelf, which is why a ground pad always finds level rock under it without the
   * generator needing to know how high that rock happens to be.
   */
  build(excavations: Excavation[], padSites: number[] = []): void {
    this.dispose();
    /**
     * Merged once, here, rather than separately per consumer.
     *
     * Three things read this list and they have to agree: `floorDetail` opens the mouth
     * in the heightfield, `overShaft` decides which terrain quads to omit, and the Shaft
     * props below build the bore itself. Only the last of the three used to merge, so two
     * records at the same x with different half-widths would have punched a hole of one
     * size, carved a mouth of another, and lined a bore of a third. The campaign happens
     * to author both Kessler records at the same width, which is the only reason that
     * never showed.
     */
    this.excavations = mergeDigs(excavations);
    this.wallMouthCache = new Map();
    /**
     * The carve, resolved once and read by everything that has to agree about where the
     * rock is missing: the mesh (`overShaft`), the collider (`carveMouths`) and `AntFarm`'s
     * own faces. This replaced three separate notions of the same hole — a heightfield dip
     * with a `CANYON.CELL` shoulder, a mesh omission on `dig.x ± halfWidth`, and a collider
     * split on a `WALL_MOUTH_RUN` band — which could and did disagree by a few units each.
     * There is one set of cells now, and a hole is exactly those cells.
     */
    this.carves = this.excavations.map((dig) =>
      carveFromDig(dig, isFloorMounted(boreDirection(dig).dir) ? this.heightAt(dig.x, 0) : this.wallMouthY(dig)),
    );
    this.shelves = [
      ...this.naturalShelves(),
      ...padSites.map((x) => ({ x, halfWidth: 9, shoulder: 10 })),
    ];
    this.buildProfile();

    /**
     * A floor-mounted dig's mouth is already open in `this.profile` — `floorDetail`
     * dipped it there, so the raw profile is correct as one run. A wall-mounted dig's
     * mouth is not: the profile's single y-per-x can't hold "solid, gap, solid" at one
     * x, so `carveWallMouths` removes the points inside it and the run splits, leaving
     * `Shaft`'s own colliders (which start exactly at the mouth) as the only thing
     * guarding the opening itself. `this.profile` is left whole regardless — `frontY`
     * still needs every x for the z=0 render row; only the physics copy is split, and
     * resampled finer near the mouth first — see `colliderProfile`.
     */
    for (const run of this.carveMouths(this.colliderProfile())) {
      this.physics.addPolyline(run, 'rock');
    }

    this.buildSky();
    this.buildCanyon();

    /**
     * After the terrain, and keyed off `heightAt` rather than `floorRelief`.
     *
     * The bore's floor has to land exactly where the heightfield's pit floor is, because
     * pads inside a shaft rest on `floorAt` — which is `heightAt`, and that includes
     * `floorYAt` and any shelf, neither of which `floorRelief` knows about. Guessing the
     * mouth from `floorRelief` put the bore 4.5 units too high, so its floor slab became
     * a lid *above* `kessler-shaft` and the pad was sealed under its own shaft.
     *
     * That is the floor-mounted case. A wall-mounted mouth has no pit to walk back up
     * from — `heightAt` at its x is already the natural, un-carved wall surface, which
     * *is* the mouth, so `dig.depth` is not added a second time.
     */
    const spoil: RubbleSite[] = [];
    for (const dig of this.excavations) {
      const natural = this.heightAt(dig.x, 0);
      const floorMounted = isFloorMounted(boreDirection(dig).dir);
      // The natural floor *is* the mouth now — `floorDetail` no longer dips, so `heightAt`
      // no longer returns a pit floor that had to be walked back up from.
      const mouthY = natural;
      /**
       * Carved on the colony's own grid, not built as a tube — see `AntFarm`.
       *
       * There is no `buildCollar` call here any more and that is the point of the change.
       * The collar existed to bridge a bore's mouth ring to the terrain's cut hole, two
       * curves from unrelated noise fields that could be brought close and never made to
       * meet; every seam defect this canyon has had lived in that gap. The face samples the
       * terrain per column at its own depth instead, so it *starts* at the ground rather
       * than reaching for it, and there is nothing left to bridge.
       */
      const farm = new AntFarm(this.scene, carveFromDig(dig, mouthY), this, this.seed);
      farm.build(this.physics);
      spoil.push(...(floorMounted ? this.pitSpoil(dig, mouthY) : []));
      this.shafts.push(farm);
    }

    /**
     * All of it in one mesh, after the loop rather than per dig.
     *
     * A stone is a dozen triangles and a mature canyon has a few hundred of them; one
     * merged batch is the difference between that and a few hundred draw calls for
     * scenery nobody is looking at directly.
     */
    const rubble = buildRubble(this.scene, spoil, this.seed);
    if (rubble) this.disposables.push(rubble);
  }


  /**
   * The same, ringing a floor pit's lip.
   *
   * A floor mouth has no collar to hide — the heightfield's own dip meets the bore within
   * `RELIEF` by construction — so this is the second job rather than the first: it says a
   * shaft was *dug*, which a clean circular hole in flat ground does not. Placed on the
   * natural floor either side of the opening, never over it, so nothing overhangs the
   * descent the player has to fly down.
   */
  private pitSpoil(dig: Excavation, mouthY: number): RubbleSite[] {
    const extent = (dig.lengthZ ?? dig.halfWidth * 3) / 2;
    const lip: Array<{ x: number; y: number; z: number }> = [];
    for (let z = -extent; z <= extent; z += CANYON.CELL) {
      for (const side of [-1, 1] as const) {
        const x = dig.x + side * (dig.halfWidth + dig.halfWidth * 0.35);
        lip.push({ x, y: mouthY, z });
      }
    }
    return rubbleAlong(lip, this.seed, { size: dig.halfWidth * 0.32, spread: dig.halfWidth * 0.4, per: 1, salt: 37 });
  }

  /*
   * There used to be a `heightLod` here: it quantised x onto a lattice that widened
   * with depth, to stop distant columns aliasing into vertical corduroy. It is gone,
   * and nothing replaced it, because it was treating a symptom. Columns were 0.5 units
   * apart — sub-pixel on screen — and the low-pass was there to hide what sampling a
   * 7-unit-featured surface 14 times per feature does to flat shading. At the sane
   * spacing the grid is its own LOD: column pitch is PROFILE_STEP scaled by `fanAt`,
   * so detail already coarsens with depth, in the geometry rather than behind a filter.
   */

  /**
   * The canyon itself, swept from the mouth down its length.
   *
   * Winding is load-bearing twice over: it decides which way computeVertexNormals
   * points (lighting) and which faces survive back-face culling. Rows advance into
   * -Z and columns into +X, so this order yields +Y on the floor and inward-facing
   * normals on the walls. Reverse it and the walls are culled outright.
   */
  private buildCanyon(): void {
    const zs = this.depthSlices();
    const { xs, frontY } = this.meshColumns();
    const cols = xs.length;
    const rows = zs.length;

    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const indices: number[] = [];
    // Kept alongside positions so `overShaft` below can reuse the same resolved row
    // instead of resolving each z-slice's fbm fields a second time.
    const rowAt: Row[] = [];

    for (let r = 0; r < rows; r++) {
      const z = zs[r];
      // Once per slice rather than once per column: see `row`.
      const row = this.row(z);
      rowAt.push(row);
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = xs[c];
        positions[i * 3] = x;
        // The z=0 row uses the profile directly, guaranteeing the plane the lander
        // flies in matches its colliders bit for bit, not merely to within LOD error.
        positions[i * 3 + 1] = Math.abs(z) < 1e-6 ? frontY[c] : this.heightIn(x, row);
        positions[i * 3 + 2] = z;
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        // Shafts are real geometry now, so the terrain leaves them a hole rather than
        // trying to drape itself down the bore. Without this the heightfield's own
        // one-quad wall would still be drawn, in front of the lining that replaced it.
        if (this.overShaft(xs[c], xs[c + 1], zs[r], zs[r + 1], rowAt[r])) continue;
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const nrm = geo.attributes.normal;
    for (let i = 0; i < cols * rows; i++) {
      // Aerial perspective as a continuous function of distance down the canyon.
      const depthTint = smoothstep(Math.abs(positions[i * 3 + 2]) / 520) * 0.4;
      const col = this.shade(
        positions[i * 3],
        positions[i * 3 + 1],
        clamp01(nrm.getY(i)),
        depthTint,
      );
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    /**
     * The near wall thins out around the vehicle — see `LanderFade`.
     *
     * One mesh spans the whole canyon in z, so this is the case the fade's depth gate
     * exists for: fragments in front of the play plane take part, everything at or behind
     * it is untouched. Without it the west approach is flown blind, because the wall the
     * camera is looking across is between it and the lander for most of the descent.
     *
     * `transparent` has to be declared here even though the surface is opaque almost
     * everywhere — three.js picks the render queue from it, and setting it later forces a
     * recompile mid-flight. `depthWrite` stays on, unlike the colony's foreground layer:
     * this same mesh is also the *far* wall, and a near face that stopped writing depth
     * would let the far one draw straight through it.
     */
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      // Rock is a dielectric. Metalness on a PBR material is not a shininess dial — above
      // zero it starts tinting the specular response by the base colour and killing the
      // diffuse term, which on a red wall reads as a faint metallic sheen that has no
      // business being there. It was 0.02, which is imperceptible but still wrong in kind;
      // the shaft lining next door has always been 0.
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
      transparent: true,
    });
    fadeNearLander(material, 0);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    // Terrain receives but never casts: with a low sun a 240-unit wall shadows the
    // entire canyon and everything in it goes flat. Casting is for structures.
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.disposables.push(mesh);
  }

  /** Height and slope drive the colour; `depthTint` fakes aerial perspective. */
  private shade(x: number, y: number, up: number, depthTint: number): THREE.Color {
    const n = this.noise;
    // Jitter the thresholds so colour bands never form clean horizontal lines across
    // a wall as wide as the canyon.
    const jitter = n.fbm(x * 0.012, y * 0.01 + 41) * 0.14;
    const h = clamp01((y - CANYON.FLOOR_Y) / (CANYON.RIM_Y - CANYON.FLOOR_Y) + jitter);

    mixHex(tmpColor, PALETTE.rockLow, PALETTE.rockMid, smoothstep(h * 1.5));
    mixHex(tmpColor, tmpColor.getHex(), PALETTE.rockHigh, smoothstep((h - 0.72) / 0.5));
    mixHex(tmpColor, tmpColor.getHex(), PALETTE.dust, up * up * 0.4);

    // Strata on vertical faces, signed so bands run both lighter and darker around
    // the base tone. Blending only toward the highlight compounds with the height
    // ramp and bleaches a whole wall to one flat tone.
    const vertical = 1 - up;
    if (vertical > 0.2) {
      const band = n.value(y * 0.05 + 5, x * 0.01 + 13) - 0.5;
      const target = band > 0 ? PALETTE.rockHigh : PALETTE.rockLow;
      mixHex(tmpColor, tmpColor.getHex(), target, vertical * Math.abs(band) * 0.55);
    }

    if (depthTint > 0) mixHex(tmpColor, tmpColor.getHex(), PALETTE.dust, depthTint);

    // Canyon shadow. With the sun on the horizon nothing below the rim is in direct
    // light, and the walls would shadow the floor even if it were higher. Baking that
    // into the vertex colour is both cheaper and far more stable than a shadow map
    // spanning a 2600-unit world — and it is what lets the colony's own lights become
    // the only real illumination down there.
    const belowRim = clamp01((CANYON.RIM_Y - y) / CANYON.RIM_Y);
    tmpColor.multiplyScalar(lerp(1, 0.4, belowRim ** 1.15));

    return tmpColor;
  }

  /** A dust-gradient dome so the sky is not a flat fill. */
  /**
   * The sky dome.
   *
   * The gradient is baked as a *multiplier* rather than as colour. Vertex colours
   * multiply the material colour in three.js, so a vertex of (1,1,1) at the horizon
   * renders exactly the material colour — and the material colour is driven from the
   * fog every frame by `tintSky`. That makes the horizon match the fog by construction
   * instead of by coincidence.
   *
   * It did not match before: the dome baked PALETTE.dust with `fog: false`, while the
   * fog colour is animated at runtime and darkens toward near-black as you descend. So
   * fogged terrain met an unfogged dome at a hard line across the horizon. The zenith
   * tint is the skyHigh/dust ratio, so at the default fog colour this reproduces the
   * old gradient exactly and then follows the fog wherever it goes.
   */
  /**
   * Sky gradient dome disabled so the background renders as a uniform solid color
   * matching the fog color, ensuring the horizon dissolves smoothly with zero seam.
   */
  private buildSky(): void {
    // Sky dome mesh removed so WebGL background clearColor renders solid fog color
  }

  /** Pins the background horizon to the current fog colour. */
  tintSky(_color: THREE.Color): void {
    // Background clearColor is handled directly by WebGLRenderer.setClearColor
  }

  dispose(): void {
    for (const shaft of this.shafts) shaft.dispose();
    this.shafts = [];
    for (const obj of this.disposables) {
      this.scene.remove(obj);
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    }
    this.disposables = [];
  }
}
