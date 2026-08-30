import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CORPS, STRUCTURE, type CorpId } from './CanyonSpec.ts';
import { LINK, TRAIT, type PlacedCell } from './ColonyOrganism.ts';
import {
  COLONY_LAYER_GAP,
  COLONY_LAYER_SPACING,
  COLONY_VESSEL_RADIUS,
  type Lattice,
} from './ColonyLattice.ts';
import type { SubstrateField } from './ColonySubstrate.ts';
import type { ChannelNetwork } from '../campaign/ColonyChannels.ts';
import { patchDepth } from './LanderFade.ts';

/**
 * Draws a grown colony.
 *
 * Every choice here is read off something the simulation already produced — no new noise
 * field, no second opinion about what a cell is:
 *
 *   - **What a cell links to** decides what it is *part of*. `colonyRuns` merges joined,
 *     supported, built cells into one pressure vessel — vertical first, so the silhouette
 *     is standing pipework rather than sprawl. The link set is real growth history (which
 *     neighbour a cell actually grew from or fused with), so a vessel is a thing that
 *     genuinely grew as one piece rather than boxes that happen to touch.
 *   - **Whether it is supported** decides built or bare. A cell with rock or its own
 *     structure beneath it is a sealed vessel; one thrown out over open air is an unclad
 *     frame, and becomes a vessel on the mission a floor appears under it. That is the one
 *     piece of campaign progression the player can verify by eye rather than take on trust.
 *   - **What is beside it** decides its fittings — `TRAIT`, set in `ColonyPlan`. A lane to
 *     east or west hangs beacons on that flank; everything else carries only its corp mark.
 *
 * Merged down to a handful of meshes per corp — hull, frame, walkway, beacon, mark, once
 * per transparency class. A mature canyon carries a few hundred cells, each several pieces,
 * and one draw call apiece would cost more than the whole terrain.
 */

/**
 * Members of a scaffold cell's frame, as a fraction of the cell. Thin enough to read as
 * open structure at flight distance, thick enough to survive the fog.
 *
 * Taken down about a third from 0.055, for the same reason the vessels lost a third of their
 * section: heavy members read as though structural steel were plentiful. At this weight a
 * frame reads as wire — which is what a charter would actually fly up here, and which lets
 * the corp nodes at its corners carry the eye instead of the members.
 */
const MEMBER = 0.038;

/**
 * `moduleScale` used to live here: 0.54 of a cell for an end pod, 0.66 for a can, 0.78 for
 * a hub, so a module's size announced how connected it was.
 *
 * Gone, and the reason is worth keeping. It meant two *joined* modules were routinely
 * different widths, and the stepped, mismatched edge that produced was the single strongest
 * favela signal in the whole colony — an accretion of salvaged boxes rather than a built
 * settlement. Connectivity is still read, by `colonyRuns`, but it now decides *what merges
 * into one vessel* rather than how fat each cell is. One hull spec per charter is both more
 * plausible and what lets a merged run read as a single pipe.
 */

/**
 * How deep a vessel is: **as deep as it is wide.**
 *
 * Modules were stretched along z for a long time — up to 2.4× their own width — because
 * they were boxes, and a cube seen head-on gives the camera neither a silhouette nor a side
 * face catching light at a different angle, so a settlement six cells across came out as
 * flat as the wall behind it. Elongating fixed that at the cost of turning every module into
 * a tube pointed at the lens.
 *
 * A cylinder does not need the trick. Its section is round, so *every* view of it has a
 * curved edge and a lit side; the depth cue is in the shape rather than in the proportions.
 * Circular also means the vessel is honest about what it is — a pressure hull with one
 * radius — and it is what lets the layers sit close together, since there is nothing to
 * hold apart but the vessels themselves.
 *
 * The clamp stays as the guarantee it always was: **a layer's vessels must never reach into
 * the next layer's**, and it is derived from the spacing rather than written down beside it.
 * With the spacing now derived from the same diameter, the two cannot drift apart at all —
 * see `COLONY_LAYER_SPACING`.
 */
function moduleDepth(size: number, limit: number): number {
  return Math.min(size, COLONY_LAYER_SPACING - COLONY_LAYER_GAP, limit);
}

/**
 * The massing vocabulary: what a run is built as, read off how far it has reached from
 * something that actually holds it up.
 *
 * A refinery does not build one module everywhere it can reach — it stands tanks where the
 * ground or the wall behind it is doing the work of holding the structure up, and it thins
 * to pipe and lattice the further a run gets from either. That taper was missing here:
 * every cell built the identical pressure vessel whether it was bolted straight to rock or
 * hung two cells out over open air, so a mature colony read as one module repeated rather
 * than as a settlement with a foundation and a reach.
 *
 * An earlier version of this read absolute height above the canyon floor instead, on the
 * reasoning that a colony climbing toward the rim is a colony reaching skyward. Measured
 * against what the simulation actually knows, that was the wrong axis: a cell can stand
 * high on the canyon wall and still be planted straight into rock — grounded, not
 * reaching — and the height proxy drew it as a mast anyway, thinning exactly the structure
 * that should have read as most secure. `PlacedCell.reach` is the fact worth reading
 * instead: `reachOf`'s own count of cantilever steps from rock, ground, or the corp's own
 * roof, frozen onto the cell the mission it was built. `0` means bolted to something solid
 * regardless of how far up the wall that something is; `MAX_CANTILEVER` means as far from
 * support as growth is ever allowed to leave it. That is literally "how far from the
 * ground or the wall", in the simulation's own units, not a height read off the world and
 * hoped to correlate.
 */
