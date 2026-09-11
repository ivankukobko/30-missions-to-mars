import * as THREE from 'three';
import { LANDER } from './LanderBody.ts';
import { damp } from '../world/Noise.ts';

/**
 * A lamp under the vehicle: a shaft of light and the pool it throws on the surface, white
 * until the approach stops being survivable and red after it.
 *
 * **It replaces the augmented layer's drift arrow.** The arrow carried two things at once —
 * which way you were sliding, and whether you were doing it too fast — and the first of
 * those is now told better by the exhaust trails, which are the actual motion rather than a
 * projection of it. What was left was a warning drawn as a compass, standing off the hull at
 * a fixed radius, colliding with the vehicle on the commonest heading of all.
 *
 * A lamp says the same thing without the geometry. It is *on* the vehicle rather than
 * beside it, so nothing has to be kept clear of the hull; it lands on the surface the
 * player is aiming at, so the warning appears exactly where they are already looking; and
 * it needs no projection maths, so it cannot end up mirrored behind the lens the way a
 * screen-space overlay can.
 *
 * **Every frame carries one, including the relay**, and that is deliberate: the arrow it
 * replaces reddened even with the radar still in the hold, because knowing you are coming
 * in too hot is not a ranging readout — it is the thing the vehicle's own gear screams
 * about — and mission one would be unfair without it. This is a lamp, not an instrument,
 * so unlike `Airframe.overlay` it is not a capability any vehicle can lack.
 */

/**
 * Cone half-angle, as a ratio of base radius to length. About 6°.
 *
 * It was 0.28 — near 16°, a plausible number for a real lamp and completely wrong here.
 * The vehicle is 1.2 units across and the light throws tens of units, so a 16° cone put a
 * 7.3-unit pool under a 1.2-unit lander: a wash across the approach rather than a spot on
 * the thing being aimed at. The beam has to be tight relative to the *vehicle*, not to the
 * distance it travels.
 */

const SPREAD = 0.1;

/** Shaft brightness, and the pool's. Additive, so these read as light added to a surface. */
const SHAFT = 0.05;
const POOL = 0.34;

/**
 * How far below the landing tolerance the colour starts moving.
 *
 * The threshold itself is `MAX_LANDING_SPEED`, the same figure the arrow turned at and the
 * same one the scoring uses, so the lamp goes red at the moment the approach stops being
 * survivable rather than at a number chosen to look tense. It starts *reddening* a fifth
 * earlier so the change is a warning rather than an alarm going off after the fact.
 */
const WARN_FROM = 0.8;

const WHITE = new THREE.Color(0xdfe8ff);
const RED = new THREE.Color(0xff3b2f);

/**
 * How fast the lamp comes up and goes out when the surface under it appears or vanishes,
 * per second: a 70 ms time constant, so it is three-quarters gone in a tenth of a second
 * and put away by about a third.
 *
 * The height fade already makes the lamp continuous across the edge of `reach`. What it
 * could not smooth is the ground itself changing: crossing a deck edge or a shaft mouth
 * swaps a surface four units below for none at all, and the pool vanished between one
 * frame and the next — a lamp switched, which is the one thing a lamp does not look like.
 * Fast enough that the pool lingering on the edge it has just left reads as afterglow,
 * not as the light reporting ground that is not there.
 */
const PRESENCE_RATE = 14;
/** Below this the lamp is put away rather than drawn at an invisible opacity. */
const PRESENCE_FLOOR = 0.01;

export class LandingLight {
  private shaft: THREE.Mesh;
  private pool: THREE.Mesh;
  private shaftMat: THREE.MeshBasicMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private textures: THREE.Texture[] = [];
  private tint = new THREE.Color();

  private reach: number;

  /** 0..1, how present the lamp is — see `PRESENCE_RATE`. */
  private presence = 0;
  /** The height fade of the last lit frame, held while the lamp dies back from it. */
  private lastFade = 0;

