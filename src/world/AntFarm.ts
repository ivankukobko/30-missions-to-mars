import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Noise } from './Noise.ts';
import { CANYON, PALETTE } from './CanyonSpec.ts';
import { fadeNearLander } from './LanderFade.ts';
import { SHAFT_CELL, type ShaftCarve } from './ShaftGrid.ts';

/**
 * An excavation drawn as an ant farm: a face of rock with corridors cut into it.
 *
 * What this replaces is a *tube* — two side walls converging on a far cap, meandering as it
 * went, with a collar stitching its mouth to whatever the terrain happened to be doing at
 * that x. Every seam defect this canyon has had came from that arrangement, and none of them
 * were really seam bugs: the bore and the ground were built from unrelated vocabularies, so
 * the two could only be *bridged* and never joined, and a bridge between two noise fields is
 * a thing you keep re-fixing.
 *
 * Carved on a grid, the join stops being a problem to solve. The rock face is a vertical
 * plane whose **top edge is sampled from the terrain, per column, at its own z** — so it does
 * not meet the ground approximately, it starts at it. There is no collar because there is
 * nothing to bridge.
 *
 * Three surfaces, and the whole read comes out of which one you are looking at:
 *
 *   - **The face**, at `FRONT_Z`, over every cell the excavation did *not* take. This is the
 *     wall the player sees when they go underground.
 *   - **The back**, at `BACK_Z`, over every cell it did. Seen *through* the corridors, which
 *     is what makes them read as recessed rather than as holes onto nothing.
 *   - **The returns** between the two, at every boundary between carved and solid. These are
 *     the corridor walls, and they are the only surface the vehicle can actually hit.
 */

/**
 * How far the corridor floor sits in front of and behind the play plane.
 *
 * Asymmetric on purpose. The camera looks from `+z`, so the useful volume is *behind* the
 * vehicle, not in front of it — and every unit of rock in front is a unit that can come
 * between the lens and the hull. Six units is enough for the face to read as a solid wall
 * with depth to it and little enough that `fadeNearLander` has an easy job.
 */
export const FRONT_Z = SHAFT_CELL * 0.5;
const CORRIDOR_DEPTH = SHAFT_CELL * 2;
export const BACK_Z = FRONT_Z - CORRIDOR_DEPTH;

/**
 * How many facets a cell face is broken into, per axis — **derived so the facet pitch is
 * the terrain's own.**
 *
 * It was `SHAFT_CELL / FACET_CELL`, which is two, giving a plate vertices every six units
 * while the displacement was quantised to `FACET_CELL`'s eight. Most plates therefore had
 * every vertex land in one bucket and came out perfectly flat: the subdivision was there,
 * the relief was there, and none of it varied. Matching the pitch to `CANYON.CELL` — the
 * step the terrain mesh itself facets at — means a shaft wall breaks up at the same grain
 * as the rock around it, which is also why the two read as the same material.
 */
const FACET_PITCH = CANYON.CELL;
const FACETS = Math.max(2, Math.round(SHAFT_CELL / FACET_PITCH));

/** Relief, cut *into* the rock and never out of it — the one-sided rule `Shaft.wallOffset`
 *  learned the hard way, when a signed noise pushed walls into the bore and pinched it shut
 *  for six missions. Depth away from the viewer can never occlude what a collider says is
 *  clear. */
const RELIEF = 2.6;

/** How far past the carve the face is drawn, in cells. Without a margin the wall ends flush
 *  with the outermost corridor and the excavation reads as floating in a void rather than as
 *  something cut into a mass of rock. */
const FACE_MARGIN = 3;

/** One point lamp per this many carved cells. See `buildLights`. */
const LAMP_EVERY = 9;

/** What an ant farm needs from the terrain: the natural ground at a point, so the face can
 *  start exactly where the rock does. Narrow like every other terrain boundary here. */
export interface FaceTerrain {
  heightAt(x: number, z: number, includeDigs?: boolean): number;
}

export class AntFarm {
  private scene: THREE.Scene;
  private noise: Noise;
  private objects: THREE.Object3D[] = [];
  readonly carve: ShaftCarve;
  private terrain: FaceTerrain;
  private ground = new Map<number, number>();

