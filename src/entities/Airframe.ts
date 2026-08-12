/**
 * The two vehicles, as data.
 *
 * The campaign flies two airframes with genuinely different flight models, and this is
 * the single description both the physics and the geometry read. `LanderBody` branches
 * on `scheme` for how thrust is applied; `LanderView` iterates `engines` for where to
 * put a pod and a plume. Neither hard-codes a vehicle, so a third frame is a new entry
 * in this file rather than a change to either of them.
 *
 * A discriminated union rather than one wide interface with optional fields: the two
 * schemes need genuinely different parameters, and a union means the differential
 * branch cannot read `rotationPower` — a number that has no meaning for a vehicle whose
 * rotation is locked — because it is not on the type.
 *
 * Nothing here imports three.js, for the same reason `LanderBody` does not: the flight
 * envelope has to be reachable from a test.
 */

export type AirframeId = 'lander' | 'hauler' | 'helion';

/** Where an engine sits and which way it points, in the vehicle's model space. */
export interface Engine {
  /** Offset from the centreline. */
  x: number;
  /**
   * Nozzle angle from straight down, positive meaning splayed toward +x.
   *
   * Thrust comes out the opposite way, which is the whole reason the differential
   * scheme steers: a nozzle splayed to starboard pushes the vehicle to port.
   */
  cant: number;
}

interface Common {
  id: AirframeId;
  /** Shown in the mission brief. */
  name: string;
  /** Total thrust with every engine lit. Divided by mass to get acceleration. */
  thrust: number;
  /** Multiplier on the mission's authored fuel budget. */
  fuelScale: number;
  engines: Engine[];
}

export type Airframe =
  | (Common & {
      /** Rotate with left/right, thrust along the hull axis. The classic. */
      scheme: 'attitude';
      rotationPower: number;
      angularDamp: number;
      /** Fuel per second with the main engine lit. */
      mainBurn: number;
      /** Fuel per second per attitude jet. */
      rcsBurn: number;
    })
  | (Common & {
      /**
       * Fire the engines independently; both together push straight up. Rotation is
       * locked, so the only way to go sideways is to run one engine — which is why the
       * nozzles have to be canted. With them vertical, one engine produces pure lift
       * and the scheme has no steering at all.
       */
      scheme: 'differential';
      /** Fuel per second per engine. */
      engineBurn: number;
      /** Largest visual lean, in radians. Cosmetic — see `LanderBody.bank`. */
      bankMax: number;
      /** How briskly the lean follows the engines. */
      bankRate: number;
    })
  | (Common & {
      /**
       * Decoupled horizontal translation. Up key fires main vertical lift engine (+Y).
       * Left/Right keys fire lateral RCS jets to shift horizontal position (±X) without rotating.
       * Holding Left+Right together fires the main UP thruster.
       */
      scheme: 'translation';
      sideThrust: number;
      mainBurn: number;
      rcsBurn: number;
      bankMax: number;
      bankRate: number;
    });

/**
 * Cant for the hauler's nozzles: 30° from vertical.
 *
 * It is a straight trade. Steeper buys lateral authority — the horizontal component is
 * `sin cant` of engine thrust — and costs lift, because holding altitude on two canted
 * engines only ever gets you `cos cant` of what you are burning. At 30° a single engine
 * pushes sideways at 58% of its own thrust while the pair still lifts at 87% of nominal,
 * which is responsive enough to place the vehicle in a 24-wide bore without making a
 * heavy manifest unliftable.
 */
const HAULER_CANT = Math.PI / 6;

export const AIRFRAMES: Record<AirframeId, Airframe> = {
  /**
   * One engine on the centreline, and attitude jets to point it. Every tolerance in the
   * game was tuned against this vehicle, so its numbers are the ones that were already
   * there — this is the campaign's baseline, not a new balance pass.
   */
  lander: {
    id: 'lander',
    name: 'TD-4 LANDER',
    scheme: 'attitude',
    thrust: 36,
    fuelScale: 1,
    engines: [{ x: 0, cant: 0 }],
    rotationPower: 3.4,
    angularDamp: 0.8,
    mainBurn: 11,
    rcsBurn: 2.2,
  },

  /**
   * Two engines splayed off the centreline, no attitude control, rotation locked.
   */
  hauler: {
    id: 'hauler',
    name: 'KD-9 SHAFT HAULER',
    scheme: 'differential',
    thrust: 36,
    fuelScale: 0.9,
    engines: [
      { x: -0.24, cant: -HAULER_CANT },
      { x: 0.24, cant: HAULER_CANT },
    ],
    engineBurn: 11 / (2 * Math.cos(HAULER_CANT)),
    bankMax: 0.21,
    bankRate: 5,
  },

  /**
   * Helion lateral craft: Decoupled translation.
   * Up = Main vertical lift engine (+Y). Left/Right = Lateral RCS jets (±X).
   * Left + Right = Main vertical lift engine (+Y).
   */
  helion: {
    id: 'helion',
    name: 'HD-7 SIDEWINDER',
    scheme: 'translation',
    thrust: 36,
    sideThrust: 18,
    fuelScale: 0.92,
    engines: [
      { x: 0, cant: 0 },
      { x: -0.44, cant: -Math.PI / 2 },
      { x: 0.44, cant: Math.PI / 2 },
    ],
    mainBurn: 11,
    rcsBurn: 2.2,
    bankMax: 0.14,
    bankRate: 6,
  },
};

/**
 * Thrust per engine, so that lighting every engine delivers exactly `thrust`.
 *
 * For the lander that is the whole 36 through one nozzle. For the hauler it is more than
 * half of 36 each, because only `cos cant` of a canted engine's output ends up going up.
 */
export function engineThrust(frame: Airframe): number {
  const lift = frame.engines.reduce((sum, e) => sum + Math.cos(e.cant), 0);
  return frame.thrust / lift;
}

/**
 * Which physical engine a control input drives.
 *
 * The hauler's nozzles splay outward, so its port engine pushes the vehicle to
 * starboard. Pressing left therefore has to light the *right* engine for the vehicle to
 * go left, which is the default. `inverted` maps each input to the engine on its own
 * side instead — the same vehicle flown as "which thruster am I firing" rather than
 * "which way am I going".
 */
export function engineForInput(
  frame: Airframe,
  side: 'left' | 'right',
  inverted: boolean,
): number {
  if (frame.engines.length < 2) return 0;
  const wantsPort = inverted ? side === 'left' : side === 'right';
  return wantsPort ? 0 : frame.engines.length - 1;
}
