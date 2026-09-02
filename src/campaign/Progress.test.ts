import { describe, it, expect } from 'vitest';
import { Progress, scoreLanding, summarise, type ProgressStore, type Rank } from './Progress.ts';

/** In-memory stand-in for localStorage. */
function memoryStore(seed?: string): ProgressStore & { raw(): string | null } {
  let value: string | null = seed ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    raw: () => value,
  };
}

/** A store that throws on every access, like Safari with storage blocked. */
const hostileStore: ProgressStore = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('Progress persistence', () => {
  it('rolls a seed and writes it before the first landing', () => {
    const store = memoryStore();
    const progress = new Progress(store);

    // The whole colony ledger assumes a frozen canyon, so the seed has to survive a
    // reload that happens before any mission completes.
    expect(store.raw()).not.toBeNull();
    expect(JSON.parse(store.raw()!).seed).toBe(progress.seed);
  });

  it('restores a saved campaign', () => {
    const saved = JSON.stringify({
      seed: 12345,
      mastX: -7.5,
      mastY: 3.25,
      highestUnlocked: 9,
      ranks: { '3': 'A' },
    });
    const progress = new Progress(memoryStore(saved));

    expect(progress.seed).toBe(12345);
    expect(progress.mastX).toBe(-7.5);
    expect(progress.mastY).toBe(3.25);
    expect(progress.highestUnlocked).toBe(9);
    expect(progress.rankFor(3)).toBe('A');
    expect(progress.rankFor(4)).toBeNull();
  });

  it('reads a mastX with no mastY as null, not a crash', () => {
    // Every save written before this fix: mastX from a completed mission 1, and no
    // recorded height because nothing recorded one yet. buildRadar's fallback is what
    // makes this safe rather than merely non-throwing — see `Prop`'s radar variant.
    const saved = JSON.stringify({ seed: 1, mastX: -7.5, highestUnlocked: 9, ranks: {} });
    const progress = new Progress(memoryStore(saved));

    expect(progress.mastX).toBe(-7.5);
    expect(progress.mastY).toBeNull();
  });

  it('falls back to a fresh campaign on unparseable data', () => {
    const progress = new Progress(memoryStore('{ not json'));

    expect(Number.isFinite(progress.seed)).toBe(true);
    expect(progress.highestUnlocked).toBe(1);
    expect(progress.mastX).toBeNull();
  });

  it('falls back to a fresh campaign when the seed is missing or the wrong type', () => {
    expect(new Progress(memoryStore('{"highestUnlocked":12}')).highestUnlocked).toBe(1);
    expect(new Progress(memoryStore('{"seed":"abc"}')).highestUnlocked).toBe(1);
  });

  it('defaults individual fields that are present but the wrong type', () => {
    const progress = new Progress(
      memoryStore('{"seed":7,"mastX":"nowhere","mastY":"nowhere","highestUnlocked":null}'),
    );

    expect(progress.seed).toBe(7);
    expect(progress.mastX).toBeNull();
    expect(progress.mastY).toBeNull();
    expect(progress.highestUnlocked).toBe(1);
  });

  it('still plays when storage throws on both read and write', () => {
    // Private browsing or a full quota: the campaign forgets, it does not crash.
    const progress = new Progress(hostileStore);

    expect(() => progress.complete(1, 'A', 70)).not.toThrow();
    expect(progress.rankFor(1)).toBe('A');
  });

  it('works with no storage at all', () => {
    const progress = new Progress(null);

    expect(() => progress.complete(1, 'S', 90)).not.toThrow();
    expect(progress.highestUnlocked).toBe(2);
  });
});

describe('Progress.setMastPosition', () => {
  /**
   * The mast is a parameter of the world from mission 2 onward. If replaying mission 1
   * could move it, twenty-nine missions of layout would shift under a player who only
   * wanted a better rank on the first one.
   */
  it('is write-once', () => {
    const progress = new Progress(memoryStore());

    progress.setMastPosition(-14, 6.2);
    progress.setMastPosition(60, -3);

    expect(progress.mastX).toBe(-14);
    expect(progress.mastY).toBe(6.2);
  });

  it('accepts a mast at exactly zero, on either axis', () => {
    const progress = new Progress(memoryStore());

    progress.setMastPosition(0, 0);

    // Guarded on `!== null`, not on falsiness — landing at (0, 0) is a legal place to
    // plant the radar and must not read as "not yet planted".
    expect(progress.mastX).toBe(0);
    expect(progress.mastY).toBe(0);
    progress.setMastPosition(25, 9);
    expect(progress.mastX).toBe(0);
    expect(progress.mastY).toBe(0);
  });
});

