import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CORPS, type CorpId } from './CanyonSpec.ts';
import { LINK, type PlacedCell } from './ColonyOrganism.ts';
import { COLONY_LAYER_SPACING, type Lattice } from './ColonyLattice.ts';
import type { SubstrateField } from './ColonySubstrate.ts';
import type { ChannelNetwork } from '../campaign/ColonyChannels.ts';
import { fadeNearLander } from './LanderFade.ts';

/**
 * Draws a grown colony.
 *
 * Every choice here is read off something the simulation already produced — no new noise
 * field, no second opinion about what a cell is:
 *
 *   - **What a cell links to** decides its shape. One link is an end pod, two in line a
 *     can, two at a corner an elbow, three or more a hub drawn larger. The link set is
 *     real growth history (which neighbour this cell actually grew from or fused with),
 *     so the massing reads as something that spread outward from one point rather than a
 *     field of boxes that happen to touch.
 *   - **How new a cell is** decides whether it is built or bare frame. A cell on the
 *     colony's growing edge renders as scaffold, and is a hull module next mission — the
 *     one piece of campaign progression the player can verify by eye rather than take on
 *     trust.
 *
 * Merged down to three meshes per corp. A mature canyon carries a few hundred cells,
 * each several boxes, and one draw call per box would cost more than the whole terrain.
 */

/** Members of a scaffold cell's frame, as a fraction of the cell. Thin enough to read as
 *  open structure at flight distance, thick enough to survive the fog. */
const MEMBER = 0.055;

/** How much of its cell a built module fills, by how connected it is. Always short of
 *  the full bound — the same "a shape reads smaller than the bound it shares" convention
 *  used everywhere else in this codebase, and the margin is where the walkways land. */
function moduleScale(links: number): number {
  const degree = [LINK.east, LINK.west, LINK.up, LINK.down].filter((l) => (links & l) !== 0).length;
  if (degree >= 3) return 0.78; // a hub: several ways in, so it is the big room
  if (degree === 2) return 0.66;
  return 0.54; // an end pod
}

/**
 * How much deeper than wide a module is, and the reason the colony stopped reading as
 * tile-work.
 *
 * Modules used to be cubes: `moduleScale` gives 0.54–0.78 of a cell in x and y, and the
 * depth was `min(s, DEPTH.colony)` — a clamp at 15 that a 9-unit module never reached. So
 * every room was as deep as it was wide, the camera saw essentially one face of each, and
 * a settlement six cells across came out as flat as the wall behind it. A player has to be
 * able to tell the maze from the backdrop at a glance, and at flight distance the only
 * cues that survive the fog are silhouette and the different angle a *side* face catches
 * the light at. A cube seen head-on has neither.
 *
 * Elongating along z gives both.
 *
 * **A layer's modules must never reach into the next layer's**, which is why the cap is
 * derived from `COLONY_LAYER_SPACING` rather than written down beside it. Two constants
 * that have to agree, agreeing by coincidence, is how a later change to either one quietly
 * fuses the three layers into a slab — and the failure is not obvious, it just looks
 * slightly wrong. `LAYER_GAP` is the clear air left between them, which is what the
 * depth-dimming and the fog need somewhere to land.
 */
const MODULE_STRETCH = 1.6;
const LAYER_GAP = 5;

function moduleDepth(size: number, limit: number): number {
  return Math.min(size * MODULE_STRETCH, COLONY_LAYER_SPACING - LAYER_GAP, limit);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return geo;
}

/** One cell's open frame: four legs, two rings, one diagonal. The game's own lattice
 *  vocabulary at cell scale — deliberately not the X-brace placeholder the previous
 *  model used, which read as a flat star from the flight camera. */
function frameMembers(cell: PlacedCell, size: number, z: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const t = size * MEMBER;
  const h = size * 0.86;
  const hw = h / 2;
  for (const sx of [-hw, hw]) {
    for (const sz of [-hw, hw]) out.push(box(t, h, t, cell.x + sx, cell.y, z + sz));
  }
  for (const sy of [-hw, hw]) {
    for (const sz of [-hw, hw]) out.push(box(h, t, t, cell.x, cell.y + sy, z + sz));
    for (const sx of [-hw, hw]) out.push(box(t, t, h, cell.x + sx, cell.y + sy, z));
  }
  const diagonal = new THREE.BoxGeometry(t, h * 1.35, t);
  diagonal.rotateZ(Math.PI / 4);
  diagonal.translate(cell.x, cell.y, z - hw);
  out.push(diagonal);
  return out;
}

