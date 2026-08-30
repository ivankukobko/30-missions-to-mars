import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputState } from '../core/InputManager.ts';
import { cargoShape, type Payload } from '../campaign/Missions.ts';
import { lerp } from '../world/Noise.ts';
import { AIRFRAMES, type Airframe } from './Airframe.ts';
import { idleFiring, LANDER, LanderBody, type Contact, type Firing } from './LanderBody.ts';

/**
 * The lander you can see, wrapped around the lander that flies.
 *
 * `LanderBody` owns every number the simulation cares about and imports no renderer;
 * this file owns the cone, the struts and the lamps. The class below is the seam
 * between them, so `Game` keeps talking to one object.
 */

export { LANDER, type Contact };

/**
 * Vehicle layout, in model space.
 *
 * The body settles with its origin `LANDER.RADIUS` above the pad, so anything below
 * −0.62 here is inside the deck on touchdown. The lander used to be a cone with the
 * load slung underneath, which put the cargo outside the collider in the one direction
 * it could not survive: on the heaviest manifest the pod hung 0.90 below the pad at
 * settle, under the feet that were supposed to take the landing, with the exhaust cone
 * passing straight through it.
 *
 * This is a flatbed instead — chassis, deck, load on top, engines outboard under the
 * belly. The load sits above the origin at every mass, so no manifest can bury it, and
 * the two plumes fall in the gap between the pods and the gear. It also reads better
 * where it has to: the deck is a horizontal line, which is far easier to judge tilt
 * against than a cone, and the cargo silhouette is now against sky instead of tangled
 * in legs and flame.
 */
const HULL = {
  /** The structural spine. Everything else hangs off it. */
  CHASSIS: { w: 1.15, h: 0.36, d: 0.7, y: -0.14 },
  /**
   * Deck plate. Its top face is what cargo stands on.
   *
   * Square, not the 1.25×0.8 rectangle it used to be — every hull profile revolves
   * around Y (`buildHullBody`), so the chassis underneath is already round in plan; the
   * deck was the one part of every airframe's silhouette that read as longer one way
   * than the other from directly overhead. `w` doubling as `d` matches the hull it sits
   * on rather than picking a side to be the longer one.
   */
  DECK: { w: 1.25, h: 0.07, d: 1.25, y: 0.075 },
  /**
   * Nominal vertical station of an engine pod. Where they sit *across* is the
   * airframe's business, and a canted pod is lifted from here — see `mountHeight`.
   */
  POD_Y: -0.45,
  POD_H: 0.26,
  /** How far a nozzle stays clear of the deck the vehicle has settled onto. */
  POD_CLEARANCE: 0.02,
  FLAME_LEN: 1.45,
} as const;

/** Top face of the deck plate: the surface the load stands on. */
const DECK_TOP = HULL.DECK.y + HULL.DECK.h / 2;

/**
 * Landing gear geometry.
 *
 * Stowed is 2.68, swinging each leg up and outboard to lie flush along the chassis
 * flank; a leg left hanging would be the lowest thing on the vehicle, which is the
 * mistake this redesign exists to undo.
 */
const LEG = {
  /**
   * Narrow enough that the deployed feet span 0.81 either side — near where the cone's
   * gear reached. Horizontal overhang past the 0.62 collider is the reading that
   * matters in a canyon, where the walls are the thing you are threading.
   *
   * Also the fore/aft hinge offset, not just the port/starboard one — the four hinges sit
   * at the corners of a square, `±HINGE_X` on both axes, so the stance reads the same
   * from any bearing. It used to be a bare `0.3` on the fore/aft axis alone, sized to fit
   * inside the chassis's old 0.7-deep footprint rather than to match the port/starboard
   * spacing — a rectangle nobody chose on purpose, left over from before the deck (and
   * every hull profile revolving round) made "square in plan" the shape everything else
   * here already commits to.
   */
  HINGE_X: 0.4,
  HINGE_Y: -0.32,
  LENGTH: 0.36,
  FOOT_W: 0.3,
  FOOT_H: 0.1,
  STOWED: 2.68,
} as const;

/**
 * Deployed angle, solved rather than chosen.
 *
 * `settle()` puts the body's origin exactly `LANDER.RADIUS` above the pad, so the deck
 * the vehicle has just landed on is the plane y = −0.62 in this space, and the underside
 * of a foot has to reach it — no further. Rotating a leg by θ puts its foot centre at
 * `HINGE_Y − LENGTH·cos θ`, so the angle that stands the gear on the deck is the one
 * below. The old cone hard-coded an angle that overshot by 0.17 and the comment called
 * it a slight interpenetration; on a flatbed, where the gear is most of the silhouette,
 * it read as legs sunk into the pad. Deriving it means a change to the hinge or the leg
 * length cannot quietly reintroduce that.
 *
 * Constraint on the constants above: `HINGE_Y + RADIUS − FOOT_H/2` must not exceed
 * `LENGTH`, or the leg is too short to reach the ground at any angle.
 */
const LEG_DEPLOYED = Math.acos(
  (LEG.HINGE_Y + LANDER.RADIUS - LEG.FOOT_H / 2) / LEG.LENGTH,
);

/**
 * Where an engine's mount sits, given how far that engine is canted.
 *
 * A pod rotated about its own centre reaches lower than an upright one: the corner that
 * was directly beneath the mount swings outward *and* down, by
 * `halfHeight·cos θ + radius·|sin θ|` instead of just `halfHeight`. At the hauler's 30°
 * that is 0.037 more than the upright case — which is exactly how far the twin was
 * found sitting inside the pad it had just landed on.
 *
 * So the station is solved rather than authored, like `LEG_DEPLOYED`: lift each mount by
 * whatever its own cant costs, and no engine can dip below the deck however far a future
 * airframe angles it. An upright pod is unaffected and stays at the nominal station.
 */
function mountHeight(cant: number, radius: number): number {
  const reach = (HULL.POD_H / 2) * Math.cos(cant) + radius * Math.abs(Math.sin(cant));
  return Math.max(HULL.POD_Y, -LANDER.RADIUS + HULL.POD_CLEARANCE + reach);
}

