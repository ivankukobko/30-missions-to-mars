import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { KinematicBody, KinematicWorld, type Motion } from '../physics/Kinematics.ts';
import { CORPS, type CorpId } from './CanyonSpec.ts';
import type { CanyonGenerator } from './CanyonGenerator.ts';

/**
 * Everything the colony has built. These are authored props, not terrain — which is
 * the whole trick: a heightfield cannot express an overhang, but a *structure* can.
 * Caves, gantries and platforms are things the colonists made, so they get to be
 * objects with their own colliders, and the terrain never has to do anything clever.
 *
 * Props accumulate across the campaign and are never removed. The canyon the player
 * flies in mission 30 is the one they spent 29 missions helping to build.
 */
export type Prop =
  /** Corporate tower. `topY` is absolute so silhouettes are seed-independent. */
  | { kind: 'tower'; corp: CorpId; x: number; width: number; topY: number }
  /**
   * Horizontal span across the corridor. A lethal line to cross above or below.
   * With `motion`, a travelling gantry: the authored span is the centre of its travel.
   */
  | {
      kind: 'gantry';
      corp: CorpId;
      x1: number;
      x2: number;
      y: number;
      thickness?: number;
      motion?: Motion;
    }
  /** Thin lethal spire — antenna masts and drill towers. */
  | { kind: 'mast'; corp: CorpId; x: number; topY: number }
  /**
   * Slab held above the floor on stilts. Usually carries a pad.
   * With `motion`, a flying deck — it loses its stilts, having nothing to stand on.
   */
  | { kind: 'platform'; corp: CorpId; x: number; y: number; width: number; motion?: Motion }
  /** Roof slab over an excavation, turning a pit into a cave with a real ceiling. */
  | { kind: 'caveRoof'; corp: CorpId; x: number; halfWidth: number; y: number }
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
   * Landing pad. `id` is what a mission names as its delivery target.
   * Omit `y` to rest on whatever ground is beneath — canyon floor, or the floor of
   * an excavation. The deck always sits slightly *above* the terrain, so touchdown
   * resolves against the pad collider and nothing else.
   */
  | { kind: 'pad'; id: string; corp: CorpId; x: number; width: number; y?: number };

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

