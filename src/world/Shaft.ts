import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Noise, clamp01, lerp, smoothstep } from './Noise.ts';
import { CANYON, FACET_CELL, PALETTE } from './CanyonSpec.ts';
import type { Excavation, WallHoleBoundary, WallHoleEdge } from './CanyonGenerator.ts';

/**
 * A mined shaft, built as real geometry rather than carved out of the heightfield.
 *
 * The heightfield could only ever express a shaft as a step in a surface: a vertical
 * drop spanned by one quad, which is why the walls read as "pushed-down landscape".
 * Square facets on a 178-unit drop would need a 178-unit shoulder, which is a crater.
 * So the shaft is a prop, the same concession `caveRoof` already makes for overhangs —
 * and once it is a prop it can do things a heightfield cannot:
 *
 *   - meander, its bore wandering sideways as it descends, so the descent is a route
 *     rather than a chimney;
 *   - carry relief on the walls at the same facet size as the terrain;
 *   - light itself, which is what makes the bottom navigable at all;
 *   - travel in any direction at all, not just straight down — see `boreDirection`.
 *
 * The bore is the authority on collision. Its walls go into the physics world as two
 * polylines in x/y — which is exactly what a 2D collision world wants, and is why the
 * meander costs nothing to collide against even though it is an overhang in heightfield
 * terms.
 */

/** Vertical pitch of the wall grid. Matches the terrain so facets are the same size. */
const RING = CANYON.CELL;
/**
 * How far the bore may wander sideways, as a fraction of the dig's half-width.
 *
 * Proportional, not absolute. A flat 3 units is 25% of Kessler's shaft but 30% of the
 * Helion cavern, which is only 10 across — and at that share the cavern's bore narrowed
 * past its own cave roof and sealed the entrance, taking four missions to 0% reachable.
 * Capped as well, so a very wide dig does not get a wander big enough to swallow the
 * decks inside it.
 */
const WANDER_FRACTION = 0.12;
const WANDER_MAX = 2.5;
/** Wall relief, pushed outward into the rock — never inward. See `wallOffset`. */
const RELIEF = 2.6;

export interface ShaftSurface {
  /** Bore centre at this station. */
  cx: number;
  cy: number;
  /** Bore half-width at this station. */
  half: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** A mouth-ring point plus the `z` it was sampled at — `wallPoint` alone only gives
 *  x/y, and `buildCollar` needs the z to match against the terrain's own hole boundary
 *  (see `Shaft.mouthEdges`). */
export interface MouthEdgePoint extends Vec2 {
  z: number;
}

/**
 * A bore's direction, normalised, plus its perpendicular.
 *
 * Shared between `Shaft` and `CanyonGenerator` so the two never disagree about which
 * way a bore points and where its "sides" are — the terrain has to carve the mouth at
 * exactly the station geometry the bore itself was built from, or the visual hole and
 * the collision hole land in different places, which is a lander-sized problem.
 *
 * `perp` is `dir` rotated 90° so "side -1 / side +1" stays a stable, consistent pair of
 * faces regardless of which way `dir` actually points: side -1 is west/floor-ish for a
 * vertical bore, floor for a horizontal one — always the same rotation, never chosen
 * per-orientation, which is what lets every other formula here ignore orientation
 * entirely and just work in (station, side, z).
 */
export function boreDirection(dig: Excavation): { dir: Vec2; perp: Vec2 } {
  const raw = dig.direction ?? { x: 0, y: -1 };
  const mag = Math.hypot(raw.x, raw.y) || 1;
  const dir = { x: raw.x / mag, y: raw.y / mag };
  return { dir, perp: { x: -dir.y, y: dir.x } };
}

/** True for a bore close enough to straight-down that the heightfield's own dip-and-
 *  omit carving (see `CanyonGenerator.floorDetail`/`overShaft`) still applies to it. Not
 *  `=== -1` exactly, so a slightly wandering-down bore does not fall through the gap
 *  between the two carving strategies. */
export function isFloorMounted(dir: Vec2): boolean {
  return dir.y < -0.9;
}

export class Shaft {
  private scene: THREE.Scene;
  private noise: Noise;
  private objects: THREE.Object3D[] = [];

