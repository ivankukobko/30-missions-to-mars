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
/**
 * Altitude at which the sky phase begins, provided the ground is far below.
 *
 * Lowered from 620. A mission enters at y≈1250 doing 55 u/s under `GRAVITY = -6.0`
 * (`Game.ts`), so free fall alone — no thrust, the case `phaseFor` can actually predict —
 * crossed the old 620 at t≈8.0s, already well past the 1.5-second uplink handshake. The
 * height-above-ground gate below is untouched and is what actually ends the phase near a
 * colony's own elevated terrain; this one is what governs it over open canyon, where nothing
 * but altitude says whether you're still meant to be reading the wide shot. 520 buys about
 * another second of it (t≈8.9s), long enough for the pad-aim lean below to read before the
 * frame commits to the tighter flight tracking.
 */
const SKY_FLOOR = 520;
/**
 * How far the sky phase leans its yaw toward the mission's own target pad, 0..1 against
 * the yaw that would otherwise just centre the vehicle.
 *
 * Not a position bias — an earlier version pulled `camera.position.x` toward the pad
 * instead, and the yaw computed just below promptly turned it straight back: that yaw
 * exists to keep the lander in view against whatever the camera's x is doing, so it
 * cancelled the lean it was never told about. Feeding the lean into the yaw target
 * itself, ahead of that cancellation, is the only place it survives. 0.55 rather than 1:
 * fully committing to the pad's bearing would swing the vehicle toward the frame's edge
 * on a pad far off its track, and `keepFramed` would then spend its own budget hauling
 * it back — better to lean far enough to read as "that way" and leave `keepFramed`
 * headroom for its actual job.
 */
const SKY_AIM_TOWARD_PAD = 0.55;
/**
 * How far below the *local* natural floor counts as down a hole, in units of gear
 * clearance rather than of canyon-wide terrain variance — see `phaseFor`'s own comment
 * for why comparing against the real ground at this column is what makes a small number
 * safe here. A ground pad's own deck sits `groundY + 1.3` above that terrain
 * (`Colony.buildPad`), and the lander's origin settles another `LANDER.RADIUS` (0.62)
 * above the deck, so an ordinary touchdown never reads more than about 2 units below the
 * natural floor even mid-bounce. Four is comfortable margin over that and nothing more.
 */
const SHAFT_MOUTH = 4;
/**
 * Within this of whatever is underneath, the shot goes tight regardless of where you are.
 *
 * The shaft framing was built for a bore, but what it is really for is close quarters —
 * near lens, wide angle, the rock either side legible. That is the same thing a pad
 * touchdown and a cavern floor want, and neither of them is under grade, so neither was
 * getting it.
 */
const SHAFT_CLOSE = 20;
/** Ceiling on how far the ground clamp may lift the camera over the lander. */
const MAX_LIFT_ABOVE_TARGET = 26;
const FULL_SPEED = 45;

export class CameraDirector {
  camera: THREE.PerspectiveCamera;
  /** Sampled to keep the camera from burying itself in the canyon wall. */
  groundAt: ((x: number, z: number) => number) | null = null;

