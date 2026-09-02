import { describe, expect, it } from 'vitest';
import { AIR, airDepth, airTarget, viewpointY } from './Atmosphere.ts';
import { CANYON } from '../world/CanyonSpec.ts';

/**
 * The air has been wrong twice, both times about *which position* or *which question* —
 * never about the numbers. These are the two questions.
 */

describe('which position the air is measured at', () => {
  const CAMERA = 300;
  const LANDER = -280;

  it('uses the vehicle while the player is flying it', () => {
    expect(viewpointY('PLAYING', false, CAMERA, LANDER)).toBe(LANDER);
    expect(viewpointY('UPLINK', false, CAMERA, LANDER)).toBe(LANDER);
    expect(viewpointY('FALL', false, CAMERA, LANDER)).toBe(LANDER);
  });

  /**
   * The menu parks its camera on the canyon while the vehicle sits hidden wherever it was
   * left — and after the ending, that is the bottom of the chasm. Keying the air off the
   * lander drew the whole canyon in shaft-bottom murk at nearly four times a fresh boot's
   * density, over a world that had been rebuilt correctly.
   */
  it('uses the camera wherever the camera is not on the vehicle', () => {
    expect(viewpointY('MENU', false, CAMERA, LANDER)).toBe(CAMERA);
    expect(viewpointY('VICTORY', false, CAMERA, LANDER)).toBe(CAMERA);
    expect(viewpointY('PLAYING', true, CAMERA, LANDER)).toBe(CAMERA);
  });

  it('falls back to the canyon floor when there is no vehicle at all', () => {
    expect(viewpointY('PLAYING', false, CAMERA, null)).toBe(CANYON.FLOOR_Y);
  });
});

describe('how deep the air thinks it is', () => {
  it('is clear at the rim and in shadow at the floor', () => {
    expect(airDepth(CANYON.RIM_Y, false).belowRim).toBeCloseTo(0, 5);
    expect(airDepth(CANYON.FLOOR_Y, false).belowRim).toBeCloseTo(1, 5);
  });

  it('does not go past either end of its own ramp', () => {
    expect(airDepth(CANYON.RIM_Y * 4, false).belowRim).toBe(0);
    expect(airDepth(-4000, false).belowRim).toBe(1);
    expect(airDepth(-4000, false).inShaft).toBe(1);
  });

  /**
   * The bug that shipped: `inShaft` was read off the camera's *framing*, which goes tight
   * for close quarters of any kind — so an ordinary touchdown on an open pad in daylight
   * got the same air as three hundred metres down a bore. A framing is not a place.
   */
  it('is not in a hole merely because the vehicle is near the ground', () => {
    const onAPad = airDepth(2.2, false);

    expect(onAPad.inShaft).toBe(0);
    expect(airTarget(onAPad).density).toBeLessThan(AIR.ABYSS_DENSITY / 2);
  });

  /**
   * `outpost-main` sits below y=0 on six of ten measured seeds, as low as −9.5, and the
   * natural floor reaches −12.9. So "below the canyon floor" cannot be the test for being
   * in a hole — `CANYON.FLOOR_Y` is a nominal baseline, not where the ground is.
   */
  it('is not in a hole merely because the vehicle is below the nominal floor', () => {
    expect(airDepth(-9.5, false).inShaft).toBeLessThan(0.1);
  });

  /**
   * And the converse, which is what the depth ramp alone got wrong: the shared shaft's
   * Helion gallery is only 18–24 units under the floor, and read 0.10–0.13 against a
   * 180-unit ramp — the thin dusty air of the canyon floor, thin enough that a seam in
   * the rock read as background showing through.
   */
  it('is fully in a hole whenever it is under grade, however shallow', () => {
    expect(airDepth(-20, true).inShaft).toBe(1);
    expect(airDepth(-300, true).inShaft).toBe(1);
    expect(airTarget(airDepth(-20, true)).density).toBeCloseTo(AIR.ABYSS_DENSITY, 5);
  });
});

describe('what the air is mixed to', () => {
  it('runs from haze at the rim, through shadow, to the abyss', () => {
    const rim = airTarget(airDepth(CANYON.RIM_Y, false));
    const floor = airTarget(airDepth(CANYON.FLOOR_Y, false));
    const bore = airTarget(airDepth(-100, true));

    expect(rim.density).toBeCloseTo(AIR.HAZE_DENSITY, 5);
    expect(floor.density).toBeCloseTo(AIR.SHADOW_DENSITY, 5);
    expect(bore.density).toBeCloseTo(AIR.ABYSS_DENSITY, 5);
    expect(rim.density).toBeLessThan(floor.density);
    expect(floor.density).toBeLessThan(bore.density);
  });

  /** Never all the way to either colour: the air is dark, not absent. */
  it('never mixes fully to shadow or to black', () => {
    const deepest = airTarget(airDepth(-4000, true));

    expect(deepest.shadowMix).toBeLessThan(1);
    expect(deepest.abyssMix).toBeLessThan(1);
  });
});