  constructor(scene: THREE.Scene, carve: ShaftCarve, terrain: FaceTerrain, seed: number) {
    this.scene = scene;
    this.carve = carve;
    this.terrain = terrain;
    this.noise = new Noise(seed + Math.round(carve.grid.topY * 3.1) + carve.colLo * 17);
  }

  /**
   * Natural ground on the face's own plane at this column, cached.
   *
   * Sampled at `FRONT_Z` rather than at 0 deliberately: the face lives on that plane, so
   * asking the terrain the same question at the same depth is what makes the two *meet*
   * rather than nearly meet. It is also the whole seam fix, so it is worth only computing
   * once per column — every cell in a column asks it.
   */
  private groundAt(col: number): number {
    const hit = this.ground.get(col);
    if (hit !== undefined) return hit;
    const y = this.terrain.heightAt(this.carve.grid.worldX(col), FRONT_Z, false);
    this.ground.set(col, y);
    return y;
  }

  /**
   * Whether a cell is solid rock — **not carved *and* under the ground.**
   *
   * The second half is not a detail. Taking "not carved" alone as "rock" put a wall across
   * the top of row 0, because the cell above the mouth is not carved either — it is open
   * sky. The shaft came out sealed, flyable by eye and not at all in fact, which is the
   * exact class of defect a screenshot cannot show and the reason the test that found it
   * asks whether the axis can be swept rather than whether a mesh looks right.
   */
  private isRock(col: number, row: number): boolean {
    if (this.carve.has(col, row)) return false;
    return this.carve.grid.worldY(row) + SHAFT_CELL / 2 <= this.groundAt(col);
  }

  /**
   * Lateral room to each wall at a point, or `null` outside the excavation — the reading the
   * shaft gauge in `Instruments` takes.
   *
   * Exact here, where the tube's version was an approximation: the answer is the distance to
   * the first solid cell either side, and on a grid that is a walk rather than a projection
   * onto a meandering axis.
   */
  clearanceAt(x: number, y: number): { left: number; right: number } | null {
    const g = this.carve.grid;
    const col = g.colAt(x);
    const row = g.rowAt(y);
    if (!this.carve.has(col, row)) return null;
    let west = col;
    while (this.carve.has(west - 1, row)) west--;
    let east = col;
    while (this.carve.has(east + 1, row)) east++;
    return {
      left: x - (g.worldX(west) - SHAFT_CELL / 2),
      right: g.worldX(east) + SHAFT_CELL / 2 - x,
    };
  }

