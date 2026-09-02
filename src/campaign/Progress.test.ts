import { describe, it, expect } from 'vitest';
import { Progress, scoreLanding, summarise, type ProgressStore, type Rank } from './Progress.ts';
import {
  activeSlot,
  clearSlot,
  Preferences,
  readHistory,
  readSlots,
  setActiveSlot,
  SLOT_COUNT,
  slotKey,
} from './SaveData.ts';

/**
 * In-memory stand-in for localStorage.
 *
 * **Keyed**, which it did not used to be: it held one value and returned it for every
 * key. That was harmless while the campaign was the only thing in storage, and became a
 * trap the moment preferences and history moved to keys of their own — the campaign
 * record would have been handed back as the preferences record, and every test would
 * have passed while testing nothing.
 *
 * `seed` still seeds the campaign key, so an existing test that pre-loads a save reads
 * the same way it always did.
 */
function memoryStore(seed?: string): ProgressStore & { raw(): string | null } {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(CAMPAIGN_KEY, seed);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => {
      values.set(key, next);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    raw: () => values.get(CAMPAIGN_KEY) ?? null,
  };
}

const CAMPAIGN_KEY = slotKey(0);

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

describe('preferences live outside the campaign', () => {
  it('survives rolling a new canyon, which wipes everything else', () => {
    const store = memoryStore();
    const progress = new Progress(store);
    progress.setMutedMusic(true);
    progress.setInvertThrusters(true);
    progress.complete(1, 'S', 90);
    const seed = progress.seed;

    progress.newCanyon();

    expect(progress.audioPrefs.music).toBe(true);
    expect(progress.invertThrusters).toBe(true);
    expect(progress.rankFor(1)).toBeNull();
    expect(progress.seed).not.toBe(seed);
  });

  it('is shared between slots, because it is a fact about the person', () => {
    const store = memoryStore();
    new Progress(store, 0).setMutedSfx(true);

    expect(new Progress(store, 1).audioPrefs.sfx).toBe(true);
  });

  /**
   * The migration that matters. Every save written before slots keeps these three inside
   * the campaign record, and a returning player must not have their settings reset by an
   * update.
   */
  it('lifts settings out of a save written before they moved', () => {
    const store = memoryStore(
      JSON.stringify({ seed: 5, mutedSfx: true, mutedMusic: true, invertThrusters: true }),
    );

    const progress = new Progress(store);
    expect(progress.audioPrefs).toEqual({ sfx: true, music: true });
    expect(progress.invertThrusters).toBe(true);
  });

  /** Copied, not moved: the old fields stay put so nothing is destroyed to migrate. */
  it('leaves the legacy record intact while lifting from it', () => {
    const store = memoryStore(JSON.stringify({ seed: 5, mutedMusic: true }));
    new Preferences(store);

    expect(JSON.parse(store.raw()!).mutedMusic).toBe(true);
  });
});

describe('save slots', () => {
  it('keeps slot 0 on the key the game has always used', () => {
    expect(slotKey(0)).toBe('mtm.progress.v1');
    expect(slotKey(1)).not.toBe(slotKey(0));
  });

  it('holds a separate campaign per slot', () => {
    const store = memoryStore();
    const a = new Progress(store, 0);
    const b = new Progress(store, 1);
    a.complete(1, 'S', 90);
    b.complete(1, 'C', 20);

    expect(new Progress(store, 0).rankFor(1)).toBe('S');
    expect(new Progress(store, 1).rankFor(1)).toBe('C');
    expect(a.seed).not.toBe(b.seed);
  });

  it('reports which slots are occupied, without loading them', () => {
    const store = memoryStore();
    new Progress(store, 1).complete(1, 'A', 70);

    const slots = readSlots(store);
    expect(slots).toHaveLength(SLOT_COUNT);
    expect(slots[0].occupied).toBe(false);
    expect(slots[1].occupied).toBe(true);
    expect(slots[1].delivered).toBe(1);
    expect(slots[1].totalPoints).toBe(70);
    expect(slots[2].occupied).toBe(false);
  });

  it('remembers the live slot, and falls back to 0 when asked for nonsense', () => {
    const store = memoryStore();
    expect(activeSlot(store)).toBe(0);

    setActiveSlot(store, 2);
    expect(activeSlot(store)).toBe(2);

    setActiveSlot(store, 99);
    expect(activeSlot(store)).toBe(0);
  });

  it('discards a slot without touching its neighbours', () => {
    const store = memoryStore();
    new Progress(store, 0).complete(1, 'S', 90);
    new Progress(store, 1).complete(1, 'B', 50);

    clearSlot(store, 1);

    expect(readSlots(store)[0].occupied).toBe(true);
    expect(readSlots(store)[1].occupied).toBe(false);
  });
});

describe('playthrough history', () => {
  function played(store: ProgressStore, runs: number): Progress {
    const progress = new Progress(store);
    for (let id = 1; id <= runs; id++) progress.complete(id, 'A', 70);
    return progress;
  }

  it('files a campaign when its canyon is rerolled', () => {
    const store = memoryStore();
    const progress = played(store, 3);
    const seed = progress.seed;

    progress.newCanyon();

    const history = readHistory(store);
    expect(history).toHaveLength(1);
    expect(history[0].seed).toBe(seed);
    expect(history[0].delivered).toBe(3);
    expect(history[0].totalPoints).toBe(210);
    expect(history[0].completed).toBe(false);
    expect(history[0].tally).toEqual({ S: 0, A: 3, B: 0, C: 0 });
  });

  it('files a completed campaign as completed', () => {
    const store = memoryStore();
    played(store, 2).archive(true);

    expect(readHistory(store)[0].completed).toBe(true);
  });

  /** A campaign completed and then rerolled is one run, not two. */
  it('never files the same campaign twice', () => {
    const store = memoryStore();
    const progress = played(store, 2);
    progress.archive(true);
    progress.archive(true);
    progress.newCanyon();

    expect(readHistory(store)).toHaveLength(1);
  });

  it('does not file a canyon nobody flew', () => {
    const store = memoryStore();
    new Progress(store).newCanyon();

    expect(readHistory(store)).toEqual([]);
  });

  it('keeps the newest first and survives a reroll after a reroll', () => {
    const store = memoryStore();
    const progress = played(store, 1);
    progress.newCanyon();
    progress.complete(1, 'S', 95);
    progress.complete(2, 'S', 95);
    progress.newCanyon();

    const history = readHistory(store);
    expect(history).toHaveLength(2);
    expect(history[0].delivered).toBe(2);
    expect(history[1].delivered).toBe(1);
  });

  it('reads as empty rather than throwing on a corrupt record', () => {
    const store = memoryStore();
    store.setItem('mtm.history.v1', '{ not json');
    expect(readHistory(store)).toEqual([]);
  });
});