  /**
   * @param reach Drop within which the lamp is on at all. `GEAR_DEPLOY_HEIGHT`, so the
   *   light, the contact shadow and the legs all arrive together — it is a *landing*
   *   light, and one hanging a thirty-unit shaft under a vehicle at entry altitude was
   *   lit for most of a descent it has nothing to say about.
   */
  constructor(scene: THREE.Scene, reach: number) {
    this.reach = reach;
    const fade = LandingLight.shaftTexture();
    const disc = LandingLight.poolTexture();
    this.textures.push(fade, disc);

    this.shaftMat = new THREE.MeshBasicMaterial({
      color: WHITE.clone(),
      alphaMap: fade,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    // Unit cone, apex up: one unit tall with a unit-radius base, so `update` can scale it
    // to any throw without rebuilding geometry. Open-ended — a cap would draw a bright
    // disc floating in the air at the cut-off.
    this.shaft = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true), this.shaftMat);
    this.shaft.renderOrder = 2;
    this.shaft.visible = false;
    scene.add(this.shaft);

    this.poolMat = new THREE.MeshBasicMaterial({
      color: WHITE.clone(),
      alphaMap: disc,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.renderOrder = 2;
    this.pool.visible = false;
    scene.add(this.pool);
  }

  /**
   * @param dt     Frame time. Presentation only — nothing reads the lamp back.
   * @param ground Surface height below, or `null` where there is nothing under the vehicle.
   * @param above  Drop to that surface.
   * @param speed  Total speed, against `MAX_LANDING_SPEED`.
   */
  update(
    dt: number,
    x: number,
    y: number,
    ground: number | null,
    above: number,
    speed: number,
  ): void {
    // Colour first: it is the whole point of the lamp and it does not depend on there
    // being a surface to land on. Red while falling into a shaft is still the warning.
    const warn = LANDER.MAX_LANDING_SPEED * WARN_FROM;
    const heat = Math.min(1, Math.max(0, (speed - warn) / (LANDER.MAX_LANDING_SPEED - warn)));
    this.tint.copy(WHITE).lerp(RED, heat);
    this.shaftMat.color.copy(this.tint);
    this.poolMat.color.copy(this.tint);

    /**
     * Off entirely unless there is a surface inside `reach`.
     *
     * The first version drew the shaft whether or not anything was under it, on the
     * reasoning that a lamp shining into a hole is still a lamp. True, and beside the
     * point: this one exists to say *how close the ground is*, so with no ground inside
     * its throw it has nothing to say and lighting it only trains the player to ignore it.
     */
    const lit = ground !== null && above >= 0 && above < this.reach;
    this.presence = damp(this.presence, lit ? 1 : 0, PRESENCE_RATE, dt);

    if (!lit || ground === null) {
      // Dying back where it last shone: the meshes still hold that frame's pose, so only
      // the brightness moves.
      if (this.presence < PRESENCE_FLOOR) {
        this.hide();
        return;
      }
      this.shine(this.lastFade);
      return;
    }

    // 0 at touchdown, 1 at the edge of reach. Both parts fade on it, so the lamp comes up
    // as the surface arrives rather than switching on at a boundary.
    const t = above / this.reach;
    this.lastFade = 1 - t;

    const radius = Math.max(LANDER.RADIUS * 0.5, above * SPREAD);
    this.shaft.scale.set(radius, Math.max(above, 0.1), radius);
    // Cone origin is its middle, so the apex sits half a length above the centre.
    this.shaft.position.set(x, y - LANDER.RADIUS - above / 2, 0);

    const spot = Math.max(LANDER.RADIUS, above * SPREAD) * 2;
    this.pool.scale.set(spot, spot, 1);
    // Above the contact shadow's own lift, so the two never fight for the same depth.
    this.pool.position.set(x, ground + 0.09, 0);

    this.shine(this.lastFade);
  }

  private shine(fade: number): void {
    this.shaft.visible = true;
    this.pool.visible = true;
    this.shaftMat.opacity = SHAFT * fade * this.presence;
    this.poolMat.opacity = POOL * fade * this.presence;
  }

  /**
   * Out at once, with no die-back. For the vehicle no longer flying — a crash, the end of
   * a run — where there is no lamp left to cool.
   */
  hide(): void {
    this.shaft.visible = false;
    this.pool.visible = false;
    this.presence = 0;
  }

  dispose(): void {
    for (const mesh of [this.shaft, this.pool]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.shaftMat.dispose();
    this.poolMat.dispose();
    for (const t of this.textures) t.dispose();
  }

  /** Alpha down the shaft: present at the lamp, gone by the far end. */
  private static shaftTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context for the landing light.');
    // Cone UVs run v=0 at the base and v=1 at the apex, and canvas y runs down, so the
    // opaque end is drawn at the top of the strip to land at the apex.
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  }

  /** Alpha across the pool: a soft-edged disc with a brighter core. */
  private static poolTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context for the landing light.');
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#8c8c8c');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  }
}