  readonly dig: Excavation;
  /** Where the bore begins, in the play plane. */
  readonly mouth: Vec2;
  private dir: Vec2;
  private perp: Vec2;
  /** Arc-length of the bore along `dir` — `dig.depth` under its general name. */
  private length: number;
  private lengthZ: number;

  constructor(scene: THREE.Scene, dig: Excavation, topY: number, seed: number) {
    this.scene = scene;
    this.dig = dig;
    this.mouth = { x: dig.x, y: topY };
    this.length = dig.depth;
    this.lengthZ = dig.lengthZ ?? dig.halfWidth * 3;

    const { dir, perp } = boreDirection(dig);
    this.dir = dir;
    this.perp = perp;

    // Seeded per shaft so two pits at different x never meander identically.
    this.noise = new Noise(seed + Math.round(dig.x * 7.3) + Math.round(dig.depth));
  }

  /**
   * The bore's cross-section at arc-length `s` from the mouth.
   *
   * `half` narrows toward the far end — a shaft that keeps its full width all the way
   * down reads as an extrusion. The centre wanders along `perp`, clamped so the bore
   * always stays inside the dig's nominal half-width: the terrain opens a hole of
   * exactly that size and the layout rules reserve entry lanes against it, so a bore
   * that strayed outside would sit behind rock the mesh has not removed.
   */
  boreAt(s: number): ShaftSurface {
    const t = clamp01(s / Math.max(1, this.length));
    /**
     * The bore is full width at the mouth and insets by `WANDER` just below it, and the
     * wander amplitude ramps in over the same distance. That does two jobs: the top ring
     * meets the terrain's hole exactly, so the mouth needs no separate collar, and the
     * wander is bounded by construction — the bore never leaves the dig's envelope, which
     * is what the terrain hole and the layout entry lanes are both sized against.
     *
     * The amplitude is small on purpose, and the reason is what lives inside these holes
     * rather than taste. Every unit of wander comes straight out of the clearance around
     * the decks and under the cave roofs, and both were sized when the bore was a fixed
     * rectangle. A pronounced meander needs the digs widened and their contents refitted
     * — a level-design change, not a constant.
     */
    const amp = Math.min(this.dig.halfWidth * WANDER_FRACTION, WANDER_MAX);
    const ramp = smoothstep(t * 3);
    const half = this.dig.halfWidth - amp * ramp;
    const wander = this.noise.fbm(s * 0.011, 211) * amp * ramp;
    return {
      cx: this.mouth.x + this.dir.x * s + this.perp.x * wander,
      cy: this.mouth.y + this.dir.y * s + this.perp.y * wander,
      half,
    };
  }

  /**
   * Outward displacement of a wall facet, quantised so the wall resolves into plates.
   *
   * Always positive: relief cuts *into* the rock, never into the bore. A facet bulging
   * inward would occlude space the collider reports as clear, which is the exact defect
   * that made the canyon read as "I'm behind textures" once before.
   */
  private wallOffset(s: number, z: number): number {
    const qs = Math.floor(s / FACET_CELL) * FACET_CELL;
    const qz = Math.floor(z / FACET_CELL) * FACET_CELL;
    const n = this.noise.ridge(qs * 0.03 + 5, qz * 0.05 + 31);
    // Absolute value, because `ridge` is signed: it returns -0.82..0.87, so using it
    // raw pushed the wall up to 2.1 units *into* the bore at some heights — the precise
    // defect this function's contract forbids. It pinched the shaft shut and took six
    // missions unreachable. Relief is one-sided by construction now, not by intent.
    return Math.abs(n) * RELIEF;
  }

  /** Bore edge point for a side (-1/+1 of `perp`), including outward relief. */
  private wallPoint(side: number, s: number, z: number): Vec2 {
    const bore = this.boreAt(s);
    const off = bore.half + this.wallOffset(s, z);
    return {
      x: bore.cx + side * this.perp.x * off,
      y: bore.cy + side * this.perp.y * off,
    };
  }

  // ------------------------------------------------------------------ build

  build(physics: PhysicsWorld): void {
    this.buildWalls();
    this.buildEndCap();
    this.buildLights();
    this.addColliders(physics);
  }

  private steps(): number[] {
    const ss: number[] = [];
    for (let s = 0; s < this.length + RING; s += RING) {
      ss.push(Math.min(s, this.length));
    }
    return ss;
  }

