import * as THREE from 'three';
import { CORPS, type CorpId } from './CanyonSpec.ts';
import { hash01 } from './Noise.ts';

/**
 * Prototype for the growth model in docs/plans/procedural_colony_growth.md.
 *
 * Deliberately not wired into `worldAt`/`Missions.ts` — this is the scoped proof the
 * plan calls for: does a seeded grid actually read as *grown* before any of it touches
 * gameplay-relevant code. No corridor-safety domain restriction, no campaign-age
 * maturation, no mission owns one of these yet. `growGrid` and `buildColonyGrowth` are
 * the two functions meant to be called from outside this file.
 *
 * The grid is 2D (columns × rows), not the plan's full 3D (x/z × y) — towers in this
 * game don't currently vary along z at all, so a third axis would be complexity this
 * prototype has nothing to spend it on. If growth ever needs z-variation, that is a
 * deliberate later addition, not an oversight here.
 */

export type CellType = 'room' | 'scaffold' | 'empty';

export interface TubeEdge {
  /** The lower/inner of the two cells this tube spans. */
  r: number;
  c: number;
  /** Direction to the other cell: (0,1) = up, (1,0)/(−1,0) = sideways. */
  dr: number;
  dc: number;
}

export interface ColonyGrid {
  cols: number;
  rows: number;
  /** Column the anchor (pad) pins — row 0 is always the anchor row. */
  anchorCol: number;
  /** `cells[row][col]`, row 0 = ground level. */
  cells: CellType[][];
  tubes: TubeEdge[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Marks a cell permanently unavailable to `growGrid` — reserved airspace, not a tile
 *  choice. See `growGrid`'s `reserved` option for the precedence rule. */
export type Reserved = (r: number, c: number) => boolean;

export interface GrowthOptions {
  reserved?: Reserved;
  /**
   * 0–1, how far into this corp's own campaign the current mission sits. Distance from
   * the anchor beyond `maturity`'s reach is forced empty regardless of what a seed
   * would otherwise roll — the same "grows outward over time" read
   * `buildBackdropColony`'s age gives the skyline, applied to this grid instead of a
   * building index. Default 1: fully mature, no gating, exactly today's behaviour.
   */
  maturity?: number;
  /**
   * 0–1, how well this corp's missions have gone so far — see `Progress.complete`'s
   * best-rank-per-mission record, which is what this is meant to be fed from. Shifts
   * occupancy and room-vs-scaffold odds upward; does nothing at distance 0, where
   * those odds are already near their ceiling, and matters most at the middling
   * distances that decide how far a colony reads as *building outward* rather than
   * staying compact. Default 0: no bias, exactly today's behaviour.
   */
  quality?: number;
}

/**
 * Grows a colony's cells outward from a pinned anchor.
 *
 * Five rules carry all of the structure:
 *
 *   - **A reserved cell is always empty, before anything else is decided.** This is the
 *     corridor-safety domain restriction from docs/plans/procedural_colony_growth.md's
 *     Safety Model: a cell a caller marks reserved (inside a flight corridor's margin,
 *     say) is forced empty unconditionally — not "restricted to scaffold", empty — and
 *     that decision is made once, here, before any seed gets a say. It even overrides
 *     the anchor pin below: reserving the anchor cell is a caller error (there is then
 *     no guaranteed root for the structure), but the failure is contained rather than
 *     silent — that one cell stays empty rather than a growth algorithm occupying
 *     reserved airspace because its own bookkeeping needed a room there. It is *not* a
 *     promise that the whole grid comes back empty: unreserved cells are still free to
 *     grow wherever the support rule below reaches them — including *around* a
 *     reservation, which is exactly what walls a reserved flight channel in and makes
 *     it read as a maze rather than open sky.
 *   - **Maturity bounds how far the colony has reached, before anything else too.**
 *     Checked right after the anchor pin (which is exempt — even an unplayed corp has
 *     a root) and right before the support rule, so an immature cell empties out the
 *     same way a reserved one does, cascading upward for free.
 *   - **Occupancy needs support: from below, or sideways off a room.** A cell above
 *     row 0 can be non-empty if the cell directly below it is occupied, *or* if its
 *     anchor-side lateral neighbour is a room — rooms are load-bearing, scaffold is
 *     not, so a mass can bulge sideways off its pressurised core but a scaffold fringe
 *     can only ever climb. This lateral growth is where the labyrinth comes from: the
 *     mass extends horizontally around the reserved flight corridors, and threading
 *     those corridors between walls of colony is the approach the player actually
 *     flies. Nothing floats: every occupied cell traces to the ground through this
 *     rule, by construction.
 *   - **A room must touch the room network.** A cell may only *become* a room if the
 *     cell below it or its anchor-side neighbour is already a room (the anchor counts).
 *     Rooms therefore form one connected mass rooted at the anchor — never an island
 *     stacked on a scaffold column with no way in.
 *   - **Both occupancy and room-vs-scaffold odds decay with distance from the anchor,
 *     offset by quality.** Rooms cluster near the anchor; scaffold — per the design
 *     note this is implementing — takes over toward the colony's edge, less so the
 *     better this corp's missions have gone.
 *   - **A corridor always connects two adjacent rooms.** Not probabilistic: two rooms
 *     that share a cell face are always tube-connected. Together with the
 *     room-connectivity rule this means every room reaches every other room through
 *     the corridor network — a colonist can walk the whole colony, on every seed.
 */
export function growGrid(
  cols: number,
  rows: number,
  anchorCol: number,
  seed: number,
  options: GrowthOptions = {},
): ColonyGrid {
  const { reserved = () => false, maturity = 1, quality = 0 } = options;
  const cells: CellType[][] = Array.from({ length: rows }, () => Array<CellType>(cols).fill('empty'));
  // The farthest any cell in this grid can be from the anchor, so `maturity` (0–1) has
  // a real distance to scale against rather than an arbitrary constant.
  const maxDist = rows - 1 + Math.max(anchorCol, cols - 1 - anchorCol);
  const reach = clamp(maturity, 0, 1) * maxDist;

  for (let r = 0; r < rows; r++) {
    // Centre-out, so a cell's "toward anchor" neighbour is always already decided.
    const order = [...Array(cols).keys()].sort((a, b) => Math.abs(a - anchorCol) - Math.abs(b - anchorCol));
    for (const c of order) {
      if (reserved(r, c)) {
        cells[r][c] = 'empty'; // corridor margin — not a roll, a rule
        continue;
      }

      if (r === 0 && c === anchorCol) {
        cells[r][c] = 'room'; // the pinned anchor cell
        continue;
      }

      const dist = Math.abs(r) + Math.abs(c - anchorCol);
      if (dist > reach) {
        cells[r][c] = 'empty'; // this corp hasn't been here long enough to reach this far
        continue;
      }

      // Toward-anchor lateral neighbour — already decided, thanks to the centre-out
      // column order. Null at the anchor column itself.
      const inward = c === anchorCol ? null : c < anchorCol ? c + 1 : c - 1;
      const sideRoom = inward !== null && cells[r][inward] === 'room';
      const belowOccupied = r === 0 || cells[r - 1][c] !== 'empty';
      if (!belowOccupied && !sideRoom) {
        cells[r][c] = 'empty'; // unsupported — nothing below, no room beside
        continue;
      }

      /**
       * The decay is deliberately shallow. The support rule already compounds it —
       * a cell only exists if an unbroken chain of survivors connects it to the
       * ground — so the per-cell odds understate how fast a colony actually thins
       * with height. The first version used 0.12/cell with a 0.15 floor and even a
       * fully mature colony stalled at a stub of its grid: at four cells out the
       * compounded odds were already near-lottery. 0.07 with a 0.25 floor is tuned so
       * a mature quality-0 colony fills roughly half its envelope and an all-S one
       * most of it.
       */
      const occupyChance = clamp(0.92 - dist * 0.07 + quality * 0.25, 0.25, 0.95);
      if (hash01(seed, r, c, 0) > occupyChance) {
        cells[r][c] = 'empty';
        continue;
      }

      // Room only where the room network already reaches — see the connectivity rule
      // in the doc comment. Unattached cells that pass the occupancy roll are scaffold.
      const attached = sideRoom || (r > 0 && cells[r - 1][c] === 'room');
      const edgeBias = Math.min(c, cols - 1 - c) === 0 ? 0.25 : 0;
      const roomChance = clamp(0.75 - edgeBias - dist * 0.05 + quality * 0.25, 0.1, 0.85);
      cells[r][c] = attached && hash01(seed, r, c, 1) < roomChance ? 'room' : 'scaffold';
    }
  }

  const tubes: TubeEdge[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r][c] !== 'room') continue;
      // Only up and right, so each adjacent pair is recorded once.
      if (r + 1 < rows && cells[r + 1][c] === 'room') tubes.push({ r, c, dr: 1, dc: 0 });
      if (c + 1 < cols && cells[r][c + 1] === 'room') tubes.push({ r, c, dr: 0, dc: 1 });
    }
  }

  return { cols, rows, anchorCol, cells, tubes };
}