const LATTICE = {
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
 * Shared rather than rewritten per caller, because two of the callers have to agree
 * exactly: `latticeMembers` puts the ring bracing on these bay lines, and `buildTower`
 * hangs its pressurised modules on them. Two copies of the formula that drift by one
 * bay leave every module floating between rings.
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
 *
 * Masts stay square and slim. They are poles; they are supposed to look like poles.
 */
const DEPTH = {
  tower: 17,
  gantry: 11,
  platform: 9,
  pad: 8.5,
  caveRoof: 15,
} as const;

/** How far the whole main row is drawn toward the camera from the play plane. */
const ROW_SHIFT = 1;

/**
 * Across the flats of a mast's lattice.
 *
 * Held to exactly the width of the solid pole it replaces, because that is the width of
 * the collider (half-width 0.7). Any wider and the visible frame overhangs the thing
 * that actually stops you, so a pilot could clip structure and live — which teaches the
 * wrong lesson about every other beam in the canyon.
 */
const MAST_WIDTH = 1.4;

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

export class Colony {
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private objects: THREE.Object3D[] = [];
  /** Generated textures, which material disposal does not reach. */
  private textures: THREE.Texture[] = [];

  pads: PadInfo[] = [];
  /**
   * Every moving structure in the mission. Advanced by `Game` inside the fixed-step
   * loop, not here — a crane's pose is simulation state, and stepping it on the render
   * clock would make it stutter with the frame rate and drift out of determinism.
   */
  readonly kinematics = new KinematicWorld();
  /** Meshes that follow a kinematic body, with the position each holds at rest. */
  private carried: Array<{ body: KinematicBody; object: THREE.Object3D; x: number; y: number }> = [];
  private rings: LandingRing[] = [];
  private radar: Radar | null = null;
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
  update(dt: number, camera?: THREE.Camera): void {
    this.updateRadar(dt, camera);
    this.followKinematics();
    if (camera) this.updateLattices(camera);

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
   * Puts the visible structures where their colliders already are.
   *
   * Read from the body rather than recomputed from the clock, so the mesh cannot end up
   * describing a different pose from the thing that will kill you. Purely a copy: the
   * bodies were advanced during the physics step.
   */
  private followKinematics(): void {
    for (const held of this.carried) {
      held.object.position.x = held.x + held.body.offset.x;
      held.object.position.y = held.y + held.body.offset.y;
    }
  }

  /** Attaches a mesh to a moving body, remembering where it sits at rest. */
  private carry(body: KinematicBody, object: THREE.Object3D): void {
    this.carried.push({ body, object, x: object.position.x, y: object.position.y });
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

  build(props: Prop[], canyon: CanyonGenerator): void {
    this.dispose();
    this.pads = [];
    this.rings = [];
    this.lattices = [];
    this.latticeCursor = 0;
    this.radar = null;

    this.buildClaimMarkers(canyon);
    this.buildBackdropColony(props, canyon);

    for (const prop of props) {
      switch (prop.kind) {
        case 'tower':
          this.buildTower(prop, canyon);
          break;
        case 'gantry':
          this.buildGantry(prop);
          break;
        case 'mast':
          this.buildMast(prop, canyon);
          break;
        case 'platform':
          this.buildPlatform(prop, canyon, props);
          break;
        case 'caveRoof':
          this.buildCaveRoof(prop);
          break;
        case 'pad':
          this.buildPad(prop, canyon);
          break;
        case 'radar':
          this.buildRadar(prop, canyon);
          break;
      }
    }
  }

  // ------------------------------------------------------------------ props

  private buildTower(
    prop: Extract<Prop, { kind: 'tower' }>,
    canyon: CanyonGenerator,
  ): void {
    const corp = CORPS[prop.corp];
    // Sunk just enough to read as anchored. Deeper than this and the buried section
    // shows in front of the near cut instead of disappearing into it.
    const baseY = canyon.floorAt(prop.x) - 2;
    const height = Math.max(8, prop.topY - baseY);
    const cy = baseY + height / 2;

    const z = zCentre(DEPTH.tower);
    const hull = new THREE.MeshStandardMaterial({
      color: corp.hull,
      roughness: 0.55,
      metalness: 0.18,
      flatShading: true,
    });

    // Frame, not a slab. A tower this size as solid volume is more material than anyone
    // in this canyon has, and it walls off the sightlines the late campaign is flown on.
    this.addLattice(prop.x, baseY, z, height, prop.width, DEPTH.tower, hull);

    /**
     * Pressurised modules hung in the frame.
     *
     * These are the expensive part — sealed volume, shipped or fabricated — so there are
     * only ever a few, and how many a structure carries is a reasonable read on how rich
     * its owner is. They also give the frame rhythm: pure lattice all the way up is
     * visual noise with no silhouette.
     */
    // Must be the same count `latticeMembers` used, or the modules hang between rings.
    const bays = bayCount(height);
    const bayH = height / bays;
    const modules = Math.max(1, Math.round(bays / 3.5));
    for (let i = 0; i < modules; i++) {
      // Deterministic placement from the tower's own x, so retries rebuild it identically.
      const r = Math.abs(Math.sin((prop.x * 12.9898 + i * 78.233) * 43758.5453) % 1);
      const bay = Math.min(bays - 1, Math.floor(r * bays));
      const module = new THREE.Mesh(
        new THREE.BoxGeometry(prop.width * 0.86, bayH * 0.72, DEPTH.tower * 0.86),
        hull,
      );
      module.position.set(prop.x, baseY + bayH * (bay + 0.5), z);
      module.castShadow = true;
      module.receiveShadow = true;
      this.scene.add(module);
      this.objects.push(module);

      // The lit face. Emissive only, so a canyon full of towers costs no light budget.
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(prop.width * 0.9, 0.5, DEPTH.tower * 0.9),
        new THREE.MeshStandardMaterial({
          color: corp.color,
          emissive: corp.color,
          emissiveIntensity: 1.1,
          roughness: 0.4,
        }),
      );
      strip.position.set(prop.x, baseY + bayH * (bay + 0.5) - bayH * 0.36, z);
      this.scene.add(strip);
      this.objects.push(strip);
    }

    // The collider stays the full solid box it always was. The frame is see-through,
    // but it is not fly-through, and with instant death on contact that gap must never
    // be something the player has to discover.
    this.physics.addBox(prop.x, cy, prop.width / 2, height / 2, 'structure');
  }

  private buildGantry(prop: Extract<Prop, { kind: 'gantry' }>): void {
    const corp = CORPS[prop.corp];
    const span = Math.abs(prop.x2 - prop.x1);
    const cx = (prop.x1 + prop.x2) / 2;
    const thickness = prop.thickness ?? 2.4;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(span, thickness, DEPTH.gantry),
      new THREE.MeshStandardMaterial({
        color: corp.hull,
        roughness: 0.5,
        metalness: 0.18,
        flatShading: true,
      }),
    );
    mesh.position.set(cx, prop.y, zCentre(DEPTH.gantry));
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.objects.push(mesh);

    // A travelling gantry rides its rail; a fixed one is bolted where it was authored.
    const body = prop.motion ? this.kinematics.add(new KinematicBody(prop.motion)) : null;
    if (body) this.carry(body, mesh);

    // Running lights along the underside — the visual warning that this is solid.
    const lampCount = Math.max(2, Math.floor(span / 12));
    for (let i = 0; i < lampCount; i++) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.4, DEPTH.gantry * 0.75),
        new THREE.MeshStandardMaterial({
          color: corp.color,
          emissive: corp.color,
          emissiveIntensity: 1.8,
        }),
      );
      lamp.position.set(
        prop.x1 + (span * (i + 0.5)) / lampCount * Math.sign(prop.x2 - prop.x1 || 1),
        prop.y - thickness / 2 - 0.2,
        zCentre(DEPTH.gantry),
      );
      this.scene.add(lamp);
      this.objects.push(lamp);
      if (body) this.carry(body, lamp);
    }

    if (body) body.box(this.physics, cx, prop.y, span / 2, thickness / 2, 'structure');
    else this.physics.addBox(cx, prop.y, span / 2, thickness / 2, 'structure');
  }

  private buildMast(prop: Extract<Prop, { kind: 'mast' }>, canyon: CanyonGenerator): void {
    const corp = CORPS[prop.corp];
    const baseY = canyon.floorAt(prop.x);
    const height = Math.max(6, prop.topY - baseY);
    const cy = baseY + height / 2;

    // A guyed lattice spire. Slightly wider across the flats than the old solid pole,
    // and a small fraction of the material — which is the point.
    this.addLattice(
      prop.x,
      baseY,
      0,
      height,
      MAST_WIDTH,
      MAST_WIDTH,
      new THREE.MeshStandardMaterial({
        color: corp.hull,
        roughness: 0.4,
        metalness: 0.2,
        flatShading: true,
      }),
    );

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 8, 6),
      new THREE.MeshStandardMaterial({
        color: corp.color,
        emissive: corp.color,
        emissiveIntensity: 1.4,
      }),
    );
    tip.position.set(prop.x, baseY + height, 0);
    this.scene.add(tip);
    this.objects.push(tip);

    // Collider unchanged: the spire is see-through, not passable.
    this.physics.addBox(prop.x, cy, 0.7, height / 2, 'structure');
  }

  private buildPlatform(
    prop: Extract<Prop, { kind: 'platform' }>,
    canyon: CanyonGenerator,
    all: Prop[],
  ): void {
    const corp = CORPS[prop.corp];

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(prop.width, 1.8, DEPTH.platform),
      new THREE.MeshStandardMaterial({
        color: corp.hull,
        roughness: 0.5,
        metalness: 0.18,
        flatShading: true,
      }),
    );
    slab.position.set(prop.x, prop.y - 0.9, zSurface(DEPTH.platform));
    slab.castShadow = true;
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.objects.push(slab);

    /**
     * A flying deck gets no legs and no brace.
     *
     * Stilts are the one part of a platform that is structurally an argument about where
     * it is: they run to the ground beneath the authored x, so a deck that traverses
     * would drag them sideways through the rock they are supposedly planted in. A deck
     * that moves is held up by something else, and the honest way to draw that is to
     * draw nothing.
     */
    const body = prop.motion ? this.kinematics.add(new KinematicBody(prop.motion)) : null;
    if (body) {
      this.carry(body, slab);
      body.box(this.physics, prop.x, prop.y - 0.9, prop.width / 2, 0.9, 'structure');
      return;
    }

    // Stilts down to whatever is beneath — floor, or the wall of an excavation.
    // Capped: a platform bolted partway down a 170-unit shaft would otherwise grow
    // a leg the length of the shaft.
    const groundY = canyon.floorAt(prop.x);
    const drop = prop.y - 1.8 - groundY;
    const legHeight = Math.max(0, drop);
    if (drop > 1 && drop <= 26) {
      // Four legs, front and back — two read as a cut-out, four as a trestle. Offset
      // from the slab's own centre, so they stay under it wherever the slab sits.
      // Slimmer than the 0.9 posts they replace and cross-braced, because a deck this
      // size standing on four solid columns is more steel than the frame holding the
      // deck itself.
      const slabZ = zSurface(DEPTH.platform);
      const legMat = new THREE.MeshStandardMaterial({
        color: corp.hull,
        roughness: 0.6,
        metalness: 0.18,
        flatShading: true,
      });
      const span = prop.width - 2.4;
      for (const sz of [slabZ + DEPTH.platform * 0.34, slabZ - DEPTH.platform * 0.34]) {
        for (const sx of [-span / 2, span / 2]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, legHeight, 0.5), legMat);
          leg.position.set(prop.x + sx, groundY + legHeight / 2, sz);
          this.scene.add(leg);
          this.objects.push(leg);
        }

        // One X between each pair, which is what turns four posts into a trestle.
        for (const dir of [1, -1]) {
          const brace = new THREE.Mesh(
            new THREE.BoxGeometry(Math.hypot(span, legHeight), 0.35, 0.35),
            legMat,
          );
          brace.rotation.z = dir * Math.atan2(legHeight, span);
          brace.position.set(prop.x, groundY + legHeight / 2, sz);
          this.scene.add(brace);
          this.objects.push(brace);
        }
      }
    } else {
      this.buildPlatformBrace(prop, all);
    }

    this.physics.addBox(prop.x, prop.y - 0.9, prop.width / 2, 0.9, 'structure');
  }

  /**
   * A deck high above the floor is a balcony, not a trestle: stilts would either run
   * sixty units to the ground or, capped, stop in mid-air. It gets a boxed arm to the
   * nearest tower instead — which is also what makes it read as *attached* to the
   * building rather than passing through it.
   */
  private buildPlatformBrace(prop: Extract<Prop, { kind: 'platform' }>, all: Prop[]): void {
    const corp = CORPS[prop.corp];
    let best: { face: number; dist: number } | null = null;
    for (const other of all) {
      if (other.kind !== 'tower') continue;
      // The tower face on the side the platform sits.
      const face = other.x + (prop.x > other.x ? other.width / 2 : -other.width / 2);
      const dist = Math.abs(prop.x - face);
      if (!best || dist < best.dist) best = { face, dist };
    }
    if (!best || best.dist > prop.width) return;

    const edge = prop.x + (best.face > prop.x ? prop.width / 2 : -prop.width / 2);
    const span = Math.abs(best.face - edge) + 2;
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(1.5, span), 2.2, DEPTH.platform * 0.55),
      new THREE.MeshStandardMaterial({
        color: corp.hull,
        roughness: 0.6,
        metalness: 0.18,
        flatShading: true,
      }),
    );
    brace.position.set((best.face + edge) / 2, prop.y - 3.2, zSurface(DEPTH.platform));
    this.scene.add(brace);
    this.objects.push(brace);
  }

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
    // A ground pad rests just above the terrain rather than flush with it, so the
    // pad collider is the only surface at touchdown height.
    const y = prop.y ?? canyon.floorAt(prop.x) + 1.3;

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(prop.width, 0.9, DEPTH.pad),
      new THREE.MeshStandardMaterial({
        color: 0x1b2228,
        roughness: 0.6,
        metalness: 0.18,
      }),
    );
    const deckZ = zSurface(DEPTH.pad);
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
  private buildRadar(prop: Extract<Prop, { kind: 'radar' }>, canyon: CanyonGenerator): void {
    const corp = CORPS[prop.corp];
    /**
     * `prop.y` is the exact height the lander settled at in mission 1 — ground truth,
     * not an estimate — and is used whenever it is known. Only a save written before
     * `Progress.mastY` existed falls through to the old approximation: terrain resampled
     * at the mast's own z, which is a different cross-section from where the touchdown
     * actually happened. The canyon meanders, so that resample could disagree with the
     * real ground by enough to bury the mast's base or leave it standing on air —
     * `floorAt`, the z=0 profile, is not the fix either, since the mast is drawn at
     * `RADAR.Z` and floorAt is a third cross-section again. There is no terrain sample
     * that is exactly right except the one instant the vehicle was actually standing on
     * the ground, which is exactly what `prop.y` now records.
     */
    const baseY = canyon.heightAt(prop.x, RADAR.Z) - 1;
    const topY = baseY + RADAR.HEIGHT;

    const hull = new THREE.MeshStandardMaterial({
      color: corp.hull,
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
        color: corp.hull,
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
    const solid = props.filter(
      (p) => p.kind === 'tower' || p.kind === 'mast' || p.kind === 'gantry',
    );
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
        const x = ('x' in prop ? prop.x : (prop.x1 + prop.x2) / 2) + (r(2) - 0.5) * spread;

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
   * Territory boundary pylons. Decoration only — set back in Z, no colliders.
   *
   * Each one is planted on the ground at its own (x, z) rather than at FLOOR_Y. The
   * canyon floor has real relief now, so a marker pinned to a fixed height reads as a
   * flat slab punched through the terrain wherever the ground falls away.
   */
  private buildClaimMarkers(canyon: CanyonGenerator): void {
    for (const corp of Object.values(CORPS)) {
      if (corp.id === 'outpost') continue;
      const edge = corp.claim[0] < 0 ? corp.claim[1] : corp.claim[0];

      for (const z of [-12, -28]) {
        const height = 16;
        const baseY = canyon.heightAt(edge, z) - 1;

        // The mast is lit, not emissive, so it shades like an object. Thin: it is a
        // boundary marker, and at 0.9 it read as structure the player ought to avoid.
        const mast = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, height, 0.45),
          new THREE.MeshStandardMaterial({
            color: corp.hull,
            roughness: 0.6,
            metalness: 0.2,
            flatShading: true,
          }),
        );
        mast.position.set(edge, baseY + height / 2, z);
        this.scene.add(mast);
        this.objects.push(mast);

        // Only the lamp glows, which is what makes it read as a marker at distance.
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(1.7, 1.1, 1.7),
          new THREE.MeshStandardMaterial({
            color: corp.color,
            emissive: corp.color,
            emissiveIntensity: 2,
          }),
        );
        lamp.position.set(edge, baseY + height, z);
        this.scene.add(lamp);
        this.objects.push(lamp);
      }
    }
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
    // The colliders themselves belong to the physics world, which the caller clears.
    this.kinematics.clear();
    this.carried = [];
  }
}