/**
 * How much a layer *behind* the play plane is darkened, per layer of distance.
 *
 * Aerial perspective doing the work a fog shader would: the layers are close enough
 * together that the camera's own perspective barely separates them at flight distance, so
 * without this the three read as one crowded plane and the play plane stops being legible.
 *
 * **Behind only, and tone only.** Two things used to happen here that no longer do, and
 * both were the same mistake in different clothes — faking distance that the scene already
 * expresses honestly.
 *
 * The first was applying this to `|layerZ|`, which treats the foreground layer as though it
 * were as far away as the background one: the layer nearest the camera came out darkened
 * while perspective drew it *larger* than everything else, because it sits two cells
 * closer. A near thing lit like a far thing reads as a separate object rather than as the
 * front of the same building.
 *
 * The second was shrinking the outer layers. A module is a module — the colony builds one
 * size of room, and drawing the back ones at 88% says the charter built smaller rooms
 * further back, which is not true and is visible the moment two layers meet at a corner.
 * Perspective already makes a further module smaller by exactly the right amount, and it
 * is the only source of that cue that stays correct as the camera moves.
 *
 * Tone survives because it is not faking geometry: fog and falling light genuinely darken
 * what is further into the canyon, and the renderer's own fog is too weak across a
 * two-cell gap to do it alone.
 */
const LAYER_DIM = 0.34;

export function buildColonyCells(
  scene: THREE.Scene,
  corp: CorpId,
  cells: PlacedCell[],
  cellSize: number,
  z: number,
  depth: number,
): THREE.Object3D[] {
  const theme = CORPS[corp];
  const objects: THREE.Object3D[] = [];

  /**
   * One merged mesh set **per layer**, not one for the whole colony.
   *
   * Three times the meshes — nine per corp rather than three — and worth it twice over: a
   * layer needs its own material to be dimmed or faded at all, and the front layer needs
   * to be transparent independently of the two behind it. Still merged within a layer, so
   * a few hundred cells stay a handful of draw calls rather than a few thousand.
   */
  const layers = new Map<number, PlacedCell[]>();
  for (const cell of cells) {
    const list = layers.get(cell.z) ?? [];
    list.push(cell);
    layers.set(cell.z, list);
  }

  for (const [layerZ, layerCells] of [...layers].sort((a, b) => a[0] - b[0])) {
    const front = layerZ > 0;
    /**
     * How far *behind* the play plane this layer sits, in layers. Zero for the play plane
     * and for anything in front of it — see `LAYER_DIM`. Measured in layers rather than
     * cell-widths because the spacing is two cells, and dividing by the cell size would
     * make the back layer twice as dim as intended.
     */
    const behind = Math.max(0, -layerZ) / COLONY_LAYER_SPACING;
    const hulls: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    const walks: THREE.BufferGeometry[] = [];
    const at = z + layerZ;

    for (const cell of layerCells) {
      if (cell.scaffold) {
        frames.push(...frameMembers(cell, cellSize, at));
      } else {
        const s = moduleScale(cell.links) * cellSize;
        const deep = moduleDepth(s, depth);
        hulls.push(box(s, s, deep, cell.x, cell.y, at));
        // A collar on the roof so a module isn't a bare cube — cheap, and it is what makes
        // a run of cans read as pressurised hardware rather than massing. Its own depth
        // follows the module's, or it reads as a fin stuck on the front of a long can.
        hulls.push(box(s * 0.42, s * 0.18, deep * 0.42, cell.x, cell.y + s * 0.56, at));
      }

      // Walkways, drawn once per edge: only the +x and +y halves of each link pair. Links
      // are within a layer by construction (`LINK` has no depth members), so a walkway
      // never spans front to back — there is nothing to draw there that would read.
      const t = cellSize * 0.16;
      if (cell.links & LINK.east) walks.push(box(cellSize, t, t, cell.x + cellSize / 2, cell.y, at));
      if (cell.links & LINK.up) walks.push(box(t, cellSize, t, cell.x, cell.y + cellSize / 2, at));
    }

    const shade = (hex: number): THREE.Color => new THREE.Color(hex).multiplyScalar(1 - LAYER_DIM * behind);
    // `transparent` has to be set at construction even though the material is opaque
    // almost everywhere: three.js decides the render queue from it, and flipping it later
    // forces a shader recompile mid-flight.
    const fade = front ? { transparent: true, depthWrite: false } : {};

    const add = (parts: THREE.BufferGeometry[], material: THREE.MeshStandardMaterial): void => {
      if (parts.length === 0) return;
      const merged = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!merged) return;
      // Fades around the vehicle so it can never hide it — see `LanderFade`. Every cell
      // in this layer sits in front of the play plane, so the depth gate is a formality.
      if (front) fadeNearLander(material, 0);
      const mesh = new THREE.Mesh(merged, material);
      // Only the play plane casts: a shadow from a layer the player cannot see lands on
      // the canyon floor with nothing above it to explain it.
      mesh.castShadow = layerZ === 0;
      // Behind everything opaque, so a faded front module never sorts in front of the
      // lander's own geometry.
      if (front) mesh.renderOrder = 1;
      scene.add(mesh);
      objects.push(mesh);
    };

    add(
      hulls,
      new THREE.MeshStandardMaterial({
        color: shade(theme.hull),
        roughness: 0.55,
        metalness: 0.18,
        flatShading: true,
        ...fade,
      }),
    );
    add(
      frames,
      new THREE.MeshStandardMaterial({
        color: shade(theme.hull),
        roughness: 0.85,
        metalness: 0.1,
        flatShading: true,
        ...fade,
      }),
    );
    add(
      walks,
      new THREE.MeshStandardMaterial({
        color: shade(theme.color),
        roughness: 0.4,
        metalness: 0.3,
        flatShading: true,
        ...fade,
      }),
    );
  }

  return objects;
}

