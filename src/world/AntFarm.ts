import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { hash01 } from './Noise.ts';
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
/** Facets across one cell, and down the corridor's depth. Both whole by construction —
 *  `CANYON.CELL` divides `SHAFT_CELL / 2`, which is the same relationship that puts a
 *  mouth's boundary on a terrain vertex. See `CanyonSpec`. */
const PER_CELL = Math.round(SHAFT_CELL / FACET_PITCH);
const DEPTH_STEPS = Math.round(CORRIDOR_DEPTH / FACET_PITCH);

/**
 * How far a lattice point is moved off its grid position, per axis.
 *
 * This is what makes the rock rock, and it replaces `relief` and the two `emboss` passes
 * that displaced each surface separately. **A vertex is jittered once and every polygon
 * touching it uses that one position**, so the face, the back and the corridor walls
 * cannot come apart — which they did, repeatedly, for as long as each surface carried its
 * own displacement and they agreed only by arithmetic that had to keep being re-earned.
 *
 * Depth gets the larger share because it is free: z is the axis the camera looks down, so
 * jitter there is pure surface relief and costs the corridor nothing — **as long as it is
 * one-sided.** It shipped signed (`hash01() * 2 - 1`, applied to z the same as x and y),
 * which is exactly the fault the old `RELIEF` constant's comment recorded the cost of:
 * "a signed noise pushed walls into the bore and pinched it shut for six missions." Here
 * it pushed the face plate up to 2.5 units *toward the camera* of its own nominal plane —
 * proud of the corridor's own front boundary, poking into the volume the vehicle and the
 * lens both occupy, which read as geometry clipping close to the camera because that is
 * exactly what it was. `zJitter` below is the one-sided version: it only ever recedes.
 */
