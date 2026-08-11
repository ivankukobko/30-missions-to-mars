import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Noise, clamp01, lerp, smoothstep } from './Noise.ts';
import { CANYON, FACET_CELL, PALETTE } from './CanyonSpec.ts';
import { Shaft } from './Shaft.ts';

/**
 * A pit dug into the canyon floor by the colony. Unlike the props in Colony.ts this
 * one really does modify the terrain — but only downward, which a heightfield can
 * express. The overhang that makes it a *cave* is a separate `caveRoof` prop.
 */
export interface Excavation {
  x: number;
  halfWidth: number;
  /** How far below the natural floor the pit bottoms out. */
  depth: number;
  /**
   * How far the pit extends down the canyon. Without this a dig is an infinite
   * trench — descending into it shows two parallel walls and nothing closing the
   * back, which is exactly the flat ant-farm read. Given an extent, the shaft has a
   * far wall behind it and reads as a hole in the ground. Defaults to 3x halfWidth.
   */
  lengthZ?: number;
}

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
  }
  return out;
}

/** An excavation the current slice reaches, with its z-only terms already resolved. */
interface RowDig {
  x: number;
  halfWidth: number;
  /** How strongly this slice blends toward the pit floor, 0..1. */
  along: number;
  /** How far the mouth's lip is broken out of true here. */
  lip: number;
  /** Height of the pit floor at this depth down the canyon. */
  pit: number;
}

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
  digs: RowDig[];
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
  private shafts: Shaft[] = [];
  private seed: number;
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
    const digs: RowDig[] = [];
    for (const dig of this.excavations) {
      // Full depth at the mouth, closing off down the canyon. A dig the slice does not
      // reach is dropped here rather than skipped once per column.
      const extent = dig.lengthZ ?? dig.halfWidth * 3;
      const along = 1 - smoothstep((Math.abs(z) - extent * 0.35) / (extent * 0.65));
      if (along <= 0.001) continue;

      digs.push({
        x: dig.x,
        halfWidth: dig.halfWidth,
        along,
        // Breaks the lip out of true, so the mouth reads as blasted rock rather than a
        // machined slot. Only the edge moves; the pit keeps its full width at depth.
        lip: this.noise.fbm(z * 0.06 + 131, dig.x * 0.11 + 17) * (CANYON.CELL * 0.9),
        pit: this.floorRelief(dig.x, z) - dig.depth,
      });
    }

    return {
      z,
      centre: this.centreAt(z),
      floorHalf: this.floorHalfAt(z),
      floorY: this.floorYAt(z),
      phase: this.noise.fbm(z * 0.002, 97) * 0.4 * CANYON.TERRACE_HEIGHT,
      shelfLevel: this.shelves.map((s) => this.floorRelief(s.x, z)),
      digs,
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
  heightAt(x: number, z: number): number {
    return this.heightIn(x, this.row(z));
  }

  /**
   * The cross-section itself, given a resolved row.
   *
   * Split from `heightAt` so a caller sweeping a whole slice — which is every caller
   * that matters for load time — pays for the row once instead of once per column.
   */
  private heightIn(x: number, row: Row): number {
    const d = Math.abs(x - row.centre);
    const side = Math.sign(x - row.centre) || 1;

    // 0 across the floor, 1 at the rim.
    const t = clamp01((d - row.floorHalf) / CANYON.WALL_RUN);

    let y = row.floorY;

    // Floor relief, shelves and excavations only exist on the floor itself.
    const onFloor = 1 - smoothstep(t * 1.6);
    if (onFloor > 0.001) {
      y += this.floorDetail(x, row) * onFloor;
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
  private floorDetail(x: number, row: Row): number {
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

    // Excavations no longer carve their own walls — a Shaft builds those as geometry.
    // What is left here is the mouth: the floor still has to fall away where the bore
    // opens, or the collider polyline would span a hole the player can see through.
    //
    // `row.digs` holds only the digs this slice actually reaches, with their lip and
    // pit floor already resolved.
    for (const dig of row.digs) {
      const dd = Math.abs(x - dig.x);
      /**
       * The wall of the pit, in cells.
       *
       * This was a flat 6 units, and both of its problems came from that. A 170-unit
       * shaft dropping over 6 units of run is spanned by one or two quads — the "perfect
       * vertical plane", with no facets in it at all. Worse, 6 is not a whole number of
       * cells, so the lattice sampled the ramp at a different phase on each side of the
       * pit: one side landed mid-ramp and came out jagged, the other landed on the
       * endpoints and collapsed to a single plane. Whole cells sample both sides alike,
       * and four of them give the drop four stacked facets instead of one.
       *
       * A heightfield cannot do better than this for a vertical shaft — square facets on
       * a 170-unit drop would need a 170-unit shoulder, which is a crater, not a shaft.
       * Properly, shaft walls want to be authored props like `caveRoof` is.
       */
      // One cell. The shoulder used to be the wall — a ramp wide enough to look like
      // something — but the wall is a Shaft now, and all this has left to do is open the
      // mouth so the collider polyline falls into the bore instead of spanning it. Any
      // wider and the carve reaches sideways into whatever pad sits next to the pit: at
      // two cells it cost outpost-main 9% of its approach, at four cells 18%.
      const shoulder = CANYON.CELL;
      if (dd >= dig.halfWidth + shoulder) continue;

      const across = 1 - smoothstep(Math.max(0, dd - dig.halfWidth + dig.lip) / shoulder);
      y = lerp(y, dig.pit, across * dig.along);
    }

    return y;
  }

  /** Height across the canyon mouth — the plane the game is played on. */
  floorAt(x: number): number {
    return this.heightAt(x, 0);
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
   * Does this terrain quad sit over a shaft bore?
   *
   * Tested against the dig's nominal footprint, not the meandering bore, so the hole is
   * a clean rectangle. The bore is full width exactly at the mouth and only insets below
   * it, so the lining's top ring lands on this boundary and there is no rim gap to cover
   * — an inset here would leave terrain draped over the edges of the bore instead.
   */
  private overShaft(x0: number, x1: number, z0: number, z1: number): boolean {
    for (const dig of this.excavations) {
      const extent = (dig.lengthZ ?? dig.halfWidth * 3) / 2;
      const half = dig.halfWidth;
      if (
        Math.min(x0, x1) >= dig.x - half &&
        Math.max(x0, x1) <= dig.x + half &&
        Math.min(z0, z1) >= -extent &&
        Math.max(z0, z1) <= extent
      ) {
        return true;
      }
    }
    return false;
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
    this.shelves = [
      ...this.naturalShelves(),
      ...padSites.map((x) => ({ x, halfWidth: 9, shoulder: 10 })),
    ];
    this.buildProfile();

    this.physics.addPolyline(this.profile, 'rock');

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
     */
    for (const dig of this.excavations) {
      const floor = this.heightAt(dig.x, 0);
      const shaft = new Shaft(this.scene, dig, floor + dig.depth, this.seed);
      shaft.build(this.physics);
      this.shafts.push(shaft);
    }
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

    for (let r = 0; r < rows; r++) {
      const z = zs[r];
      // Once per slice rather than once per column: see `row`.
      const row = this.row(z);
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
        if (this.overShaft(xs[c], xs[c + 1], zs[r], zs[r + 1])) continue;
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

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0.02,
        flatShading: true,
      }),
    );
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