  phase: Phase = 'sky';
  /**
   * Whether the vehicle is genuinely under grade — down a bore or inside an excavation —
   * as opposed to merely close to something.
   *
   * Kept apart from `phase` because the two answer different questions and only one of
   * them is about the world. `'shaft'` is a *framing*: near lens, wide angle, rock either
   * side legible, and it is chosen for close quarters of any kind, including the last
   * twenty units of an ordinary touchdown on an open pad. Whether there is rock overhead
   * is a fact about where the vehicle is.
   *
   * `Game.updateAtmosphere` conflated them and read `phase === 'shaft'` as "in a hole",
   * which put the abyss fog — nearly three times the density and a colour 92% of the way
   * to black — over the end of *every* landing in the game, on open ground in daylight.
   */
  underGrade = false;
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
  private phaseFor(altitude: number, heightAboveGround: number, belowLocalFloor: number): Phase {
    /**
     * Below the *local* floor by more than a gear's clearance, not below the global
     * constant by more than a guess.
     *
     * This used to compare `altitude` against `CANYON.FLOOR_Y - 20` — a fixed 20-unit
     * buffer under one global number the same for every column. It had to be that
     * generous because `CANYON.FLOOR_Y` is a nominal baseline, not where the ground
     * actually is: measured across ten seeds, `outpost-main` — an ordinary ground pad,
     * never a shaft — settles as low as y = −10.8, comfortably inside a 20-unit buffer
     * and comfortably outside anything smaller. A player asking for the shaft framing to
     * commit the moment the vehicle passes a couple of units below grade cannot be
     * answered by shrinking that number; the number was never measuring the right thing.
     *
     * `belowLocalFloor` is `groundAt(x, 0) − y` — depth below the real, un-carved terrain
     * at the vehicle's own column (`CanyonGenerator.heightAt` is unaffected by any dig
     * cut into it; see its own doc comment). Against *that*, a landed vehicle sits within
     * its own gear height and touchdown settle of zero everywhere, on every seed, so the
     * buffer only has to cover that — a few units — and the shaft phase can commit almost
     * immediately once the vehicle is unambiguously past the lip, instead of twenty units
     * into a descent that might not be much longer than that.
     */
    if (belowLocalFloor > SHAFT_MOUTH) return 'shaft';
    // Or simply close to whatever is below, wherever that is. Additive rather than a
    // replacement for the under-grade test above: descending a 172-deep bore leaves the
    // vehicle a long way over its floor for most of the trip, and that whole descent
    // still wants the bore framing rather than picking it up in the last twenty units.
    if (heightAboveGround < SHAFT_CLOSE) return 'shaft';
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
       *
       * `posRate`/`rotRate` raised from 5.5/4.5 — the *second* of two cascaded lags:
       * `update`'s `blend` chases `want.pitch` first, and only once that has moved does
       * `camera.rotation.x` chase it here. Both were tuned back when the first stage took
       * over a second to arrive on its own, so this one was never the bottleneck and
       * never got measured.
       *
       * It was, once `blend` stopped being one: driven frame-by-frame from a synthetic
       * descent at the entry sink rate, crossing the mouth and holding at the old rates
       * left the camera still 3°+ off the shaft's own level `-0.15` for **1.4s after the
       * phase had already committed**, and inside 1° only at 2.2s — on a bore that is
       * often not much longer than that to fly. At these rates the same trace is inside
       * 3° in 0.42s and inside 1° in 0.63s. That gap is the whole of what read as the
       * camera hesitating: the phase was never wrong, the lens just had not caught up to
       * it yet, for most of the descent.
       */
      return {
        distance: lerp(10, 14, pace),
        offsetY: lerp(3, 6, pace),
        pitch: -0.15,
        fov: 80,
        leadX: 0.05,
        leadY: 0.05,
        follow: 1,
        posRate: 8,
        rotRate: 9,
      };
    }