const JITTER_DEPTH = 2.5;
const JITTER_PLANE = 1.2;

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
  private objects: THREE.Object3D[] = [];
  readonly carve: ShaftCarve;
  private terrain: FaceTerrain;
  private ground = new Map<number, number>();
  /** Salted per excavation, so two shafts on one canyon are not the same rock twice. */
  private seed: number;

  constructor(scene: THREE.Scene, carve: ShaftCarve, terrain: FaceTerrain, seed: number) {
    this.scene = scene;
    this.carve = carve;
    this.terrain = terrain;
    this.seed = seed + Math.round(carve.grid.topY * 3.1) + carve.colLo * 17;
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
   *
   * Tested against the cell's own *centre*, not its top. It was the top (`+ SHAFT_CELL/2`)
   * until the shared complex's six-wide Helion gallery, which cuts only one row (12 units)
   * under a surface that rolls by a few units of its own accord. Requiring the *whole*
   * neighbour cell submerged demands ground reach a full 12 units above the shared
   * boundary; measured on `outpost-main`/seed 12345 the gallery's real overhead was
   * 8.1–9.9 units at every western column — genuine rock, just short of that bar — so the
   * ceiling and the mouth's west wall (row 0's own west neighbour was 2.1 units short of
   * *its* threshold the same way) were silently skipped across the whole span, reading as
   * see-through cave and a one-sided entrance. Halving the bar to the centre only asks for
   * half a nominal cell of overburden, which the measured gap clears with room, while the
   * open-sky cell directly above the mouth (its centre sits 6.3 units above the highest
   * ground either side, per the same measurement) stays correctly rejected — so the mouth
   * itself does not reseal. A true skylight would still show: this only forgives ordinary
   * terrain roughness, not an actual breach.
   */
  private isRock(col: number, row: number): boolean {
    if (this.carve.has(col, row)) return false;
    return this.carve.grid.worldY(row) <= this.groundAt(col);
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

  /**
   * The excavation as one indexed mesh, built on a lattice the whole thing shares.
   *
   * What this replaced: every surface was an independent `PlaneGeometry`, positioned and
   * then displaced by a field, and the three of them met only because that field was a pure
   * function of world position. That agreement was a coincidence the code had to keep
   * re-earning, and it broke every time one surface needed a displacement the others did
   * not have — a wall with no visible relief, then a wall with relief and gaps down both
   * sides, then a taper to close them. Three rounds of the same fault.
   *
   * Here a vertex is created once, at one position, and every polygon that touches that
   * corner indexes the same number. Gaps are not avoided; they are unrepresentable. It also
   * costs less: one buffer with three groups rather than several hundred plates merged.
   */
  build(physics: PhysicsWorld): void {
    const g = this.carve.grid;
    const face: number[] = [];
    const back: number[] = [];
    const walls: number[] = [];

    for (let row = this.carve.rowLo; row <= this.carve.rowHi + FACE_MARGIN; row++) {
      for (let col = this.carve.colLo - FACE_MARGIN; col <= this.carve.colHi + FACE_MARGIN; col++) {
        // Natural ground at this column, on the face's own plane — cells the ground has not
        // reached are open sky, not rock. Unchanged from the plate build, and still the
        // whole reason the excavation meets the terrain rather than nearly meeting it.
        //
        // Tested at the cell's centre, matching `isRock` below, for the same reason: the
        // strict top-based version dropped a cell's plate whenever ground missed its own
        // top by any amount, and at row 0 that miss can be a few tenths of a unit of
        // ordinary terrain roughness — measured case, the mouth's own west column losing
        // its back plate by 0.3 units out of 12. Being this permissive is safe now only
        // because `seamTopToTerrain` (called at the end of `build`) pulls every lattice
        // column's shallowest vertex down to the real surface afterwards — the plate can
        // never stand proud of the ground it approximated, whatever this test lets through.
        // Without that pass this same permissiveness measured 14 face vertices above real
        // terrain, worst case 7.6 units, at the `FACE_MARGIN` fringe where the canyon slopes
        // away — "rock through the floor," and the reason the two are a matched pair.
        if (g.worldY(row) > this.groundAt(col)) continue;

        const carved = this.carve.has(col, row);
        const into = carved ? back : face;
        const k = carved ? DEPTH_STEPS : 0;
        const i0 = col * PER_CELL - PER_CELL / 2;
        const j0 = row * PER_CELL;

        for (let di = 0; di < PER_CELL; di++) {
          for (let dj = 0; dj < PER_CELL; dj++) {
            this.quad(
              into,
              this.vertex(i0 + di, j0 + dj, k),
              this.vertex(i0 + di + 1, j0 + dj, k),
              this.vertex(i0 + di + 1, j0 + dj + 1, k),
              this.vertex(i0 + di, j0 + dj + 1, k),
            );
          }
        }
      }
    }

    /**
     * The corridor walls: one strip per boundary between a carved cell and solid rock.
     *
     * Walking the carved set rather than the whole box means a boundary is found once, from
     * the open side, so no wall is emitted twice or left facing into rock. Both orientations
     * come out of the same loop now — a wall is the edge between two cells extruded through
     * the corridor's depth, and whether that edge runs vertically or horizontally only
     * changes which lattice axis is held fixed.
     */
    for (const cell of this.carve.cells) {
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!this.isRock(cell.col + dc, cell.row + dr)) continue;

        const i0 = cell.col * PER_CELL - PER_CELL / 2;
        const j0 = cell.row * PER_CELL;
        // The edge they share, as lattice indices: one axis pinned to the boundary, the
        // other running the width of the cell.
        const pinI = dc === 1 ? i0 + PER_CELL : dc === -1 ? i0 : null;
        const pinJ = dr === 1 ? j0 + PER_CELL : dr === -1 ? j0 : null;

        for (let step = 0; step < PER_CELL; step++) {
          const aI = pinI ?? i0 + step;
          const aJ = pinJ ?? j0 + step;
          const bI = pinI ?? i0 + step + 1;
          const bJ = pinJ ?? j0 + step + 1;

          for (let k = 0; k < DEPTH_STEPS; k++) {
            this.quad(
              walls,
              this.vertex(aI, aJ, k),
              this.vertex(bI, bJ, k),
              this.vertex(bI, bJ, k + 1),
              this.vertex(aI, aJ, k + 1),
            );
          }
        }
      }
    }

    // Last, so every quad above is already indexed against `this.points` — this only ever
    // moves points that exist, never creates or reorders them. See the method's own comment.
    this.seamTopToTerrain();

    /**
     * `rockCut`, not `rockMid` — an excavation is cut open the mission it is dug, so
     * nothing has settled on it yet. `PALETTE.rockCut`/`rockCutLow` are that: the one
     * surface in this canyon allowed to be *fresh* rock rather than the weathered,
     * dust-worked rock the exterior wall and floor are shaded from. See `ColorScheme`'s
     * own doc comment for where the colour comes from.
     */
    this.addMesh([
      { indices: face, colour: PALETTE.rockCut },
      { indices: back, colour: PALETTE.rockCutLow },
      { indices: walls, colour: PALETTE.rockCut },
    ]);
    this.addColliders(physics);
    this.buildLights();
  }

  /** Shared vertex buffer, and the cache that makes it shared. */
  private points: number[] = [];
  private seen = new Map<number, number>();
  /**
   * The shallowest vertex seen so far for each `(i, k)` lattice column — the one
   * `seamTopToTerrain` pulls down to the real surface. Keyed on a plain string rather than
   * a packed integer: unlike `seen`, this map is small (one entry per column, not per
   * lattice point) and built once per excavation, so the packing's speed is not worth its
   * risk here — `i` and `k` are far enough apart in range that a bit-packed key can collide
   * silently, where `${i},${k}` cannot. `j` is carried alongside the point index rather
   * than recovered from it later, so "shallowest" is a plain comparison, not an inverse of
   * `vertex`'s own displacement math.
   */
  private topOfColumn = new Map<string, { idx: number; j: number }>();

  /**
   * The index of the lattice point at `(i, j, k)`, creating it on first request.
   *
   * The cache is the whole mechanism. Two polygons asking for the same corner get the same
   * index, so they are joined by construction rather than by both being displaced the same
   * way — which is the property every previous version of this file lacked.
   *
   * Keyed on a packed integer rather than a string: this is called several times per facet
   * across a twenty-five row shaft, and the key is the hot path.
   */
  private vertex(i: number, j: number, k: number): number {
    const key = ((i + 4096) << 20) | ((j + 512) << 8) | k;
    const hit = this.seen.get(key);
    if (hit !== undefined) return hit;

    const g = this.carve.grid;
    const at = this.points.length / 3;
    this.points.push(
      i * FACET_PITCH + this.jitter(i, j, k, 1) * JITTER_PLANE,
      g.topY - j * FACET_PITCH + this.jitter(i, j, k, 2) * JITTER_PLANE,
      FRONT_Z - k * FACET_PITCH - this.zJitter(i, j, k) * JITTER_DEPTH,
    );
    this.seen.set(key, at);

    // Smaller `j` is shallower (closer to `topY`) — see `worldY`'s own comment. Recorded
    // once per `(i, k)`, on creation, because every later request for the same `(i, j, k)`
    // is a cache hit above and never reaches here.
    const ik = `${i},${k}`;
    const shallowest = this.topOfColumn.get(ik);
    if (shallowest === undefined || j < shallowest.j) this.topOfColumn.set(ik, { idx: at, j });
    return at;
  }

  /**
   * Welds the shallowest vertex of every lattice column to the real terrain surface —
   * generate the grid and the excavation's own geometry first, at its ordinary nominal
   * positions, then match only this outermost ring to the landscape, once, after the fact.
   *
   * This is what makes the per-cell visibility tests upstream (`isRock`, and the plate
   * loop's own ground check) safe to be as permissive as closing every real gap requires:
   * however far a cell's nominal top overshoots real ground, only its *shallowest* vertex
   * per column is a candidate here, and it is only ever pulled *down* — never pushed up,
   * so a column already meeting the ground exactly (the ordinary case, deep in the
   * excavation) is untouched. A side wall, sharing its pinned edge's `(i, k)` columns with
   * whatever plate sits beside it, is welded by the same pass without needing its own case:
   * the cache that joins their vertices in the first place is what makes one welded point
   * do for both.
   *
   * Sampled with `includeDigs: false`, matching `groundAt` — the undisturbed surface this
   * excavation was cut from, not the pit its own floor now reads as.
   */
  private seamTopToTerrain(): void {
    for (const { idx } of this.topOfColumn.values()) {
      const x = this.points[idx * 3];
      const z = this.points[idx * 3 + 2];
      const ground = this.terrain.heightAt(x, z, false);
      if (this.points[idx * 3 + 1] > ground) this.points[idx * 3 + 1] = ground;
    }
  }

  /** Signed, in −1…1, and a pure function of the lattice index and the campaign seed — so a
   *  rebuilt canyon is the identical rock, and neighbouring facets agree because they are
   *  asking about the same point rather than about their own corner of it. In-plane only —
   *  see `zJitter` for why depth cannot use this. */
  private jitter(i: number, j: number, k: number, salt: number): number {
    return hash01(this.seed, i, j * 64 + k, salt) * 2 - 1;
  }

  /**
   * `0…1`, never negative, subtracted rather than added — so a vertex can only ever recede
   * from its nominal plane, into the rock, and never advance out of it toward the camera.
   *
   * This is the one-sided rule every displacement in this file answers to, and depth is
   * the one axis where breaking it is a *visible* fault rather than a cosmetic one: a face
   * plate that jitters toward the viewer stops sitting at the corridor's own front boundary
   * and starts standing proud of it, in the volume the vehicle and the lens both use. Across
   * and down (`jitter`, used for x and y) have no such hazard — nothing there is bounded by
   * where the camera happens to be — which is why only this one is signed away from zero.
   */
  private zJitter(i: number, j: number, k: number): number {
    return hash01(this.seed, i, j * 64 + k, 3);
  }

  /** Two triangles, wound consistently. The materials are `DoubleSide`, so this decides
   *  the normals `computeVertexNormals` produces and nothing else. */
  private quad(into: number[], a: number, b: number, c: number, d: number): void {
    into.push(a, b, c, a, c, d);
  }

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

  /**
   * One geometry, one shared vertex buffer, three material groups.
   *
   * The three surfaces are different stone — the back is darker than the face, which is
   * most of what makes an excavation read as a hole rather than a dent — but they are one
   * *mesh*, because they share corners and splitting them into separate geometries would
   * mean three copies of those corners and three chances to drift apart. Groups give
   * different materials over one buffer, which is exactly the shape of the problem.
   */
  private addMesh(groups: Array<{ indices: number[]; colour: number }>): void {
    const indices: number[] = [];
    const geometry = new THREE.BufferGeometry();
    const materials: THREE.Material[] = [];

    for (const group of groups) {
      if (group.indices.length === 0) continue;
      geometry.addGroup(indices.length, group.indices.length, materials.length);
      indices.push(...group.indices);
      /**
       * Lifted, deliberately — the same correction `Shaft.rockAt` carried.
       *
       * Keyed straight off the palette these walls rendered around 15% brightness: every
       * facet was in the geometry and none of it was legible, so the excavation read as a
       * pushed-in surface rather than a cut one. Depth is carried by the lamps and by the
       * back wall being a darker stone than the face; the albedo's only job is to let the
       * facets catch what light there is.
       */
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(group.colour).multiplyScalar(1.35),
        roughness: 1,
        metalness: 0,
        flatShading: true,
        side: THREE.DoubleSide,
        transparent: true,
      });
      // Rock in front of the play plane thins over the vehicle, as the canyon face already
      // does — see `LanderFade`. The gate means the back wall, which sits behind the plane,
      // stays solid and the excavation still reads as a hole.
      fadeNearLander(material, 0);
      materials.push(material);
    }
    if (indices.length === 0) return;

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.points, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, materials);
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  dispose(): void {
    for (const obj of this.objects) {
      this.scene.remove(obj);
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      // An array now: the excavation is one mesh carrying a material per surface group.
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
    this.objects = [];
    this.points = [];
    this.seen.clear();
  }
}
