import { describe, expect, it } from 'vitest';
import { describeCrash } from './CrashReport.ts';
import { LANDER } from '../entities/LanderBody.ts';

const upright = 0;
const overTilted = LANDER.MAX_LANDING_TILT * 1.5;

describe('what the failure card says', () => {
  it('names colony hardware as its own kind of failure', () => {
    expect(describeCrash('structure', 0.2, upright).title).toBe('STRUCTURAL COLLISION');
  });

  it('separates a hard landing from a tipped one', () => {
    expect(describeCrash('pad', 9, upright).title).toBe('HARD LANDING');
    expect(describeCrash('pad', 0.2, overTilted).title).toBe('TIPPED ON TOUCHDOWN');
  });

  /**
   * Tilt wins on a pad touchdown that was both. It is the tolerance the player is least
   * likely to have been watching, and the one the reticle was already showing them.
   */
  it('reports the tilt when a pad landing was both too fast and too far over', () => {
    expect(describeCrash('pad', 20, overTilted).title).toBe('TIPPED ON TOUCHDOWN');
  });

  it('distinguishes an impact from an unlucky scrape on open ground', () => {
    expect(describeCrash('rock', 40, upright).title).toBe('IMPACT');
    expect(describeCrash('rock', 1, upright).title).toBe('LANDER DESTROYED');
  });

  it('does not care which way the vehicle leaned', () => {
    expect(describeCrash('pad', 0.2, overTilted)).toEqual(describeCrash('pad', 0.2, -overTilted));
  });
});

/**
 * The reason this is a module rather than a method. Three of the four messages quote a
 * tolerance the simulation enforces somewhere else, and a message that quotes the wrong
 * number is worse than one that quotes none — it tells the player the gear takes 2.5 u/s
 * while the gear takes something else, and nothing anywhere would notice.
 */
describe('the tolerances it quotes', () => {
  it('quotes the landing speed the simulation actually enforces', () => {
    expect(describeCrash('pad', 9, upright).detail).toContain(
      LANDER.MAX_LANDING_SPEED.toFixed(1),
    );
  });

  it('quotes the landing tilt the simulation actually enforces', () => {
    const limit = ((LANDER.MAX_LANDING_TILT * 180) / Math.PI).toFixed(0);
    expect(describeCrash('pad', 0.2, overTilted).detail).toContain(`${limit}°`);
  });

  it('reports the speed the player arrived at, not the limit', () => {
    expect(describeCrash('pad', 9.4, upright).detail).toContain('9.4 u/s');
    expect(describeCrash('rock', 41.7, upright).detail).toContain('41.7 u/s');
  });
});