type MassClass = 'tank' | 'room' | 'mast';

/**
 * `reachOf` only ever returns 0, 1 or `MAX_CANTILEVER` (2) for a claimed cell — anything
 * past that is rejected outright, never merely penalised. Three legal values map onto the
 * vocabulary with nothing left to threshold: standing on something is a tank, one step of
 * bracing off a supported neighbour is a room, and the maximum the simulation allows is a
 * mast — the furthest a charter is ever let hang a module from what holds it.
 */
function massClassOf(reach: number): MassClass {
  if (reach <= 0) return 'tank';
  if (reach >= 2) return 'mast';
  return 'room';
}

/**
 * Hull radius by class, as a fraction of `COLONY_VESSEL_RADIUS` — never above 1. That
 * ceiling is not a style choice: `COLONY_LAYER_SPACING` is derived from the vessel radius
 * specifically so a layer's structures can never reach into the next layer's, so widening a
 * tank beyond today's baseline would reopen a collision the spacing was built to close.
 * Everything the taper needs comes from going thinner, never fatter — a mast three-fifths
 * as thin as a standard vessel reads as pipe and steelwork without touching that guarantee.
 */
const RADIUS_SCALE: Record<MassClass, number> = { tank: 1, room: 1, mast: 0.42 };

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return geo;
}


/**
 * A pressure vessel, which is what a module on Mars actually is.
 *
 * Boxes were the favela signal. A habitat holds atmosphere against near-vacuum, and pressure
 * vessels are round for a reason nobody gets to design around — so a cylinder reads as
 * engineered where a cube reads as improvised, before any detail is added. Merged along its
 * own run it becomes one continuous pipe rather than a stack of cans, which is the industrial
 * silhouette the references are built out of.
 *
 * **Eight sides, not smooth.** The game is hard-faceted throughout — `flatShading`,
 * fixed-segment lathe hulls, lattice bracing — and a smooth cylinder would be the one
 * rounded thing in the canyon. Eight facets at flight distance reads as a cylinder and as
 * part of the same object vocabulary.
 *
 * The section is scaled to `depth`, which is now the diameter — so it is a true circle, and
 * the `scale` call is a no-op the clamp is free to change its mind about. It was elliptical
 * while the colony still needed the z-elongation a box demanded; see `moduleDepth`.
 */
const PIPE_SIDES = 8;

function pipe(
  radius: number,
  length: number,
  depth: number,
  axis: 'x' | 'y',
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius, radius, length, PIPE_SIDES);
  // `CylinderGeometry` stands on y; a lying pipe is the same vessel turned a quarter turn.
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  geo.scale(1, 1, depth / (radius * 2));
  geo.translate(x, y, z);
  return geo;
}

/** One cell's open frame: four legs, two rings. The game's own lattice vocabulary at cell
 *  scale — deliberately not the X-brace placeholder the previous model used, which read
 *  as a flat star from the flight camera. Once carried a single diagonal of its own, on
 *  the back face; retired once a *built* cell's cage grew eight, converging on the centre
 *  instead of bracing one face — an unbuilt cell's plain twelve-edge cube reads as the
 *  vocabulary's own empty case beside that, not as a cube that is merely missing one line. */
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
  return out;
}

/** One open twelve-edge cube, `size` on a side — the same shape `frameMembers` draws for
 *  a bare cell, generalised only in size, never in proportion: every cage in this file,
 *  bare or built, is a cube, not a box stretched to whatever it happens to hold. */
function cageBox(cx: number, cy: number, z: number, size: number, t: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = size / 2;
  for (const sx of [-h, h]) {
    for (const sz of [-h, h]) out.push(box(t, size, t, cx + sx, cy, z + sz));
  }
  for (const sy of [-h, h]) {
    for (const sz of [-h, h]) out.push(box(size, t, t, cx, cy + sy, z + sz));
    for (const sx of [-h, h]) out.push(box(t, t, size, cx + sx, cy + sy, z));
  }
  return out;
}

/** A thin box running from one point to another — a strut, not a member on any one
 *  cube's own axis. `BoxGeometry`'s long side is local Y by construction, so aligning it
 *  is one quaternion between "up" and the strut's own direction, the general case of the
 *  single `rotateZ(Math.PI / 4)` diagonal `frameMembers` uses when that direction happens
 *  to be a flat 45°. */
