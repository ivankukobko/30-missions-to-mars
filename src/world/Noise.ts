/**
 * Value noise with an integer hash.
 *
 * Two things the previous generator got wrong, fixed here:
 *
 *  1. fbm() is normalised and centred to [-1, 1]. Summing raw [0,1] octaves gives a
 *     signal with a DC bias of ~0.94, so every amplitude you passed in was ~94%
 *     vertical offset and ~6% shape. Amplitudes now mean what they say.
 *  2. Lattice interpolation is smoothstep, not linear. Linear lerp leaves a
 *     derivative discontinuity at every integer lattice line, which reads as
 *     grid-aligned creases across the terrain.
 */
/**
 * The same integer bit-mixing `Noise`'s own lattice hash uses, exposed standalone for
 * callers that want a handful of independent values per integer cell — WFC-style
 * decisions, not terrain — without paying for a `Noise` instance or its smoothstep
 * interpolation. `salt` picks which of several independent values a given (a, b) gets,
 * the same job `Colony.ts`'s per-module sin-hash used to do less reliably: that hash
 * put a fourth term inside one `sin()` call, and two of its salts turned out correlated
 * enough that a downstream probability gate driven by one salt never once fired across
 * 400 real trials, despite the individual salts each looking uniform in isolation. Bit
 * mixing does not have that failure mode.
 */
export function hash01(seed: number, a: number, b: number, salt = 0): number {
  let h =
    Math.imul(a, 374761393) +
    Math.imul(b, 668265263) +
    Math.imul(seed, 1274126177) +
    Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Noise {
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
  }

  /** Integer hash -> [0,1). Avoids the precision drift of sin()-based hashes. */
  private hash(ix: number, iy: number): number {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(this.seed, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /** Value noise in [0,1], C1-continuous. */
  value(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const a = this.hash(ix, iy);
    const b = this.hash(ix + 1, iy);
    const c = this.hash(ix, iy + 1);
    const d = this.hash(ix + 1, iy + 1);

    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }

  /** Fractal noise, normalised and centred to [-1, 1]. */
  fbm(x: number, y: number, octaves = 4): number {
    let v = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      v += this.value(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return (v / norm) * 2 - 1;
  }

  /** Ridged fractal — sharp crests. Used for cliff faces and distant mesas. */
  ridge(x: number, y: number, octaves = 4): number {
    let v = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.value(x * freq, y * freq) * 2 - 1);
      v += n * n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return (v / norm) * 2 - 1;
  }
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential approach.
 * `rate` is the fraction of remaining distance covered per second.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}