describe('Progress.complete', () => {
  it('keeps the best rank achieved, never a worse retry', () => {
    const progress = new Progress(memoryStore());

    progress.complete(4, 'B', 50);
    expect(progress.rankFor(4)).toBe('B');

    progress.complete(4, 'S', 90);
    expect(progress.rankFor(4)).toBe('S');

    progress.complete(4, 'C', 20);
    expect(progress.rankFor(4)).toBe('S');
  });

  it('unlocks the next mission and never walks the unlock backwards', () => {
    const progress = new Progress(memoryStore());

    progress.complete(1, 'C', 20);
    expect(progress.highestUnlocked).toBe(2);

    progress.complete(7, 'A', 70);
    expect(progress.highestUnlocked).toBe(8);

    progress.complete(2, 'S', 90); // replaying an earlier mission
    expect(progress.highestUnlocked).toBe(8);
  });

  it('survives a round trip through storage', () => {
    const store = memoryStore();
    const first = new Progress(store);
    first.setMastPosition(3.5, -1.8);
    first.complete(1, 'A', 70);

    const second = new Progress(store);

    expect(second.seed).toBe(first.seed);
    expect(second.mastX).toBe(3.5);
    expect(second.mastY).toBe(-1.8);
    expect(second.rankFor(1)).toBe('A');
    expect(second.highestUnlocked).toBe(2);
  });
});

describe('Progress.useSeed', () => {
  it('changes the canyon without wiping unlocks or ranks', () => {
    const progress = new Progress(memoryStore());
    progress.complete(5, 'S', 90);

    progress.useSeed(999);

    expect(progress.seed).toBe(999);
    expect(progress.rankFor(5)).toBe('S');
    expect(progress.highestUnlocked).toBe(6);
  });

  it('coerces to a 32-bit integer, matching what Noise consumes', () => {
    const progress = new Progress(memoryStore());

    progress.useSeed(12.9);

    expect(progress.seed).toBe(12);
  });
});