function strut(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, t: number): THREE.BufferGeometry {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  const geo = new THREE.BoxGeometry(t, len, t);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize()));
  geo.translate((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  return geo;
}

/**
 * The cage around one *built* cell: an open cube with eight diagonal struts running from
 * its corners to the centre, where the actual hull, room or pipe stands. Sized and drawn
 * **per cell**, exactly like a bare cell's own `frameMembers`, never stretched along a
 * merged run — a run's pipe or hull is one continuous piece, but the claim is still made
 * one cell at a time, so a three-cell vessel wears three cages, not one three-cell-long
 * box wearing a costume.
 *
 * The cube is the same `size * 0.86` a bare cell's own cage uses — the volume a charter
 * claims does not change with what went up inside it. The struts used to stop short, at a
 * smaller nested cube's own corner; there is no second cube any more (a wireframe echo of
 * geometry already standing there was drawing the same shape twice), so they run all the
 * way to the point that geometry is centred on instead of stopping in open air partway.
 *
 * Corner marks on the cube, in the badge material (`marks`) rather than structural steel —
 * the same fitting a bare cell's own corners already carry, and what actually makes a
 * cage legible at flight distance: wireframe alone reads as texture on the hull behind it
 * until something on its corners catches the eye first.
 */
function cellCage(cx: number, cy: number, z: number, size: number): { frame: THREE.BufferGeometry[]; marks: THREE.BufferGeometry[] } {
  const outer = size * 0.86;
  const t = size * MEMBER;
  const half = outer / 2;

  const frame = [...cageBox(cx, cy, z, outer, t)];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        frame.push(strut(cx + sx * half, cy + sy * half, z + sz * half, cx, cy, z, t * 0.6));
      }
    }
  }

  const node = outer * 0.13;
  const marks: THREE.BufferGeometry[] = [];
  for (const sx of [-half, half]) {
    for (const sy of [-half, half]) {
      for (const sz of [-half, half]) marks.push(box(node, node, node, cx + sx, cy + sy, z + sz));
    }
  }
  return { frame, marks };
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

/**
 * Thickness of every emissive fitting, as a fraction of the face it is mounted on.
 *
 * **Emissive only, no `PointLight`.** `Shaft.buildLights` records why: real lamps were the
 * frame's bottleneck at thirteen, and a mature canyon carries these on hundreds of cells. An
 * emissive strip contributes nothing to the light budget and, per that same comment, is what
 * actually survives the fog at flight distance — the strips down a bore are legible long
 * before anything they fail to illuminate is.
 *
 * Corp colour rather than a lamp white, matching the walkways: the useful thing to read at a
 * glance is not that the lane is lit but *whose* frontage is lighting it, which is the one
 * piece of territory information the massing alone cannot carry.
 *
 * Thin, and it has been thinned twice. Fittings this small are read as *lines* — an outline
 * traced on a shape — and a line stays a line at any distance, where a lit panel just becomes
 * a bright blob and every module ends up wearing one.
 */
const LAMP_THICK = 0.09;

/**
 * The corp colour as a *light* rather than as paint.
 *
 * Emissive fed straight from `theme.color` came out pale, and the cause is the renderer's
 * ACES filmic tone mapping (`Game.ts`): it lifts highlights and **desaturates as it lifts**,
 * which is what makes film highlights believable and what turns a cyan lamp white. The
 * corp colours are also already light — Kessler's is a pale cyan — so they start most of the
 * way to the top of the curve before the lamp's own intensity is applied.
 *
 * Both halves are corrected here. Saturation goes to full, and lightness is pulled *down*,
 * which reads backwards until you remember the intensity multiplier comes afterwards: a
 * darker, fully saturated base has room to be lifted and still arrive with its hue intact,
 * where a pale base simply clips. The colour going in has to be more saturated than the
 * colour wanted out.
 */
function neon(hex: number, lightness: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, 1, Math.min(hsl.l, lightness));
}



/**
 * The longest run of cells drawn as one building.
 *
 * Four rather than unbounded because the point is a *vocabulary* — pods, cans, hubs and now
 * halls — not "the wider the better". A run of nine merged into one box stops reading as a
 * structure with parts and starts reading as the bounding volume of one, which is the exact
 * quality the per-cell massing was built to avoid. Four is also where the roof collar still
 * looks like a fitting rather than a stripe.
 */
const MAX_RUN = 4;

/**
 * Contiguous horizontal runs that render as a single building.
 *
 * **A render decision over a settled cell set, not a growth decision.** Nothing here claims
 * ground, so budget, `reachOf`, the cantilever limit and the route-demolition rule are all
 * untouched, and — the part that makes it safe — the merged hull sits inside the union of
 * the full-cell colliders those cells already carry (`Colony.buildColonyStructure`), whose
 * standing rule is that what you see may be leaner than what stops you but never fatter.
 * Growth places one cell at a time, as it always did.
 *
 * It also means demolition needs no special case: a channel cut through the middle of a
 * three-cell hall arrives *before* this runs, so what is left is two shorter buildings.
 * The lane reads as having been cut through the block, which is what happened.
 *
 * Gated on `TRAIT.grounded` and on built hulls. A cantilevered hall reads as a mistake at
 * any width, and merging scaffold would erase the one piece of campaign progression the
 * player can verify by eye.
 *
 * **Ordered by row then column, never by the order cells arrive**, because the greedy scan
 * below is only deterministic if its input is. `ColonyPlan` happens to sort by x first
 * today; depending on that would make this correct by coincidence, and a colony that merged
 * differently on a retry is the same unfairness a shifting demolition would be.
 */