  private zs(): number[] {
    const half = this.lengthZ / 2;
    const out: number[] = [];
    for (let z = half; z > -half - CANYON.CELL; z -= CANYON.CELL) {
      out.push(Math.max(z, -half));
    }
    return out;
  }

  /**
   * The two side walls and the far end wall.
   *
   * There is deliberately no near wall. The shaft has to stay open toward the camera or
   * it would cap the bore off between the lens and the lander — the same reason the
   * canyon is a cross-section rather than a tube.
   */
  private buildWalls(): void {
    const steps = this.steps();
    const zs = this.zs();

    for (const side of [-1, 1]) {
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      for (let r = 0; r < steps.length; r++) {
        for (let c = 0; c < zs.length; c++) {
          const s = steps[r];
          const z = zs[c];
          const pt = this.wallPoint(side, s, z);
          positions.push(pt.x, pt.y, z);
          const shade = this.rockAt(s / this.length, 1 - Math.abs(z) / (this.lengthZ / 2));
          colors.push(shade.r, shade.g, shade.b);
        }
      }
      const w = zs.length;
      for (let r = 0; r < steps.length - 1; r++) {
        for (let c = 0; c < w - 1; c++) {
          const a = r * w + c;
          // Wound so the visible side faces into the bore, which is where the player is.
          if (side < 0) indices.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
          else indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
        }
      }
      this.addMesh(positions, colors, indices);
    }

    // Far end wall, spanning whatever the bore is doing at each station.
    const zFar = -this.lengthZ / 2;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const span = 6;
    for (let r = 0; r < steps.length; r++) {
      const s = steps[r];
      const west = this.wallPoint(-1, s, zFar);
      const east = this.wallPoint(1, s, zFar);
      for (let c = 0; c <= span; c++) {
        const x = lerp(west.x, east.x, c / span);
        const y = lerp(west.y, east.y, c / span);
        positions.push(x, y, zFar - this.wallOffset(s, x) * 0.5);
        const shade = this.rockAt(s / this.length, 0.25);
        colors.push(shade.r, shade.g, shade.b);
      }
    }
    for (let r = 0; r < steps.length - 1; r++) {
      for (let c = 0; c < span; c++) {
        const a = r * (span + 1) + c;
        // Wound so normal points into the bore (+Z towards player)
        indices.push(a, a + span + 1, a + 1, a + 1, a + span + 1, a + span + 2);
      }
    }
    this.addMesh(positions, colors, indices);
  }

  /** This bore's own opening ring at the mouth (`s = 0`), split into its two z-ordered
   *  curves the same way `buildWalls` already draws them — `neg`/`pos` by `perp` side,
   *  not by world x sign, so `buildCollar` establishes that correspondence itself
   *  rather than assuming it. Public so `CampaignPipeline.integration.test.ts` can
   *  verify it against `CanyonGenerator.wallHoleBoundary`'s own output. */
  mouthEdges(): { neg: MouthEdgePoint[]; pos: MouthEdgePoint[] } {
    const zs = this.zs();
    const neg = zs.map((z) => ({ ...this.wallPoint(-1, 0, z), z }));
    const pos = zs.map((z) => ({ ...this.wallPoint(1, 0, z), z }));
    return { neg, pos };
  }

