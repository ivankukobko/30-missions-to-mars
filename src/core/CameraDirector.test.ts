import { describe, it, expect } from 'vitest';
import { compensatedVerticalFov } from './CameraDirector.ts';

/** Horizontal FOV, in degrees, a given vertical FOV produces at a given aspect. */
function horizontalFov(vFovDeg: number, aspect: number): number {
  const halfV = (vFovDeg * Math.PI) / 360;
  return (Math.atan(Math.tan(halfV) * aspect) * 360) / Math.PI;
}

const A0 = 1.6;

describe('compensatedVerticalFov', () => {
  it('is the identity at or below the reference aspect', () => {
    expect(compensatedVerticalFov(60, A0)).toBe(60);
    expect(compensatedVerticalFov(50, 1.5)).toBe(50);
    expect(compensatedVerticalFov(80, 1.0)).toBe(80);
  });

  it('holds horizontal FOV to its reference-aspect value once the screen is wider', () => {
    // Every authored keyframe FOV in the director, against a spread of wide screens.
    for (const authored of [48, 50, 54, 60, 80]) {
      const target = horizontalFov(authored, A0);
      for (const aspect of [1.78, 2.0, 2.17, 2.4, 3.2]) {
        const got = compensatedVerticalFov(authored, aspect);
        expect(horizontalFov(got, aspect)).toBeCloseTo(target, 4);
        // And it does so by narrowing the vertical, never widening it.
        expect(got).toBeLessThan(authored);
      }
    }
  });

  it('narrows further the wider the screen gets', () => {
    const wide = compensatedVerticalFov(50, 2.0);
    const wider = compensatedVerticalFov(50, 2.4);
    const widest = compensatedVerticalFov(50, 3.2);
    expect(wider).toBeLessThan(wide);
    expect(widest).toBeLessThan(wider);
  });

  it('lands on the expected vertical FOV for a 19.5:9 phone', () => {
    // Landscape iPhone: aspect ~2.167. The flight lens (~50 deg vertical) comes in to
    // ~38 deg, which is what stops the vehicle reading as tiny in the wide frame.
    expect(compensatedVerticalFov(50, 19.5 / 9)).toBeCloseTo(38, 0);
  });

  it('takes an explicit reference aspect', () => {
    expect(compensatedVerticalFov(50, 1.7, 1.8)).toBe(50);
    expect(compensatedVerticalFov(50, 2.4, 2.4)).toBe(50);
  });
});
