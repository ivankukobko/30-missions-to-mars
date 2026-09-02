import { AIRFRAMES, engineThrust, type Airframe } from '../entities/Airframe.ts';
import { LANDER } from '../entities/LanderBody.ts';
import { airframeFor, ENTRY_VELOCITY, type Mission } from './Missions.ts';

/**
 * What a mission's fuel is unavoidably spent on, before any question of flying it well.
 *
 * Every landing is scored mostly on fuel — 60 to 70 of the 100 points — so the figure
 * that decides a rank is *what fraction of the tank was left*. That makes the size of the
 * tank, relative to what the run costs no matter who is flying, the single strongest
 * balance lever in the game, and it was twenty-nine numbers typed by hand with nothing
 * measuring them.
 *
 * **This is a lower bound, not a simulation.** It costs the two things physics forces on
 * every run — killing the entry velocity, and crossing to the pad — on an optimal profile
 * nobody actually flies. What it is for is *comparison*: if the unavoidable share of the
 * tank is 13% on one mission and 30% on another, then the same flying earns different
 * fuel fractions depending on which mission it is, and the score is partly reporting the
 * mission rather than the pilot.
 */

const GRAVITY = 6;

/**
 * How far a vehicle tilts to translate, for the frame that has to tilt at all.
 *
 * The attitude frame has no lateral thruster: it points the one engine off vertical and
 * takes the horizontal component, so its lateral authority is a choice the pilot makes
 * rather than a number on the airframe. A third of a radian is an ordinary working lean —
 * far short of `MAX_LANDING_TILT`'s cousin at the top of the envelope, and enough to make
 * the frames comparable without pretending to know what any particular player does.
 */
const WORKING_TILT = 0.3;

export interface FuelBudget {
  /** Effective capacity: what the mission grants, scaled by the airframe. */
  capacity: number;
  mass: number;
  /** Thrust acceleration with every engine lit. */
  accel: number;
  /** Fuel per second with every engine lit. */
  burnRate: number;
  /** Height from the entry point down to the delivery. */
  drop: number;
  /** Horizontal distance from the entry point to the delivery. */
  crossing: number;
  /** Killing the entry velocity, on an optimal single brake. */
  descentFuel: number;
  /** Translating to the pad and arriving stopped. */
  crossingFuel: number;
  /** Both, which is the floor under any run of this mission. */
  minimumFuel: number;
  /** The share of the tank that floor takes. Fairness is this being alike across missions. */
  unavoidable: number;
  /** Seconds of hovering the rest of the tank buys — how much slack the pilot really has. */
  hoverSeconds: number;
  /** The deck's half-width, or null for a delivery with no address. Feeds the centring term. */
  padHalfWidth: number | null;
}

/** Fuel per second with everything lit, which differs by how a frame makes lift. */
export function burnRateOf(frame: Airframe): number {
  return frame.scheme === 'differential'
    ? frame.engineBurn * frame.engines.length
    : frame.mainBurn;
}

/** Sideways acceleration available, at the same total thrust, however the frame gets it. */
export function lateralAccelOf(frame: Airframe, mass: number): number {
  if (frame.scheme === 'translation') return frame.sideThrust / mass;
  if (frame.scheme === 'differential') {
    // One engine of a canted pair: the horizontal component is what is left over from lift.
    const cant = Math.abs(frame.engines[0].cant);
    return (engineThrust(frame) * Math.sin(cant)) / mass;
  }
  return (frame.thrust * Math.sin(WORKING_TILT)) / mass;
}

/**
 * Fuel per second while translating, which is **not** the all-engines rate.
 *
 * The three frames pay for sideways movement in three different currencies, and charging
 * them all the full burn was the first version's mistake — it made the two charter frames
 * look far more expensive to fly than they are, and the correction reverses which frames
 * come out tightest:
 *
 * - **translation** moves on side thrusters at `rcsBurn`, with the main engine still
 *   holding altitude underneath. Cheapest by a wide margin, which is the whole point of
 *   the frame that has to fly into a room and stop;
 * - **differential** fires one of its canted pair. That engine lifts
 *   `engineThrust·cos(cant)` = 18 on its own against a weight of at most 2.05·6 ≈ 12.3, so
 *   it carries the vehicle *and* pushes it sideways on a single engine's burn;
 * - **attitude** has no lateral thruster at all. It points its one engine off vertical, so
 *   translating costs exactly what flying costs, and the vehicle every tolerance was tuned
 *   against turns out to be the expensive one to move.
 */
export function lateralBurnOf(frame: Airframe, accel: number): number {
  const hoverBurn = burnRateOf(frame) * (GRAVITY / accel);
  if (frame.scheme === 'translation') return frame.rcsBurn + hoverBurn;
  if (frame.scheme === 'differential') return frame.engineBurn;
  return frame.mainBurn;
}

/**
 * The optimal brake, solved rather than searched.
 *
 * Falling freely for `h − d` and then braking over `d` at `a − g`:
 *
 *     v² = v₀² + 2g(h − d)      and      d = v² / (2(a − g))
 *
 * Substituting and collecting gives `2da = v₀² + 2gh`, so the brake distance falls out in
 * closed form and does not depend on `g` except through the height already fallen.
 */
export function budgetFor(
  mission: Mission,
  targetY: number,
  targetX: number,
  padHalfWidth: number | null = null,
): FuelBudget {
  const frame = AIRFRAMES[airframeFor(mission)];
  const capacity = Math.round(mission.fuel * frame.fuelScale);
  const mass = LANDER.DRY_MASS + mission.payload.mass * LANDER.PAYLOAD_MASS_FACTOR;
  const accel = frame.thrust / mass;
  const burnRate = burnRateOf(frame);

  const entrySpeed = Math.abs(mission.entry?.vy ?? ENTRY_VELOCITY.vy);
  const drop = mission.start.y - targetY;
  const brakeDistance = (entrySpeed * entrySpeed + 2 * GRAVITY * drop) / (2 * accel);
  const speedAtBrake = Math.sqrt(
    Math.max(0, entrySpeed * entrySpeed + 2 * GRAVITY * (drop - brakeDistance)),
  );
  const descentFuel = burnRate * (speedAtBrake / (accel - GRAVITY));

  // Accelerate for half the crossing and stop over the other half.
  const crossing = Math.abs(targetX - mission.start.x);
  const lateral = lateralAccelOf(frame, mass);
  const crossingFuel =
    lateral > 0 ? lateralBurnOf(frame, accel) * 2 * Math.sqrt(crossing / lateral) : 0;

  const minimumFuel = descentFuel + crossingFuel;
  // Holding altitude is a duty cycle: enough throttle to cancel gravity and no more.
  const hoverBurn = burnRate * (GRAVITY / accel);

  return {
    capacity,
    mass,
    accel,
    burnRate,
    drop,
    crossing,
    descentFuel,
    crossingFuel,
    minimumFuel,
    unavoidable: minimumFuel / capacity,
    hoverSeconds: (capacity - minimumFuel) / hoverBurn,
    padHalfWidth,
  };
}