/**
 * How long a plume gets, given how far its engine is canted.
 *
 * `HULL.FLAME_LEN` was tuned for a plume hanging *below* the hull — the lander's single
 * engine and the hauler's pair, canted at most 30°. A length that reads as thrust in
 * that orientation reads as a spike once the mount rotates it towards horizontal: at 90°
 * of cant, the Sidewinder's lateral engines, the same 1.45 reached 1.6+ units outward
 * from the hull centreline — more than double the hull's own half-width, a plume wider
 * than the vehicle carrying it.
 *
 * `cos cant` is already the number the physics uses for how much of an engine's thrust
 * is vertical — `applyDifferential` scales lift by exactly this — so reusing it here
 * means a plume's *visible* length tracks the same quantity as its *effective* lift,
 * which is the honest reading: an engine pointed mostly sideways is doing comparatively
 * little of the vertical work a long tail implies. Raised to a shallow power (`0.25`) so
 * the curve barely moves near the angles already shipped — 30° comes out 96% of the
 * unscaled length, not a visible change — and only falls away as cant approaches 90°.
 * Floored at 0.35 so a pure lateral thruster still reads as *something* rather than a
 * puff too short to see it fire at all.
 */
function flameLength(cant: number): number {
  const vertical = Math.max(0, Math.cos(cant));
  return HULL.FLAME_LEN * Math.max(0.35, vertical ** 0.25);
}

/**
 * A hull's silhouette: radius at a sequence of heights, base to the deck's underside.
 *
 * `y` is a fraction of the chassis span (0 at the belly, 1 flush against the deck), not
 * a world coordinate — so a profile is written once and reads the same regardless of
 * where `HULL.CHASSIS` happens to sit. `r` is a world-space radius and is not similarly
 * normalised: the collider stays the fixed circle it always was, `LANDER.RADIUS`, so a
 * profile's numbers are legible against that one constant rather than against each
 * other. Deck half-width is 0.625, a hair over the collider, and every profile below
 * stays under that near the top — the deck should read as sitting *on* the hull, not
 * swallowed by it.
 */
interface HullProfile {
  points: ReadonlyArray<readonly [y: number, r: number]>;
  /**
   * Radial facets. Low, to stay in the register everything else here is drawn in — the
   * cargo pods are an icosahedron and a hexagonal drum, not a sphere and a tube.
   */
  segments: number;
}

/**
 * One silhouette per *charter* airframe, so a client is recognisable by hull alone at a
 * range where the trim colour has already fogged out.
 *
 * They all occupy the same vertical span as the box they replaced — only the radius
 * curve differs — which is what lets this be a drop-in for `chassis` rather than a
 * renegotiation of where the deck, the gear or the engines sit.
 *
 * The relay is not in here — see `buildRelayMast`. It used to be, as a lathe profile
 * that only ever varied 0.13 to 0.19 across its whole height: a straight taper, smooth,
 * one continuous surface. Every *other* airframe here is a single lathe-revolved shell
 * for the same reason a real hull is one welded skin, but the relay carries nothing and
 * builds nothing — it is the one vehicle in the roster that is closer kin to the
 * colony's own scaffolding than to a charter's hull, so it is built the way the colony
 * now is: nested open frames, not a smooth revolve.
 */
const HULL_PROFILES: Record<Exclude<Airframe['id'], 'relay'>, HullProfile> = {
  /**
   * TD-4, Ixion: the rocket-truck. Narrow at the throat, swelling toward the deck and
   * levelling off just under it — the "still a flatbed" part of the brief. A rounded
   * hull reads as the vehicle a research outpost would fly: familiar, general-purpose,
   * not built around one job the way the other two are.
   */
  lander: {
    segments: 8,
    points: [
      [0, 0.26],
      [0.2, 0.3],
      [0.55, 0.44],
      [0.85, 0.56],
      [1, 0.56],
    ],
  },
  /**
   * KD-9, Kessler: a barrel. Shoulders wider than the deck it carries, tapering back in
   * at both ends — an overbuilt pressure vessel, which is what a charter that measures
   * itself in metres of bore would actually weld together, and the widest thing in the
   * campaign's vehicle roster on purpose.
   */
  hauler: {
    segments: 8,
    points: [
      [0, 0.34],
      [0.18, 0.5],
      [0.5, 0.6],
      [0.82, 0.52],
      [1, 0.44],
    ],
  },
  /**
   * HD-7, Helion: a flared saucer, wide at the belly and narrowing toward the deck — the
   * taper runs the opposite way from the rocket on purpose, so the two are distinct in
   * outline even in silhouette. The flare also gives the lateral engines, mounted at
   * ±0.44, a hull that is actually wide there instead of pods hanging off a narrow spine.
   */
  helion: {
    segments: 8,
    points: [
      [0, 0.58],
      [0.3, 0.6],
      [0.65, 0.48],
      [1, 0.32],
    ],
  },
};

/**
 * Revolves a profile into a capped solid: the shell three.js's `LatheGeometry` builds,
 * plus a disc at each end, because a lathe has no caps of its own and an open hull reads
 * as a hollow shell from any angle steep enough to see inside it — the free camera in
 * `?debug=1` orbits, so that angle exists even if normal play never finds it.
 */
function buildHullBody(profile: HullProfile, material: THREE.Material): THREE.Object3D[] {
  const bottom = HULL.CHASSIS.y - HULL.CHASSIS.h / 2;
  const top = HULL.CHASSIS.y + HULL.CHASSIS.h / 2;
  const span = top - bottom;

  const points = profile.points.map(([y, r]) => new THREE.Vector2(r, bottom + y * span));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(points, profile.segments), material);
  shell.castShadow = true;

  const cap = (y: number, r: number, faceUp: boolean) => {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, profile.segments), material);
    disc.rotation.x = faceUp ? -Math.PI / 2 : Math.PI / 2;
    disc.position.y = y;
    return disc;
  };

  const [, baseR] = profile.points[0];
  const [, topR] = profile.points[profile.points.length - 1];
  return [shell, cap(bottom, baseR, false), cap(top, topR, true)];
}

/** A thin box running from one point to another. `BoxGeometry`'s long side is local Y by
 *  construction, so aligning it to an arbitrary strut is one quaternion between "up" and
 *  the strut's own direction — the ring edges below only ever need the horizontal case,
 *  but the general form costs nothing extra and one helper is one thing to get right. */
