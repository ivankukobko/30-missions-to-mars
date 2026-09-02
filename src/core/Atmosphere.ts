import { CANYON } from '../world/CanyonSpec.ts';
import { PALETTE } from '../world/CanyonSpec.ts';
import { clamp01, lerp } from '../world/Noise.ts';

/**
 * How thick and how dark the air is, as a pure function of where the player is looking
 * from.
 *
 * Split out of `Game.updateAtmosphere` because everything above the `THREE.Color` calls
 * was arithmetic with no renderer in it, and because that arithmetic has now been wrong
 * twice in ways nothing could catch. Both bugs were about *which position* and *which
 * question*, not about the numbers:
 *
 * - the viewpoint was always the lander, so the main menu — which parks its camera on the
 *   canyon while the vehicle sits hidden wherever it was left — drew the whole chasm in
 *   the air of a vehicle nobody could see. After the ending, that vehicle is at the
 *   bottom of the canyon, and the menu came up at nearly four times a fresh boot's
 *   density;
 * - "am I in a hole" was read off the camera's *framing*, which goes tight for close
 *   quarters of any kind, so the abyss treatment arrived over the last twenty units of
 *   every landing in the game, open pads in daylight included.
 *
 * Neither was visible to a test, because there was nothing to test. There is now.
 */

/** The two ramps the air is mixed from, both 0..1. */
export interface AirDepth {
  /** How far below the rim, where the canyon is in its own shadow. */
  belowRim: number;
  /**
   * How far into "you should not be able to see past this".
   *
   * 1 whenever the vehicle is genuinely under grade, whatever the depth. Deriving it from
   * depth alone left a shallow working — the shared shaft's Helion gallery sits 18–24
   * units under the floor against a 180-unit ramp — reading 0.10–0.13, which is the thin
   * dusty air of the canyon floor rather than an excavation, and thin enough that a seam
   * in the rock read as background showing through.
   */
  inShaft: number;
}

/** Where the fog is headed, before damping. */
export interface AirTarget {
  density: number;
  /** Mixed from the haze toward shadow and then toward the black of a bore. */
  color: number;
  shadowMix: number;
  abyssMix: number;
}

const HAZE_DENSITY = 0.0011;
const SHADOW_DENSITY = 0.0052;
const ABYSS_DENSITY = 0.014;

/** Depth at which air keyed off `y` alone would count as fully in the abyss. */
const ABYSS_RAMP = 180;

const SHADOW_COLOR = 0x2e1409;
const ABYSS_COLOR = 0x090503;
/** How far toward each colour the mix ever goes, so the air never becomes pure black. */
const SHADOW_LIMIT = 0.82;
const ABYSS_LIMIT = 0.92;

/**
 * Which position the air is measured at.
 *
 * The vehicle while the player is flying it, and the **camera** whenever the camera is
 * somewhere else — the free-cam inspector, and the menu and the closing card, both of
 * which frame the canyon while the vehicle is parked out of sight.
 */
export function viewpointY(
  state: string,
  inspecting: boolean,
  cameraY: number,
  landerY: number | null,
): number {
  const throughCamera = inspecting || state === 'MENU' || state === 'VICTORY';
  if (throughCamera) return cameraY;
  return landerY ?? CANYON.FLOOR_Y;
}

/**
 * `underGrade` is a fact about the world — the vehicle measured against the real,
 * un-carved terrain at its own column — and not the camera's framing. See
 * `CameraDirector.underGrade`, which exists because those two were conflated.
 */
export function airDepth(y: number, underGrade: boolean): AirDepth {
  return {
    belowRim: clamp01((CANYON.RIM_Y - y) / CANYON.RIM_Y),
    inShaft: underGrade ? 1 : clamp01((CANYON.FLOOR_Y - y) / ABYSS_RAMP),
  };
}

export function airTarget({ belowRim, inShaft }: AirDepth): AirTarget {
  return {
    density: lerp(lerp(HAZE_DENSITY, SHADOW_DENSITY, belowRim), ABYSS_DENSITY, inShaft),
    color: PALETTE.haze,
    shadowMix: belowRim * SHADOW_LIMIT,
    abyssMix: inShaft * ABYSS_LIMIT,
  };
}

export const AIR = {
  HAZE_DENSITY,
  SHADOW_DENSITY,
  ABYSS_DENSITY,
  SHADOW_COLOR,
  ABYSS_COLOR,
} as const;