export interface GrowthPlacement {
  /** World position of the anchor cell's centre. */
  x: number;
  y: number;
  z: number;
  /**
   * Edge length of one cell — every cell is a cube, the same size on all three axes,
   * at least the width of the pad it's grown from. Not a separate width/height pair:
   * a cube is the one shape that can't drift out of proportion as a caller changes
   * only one of two numbers.
   */
  cellSize: number;
  /**
   * Which way increasing column maps to world x: +1 for a colony growing from the west
   * wall toward the canyon's centre, −1 for one growing from the east wall toward it.
   * A centre-rooted colony (`anchorCol` mid-grid, growth already symmetric both ways
   * via `growGrid`'s own distance decay) can use either sign — it makes no visible
   * difference when the anchor isn't at an edge.
   */
  direction: 1 | -1;
}

function cellCentre(grid: ColonyGrid, r: number, c: number, place: GrowthPlacement): THREE.Vector3 {
  return new THREE.Vector3(
    place.x + (c - grid.anchorCol) * place.cellSize * place.direction,
    place.y + r * place.cellSize,
    place.z,
  );
}

/**
 * Renders a grid. Deliberately plain geometry — boxes and cylinders, no barrel lathes or
 * lattice frames — because this is proving the *placement* mechanism reads as grown, not
 * shipping final art. Reusing `buildTower`'s full module vocabulary is the natural next
 * step once the mechanism itself is validated, not before.
 */