export interface ColonyBuilding {
  cells: PlacedCell[];
  /** The run's own direction — `'y'` for a standing pipe, `'x'` for a lying one. A single
   *  cell is reported as `'y'`, so an unmerged colony is still a field of standing sections
   *  rather than a special case the renderer has to carry. */
  axis: 'x' | 'y';
}

const AXES = {
  y: { across: (c: PlacedCell) => c.x, along: (c: PlacedCell) => c.y, ahead: LINK.up, behind: LINK.down },
  x: { across: (c: PlacedCell) => c.y, along: (c: PlacedCell) => c.x, ahead: LINK.east, behind: LINK.west },
} as const;

function mergeable(c: PlacedCell): boolean {
  return !c.scaffold && (c.traits & TRAIT.grounded) !== 0;
}

/** Greedy runs along one axis, over a canonically sorted input. Both axes share this so
 *  neither can drift from the other in what counts as joined. */
function runsAlong(cells: PlacedCell[], cellSize: number, axis: 'x' | 'y'): PlacedCell[][] {
  const a = AXES[axis];
  const sorted = [...cells].sort((p, q) => a.across(p) - a.across(q) || a.along(p) - a.along(q));
  const runs: PlacedCell[][] = [];
  let run: PlacedCell[] = [];
  for (const cell of sorted) {
    const prev = run[run.length - 1];
    // Half a cell of tolerance on both axes: these are lattice-derived world coordinates,
    // so the comparison is really "same line, next station" and an exact float equality
    // would be asking arithmetic to round the way this expression hopes it does.
    const joins =
      prev !== undefined &&
      run.length < MAX_RUN &&
      mergeable(prev) &&
      mergeable(cell) &&
      Math.abs(a.across(cell) - a.across(prev)) < cellSize * 0.5 &&
      Math.abs(a.along(cell) - a.along(prev) - cellSize) < cellSize * 0.5 &&
      // Adjacent is not enough — they have to be *joined*. Two cells that grew from
      // different filaments and happen to touch are two buildings that share a wall, and
      // the link mask is the only record of which of those two things happened.
      (prev.links & a.ahead) !== 0 &&
      (cell.links & a.behind) !== 0;
    if (joins) {
      run.push(cell);
    } else {
      if (run.length > 0) runs.push(run);
      run = [cell];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * **Vertical first, then horizontal over what is left.**
 *
 * Two axes means a cell could belong to either — a 2×2 block is two standing pipes or two
 * lying ones, and something has to choose or the same cell ends up drawn twice. A fixed
 * priority is the cheapest resolution that keeps the partition exact, and vertical wins
 * because that is the silhouette this colony is short of: a settlement of horizontal runs
 * reads as sprawl, and standing pipes give the tall industrial masses the whole look is
 * aiming at. Horizontal runs still form wherever a row had no vertical claim on it, which
 * is what keeps the massing from becoming a comb.
 */
export function colonyRuns(cells: PlacedCell[], cellSize: number): ColonyBuilding[] {
  const claimed = new Set<PlacedCell>();
  const out: ColonyBuilding[] = [];

  for (const axis of ['y', 'x'] as const) {
    const free = cells.filter((c) => !claimed.has(c));
    for (const run of runsAlong(free, cellSize, axis)) {
      // Singles are left for the next pass — a cell alone on this axis may still be part
      // of a run on the other, and claiming it here would forbid that.
      if (run.length < 2) continue;
      out.push({ cells: run, axis });
      for (const c of run) claimed.add(c);
    }
  }
  for (const cell of cells) if (!claimed.has(cell)) out.push({ cells: [cell], axis: 'y' });

  // Canonical output order, so the geometry is emitted identically on a replay regardless
  // of which pass happened to find each building.
  out.sort(
    (p, q) =>
      p.cells[0].y - q.cells[0].y || p.cells[0].x - q.cells[0].x || p.axis.charCodeAt(0) - q.axis.charCodeAt(0),
  );
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
  const objects: THREE.Object3D[] = [];

  /**
   * One merged mesh set **per transparency class**, not per layer.
   *
   * It used to be per layer, for one reason: `LAYER_DIM` was a multiply on each material's
   * `color`, so a layer needed its own material to be dimmed at all. That is now a fragment
   * multiply keyed off world z (`patchDepth`), which removes the only thing that forced the
   * split — and with it the rule that no piece of geometry may span two layers, which is
   * what a depth merge will need.
   *
   * What survives is a genuine two-way split the player can feel. Everything in front of the
   * play plane must be `transparent` with `depthWrite: false` so it can thin around the
   * vehicle; the play plane itself must write depth. So: near and solid, and the boundary
   * between them is a gameplay requirement rather than a rendering convenience.
   *
   * Shadows follow the class. The back layer now casts along with the play plane, which was
   * previously avoided on the grounds that a shadow from a layer the player cannot see has
   * nothing above it to explain it — accepted deliberately, because keeping it would have
   * meant a third class and put layers -1 and 0 back in separate meshes, defeating the
   * change.
   */
  const near: PlacedCell[] = [];
  const solid: PlacedCell[] = [];
  for (const cell of cells) (cell.z > 0 ? near : solid).push(cell);

  for (const [isNear, classCells] of [
    [false, solid],
    [true, near],
  ] as const) {
    if (classCells.length === 0) continue;
    const hulls: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    const walks: THREE.BufferGeometry[] = [];
    const beacons: THREE.BufferGeometry[] = [];
    const marks: THREE.BufferGeometry[] = [];

    // Runs are still found one layer at a time — merging *across* layers is a separate
    // change, and this one only removes the batching that would have blocked it.
    const layers = new Map<number, PlacedCell[]>();
    for (const cell of classCells) {
      const list = layers.get(cell.z) ?? [];
      list.push(cell);
      layers.set(cell.z, list);
    }

    for (const [layerZ, layerCells] of [...layers].sort((a, b) => a[0] - b[0])) {
      const at = z + layerZ;

      for (const building of colonyRuns(layerCells, cellSize)) {
        const run = building.cells;
        const span = run.length;
        const first = run[0];
        const last = run[span - 1];
        const vertical = building.axis === 'y';
        /**
         * One radius for every vessel, and a *full* cell of length per section.
         *
         * `moduleScale` used to set this per cell — 0.54 for an end pod, 0.78 for a hub — so
         * two joined modules were visibly different widths and the whole mass came out
         * stepped and ragged. That mismatch was the strongest favela signal we produced.
         * A charter running one pressure hull spec is both more plausible and what makes a
         * merged run read as one pipe instead of a stack of tins.
         *
         * The section is `cellSize` long rather than inset, so consecutive sections meet.
         * Poking a little into rock where a pipe meets the canyon wall is fine and reads as
         * a vessel set into the cliff, which is what a real habitat would do for shielding.
         *
         * The radius itself now varies by `massClassOf` — see that function's own comment
         * for why cantilever, not ownership, decides it, and why the scale only ever goes
         * thinner than this baseline rather than fatter.
         */
        const length = span * cellSize;
        const cx = (first.x + last.x) / 2;
        const cy = (first.y + last.y) / 2;
        // The run's *worst*-supported cell, not its average — a merged run is only as
        // grounded as the member furthest from what holds it up, the same way a chain is
        // only as strong as its weakest link. `colonyRuns` never merges more than
        // `MAX_RUN` cells, so this is at most three comparisons.
        const reach = Math.max(...run.map((c) => c.reach));
        const massClass = massClassOf(reach);
        const radius = cellSize * COLONY_VESSEL_RADIUS * RADIUS_SCALE[massClass];
        const deep = moduleDepth(radius * 2, depth);
        const faceZ = deep / 2;
        const face = radius * 2;
        // The building's own extent across the flank the lane lamps hang on: its diameter
        // when it stands, its full length when it lies.
        const width = vertical ? face : length;
        const bare = span === 1 && first.scaffold;
        /**
         * Mast bodies are fabricated steelwork rather than a cast pressure hull, and the
         * material says so: the same `frames` group a bare scaffold already renders in,
         * rather than the regolith `hulls` every tank and vessel uses. One extra branch,
         * no extra draw call — a mast's pipe and flanges land in whichever array its class
         * already points at.
         */
        const shell = massClass === 'mast' ? frames : hulls;
        if (bare) {
          frames.push(...frameMembers(first, cellSize, at));
          /**
           * Corp lights at the frame's eight corners.
           *
           * A bare lattice has no surface to carry a fitting, so it used to say nothing about
           * whose it was — and scaffolding is exactly the state the campaign wants read at a
           * glance, since it is the visible half of "this charter is still expanding". Corners
           * rather than members: they mark the cell's own corners, so a cluster of scaffold
           * reads as a lit wireframe of the volume being claimed.
           */
          const h = cellSize * 0.86;
          const node = h * 0.13;
          for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
              for (const sz of [-1, 1]) {
                marks.push(box(node, node, node, first.x + (sx * h) / 2, first.y + (sy * h) / 2, at + (sz * h) / 2));
              }
            }
          }
        } else if (massClass === 'room') {
          /**
           * A room: the one boxy shape in this vocabulary, and deliberately the exception
           * to the file's own header comment about why everything else is round. A room
           * braced one step off a supported neighbour reads as secondary structure, not
           * the pressure hull itself — a flat-walled equipment or crew module hung off the
           * tank that actually holds pressure, the way a real refinery does it. Boxy is
           * what tells a room apart from a tank at a glance, which is the whole reason for
           * the three-way split; giving it the same cylinder as a tank would have made the
           * two classes indistinguishable except by radius.
           *
           * No flange, no footing, no antenna — those are the pipe vocabulary's own
           * fittings, for joints and skirts a flat-walled box does not have.
           */
          const roomW = vertical ? face : length;
          const roomH = vertical ? length : face;
          hulls.push(box(roomW, roomH, deep, cx, cy, at));
        } else {
          // TANK or MAST — the pipe vocabulary this file's own header explains.
          shell.push(pipe(radius, length, deep, building.axis, cx, cy, at));
          /**
           * A flange at each end of the run rather than a collar on its roof.
           *
           * The collar was a fitting for a box. A pipe's own vocabulary is the joint: a
           * slightly proud ring where one section is bolted to the next, which also hides the
           * seam where a run meets whatever it butts against. Drawn at the run's two ends
           * only — one per section would be a screw thread, not a building.
           */
          const ring = cellSize * 0.09;
          for (const end of [-1, 1]) {
            const ex = vertical ? cx : cx + (end * length) / 2;
            const ey = vertical ? cy + (end * length) / 2 : cy;
            shell.push(pipe(radius * 1.14, ring, deep * 1.14, building.axis, ex, ey, at));
          }

          /**
           * A flared footing under the lowest ring of a standing tank.
           *
           * Only vertical, and only the bottom end — a lying run at grade has no "under" to
           * flare, and flaring both ends of a standing one would just be a fatter pipe. What
           * a tank actually needs is a base wider than its own wall, the way a real vessel's
           * skirt spreads load into whatever it is bolted to, and that widening is the one
           * shape a uniform-radius pipe can never produce on its own — it is a second class
           * of geometry, not a bigger version of the first.
           */
          if (vertical && massClass === 'tank') {
            const footY = cy - length / 2;
            shell.push(pipe(radius * 1.55, ring * 1.8, deep * 1.55, 'y', cx, footY, at));
          }

          /**
           * An antenna on the topmost ring of a mast.
           *
           * The one piece of geometry in this vocabulary that is not a pipe at any scale — a
           * thin rod above the run's own top, a crossarm, and a lit tip in the scaffold
           * corners' own badge material (`marks`). Faceted rather than a sphere for the tip,
           * matching the file's rule throughout: nothing in this canyon is round because a
           * pressure vessel had a reason to be, and an antenna does not.
           *
           * Vertical masts only — a mast lying on its side is still reaching *along* the
           * canyon rather than *up* it, and topping a horizontal run with a vertical rod
           * would read as a mistake rather than as a fitting.
           */
          if (vertical && massClass === 'mast') {
            const tipY = cy + length / 2;
            const rod = cellSize * 0.5;
            frames.push(pipe(radius * 0.4, rod, radius * 0.8, 'y', cx, tipY + rod / 2, at));
            const bar = cellSize * 0.28;
            const t = cellSize * MEMBER;
            frames.push(box(bar, t, t, cx, tipY + rod * 0.62, at));
            const tip = cellSize * 0.1;
            marks.push(box(tip, tip, tip, cx, tipY + rod, at));
          }
        }

        for (let i = 0; i < span; i++) {
          const cell = run[i];

          // The cage — see `cellCage`'s own comment. One per cell, not one stretched to
          // the run: the pipe or hull inside is a single continuous piece, but the claim
          // underneath it is still made a cell at a time, exactly as a bare cell's own
          // cage already is.
          const cage = cellCage(cell.x, cell.y, at, cellSize);
          frames.push(...cage.frame);
          marks.push(...cage.marks);
          /**
           * Fitting size off the **cell**, not off the vessel it is bolted to.
           *
           * A lamp is a lamp: its size is what a charter ships, not a fraction of whatever
           * pipe it ends up on. Deriving it from `face` meant the fittings shrank twice over
           * when the vessels were thinned — from 1.08 units to 0.69 — which is most of why
           * the lane markings went dim. Under ACES tone mapping a bright small fitting just
           * clips to white and stops getting brighter, so lit *area* is the lever that
           * actually works, and this is where the area went.
           */
          const t = cellSize * LAMP_THICK;

          /**
           * The house fitting: one lit port, camera-facing — **room only.**
           *
           * A tank is a pressure vessel, sealed, with nothing behind its own wall a window
           * would open onto; a mast is bare steelwork with no wall at all. A room is the
           * one class here that actually reads as occupied space, so it is the one class
           * that gets a window. Giving every built cell the same port — the original
           * intent, before the three-way split — said "pressurised and occupied" about a
           * tank too, which is a claim its own shape already contradicts.
           *
           * A horizontal band used to sit below it. Both together were too much — a canyon
           * of modules each carrying two lit elements on the face you always see reads as
           * noise, and the lane marking drowned in it. The port alone is enough, and
           * everything the *edges* now carry reads against a quiet face.
           */
          if (!bare && massClass === 'room') {
            marks.push(box(face * 0.3, face * 0.22, t * 0.7, cell.x, cell.y, at + faceZ * 0.92));
          }

          /**
           * The wall at the end of the channel.
           *
           * This cell's own column *is* a lane, which only an outer layer can be — growth
           * bars the play plane from a channel and bars nothing else. So a pilot inside that
           * channel is flying straight at this face, which makes it the single most useful
           * surface in the colony for navigation and, until now, the only unlit one.
           *
           * Square to the camera, generous, and in the bright bucket: it tells you where the
           * corridor *goes*, where a flank vane only tells you that you are beside one.
           * Deliberately no yaw and no diagonal blending when a flank bit is also set — two
           * fittings each square to their own face read better than one facing neither.
           */
          if (cell.traits & TRAIT.laneBehind) {
            // The *same* pair of stripes the flanks carry, turned onto the camera-facing
            // face — same thickness, same length, same offset from centre. It was a single
            // large panel, which made a lane read as two different fittings depending on
            // which side of it you were: one alphabet for beside, another for ahead. One
            // marking that simply appears on whichever face the lane is on is both easier
            // to learn and honest about being the same thing.
            const half = bare ? cellSize * 0.86 * 0.46 : radius * 0.62;
            const along = bare ? cellSize * 0.86 * 0.5 : deep * 0.7;
            for (const sy of [-1, 1]) {
              beacons.push(box(along, t, t, cell.x, cell.y + sy * half, at + faceZ + t / 2));
            }
          }

          /**
           * The lane marking, **on the flank the lane actually runs past**.
           *
           * A lamp on the camera-facing side is edge-on to a pilot inside the channel, which
           * is the one place it needs to be legible from — so marking a route with front-face
           * fittings tells you a route exists only once you are already looking at the colony
           * side-on. Mounted on the flank instead, the lit face is square to the lane and the
           * approach reads as a lit corridor from inside it. This is also why `TRAIT` carries
           * `laneWest`/`laneEast` rather than one flag: the side *is* the fact.
           *
           * **Two stripes along the flank's top and bottom edges**, running in z so they
           * present their length to something travelling down the channel. Edges rather than
           * one bar across the middle of the face: a pilot in a narrow lane sees the building
           * mostly foreshortened, and what survives that is the outline — so lighting the
           * outline draws the shape of the gap they are flying through, which is the thing
           * actually being navigated. A bar in the middle of a face lights a wall.
           *
           * Hung off `width`, the building's own outer face, so a hall's stripes land on the
           * hall's end rather than on the end cell's narrower one. An interior cell of a hall
           * can never be flagged, since its neighbour is occupied and an occupied cell is not
           * a lane.
           *
           * All of it lands in the same merged bucket, so richer frontage costs geometry —
           * which merges for free — and not another material. That trade is the only reason
           * any of this can afford to be more than one box.
           */
          for (const [bit, sx] of [
            [TRAIT.laneWest, -1],
            [TRAIT.laneEast, 1],
          ] as const) {
            if ((cell.traits & bit) === 0) continue;
            const h = cellSize * 0.86;
            // The frame's own leg spacing where there is a frame, the vessel's own flank
            // where there is a hull — either way the strip sits *on* the structure. A lying
            // pipe is flanked along its whole length, a standing one only at its diameter,
            // which is why this reads `width` rather than assuming one of the two.
            const edgeX = bare ? cell.x + (sx * h) / 2 : cx + sx * (width / 2) * 0.94;
            const half = bare ? h * 0.46 : radius * 0.62;
            const along = bare ? h * 0.5 : deep * 0.7;
            for (const sy of [-1, 1]) {
              beacons.push(box(t, t, along, edgeX, cell.y + sy * half, at));
            }
          }

          // Walkways, drawn once per edge: only the +x and +y halves of each link pair. Links
          // are within a layer by construction (`LINK` has no depth members), so a walkway
          // never spans front to back — there is nothing to draw there that would read.
          //
          // An east walkway is skipped for every member but the last, because that link is
          // now *inside* a hull — geometry the merge made invisible, and the merged mesh is
          // where invisible geometry stops being free.
          const wt = cellSize * 0.16;
          if (cell.links & LINK.east && i === span - 1) {
            walks.push(box(cellSize, wt, wt, cell.x + cellSize / 2, cell.y, at));
          }
          if (cell.links & LINK.up) walks.push(box(wt, cellSize, wt, cell.x, cell.y + cellSize / 2, at));
        }
      }
    }

    // `transparent` has to be set at construction even though the material is opaque
    // almost everywhere: three.js decides the render queue from it, and flipping it later
    // forces a shader recompile mid-flight.
    const fade = isNear ? { transparent: true, depthWrite: false } : {};

    const add = (parts: THREE.BufferGeometry[], material: THREE.MeshStandardMaterial): void => {
      if (parts.length === 0) return;
      const merged = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!merged) return;
      /**
       * Depth handled entirely in the shader now — see `patchDepth`.
       *
       * The near class also thins around the vehicle so it can never hide it; every cell in
       * it sits in front of the play plane, so that gate is a formality. Both classes dim
       * with depth, and because the dim is keyed off world z rather than off which mesh a
       * fragment belongs to, a module that spans layers darkens along its own length
       * instead of taking one flat tone from the layer it was filed under.
       */
      patchDepth(material, {
        fadeInFrontOf: isNear ? 0 : null,
        dimPerLayer: LAYER_DIM,
        dimFrom: z,
        dimSpacing: COLONY_LAYER_SPACING,
      });
      const mesh = new THREE.Mesh(merged, material);
      // The near class does not cast: it is the geometry the player is meant to see past,
      // and a shadow from something being faded out is a shadow with no visible source.
      mesh.castShadow = !isNear;
      // Behind everything opaque, so a faded front module never sorts in front of the
      // lander's own geometry.
      if (isNear) mesh.renderOrder = 1;
      scene.add(mesh);
      objects.push(mesh);
    };

    add(
      hulls,
      new THREE.MeshStandardMaterial({
        // Sintered regolith — see `STRUCTURE`. Barely metallic, because it is fired dirt.
        color: STRUCTURE.regolith,
        roughness: 0.75,
        metalness: 0.04,
        flatShading: true,
        ...fade,
      }),
    );
    add(
      frames,
      new THREE.MeshStandardMaterial({
        // Structural steel — the material a charter had to fly up here, which is most of
        // why an unclad frame reads as expensive and unfinished at the same time.
        color: STRUCTURE.steel,
        roughness: 0.5,
        metalness: 0.55,
        flatShading: true,
        ...fade,
      }),
    );
    add(
      walks,
      new THREE.MeshStandardMaterial({
        /**
         * Corridors are structure, not lighting.
         *
         * They glowed for a while — the connective network drawn out of a mass of dark cubes,
         * which did read well against the old boxes. Retired once the modules became vessels:
         * a corridor is a duct between two pressure hulls, and a canyon where every duct is
         * lit puts the plumbing on the same footing as the lane markings, which are the only
         * thing here a pilot actually steers by. The emissive budget belongs to the fittings
         * and to the scaffold nodes.
         */
        roughness: 0.4,
        metalness: 0.3,
        flatShading: true,
        ...fade,
      }),
    );
    add(
      beacons,
      new THREE.MeshStandardMaterial({
        // Housing in hull grey, light in corp colour. Setting both to the corp colour at
        // emissive strength drove every channel to 1 and the bars came out as flat white
        // slabs — the hue that was the whole point of using the corp's colour was the first
        // thing the brightness destroyed. The dark body also gives the lit face an edge to
        // read against, which is what makes it a fitting rather than a glowing rectangle.
        color: theme.hull,
        // Dimmed with depth like everything else. A lamp is not exempt from aerial
        // perspective — the far side of a canyon full of lit frontage reading as bright as
        // the near side is the exact cue that flattened the three layers into one before.
        emissive: neon(theme.color, 0.42),
        /**
         * **Beacons lead, marks identify** — and the two get separate materials because
         * that is a difference in what the light is *for*, not a difference in decoration.
         *
         * A lane stripe is a navigation aid: the pilot is steering by it, so it has to win
         * against the canyon at flight distance. A port on a hull or a node on a scaffold
         * corner is a badge — it says who built this and that it is occupied, and nothing
         * about where to go. Run at one brightness, the badges are as loud as the aids and
         * a mature canyon becomes a field of equally bright dots with no route in it, which
         * is what "monotonic and unnavigatable" was describing in the first place.
         *
         * Worth the extra merged mesh per class by the same rule every other material here
         * is judged on: spend one where the thing genuinely is a different substance, and
         * this is the one case where two fittings mean opposite things to a pilot.
         */
        emissiveIntensity: 3.2,
        roughness: 0.5,
        metalness: 0,
        flatShading: true,
        ...fade,
      }),
    );
    add(
      marks,
      new THREE.MeshStandardMaterial({
        color: STRUCTURE.steel,
        // Darker base *and* less lift than the beacons, which is one change rather than
        // two: ACES desaturates as it lifts, so every step down in brightness is a step up
        // in how much of the corp's hue survives. A mark is a badge — it wants to be read
        // as green or amber or cyan more than it wants to be bright.
        emissive: neon(theme.color, 0.3),
        emissiveIntensity: 0.75,
        roughness: 0.5,
        metalness: 0,
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
      new THREE.LineBasicMaterial({
        color: colour,
        transparent: true,
        opacity,
        fog: false,
        depthTest: false,
      }),
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
      new THREE.LineBasicMaterial({
        color: 0x36f5a0,
        fog: false,
        depthTest: false,
      }),
    );
    scene.add(line);
    objects.push(line);
  }

  cell.dispose();
  edges.dispose();
  return objects;
}
