import * as THREE from 'three';
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
  /** Deck plate. Its top face is what cargo stands on. */
  DECK: { w: 1.25, h: 0.07, d: 0.8, y: 0.075 },
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

  constructor(scene: THREE.Scene, payload: Payload, airframe: Airframe) {
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

    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(HULL.CHASSIS.w, HULL.CHASSIS.h, HULL.CHASSIS.d),
      frameMat,
    );
    chassis.position.y = HULL.CHASSIS.y;
    chassis.castShadow = true;
    this.group.add(chassis);

    // Deck in the lighter grey against the dark chassis, so the flatbed line separates
    // by value rather than hue — it still has to read at a third of display resolution,
    // and that line is the primary attitude cue now the nose cone is gone.
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(HULL.DECK.w, HULL.DECK.h, HULL.DECK.d),
      hullMat,
    );
    deck.position.y = HULL.DECK.y;
    deck.castShadow = true;
    this.group.add(deck);

    // Cargo: size from mass, silhouette from type. Both are information the pilot
    // needs — heavy handles differently, and the shape says which run this is.
    const cargo = this.buildCargo(payload);
    cargo.group.position.y = DECK_TOP;
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

      const flame = new THREE.Mesh(new THREE.ConeGeometry(radius, HULL.FLAME_LEN, 6), flameMat);
      flame.position.y = nozzle - HULL.FLAME_LEN / 2;
      flame.rotation.z = Math.PI;
      flame.visible = false;
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
      for (const sz of [-0.3, 0.3]) {
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
    this.buildRunningLights(cargo.group, cargo.height);

    scene.add(this.group);
  }

  /**
   * Running lights. Port red, starboard green, a hazard beacon on the load and a warm
   * strip under the deck — enough self-illumination to read the vehicle's attitude
   * against a dark canyon at a glance, with no light in the scene at all.
   */
  private buildRunningLights(cargo: THREE.Group, cargoHeight: number): void {
    const lamp = (color: number, intensity: number) => this.lamp(color, intensity);

    /**
     * Underdeck strip: the largest emissive area, and a horizontal one. A lit line
     * carries tilt at a distance in a way the old waist ring never could — a circle
     * looks the same at every angle.
     *
     * Dimmer than that ring at 2.4 rather than 3.4, because this is several times its
     * area. At the old figure it was bright enough to swamp anything mounted near it.
     */
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.19, 0.07, 0.74), lamp(0xffd9a8, 2.4));
    strip.position.y = -0.1;
    this.group.add(strip);

    // Port / starboard, aviation convention — which way you are leaning, at a glance.
    // At the deck tips rather than on the chassis flank: they are small and the strip
    // is not, so they need the vehicle's widest, highest corners to be seen at all,
    // where they sit against sky instead of beside a lamp forty times their area.
    //
    // Driven at 2.8, not the 5 they had on the cone. These are the only two objects on
    // the vehicle whose *hue* is the information, and ACES pushes a saturated colour to
    // white as it brightens — on a dark narrow hull that went unnoticed, but against the
    // deck plate a red and a green lamp both came out white, which is worse than no lamp.
    for (const [sx, color] of [[-1, 0xff3b30], [1, 0x34ff6a]] as const) {
      const nav = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), lamp(color, 2.8));
      nav.position.set(sx * 0.67, DECK_TOP - 0.02, 0);
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
      const flicker = 0.82 + Math.random() * 0.36;
      flame.scale.set(1, flicker, 1);
      flame.position.y = -HULL.POD_H / 2 - (HULL.FLAME_LEN / 2) * flicker;
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
  ) {
    this.body = new LanderBody(payload, Math.round(fuel * airframe.fuelScale), airframe);
    this.view = new LanderView(scene, payload, airframe);
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
