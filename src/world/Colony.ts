import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { KinematicWorld } from '../physics/Kinematics.ts';
import { CORPS, STRUCTURE, type CorpId } from './CanyonSpec.ts';
import { hash01 } from './Noise.ts';
import { buildRubble, type RubbleSite } from './Rubble.ts';
import type { CanyonGenerator } from './CanyonGenerator.ts';
import { buildColonyCells, buildColonyGizmos } from './ColonyRender.ts';
import { setLanderFocus } from './LanderFade.ts';
import type { PlacedCell } from './ColonyOrganism.ts';
import type { ColonyDebug } from './ColonyRender.ts';

/**
 * Everything the colony has built. These are authored props, not terrain — which is
 * the whole trick: a heightfield cannot express an overhang, but a *structure* can.
 * Caves and grown colonies are things the colonists made, so they get to be objects
 * with their own colliders, and the terrain never has to do anything clever.
 *
 * Props accumulate across the campaign and are never removed. The canyon the player
 * flies in mission 30 is the one they spent 29 missions helping to build.
 *
 * `tower`/`gantry`/`mast`/`platform` used to live here too: hand-authored corporate
 * structures, one line per mission, standing for the rest of the campaign. They are
 * gone — every mission's structure now comes from `colony`, grown from that corp's own
 * history rather than typed in by hand (see `ColonyGeneration.synthesizeColonies` and
 * docs/plans/procedural_colony_growth.md) — and nothing in the ledger authors one any
 * more. `caveRoof` is the one holdover: turning a pit into a roofed cave still wants
 * real terrain geometry no grid cell can express, and that generation hasn't moved into
 * the colony system yet.
 */
export type Prop =
  /**
   * Roof slab over an excavation, turning a pit into a cave with a real ceiling.
   *
   * `attachToDig`, when set, names a `WallAnchoredDig`'s `id` (`TerrainDigs.ts`) whose
   * real bottom this prop's `x`/`y` should follow instead of the authored values —
   * `Game.loadMission` overwrites them once the dig's real endpoint is known. Authored
   * `x`/`y` stay as the pre-resolution placeholder, never actually rendered at.
   */
  | { kind: 'caveRoof'; corp: CorpId; x: number; halfWidth: number; y: number; attachToDig?: string }
  /**
   * The navigation radar, standing wherever the player set it down in mission 1.
   * A landmark rather than an obstacle: no collider, ever. See `buildRadar`.
   *
   * `y` is the exact touchdown height when it is known — see `Progress.mastY` — and is
   * absent for a save from before that was tracked, in which case `buildRadar` falls
   * back to resampling terrain at the mast's own z, the old approximation.
   */
  | { kind: 'radar'; corp: CorpId; x: number; y?: number }
  /**
   * An uplink relay: an antenna with legs, standing where it came down.
   *
   * **The only prop in the game with no `corp`, and that is the point.** Every other
   * structure in this canyon belongs to a charter and is painted in their colour. This
   * one is the player's own link, so it wears `--sys` — the register `Interface` already
   * reserves for what is yours rather than a client's.
   *
   * Collider-exempt for the same reason `radar` is, plus one of its own: a half-buried
   * mast that could eat a landing, or that the layout resolver could relocate into an
   * approach corridor, would be a hazard nobody authored.
   *
   * `live` is the whole reveal mechanism. The player's relay blinks; the four dead ones
   * seeded in the dust do not. Same silhouette, one lit and four not — which is how a
   * player who spent the prologue flying that shape learns what a dark one means, with
   * no text anywhere. See `buildRelay`.
   */
  | { kind: 'relay'; x: number; y?: number; live: boolean }
  /**
   * Landing pad. `id` is what a mission names as its delivery target.
   * Omit `y` to rest on whatever ground is beneath — canyon floor, or the floor of
   * an excavation. The deck always sits slightly *above* the terrain, so touchdown
   * resolves against the pad collider and nothing else.
   *
   * `attachToDig` — see the `caveRoof` variant's doc comment; same mechanism.
   *
   * `xFromDig` — a narrower cousin of `attachToDig`, for a pad that sits at its own
   * fixed, authored depth *inside* a straight vertical bore rather than at the bore's
   * own endpoint (Kessler's `shaft-ledge`/`shaft-deep`, partway down a shaft whose
   * mouth is `attachToDig`'s own consumer). Only `x` is replaced, with the named dig's
   * resolved position — the same one for every depth along a vertical bore, since its
   * `direction` never carries any x — `y` stays exactly as authored. Mutually exclusive
   * with `attachToDig` in practice, though nothing enforces that; author one or the
   * other, never both.
   */
  | {
      kind: 'pad';
      id: string;
      corp: CorpId;
      x: number;
      width: number;
      y?: number;
      attachToDig?: string;
      xFromDig?: string;
      /**
       * Which cell of `attachToDig`'s drawing this deck rests in, in the drawing's own
       * coordinates — see `parseCells`.
       *
       * `attachToDig` alone puts a pad at the bore's far end, which is exact for a tube
       * and undefined for a complex: once a drawing has a gallery running off it there is
       * no single end, and the tube arithmetic quietly returns somewhere in the rock. So a
       * deck inside a drawn excavation names the cell it sits in and `TerrainDigs` resolves
       * it through the same anchoring the carve uses — the deck ends up in the cell it was
       * drawn in, on any seed, whatever the mouth resolved to.
       */
      atCell?: { col: number; row: number };
    }
  /**
   * A grown colony — see docs/plans/mycelial_colony_growth.md. The cells arrive
   * pre-computed (by `ColonyPlan.planColonies`, grown against the real per-seed terrain
   * from that corp's own mission history and rank) rather than generated here; `Colony`
   * only ever renders what it's given, the same as every other prop.
   *
   * `cells` carry **world positions**, not lattice coordinates. The lattice stops at the
   * boundary of generation on purpose: the model this replaced had five overlapping
   * notions of position (a global column, a grid-local one, a grid origin `x`, a column
   * bound, and `FLOOR_BASE` standing in for real terrain over in `Layout.ts`) with the
   * conversions written out again in four files, and two live bugs came from exactly
   * that. `ColonyLattice.ts` is now the only place a column becomes a coordinate.
   *
   * `footprintX`/`spanY` are the real occupied bounds, for `Layout.ts`. `spanY` is an
   * absolute world interval rather than a height above a guessed base — growth is fitted
   * to real terrain now, so its true vertical extent is known rather than estimated.
   */
  | {
      kind: 'colony';
      corp: CorpId;
      cellSize: number;
      cells: PlacedCell[];
      footprintX: [number, number];
      spanY: [number, number];
    };

/**
 * Depths at which the colony is echoed behind the play plane. These carry no
 * colliders and are never targets — they exist so the settlement visibly continues
 * down the canyon instead of being a single row of objects on a pane of glass.
 *
 * These used to be -110/-240/-430/-700, and read as exactly what they were: four
 * separate walls of buildings with empty canyon between them.
 *
 * The whole set now fits inside 140 units — less than the old first row alone. Rows
 * that far apart could not help but separate; packed this tightly the silhouettes
 * interleave and the eye takes them as one dense block of city rather than as ranks.
 * Spacing stays geometric, each row about 1.35x the last, because a receding city
 * distributes that way and even spacing reintroduces the banding.
 *
 * What actually sells the depth now is fog, not distance: see updateAtmosphere, where
 * in-canyon density was raised specifically so these rows separate tonally. At the old
 * density the nearest row was 4% fogged and the whole point was lost.
 */
const BACKDROP_DEPTHS = [-24, -40, -58, -80, -106, -138];

