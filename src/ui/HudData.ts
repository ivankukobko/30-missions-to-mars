/**
 * What the panel is told, once per frame.
 *
 * A discriminated union rather than one wide interface with optional fields, for exactly
 * the reason `Airframe.ts` gives for the vehicles themselves: the three panels need
 * genuinely different telemetry, and a union means the hauler's branch cannot read
 * `tilt` — a number that has no meaning on a frame whose rotation is locked — because it
 * is not on the type. The alternative, `tilt?: number`, compiles fine and puts a live
 * attitude instrument on a vehicle that cannot change attitude.
 *
 * It lives in its own file so `Interface` and `InstrumentPanel` can both name it without
 * importing each other.
 */

/** Full-scale on the velocity instruments.
 *
 * Twice the touchdown tolerance, so the tolerance falls exactly at half-scale on every
 * panel and the outer half of any dial is the part that kills you. Picking the tolerance
 * itself as full-scale would peg the needle through most of a descent, which tells the
 * pilot nothing at the moment there is still time to act on it. */
export const VELOCITY_SPAN = 5;

/** The part every panel gets, whatever the vehicle. */
export interface HudCommon {
  fuel: number;
  fuelCapacity: number;
  altitude: number;
  /** Negative descending. */
  verticalSpeed: number;
  /**
   * Signed, positive to starboard.
   *
   * The readouts take the magnitude, but a crosshair has to know which way the drift is
   * going, and recovering the sign further downstream is not possible.
   */
  horizontalSpeed: number;
  /** How close the vehicle is to the abyss fail depth, 0..1. */
  abyssProximity: number;
  /**
   * Seconds since the console itself came up — not since the mission loaded.
   *
   * The two used to be the same, and it put the boot sweep in the wrong place: the panel
   * was drawn from the first frame of the mission, so it woke up *during* the uplink,
   * before there was a link for it to wake up on. The console is the vehicle's, and you
   * are not connected to the vehicle yet.
   *
   * Counted in fixed steps like `missionTime` itself, so a retry still boots identically.
   */
  consoleTime: number;
}

export type HudData =
  | (HudCommon & {
      scheme: 'attitude';
      tilt: number;
    })
  | (HudCommon & {
      scheme: 'differential';
      /** One flag per engine, in the airframe's own order. There is no throttle. */
      engines: boolean[];
      /**
       * Which way the lit engines are pushing, -1..1, positive to starboard. Derived
       * from the same `-sin(cant)` the physics integrates, not from which key is down.
       */
      bias: number;
      /** Room to the rock either side, or null anywhere outside a bore. */
      clearance: { left: number; right: number } | null;
    })
  | (HudCommon & {
      scheme: 'translation';
      rcsLeft: boolean;
      rcsRight: boolean;
      /** Cosmetic lean, radians. Nothing in the simulation reads it. */
      bank: number;
    });
