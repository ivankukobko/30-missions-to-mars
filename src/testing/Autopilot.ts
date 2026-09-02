import type { Airframe } from '../entities/Airframe.ts';
import { LANDER, type LanderBody } from '../entities/LanderBody.ts';
import type { InputState } from '../core/InputManager.ts';

/**
 * A reference pilot: competent, not optimal, and the same on every mission.
 *
 * `FuelBudget` computes a *lower bound* — what physics forces on a profile nobody flies.
 * That is enough to compare missions and not enough to say what a rank is worth, because
 * the gap between the bound and a real run is exactly the thing being scored. This flies
 * the real `LanderBody` on the real `PhysicsWorld` at the real fixed step and lands.
 *
 * **The point is that it flies identically everywhere.** It is not trying to be a good
 * pilot; it is trying to be the *same* pilot on mission 2 and mission 29, so that any
 * difference in the fuel it has left is a difference in the mission rather than in the
 * flying. Read its scores as a baseline a decent human should beat, not as a ceiling.
 *
 * It is deliberately not clever about the canyon: it flies a descend-and-translate
 * profile and does not path around structure, so a mission where it collides is telling
 * you something about how tight that corridor is rather than that the mission is
 * unflyable.
 */

/** Fastest it will fall when there is nothing close underneath. */
const CRUISE_DESCENT = 46;
/**
 * And once the pad is close, so the last stretch is flown rather than dropped.
 *
 * Comfortably under `MAX_LANDING_SPEED` (2.5), because this is the speed the vehicle
 * actually arrives at and thrust is bang-bang — the throttle is either off or all the way
 * on, so the real descent oscillates a couple of tenths either side of whatever is asked
 * for. Set at 3.2 on the first attempt, above the tolerance, and every mission ended as a
 * hard landing at 4.8 u/s: the pilot was flying exactly as told and being told to crash.
 */
const FINAL_DESCENT = 1.2;
/**
 * Height at which it stops thinking about crossing and starts thinking about landing.
 *
 * High, because the attitude frame has to *rotate back* before it touches down and that
 * takes time it can only buy with altitude. At 26 the vehicle was still coming out of its
 * lean as it arrived and hit rock at 6.9 u/s.
 */
const FLARE_HEIGHT = 70;

/**
 * How much of the available braking it plans to use.
 *
 * Below 1 because a suicide burn has no margin by construction: any error at all and the
 * vehicle arrives with speed it cannot lose. Braking at 80% of what the frame can do
 * leaves the other 20% to answer whatever the descent got wrong, which is what a pilot is
 * doing when they start the burn early.
 */
const BRAKE_MARGIN = 0.8;

const GRAVITY = 6;

/** Horizontal error it will accept before it stops correcting and lands. */
const ON_STATION = 0.35;




/** Lean used to translate on the frame that has to lean to translate at all. */
const WORKING_TILT = 0.26;

export interface FlightTarget {
  x: number;
  y: number;
}

/** A point on the reserved route, as `ColonyChannels` lays it out. */
export interface RoutePoint {
  x: number;
  y: number;
}

/**
 * The descent speed it wants at a given height above the target.
 *
 * `sqrt(2·a·h)` is the speed from which the remaining height is exactly enough to stop —
 * so holding the vehicle at or under it means the burn can always still be made.
 */
function wantedDescent(heightToGo: number, brakeAccel: number): number {
  if (heightToGo <= 0) return 0;
  const stoppable = Math.sqrt(2 * Math.max(0, brakeAccel) * heightToGo);
  return Math.min(CRUISE_DESCENT, Math.max(FINAL_DESCENT, stoppable - FINAL_DESCENT));
}

export class Autopilot {
  private frame: Airframe;
  private target: FlightTarget;
  private route: RoutePoint[];

  constructor(frame: Airframe, target: FlightTarget, route: RoutePoint[] = []) {
    this.frame = frame;
    this.target = target;
    // Bottom-up, so a lookup by altitude can walk it in one direction.
    this.route = [...route].sort((a, b) => a.y - b.y);
  }

  /**
   * Where the reserved route is at this altitude — the x the pilot should be holding.
   *
   * **Not the pad's own column.** Every live pad has a route to the rim that nothing may
   * grow into, but those routes *merge into a shared trunk as they climb* rather than each
   * reserving a column of its own, so the guaranteed-clear path bends. Descending straight
   * down the pad's x leaves the reservation somewhere above the pad and re-enters the
   * colony: mission 7 flew into Kessler's own structure at y≈98, twenty-five units above
   * a deck it was lined up with to within a metre.
   */
  private routeXAt(y: number): number {
    if (this.route.length === 0) return this.target.x;
    if (y <= this.route[0].y) return this.route[0].x;
    const last = this.route[this.route.length - 1];
    if (y >= last.y) return last.x;
    for (let i = 1; i < this.route.length; i++) {
      const a = this.route[i - 1];
      const b = this.route[i];
      if (y <= b.y) {
        const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
        return a.x + (b.x - a.x) * t;
      }
    }
    return this.target.x;
  }

