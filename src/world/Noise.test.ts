import { describe, it, expect } from 'vitest';
import { Noise, clamp01, damp, lerp, smoothstep } from './Noise.ts';

/** Samples a function over a grid, for range and mean assertions. */
function sample(f: (x: number, y: number) => number, n = 60, span = 40): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push(f((i / n) * span, (j / n) * span));
    }
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('Noise determinism', () => {
  /**
   * The whole campaign rests on this: the canyon is a pure function of the seed, so a
   * retry after a crash has to rebuild identical terrain.
   */
  it('gives identical output for the same seed', () => {
    const a = new Noise(4242);
    const b = new Noise(4242);

    for (const [x, y] of [[0, 0], [1.5, -3.25], [-100.1, 7], [1e4, 1e4]]) {
      expect(b.value(x, y)).toBe(a.value(x, y));
      expect(b.fbm(x, y)).toBe(a.fbm(x, y));
      expect(b.ridge(x, y)).toBe(a.ridge(x, y));
    }
  });

  it('gives different terrain for different seeds', () => {
    const a = sample((x, y) => new Noise(1).fbm(x, y));
    const b = sample((x, y) => new Noise(2).fbm(x, y));

    expect(a).not.toEqual(b);
  });

  it('truncates its seed to a 32-bit integer', () => {
    // Progress.useSeed already coerces with `| 0`; the constructor does the same, so a
    // fractional seed cannot produce a canyon no saved seed can reproduce.
    expect(new Noise(7.9).seed).toBe(7);
    expect(new Noise(-3.2).seed).toBe(-3);
  });
});

describe('Noise.value', () => {
  it('stays within [0, 1]', () => {
    const noise = new Noise(99);
    const values = sample((x, y) => noise.value(x, y), 80, 60);

    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });

  /**
   * Linear lattice interpolation leaves a derivative discontinuity at every integer
   * line, which reads as grid-aligned creases across the terrain. Smoothstep does not —
   * the slope goes to zero at each lattice line, so crossing one is smooth.
   */
  it('has a continuous derivative across lattice lines', () => {
    const noise = new Noise(5);
    const h = 1e-4;
    const slopeAt = (x: number) => (noise.value(x + h, 0.5) - noise.value(x - h, 0.5)) / (2 * h);

    for (const line of [1, 2, 3, -1, -5]) {
      const before = slopeAt(line - 1e-3);
      const after = slopeAt(line + 1e-3);
      expect(Math.abs(after - before), `lattice line ${line}`).toBeLessThan(0.01);
    }
  });

  it('is continuous in value across lattice lines', () => {
    const noise = new Noise(5);

    for (const line of [1, 7, -4]) {
      const before = noise.value(line - 1e-6, 2.5);
      const after = noise.value(line + 1e-6, 2.5);
      expect(Math.abs(after - before)).toBeLessThan(1e-4);
    }
  });

  it('reproduces the lattice corners exactly at integer coordinates', () => {
    const noise = new Noise(11);

    // smoothstep(0) is 0, so an integer coordinate returns the corner hash untouched.
    expect(noise.value(3, 4)).toBeCloseTo(noise.value(3 + 1e-9, 4 + 1e-9), 8);
  });
});

