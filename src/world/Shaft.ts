import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Noise, clamp01, lerp, smoothstep } from './Noise.ts';
import { CANYON, FACET_CELL, PALETTE } from './CanyonSpec.ts';
import type { Excavation } from './CanyonGenerator.ts';

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
 *   - light itself, which is what makes the bottom navigable at all.
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
  /** Bore centre at this height. */
  cx: number;
  /** Bore half-width at this height. */
  half: number;
}

export class Shaft {
  private scene: THREE.Scene;
  private noise: Noise;
  private objects: THREE.Object3D[] = [];

  readonly dig: Excavation;
  /** Mouth height: where the bore meets the canyon floor. */
  readonly topY: number;
  readonly bottomY: number;
  private lengthZ: number;

  constructor(scene: THREE.Scene, dig: Excavation, topY: number, seed: number) {
    this.scene = scene;
    this.dig = dig;
    this.topY = topY;
    this.bottomY = topY - dig.depth;
    this.lengthZ = dig.lengthZ ?? dig.halfWidth * 3;
    // Seeded per shaft so two pits at different x never meander identically.
    this.noise = new Noise(seed + Math.round(dig.x * 7.3) + Math.round(dig.depth));
  }

  /**
   * The bore at a given height.
   *
   * `half` narrows toward the bottom — a shaft that keeps its full width all the way
   * down reads as an extrusion. The centre wanders, clamped so the bore always stays
   * inside the dig's nominal half-width: the terrain opens a hole of exactly that size
   * and the layout rules reserve entry lanes against it, so a bore that strayed outside
   * would sit behind rock the mesh has not removed.
   */
  boreAt(y: number): ShaftSurface {
    const t = clamp01((this.topY - y) / Math.max(1, this.dig.depth));
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
    const wander = this.noise.fbm(y * 0.011, 211) * amp * ramp;
    return { cx: this.dig.x + wander, half };
  }

  /**
   * Outward displacement of a wall facet, quantised so the wall resolves into plates.
   *
   * Always positive: relief cuts *into* the rock, never into the bore. A facet bulging
   * inward would occlude space the collider reports as clear, which is the exact defect
   * that made the canyon read as "I'm behind textures" once before.
   */
  private wallOffset(y: number, z: number): number {
    const qy = Math.floor(y / FACET_CELL) * FACET_CELL;
    const qz = Math.floor(z / FACET_CELL) * FACET_CELL;
    const n = this.noise.ridge(qy * 0.03 + 5, qz * 0.05 + 31);
    // Absolute value, because `ridge` is signed: it returns -0.82..0.87, so using it
    // raw pushed the wall up to 2.1 units *into* the bore at some heights — the precise
    // defect this function's contract forbids. It pinched the shaft shut and took six
    // missions unreachable. Relief is one-sided by construction now, not by intent.
    return Math.abs(n) * RELIEF;
  }

  /** Bore edge x for a side (-1 west, +1 east), including outward relief. */
  private wallX(side: number, y: number, z: number): number {
    const bore = this.boreAt(y);
    return bore.cx + side * (bore.half + this.wallOffset(y, z));
  }

  // ------------------------------------------------------------------ build

  build(physics: PhysicsWorld): void {
    this.buildWalls();
    this.buildFloor();
    this.buildLights();
    this.addColliders(physics);
  }

