import * as THREE from 'three';
import { CANYON } from '../world/CanyonSpec.ts';
import { clamp01, damp, lerp } from '../world/Noise.ts';

/**
 * What the camera is doing right now. Three genuinely different jobs, not three
 * points on one curve — each has its own framing, its own lead and its own
 * responsiveness, and interpolating between two extremes cannot satisfy all of them.
 */
export type Phase = 'sky' | 'flight' | 'landing' | 'shaft';

interface Framing {
  /** Behind the lander, along +Z. */
  distance: number;
  /** Above it. */
  offsetY: number;
  /** Radians below horizontal. */
  pitch: number;
  fov: number;
  /** How far the camera runs ahead of horizontal motion. */
  leadX: number;
  /** How far it leads vertical motion. */
  leadY: number;
  /** Fraction of lateral offset the camera follows; yaw covers the rest. */
  follow: number;
  /** How fast position converges. */
  posRate: number;
  /** How fast angles converge. */
  rotRate: number;
}

/** Above this height over the ground, landing gives way to flight. */
const LANDING_CEILING = 85;
/** Altitude at which the sky phase begins, provided the ground is far below. */
const SKY_FLOOR = 620;
/** Below this far under the canyon floor, the lander is down a hole. */
const SHAFT_MOUTH = 20;
/** Ceiling on how far the ground clamp may lift the camera over the lander. */
const MAX_LIFT_ABOVE_TARGET = 26;
const FULL_SPEED = 45;

export class CameraDirector {
  camera: THREE.PerspectiveCamera;
  /** Sampled to keep the camera from burying itself in the canyon wall. */
  groundAt: ((x: number, z: number) => number) | null = null;

