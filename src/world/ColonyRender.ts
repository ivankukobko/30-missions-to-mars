import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CORPS, type CorpId } from './CanyonSpec.ts';
import { LINK, type PlacedCell } from './ColonyOrganism.ts';
import type { Lattice } from './ColonyLattice.ts';
import type { SubstrateField } from './ColonySubstrate.ts';
import type { ChannelNetwork } from '../campaign/ColonyChannels.ts';

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

export function buildColonyCells(
  scene: THREE.Scene,
  corp: CorpId,
  cells: PlacedCell[],
  cellSize: number,
  z: number,
  depth: number,
): THREE.Object3D[] {
  const theme = CORPS[corp];
  const hulls: THREE.BufferGeometry[] = [];
  const frames: THREE.BufferGeometry[] = [];
  const walks: THREE.BufferGeometry[] = [];

  for (const cell of cells) {
    if (cell.scaffold) {
      frames.push(...frameMembers(cell, cellSize, z));
    } else {
      const s = moduleScale(cell.links) * cellSize;
      hulls.push(box(s, s, Math.min(s, depth), cell.x, cell.y, z));
      // A collar on the roof so a module isn't a bare cube — cheap, and it is what makes
      // a run of cans read as pressurised hardware rather than massing.
      hulls.push(box(s * 0.42, s * 0.18, s * 0.42, cell.x, cell.y + s * 0.56, z));
    }

    // Walkways, drawn once per edge: only the +x and +y halves of each link pair.
    const t = cellSize * 0.16;
    if (cell.links & LINK.east) walks.push(box(cellSize, t, t, cell.x + cellSize / 2, cell.y, z));
    if (cell.links & LINK.up) walks.push(box(t, cellSize, t, cell.x, cell.y + cellSize / 2, z));
  }

  const objects: THREE.Object3D[] = [];
  const add = (parts: THREE.BufferGeometry[], material: THREE.Material): void => {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    scene.add(mesh);
    objects.push(mesh);
  };

  add(
    hulls,
    new THREE.MeshStandardMaterial({ color: theme.hull, roughness: 0.55, metalness: 0.18, flatShading: true }),
  );
  add(
    frames,
    new THREE.MeshStandardMaterial({ color: theme.hull, roughness: 0.85, metalness: 0.1, flatShading: true }),
  );
  add(
    walks,
    new THREE.MeshStandardMaterial({ color: theme.color, roughness: 0.4, metalness: 0.3, flatShading: true }),
  );
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