  /** A point on a `WallHoleEdge` at a given `z`, linearly interpolated — both this
   *  bore's own mouth ring and the terrain's hole boundary are already monotonic in z
   *  by construction (see `CanyonGenerator.wallHoleBoundary`'s doc comment), so there
   *  is no arc-length parametrization or winding-direction problem to solve, only this. */
  private static lerpEdgeAtZ(edge: WallHoleEdge, z: number): { x: number; y: number; color: THREE.Color } {
    const pts = edge.points;
    const cols = edge.colors;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if ((z <= a.z && z >= b.z) || (z >= a.z && z <= b.z)) {
        const span = a.z - b.z;
        const t = span === 0 ? 0 : (a.z - z) / span;
        return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), color: cols[i].clone().lerp(cols[i + 1], t) };
      }
    }
    // Outside the edge's own z range — clamp to whichever end is closer, rather than
    // extrapolate a direction the terrain data never actually measured.
    const nearest = Math.abs(z - pts[0].z) <= Math.abs(z - pts[pts.length - 1].z) ? 0 : pts.length - 1;
    return { x: pts[nearest].x, y: pts[nearest].y, color: cols[nearest].clone() };
  }

  /**
   * Bridges `hole` — this dig's real terrain-hole boundary, or `null` if
   * `CanyonGenerator` couldn't recover a single clean one for this seed (see
   * `wallHoleBoundary`) — to this bore's own mouth ring with two triangle strips, so
   * the terrain and the bore stop being built from unrelated noise fields with no
   * shared edge. Wall-mounted digs only — `CanyonGenerator.build` is the only caller,
   * right after `build()`; a floor-mounted bore's own ring already lands on
   * `overShaft`'s exact rectangle within `RELIEF` (2.6 units), closer than this collar
   * would ever manage matching noise field to noise field, so nothing calls this there.
   *
   * Correspondence between the terrain's `low`/`high` (by world x) and this bore's own
   * `neg`/`pos` (by `perp` side, which flips with bore direction) is established once,
   * from each ring's own first point, rather than assumed from the naming.
   */
  buildCollar(hole: WallHoleBoundary | null): void {
    if (!hole) return;
    const { neg, pos } = this.mouthEdges();
    const negIsLow = neg[0].x <= pos[0].x;
    this.buildEdgeStrip(hole.low, negIsLow ? neg : pos);
    this.buildEdgeStrip(hole.high, negIsLow ? pos : neg);
  }

  private buildEdgeStrip(holeEdge: WallHoleEdge, ring: MouthEdgePoint[]): void {
    const positions: number[] = [];
    const colors: number[] = [];
    for (const ringPt of ring) {
      const holePt = Shaft.lerpEdgeAtZ(holeEdge, ringPt.z);
      positions.push(holePt.x, holePt.y, ringPt.z, ringPt.x, ringPt.y, ringPt.z);
      // Colour lerps between the terrain's own real colour and the lining's own real
      // colour at this station — position-only continuity still reads as a seam if the
      // colour jumps, so both real boundaries are reused rather than a guessed third.
      const lit = 1 - Math.abs(ringPt.z) / (this.lengthZ / 2);
      const shaftColor = this.rockAt(0, lit);
      const mixed = holePt.color.clone().lerp(shaftColor, 0.5);
      colors.push(mixed.r, mixed.g, mixed.b, mixed.r, mixed.g, mixed.b);
    }
    const indices: number[] = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    this.addMesh(positions, colors, indices);
  }

  /** Cap at the far end of the bore — a floor for a vertical shaft, a wall for anything
   *  that travels sideways. */
  private buildEndCap(): void {
    const zs = this.zs();
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const span = 6;
    /**
     * Rubble: the floor of a mine is spoil, not a machined pan — but only where gravity
     * actually pulls loose rock onto this cap. That is true at the bottom of a vertical
     * bore and false at the far wall of a sideways one; a faint version of the same
     * jitter smeared down a wall that should be flat rock reads as wrong texture, not as
     * no texture, so this is gated rather than just turned down.
     */
    const rubbly = isFloorMounted(this.dir);
    for (let c = 0; c < zs.length; c++) {
      for (let k = 0; k <= span; k++) {
        const west = this.wallPoint(-1, this.length, zs[c]);
        const east = this.wallPoint(1, this.length, zs[c]);
        const x = lerp(west.x, east.x, k / span);
        const y = lerp(west.y, east.y, k / span);
        const rubble = rubbly ? this.noise.fbm(x * 0.12 + 7, zs[c] * 0.12 + 19) * 1.6 : 0;
        positions.push(x, y + rubble, zs[c]);
        const shade = this.rockAt(1, 0.4);
        colors.push(shade.r, shade.g, shade.b);
      }
    }
    for (let c = 0; c < zs.length - 1; c++) {
      for (let k = 0; k < span; k++) {
        const a = c * (span + 1) + k;
        // Wound so normal points back toward the mouth (+Y towards the player, for the
        // vertical case this was authored against — see the winding note on `buildWalls`
        // for why an orientation-general form of this comment isn't attempted).
        indices.push(a, a + 1, a + span + 1, a + 1, a + span + 2, a + span + 1);
      }
    }
    this.addMesh(positions, colors, indices);
  }

  /**
   * Strip lights down both walls.
   *
   * The shaft was unnavigably dark, and the reason was never fog — at 12 units the
   * in-shaft fog removes under 3%. It was that nothing lit the walls: terrain colour
   * bottoms out at 0.4 below the rim and the nearest pad lamp contributes about 0.2 at
   * the far wall. Emissive strips fix it locally, at no cost to the light budget, and
   * they double as a depth cue on the way down.
   */
  private buildLights(): void {
    const spacing = 26;
    let lamp = 0;
    for (let s = 12; s < this.length - 6; s += spacing) {
      for (const side of [-1, 1]) {
        const bore = this.boreAt(s);
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.4, 6),
          new THREE.MeshStandardMaterial({
            color: 0xffd2a0,
            emissive: 0xffc088,
            emissiveIntensity: 2.4,
          }),
        );
        strip.position.set(
          bore.cx + side * this.perp.x * (bore.half - 0.35),
          bore.cy + side * this.perp.y * (bore.half - 0.35),
          -2,
        );
        this.scene.add(strip);
        this.objects.push(strip);
      }

      /**
       * A real lamp every third station.
       *
       * The strips glow but do not illuminate — emissive contributes nothing to other
       * surfaces — so on their own the walls stayed flat regardless of how much relief
       * the mesh carried. Facets only read when something lights them differentially.
       * Every third keeps the count to three or four per shaft, well inside the budget
       * that made lights the frame's bottleneck at thirteen.
       */
      if (lamp % 3 === 0) {
        const bore = this.boreAt(s);
        const light = new THREE.PointLight(0xffb877, 260, bore.half * 5, 1.9);
        light.position.set(bore.cx, bore.cy, -1);
        this.scene.add(light);
        this.objects.push(light);
      }
      lamp++;
    }
  }

  /**
   * The bore walls as physics. Two polylines in x/y at the play plane — which is all a
   * 2D collision world needs, and is what lets the bore meander freely even though the
   * result is an overhang no heightfield could hold.
   *
   * These start exactly at the mouth (`s = 0`), which matters more than it did when the
   * bore only ever went down: for a sideways bore this is the *entire* seal against the
   * opening above and below it, since the terrain's own profile — a single y per x —
   * cannot represent solid rock, a gap, then solid rock again at one x. `CanyonGenerator`
   * leans on that: it only has to stop *drawing and colliding* the wall at the mouth's
   * footprint, and these two polylines pick up the boundary from there.
   */
  private addColliders(physics: PhysicsWorld): void {
    for (const side of [-1, 1]) {
      const points: Vec2[] = [];
      for (let s = 0; s < this.length; s += RING) {
        points.push(this.wallPoint(side, s, 0));
      }
      points.push(this.wallPoint(side, this.length, 0));
      physics.addPolyline(points, 'rock');
    }
    // Cap at the far end of the bore.
    physics.addPolyline(
      [this.wallPoint(-1, this.length, 0), this.wallPoint(1, this.length, 0)],
      'rock',
    );
  }

  // ----------------------------------------------------------------- shared

  /**
   * Rock colour for the lining.
   *
   * Deliberately not very dark. The first version keyed off `rockLow` and then lerped
   * 75% toward near-black with depth, which left the walls rendering around 15%
   * brightness — every facet and every unit of relief was there in the geometry and none
   * of it was legible, so the shaft still read as a pushed-down surface. Depth reads
   * through the strip lights and the point lamps instead; the albedo's job is to let the
   * plates catch them.
   *
   * `t` is 0 at the mouth and 1 at the far end, replacing what used to be a height
   * fraction — the two agree exactly for a vertical bore and generalise correctly for
   * any other, since "how far into the mine" is what the colour was ever standing in for.
   */
  private rockAt(t: number, lit: number): THREE.Color {
    const c = new THREE.Color(PALETTE.rockMid);
    c.lerp(new THREE.Color(PALETTE.rockLow), clamp01(t) * 0.5);
    c.multiplyScalar(0.8 + clamp01(lit) * 0.25);
    return c;
  }

  private addMesh(positions: number[], colors: number[], indices: number[]): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        metalness: 0,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
    );
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  dispose(): void {
    for (const obj of this.objects) {
      this.scene.remove(obj);
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      mat?.dispose();
    }
    this.objects = [];
  }
}