/**
 * Rows nearer than this index are built as frames; the rest stay solid massing.
 *
 * Not a look decision so much as an honest one about what survives. Past the fourth row
 * the fog is taking 60% or more and a member is well under a pixel, so the lattice is
 * invisible — and building it anyway would allocate several thousand boxes on every
 * mission load for detail nobody can resolve.
 */
const BACKDROP_LATTICE_ROWS = 3;

/** Bays per backdrop frame. Fewer than the play plane: these are small on screen. */
const BACKDROP_MAX_BAYS = 4;

/**
 * Off while the grown colony's own shape is being tuned.
 *
 * The parallax rows echo whatever the play plane is doing (`buildBackdropColony`), so
 * they double every silhouette under evaluation and make it genuinely hard to tell what
 * the growth model just produced from what is depth. They cost nothing to switch back on
 * and nothing about them is in question — this is a viewing decision, not a verdict.
 */
const BACKDROP_ROWS_ENABLED = false;

/**
 * The navigation radar's moving parts.
 *
 * It sits a little *behind* the play plane. In front would have been worse than it
 * sounds: the camera rides between 12 and 82 units ahead of the lander depending on
 * phase, so anything at positive z is inside the shaft framing and swells through the
 * frame as the camera dollies in on a descent. Behind, it is always in front of the
 * camera, never covers the vehicle, and still parallaxes against the receding canyon.
 */
interface Radar {
  /** Sweeps on its vertical axis, so it reads as searching rather than as a lamp. */
  dish: THREE.Object3D;
  /** Obstruction light on the mast head. */
  beacon: THREE.Sprite;
  beaconY: number;
  x: number;
  phase: number;
}

const RADAR = {
  /** Set back from the play plane into non-playable background area behind shafts. */
  Z: -35,
  /**
   * Deliberately modest. This is one item off one lander's manifest, not a tower the
   * colony poured — at 120 it dwarfed the outpost's own comms mast and read as
   * infrastructure nobody in this canyon could yet afford. Being visible from entry
   * altitude is the beacon sprite's job, not the mast's.
   */
  HEIGHT: 32,
  /** Seconds per revolution of the dish. */
  SWEEP_PERIOD: 6,
  /** Seconds per double-flash cycle of the beacon. */
  STROBE_PERIOD: 2.4,
  /**
   * Smallest apparent size the beacon is allowed to shrink to, as a fraction of its
   * distance from the camera — so it holds roughly constant on screen instead of
   * falling under a pixel.
   *
   * A real angular calculation would need the live fov, which the director changes per
   * phase. This approximates it: at the ~600 units of an entry, 0.007 keeps the sprite
   * about four units across, which survives the third-resolution buffer at ~2px. Without
   * it the beacon is sub-pixel for the whole descent and crawls as the camera moves.
   */
  MIN_ANGULAR: 0.007,
  BASE_SIZE: 0.9,

  /** Across the flats of the lattice tower. Wide enough that it reads as a frame. */
  WIDTH: 1.8,
} as const;

/**
 * The relay, which is a landed vehicle rather than a structure the colony poured.
 *
 * `Z` is the play plane, unlike `RADAR.Z`'s −35. The mast is set back because it is
 * scenery the outpost erected; this is the thing the *player* set down, and putting it
 * in the background would say it happened somewhere else.
 *
 * `HEIGHT` is short on purpose — it is one vehicle standing on its legs, not a tower.
 * The silhouette does the work, not the scale.
 */
const RELAY = {
  Z: 0,
  HEIGHT: 13,
  /** Seconds per blink. Slow, and a single flash: unlike the radar's double-tap. */
  STROBE_PERIOD: 2.6,
  BASE_SIZE: 3.4,
  MIN_ANGULAR: 0.012,
  /** `--sys` in `style.css`. Belongs to nobody, so it takes no charter's colour. */
  COLOR: 0x4af04a,
  /** Hull grey for a dead one: dust-loaded, and colder than any charter's metal. */
  DEAD_HULL: 0x6b5a4e,
};

export const LATTICE = {
  /** Nominal bay height. Real bays are this divided evenly into the structure. */
  BAY: 5.5,
  /**
   * Bays are capped rather than scaled, so a 130-unit tower gets ten chunky bays
   * instead of twenty-four thin ones. Fewer, bolder members read as a frame at a third
   * resolution; an accurate count reads as static and costs more to rebuild.
   */
  MAX_BAYS: 10,
  MIN_BAYS: 3,
  /** Below this depth a structure is a pole, and side-face diagonals are invisible. */
  DEEP_ENOUGH_FOR_SIDE_BRACING: 6,

  /**
   * Member thickness, as a fraction of distance from the camera.
   *
   * Thin geometry is the worst case for this renderer: at a third resolution with no
   * antialiasing, a member under a pixel wide does not draw as a thin line, it breaks
   * into a dotted crawl that swims as the camera moves — the same failure the far
   * canyon slices had before they were coarsened. So members are never allowed below a
   * screen-relative floor. Far enough away they fuse into a solid silhouette, which is
   * the honest answer anyway: the whole tower is a couple of pixels wide by then.
   *
   * Capped as well as floored, or a distant mast grows into a fat post.
   */
  ANGULAR: 0.003,
  MIN: 0.2,
  MAX: 0.6,
  /** Thickness is quantised to this, so structures rebuild a few times, not 120/s. */
  STEP: 0.05,
  /**
   * Rebuilds allowed per frame. A camera move can push a dozen structures across a band
   * at once, and each rebuild allocates and merges scores of boxes — done together that
   * is a visible hitch, spread over a few frames it is invisible.
   */
  REBUILD_BUDGET: 3,
} as const;

/**
 * How many bays a frame of this height gets.
 *
 * Shared rather than rewritten per caller: `latticeMembers` puts its ring bracing on
 * these bay lines, and `buildBackdropColony` scales its own echoed structures against
 * the same count. Two copies of the formula that drift by one bay leave a module
 * floating between rings.
 */
function bayCount(height: number, maxBays: number = LATTICE.MAX_BAYS): number {
  return Math.min(maxBays, Math.max(LATTICE.MIN_BAYS, Math.round(height / LATTICE.BAY)));
}

/** A merged lattice whose members re-thicken as the camera pulls away. */
interface LatticeEntry {
  mesh: THREE.Mesh;
  height: number;
  width: number;
  depth: number;
  /** Quantised member thickness currently baked into the geometry. */
  band: number;
}

/**
 * A box carrying its colour in its vertices.
 *
 * Merging demands one material for the whole batch, so anything that used to vary by
 * material has to move into an attribute. Colour is the only thing the backdrop varied
 * by, which is what makes the entire settlement collapsible into a single mesh.
 */
function tintedBox(
  w: number,
  h: number,
  d: number,
  colour: THREE.Color,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const count = geo.attributes.position.count;
  const rgb = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = colour.r;
    rgb[i * 3 + 1] = colour.g;
    rgb[i * 3 + 2] = colour.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return geo;
}

/** One box of a lattice: size, offset from the frame's base centre, and any rotation. */
interface Member {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  rotZ?: number;
  rotY?: number;
}

/**
 * Where the boxes of a lattice frame go.
 *
 * Kept as data rather than geometry because two very different consumers need the same
 * frame: the play plane builds it as its own mesh with a distance-driven thickness, and
 * the backdrop bakes hundreds of them into one merged, vertex-coloured batch. Written
 * twice they would drift, and the day they drift is the day the settlement stops
 * looking like it was built by the same people.
 *
 * Deliberately not real scaffolding: legs, ringed bays and one diagonal per bay per
 * face. At this resolution a suggestion of a frame reads as a frame.
 */