function strutBetween(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, t: number): THREE.BufferGeometry {
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
 * A stack of open, tapering ring-and-post tiers — the shared construction behind both the
 * relay's ribbed base (`buildRelayMast`) and its square-sectioned tower (`buildRelayTower`).
 * One function rather than two near-copies: both are literally the same shape, "N open
 * frames, each narrower than the one below," and the only things that ever differ between
 * the two call sites are how many sides a tier has, how wide it is, and where in the
 * *whole* taper it starts counting from — all three already parameters.
 *
 * `folded` decides what "stack" means, and the two readings are both real states this
 * antenna is in at different points of a mission, not a style choice:
 *
 *   - **Nested (`folded: true`)** — every tier starts at the same `startY`, so narrower
 *     tiers nest *inside* wider ones rather than sitting on top of them. This is the
 *     antenna as it flies: one telescoped tube, collapsed to its shortest length, the way
 *     a real extending mast rides before it is deployed.
 *   - **Stacked (`folded: false`)** — each tier starts where the one before it ended, so
 *     the assembly reads its full extended height. Not built by anything yet — see
 *     `preview.ts`'s `unfolded` mode — but the geometry it will drive once the relay
 *     gets a deploy animation of its own, the same way the legs already have one.
 *
 * `tierOffset` is which tier index this call's first radius actually is in the whole
 * relay's taper, not just this call's own array — `buildRelayTower` passes
 * `RELAY_BASE_RADII.length` so its own tiers continue the base's growth (see
 * `RELAY_TIER_GROWTH`) instead of restarting it. Nested, the base's and tower's tiers all
 * share one bottom line and read as one stack, not two, so their heights have to grow
 * along one continuous count too.
 */
function stackedCage(
  startY: number,
  tierHeight: number,
  radii: readonly number[],
  sides: number,
  memberT: number,
  folded: boolean,
  tierOffset = 0,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const ring = (y: number, r: number) => {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      parts.push(strutBetween(r * Math.cos(a0), y, r * Math.sin(a0), r * Math.cos(a1), y, r * Math.sin(a1), memberT));
    }
  };
  let cursor = startY;
  radii.forEach((r, tier) => {
    const h = tierHeightAt(tierHeight, tierOffset + tier);
    const yLo = folded ? startY : cursor;
    const yHi = yLo + h;
    cursor = yHi;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const post = new THREE.BoxGeometry(memberT, h, memberT);
      post.translate(r * Math.cos(a), (yLo + yHi) / 2, r * Math.sin(a));
      parts.push(post);
    }
    ring(yLo, r);
    ring(yHi, r);
  });
  return parts;
}

/**
 * The relay's own lower body: two open, ribbed drums stacked and tapering, wide enough to
 * stand near the splayed legs' own span, rather than `buildHullBody`'s single lathe-
 * revolved shell — see `HULL_PROFILES`'s own comment for why this one vehicle gets a
 * different construction, and `buildCargo`'s `'tower'` shape for the two narrower,
 * square-sectioned tiers that continue above the deck.
 *
 * Telescoping, not smoothly tapered: each tier holds one constant radius the whole way
 * up, and the *next* tier starts over at a smaller one, so the join between them reads as
 * a step — the collar a real extending mast has at every joint — rather than a continuous
 * curve no built object actually has.
 *
 * Eight sides rather than six, and open — posts and rings, nothing solid between them —
 * for the same reason as before: this is the one vehicle whose whole point is that it
 * carries nothing, and a denser ring of thin verticals reads as the ribbed drum a real
 * folded mast is, where a shell would read as a hull with nothing inside it to pressurise.
 */
const RELAY_BASE_RADII = [0.32, 0.2] as const;
const RELAY_BASE_SIDES = 8;
const RELAY_MEMBER = 0.018;
/** The tower's own radii and side count — `buildRelayTower` needs them too, to fold into
 *  the same band as the base rather than its own separate one. */
const RELAY_TOWER_RADII = [0.17, 0.095] as const;
const RELAY_TOWER_SIDES = 4;

/**
 * Half-width of the relay's own small deck pad — see the constructor's own comment on
 * why it has one at all. Wider than `RELAY_BASE_RADII`'s own bottom tier (0.32 — the pad
 * sits at the legs, under the base's *widest* ring, not up at the narrower base/tower
 * seam) by a small, fixed lip, so it reads as a foot the legs and the base both stand on
 * rather than either one's own top or bottom face.
 */
const RELAY_DECK_HALF = 0.38;

/**
 * Height of the very first, widest tier — every other tier's own height grows from this
 * one by `RELAY_TIER_GROWTH`, not a second constant, so there is exactly one length to
 * tune the whole taper by. A tier does not get shorter when it telescopes out: folding
 * and unfolding only ever change *where* a tier's own height starts (`stackedCage`'s own
 * `folded` flag: the same `padTop` for all four rings when folded, or each stacked on the
 * last when not) — never how tall it is. An earlier version recomputed a shorter height
 * to fit the unfolded stack into the old deck-anchored span, which put the antenna
 * backwards: the *extended* state read shorter per segment than the collapsed one.
 */
const RELAY_FOLD_HEIGHT = 0.4;

/**
 * How much taller each tier stands than the one before it, counting from the base's own
 * widest ring through the tower's narrowest — see `stackedCage`'s `tierOffset` param for
 * why the count runs continuously across both functions rather than restarting at the
 * tower. Nested, this is what gives the folded mast its conic silhouette: the narrowest,
 * innermost tier is also the tallest, so its own rim stands proud of every wider tier
 * wrapped around it, the way the inner tube of a real collapsed telescope always shows a
 * little of itself above the collar just outside it. Extended, it just means the tiers
 * nearer the tip are a little longer than the ones nearer the deck — still true to scale,
 * since which tier a ring belongs to doesn't change between the two states, only where
 * that ring's own span starts.
 */
const RELAY_TIER_GROWTH = 1.15;

/** Height of tier `tier`, counting from the very base of the whole taper (0 = the widest
 *  ring, see `RELAY_TIER_GROWTH`) — the one place this grows from `tierHeight`, so
 *  `stackedCage` and `stackedTop` can never disagree about how tall a given tier is. */
function tierHeightAt(tierHeight: number, tier: number): number {
  return tierHeight * RELAY_TIER_GROWTH ** tier;
}