describe('Noise.fbm', () => {
  /**
   * Summing raw [0,1] octaves gives a signal with a DC bias of ~0.94, which makes every
   * amplitude passed in ~94% vertical offset and ~6% shape. Centring is what makes an
   * amplitude mean what it says.
   */
  it('is centred near zero', () => {
    const noise = new Noise(31);
    const values = sample((x, y) => noise.fbm(x, y), 90, 300);

    expect(Math.abs(mean(values))).toBeLessThan(0.06);
  });

  it('stays within [-1, 1]', () => {
    const noise = new Noise(31);
    const values = sample((x, y) => noise.fbm(x, y), 90, 300);

    expect(Math.min(...values)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });

  it('spans a useful part of its range rather than hugging zero', () => {
    const noise = new Noise(31);
    const values = sample((x, y) => noise.fbm(x, y), 90, 300);

    expect(Math.max(...values)).toBeGreaterThan(0.35);
    expect(Math.min(...values)).toBeLessThan(-0.35);
  });

  it('adds detail with more octaves without leaving the range', () => {
    const noise = new Noise(8);
    const coarse = sample((x, y) => noise.fbm(x, y, 1), 40, 60);
    const fine = sample((x, y) => noise.fbm(x, y, 6), 40, 60);

    expect(fine).not.toEqual(coarse);
    expect(Math.max(...fine)).toBeLessThanOrEqual(1);
    expect(Math.min(...fine)).toBeGreaterThanOrEqual(-1);
  });
});

describe('Noise.ridge', () => {
  it('stays within [-1, 1]', () => {
    const noise = new Noise(17);
    const values = sample((x, y) => noise.ridge(x, y), 90, 300);

    expect(Math.min(...values)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });

  /**
   * Signed, not positive. Shaft.wallOffset takes the absolute value precisely because
   * this returns negatives — using it raw pushed shaft walls into the bore and took six
   * missions unreachable. If ridge ever became one-sided that fix would look redundant
   * and be at risk of removal, so the sign is pinned here.
   */
  it('returns negative values as well as positive ones', () => {
    const noise = new Noise(17);
    const values = sample((x, y) => noise.ridge(x, y), 90, 300);

    expect(Math.min(...values)).toBeLessThan(0);
    expect(Math.max(...values)).toBeGreaterThan(0);
  });
});

describe('scalar helpers', () => {
  it('clamp01 clamps both ends and passes the middle through', () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(9)).toBe(1);
  });

  it('smoothstep is clamped, symmetric and flat at both ends', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(2)).toBe(1);

    // Symmetric about the midpoint.
    expect(smoothstep(0.25) + smoothstep(0.75)).toBeCloseTo(1, 10);

    // Zero slope at both ends, which is what stops a visible crease where it meets a
    // constant region.
    const h = 1e-5;
    expect((smoothstep(h) - smoothstep(0)) / h).toBeLessThan(0.01);
    expect((smoothstep(1) - smoothstep(1 - h)) / h).toBeLessThan(0.01);
  });

  it('lerp hits both endpoints and extrapolates linearly', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 2)).toBe(30);
  });
});

describe('damp', () => {
  /**
   * The invariant the entire fixed-timestep design rests on.
   *
   * Frame-rate-dependent damping makes a 144 Hz player fall at a fraction of the speed
   * of a 30 Hz one. Exponential approach is the reason this game plays the same on both
   * — so a regression to a naive `lerp(current, target, rate * dt)` has to fail loudly.
   */
  it('reaches the same place regardless of how the time is subdivided', () => {
    const total = 1.0;
    const rate = 3.2;

    const once = damp(0, 100, rate, total);

    let many = 0;
    for (let i = 0; i < 1000; i++) many = damp(many, 100, rate, total / 1000);

    expect(many).toBeCloseTo(once, 6);
  });

  it('agrees across a 30 Hz and a 144 Hz frame budget', () => {
    const rate = 5;
    const seconds = 2;

    const step = (hz: number) => {
      let v = 0;
      for (let i = 0; i < hz * seconds; i++) v = damp(v, 1, rate, 1 / hz);
      return v;
    };

    expect(step(144)).toBeCloseTo(step(30), 6);
  });

  it('moves toward the target and never past it', () => {
    expect(damp(0, 10, 2, 0.1)).toBeGreaterThan(0);
    expect(damp(0, 10, 2, 0.1)).toBeLessThan(10);

    // Even an absurd timestep only converges, it does not overshoot.
    expect(damp(0, 10, 2, 1000)).toBeLessThanOrEqual(10);
    expect(damp(10, 0, 2, 1000)).toBeGreaterThanOrEqual(0);
  });

  it('does nothing across zero time', () => {
    expect(damp(3, 99, 4, 0)).toBe(3);
  });

  it('holds still at a zero rate', () => {
    expect(damp(3, 99, 0, 0.5)).toBe(3);
  });
});