  /** What the pilot is holding down this step. */
  next(lander: LanderBody): InputState {
    const brakeAccel = (lander.thrustAccel * BRAKE_MARGIN - GRAVITY);
    // To where the vehicle's own origin will be at rest, not to the deck: contact is the
    // hull touching the pad, and the origin settles a radius above it.
    const heightToGo = lander.y - (this.target.y + LANDER.RADIUS);
    const holdX = this.routeXAt(lander.y);
    const dxNow = holdX - lander.x;
    /**
     * Hold a slow descent until the vehicle is over the pad's own column, then let the
     * stoppable profile take it down. Costs fuel, and is what a competent pilot spends
     * fuel on: arriving above the thing you are landing on.
     */
    const profile = wantedDescent(heightToGo, brakeAccel);
    /**
     * The descent is always the stoppable profile, and the crossing happens *during* it.
     *
     * Creeping down at a capped rate until aligned is what a cautious pilot would do and
     * it is ruinous here: holding eleven u/s down a twelve-hundred-unit drop is a hundred
     * seconds of powered flight at roughly five fuel a second, against tanks of about
     * 380. Twenty-one missions ran dry part-way and free-fell into whatever was under
     * them — which is why so many of them crashed at *identical* speeds, having become
     * the same falling rock.
     *
     * Falling on the profile is free, and the crossing does not need the time: lateral
     * distances are at most seventy units and every frame closes that in ten or twelve
     * seconds, by which point the vehicle is still six hundred units up — far above
     * anything the campaign builds.
     */
    const wanted = profile;
    // `vy` is negative going down, so this asks "am I falling faster than I want to be".
    const fallingTooFast = -lander.vy > wanted;

    const dx = dxNow;
    /**
     * The closing speed it wants: a stopping profile far out, and simply proportional
     * close in.
     *
     * The square-root term alone is right at distance and far too eager near zero — it
     * asks for 2 u/s from two units out, which the vehicle then has to kill, overshoots,
     * and asks for again the other way. Mission 3 hunted ±2.5 units around its pad for the
     * entire descent doing that, and landed beside it. Taking the smaller of the two makes
     * the last few units a gentle close rather than another sprint.
     */
    const wantedVx =
      Math.sign(dx) * Math.min(9, Math.sqrt(Math.abs(dx) * 2.2), Math.abs(dx) * 0.7);
    // A deadband wide enough that bang-bang thrusters are not chasing tenths.
    const needsRight = wantedVx - lander.vx > 0.5;
    const needsLeft = wantedVx - lander.vx < -0.5;
    // Below the flare it stops chasing x: a correction started this low costs more than
    // the centring point it is worth, and risks arriving with lateral speed.
    const crossing = heightToGo > FLARE_HEIGHT && Math.abs(dx) > ON_STATION;

    if (this.frame.scheme === 'translation') {
      return {
        main: fallingTooFast,
        left: crossing && needsLeft,
        right: crossing && needsRight,
      };
    }

    if (this.frame.scheme === 'differential') {
      /**
       * Both engines lift and cancel each other sideways; one engine lifts *and* pushes.
       * So a single engine is how this frame translates, and firing both is how it holds
       * a line — which means the lateral choice has to be made first and the lift comes
       * out of whichever engines that leaves.
       */
      if (crossing && (needsLeft || needsRight)) {
        return { main: false, left: needsLeft, right: needsRight };
      }
      return { main: fallingTooFast, left: false, right: false };
    }

    /**
     * The attitude frame points its only engine, so translating and braking are the same
     * control used for two purposes.
     *
     * The lean is driven by the **velocity error**, not by the direction of the target.
     * Leaning on `sign(dx)` alone — which is what this did first — accelerates for the
     * whole crossing and arrives with all of that speed still on: the vehicle sailed past
     * the pad, flipped its lean, sailed back, and spent a hundred seconds oscillating
     * until it ran the tank dry. Steering on `wantedVx − vx` makes the same lean brake as
     * readily as it accelerates, which is what a pilot is doing on the way in.
     */
    const speedError = wantedVx - lander.vx;
    const wantedTilt = crossing
      ? Math.max(-WORKING_TILT, Math.min(WORKING_TILT, -speedError * 0.35))
      : 0;
    const tiltError = wantedTilt - lander.rotation;
    // Damped: steer on where the attitude is heading, not only on where it is, or the
    // vehicle oscillates through the target lean and never settles.
    const steer = tiltError - lander.angularVelocity * 0.45;
    return {
      /**
       * Fires whenever it is falling too fast, leaned or not.
       *
       * Withholding thrust until the vehicle was upright looked prudent and is what put it
       * into the ground: coming out of a `WORKING_TILT` lean takes about a second, and a
       * second of not braking near the deck is fatal. The lean costs `1 − cos 0.26` ≈ 3%
       * of lift and buys the translation, so there was never much to withhold it for.
       */
      main: fallingTooFast,
      left: steer > 0.02,
      right: steer < -0.02,
    };
  }
}
