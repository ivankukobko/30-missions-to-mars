/**
 * The maths behind the instrument panels, with no DOM in sight.
 *
 * It lives apart from `InstrumentPanel` for the reason CLAUDE.md gives about geometry:
 * a needle rotated onto the wrong axis, a clearance bar mirrored left-for-right, or a
 * crosshair that drifts with the sign of `vx` all pass a rendering test and look
 * perfectly plausible in a screenshot. None of them survive being asserted on directly.
 *
 * Everything here is a pure function of its arguments. `settle` is the one exception
 * worth naming: it carries the previous needle position, which makes it stateful at the
 * call site — see its own note on why that state is allowed to be frame-paced.
 */

import { clamp01, damp } from '../world/Noise.ts';

/**
 * Where a needle sits on its scale, as -1..1 across the face.
 *
 * Clamped, because a needle that leaves its dial is a rendering bug rather than a
 * reading: real instruments peg at the stop and stay there, and the pegging is itself
 * information — it says "more than this dial can tell you", which is exactly the state
 * an approach at 8 u/s is in.
 */
export function needleOffset(value: number, span: number): number {
  if (span <= 0) return 0;
  return Math.max(-1, Math.min(1, value / span));
}

/** True once a reading has run past what its dial can show. */
export function pegged(value: number, span: number): boolean {
  return span > 0 && Math.abs(value) >= span;
}

/**
 * A two-sided clearance bar, as the fraction of the gap taken by each side.
 *
 * The two always sum to 1, so the bar reads as a position rather than a pair of
 * lengths: dead centre is a 50/50 split whether the bore is 24 wide or 10, and drifting
 * toward a wall moves the split without changing the bar. That is the reading the pilot
 * actually wants — "am I centred" — and it survives the bore narrowing as it descends,
 * which a raw margin in world units does not.
 */
export function clearanceSplit(left: number, right: number): { left: number; right: number } {
  const total = left + right;
  if (total <= 0) return { left: 0.5, right: 0.5 };
  const l = clamp01(left / total);
  return { left: l, right: 1 - l };
}

/**
 * How close the tighter wall is, 0..1, where 1 is touching rock.
 *
 * Separate from the split because the split alone cannot warn: a vehicle perfectly
 * centred in a bore that has narrowed to nothing still reads 50/50.
 */
export function clearanceRisk(left: number, right: number, span: number): number {
  if (span <= 0) return 0;
  return clamp01(1 - Math.min(left, right) / span);
}

/** How long a panel takes to come up, in seconds. */
export const BOOT_SECONDS = 0.9;

/**
 * Panel wake-up, 0 at the instant the mission loads and 1 once the panel is live.
 *
 * Posed from `missionTime` rather than integrated, so a retry replays the same boot —
 * the determinism rule in CLAUDE.md applies to anything the player can watch, and a
 * panel that came up differently on the second attempt would be exactly the kind of
 * silent divergence that rule exists to prevent.
 */
export function bootPhase(missionTime: number, seconds = BOOT_SECONDS): number {
  return clamp01(missionTime / Math.max(1e-6, seconds));
}

/**
 * The self-test sweep, 0..1..0 across the boot.
 *
 * Needles run to their stops and fall back — the gesture every mechanical panel makes
 * when it is asked to prove its needles still move. Front-loaded: the run out takes the
 * first third and the fall back the remaining two, because a symmetric sweep reads as a
 * bounce rather than a check.
 */
export function bootSweep(phase: number): number {
  const p = clamp01(phase);
  if (p >= 1) return 0;
  return p < 1 / 3 ? p * 3 : 1 - (p - 1 / 3) * 1.5;
}

/**
 * A needle chasing its reading.
 *
 * This is the whole of what makes the TD-4 feel older than the other two panels. Its
 * needles are given a low rate and lag visibly behind the truth; the newer frames pass
 * a rate high enough that the reading is effectively instant.
 *
 * Frame-paced rather than posed from `missionTime`, which is the one deliberate
 * exception to the rule above. A settling needle is an integrator — reconstructing it
 * from a mission clock means replaying every reading it has ever shown — and unlike the
 * boot sweep it changes nothing a replay could diverge on: no physics reads it, and the
 * value it lags toward is on the panel a fraction of a second later regardless.
 * `damp` is exponential, so the lag is the same at 30 fps as at 144.
 */
export function settle(current: number, target: number, rate: number, dt: number): number {
  return damp(current, target, rate, dt);
}

/**
 * Which way an arrow authored pointing right has to be turned to lie along the motion.
 *
 * Degrees, for CSS `rotate()`. The sign flip on `vy` is the whole of it and is exactly
 * the kind of thing that looks plausible while being upside down: world +y is up, screen
 * +y is down, and CSS rotates clockwise. Getting it wrong draws a vehicle falling as one
 * climbing — on the axis where the player has the least time to notice.
 */
export function driftAngle(vx: number, vy: number): number {
  return (Math.atan2(-vy, vx) * 180) / Math.PI;
}

/**
 * The band of speeds the vector arrow is for.
 *
 * Below the floor the direction of travel is noise: a vehicle at 0.02 u/s has a velocity
 * angle that swings wildly on rounding alone, and an arrow chasing it reads as a fault.
 *
 * Above the ceiling the *wake* has it covered. The hull drags a pair of streaks from
 * `WAKE_FLOOR` (2.5) upward, and those say direction and speed in world space, larger and
 * more legibly than an overlay ever could — so at cruise the arrow is a second answer to a
 * question already answered.
 *
 * What the wake cannot do is the last stretch. It switches off at 2.5, which is exactly
 * `MAX_LANDING_SPEED`: the whole of a survivable final approach happens below the speed
 * at which the trail exists. That is the band where "am I drifting, and how much" is the
 * only question left, and it is the one the arrow now owns — along with the numeric speed
 * and the reddening past tolerance, neither of which a trail can carry.
 *
 * The two overlap between 2.5 and 6 rather than meeting at a point, so neither pops in or
 * out against an empty screen.
 */
export const DRIFT_FLOOR = 0.15;
export const DRIFT_CEILING = 6;

/** Whether the motion is in the band the arrow is responsible for. */
export function drifting(vx: number, vy: number): boolean {
  const speed = Math.hypot(vx, vy);
  return speed >= DRIFT_FLOOR && speed < DRIFT_CEILING;
}

/**
 * How long the vector arrow runs, in px, growing with speed to a stop.
 *
 * Length rather than colour carries the magnitude, because the overlay sits on the
 * vehicle where the eye already is: a longer arrow is legible in peripheral vision in a
 * way a hue shift is not.
 */
export function vectorReach(speed: number, span: number, min: number, max: number): number {
  return min + (max - min) * clamp01(span > 0 ? speed / span : 0);
}

/** Needle rates, in the units `settle` wants. The gap between them is the point. */
export const NEEDLE_RATE = {
  /** Visibly mechanical. Slow enough to overshoot a correction and swing back. */
  archaic: 6,
  /** Effectively instant — a digital panel drawing what it is told. */
  modern: 40,
} as const;
