import { describe, expect, it } from 'vitest';
import {
  BOOT_SECONDS,
  DRIFT_FLOOR,
  bootPhase,
  bootSweep,
  clearanceRisk,
  clearanceSplit,
  driftAngle,
  drifting,
  needleOffset,
  pegged,
  settle,
  vectorReach,
} from './Instruments.ts';

describe('needleOffset', () => {
  it('puts zero at the centre of the face', () => {
    expect(needleOffset(0, 3)).toBe(0);
  });

  it('reaches the stop exactly at the span, on both signs', () => {
    expect(needleOffset(3, 3)).toBe(1);
    expect(needleOffset(-3, 3)).toBe(-1);
  });

  it('keeps the two directions mirror images, which is what a crosshair rests on', () => {
    // A sign error here draws a lander sliding left as one sliding right, and the
    // panel would look entirely correct while doing it.
    for (const v of [0.4, 1.1, 2.9]) {
      expect(needleOffset(-v, 3)).toBe(-needleOffset(v, 3));
    }
  });

  it('pegs rather than leaving the dial', () => {
    expect(needleOffset(40, 3)).toBe(1);
    expect(needleOffset(-40, 3)).toBe(-1);
  });

  it('reads zero on a dial with no span rather than dividing by it', () => {
    expect(needleOffset(2, 0)).toBe(0);
  });
});

describe('pegged', () => {
  it('is true only once the reading has run past the dial', () => {
    expect(pegged(2.9, 3)).toBe(false);
    expect(pegged(3, 3)).toBe(true);
    expect(pegged(-9, 3)).toBe(true);
  });
});

describe('clearanceSplit', () => {
  it('reads dead centre as an even split', () => {
    expect(clearanceSplit(6, 6)).toEqual({ left: 0.5, right: 0.5 });
  });

  it('is a position, not a pair of lengths — the same at any bore width', () => {
    // The bore narrows as it descends. Centred has to keep reading centred.
    expect(clearanceSplit(12, 12)).toEqual(clearanceSplit(3, 3));
  });

  it('moves toward the wall it is closer to, and never mirrors it', () => {
    const near = clearanceSplit(2, 10);
    expect(near.left).toBeLessThan(0.5);
    expect(near.right).toBeGreaterThan(0.5);

    const flipped = clearanceSplit(10, 2);
    expect(flipped.left).toBeCloseTo(near.right, 10);
  });

  it('always sums to one, so the bar cannot render a gap', () => {
    for (const [l, r] of [
      [1, 9],
      [7, 0.2],
      [0, 4],
    ]) {
      const s = clearanceSplit(l!, r!);
      expect(s.left + s.right).toBeCloseTo(1, 10);
    }
  });

  it('centres rather than dividing by zero on a degenerate bore', () => {
    expect(clearanceSplit(0, 0)).toEqual({ left: 0.5, right: 0.5 });
  });
});

describe('clearanceRisk', () => {
  it('is zero with the full span to the nearer wall', () => {
    expect(clearanceRisk(8, 8, 8)).toBe(0);
  });

  it('goes to one as the nearer wall arrives', () => {
    expect(clearanceRisk(0, 8, 8)).toBe(1);
  });

  it('reads the tighter side regardless of which side it is', () => {
    expect(clearanceRisk(2, 8, 8)).toBe(clearanceRisk(8, 2, 8));
  });
});

describe('boot', () => {
  it('is a pure function of mission time, so a retry boots identically', () => {
    for (const t of [0, 0.13, 0.5, 0.88, 3]) {
      expect(bootPhase(t)).toBe(bootPhase(t));
      expect(bootSweep(bootPhase(t))).toBe(bootSweep(bootPhase(t)));
    }
  });

  it('runs from dark to live across the boot window', () => {
    expect(bootPhase(0)).toBe(0);
    expect(bootPhase(BOOT_SECONDS)).toBe(1);
    expect(bootPhase(BOOT_SECONDS * 60)).toBe(1);
  });

  it('sweeps the needles out and lets them fall back to rest', () => {
    expect(bootSweep(0)).toBe(0);
    expect(bootSweep(1 / 3)).toBeCloseTo(1, 10);
    expect(bootSweep(1)).toBe(0);
  });

  it('leaves nothing behind once the panel is live', () => {
    // A sweep that never quite reached zero would park every needle off its reading
    // for the rest of the mission.
    expect(bootSweep(1.4)).toBe(0);
  });
});

describe('settle', () => {
  it('closes on the reading rather than snapping to it', () => {
    const first = settle(0, 1, 6, 1 / 60);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
  });

  it('lags further behind on the archaic rate than the modern one', () => {
    // This gap is the entire reason the TD-4 reads as older hardware.
    const old = settle(0, 1, 6, 1 / 60);
    const now = settle(0, 1, 40, 1 / 60);
    expect(old).toBeLessThan(now);
  });

  it('arrives, given time', () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = settle(v, 1, 6, 1 / 60);
    expect(v).toBeCloseTo(1, 6);
  });

  it('holds still when it is already there', () => {
    expect(settle(0.5, 0.5, 6, 1 / 60)).toBeCloseTo(0.5, 12);
  });
});

describe('driftAngle', () => {
  /**
   * The overlay's one genuinely dangerous computation.
   *
   * World +y is up, screen +y is down, and CSS rotates clockwise — three sign
   * conventions meeting on one line. Getting it wrong draws a vehicle falling as one
   * climbing, and the render looks entirely correct while doing it. Hence the compass.
   */
  it('points along the motion in screen space, on every cardinal', () => {
    expect(driftAngle(1, 0)).toBeCloseTo(0, 10); // starboard → right
    expect(driftAngle(0, 1)).toBeCloseTo(-90, 10); // climbing → up the screen
    expect(driftAngle(0, -1)).toBeCloseTo(90, 10); // falling → down the screen

    // Due port comes back as -180 rather than +180, because negating a `vy` of zero
    // gives negative zero and `atan2(-0, -1)` takes the negative branch. The same
    // heading either way, and CSS renders them identically — pinned so that a later
    // normalisation of the output is a deliberate act rather than a surprise.
    expect(Math.abs(driftAngle(-1, 0))).toBeCloseTo(180, 10);
  });

  it('puts a descending drift to starboard in the lower-right quadrant', () => {
    // The commonest way to die in this game, and the case a flipped sign hides.
    const a = driftAngle(1, -1);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(90);
  });

  it('does not care about magnitude, only direction', () => {
    expect(driftAngle(9, -9)).toBeCloseTo(driftAngle(0.2, -0.2), 10);
  });
});

describe('drifting', () => {
  it('ignores motion too slow for its direction to mean anything', () => {
    // At a standstill the velocity angle swings on rounding alone.
    expect(drifting(0, 0)).toBe(false);
    expect(drifting(0.01, -0.01)).toBe(false);
  });

  it('reads the resultant, not either axis alone', () => {
    const each = DRIFT_FLOOR * 0.8;
    expect(drifting(each, 0)).toBe(false);
    expect(drifting(each, -each)).toBe(true);
  });
});

describe('vectorReach', () => {
  it('sits at the minimum when stopped and the maximum at full scale', () => {
    expect(vectorReach(0, 5, 12, 40)).toBe(12);
    expect(vectorReach(5, 5, 12, 40)).toBe(40);
  });

  it('grows with speed rather than jumping', () => {
    expect(vectorReach(2.5, 5, 12, 40)).toBeCloseTo(26, 10);
  });

  it('stops growing past full scale instead of running off the screen', () => {
    expect(vectorReach(90, 5, 12, 40)).toBe(40);
  });
});
