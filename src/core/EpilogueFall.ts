import { CANYON } from '../world/CanyonSpec.ts';

/**
 * The ending's timing, as arithmetic.
 *
 * Split out of `Game` because it is the one sequence in the campaign with no controls, no
 * outcomes and nothing to press — so the only thing that makes it right or wrong is
 * *when* each of its three events fires, and that was decided by four constants and two
 * comparisons buried in the frame loop with no test on any of them.
 *
 * The claims the design record makes about this sequence are checkable, and now are:
 * the bar is visibly behind at the three-second mark rather than frozen, and the beacon
 * leads the cut by a fixed fall however the cut is reached.
 */

/**
 * The bar crawls to an asymptote rather than freezing.
 *
 * Frozen reads as a bug and invites a reload; something still trying reads as something
 * still trying. It is already visibly behind at three seconds — where every other mission
 * in the game has finished and handed over — so the wrongness starts *before* the moment
 * of expected handover rather than at it.
 */
const STALL_AT = 0.88;
const STALL_TAU = 1.6;

/**
 * Where the picture goes, and where the beacon is picked up.
 *
 * Both are tested two ways and take **whichever comes first**, and that is not
 * belt-and-braces — either test alone is wrong somewhere on the map.
 *
 * Altitude alone is wrong because the ground is not at `FLOOR_Y`: mission 29 enters over
 * terrain standing at y≈177, so a cut at `FLOOR_Y + 45` would drive the vehicle a hundred
 * and thirty units into rock. A ground lookup alone is wrong because the ground can fall
 * away — over the shaft it returns a floor three hundred metres lower, making the ending
 * a function of excavation geometry that is still being written.
 *
 * `SIGNAL_RUN` is what makes the beacon's airtime a fact rather than an estimate.
 * Detection and cut are measured the same two ways and offset by the same distance, so
 * the beacon leads the ending by exactly that fall however the ending is reached.
 */
const CUT_Y = CANYON.FLOOR_Y + 45;
const CUT_HEIGHT = 45;
const SIGNAL_RUN = 375;
const IDENT_Y = CUT_Y + SIGNAL_RUN;
const IDENT_HEIGHT = CUT_HEIGHT + SIGNAL_RUN;

export const FALL = {
  STALL_AT,
  STALL_TAU,
  CUT_Y,
  CUT_HEIGHT,
  SIGNAL_RUN,
  IDENT_Y,
  IDENT_HEIGHT,
} as const;

/** Where the vehicle is, by the two measures the fall is judged on. */
export interface FallPosition {
  y: number;
  /** Distance to whatever is directly below, which over a bore is a long way down. */
  heightAboveGround: number;
}

/** How far the handshake has crawled, 0..1, and never reaching 1. */
export function uplinkProgress(missionTime: number): number {
  return STALL_AT * (1 - Math.exp(-missionTime / STALL_TAU));
}

/** Whether the distant beacon has come within range. */
export function identReached({ y, heightAboveGround }: FallPosition): boolean {
  return y < IDENT_Y || heightAboveGround < IDENT_HEIGHT;
}

/** Whether the picture is lost — the end of the campaign. */
export function cutReached({ y, heightAboveGround }: FallPosition): boolean {
  return y < CUT_Y || heightAboveGround < CUT_HEIGHT;
}