/**
 * Where a `stackedCage` stack of `count` tiers (starting at whole-taper index
 * `tierOffset`) actually ends, without rebuilding its geometry just to read the number
 * back off it — `buildRelayTower` needs the base's own top, both to know where to start
 * stacking when unfolded and to report its own top to the strobe.
 *
 * Nested, every tier shares the same `startY`, so the stack's top is set by its tallest —
 * which, growth being positive, is always its *last*, narrowest tier. Stacked, it is the
 * running total of every tier's own height.
 */
function stackedTop(startY: number, tierHeight: number, count: number, folded: boolean, tierOffset = 0): number {
  if (folded) return startY + tierHeightAt(tierHeight, tierOffset + count - 1);
  let y = startY;
  for (let t = 0; t < count; t++) y += tierHeightAt(tierHeight, tierOffset + t);
  return y;
}

function buildRelayMast(material: THREE.Material, folded: boolean): THREE.Object3D[] {
  // The one anchor both states share — see `RELAY_FOLD_HEIGHT`'s own comment. Folded, the
  // tower nests in this exact band too; unfolded, `buildRelayTower` picks up wherever
  // this stack's own top lands.
  const padTop = LEG.HINGE_Y + HULL.DECK.h;
  const parts = stackedCage(padTop, RELAY_FOLD_HEIGHT, RELAY_BASE_RADII, RELAY_BASE_SIDES, RELAY_MEMBER, folded);

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) return [];
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  return [mesh];
}

/** Everything about the vehicle that is geometry rather than state. */
class LanderView {
  group = new THREE.Group();

  private flames: THREE.Mesh[] = [];
  private rcsLeft: THREE.Mesh;
  private rcsRight: THREE.Mesh;
  private thrustLight: THREE.PointLight;
  private legs: THREE.Group[] = [];
  private feet: THREE.Mesh[] = [];
  private navLights: THREE.Mesh[] = [];
  private strobe!: THREE.Mesh;
  private scene: THREE.Scene;