export function buildColonyGrowth(
  scene: THREE.Scene,
  grid: ColonyGrid,
  place: GrowthPlacement,
  corp: CorpId,
): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  const theme = CORPS[corp];
  const hullMat = new THREE.MeshStandardMaterial({
    color: theme.hull,
    roughness: 0.55,
    metalness: 0.18,
    flatShading: true,
  });
  const scaffoldMat = new THREE.MeshStandardMaterial({
    color: theme.hull,
    roughness: 0.8,
    metalness: 0.1,
    flatShading: true,
  });
  const cell = place.cellSize;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const type = grid.cells[r][c];
      if (type === 'empty') continue;
      const centre = cellCentre(grid, r, c, place);

      if (type === 'room') {
        // Undersized within its cell — the same convention `buildTower`'s hung modules
        // use (0.72-0.85 of the bay bound) — so the cell's own margin stays visible
        // around it instead of the room reading as a solid block.
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(cell * 0.6, cell * 0.62, cell * 0.6), hullMat);
        mesh.position.copy(centre);
        scene.add(mesh);
        objects.push(mesh);
      } else {
        /**
         * Scaffold: an open X-brace, one plane, no more. Known-bad placeholder — from
         * the flight camera it reads as a flat star, and a second crossing plane was
         * tried and read as a faceted blob, which was worse. Solid crossed boxes will
         * never read as scaffolding; the honest fix is rendering these cells with the
         * game's real lattice vocabulary (`latticeMembers` in Colony.ts), which is the
         * queued module-vocabulary work, not another rotation. Left at the least-bad
         * placeholder until that lands.
         */
        for (const sign of [-1, 1]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(cell * 0.85, cell * 0.9, cell * 0.08), scaffoldMat);
          brace.position.copy(centre);
          brace.rotation.z = sign * (Math.PI / 5);
          scene.add(brace);
          objects.push(brace);
        }
      }
    }
  }

  const tubeMat = new THREE.MeshStandardMaterial({
    color: theme.hull,
    roughness: 0.4,
    metalness: 0.3,
    flatShading: true,
  });
  for (const tube of grid.tubes) {
    const a = cellCentre(grid, tube.r, tube.c, place);
    const b = cellCentre(grid, tube.r + tube.dr, tube.c + tube.dc, place);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    // Crew-scale, not vehicle-scale — thin enough to read unambiguously as detail, the
    // same reasoning `Lander`'s RCS nozzles are sized by. Never meant to be flown
    // through, so it only has to look right, never has to be checked for clearance.
    const geo = new THREE.CylinderGeometry(cell * 0.08, cell * 0.08, len, 6);
    const mesh = new THREE.Mesh(geo, tubeMat);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    scene.add(mesh);
    objects.push(mesh);
  }

  return objects;
}

/**
 * Debug-only wireframes at every cell's *full* bound, not the undersized room/scaffold
 * that actually renders inside it — the thing `buildColonyGrowth` deliberately never
 * shows. Drawn for every cell, including empty ones, so the support rule and the
 * distance-decay odds are visible as a shape rather than something you have to infer
 * from `growGrid`'s return value. Behind `?gizmos` — see `Game.loadGrowthDemo`.
 *
 * Occupied cells carry their corp's signage colour — with three colonies in one canyon,
 * whose mass is whose matters more than a global room/scaffold colour code did — and
 * the room/scaffold distinction survives as solid versus faded lines of that colour.
 * Empty stays a neutral dim red on every corp: it marks where growth *isn't*, which is
 * nobody's territory.
 */
export function buildGrowthGizmos(
  scene: THREE.Scene,
  grid: ColonyGrid,
  place: GrowthPlacement,
  corp: CorpId,
): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(place.cellSize, place.cellSize, place.cellSize));
  const materials: Record<CellType, THREE.LineBasicMaterial> = {
    room: new THREE.LineBasicMaterial({ color: CORPS[corp].color }),
    scaffold: new THREE.LineBasicMaterial({ color: CORPS[corp].color, transparent: true, opacity: 0.45 }),
    empty: new THREE.LineBasicMaterial({ color: 0x883333, transparent: true, opacity: 0.3 }),
  };

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const box = new THREE.LineSegments(edges, materials[grid.cells[r][c]]);
      box.position.copy(cellCentre(grid, r, c, place));
      scene.add(box);
      objects.push(box);
    }
  }

  return objects;
}