function latticeMembers(
  height: number,
  width: number,
  depth: number,
  t: number,
  maxBays: number = LATTICE.MAX_BAYS,
): Member[] {
  const out: Member[] = [];
  const hw = width / 2;
  const hd = depth / 2;
  const bays = bayCount(height, maxBays);
  const bayH = height / bays;

  // Legs, corner to corner, running the full height.
  for (const sx of [-hw, hw]) {
    for (const sz of [-hd, hd]) out.push({ w: t, h: height, d: t, x: sx, y: height / 2, z: sz });
  }

  // Ring bracing at every bay line, including the head.
  for (let i = 1; i <= bays; i++) {
    const y = bayH * i;
    for (const sz of [-hd, hd]) out.push({ w: width, h: t, d: t, x: 0, y, z: sz });
    for (const sx of [-hw, hw]) out.push({ w: t, h: t, d: depth, x: sx, y, z: 0 });
  }

  // Diagonals, alternating direction per bay so the frame zigzags rather than leans.
  // Always on the faces square to the camera; on the side faces only when there is
  // enough depth for them to be seen at all.
  for (let i = 0; i < bays; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    const y = bayH * (i + 0.5);
    const lean = (span: number) => sign * Math.atan2(bayH, span);
    for (const sz of [-hd, hd]) {
      out.push({ w: Math.hypot(width, bayH), h: t, d: t, x: 0, y, z: sz, rotZ: lean(width) });
    }
    if (depth >= LATTICE.DEEP_ENOUGH_FOR_SIDE_BRACING) {
      for (const sx of [-hw, hw]) {
        out.push({
          w: Math.hypot(depth, bayH),
          h: t,
          d: t,
          x: sx,
          y,
          z: 0,
          rotZ: lean(depth),
          rotY: Math.PI / 2,
        });
      }
    }
  }

  return out;
}

/** Turns a member into geometry, rotating before translating so offsets stay absolute. */
function memberGeometry(m: Member, colour?: THREE.Color): THREE.BufferGeometry {
  const geo = colour ? tintedBox(m.w, m.h, m.d, colour) : new THREE.BoxGeometry(m.w, m.h, m.d);
  if (m.rotZ) geo.rotateZ(m.rotZ);
  if (m.rotY) geo.rotateY(m.rotY);
  geo.translate(m.x, m.y, m.z);
  return geo;
}

/**
 * A lattice frame, merged into one geometry.
 *
 * Merging is the whole reason this is affordable. The scene is fragment-bound — 116k
 * triangles measured as irrelevant — so a hundred members cost nothing in geometry, but
 * a hundred *meshes* would take draw calls from 52 into the thousands. Merged, a tower
 * is one call, exactly like the box it replaces, and it covers fewer shaded pixels than
 * that box did because you can see through it.
 */
function latticeGeometry(
  height: number,
  width: number,
  depth: number,
  t: number,
): THREE.BufferGeometry {
  const parts = latticeMembers(height, width, depth, t).map((m) => memberGeometry(m));
  return mergeGeometries(parts, false) ?? new THREE.BoxGeometry(t, height, t);
}

/** A landing ring painted on a pad deck. */
interface LandingRing {
  padId: string;
  /** Steady marker showing the pad's usable centre. */
  inner: THREE.Mesh;
  /** Expanding ping that loops outward and fades. */
  ping: THREE.Mesh;
  radius: number;
  phase: number;
}

export interface PadInfo {
  id: string;
  corp: CorpId;
  x: number;
  y: number;
  width: number;
}

/**
 * How deep each kind of structure is along the canyon.
 *
 * These used to all be 2.2 — thin slabs, so nothing poked in front of the near-cut
 * plane. That plane is gone, and with it the reason: structures can be buildings now
 * rather than cardboard standees, and their side faces catch light at a different
 * angle from their fronts, which is most of what makes them read as solid.
 */
const DEPTH = {
  pad: 8.5,
  caveRoof: 15,
  /**
   * The colony's own z extent, used for `zCentre` and as `moduleDepth`'s outer limit.
   *
   * Deliberately generous rather than tight. This constant used to be what actually set the
   * distance between one layer's modules and the next — at 15, in a 24-unit spacing, a hub
   * left a 9-unit void — which meant layer separation was being decided here, by accident,
   * from the wrong side. It is now `COLONY_VESSEL_DIAMETER` and `COLONY_LAYER_GAP` that
   * decide it, together, in the module that owns both; this only has to stay out of their
   * way, which anything above the diameter does.
   */
  colony: 14,
} as const;

/** How far the whole main row is drawn toward the camera from the play plane. */
const ROW_SHIFT = 1;

/**
 * Structures sit mostly *behind* the play plane. Bulk in front of z=0 would sit
 * between the camera and the lander, and near a tower's edge the perspective offset
 * is enough for its front face to cover a lander that has not touched it.
 */
function zCentre(depth: number): number {
  return -depth * 0.34 + ROW_SHIFT;
}

/**
 * Surfaces the lander actually stands on are centred far closer to the play plane
 * than the bulk rule allows. At 0.34 the play plane fell only 1.9 units inside a
 * 12-deep pad's front lip, so a touchdown read as the vehicle teetering on the near
 * edge with the deck stretching away behind it. At 0.1 it sits about 40% of the way
 * back — visibly *on* the deck — and the lip still ends up short of the sight line
 * from the landing camera down to the feet, so it never covers them.
 */
function zSurface(depth: number): number {
  return -depth * 0.1;
}

/**
 * Kills every emissive fitting and every point light under an object, in place.
 *
 * Shared by `darken` and `collapse` so that "this is not lit any more" has exactly one
 * description. They mean different things — one is a site under order, the other is a site
 * that is gone — but a charter's frontage going out has to look identical in both, or the
 * epilogue reads as a legal problem.
 */
function unlight(root: THREE.Object3D): void {
  root.traverse((node) => {
    const light = node as THREE.PointLight;
    if (light.isPointLight) light.intensity = 0;

    const mesh = node as THREE.Mesh;
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.emissive) continue;
      std.emissive.setHex(0x000000);
      std.emissiveIntensity = 0;
      std.needsUpdate = true;
    }
  });
}

export class Colony {
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private objects: THREE.Object3D[] = [];
  /** Generated textures, which material disposal does not reach. */
  private textures: THREE.Texture[] = [];

  /**
   * Whether to draw the growth gizmos — channels, reserved cells, surface (`ColonyRender`).
   *
   * Seeded from `?gizmos` so a shared link still opens with them on, then owned by the
   * debug panel's own toggle. They are built as part of `build`, so flipping this only
   * shows up on the next one; `Game.setGizmos` is what rebuilds.
   */
  gizmos = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('gizmos');

  pads: PadInfo[] = [];
  /**
   * Every moving structure in the mission. Advanced by `Game` inside the fixed-step
   * loop, not here — a crane's pose is simulation state, and stepping it on the render
   * clock would make it stutter with the frame rate and drift out of determinism.
   *
   * Always empty today: `gantry` and `platform`, the only prop kinds that ever carried
   * a `motion`, are gone (see the `Prop` doc comment). Kept rather than torn out —
   * `Game.ts` still steps it every frame and it is a real, tested primitive
   * (`Kinematics.ts`) a future moving colony part would reach for again, not
   * old-system debris.
   */
  readonly kinematics = new KinematicWorld();
  private rings: LandingRing[] = [];
  private radar: Radar | null = null;

