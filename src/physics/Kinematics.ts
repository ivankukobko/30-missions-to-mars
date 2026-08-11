import type { PhysicsWorld, Segment, SurfaceKind } from './PhysicsWorld.ts';

/**
 * Colony hardware that moves: travelling gantries, crane trolleys, flying decks.
 *
 * Everything here is *kinematic*, not dynamic. A body follows an authored path and is
 * unmoved by what it hits — there is no force, no mass, no response. That is the whole
 * reason this can be a hundred lines instead of a physics engine: the game's contact
 * model is terminal, so a moving hazard only ever has to be *detected*, never resolved.
 *
 * Two properties are load-bearing.
 *
 * **Determinism.** A pose is a pure function of mission time, and mission time is the
 * fixed-step count since the mission loaded. Nothing reads a wall clock. The campaign's
 * foundation is that retrying rebuilds the same situation, and a crane whose phase came
 * from `performance.now()` would quietly turn a fair death into a lottery — you would
 * fail a run and be unable to fly it again.
 *
 * **Bounded speed.** Within one substep a moving segment is treated as stationary, which
 * is what keeps the collision query identical to the static one. See `maxSafeSpeed` for
 * exactly how fast a surface may travel before that stops being true.
 */

/**
 * A there-and-back oscillation about the authored position.
 *
 * Deliberately the simplest thing that covers the cases worth having: a deck that
 * traverses, a hoist that rises and falls, a gantry that shuttles along its span. The
 * authored coordinate stays the *centre* of travel, so adding motion to an existing prop
 * never moves where it nominally is — which keeps every hand-placed coordinate in the
 * campaign meaning what it meant before.
 *
 * Rotation is not modelled. A swinging jib needs a rotational sweep to be collided
 * honestly, and translation covers the structures the colony would actually build.
 */
export interface Motion {
  /** Peak horizontal displacement from the authored position. Total travel is twice this. */
  dx?: number;
  /** Peak vertical displacement from the authored position. */
  dy?: number;
  /** Seconds for one complete there-and-back cycle. */
  period: number;
  /**
   * Where in the cycle the mission starts, 0..1. Two identical cranes given different
   * phases run out of step, which is the difference between a colony and a metronome.
   */
  phase?: number;
}

export interface Offset {
  x: number;
  y: number;
}

/**
 * Displacement at time `t`.
 *
 * A sine rather than a triangle wave: a triangle reverses instantaneously at each end,
 * and a lethal surface that changes direction with infinite acceleration is both a
 * physics problem and an unreadable one. A sine eases into its reversals, so a pilot can
 * see the turn coming.
 *
 * At `t = 0` with no phase the offset is zero, so a mission opens with every structure
 * exactly where the ledger says it is.
 */
export function offsetAt(motion: Motion, t: number): Offset {
  if (motion.period <= 0) return { x: 0, y: 0 };
  const s = Math.sin(2 * Math.PI * (t / motion.period + (motion.phase ?? 0)));
  return { x: (motion.dx ?? 0) * s, y: (motion.dy ?? 0) * s };
}

/** Fastest the surface travels, at the midpoint of its stroke. */
export function peakSpeed(motion: Motion): number {
  if (motion.period <= 0) return 0;
  const amplitude = Math.hypot(motion.dx ?? 0, motion.dy ?? 0);
  return (2 * Math.PI * amplitude) / motion.period;
}

/**
 * How fast a moving surface may travel before a lander can cross it undetected.
 *
 * Within a substep the surface is stationary, so the query only sees it at one pose per
 * step. If it travels more than the hull *diameter* between two poses, there is a band
 * the hull could occupy at both instants without ever overlapping it — and the vehicle
 * passes clean through a lethal object.
 *
 * At the fixed 120 Hz step and a 0.62 hull this is about 149 u/s, which is faster than
 * the lander's own entry velocity and far beyond anything a colony would bolt to a rail.
 * The bound is stated and asserted rather than assumed, because the failure it guards
 * against is invisible: nothing happens, which looks exactly like nothing being there.
 */