  build(physics: PhysicsWorld): void {
    const face: THREE.BufferGeometry[] = [];
    const back: THREE.BufferGeometry[] = [];
    const returns: THREE.BufferGeometry[] = [];
    const g = this.carve.grid;

    for (let row = this.carve.rowLo; row <= this.carve.rowHi + FACE_MARGIN; row++) {
      for (let col = this.carve.colLo - FACE_MARGIN; col <= this.carve.colHi + FACE_MARGIN; col++) {
        const cx = g.worldX(col);
        const cy = g.worldY(row);
        // Natural ground at this column, on the face's own plane. Sampling at `FRONT_Z`
        // rather than at 0 is the whole seam fix: the face and the terrain are then the same
        // function of the same x at the same depth, so they meet rather than nearly meet.
        // Cells the ground has not reached yet are open sky, not rock.
        if (cy + SHAFT_CELL / 2 > this.groundAt(col)) continue;

        if (this.carve.has(col, row)) {
          back.push(this.plate(cx, cy, BACK_Z));
          continue;
        }
        face.push(this.plate(cx, cy, FRONT_Z));
      }
    }

    // The corridor walls: one return per boundary between a carved cell and solid rock.
    // Walking the carved set rather than the whole box means a boundary is found once, from
    // the open side, so no return is ever emitted twice or left facing into rock.
    for (const cell of this.carve.cells) {
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!this.isRock(cell.col + dc, cell.row + dr)) continue;
        returns.push(this.returnWall(cell.col, cell.row, dc, dr));
      }
    }

    this.addMesh(face, PALETTE.rockMid);
    this.addMesh(back, PALETTE.rockLow);
    this.addMesh(returns, PALETTE.rockMid);
    this.addColliders(physics);
    this.buildLights();
  }

  /**
   * One cell of wall, broken into facets and pushed *away* from the viewer by noise.
   *
   * Quantised to `FACET_CELL` so neighbouring plates agree along their shared edge — the
   * displacement is a function of world position, not of which plate is asking, so a run of
   * cells reads as one rock face with relief rather than as tiles that each wobble alone.
   */
  /**
   * How far the rock is pushed back at a point — **one field, shared by every surface.**
   *
   * This is the whole answer to the side walls detaching from the face. They were separate
   * surfaces with separate treatment: the face plates were embossed back by up to a couple
   * of units while the returns sat flat at `FRONT_Z`, so their shared edge was in two
   * different places and the gap between them varied along its length. No amount of
   * matching facet *counts* fixes that, because the two were not evaluating the same
   * function.
   *
   * Displacing everything by `relief(x, y)` in z makes the excavation one embossed field
   * rather than three surfaces that have to be reconciled. A corridor keeps its exact depth
   * — front and back move together — and an edge shared by two surfaces is the same points
   * on both, by construction rather than by tolerance.
   *
   * Quantised to the terrain's own facet pitch, and always negative: relief cuts back into
   * the rock, never forward into space a collider has already called clear. `Math.abs`
   * because `ridge` is signed — the precise slip that once pinched a bore shut.
   */
  private relief(x: number, y: number): number {
    const qx = Math.floor(x / FACET_PITCH) * FACET_PITCH;
    const qy = Math.floor(y / FACET_PITCH) * FACET_PITCH;
    return -Math.abs(this.noise.ridge(qx * 0.11 + 3, qy * 0.11 + 11)) * RELIEF;
  }

  /** Embosses a positioned geometry with `relief`. Every surface goes through this, which
   *  is what guarantees they meet. */
  private emboss(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, pos.getZ(i) + this.relief(pos.getX(i), pos.getY(i)));
    }
    return geo;
  }

  /** One cell of wall, broken into facets. */
  private plate(cx: number, cy: number, z: number): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry(SHAFT_CELL, SHAFT_CELL, FACETS, FACETS);
    geo.translate(cx, cy, z);
    return this.emboss(geo);
  }

  /** The wall between a carved cell and the solid one beside it, spanning front to back. */
  private returnWall(col: number, row: number, dc: number, dr: number): THREE.BufferGeometry {
    const g = this.carve.grid;
    const half = SHAFT_CELL / 2;
    const geo = new THREE.PlaneGeometry(SHAFT_CELL, CORRIDOR_DEPTH, FACETS, FACETS);
    // A vertical boundary (a neighbour east or west) is a plane facing along x; a horizontal
    // one faces along y. Both are the same plate turned, which is why this is a rotation
    // rather than two builders.
    if (dc !== 0) geo.rotateY(Math.PI / 2);
    else geo.rotateX(Math.PI / 2);
    // **Minus `dr`.** Rows count *downward* from the mouth (`ShaftGrid.worldY`), so the
    // neighbour at `row + 1` sits at a *lower* y and the boundary they share is below this
    // cell's centre, not above it. Written as `+ dr` this drew every floor as a ceiling and
    // every ceiling as a floor — which capped the shaft one cell early and, since a lid
    // looks exactly like the rock beside it, was invisible except by trying to fly through.
    geo.translate(g.worldX(col) + dc * half, g.worldY(row) - dr * half, (FRONT_Z + BACK_Z) / 2);
    // Embossed by the same field as the face and the back, so its front edge lands exactly
    // where the face's does and its back edge exactly where the back's does. This is the
    // only reason the three meet at all.
    return this.emboss(geo);
  }

  /**
   * The corridor boundary as physics — the same set the returns are drawn from, so what
   * stops the vehicle is exactly what it can see.
   *
   * Segments in x/y at the play plane, which is all a 2D collision world needs and is what
   * the tube already did with its two polylines. The difference is that a maze has no two
   * sides to walk: the boundary is wherever carved meets solid, and enumerating it per cell
   * is both simpler than tracing loops and immune to a loop being traced the wrong way.
   */
  private addColliders(physics: PhysicsWorld): void {
    const g = this.carve.grid;
    const half = SHAFT_CELL / 2;
    for (const cell of this.carve.cells) {
      const cx = g.worldX(cell.col);
      const cy = g.worldY(cell.row);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!this.isRock(cell.col + dc, cell.row + dr)) continue;
        const mx = cx + dc * half;
        // Minus `dr` — rows count downward. See `returnWall`, where the same sign sealed
        // the shaft.
        const my = cy - dr * half;
        // The edge runs across the direction of the neighbour: an east wall is a vertical
        // segment, a floor is a horizontal one.
        const ex = dc !== 0 ? 0 : half;
        const ey = dc !== 0 ? half : 0;
        physics.addPolyline(
          [
            { x: mx - ex, y: my - ey },
            { x: mx + ex, y: my + ey },
          ],
          'rock',
        );
      }
    }
  }

  /**
   * Strip lights down the corridors.
   *
   * Same finding as the tube's: the underground is unnavigably dark without them, and not
   * because of fog — at these distances the in-shaft fog removes almost nothing. It is that
   * nothing lights the rock. Emissive only, for the reason `Shaft.buildLights` recorded when
   * real lamps made lights the frame's bottleneck at thirteen.
   */
  private buildLights(): void {
    const g = this.carve.grid;
    const material = new THREE.MeshStandardMaterial({
      color: 0xffd2a0,
      emissive: 0xffc088,
      emissiveIntensity: 2.4,
    });
    const strips: THREE.BufferGeometry[] = [];
    for (const cell of this.carve.cells) {
      // One strip every other cell along a corridor, on the wall side rather than floating
      // mid-air: enough to read the run of a passage without lighting every metre of it.
      if ((cell.col + cell.row) % 2 !== 0) continue;
      const solidEast = !this.carve.has(cell.col + 1, cell.row);
      const solidWest = !this.carve.has(cell.col - 1, cell.row);
      if (!solidEast && !solidWest) continue;
      const side = solidEast ? 1 : -1;
      const geo = new THREE.BoxGeometry(0.5, SHAFT_CELL * 0.7, 0.5);
      geo.translate(g.worldX(cell.col) + side * (SHAFT_CELL / 2 - 0.6), g.worldY(cell.row), BACK_Z + 2);
      strips.push(geo);
    }
    /**
     * A real lamp every few cells, because the strips do not light anything.
     *
     * `Shaft.buildLights` recorded this and I ported only half of it: emissive contributes
     * nothing to other surfaces, so strips alone leave the walls flat no matter how much
     * relief the mesh carries — facets only read when something lights them differentially.
     * The excavation came out as a black slab with glowing lines in it.
     *
     * Sparse for the reason that comment also gives: lamps were once the frame's bottleneck
     * at thirteen. One per `LAMP_EVERY` cells of corridor keeps a whole excavation to a
     * handful, which is what the old bore settled on too.
     */
    for (const cell of this.carve.cells) {
      if ((cell.col * 31 + cell.row) % LAMP_EVERY !== 0) continue;
      const light = new THREE.PointLight(0xffb877, 210, SHAFT_CELL * 4.5, 1.9);
      light.position.set(g.worldX(cell.col), g.worldY(cell.row), BACK_Z + CORRIDOR_DEPTH * 0.4);
      this.scene.add(light);
      this.objects.push(light);
    }

    if (strips.length === 0) return;
    const merged = mergeGeometries(strips, false);
    for (const s of strips) s.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, material);
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  private addMesh(parts: THREE.BufferGeometry[], base: number): void {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) return;
    merged.computeVertexNormals();
    /**
     * Lifted, deliberately — the same correction `Shaft.rockAt` carried.
     *
     * Keyed straight off the palette these walls rendered around 15% brightness: every facet
     * and every unit of relief was in the geometry and none of it was legible, so the
     * excavation read as a pushed-in surface rather than a cut one. Depth is carried by the
     * lamps and by the back wall being a darker stone than the face; the albedo's only job
     * is to let the plates catch what light there is.
     */
    const colour = new THREE.Color(base).multiplyScalar(1.35);
    const material = new THREE.MeshStandardMaterial({
      color: colour,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
      transparent: true,
    });
    // Rock in front of the play plane thins over the vehicle, as the bore's own walls and
    // the canyon face already do — see `LanderFade`. The gate means the back wall, which
    // sits behind the plane, stays solid and the excavation still reads as a hole.
    fadeNearLander(material, 0);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  dispose(): void {
    for (const obj of this.objects) {
      this.scene.remove(obj);
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    }
    this.objects = [];
  }
}