describe('scoreLanding', () => {
  const CAPACITY = 400;

  /** A landing on a pad: full fuel, feather touchdown, dead centre = 100 points. */
  it('awards a perfect pad landing every available point', () => {
    const score = scoreLanding(CAPACITY, CAPACITY, 0, 0, 8);

    expect(score.points).toBe(100);
    expect(score.rank).toBe('S');
  });

  it('awards a perfect open-ground landing 100 as well', () => {
    // The centring weight is redistributed, not given away — otherwise the one mission
    // flown without a pad would be the easiest S in the campaign.
    const score = scoreLanding(CAPACITY, CAPACITY, 0, 0, null);

    expect(score.points).toBe(100);
  });

  it('scores fuel as the dominant term', () => {
    const full = scoreLanding(CAPACITY, CAPACITY, 0, 0, 8).points;
    const half = scoreLanding(CAPACITY / 2, CAPACITY, 0, 0, 8).points;

    expect(full - half).toBe(30); // 60% weight, halved
  });

  it('treats anything under 0.6 u/s as a kiss', () => {
    expect(scoreLanding(0, CAPACITY, 0, 0, 8).points).toBe(
      scoreLanding(0, CAPACITY, 0.6, 0, 8).points,
    );
  });

  it('gives no softness points at the outer edge of survivable', () => {
    // 0.6 + 1.9 = 2.5, which is LANDER.MAX_LANDING_SPEED.
    const score = scoreLanding(CAPACITY, CAPACITY, 2.5, 0, 8);

    expect(score.points).toBe(75); // 60 fuel + 0 softness + 15 centring
  });

  it('gives no centring points at or beyond the pad edge', () => {
    const centred = scoreLanding(0, CAPACITY, 0, 0, 8).points;
    const atEdge = scoreLanding(0, CAPACITY, 0, 8, 8).points;
    const wayOff = scoreLanding(0, CAPACITY, 0, 40, 8).points;

    expect(centred - atEdge).toBe(15); // the whole centring weight
    expect(wayOff).toBe(atEdge); // and it does not go negative past the edge
  });

  it('never returns a negative score however bad the landing', () => {
    const score = scoreLanding(0, CAPACITY, 99, 999, 8);

    expect(score.points).toBe(0);
    expect(score.rank).toBe('C');
  });

  it('does not divide by zero on a zero-capacity tank', () => {
    const score = scoreLanding(0, 0, 0, 0, 8);

    expect(Number.isFinite(score.points)).toBe(true);
    expect(score.fuelPct).toBe(0);
  });

  it('does not divide by zero on a zero-width pad', () => {
    const score = scoreLanding(0, CAPACITY, 0, 0, 0);

    expect(Number.isFinite(score.points)).toBe(true);
  });

  /**
   * Builds a landing worth exactly `points`, using fuel as the dial.
   *
   * Fuel is the only continuous term (60 points over the tank). Softness and centring
   * are pinned to either full or nothing, which brackets the dial into 40..100 or
   * 0..60 — between them every score in range is reachable exactly.
   */
  const landingWorth = (points: number) => {
    const perfect = points >= 40;
    const fromFuel = perfect ? points - 40 : points;
    return scoreLanding(
      (fromFuel / 60) * CAPACITY,
      CAPACITY,
      perfect ? 0 : 2.5, // 2.5 u/s is exactly zero softness
      perfect ? 0 : 8, // at the pad edge, exactly zero centring
      8,
    );
  };

  it.each([
    [100, 'S'],
    [82, 'S'],
    [81, 'A'],
    [66, 'A'],
    [65, 'B'],
    [45, 'B'],
    [44, 'C'],
    [0, 'C'],
  ])('ranks %i points as %s', (points, rank) => {
    const score = landingWorth(points);

    expect(score.points).toBe(points);
    expect(score.rank).toBe(rank as Rank);
  });

  it('reports back the inputs it was scored on', () => {
    const score = scoreLanding(200, CAPACITY, 1.25, 3.5, 8);

    expect(score.fuelPct).toBeCloseTo(0.5, 6);
    expect(score.touchdownSpeed).toBe(1.25);
    expect(score.offset).toBe(3.5);
  });
});

describe('summarise', () => {
  function flown(entries: Array<[number, Rank, number]>): Progress {
    const progress = new Progress(memoryStore());
    for (const [id, rank, points] of entries) progress.complete(id, rank, points);
    return progress;
  }

  it('folds the campaign into the figures the closing card shows', () => {
    const summary = summarise(flown([[1, 'S', 90], [2, 'B', 50], [3, 'A', 70]]), 30);

    expect(summary.delivered).toBe(3);
    expect(summary.ofTotal).toBe(30);
    expect(summary.totalPoints).toBe(210);
    expect(summary.averagePoints).toBeCloseTo(70, 5);
    expect(summary.tally).toEqual({ S: 1, A: 1, B: 1, C: 0 });
    expect(summary.best).toEqual({ id: 1, points: 90 });
    expect(summary.worst).toEqual({ id: 2, points: 50 });
  });

  /** Two runs on the same score must not report a different "best" between two openings
   *  of the same card — the fold is over an object, whose order is not a guarantee. */
  it('breaks a tie on mission id, so the same card reports the same run twice', () => {
    const a = summarise(flown([[5, 'A', 70], [2, 'A', 70]]), 30);
    const b = summarise(flown([[2, 'A', 70], [5, 'A', 70]]), 30);
    expect(a.best).toEqual({ id: 2, points: 70 });
    expect(b.best).toEqual(a.best);
  });

  it('reports an untouched campaign without dividing by zero', () => {
    const summary = summarise(new Progress(memoryStore()), 30);
    expect(summary.delivered).toBe(0);
    expect(summary.averagePoints).toBe(0);
    expect(summary.best).toBeNull();
    expect(summary.worst).toBeNull();
  });
});