export function maxSafeSpeed(hullRadius: number, dt: number): number {
  return (2 * hullRadius) / dt;
}

/** One segment under a body's control, with the pose it holds at rest. */
interface Part {
  segment: Segment;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * A rigid group of segments that translates along a `Motion`.
 *
 * The body owns its colliders outright: it registers them with the world once, then
 * rewrites their endpoints in place every step. There is no index to invalidate, because
 * moving geometry is deliberately the tier the world does not index.
 */
export class KinematicBody {
  readonly motion: Motion;
  private parts: Part[] = [];
  private current: Offset = { x: 0, y: 0 };

  constructor(motion: Motion) {
    this.motion = motion;
  }

  /** Displacement from the authored position, as of the last `update`. */
  get offset(): Offset {
    return this.current;
  }

  get peakSpeed(): number {
    return peakSpeed(this.motion);
  }

  /** Registers one moving segment, remembering the pose it holds at rest. */
  segment(physics: PhysicsWorld, x1: number, y1: number, x2: number, y2: number, kind: SurfaceKind, padId?: string): void {
    const stored = physics.addMoving({ x1, y1, x2, y2, kind, ...(padId ? { padId } : {}) });
    this.parts.push({ segment: stored, x1, y1, x2, y2 });
  }

  /** The outline of an axis-aligned box, matching `PhysicsWorld.addBox`. */
  box(
    physics: PhysicsWorld,
    cx: number,
    cy: number,
    halfW: number,
    halfH: number,
    kind: SurfaceKind,
  ): void {
    const l = cx - halfW;
    const r = cx + halfW;
    const b = cy - halfH;
    const t = cy + halfH;
    this.segment(physics, l, b, l, t, kind);
    this.segment(physics, r, b, r, t, kind);
    this.segment(physics, l, t, r, t, kind);
    this.segment(physics, l, b, r, b, kind);
  }

  /** Moves every collider to where this body stands at time `t`. */
  update(t: number): void {
    const offset = offsetAt(this.motion, t);
    this.current = offset;
    for (const part of this.parts) {
      part.segment.x1 = part.x1 + offset.x;
      part.segment.y1 = part.y1 + offset.y;
      part.segment.x2 = part.x2 + offset.x;
      part.segment.y2 = part.y2 + offset.y;
    }
  }
}

/**
 * Every moving body in the current mission, advanced together.
 *
 * Rebuilt per mission load alongside the colony it belongs to, so it has the same
 * lifetime as the physics world's static tier.
 */
export class KinematicWorld {
  private bodies: KinematicBody[] = [];

  add(body: KinematicBody): KinematicBody {
    this.bodies.push(body);
    return body;
  }

  clear(): void {
    this.bodies.length = 0;
  }

  get count(): number {
    return this.bodies.length;
  }

  /** Fastest surface in the mission. Compare against `maxSafeSpeed`. */
  get peakSpeed(): number {
    let fastest = 0;
    for (const body of this.bodies) fastest = Math.max(fastest, body.peakSpeed);
    return fastest;
  }

  /**
   * Poses everything for mission time `t`.
   *
   * Call this inside the fixed-step loop, before the lander is integrated — not once per
   * frame. Per frame, a slow machine taking eight substeps at once would leave the crane
   * standing still for seven of them and then teleport it, which is precisely the
   * tunnelling the fixed timestep exists to prevent.
   */
  update(t: number): void {
    for (const body of this.bodies) body.update(t);
  }

  /**
   * Names any body fast enough to be crossed undetected. Empty is the healthy answer.
   *
   * Reported rather than clamped: a structure that silently ran slower than authored
   * would be a level-design change made behind the designer's back.
   */
  unsafeAt(hullRadius: number, dt: number): number[] {
    const limit = maxSafeSpeed(hullRadius, dt);
    const out: number[] = [];
    this.bodies.forEach((body, i) => {
      if (body.peakSpeed > limit) out.push(i);
    });
    return out;
  }
}
