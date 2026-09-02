import { LANDER } from '../entities/LanderBody.ts';

/**
 * What the failure card says, from what the vehicle was doing when it stopped.
 *
 * Pure, and split out of `Game` for one reason: three of the four messages quote a
 * tolerance the simulation enforces elsewhere, and a message that quotes the wrong number
 * is worse than one that quotes none. It tells the player the gear takes 2.5 u/s while
 * the gear takes something else, and nothing anywhere would notice.
 *
 * The order of the tests is the message: a pad touchdown that was both too fast and too
 * far over reports the tilt, because tilt is the one the player is least likely to have
 * been watching and the one the reticle was already showing them.
 */
export interface CrashReport {
  title: string;
  detail: string;
}

/** What the vehicle hit, as `PhysicsWorld` classifies its surfaces. */
export type CrashSurface = 'rock' | 'pad' | 'structure';

/** Above this, ground contact is an impact rather than an unlucky scrape. */
const IMPACT_SPEED = 8;

const degrees = (radians: number): string => ((radians * 180) / Math.PI).toFixed(0);

export function describeCrash(kind: CrashSurface | string, speed: number, tilt: number): CrashReport {
  const lean = Math.abs(tilt);

  if (kind === 'structure') {
    return {
      title: 'STRUCTURAL COLLISION',
      detail:
        'You hit colony hardware. Every beam in this canyon was flown down here by a pilot doing your job.',
    };
  }

  if (kind === 'pad') {
    if (lean > LANDER.MAX_LANDING_TILT) {
      return {
        title: 'TIPPED ON TOUCHDOWN',
        detail: `You reached the pad at ${degrees(lean)}° of tilt. The tolerance is ${degrees(LANDER.MAX_LANDING_TILT)}°.`,
      };
    }
    return {
      title: 'HARD LANDING',
      detail: `Touchdown at ${speed.toFixed(1)} u/s. The gear takes ${LANDER.MAX_LANDING_SPEED.toFixed(1)} u/s and not a fraction more.`,
    };
  }

  if (speed > IMPACT_SPEED) {
    return {
      title: 'IMPACT',
      detail: `Ground contact at ${speed.toFixed(1)} u/s. Start braking higher.`,
    };
  }

  return {
    title: 'LANDER DESTROYED',
    detail: 'Contact with terrain at speed. There is no such thing as a gentle rock here.',
  };
}