  phase: Phase = 'sky';
  private now: Framing;
  private yaw = 0;
  private shakeAmount = 0;
  private smoothedSpeed = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(48, aspect, 0.5, 6000);
    // Yaw about world Y, then pitch about the camera's own X. With the default XYZ
    // order the two interact and the horizon tilts as the camera turns.
    this.camera.rotation.order = 'YXZ';
    this.now = this.framingFor('sky', 1);
    this.camera.position.set(0, CANYON.RIM_Y + 60, 210);
  }

  get distance(): number {
    return this.now.distance;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Landing is keyed to height over the ground rather than altitude: pads range from
   * +67 on a tower crest to −142 down the shaft, and "almost landed" has to mean near
   * the surface you are actually approaching, wherever that happens to be.
   */
  private phaseFor(altitude: number, heightAboveGround: number): Phase {
    if (altitude < CANYON.FLOOR_Y) return 'shaft';
    if (heightAboveGround < LANDING_CEILING) return 'landing';
    if (altitude > SKY_FLOOR && heightAboveGround > 250) return 'sky';
    return 'flight';
  }

  /** Target framing for a phase. `pace` is normalised speed, 0..1. */
  private framingFor(phase: Phase, pace: number): Framing {
    if (phase === 'sky') {
      /**
       * Held on the vehicle, angled steeply enough that the colony sits at the foot of
       * the frame. Solved rather than dialled: the camera is 6.1 above and 3.8 behind,
       * so the lander lies atan(6.1/3.8) = 58° below the horizon. A 60° lens pitched
       * 67° puts it about a third of the way down the frame and drops the bottom edge
       * past vertical, which is where ground a thousand units below actually falls.
       */
      return {
        distance: 3.8,
        offsetY: 6.1,
        pitch: -1.17,
        fov: 60,
        leadX: 0,
        leadY: 0,
        follow: 1,
        posRate: 3.4,
        rotRate: 1.4,
      };
    }

    if (phase === 'shaft') {
      /**
       * Positioned on the back wall of the shaft opening, following the player closely
       * down into the bore with wide FOV so side walls are clearly visible.
       */
      return {
        distance: lerp(10, 14, pace),
        offsetY: lerp(3, 6, pace),
        pitch: -0.15,
        fov: 80,
        leadX: 0.05,
        leadY: 0.05,
        follow: 1,
        posRate: 5.5,
        rotRate: 4.5,
      };
    }

    if (phase === 'landing') {
      // Closest of the three, level, almost no lead. At touchdown the camera should
      // be steady and the pad should not slide around the frame.
      return {
        distance: lerp(30, 52, pace),
        offsetY: lerp(5, 9, pace),
        pitch: -0.17,
        fov: 50,
        leadX: 0.12,
        leadY: 0.1,
        follow: 0.6,
        posRate: 4.2,
        rotRate: 3.4,
      };
    }

    // Flight: distance tracks speed, the camera runs ahead of the movement, and both
    // position and angle chase hard so a correction reads immediately.
    //
    // The whole rig is a scale — distance, height and both leads are lengths, so
    // halving all four halves the range without touching the composition: the lander
    // sits in the same place in frame at twice the size, and the leads still show the
    // same angular slice of what is coming. Pitch and fov are angles and do not scale.
    // At entry speed the old 165 put a 2.5-unit vehicle across 1% of frame height,
    // which at a downscaled render buffer is a handful of pixels.
    return {
      distance: lerp(29, 82, pace),
      offsetY: lerp(8, 23, pace),
      pitch: lerp(-0.34, -0.62, pace),
      // Held near the landing lens. A wide lens at speed reads as urgency, but it
      // also shrinks the subject — 68° cost a third of the lander's on-screen size
      // against 50°, on the phase where it is already smallest. 4° of opening keeps
      // some of that flare without paying for it twice.
      fov: lerp(50, 54, pace),
      leadX: 0.31,
      leadY: 0.17,
      follow: 0.42,
      posRate: 3.0,
      rotRate: 3.2,
    };
  }

  /** Places the camera immediately, without easing. Used when a mission loads. */
  snapTo(x: number, y: number): void {
    this.smoothedSpeed = FULL_SPEED;
    this.phase = this.phaseFor(y, Infinity);
    this.now = this.framingFor(this.phase, 1);
    this.yaw = 0;
    this.camera.position.set(this.clampX(x), y + this.now.offsetY, this.now.distance);
    this.camera.rotation.set(this.now.pitch, 0, 0);
    this.camera.fov = this.now.fov;
    this.camera.updateProjectionMatrix();
    this.liftAboveGround(y);
  }

  private clampX(x: number): number {
    const limit = CANYON.PROFILE_HALF_X - 70;
    return Math.max(-limit, Math.min(limit, x));
  }

  /**
   * The camera flies inside the canyon rather than outside a diorama, so it can end
   * up buried in a wall or under the floor. Nothing else prevents that.
   *
   * `targetY` bounds how far the clamp may push. The ground is sampled under the
   * *camera*, which is tens of units toward the viewer from the lander — so whenever
   * the lander is under an overhang or down a shaft, that sample is of terrain the
   * lander is nowhere near, and the clamp will happily strand the camera on the rim
   * while the vehicle descends without it. Letting the camera clip a little rock is a
   * far smaller problem than losing the descent, so the lift is capped.
   */
  private liftAboveGround(targetY: number | null = null): void {
    if (!this.groundAt) return;
    let floor =
      this.groundAt(this.camera.position.x, this.camera.position.z) + CANYON.CAMERA_CLEARANCE;
    if (targetY !== null) {
      const maxLift = this.phase === 'shaft' ? this.now.offsetY + 4 : MAX_LIFT_ABOVE_TARGET;
      floor = Math.min(floor, targetY + maxLift);
    }
    if (this.camera.position.y < floor) this.camera.position.y = floor;
  }

  update(
    dt: number,
    targetX: number,
    targetY: number,
    vx: number,
    vy: number,
    heightAboveGround: number,
  ): void {
    this.smoothedSpeed = damp(this.smoothedSpeed, Math.hypot(vx, vy), 0.9, dt);
    const pace = clamp01(this.smoothedSpeed / FULL_SPEED);

    this.phase = this.phaseFor(targetY, heightAboveGround);
    const want = this.framingFor(this.phase, pace);

    // Every value eases, so a phase change is a camera move rather than a cut.
    const blend = 2.0;
    this.now.distance = damp(this.now.distance, want.distance, blend, dt);
    this.now.offsetY = damp(this.now.offsetY, want.offsetY, blend, dt);
    this.now.pitch = damp(this.now.pitch, want.pitch, blend, dt);
    this.now.fov = damp(this.now.fov, want.fov, blend, dt);
    this.now.leadX = damp(this.now.leadX, want.leadX, blend, dt);
    this.now.leadY = damp(this.now.leadY, want.leadY, blend, dt);
    this.now.follow = damp(this.now.follow, want.follow, blend, dt);
    this.now.posRate = damp(this.now.posRate, want.posRate, blend, dt);
    this.now.rotRate = damp(this.now.rotRate, want.rotRate, blend, dt);

    if (Math.abs(this.camera.fov - this.now.fov) > 0.01) {
      this.camera.fov = this.now.fov;
      this.camera.updateProjectionMatrix();
    }

    const leadY = Math.max(-20, Math.min(12, vy * this.now.leadY));
    const wantX = this.clampX(targetX * this.now.follow + vx * this.now.leadX);

    // Exponential damping trails a moving target by velocity/rate — at entry that is
    // 55/3 ≈ 18 units, which on the tight sky shot drops the lander out of frame.
    // Feeding the lag back into the target cancels it exactly, at any speed, without
    // stiffening the follow into something rigidly bolted on.
    const rate = this.now.posRate;
    this.camera.position.x = damp(this.camera.position.x, wantX + vx / rate, rate * 0.85, dt);
    this.camera.position.y = damp(
      this.camera.position.y,
      targetY + leadY + this.now.offsetY + vy / rate,
      rate,
      dt,
    );
    this.camera.position.z = damp(this.camera.position.z, this.now.distance, rate * 0.75, dt);
    this.liftAboveGround(targetY);

    // Turn to keep the lander in view — the camera holds the canyon's axis and makes
    // up the difference with yaw. The parallax that swing produces against the walls
    // and the background structures is most of what sells depth.
    const dx = targetX - this.camera.position.x;
    const wantYaw = Math.max(
      -0.5,
      Math.min(0.5, Math.atan2(-dx, Math.max(20, this.camera.position.z))),
    );
    this.yaw = damp(this.yaw, wantYaw, this.now.rotRate, dt);

    this.camera.rotation.x = damp(this.camera.rotation.x, this.now.pitch, this.now.rotRate, dt);
    this.camera.rotation.y = this.yaw;
    // A little counter-roll into the turn — the camera leaning to hold the axis
    // rather than being rigidly bolted to it.
    this.camera.rotation.z = damp(this.camera.rotation.z, this.yaw * -0.22, this.now.rotRate, dt);

    this.keepFramed(targetX, targetY);
  }

  /**
   * Hard guarantee that the lander is on screen.
   *
   * Everything above is best-effort framing: keyframes, leads, damping, a ground
   * clamp that can shove the camera somewhere the shot did not intend. Any of them
   * can lose the vehicle — during a phase change, against a wall, at a velocity the
   * lead was not tuned for. Rather than trying to make every path safe, the angles
   * are clamped at the end to stay within a fraction of the field of view of pointing
   * straight at the lander. Inside that cone the clamp does nothing at all; outside
   * it, the camera turns just far enough and no further, so it reads as the camera
   * catching up rather than snapping.
   */
  private keepFramed(targetX: number, targetY: number): void {
    const dx = targetX - this.camera.position.x;
    const dy = targetY - this.camera.position.y;
    const dz = 0 - this.camera.position.z;

    // Angles that would put the lander dead centre, in this camera's YXZ convention.
    const centreYaw = Math.atan2(-dx, -dz);
    const centrePitch = Math.atan2(dy, Math.hypot(dx, dz));

    const halfV = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    // Keep it inside 62% of the way to the edge, so it is never near the border.
    const margin = 0.62;

    const clamp = (value: number, centre: number, limit: number) =>
      Math.max(centre - limit, Math.min(centre + limit, value));

    this.camera.rotation.y = clamp(this.camera.rotation.y, centreYaw, halfH * margin);
    this.camera.rotation.x = clamp(this.camera.rotation.x, centrePitch, halfV * margin);
    this.yaw = this.camera.rotation.y;
  }

  /** Impact shake. Decays on its own; call once. */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  applyShake(dt: number): void {
    if (this.shakeAmount <= 0.001) return;
    this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
    this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount;
    this.shakeAmount = damp(this.shakeAmount, 0, 4.5, dt);
  }
}