  /**
   * `relayFolded` only matters for the relay airframe, and defaults to the only state
   * anything in the actual game builds — see `buildRelayMast`'s call site for why. The
   * `false` case exists for `preview.ts`'s `unfolded` mode, so the deployed antenna can
   * be looked at before anything drives it there in play.
   */
  constructor(scene: THREE.Scene, payload: Payload, airframe: Airframe, relayFolded = true) {
    this.scene = scene;

    /**
     * Mid grey, not white. Ambient and hemisphere alone put ~1.2 of flat light on
     * this surface; at 84% albedo that saturates before the sun contributes anything,
     * and the hull renders as a flat white silhouette with no facets — which only
     * became visible once the entry shot put the vehicle up close.
     */
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x8e99a2,
      roughness: 0.62,
      metalness: 0.15,
      flatShading: true,
    });

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x55636d,
      roughness: 0.65,
      metalness: 0.15,
      flatShading: true,
    });

    // The hull: one silhouette per charter airframe, occupying exactly the vertical span
    // the box it replaces did — see `HULL_PROFILES`. Only the radius curve differs, so
    // nothing downstream (deck, gear, engines) needed to change to make room for it. The
    // relay is the one exception — see `buildRelayMast`. Always folded here: nothing yet
    // drives a deploy animation for it (unlike the legs), so the live vehicle is always
    // the collapsed antenna it flies with — see `preview.ts`'s `unfolded` mode for the
    // other state, until this one gets its own animation to actually reach it in play.
    const hullParts =
      airframe.id === 'relay' ? buildRelayMast(frameMat, relayFolded) : buildHullBody(HULL_PROFILES[airframe.id], frameMat);
    for (const part of hullParts) {
      this.group.add(part);
    }

    // Deck in the lighter grey against the dark chassis, so the flatbed line separates
    // by value rather than hue — it still has to read at a third of display resolution,
    // and that line is the primary attitude cue now the nose cone is gone.
    //
    // The relay gets its own, much smaller one, resting directly on the legs — see
    // `RELAY_DECK_HALF`. Every other airframe carries a load that has to be held down to
    // *something* flat, sized to that load; the relay carries nothing, and the full
    // 1.25-wide deck read as a slab dropped into the middle of what should be one
    // continuous taper from the legs to the beacon. It still needs *a* pad, though: the
    // platform the legs actually support and the ribbed base actually stands on, at
    // `LEG.HINGE_Y` — not further up at the base/tower seam, which is a joint in the
    // taper, not a place anything is standing.
    if (airframe.id === 'relay') {
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(RELAY_DECK_HALF * 2, HULL.DECK.h, RELAY_DECK_HALF * 2),
        hullMat,
      );
      deck.position.y = LEG.HINGE_Y + HULL.DECK.h / 2;
      deck.castShadow = true;
      this.group.add(deck);
    } else {
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(HULL.DECK.w, HULL.DECK.h, HULL.DECK.d),
        hullMat,
      );
      deck.position.y = HULL.DECK.y;
      deck.castShadow = true;
      this.group.add(deck);
    }

    // Cargo: size from mass, silhouette from type. Both are information the pilot
    // needs — heavy handles differently, and the shape says which run this is. The
    // relay carries nothing to size or silhouette — it is its own cargo — so it gets
    // its own upper body instead: see `buildRelayTower`, whose own comment is why its
    // group gets no offset here — its geometry already carries its own absolute anchor,
    // which for the relay is not `DECK_TOP` the way every other airframe's cargo is.
    const cargo = airframe.id === 'relay' ? this.buildRelayTower(relayFolded) : this.buildCargo(payload);
    cargo.group.position.y = airframe.id === 'relay' ? 0 : DECK_TOP;
    this.group.add(cargo.group);

    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x8fd4ff,
      transparent: true,
      opacity: 0.9,
    });

    /**
     * Engine pods, straight off the airframe. This is where the plume problem is
     * actually solved: with the load on the deck there is nothing above a nozzle for
     * the exhaust to pass through, whether that is one nozzle or two.
     *
     * A canted pod is rotated bodily, plume and all, so what the player sees splaying
     * outward is the same geometry the physics integrates — the hauler steers *because*
     * its nozzles point where they visibly point.
     *
     * Radius scales with the count so the vehicle keeps roughly the same amount of
     * visible exhaust either way: split into two, a plume at a literal half-width reads
     * as a spike rather than as thrust.
     */
    const radius = 0.28 / Math.sqrt(airframe.engines.length);
    for (const engine of airframe.engines) {
      /**
       * The pod and its plume live in one group that carries the cant, so the nozzle
       * and the exhaust can never disagree about which way this engine points.
       *
       * `rotation.z = cant`, not its negative: rotating the pod's down-axis by a
       * positive angle swings it toward +x, which is what "splayed to starboard" means.
       * The thrust that comes back out is `(−sin cant, cos cant)` — up and to *port* —
       * and that inversion is exactly why the default mapping lights the far engine.
       */
      const mount = new THREE.Group();
      mount.position.set(engine.x, mountHeight(engine.cant, radius * 0.95), 0);
      mount.rotation.z = engine.cant;
      this.group.add(mount);

      const pod = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.75, radius * 0.95, HULL.POD_H, 6),
        frameMat,
      );
      mount.add(pod);

      // Everything below is placed against the pod's own nozzle end rather than a
      // world-space height, so a canted engine keeps its plume and its glow attached to
      // itself. Only the mount knows where the vehicle's belly is.
      const nozzle = -HULL.POD_H / 2;

      // Length is cant-dependent — see `flameLength` — because the same 1.45 that reads
      // as a plume hanging below the hull becomes a spike wider than the hull itself
      // once the mount rotates it towards horizontal. Stashed on the mesh because the
      // per-frame flicker in `update` needs the same figure and has no other way back
      // to this engine's `cant`.
      const len = flameLength(engine.cant);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(radius, len, 6), flameMat);
      flame.position.y = nozzle - len / 2;
      flame.rotation.z = Math.PI;
      flame.visible = false;
      flame.userData.flameLen = len;
      mount.add(flame);
      this.flames.push(flame);

      const throat = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.72, radius * 0.82, 0.09, 8),
        this.lamp(0x7fc4ff, 2.2),
      );
      throat.position.y = nozzle + 0.03;
      mount.add(throat);
    }

    /**
     * Four hinged legs. Each is a pivot rather than a fixed strut, so the whole
     * stow/deploy cycle is one angle.
     *
     * Rotating a leg about Z by θ moves its foot to (L·sinθ, −L·cosθ), so a positive
     * angle throws the foot toward +X. The starboard leg therefore wants +θ and the
     * port leg −θ to splay outward — the opposite sign puts the feet under the hull,
     * which is a tightrope, not landing gear.
     *
     * Hinged at the chassis corners, outboard of the pods, so the stance brackets the
     * plumes instead of standing in them.
     */
    for (const sx of [-1, 1]) {
      for (const sz of [-LEG.HINGE_X, LEG.HINGE_X]) {
        const hinge = new THREE.Group();
        hinge.position.set(sx * LEG.HINGE_X, LEG.HINGE_Y, sz);

        const strut = new THREE.Mesh(
          new THREE.BoxGeometry(0.13, LEG.LENGTH, 0.13),
          new THREE.MeshStandardMaterial({ color: 0x6f7a83, roughness: 0.6, metalness: 0.15 }),
        );
        strut.position.y = -LEG.LENGTH / 2;
        hinge.add(strut);

        const foot = new THREE.Mesh(
          new THREE.BoxGeometry(LEG.FOOT_W, LEG.FOOT_H, LEG.FOOT_W),
          new THREE.MeshStandardMaterial({ color: 0x8b959d, roughness: 0.6, metalness: 0.15 }),
        );
        foot.position.y = -LEG.LENGTH;
        hinge.add(foot);

        hinge.userData.side = sx;
        this.group.add(hinge);
        this.legs.push(hinge);
        this.feet.push(foot);
      }
    }

    // Attitude jets at the deck corners — the longest arm on the vehicle, which is
    // where you would actually put them and where they read as steering rather than
    // as more engine.
    const rcsMat = new THREE.MeshBasicMaterial({
      color: 0xbfe6ff,
      transparent: true,
      opacity: 0.85,
    });
    this.rcsLeft = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 5), rcsMat);
    this.rcsLeft.position.set(-0.72, DECK_TOP - 0.08, 0);
    this.rcsLeft.rotation.z = Math.PI / 2;
    this.rcsLeft.visible = false;
    this.group.add(this.rcsLeft);

    this.rcsRight = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 5), rcsMat);
    this.rcsRight.position.set(0.72, DECK_TOP - 0.08, 0);
    this.rcsRight.rotation.z = -Math.PI / 2;
    this.rcsRight.visible = false;
    this.group.add(this.rcsRight);

    this.thrustLight = new THREE.PointLight(0x9fd8ff, 0, 90, 1.7);
    this.thrustLight.position.y = -1.1;
    this.group.add(this.thrustLight);

    /**
     * The lander is lit rather than lighting. Emissive geometry needs no light source,
     * so it cannot wash out the hull it is attached to — which is what a point light
     * bright enough to reach the canyon floor unavoidably did, since three.js tests
     * light layers against the camera and offers no per-object exclusion.
     */
    this.buildRunningLights(cargo.group, cargo.height, airframe.id !== 'relay');

    scene.add(this.group);
  }

  /**
   * Running lights. Port red, starboard green, a hazard beacon on the load and — on
   * every airframe that has one — a warm strip under the deck: enough self-illumination
   * to read the vehicle's attitude against a dark canyon at a glance, with no light in
   * the scene at all.
   */
  private buildRunningLights(cargo: THREE.Group, cargoHeight: number, hasDeck: boolean): void {
    const lamp = (color: number, intensity: number) => this.lamp(color, intensity);

    /**
     * Underdeck strip: the largest emissive area, and a horizontal one. A lit line
     * carries tilt at a distance in a way the old waist ring never could — a circle
     * looks the same at every angle.
     *
     * Dimmer than that ring at 2.4 rather than 3.4, because this is several times its
     * area. At the old figure it was bright enough to swamp anything mounted near it.
     *
     * Gated on `hasDeck` — the relay does not have one to sit under (see the deck's own
     * comment in the constructor), and a flat lit panel the same footprint as the deck
     * it no longer carries is the deck showing up again in a different colour.
     */
    if (hasDeck) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.19, 0.07, 0.74), lamp(0xffd9a8, 2.4));
      strip.position.y = -0.1;
      this.group.add(strip);
    }

    // Port / starboard, aviation convention — which way you are leaning, at a glance.
    // At the deck tips rather than on the chassis flank: they are small and the strip
    // is not, so they need the vehicle's widest, highest corners to be seen at all,
    // where they sit against sky instead of beside a lamp forty times their area. The
    // relay's own deck tip is `RELAY_DECK_HALF` at `LEG.HINGE_Y` — the same small
    // protrusion past the edge, at the pad it is actually sitting on, rather than the
    // ordinary deck's own tip and height landing well outside and above a pad a third
    // the width, standing at the legs rather than under the tower.
    //
    // Driven at 2.8, not the 5 they had on the cone. These are the only two objects on
    // the vehicle whose *hue* is the information, and ACES pushes a saturated colour to
    // white as it brightens — on a dark narrow hull that went unnoticed, but against the
    // deck plate a red and a green lamp both came out white, which is worse than no lamp.
    const navTip = hasDeck ? 0.67 : RELAY_DECK_HALF + 0.02;
    const navY = hasDeck ? DECK_TOP - 0.02 : LEG.HINGE_Y + HULL.DECK.h / 2;
    for (const [sx, color] of [[-1, 0xff3b30], [1, 0x34ff6a]] as const) {
      const nav = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), lamp(color, 2.8));
      nav.position.set(sx * navTip, navY, 0);
      this.group.add(nav);
      this.navLights.push(nav);
    }

    /**
     * Hazard beacon, riding the load rather than the hull. Parenting it to the cargo
     * means it clears whatever silhouette the manifest asks for without a second number
     * that has to be kept in step with the first — and an oversize load carrying its own
     * light is what the vehicle would actually do.
     */
    this.strobe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), lamp(0xffffff, 6));
    this.strobe.position.y = cargoHeight + 0.1;
    cargo.add(this.strobe);

    // Throats are built with their pods, so a canted engine takes its own glow with it.
  }

  /** Emissive material. The vehicle is lit rather than lighting — see above. */
  private lamp(color: number, intensity: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });
  }

  /**
   * The relay's own upper body — two open, square-sectioned frames continuing the mast,
   * each narrower than the one below, matching the sketch's own distinction between the
   * round ribbed drum `buildRelayMast` builds and the boxes stacked above it.
   *
   * Reports the same `{group, height}` shape `buildCargo` does, and for the same reason
   * the constructor picks between the two with one ternary rather than a second code
   * path further down: `buildRunningLights` only needs a group to parent the strobe to
   * and a height to clear it by, and it does not care whether what is inside that group
   * is a manifest or the vehicle's own structure.
   *
   * Built at **absolute** height, unlike `buildCargo`'s shapes — those sit at a local
   * origin the constructor then offsets by `DECK_TOP`, which is fine when every shape
   * shares that one anchor. Folded, this tower shares its anchor with the base instead
   * (`RELAY_FOLD_HEIGHT`, off the pad) — a *different* one than unfolded uses (`DECK_TOP`)
   * — so the anchor has to live in the geometry itself, not in a caller that only knows
   * one. The constructor sets this group's own position to zero for the relay rather
   * than offsetting it, and `height` reports the structure's absolute top for the same
   * reason.
   */
  private buildRelayTower(folded: boolean): { group: THREE.Group; height: number } {
    const group = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x55636d,
      roughness: 0.65,
      metalness: 0.15,
      flatShading: true,
    });
    const padTop = LEG.HINGE_Y + HULL.DECK.h;
    // Folded: the same band the base nests in, see `RELAY_FOLD_HEIGHT`'s own comment.
    // Unfolded: wherever the base's own stack actually ends, read back via `stackedTop`
    // rather than recomputed here, so the tower picks up exactly where the base leaves
    // off rather than at a fixed height unrelated to it.
    const baseTop = stackedTop(padTop, RELAY_FOLD_HEIGHT, RELAY_BASE_RADII.length, folded);
    const startY = folded ? padTop : baseTop;
    // The tower's own tiers continue the base's taper rather than restarting it — see
    // `stackedCage`'s `tierOffset` param — so the narrowing, and nested the height growth
    // that gives the conic silhouette, reads as one continuous run through all four tiers.
    const tierOffset = RELAY_BASE_RADII.length;
    const parts = stackedCage(startY, RELAY_FOLD_HEIGHT, RELAY_TOWER_RADII, RELAY_TOWER_SIDES, 0.016, folded, tierOffset);
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, frameMat);
      mesh.castShadow = true;
      group.add(mesh);
    }
    // Top of the whole structure: the tower's own top, in either state — the strobe
    // (`buildRunningLights`) parents here and offsets upward from it, so this has to be
    // the true top regardless of how `folded` shaped the stack beneath it.
    const topY = stackedTop(startY, RELAY_FOLD_HEIGHT, RELAY_TOWER_RADII.length, folded, tierOffset);
    return { group, height: topY };
  }

  /**
   * The load, standing on the deck rather than slung under the hull. Scale carries mass,
   * form carries what it is, and each branch reports the box it built so the stakes can
   * be sized to it and the beacon set on top of it.
   *
   * Every shape is built sitting on y=0 rather than centred on it, which is the whole
   * point: the caller stands the group on the deck and the load is above the origin at
   * any mass. Centred geometry is what let the heaviest manifest hang below the feet.
   */
  private buildCargo(payload: Payload): { group: THREE.Group; height: number } {
    const s = 0.34 + payload.mass * 0.3;
    const shape = cargoShape(payload);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd98a2b,
      roughness: 0.75,
      metalness: 0.12,
      flatShading: true,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x707b84,
      roughness: 0.6,
      metalness: 0.15,
    });

    let height: number;
    let halfWidth: number;

    if (shape === 'drum') {
      const r = s * 0.5;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, s * 1.2, 8), mat);
      drum.rotation.z = Math.PI / 2; // laid on its side, lengthwise along the deck
      drum.position.y = r;
      group.add(drum);
      height = r * 2;
      halfWidth = s * 0.6;
    } else if (shape === 'sphere') {
      const r = s * 0.6;
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
      ball.position.y = r;
      group.add(ball);
      height = r * 2;
      halfWidth = r;
    } else if (shape === 'rig') {
      // A frame with visible structure, so the heaviest loads look like machinery.
      const bed = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 0.5, s * 0.8), mat);
      bed.position.y = s * 0.25;
      group.add(bed);
      for (const sx of [-1, 1]) {
        const strut = new THREE.Mesh(
          new THREE.BoxGeometry(s * 0.18, s * 0.5, s * 0.18),
          frameMat,
        );
        strut.position.set(sx * s * 0.6, s * 0.75, 0);
        group.add(strut);
      }
      height = s;
      halfWidth = s * 0.75;
    } else {
      const h = s * 0.7;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, h, s * 0.9), mat);
      crate.position.y = h / 2;
      group.add(crate);
      height = h;
      halfWidth = s * 0.5;
    }

    // Stakes fore and aft. Two uprights are what turn a box resting on a plate into a
    // load that is held down, and they scale with the cargo, so how much you are
    // carrying is legible before the manifest is read.
    for (const sx of [-1, 1]) {
      const stake = new THREE.Mesh(new THREE.BoxGeometry(0.07, height * 0.8, 0.34), frameMat);
      stake.position.set(sx * (halfWidth + 0.06), height * 0.4, 0);
      group.add(stake);
    }

    return { group, height };
  }

  /** Kills the lander's lights — used when the hull is destroyed. */
  extinguish(): void {
    this.thrustLight.visible = false;
    for (const nav of this.navLights) nav.visible = false;
    this.strobe.visible = false;
  }

  /**
   * `rotation + bank` covers both airframes without a branch: an attitude frame never
   * banks and a differential frame never rotates, so one of the two is always zero.
   */
  syncTransform(body: LanderBody): void {
    this.group.position.set(body.x, body.y, 0);
    this.group.rotation.z = body.rotation + body.bank;
  }

  /** Counter-rotates each foot so it stays flat rather than touching down on a corner. */
  syncGear(deployed: number): void {
    const angle = lerp(LEG.STOWED, LEG_DEPLOYED, deployed);
    for (let i = 0; i < this.legs.length; i++) {
      const hinge = this.legs[i];
      hinge.rotation.z = hinge.userData.side * angle;
      this.feet[i].rotation.z = -hinge.userData.side * angle;
    }
  }

  update(body: LanderBody, firing: Firing): void {
    this.syncTransform(body);

    // Two detuned sines give an irregular flicker without a random walk that could
    // strobe. Thrust briefly floods the lamp as the exhaust lights the rock.
    // Strobe: a short bright pulse roughly once a second, the rest of the time dim.
    const phase = body.age % 1.15;
    const strobeMat = this.strobe.material as THREE.MeshStandardMaterial;
    strobeMat.emissiveIntensity = phase < 0.09 ? 14 : 1.2;

    // One flame per engine, lit individually — on the hauler which plume is burning is
    // the primary feedback for what the vehicle is about to do. Each flickers on its
    // own draw; in lockstep a pair reads as one light source drawn twice rather than as
    // two engines. Scaling a cone stretches it about its own centre, so the centre
    // moves with the flicker to keep the base pinned at the nozzle.
    let anyLit = false;
    for (let i = 0; i < this.flames.length; i++) {
      const lit = firing.engines[i] ?? false;
      const flame = this.flames[i];
      flame.visible = lit;
      if (!lit) continue;
      anyLit = true;
      const len = (flame.userData.flameLen as number) ?? HULL.FLAME_LEN;
      const flicker = 0.82 + Math.random() * 0.36;
      flame.scale.set(1, flicker, 1);
      flame.position.y = -HULL.POD_H / 2 - (len / 2) * flicker;
    }
    this.thrustLight.intensity = anyLit ? 150 : 0;

    this.rcsLeft.visible = firing.rcsRight;
    this.rcsRight.visible = firing.rcsLeft;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
  }
}