    if (phase === 'landing') {
      /**
       * Right in on the vehicle, level, almost no lead. At touchdown the camera should
       * be steady and the pad should not slide around the frame.
       *
       * This is the cave framing as well, which is not obvious from the name. A Helion
       * cavern sits only a few units under the rim — `shaft-gallery` is at y ≈ −8, well
       * above the floor−20 line — so it never reaches `shaft` and runs on this instead.
       * Both are the same problem anyway: a tight space where what matters is the metre
       * either side of the hull, not where the canyon goes next.
       *
       * Roughly half the previous range. Distance, height and both leads are lengths, so
       * they scale together and the composition is unchanged — the vehicle sits in the
       * same place in frame at twice the size, and the leads still show the same angular
       * slice of what is coming. See the flight framing's note on the same property.
       */
      return {
        distance: lerp(20, 38, pace),
        offsetY: lerp(2.7, 4.8, pace),
        pitch: -0.7,
        fov: 50,
        leadX: 0.065,
        leadY: 0.054,
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
    /**
     * The slow end is pulled in, the fast end is not.
     *
     * Low `pace` in this phase is the canyon interior — threading the colony grid, where
     * the useful information is the structure within a hull's length either side. High
     * `pace` is the long fall before any of that, where the same framing would put the
     * vehicle a handful of pixels across. One lerp covers both, so tightening only its
     * near end moves the camera in exactly where the flying is close work and leaves the
     * descent alone.
     */
    return {
      distance: lerp(20, 82, pace),
      offsetY: lerp(5.5, 23, pace),
      pitch: lerp(-0.34, -0.62, pace),
      // Held near the landing lens. A wide lens at speed reads as urgency, but it
      // also shrinks the subject — 68° cost a third of the lander's on-screen size
      // against 50°, on the phase where it is already smallest. 4° of opening keeps
      // some of that flare without paying for it twice.
      fov: lerp(50, 54, pace),
      // Scaled with the distance at the near end, for the reason above: leads are lengths
      // too, and holding them fixed while the camera came in would have the frame running
      // further ahead of a slow vehicle than a fast one.
      leadX: lerp(0.21, 0.31, pace),
      leadY: lerp(0.12, 0.17, pace),
      follow: 0.42,
      posRate: 3.0,
      rotRate: 3.2,
    };
  }

  /**
   * How far `y` sits below the real, un-carved terrain at column `x` — see `phaseFor`'s
   * own comment for what this is answering instead of the global floor constant.
   *
   * `-Infinity` with no `groundAt`: this only runs before the first mission's terrain
   * exists, and "not below anything" is the correct read of not knowing yet, the same
   * way `liftAboveGround` treats a missing probe as nothing to clamp against.
   */
  private belowLocalFloor(x: number, y: number): number {
    return this.groundAt ? this.groundAt(x, 0) - y : -Infinity;
  }

  /** Places the camera immediately, without easing. Used when a mission loads. */
  snapTo(x: number, y: number): void {
    this.smoothedSpeed = FULL_SPEED;
    const dropSnap = this.belowLocalFloor(x, y);
    this.phase = this.phaseFor(y, Infinity, dropSnap);
    this.underGrade = dropSnap > SHAFT_MOUTH;
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
    /** The mission's own target pad, x only — null on a mission with none (the prologue,
     *  the relay). See `SKY_AIM_TOWARD_PAD`. */
    padX: number | null = null,
  ): void {
    this.smoothedSpeed = damp(this.smoothedSpeed, Math.hypot(vx, vy), 0.9, dt);
    const pace = clamp01(this.smoothedSpeed / FULL_SPEED);

    const drop = this.belowLocalFloor(targetX, targetY);
    this.phase = this.phaseFor(targetY, heightAboveGround, drop);
    this.underGrade = drop > SHAFT_MOUTH;
    const want = this.framingFor(this.phase, pace);

    /**
     * Every value eases, so a phase change is a camera move rather than a cut — but the
     * move itself was too slow to read as following.
     *
     * This is a *target*, not the camera: `this.now.pitch` chases `want.pitch` at this
     * rate, and only then does `camera.rotation.x` chase `this.now.pitch` at `rotRate`
     * (in the shaft framing below) — two cascaded lags, not one. The phase decision
     * itself was never the problem: `phaseFor` commits to `'shaft'` the moment the
     * vehicle is 20 units below the floor line, by design (see `SHAFT_MOUTH`'s own
     * comment on why that buffer exists), and holds it the whole way down. Everything
     * after that was the lens failing to catch up to a decision that was already right.
     *
     * Driven frame-by-frame from a synthetic descent at the entry sink rate (mission 26,
     * seed 12345), the old rate of 2.0 left `camera.rotation.x` more than 3° off the
     * shaft's own level `-0.15` for **1.4 seconds after the phase had already
     * committed**, and more than 1° off for 2.2 — on a bore that often does not take
     * much longer than that to fly. For most of a descent the shot was still the wide,
     * steeply pitched-down flight framing, which is exactly what read as "looking down
     * the hole" with no legible sense of the vehicle's own lateral drift inside a
     * corridor twelve units wide. At 9.0, paired with the faster `rotRate` below, the
     * same trace is inside 3° in 0.42s and inside 1° in 0.63s.
     */
    const blend = 9.0;
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
    let wantYaw = Math.atan2(-dx, Math.max(20, this.camera.position.z));

    // The sky hold (`SKY_FLOOR`) exists to give this a moment to turn toward the pad
    // you are actually meant to land on, not just whatever is straight ahead of the
    // vehicle's own track — see `SKY_AIM_TOWARD_PAD`.
    if (this.phase === 'sky' && padX !== null) {
      const dxPad = padX - this.camera.position.x;
      const padYaw = Math.atan2(-dxPad, Math.max(20, this.camera.position.z));
      wantYaw = lerp(wantYaw, padYaw, SKY_AIM_TOWARD_PAD);
    }
    wantYaw = Math.max(-0.5, Math.min(0.5, wantYaw));
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