  private rows(): number[] {
    const ys: number[] = [];
    for (let y = this.topY; y > this.bottomY - RING; y -= RING) {
      ys.push(Math.max(y, this.bottomY));
    }
    return ys;
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
    const ys = this.rows();
    const zs = this.zs();

    for (const side of [-1, 1]) {
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      for (let r = 0; r < ys.length; r++) {
        for (let c = 0; c < zs.length; c++) {
          const y = ys[r];
          const z = zs[c];
          positions.push(this.wallX(side, y, z), y, z);
          const shade = this.rockAt(y, 1 - Math.abs(z) / (this.lengthZ / 2));
          colors.push(shade.r, shade.g, shade.b);
        }
      }
      const w = zs.length;
      for (let r = 0; r < ys.length - 1; r++) {
        for (let c = 0; c < w - 1; c++) {
          const a = r * w + c;
          // Wound so the visible side faces into the bore, which is where the player is.
          if (side < 0) indices.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
          else indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
        }
      }
      this.addMesh(positions, colors, indices);
    }

    // Far end wall, spanning whatever the bore is doing at each height.
    const zFar = -this.lengthZ / 2;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const span = 6;
    for (let r = 0; r < ys.length; r++) {
      const y = ys[r];
      const west = this.wallX(-1, y, zFar);
      const east = this.wallX(1, y, zFar);
      for (let c = 0; c <= span; c++) {
        const x = lerp(west, east, c / span);
        positions.push(x, y, zFar - this.wallOffset(y, x) * 0.5);
        const shade = this.rockAt(y, 0.25);
        colors.push(shade.r, shade.g, shade.b);
      }
    }
    for (let r = 0; r < ys.length - 1; r++) {
      for (let c = 0; c < span; c++) {
        const a = r * (span + 1) + c;
        // Wound so normal points into the bore (+Z towards player)
        indices.push(a, a + span + 1, a + 1, a + 1, a + span + 1, a + span + 2);
      }
    }
    this.addMesh(positions, colors, indices);
  }

  /** Floor slab at the bottom of the bore. */
  private buildFloor(): void {
    const y = this.bottomY;
    const zs = this.zs();
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const span = 6;
    for (let c = 0; c < zs.length; c++) {
      for (let k = 0; k <= span; k++) {
        const west = this.wallX(-1, y, zs[c]);
        const east = this.wallX(1, y, zs[c]);
        const x = lerp(west, east, k / span);
        // Rubble: the floor of a mine is spoil, not a machined pan.
        const rubble = this.noise.fbm(x * 0.12 + 7, zs[c] * 0.12 + 19) * 1.6;
        positions.push(x, y + rubble, zs[c]);
        const shade = this.rockAt(y, 0.4);
        colors.push(shade.r, shade.g, shade.b);
      }
    }
    for (let c = 0; c < zs.length - 1; c++) {
      for (let k = 0; k < span; k++) {
        const a = c * (span + 1) + k;
        // Wound so normal points upwards into the bore (+Y towards player)
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
    for (let y = this.topY - 12; y > this.bottomY + 6; y -= spacing) {
      for (const side of [-1, 1]) {
        const bore = this.boreAt(y);
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.4, 6),
          new THREE.MeshStandardMaterial({
            color: 0xffd2a0,
            emissive: 0xffc088,
            emissiveIntensity: 2.4,
          }),
        );
        strip.position.set(bore.cx + side * (bore.half - 0.35), y, -2);
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
        const bore = this.boreAt(y);
        const light = new THREE.PointLight(0xffb877, 260, bore.half * 5, 1.9);
        light.position.set(bore.cx, y, -1);
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
   */
  private addColliders(physics: PhysicsWorld): void {
    for (const side of [-1, 1]) {
      const points: { x: number; y: number }[] = [];
      for (let y = this.topY; y > this.bottomY; y -= RING) {
        points.push({ x: this.wallX(side, y, 0), y });
      }
      points.push({ x: this.wallX(side, this.bottomY, 0), y: this.bottomY });
      physics.addPolyline(points, 'rock');
    }
    // Floor of the bore.
    const zs = 0;
    const west = this.wallX(-1, this.bottomY, zs);
    const east = this.wallX(1, this.bottomY, zs);
    physics.addPolyline(
      [
        { x: west, y: this.bottomY },
        { x: east, y: this.bottomY },
      ],
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
   */
  private rockAt(y: number, lit: number): THREE.Color {
    const t = clamp01((this.topY - y) / Math.max(1, this.dig.depth));
    const c = new THREE.Color(PALETTE.rockMid);
    c.lerp(new THREE.Color(PALETTE.rockLow), t * 0.5);
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