/**
 * A flight model and the geometry that shows it, presented as one object.
 *
 * The accessors below are deliberately plain delegation. They exist so the split is
 * invisible to callers — `Game` still reads `lander.y` and assigns `lander.vx` — while
 * everything underneath is testable on its own.
 */
export class Lander {
  readonly body: LanderBody;
  private view: LanderView;
  private idle: Firing;

  constructor(
    scene: THREE.Scene,
    payload: Payload,
    fuel: number,
    airframe: Airframe = AIRFRAMES.lander,
    relayFolded = true,
  ) {
    this.body = new LanderBody(payload, Math.round(fuel * airframe.fuelScale), airframe);
    this.view = new LanderView(scene, payload, airframe, relayFolded);
    this.idle = idleFiring(airframe);
    this.view.update(this.body, this.idle);
  }

  get airframe(): Airframe {
    return this.body.airframe;
  }

  get invertThrusters(): boolean {
    return this.body.invertThrusters;
  }
  set invertThrusters(v: boolean) {
    this.body.invertThrusters = v;
  }

  get group(): THREE.Group {
    return this.view.group;
  }

  /**
   * What the vehicle actually looks like, in model space — for anything that has to
   * frame it on screen.
   *
   * Measured by walking the group and transforming each mesh's own bounding box, which
   * is the method CLAUDE.md prescribes for exactly this class of question, rather than
   * authored from the hull constants. Authoring it would be wrong immediately: the
   * silhouette is dominated by the cargo, and the cargo is per-mission. Measured across
   * the campaign it runs from 0.900 above the origin on mission 1 to 1.368 on mission 30,
   * against a collider of 0.62 — so a frame drawn from `LANDER.RADIUS` alone sits inside
   * the load it is supposed to be framing, and one drawn from the tallest case hangs off
   * the light ones.
   *
   * The origin is not the centre of the vehicle either. The load stands on the deck and
   * the gear hangs below it, putting the visual centre about 0.38 *above* the point the
   * physics tracks.
   *
   * Cached: the geometry only changes when a new vehicle is built, and a new vehicle
   * means a new `Lander`. Invisible meshes are skipped, which is what keeps the exhaust
   * plumes out of it — a box that grew by `FLAME_LEN` every time an engine lit would
   * make the frame pulse with the throttle.
   */
  get visualBounds(): { halfWidth: number; halfHeight: number; centreY: number } {
    if (!this.bounds) this.bounds = this.measureBounds();
    return this.bounds;
  }