  /**
   * Every live relay's beacon, for the strobe.
   *
   * A list rather than a single slot like `radar`, because a save that has flown the
   * prologue has exactly one and a save that has not has none — and nothing about the
   * rendering should have to know which. The dead ones are never in here: they have no
   * beacon to pose, which is the entire difference between them.
   */
  private relays: { beacon: THREE.Sprite; world: THREE.Vector3 }[] = [];
  private lattices: LatticeEntry[] = [];
  /** Round-robin cursor, so the rebuild budget cannot starve the same structures. */
  private latticeCursor = 0;
  private targetPadId: string | null = null;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;
  }

  /** Which pad is this mission's delivery target — its ring reads brighter. */
  setTarget(padId: string | null): void {
    this.targetPadId = padId;
  }

  /**
   * Animates the landing rings. The ping expands and fades on a loop, which is what
   * makes a pad read as *active* rather than as painted markings, and gives the eye
   * something to line up on during a final approach in a dark canyon.
   */
  update(
    dt: number,
    camera?: THREE.Camera,
    lander?: { x: number; y: number },
    missionTime = 0,
  ): void {
    this.updateRadar(dt, camera);
    this.updateRelays(missionTime, camera);
    if (camera) this.updateLattices(camera);
    // Where the foreground layer thins out, so it never hides the vehicle. Left at its
    // default — far above the canyon, so the layer stays solid — when there is no lander,
    // which is every inspector view and the moment between missions.
    if (lander) setLanderFocus(lander.x, lander.y);

    for (const ring of this.rings) {
      const isTarget = ring.padId === this.targetPadId;
      ring.phase = (ring.phase + dt / (isTarget ? 1.5 : 2.6)) % 1;

      const grow = 0.45 + ring.phase * 0.85;
      ring.ping.scale.setScalar(grow);
      const pingMat = ring.ping.material as THREE.MeshBasicMaterial;
      pingMat.opacity = (1 - ring.phase) ** 1.5 * (isTarget ? 0.85 : 0.3);

      const innerMat = ring.inner.material as THREE.MeshBasicMaterial;
      innerMat.opacity = isTarget ? 0.55 + Math.sin(ring.phase * Math.PI * 2) * 0.2 : 0.25;
    }
  }

  /**
   * Builds one lattice structure and registers it for distance re-thickening.
   * `y` is the base: geometry is generated from 0 up, so the mesh sits on its footing.
   */
  private addLattice(
    x: number,
    y: number,
    z: number,
    height: number,
    width: number,
    depth: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const band = LATTICE.MIN;
    const mesh = new THREE.Mesh(latticeGeometry(height, width, depth, band), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.objects.push(mesh);
    this.lattices.push({ mesh, height, width, depth, band });
    return mesh;
  }

  /**
   * Re-thickens lattice members so none of them falls under a pixel.
   *
   * Distance is measured per structure rather than once for the whole colony: the
   * camera sits close to the play plane while props span the full width of the canyon,
   * so the near and far ends of a mission differ by several bands.
   *
   * Only a few structures may rebuild per frame. Everything else keeps last frame's
   * geometry for a frame or two, which nobody can see, and the cursor advances so the
   * same structures are not always the ones served.
   */
  private updateLattices(camera: THREE.Camera): void {
    const count = this.lattices.length;
    if (count === 0) return;

    let spent = 0;
    for (let n = 0; n < count && spent < LATTICE.REBUILD_BUDGET; n++) {
      const entry = this.lattices[(this.latticeCursor + n) % count];
      const dist = camera.position.distanceTo(entry.mesh.position);
      const want = Math.min(LATTICE.MAX, Math.max(LATTICE.MIN, dist * LATTICE.ANGULAR));
      const band = Math.round(want / LATTICE.STEP) * LATTICE.STEP;
      if (Math.abs(band - entry.band) < 1e-6) continue;

      entry.band = band;
      entry.mesh.geometry.dispose();
      entry.mesh.geometry = latticeGeometry(entry.height, entry.width, entry.depth, band);
      spent++;
    }
    this.latticeCursor = (this.latticeCursor + LATTICE.REBUILD_BUDGET) % count;
  }

  /**
   * Sweeps the dish and strobes the beacon.
   *
   * The rhythm is deliberately unlike the pads': they ping outward on a loop, this
   * turns and double-flashes. Two things that both pulse in a dark canyon need to be
   * told apart at a glance, because only one of them is somewhere to land.
   */
  private updateRadar(dt: number, camera?: THREE.Camera): void {
    const radar = this.radar;
    if (!radar) return;

    radar.phase += dt;
    radar.dish.rotation.y = ((radar.phase / RADAR.SWEEP_PERIOD) % 1) * Math.PI * 2;

    const t = (radar.phase / RADAR.STROBE_PERIOD) % 1;
    const lit = t < 0.05 || (t > 0.12 && t < 0.17);
    const mat = radar.beacon.material as THREE.SpriteMaterial;
    mat.opacity = lit ? 1 : 0.16;

    if (!camera) return;

    // Hold the beacon at a readable size however far off it is. Scaled from the true
    // world distance, so it still grows normally once you are close to it.
    const dist = camera.position.distanceTo(radar.beacon.position);
    radar.beacon.scale.setScalar(Math.max(RADAR.BASE_SIZE, dist * RADAR.MIN_ANGULAR));
  }

  /**
   * Blinks every live relay.
   *
   * **Posed from `missionTime`, not accumulated from `dt`** — the one place in this file
   * that is true, and it is deliberate. `CLAUDE.md` requires anything that moves to be
   * derived from the fixed 120 Hz step, and the radar's `phase += dt` above is a standing
   * exception that survives only because nobody counts a dish's rotation. This is the
   * object the player looks at on every entry for thirty missions, so a blink that
   * drifted with frame rate would be visible in exactly the way the rule exists to
   * prevent, and a retry would not replay it.
   *
   * One flash per cycle, and a long one. The radar double-taps and the pads ping outward;
   * three things pulsing in a dark canyon have to be told apart at a glance, and this is
   * the only one of the three that is neither a charter's nor somewhere to land.
   */
  private updateRelays(missionTime: number, camera?: THREE.Camera): void {
    if (this.relays.length === 0) return;

    const t = ((missionTime / RELAY.STROBE_PERIOD) % 1 + 1) % 1;
    const opacity = t < 0.09 ? 1 : 0.13;

    for (const relay of this.relays) {
      (relay.beacon.material as THREE.SpriteMaterial).opacity = opacity;
      if (!camera) continue;
      // Held at a readable angular size however far off it is, exactly as the radar's is
      // — the relay is on the rim, which on a measured seed is |x| ≈ 145, twice the width
      // of the play area. Left to true perspective it would be a sub-pixel speck from the
      // canyon floor.
      const dist = camera.position.distanceTo(relay.world);
      relay.beacon.scale.setScalar(Math.max(RELAY.BASE_SIZE, dist * RELAY.MIN_ANGULAR));
    }
  }

  build(props: Prop[], canyon: CanyonGenerator, debug?: ColonyDebug): void {
    this.dispose();
    this.pads = [];
    this.rings = [];
    this.lattices = [];
    this.latticeCursor = 0;
    this.radar = null;

    if (BACKDROP_ROWS_ENABLED) this.buildBackdropColony(props, canyon);

    for (const prop of props) {
      switch (prop.kind) {
        case 'caveRoof':
          this.buildCaveRoof(prop);
          break;
        case 'pad':
          this.buildPad(prop, canyon);
          break;
        case 'radar':
          this.buildRadar(prop, canyon);
          break;
        case 'relay':
          this.buildRelay(prop, canyon);
          break;
        case 'colony':
          this.buildColonyStructure(prop);
          break;
      }
    }

    if (debug && this.gizmos) {
      this.objects.push(...buildColonyGizmos(this.scene, debug, zCentre(DEPTH.colony)));
    }
  }

  // ------------------------------------------------------------------ props

  private buildCaveRoof(prop: Extract<Prop, { kind: 'caveRoof' }>): void {
    const corp = CORPS[prop.corp];
    const thickness = 4;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(prop.halfWidth * 2, thickness, DEPTH.caveRoof),
      new THREE.MeshStandardMaterial({
        color: 0x3a1c0d,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
    );
    mesh.position.set(prop.x, prop.y + thickness / 2, zCentre(DEPTH.caveRoof));
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.objects.push(mesh);

    // Strip lighting on the underside so the mouth reads as an entrance, not a wall.
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(prop.halfWidth * 1.7, 0.35, DEPTH.caveRoof * 0.6),
      new THREE.MeshStandardMaterial({
        color: corp.color,
        emissive: corp.color,
        emissiveIntensity: 1.6,
      }),
    );
    strip.position.set(prop.x, prop.y - 0.3, zCentre(DEPTH.caveRoof));
    this.scene.add(strip);
    this.objects.push(strip);

    this.physics.addBox(prop.x, prop.y + thickness / 2, prop.halfWidth, thickness / 2, 'structure');
  }

  private buildPad(prop: Extract<Prop, { kind: 'pad' }>, canyon: CanyonGenerator): void {
    const corp = CORPS[prop.corp];
    const groundY = canyon.heightAt(prop.x, 0, true);
    // A ground pad rests just above the terrain rather than flush with it, so the
    // pad collider is the only surface at touchdown height.
    const y = prop.y ?? groundY + 1.3;

    const deckZ = zSurface(DEPTH.pad);



    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(prop.width, 0.9, DEPTH.pad),
      new THREE.MeshStandardMaterial({
        color: 0x1b2228,
        roughness: 0.6,
        metalness: 0.18,
      }),
    );
    deck.position.set(prop.x, y - 0.45, deckZ);
    deck.receiveShadow = true;
    this.scene.add(deck);
    this.objects.push(deck);

    // Corner posts mark the usable width without adding colliders inside it.
    for (const sx of [-prop.width / 2, prop.width / 2]) {
      for (const sz of [deckZ + DEPTH.pad * 0.36, deckZ - DEPTH.pad * 0.36]) {
        // Dimmed from 2 for the same reason as the radar trim: past about 1.2 the tone
        // curve clips these to white and a pad stops being colour-coded to its owner.
        // Not taken to 1 — corner posts are how a deck is found on final approach.
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 2.2, 0.5),
          new THREE.MeshStandardMaterial({
            color: corp.color,
            emissive: corp.color,
            emissiveIntensity: 1.2,
          }),
        );
        post.position.set(prop.x + sx, y + 1.1, sz);
        this.scene.add(post);
        this.objects.push(post);
      }
    }

    /**
     * Rings painted flat on the deck, a hair above it so they do not z-fight. Drawn
     * with depthWrite off and unlit, so they glow rather than being shaded by a
     * canyon that has no sunlight in it.
     */
    const ringRadius = prop.width * 0.3;
    const flat = (geo: THREE.BufferGeometry, opacity: number) => {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: corp.color,
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(prop.x, y + 0.06, deckZ);
      this.scene.add(mesh);
      this.objects.push(mesh);
      return mesh;
    };


    const inner = flat(new THREE.RingGeometry(ringRadius * 0.82, ringRadius, 28), 0.4);
    const ping = flat(new THREE.RingGeometry(ringRadius * 0.9, ringRadius, 28), 0.5);
    this.rings.push({ padId: prop.id, inner, ping, radius: ringRadius, phase: Math.random() });

    const light = new THREE.PointLight(corp.color, 90, 90, 2);
    light.position.set(prop.x, y + 4, 3);
    this.scene.add(light);
    this.objects.push(light);

    // The landing surface itself. Nothing else sits at this height, so touchdown
    // resolves against exactly one collider.
    this.physics.add({
      x1: prop.x - prop.width / 2,
      y1: y,
      x2: prop.x + prop.width / 2,
      y2: y,
      kind: 'pad',
      padId: prop.id,
    });

    this.pads.push({ id: prop.id, corp: prop.corp, x: prop.x, y, width: prop.width });
  }

  /**
   * The navigation radar: the first thing the player delivers, and the only structure
   * in the canyon whose position they chose.
   *
   * Deliberately not a `mast`. A mast is lethal colony hardware; this is a landmark,
   * so it takes no collider at all — which is what lets it stand wherever the player
   * happened to set down, including inside ground a later corporate tower grows out of.
   *
   * Tall for the same reason a real navigation beacon is tall. "Almost always visible"
   * is a function of height and of the beacon holding its apparent size, not of sitting
   * near the camera.
   */
  /**
   * One uplink relay, live or dead.
   *
   * Both cases are built here from the same geometry deliberately. The four dead ones
   * only mean anything if they are unmistakably the same object the player flew in the
   * prologue, and the surest way to guarantee that is for there to be one description of
   * the shape. What separates them is the three things a machine loses when it stops:
   * the light goes out, the mast goes over, and the dust comes up its legs.
   *
   * There is no text anywhere near any of this, and there must not be. The recognition
   * is the whole mechanism — a player who never flew the prologue would read these as
   * scenery, which is the correct outcome for a player who never flew the prologue.
   */
  private buildRelay(prop: Extract<Prop, { kind: 'relay' }>, canyon: CanyonGenerator): void {
    const groundY = prop.y ?? canyon.floorAt(prop.x);

    /**
     * A dead relay stands in its own dust.
     *
     * Sunk by a fifth of its height and leaned over, both keyed off `x` so the same
     * relay is wrecked the same way every time this canyon is rebuilt — these are
     * authored positions, and a corpse that shifted between missions would read as a
     * live thing that moved.
     */
    const sink = prop.live ? 0 : RELAY.HEIGHT * (0.16 + hash01(1, Math.round(prop.x), 0, 0x4e1d) * 0.14);
    const lean = prop.live ? 0 : (hash01(1, Math.round(prop.x), 1, 0x4e1d) - 0.5) * 0.7;
    const baseY = groundY - sink;

    const hull = new THREE.MeshStandardMaterial({
      color: prop.live ? 0x9aa4ab : RELAY.DEAD_HULL,
      roughness: prop.live ? 0.55 : 0.92,
      metalness: prop.live ? 0.3 : 0.05,
      flatShading: true,
    });

    // One pivot for the lot, so the lean tips the whole machine about its feet rather
    // than shearing the mast off the legs it is standing on.
    const frame = new THREE.Group();
    frame.position.set(prop.x, baseY, RELAY.Z);
    frame.rotation.z = lean;
    this.scene.add(frame);
    this.objects.push(frame);

    const part = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, hull);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      frame.add(mesh);
      return mesh;
    };

    // Three legs, splayed. Deliberately the same count and stance as a lander's, because
    // "it came down here on its own legs" is the one thing this silhouette has to say.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const leg = part(new THREE.BoxGeometry(0.28, 3.6, 0.28), Math.cos(a) * 1.35, 1.5, Math.sin(a) * 1.35);
      leg.rotation.z = -Math.cos(a) * 0.34;
      leg.rotation.x = Math.sin(a) * 0.34;
    }

    // The mast: a straight taper, never swelling. See `HULL_PROFILES.relay` — this is
    // the same read at world scale that the flown vehicle has at vehicle scale.
    part(new THREE.CylinderGeometry(0.42, 0.78, RELAY.HEIGHT - 3, 6), 0, 3 + (RELAY.HEIGHT - 3) / 2, 0);
    part(new THREE.BoxGeometry(2.4, 0.7, 2.4), 0, 2.6, 0);

    // The antenna itself: a cross-arm near the top, pointing up. What it points *at* is
    // never established anywhere, and `docs/lore.md` is explicit that it must not be.
    part(new THREE.BoxGeometry(5.2, 0.22, 0.22), 0, RELAY.HEIGHT - 1.4, 0);
    part(new THREE.BoxGeometry(0.22, 0.22, 4.2), 0, RELAY.HEIGHT - 2.4, 0);

    if (!prop.live) return;

    const beacon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: RELAY.COLOR,
        map: this.glowTexture(),
        transparent: true,
        depthWrite: false,
        // Unfogged, like the radar's. This is the fixed point in a canyon that spends
        // thirty missions changing, and fog is exactly what would erase it on entry.
        fog: false,
      }),
    );
    beacon.position.set(0, RELAY.HEIGHT + 1.1, 0);
    beacon.scale.setScalar(RELAY.BASE_SIZE);
    frame.add(beacon);

    this.relays.push({ beacon, world: new THREE.Vector3(prop.x, baseY + RELAY.HEIGHT + 1.1, RELAY.Z) });
  }

  private buildRadar(prop: Extract<Prop, { kind: 'radar' }>, canyon: CanyonGenerator): void {
    const corp = CORPS[prop.corp];
    /**
     * `prop.y` is the exact height the lander settled at in mission 1 — ground truth,
     * not an estimate — and is used whenever it is known.
     *
     * A save written before `Progress.mastY` existed has no `prop.y`, and falls back to
     * `floorAt`, the z=0 profile: the actual cross-section the touchdown happened on.
     * That used to be wrong for a subtler reason — the mast is drawn at `RADAR.Z` and
     * floorAt samples a different slice, so a mast this exact would still be flush with
     * ground that is not quite the ground under it — but it is now the far *better*
     * wrong answer. `RADAR.Z` moved to −35 to sit the mast in the background behind the
     * shaft, and sampling at −35 instead means asking the canyon's meander for a third,
     * even more distant cross-section: on the seed this was reported against, that
     * produced a height 8+ units off, which is what put the mast's base in open air over
     * a shaft mouth. z=0 is never exactly right for a mast drawn at −35, but it is close,
     * and it is the same number every other terrain-following prop in this file trusts.
     */
    const baseY = (prop.y ?? canyon.floorAt(prop.x)) - 1;
    const topY = baseY + RADAR.HEIGHT;

    const hull = new THREE.MeshStandardMaterial({
      color: STRUCTURE.steel,
      roughness: 0.6,
      metalness: 0.2,
      flatShading: true,
    });
    /**
     * Emissive kept near 1. Under ACES tone mapping at 1.05 exposure, an emissive this
     * saturated clips to white well before 2 — so the trim reads as a generic bright
     * strip instead of as Ixion's mint, and the one cue that says whose structure this
     * is gets thrown away by the tone curve.
     */
    const neon = new THREE.MeshStandardMaterial({
      color: corp.color,
      emissive: corp.color,
      emissiveIntensity: 1,
    });

    const add = (mesh: THREE.Object3D) => {
      this.scene.add(mesh);
      this.objects.push(mesh);
      return mesh;
    };

    // Plinth, so it reads as planted rather than pushed into the dirt.
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 2.6), hull);
    base.position.set(prop.x, baseY + 0.6, RADAR.Z);
    add(base);

    // Lattice rather than a pole. A frame this open uses a fraction of the material a
    // solid mast would, which is the only kind of structure anyone in this canyon can
    // yet afford — and being able to see the canyon *through* it matters more and more
    // as the corridor closes.
    this.addLattice(prop.x, baseY, RADAR.Z, RADAR.HEIGHT, RADAR.WIDTH, RADAR.WIDTH, hull);

    // Emissive collars at two bay lines. Only a couple: the lattice already carries the
    // silhouette, and a lit ring at every level turns the tower into a ladder of dashes.
    for (const f of [0.45, 0.85]) {
      const collar = new THREE.Mesh(new THREE.BoxGeometry(RADAR.WIDTH * 1.15, 0.3, 0.3), neon);
      collar.position.set(prop.x, baseY + RADAR.HEIGHT * f, RADAR.Z + RADAR.WIDTH / 2);
      add(collar);
    }

    // The sweeping head. The dish is tilted off the rotation axis so the turn is
    // legible from a fixed camera — an untilted bowl spinning about its own axis of
    // symmetry is indistinguishable from a stationary one.
    const head = new THREE.Group();
    head.position.set(prop.x, topY, RADAR.Z);
    add(head);

    /**
     * The bowl is the sphere's *southern* cap, so it opens upward — a dish listening
     * to the sky. Taking the northern cap instead (thetaStart 0) builds the same shape
     * inverted: a dome pointing at the ground, which is what this was, and which reads
     * as a mushroom rather than as an antenna.
     */
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(2, 12, 6, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.44),
      new THREE.MeshStandardMaterial({
        color: STRUCTURE.steel,
        roughness: 0.7,
        metalness: 0.1,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
    );
    // Cocked off vertical so the sweep is legible: a bowl turning about its own axis of
    // symmetry looks identical at every angle.
    dish.rotation.x = 0.5;
    dish.position.set(0, 1.1, 0.5);
    head.add(dish);

    // Counterweight on the far side, so the head still reads as turning when the dish
    // is edge-on to the camera.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 2), hull);
    arm.position.set(0, 0.2, -0.7);
    head.add(arm);

    const beaconY = topY + 2.4;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), hull);
    post.position.set(prop.x, topY + 1.2, RADAR.Z);
    add(post);

    const beacon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: corp.color,
        map: this.glowTexture(),
        transparent: true,
        depthWrite: false,
        // Unfogged on purpose: this is the one thing that must still be findable from
        // entry altitude, and fog is exactly what would erase it there.
        fog: false,
      }),
    );
    beacon.position.set(prop.x, beaconY, RADAR.Z);
    beacon.scale.setScalar(RADAR.BASE_SIZE);
    add(beacon);

    this.radar = { dish: head, beacon, beaconY, x: prop.x, phase: 0 };
  }

  /**
   * Thin wrapper, not a generator — the grid arrives pre-computed on the prop (see the
   * `colony` variant's own doc comment), the same as every other prop's geometry arrives
   * fully specified by the time it reaches `Colony`. Gizmos are *not* built here any
   * more — see `buildColonyGizmos`'s own doc comment for why they need every colony at
   * once rather than one prop at a time.
   */
  private buildColonyStructure(prop: Extract<Prop, { kind: 'colony' }>): void {
    const z = zCentre(DEPTH.colony);
    const built = buildColonyCells(this.scene, prop.corp, prop.cells, prop.cellSize, z, DEPTH.colony);
    // Stamped so `darken` can find one charter's frontage without re-deriving ownership
    // from geometry. Only the grown structures carry it, which is all `darken` is for.
    for (const obj of built) obj.userData.corp = prop.corp;
    this.objects.push(...built);

    // One collider per cell, sized to the *full* cell rather than the leaner module or
    // open frame drawn inside it — the same "the frame is see-through, not fly-through"
    // rule every other structure's collider already keeps: what you see is allowed to be
    // leaner than what stops you, never the other way round. A colony's silhouette is
    // branched and one-sided, so a single bounding box would swallow open canyon the
    // render never fills.
    //
    // Scaffold cells collide exactly like built ones. Flyability is carried entirely by
    // the channel network (`ColonyChannels.ts`) rather than by gaps in the massing, so
    // there is no case where the player needs to pass through a colony cell, and a
    // frame that stops you is the safer of the two ways to be wrong.
    //
    // **Only the play plane gets a collider.** The physics world is a 2D cross-section at
    // z=0 — `addBox` has no depth argument, so a cell twelve units behind the plane would
    // otherwise contribute a collider indistinguishable from one standing in the lane. The
    // layers front and back are scenery, they are the only part of the colony `Layout.ts`
    // does not judge either, and the two facts have to stay the same fact.
    const half = prop.cellSize / 2;
    for (const cell of prop.cells) {
      if (cell.z !== 0) continue;
      this.physics.addBox(cell.x, cell.y, half, half, 'structure');
    }
  }

  /**
   * A soft round dot for the beacon sprite, built in code so the game keeps shipping
   * with no image assets. Tiny on purpose — it is never drawn larger than a few pixels
   * at the distances that matter, and a bigger canvas would only cost memory.
   */
  private glowTexture(): THREE.Texture {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    this.textures.push(texture);
    return texture;
  }

  /**
   * Echoes of the colony further down the canyon.
   *
   * Every structure the player has erected is repeated at several depths with jittered
   * position and size, so looking down the chasm shows a settlement that extends into
   * the distance rather than a single plane of props. Purely visual: no colliders, no
   * pads, no lights — only silhouettes and the emissive neon that survives the fog.
   */
  private buildBackdropColony(props: Prop[], canyon: CanyonGenerator): void {
    // Used to source this from tower/mast/gantry — the hand-authored structures.
    // The campaign no longer authors any (see Missions.ts), so the grown `colony`
    // props are the only real structure left to echo. Only a handful exist (one per
    // active corp) versus the dozen-plus hand props this used to see, so the echo rows
    // are coarser than they were, but `'x' in prop` below already resolves a colony's
    // own `x` the same way it did a tower's, with no further change needed.
    const solid = props.filter((p): p is Extract<Prop, { kind: 'colony' }> => p.kind === 'colony');
    if (solid.length === 0) return;

    const hulls: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];

    BACKDROP_DEPTHS.forEach((z, depthIndex) => {
      /**
       * Member thickness baked once per row rather than chased per frame.
       *
       * The play-plane frames re-thicken as the camera moves because their distance
       * changes by an order of magnitude across a descent. A backdrop row sits at a
       * fixed z and the camera never leaves a narrow band in front of it, so its
       * distance barely moves — the thickness it wants can be solved at build time and
       * left alone. Same rule as `LATTICE.ANGULAR`, resolved statically.
       */
      const member = Math.min(
        LATTICE.MAX,
        Math.max(0.22, (Math.abs(z) + 45) * LATTICE.ANGULAR),
      );

      solid.forEach((prop, i) => {
        // Deterministic jitter, so the backdrop is stable across retries.
        const r = (k: number) => {
          const v = Math.sin((depthIndex * 31.7 + i * 12.9 + k * 5.3) * 43758.5453);
          return v - Math.floor(v);
        };
        // The nearest rows are thinned out and the far ones packed, so the eye can see
        // through the front of the settlement into the depth of it. Uniform density
        // would make the closest row a wall and hide everything the rows exist for.
        const keep = 0.42 + depthIndex * 0.11;
        if (r(1) > keep) return;

        const corp = CORPS[prop.corp];
        // Lateral scatter widens with depth, matching the way the canyon itself fans
        // out — a constant spread would taper to a thin line down the middle.
        const spread = 34 + depthIndex * 16;
        // A colony has no single `x` — it is a spread of cells — so the backdrop echoes
        // it from the middle of what it actually occupies.
        const originX = (prop.footprintX[0] + prop.footprintX[1]) / 2;
        const x = originX + (r(2) - 0.5) * spread;

        /**
         * How long this building has been standing.
         *
         * `props` accumulates in mission order, so a low index is something the player
         * delivered early. Reading age straight off the index needs no extra plumbing
         * and makes the settlement grow the way a settlement does: it is not that more
         * buildings appear, it is that the ones already there keep rising. Play mission
         * 8 and then mission 30 on the same seed and the skyline behind the outpost is
         * recognisably the same place, twenty-two missions older.
         */
        const age = solid.length > 1 ? 1 - i / (solid.length - 1) : 1;

        const height = (26 + r(3) * 90) * (0.34 + age * 0.66);
        const width = (4 + r(4) * 12) * (0.68 + age * 0.42);
        /**
         * Depth is drawn independently of width rather than mirroring it.
         *
         * Square-plan blocks are the giveaway of procedural massing: every building
         * presents the same face however the canyon turns, and the row reads as one
         * repeated object. Letting the footprint run long in either X or Z gives slabs,
         * towers and sheds out of the same generator.
         */
        const depth = width * (0.55 + r(7) * 1.05);
        const baseY = canyon.heightAt(x, z) - 4;

        /**
         * Backdrop hulls are darkened hard. With the rows this close, fog no longer
         * separates them from the real colony — at 34 units it removes almost nothing
         * — and a scenery block that looks like a structure is worse than no block at
         * all, because none of these carry colliders. Depth in a canyon means less
         * light reaching you, so dimming is both the honest cue and the free one.
         *
         * Baked into vertex colour rather than a material, which is what lets every
         * building in the settlement share one mesh.
         */
        const shade = new THREE.Color(corp.hull).multiplyScalar(0.42);
        // Neon dimmed to match. The far rows keep more of it, because that is the one
        // thing that still carries through heavy fog and sells the distance.
        const glow = new THREE.Color(corp.color).multiplyScalar(0.5 + depthIndex * 0.28);

        /**
         * Frame and rooms, the same way the play plane builds. Anything else makes the
         * settlement look like it was put up by different people to different rules —
         * and the near row is only 24 units behind structures the player flies through.
         */
        const bays = bayCount(height, BACKDROP_MAX_BAYS);
        const bayH = height / bays;

        if (depthIndex <= BACKDROP_LATTICE_ROWS) {
          for (const m of latticeMembers(height, width, depth, member, BACKDROP_MAX_BAYS)) {
            hulls.push(memberGeometry(m, shade).translate(x, baseY, z));
          }
        } else {
          // Past the fourth row the frame is finer than the fog will ever show, so those
          // buildings stay massing — which also keeps the build from allocating several
          // thousand boxes for detail nobody can resolve.
          hulls.push(tintedBox(width, height, depth, shade).translate(x, baseY + height / 2, z));
        }

        // Pressurised rooms hung in the frame, as on the towers. Their count is the one
        // honest signal of how much sealed volume an operator can afford out here.
        const roomCount = 1 + Math.floor(r(6) * Math.min(3, bays));
        for (let m = 0; m < roomCount; m++) {
          const bay = Math.min(bays - 1, Math.floor(r(10 + m) * bays));
          const cy = baseY + bayH * (bay + 0.5);
          hulls.push(tintedBox(width * 0.82, bayH * 0.68, depth * 0.82, shade).translate(x, cy, z));
          // Lit underside, so a room reads as occupied rather than as a lump in a frame.
          if (r(20 + m) > 0.35) {
            lamps.push(
              tintedBox(width * 0.86, 0.5, depth * 0.86, glow).translate(x, cy - bayH * 0.33, z),
            );
          }
        }
        // Roof light, so the top of a frame is not a blank cap.
        if (r(9) > 0.45) {
          lamps.push(tintedBox(width * 0.3, 0.5, depth * 0.3, glow).translate(x, baseY + height, z));
        }
      });
    });

    /**
     * The whole settlement in two draw calls.
     *
     * This used to be two meshes per building — 194 of them at mission 30, which was
     * most of the frame's draw calls on its own, and going modular would have tripled
     * it. Nothing here moves, carries a collider, or is ever picked, so there is no
     * reason for any of it to be a separate object: colour is the only thing that
     * varied between them, and colour moved into the vertices.
     */
    const add = (parts: THREE.BufferGeometry[], material: THREE.Material) => {
      if (parts.length === 0) return;
      const merged = mergeGeometries(parts, false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, material);
      this.scene.add(mesh);
      this.objects.push(mesh);
    };

    add(
      hulls,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0.05,
        flatShading: true,
      }),
    );
    // Unlit: these are meant to read as lights, and the canyon floor has no sun on it
    // to light them with. Fog still applies, which is what grades the rows apart.
    add(lamps, new THREE.MeshBasicMaterial({ vertexColors: true }));
  }

  /**
   * Territory boundary pylons used to stand here, one pair per charter, planted at their
   * claim's edge from the moment the canyon generated — which put Helion's orange and
   * Kessler's cyan on the floor from mission 1, missions before either charter is even
   * mentioned in a brief. Removed rather than gated to a corp's first mission: the colony
   * itself is already the claim marker, standing in the same colour the moment there is
   * one cell of it to see, and a second, redundant marker that had to be *taught* when to
   * appear was solving a problem the growth system had already solved correctly.
   */

  /**
   * `darken` lived here and is gone deliberately.
   *
   * It put a charter's frontage out for the two missions its work was suspended under
   * injunction, and it was reaching for a visible signal rather than a true one: an
   * injunction stops drilling, and site lighting is exactly what a stopped site keeps on.
   * It was written because the growth freeze that *is* correct turned out to be invisible
   * — Helion and Kessler are capped by `reachableGround` at 30 and 35 cells from mission 8
   * to 12 whatever the player scores, so freezing a number that was not moving shows
   * nothing — and designing backwards from "what can I make visible" produced a lie.
   *
   * `colonyFrozen` stays. It is not the beat, but it is true: a contract suspended under
   * order never built anything, so the colony carries the dent for the rest of the
   * campaign. What the player sees during those two missions is what the briefs say.
   *
   * `unlight` survives because `collapse` still needs it.
   */

  /**
   * Brings the whole settlement down, in place, for the epilogue.
   *
   * The charge went off at the bottom of the shaft, so what the last carrier falls past
   * cannot be a working colony with the lights switched off — it has to be wreckage. But
   * it must be **this player's** wreckage. The canyon they are falling through is the one
   * their own thirty deliveries grew, cell by cell, and replacing it with anonymous
   * rubble would throw away the only thing that makes the shot land: you recognise the
   * frontage a second before you notice it is lying on its side. So nothing is swapped
   * for debris. The debris is the colony.
   *
   * Three things happen to every structure, all keyed off `hash01` on the campaign seed
   * so a replayed ending is the identical ruin:
   *
   * - roughly a fifth of it is simply gone, which is what makes the rest read as what is
   *   *left* rather than as a settlement that has been tilted;
   * - the remainder leans, drops and slides — it has come down, not blown outward, which
   *   is the right shape for a floor collapsing under a site rather than a bomb going off
   *   on top of one;
   * - every emissive fitting and every point light goes out. Nothing here has power.
   *
   * Rotation goes through a pivot at each object's own centre. Colony geometry is baked
   * in world coordinates with the mesh sitting at the origin (see `buildColonyCells`), so
   * setting `rotation` on it directly would swing the building around the middle of the
   * canyon instead of around itself — a whole settlement orbiting x=0, which looks exactly
   * like a physics bug and is one of the two ways this could have gone wrong invisibly.
   *
   * Colliders are deliberately left standing where the structures used to be, and that is
   * load-bearing rather than lazy. The epilogue decides where to cut the picture from
   * `groundBelow` (see `FALL_CUT_HEIGHT` in `Game.ts`), so those colliders are exactly what
   * it measures against — measured at x 48 on one seed, a tower's collider sits at y≈158
   * over a mouth at y≈8. Leaving them is the conservative direction: the ending cuts a
   * clear margin above where a building *was*, so a vehicle can never be brought down
   * through one that has since leaned or dropped. Clearing them to match the visuals would
   * move every cut lower, toward geometry nobody has checked, to fix a discrepancy the
   * player cannot see.
   *
   * `buried` is stone piled over the mouths of the bores — the one piece of the ending
   * that is new geometry rather than existing geometry moved. It is what actually happened:
   * the charge was seated at the bottom of the shaft, and the shaft is the thing that is
   * no longer there. Everything else in this method is consequence; the filled hole is the
   * event. Built here rather than by the caller because `Rubble`'s own contract is that
   * whoever tracks the object disposes it, and `objects` is that ledger.
   *
   * A post-pass over the built scene rather than a flag threaded through construction.
   * A colony is never built ruined — this happens to one, once, at the end of a campaign,
   * and paying for it on every mission's build path would be the wrong trade. Materials
   * and geometry are per-build and disposed on rebuild, and the pivots take their meshes
   * with them into `objects`, so `dispose` still reaches everything.
   */
  collapse(seed: number, buried: RubbleSite[] = []): void {
    const kept: THREE.Object3D[] = [];

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];

      // Struck from the record entirely. Geometry and materials are released here rather
      // than left for `dispose`, which will no longer be able to see them.
      if (hash01(seed, i, 0, 0x5ea1) < 0.21) {
        this.scene.remove(obj);
        obj.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else if (mat) mat.dispose();
        });
        continue;
      }

      unlight(obj);

      const bounds = new THREE.Box3().setFromObject(obj);
      if (bounds.isEmpty()) {
        kept.push(obj);
        continue;
      }
      const centre = bounds.getCenter(new THREE.Vector3());

      const pivot = new THREE.Group();
      this.scene.remove(obj);
      obj.position.sub(centre);
      pivot.add(obj);
      // Down and sideways, never up: this came down.
      pivot.position.set(
        centre.x + (hash01(seed, i, 1, 0x5ea1) - 0.5) * 6,
        centre.y - hash01(seed, i, 2, 0x5ea1) * 13,
        centre.z,
      );
      pivot.rotation.z = (hash01(seed, i, 3, 0x5ea1) - 0.5) * 0.7;
      this.scene.add(pivot);
      kept.push(pivot);
    }

    const stone = buildRubble(this.scene, buried, seed);
    if (stone) kept.push(stone);

    this.objects = kept;
    // The pads are gone with everything else, and a target marker chasing a deck that is
    // now lying on its side would be the one piece of live UI in a dead canyon.
    this.setTarget(null);
  }

  dispose(): void {
    for (const obj of this.objects) {
      this.scene.remove(obj);
      // Traversed rather than treated as a single mesh: the radar head is a group with
      // its own children, and removing it from the scene would otherwise strand their
      // geometry and materials on the GPU across every retry.
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    }
    for (const texture of this.textures) texture.dispose();
    this.textures = [];
    this.objects = [];
    this.pads = [];
    this.rings = [];
    this.lattices = [];
    this.latticeCursor = 0;
    this.radar = null;
    this.relays = [];
    // The colliders themselves belong to the physics world, which the caller clears.
    this.kinematics.clear();
  }
}
