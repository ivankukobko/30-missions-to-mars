import { describe, expect, it } from 'vitest';
import { cutReached, FALL, identReached, uplinkProgress } from './EpilogueFall.ts';
import { CANYON } from '../world/CanyonSpec.ts';

/** Every mission hands the vehicle over at three seconds. The ending is that, unfinished. */
const HANDOVER_SECONDS = 3;

describe('the handshake that never completes', () => {
  it('starts at nothing and climbs', () => {
    expect(uplinkProgress(0)).toBeCloseTo(0, 5);
    expect(uplinkProgress(1)).toBeGreaterThan(uplinkProgress(0.5));
  });

  /**
   * The point of the sequence. Twenty-nine times the player has felt this bar finish at
   * three seconds and their hands come alive; here it is still visibly short at that
   * moment, so the wrongness starts *before* the expected handover rather than at it.
   */
  it('is visibly behind at the moment every other mission has handed over', () => {
    expect(uplinkProgress(HANDOVER_SECONDS)).toBeLessThan(0.8);
  });

  /**
   * Frozen reads as a bug and invites a reload. It has to keep moving across the window
   * anybody actually watches — the fall lasts on the order of ten seconds — and it has to
   * never arrive.
   *
   * Only the near end is asserted to be still climbing. Past about twenty seconds the
   * exponential has saturated to double precision and two later samples are bit-identical,
   * which is not the bar freezing so much as arithmetic running out of room; the claim
   * worth pinning is the one the player can see.
   */
  it('keeps moving while anyone is watching, and never completes', () => {
    expect(uplinkProgress(5)).toBeGreaterThan(uplinkProgress(HANDOVER_SECONDS));
    expect(uplinkProgress(8)).toBeGreaterThan(uplinkProgress(5));
    expect(uplinkProgress(8)).toBeLessThan(FALL.STALL_AT);
    expect(FALL.STALL_AT).toBeLessThan(1);
  });
});

describe('where the beacon arrives and the picture goes', () => {
  const high = { y: 1000, heightAboveGround: 900 };

  it('does neither while the vehicle is still up in the sky', () => {
    expect(identReached(high)).toBe(false);
    expect(cutReached(high)).toBe(false);
  });

  /**
   * Altitude alone is wrong because the ground is not at `FLOOR_Y`. Mission 29 enters
   * over terrain standing at y≈177 — up on the shoulder — so a test that only watched
   * altitude would drive the vehicle a hundred and thirty units into rock.
   */
  it('cuts on height above ground even when altitude says there is a long way to go', () => {
    expect(cutReached({ y: 177, heightAboveGround: 10 })).toBe(true);
  });

  /**
   * A ground lookup alone is wrong because the ground can fall away. Over the shaft it
   * returns a floor three hundred metres lower, which would make the ending a function
   * of excavation geometry that is still being written.
   */
  it('cuts on altitude even when the ground below has fallen away down a bore', () => {
    expect(cutReached({ y: CANYON.FLOOR_Y + 10, heightAboveGround: 300 })).toBe(true);
  });

  /**
   * The beacon has to lead the cut by the same distance whichever of the two tests ends
   * up firing, which is what makes its airtime a fact rather than an estimate — about
   * three and a half seconds at entry speed, two clear strokes of the five-bar word and a
   * third cut off.
   */
  it('leads the cut by the same fall on both measures', () => {
    expect(FALL.IDENT_Y - FALL.CUT_Y).toBe(FALL.SIGNAL_RUN);
    expect(FALL.IDENT_HEIGHT - FALL.CUT_HEIGHT).toBe(FALL.SIGNAL_RUN);
  });

  it('always arrives before the picture goes, on either measure', () => {
    const byAltitude = { y: FALL.IDENT_Y - 1, heightAboveGround: 900 };
    const byGround = { y: 1000, heightAboveGround: FALL.IDENT_HEIGHT - 1 };

    for (const at of [byAltitude, byGround]) {
      expect(identReached(at)).toBe(true);
      expect(cutReached(at)).toBe(false);
    }
  });

  /** Both tests take whichever comes first, so either one alone is enough to end it. */
  it('cuts as soon as either measure says so', () => {
    expect(cutReached({ y: FALL.CUT_Y - 1, heightAboveGround: 900 })).toBe(true);
    expect(cutReached({ y: 1000, heightAboveGround: FALL.CUT_HEIGHT - 1 })).toBe(true);
  });
});