/** Everything `?gizmos` needs to explain a colony's shape — the three inputs growth
 *  actually read, rather than its output. */
export interface ColonyDebug {
  lattice: Lattice;
  substrate: SubstrateField;
  network: ChannelNetwork;
}

/**
 * The debug view (`?gizmos`), rebuilt for the mycelial model: it draws the *reasons* a
 * colony stops where it does, not a recolouring of what it built.
 *
 * Three answers, in the order they decide anything:
 *   - **Cyan lines** — the flight channels themselves, deck to rim, one per live pad.
 *     The guarantee made visible: if a colony ever appeared to touch one of these, the
 *     bug would be in plain sight rather than inferred from a warning.
 *   - **Red wireframes** — cells inside a channel's clearance volume or a pad's deck
 *     keep-out. Nothing may ever grow here.
 *   - **White wireframes** — surface: open air touching rock, the skin growth creeps
 *     along. Solid rock and empty open air are both drawn as nothing, because a box for
 *     every cell of the canyon is a wall of lines you cannot see anything through.
 *
 * Every material is `fog: false` and `depthTest: false` — in-canyon fog is turned up
 * hard enough (see `updateAtmosphere`) to erase a cell near the far wall, and a
 * substrate cell is by definition right against opaque rock, which is exactly what it
 * needs to be legible against.
 */
export function buildColonyGizmos(scene: THREE.Scene, debug: ColonyDebug, z: number): THREE.Object3D[] {
  const { lattice, substrate, network } = debug;
  const objects: THREE.Object3D[] = [];
  const cell = new THREE.BoxGeometry(lattice.cellSize, lattice.cellSize, lattice.cellSize);
  const edges = new THREE.EdgesGeometry(cell);

  const surface: THREE.BufferGeometry[] = [];
  const reserved: THREE.BufferGeometry[] = [];
  for (let col = lattice.colLo; col <= lattice.colHi; col++) {
    for (let row = 0; row < lattice.rows; row++) {
      const blocked = network.blocked(col, row);
      const kind = substrate.at(col, row);
      if (!blocked && kind !== 'surface') continue;
      if (blocked && kind === 'solid') continue; // reserving rock says nothing
      const copy = edges.clone();
      copy.translate(lattice.worldX(col), lattice.worldY(row), z);
      (blocked ? reserved : surface).push(copy);
    }
  }

  const add = (parts: THREE.BufferGeometry[], colour: number, opacity: number): void => {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) return;
    const lines = new THREE.LineSegments(
      merged,
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, fog: false, depthTest: false }),
    );
    scene.add(lines);
    objects.push(lines);
  };
  add(surface, 0xffffff, 0.35);
  add(reserved, 0xff3b30, 0.7);

  for (const channel of network.channels) {
    const points = channel.points.map((p) => new THREE.Vector3(p.x, p.y, z));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x36f5a0, fog: false, depthTest: false }),
    );
    scene.add(line);
    objects.push(line);
  }

  cell.dispose();
  edges.dispose();
  return objects;
}