  private bounds: { halfWidth: number; halfHeight: number; centreY: number } | null = null;

  private measureBounds(): { halfWidth: number; halfHeight: number; centreY: number } {
    const group = this.view.group;
    group.updateMatrixWorld(true);
    const toLocal = group.matrixWorld.clone().invert();

    const box = new THREE.Box3();
    const part = new THREE.Box3();
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      for (let p: THREE.Object3D | null = o; p && p !== group.parent; p = p.parent) {
        if (!p.visible) return;
      }
      mesh.geometry.computeBoundingBox();
      const local = mesh.geometry.boundingBox;
      if (!local) return;
      part.copy(local).applyMatrix4(mesh.matrixWorld).applyMatrix4(toLocal);
      box.union(part);
    });

    if (box.isEmpty()) {
      return { halfWidth: LANDER.RADIUS, halfHeight: LANDER.RADIUS, centreY: 0 };
    }
    return {
      halfWidth: Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
      halfHeight: (box.max.y - box.min.y) / 2,
      centreY: (box.max.y + box.min.y) / 2,
    };
  }

  // ------------------------------------------------------------------- state

  get x(): number {
    return this.body.x;
  }
  set x(v: number) {
    this.body.x = v;
  }

  get y(): number {
    return this.body.y;
  }
  set y(v: number) {
    this.body.y = v;
  }

  get vx(): number {
    return this.body.vx;
  }
  set vx(v: number) {
    this.body.vx = v;
  }

  get vy(): number {
    return this.body.vy;
  }
  set vy(v: number) {
    this.body.vy = v;
  }

  get rotation(): number {
    return this.body.rotation;
  }
  set rotation(v: number) {
    this.body.rotation = v;
  }

  get angularVelocity(): number {
    return this.body.angularVelocity;
  }
  set angularVelocity(v: number) {
    this.body.angularVelocity = v;
  }

  get allowGround(): boolean {
    return this.body.allowGround;
  }
  set allowGround(v: boolean) {
    this.body.allowGround = v;
  }

  get fuel(): number {
    return this.body.fuel;
  }
  get fuelCapacity(): number {
    return this.body.fuelCapacity;
  }
  get mass(): number {
    return this.body.mass;
  }
  get payload(): Payload {
    return this.body.payload;
  }
  get frozen(): boolean {
    return this.body.frozen;
  }
  get speed(): number {
    return this.body.speed;
  }
  get tilt(): number {
    return this.body.tilt;
  }
  get thrustAccel(): number {
    return this.body.thrustAccel;
  }
  get gearDeployed(): number {
    return this.body.gearDeployed;
  }
  /** Whether any engine is lit. What the exhaust effects key off. */
  get thrusting(): boolean {
    return this.body.thrusting;
  }

  get firing() {
    return this.body.firing;
  }

  /** Cosmetic lean on a locked-rotation frame. Nothing in the simulation reads it. */
  get bank(): number {
    return this.body.bank;
  }

  /**
   * Draws the vehicle part-way between the last two physics steps.
   *
   * `alpha` is the leftover accumulator as a fraction of a fixed step. See
   * `LanderBody.prevX` for why this exists at all — in short, the simulation moves in
   * 1/120 jumps, the display does not, and drawing only completed steps makes the hull
   * stutter in proportion to how fast it is going.
   *
   * Everything downstream that wants a position on screen has to read `renderX`/`renderY`
   * rather than `x`/`y`, the camera above all: a camera chasing the stepped position
   * while the hull is drawn at the interpolated one would put the jitter back, just into
   * the background instead of the vehicle.
   */
  present(alpha: number): void {
    /**
     * A frozen vehicle is drawn exactly where it is.
     *
     * `step` returns before snapshotting once frozen, so "where it was" stops advancing
     * and stays a whole step behind for good. Left interpolating, a settled lander would
     * shiver on the pad as the alpha wandered between frames — and `settle` zeroes the
     * rotation, so it would shiver between its touchdown attitude and level. Covers the
     * crash case too, which freezes the same way.
     */
    const a = this.body.frozen ? 1 : Math.max(0, Math.min(1, alpha));
    this.renderX = lerp(this.body.prevX, this.body.x, a);
    this.renderY = lerp(this.body.prevY, this.body.y, a);
    // Raw lerp is safe on both: `rotation` accumulates rather than wrapping, and `bank`
    // is a damped value inside ±0.21. Neither can take the short way round a circle.
    this.group.position.set(this.renderX, this.renderY, 0);
    this.group.rotation.z =
      lerp(this.body.prevRotation, this.body.rotation, a) +
      lerp(this.body.prevBank, this.body.bank, a);
  }

  /** Where the hull is actually drawn this frame. */
  renderX = 0;
  renderY = 0;

  /**
   * Collapses the interpolation onto the current pose.
   *
   * Anything that moves the vehicle without stepping it — a mission load, the debug
   * `place`, a settle onto a pad — has to call this, or the next frame interpolates from
   * where it used to be and smears the hull across the jump.
   */
  pin(): void {
    this.body.pin();
    this.renderX = this.body.x;
    this.renderY = this.body.y;
    this.view.syncTransform(this.body);
  }

  // -------------------------------------------------------------------- loop

  step(dt: number, input: InputState, world: PhysicsWorld): Contact {
    if (this.body.frozen) return { type: 'none' };

    const contact = this.body.step(dt, input, world);

    // A crash leaves the visuals exactly as they were on the last live frame — the
    // caller hides the hull and extinguishes it within the same tick. A landing settles
    // the body, and that does want a refresh, which is what the frozen check catches.
    if (contact.type === 'none' || this.body.frozen) {
      this.view.update(this.body, this.body.firing);
    } else {
      this.view.syncTransform(this.body);
    }

    return contact;
  }

  updateGear(dt: number, heightAboveGround: number): void {
    this.body.updateGear(dt, heightAboveGround);
    this.view.syncGear(this.body.gearDeployed);
  }

  freeze(): void {
    this.body.freeze();
    this.view.update(this.body, this.idle);
  }

  extinguish(): void {
    this.view.extinguish();
  }

  dispose(): void {
    this.view.dispose();
  }
}
