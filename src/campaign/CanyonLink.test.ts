import { describe, expect, it } from 'vitest';
import { hashFor, parseSharedSeed } from './CanyonLink.ts';

/**
 * The hash is a contract between a link written in one session and a boot in another, so
 * what matters is what a *hostile* string does — a truncated paste, a hand-typed number,
 * a hash that belongs to something else entirely. A seed that survives parsing goes
 * straight into `CanyonGenerator` and decides thirty missions of layout.
 */
describe('parseSharedSeed', () => {
  it('round-trips a seed through the hash it writes', () => {
    expect(parseSharedSeed(hashFor(1895309088))).toBe(1895309088);
  });

  it('reads a hash with or without its leading #', () => {
    expect(parseSharedSeed('#canyon=42')).toBe(42);
    expect(parseSharedSeed('canyon=42')).toBe(42);
  });

  it('accepts both ends of the range Progress rolls', () => {
    expect(parseSharedSeed('#canyon=0')).toBe(0);
    expect(parseSharedSeed(`#canyon=${0x7fffffff}`)).toBe(0x7fffffff);
  });

  it('ignores a hash that carries no canyon', () => {
    expect(parseSharedSeed('')).toBeNull();
    expect(parseSharedSeed('#')).toBeNull();
    expect(parseSharedSeed('#patch=lander&v=2')).toBeNull();
  });

  it('finds the seed beside other hash keys rather than demanding it be alone', () => {
    expect(parseSharedSeed('#from=abc&canyon=7')).toBe(7);
  });

  /**
   * `parseInt('12x')` is 12. Using it here would have generated canyon 12 for a link that
   * lost its tail in a chat client and reported nothing wrong — a whole campaign in a
   * chasm nobody shared.
   */
  it('discards a number with a tail rather than truncating to it', () => {
    expect(parseSharedSeed('#canyon=12x')).toBeNull();
    expect(parseSharedSeed('#canyon=1e9')).toBeNull();
  });

  it('discards anything outside the range a seed can be', () => {
    expect(parseSharedSeed('#canyon=-1')).toBeNull();
    expect(parseSharedSeed('#canyon=2147483648')).toBeNull();
    expect(parseSharedSeed('#canyon=1.5')).toBeNull();
    expect(parseSharedSeed('#canyon=NaN')).toBeNull();
    expect(parseSharedSeed('#canyon=')).toBeNull();
    expect(parseSharedSeed('#canyon=%20')).toBeNull();
  });
});
