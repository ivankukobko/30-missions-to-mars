export type Rank = 'S' | 'A' | 'B' | 'C';

export interface LandingScore {
  rank: Rank;
  points: number;
  fuelPct: number;
  touchdownSpeed: number;
  offset: number;
}

interface Saved {
  /** The player's canyon. Rolled once, then frozen for the whole campaign. */
  seed: number;
  /**
   * Where the navigation radar ended up: exactly where the player set down in mission 1.
   *
   * This is a second seed value, rolled by flying instead of by RNG. It is written
   * once, never revised, and the world stays a pure function of (seed, mastX, mission)
   * — so a retry still rebuilds an identical canyon. Null until mission 1 is flown.
   *
   * `mastY` is the touchdown height itself rather than a height resampled from terrain,
   * and that distinction is the whole reason it exists. The radar used to be drawn at
   * `canyon.heightAt(mastX, RADAR.Z)` — the ground at the *mast's* z, not the lander's.
   * The canyon meanders, so the two cross-sections disagree, and depending on the seed
   * that gap buried the mast's base in rock or left it standing on air. Storing the
   * settled `lander.y` from the actual landing removes the resample entirely: mission
   * 1's brief promises "where you land is where it stays," and this is what makes that
   * literally true rather than approximately true.
   */
  mastX: number | null;
  mastY: number | null;
  highestUnlocked: number;
  ranks: Record<string, Rank>;
  /**
   * Best landing points per mission, 0–100 — the same number `scoreLanding` already
   * computes and used to discard once it had picked a rank from it.
   *
   * Kept alongside the rank rather than instead of it because the two answer different
   * questions. A rank is what the player is told; points are what the colony is paid in,
   * and a bucket is far too coarse for that: a 46-point landing and a 65-point landing are
   * both a B, and under the old scheme they bought a charter exactly the same amount of
   * building. Thirty missions of that is a campaign where flying materially better than
   * "good enough for the bucket" changes nothing you can see.
   */
  points: Record<string, number>;
  /**
   * Whether a direction input drives the engine on its own side. A preference rather
   * than campaign state, but it belongs to the player and there is exactly one place
   * that already survives a reload — see `invertThrusters`.
   */
  invertThrusters: boolean;
}

const KEY = 'mtm.progress.v1';

const RANK_ORDER: Record<Rank, number> = { C: 0, B: 1, A: 2, S: 3 };

/**
 * The two methods this class needs from `localStorage`.
 *
 * Narrower than the DOM `Storage` type on purpose: what is wanted is a seam, not a
 * reimplementation of the whole interface. It makes the save format testable without a
 * browser, and leaves room for a backend that is not the local machine.
 */
export interface ProgressStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * `localStorage` is not merely absent in a non-browser context — touching it can throw
 * outright (a sandboxed frame, or Safari with storage blocked). Resolving it behind a
 * try/catch means constructing `Progress` never throws, it only forgets.
 */
function defaultStore(): ProgressStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function fresh(): Saved {
  return {
    seed: (Math.random() * 0x7fffffff) | 0,
    mastX: null,
    mastY: null,
    highestUnlocked: 1,
    ranks: {},
    points: {},
    invertThrusters: false,
  };
}

/** The lowest score that still earns each rank — see `scoreLanding`'s own thresholds,
 *  which this has to agree with. */
const RANK_FLOOR: Record<Rank, number> = { S: 82, A: 66, B: 45, C: 0 };

/**
 * Campaign state in localStorage. The seed lives here because the canyon layout is
 * per-player — everyone gets their own chasm, then keeps it for all thirty missions
 * so the colony ledger stays coherent.
 */
export class Progress {
  private data: Saved;
  private store: ProgressStore | null;

  constructor(store: ProgressStore | null = defaultStore()) {
    this.store = store;
    this.data = this.load();
    // Persist immediately. A freshly rolled seed was previously only written once the
    // player completed a mission, so reloading before the first landing handed them a
    // different canyon every time — and the colony ledger assumes a frozen one.
    this.save();
  }

  private load(): Saved {
    try {
      const raw = this.store?.getItem(KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as Partial<Saved>;
      if (typeof parsed.seed !== 'number') return fresh();
      return {
        seed: parsed.seed,
        mastX: typeof parsed.mastX === 'number' ? parsed.mastX : null,
        // Absent in every save written before this fix, including ones with a mastX
        // already set from a completed mission 1. Those fall back to null, and
        // `buildRadar` keeps its old heightAt-based estimate for exactly that case —
        // there is no landing to recover after the fact, only a future one to record.
        mastY: typeof parsed.mastY === 'number' ? parsed.mastY : null,
        highestUnlocked: typeof parsed.highestUnlocked === 'number' ? parsed.highestUnlocked : 1,
        ranks: parsed.ranks ?? {},
        /**
         * Backfilled from ranks on any save written before points were kept, at the floor
         * of the rank earned. Deliberately the floor and not the midpoint: it is the only
         * figure the stored rank actually guarantees, so a returning player's colony can
         * only grow when they re-fly a mission, never shrink because the estimate was
         * generous. Every save this change lands on takes this path.
         */
        points: parsed.points ?? Object.fromEntries(Object.entries(parsed.ranks ?? {}).map(([id, r]) => [id, RANK_FLOOR[r]])),
        // Absent in saves written before the second airframe existed, which is every
        // save this change lands on. Default rather than discard the whole record.
        invertThrusters: parsed.invertThrusters === true,
      };
    } catch {
      return fresh();
    }
  }

  private save(): void {
    try {
      this.store?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Private browsing or a full quota. The campaign still plays, it just forgets.
    }
  }

  get seed(): number {
    return this.data.seed;
  }

  get highestUnlocked(): number {
    return this.data.highestUnlocked;
  }

  /** Where the radar stands, or null if mission 1 has not been flown on this save. */
  get mastX(): number | null {
    return this.data.mastX;
  }

  /**
   * The exact height it was planted at, or null on a save from before this was tracked
   * — see the field comment on `Saved.mastY` for what that null means downstream.
   */
  get mastY(): number | null {
    return this.data.mastY;
  }

  /**
   * Plants the radar. Deliberately write-once: the mast is a fixture of the player's
   * canyon from mission 2 on, and replaying mission 1 must not move a structure that
   * twenty-nine later missions have been flown around.
   */
  setMastPosition(x: number, y: number): void {
    if (this.data.mastX !== null) return;
    this.data.mastX = x;
    this.data.mastY = y;
    this.save();
  }

  /**
   * Whether pressing a direction lights the engine on that side rather than the one
   * that pushes you that way. Only meaningful on the twin-engine frame, whose splayed
   * nozzles mean the two are opposites.
   */
  get invertThrusters(): boolean {
    return this.data.invertThrusters;
  }

  setInvertThrusters(on: boolean): void {
    this.data.invertThrusters = on;
    this.save();
  }

  rankFor(missionId: number): Rank | null {
    return this.data.ranks[String(missionId)] ?? null;
  }

  /** The full best-rank-per-mission record — for the UI, which reports a letter. */
  get ranks(): Readonly<Record<string, Rank>> {
    return this.data.ranks;
  }

  /** The full best-points-per-mission record — for `planColonies`, which pays a charter
   *  in cells and needs the real figure rather than its bucket. */
  get points(): Readonly<Record<string, number>> {
    return this.data.points;
  }

  /**
   * Records a completed mission, keeping the best of each measure.
   *
   * Rank and points are kept independently rather than one derived from the other. They
   * cannot disagree in a way that matters — the thresholds are monotonic in points — and
   * writing both means neither has to be reconstructed from the other later.
   */
  complete(missionId: number, rank: Rank, points: number): void {
    const existing = this.rankFor(missionId);
    if (!existing || RANK_ORDER[rank] > RANK_ORDER[existing]) {
      this.data.ranks[String(missionId)] = rank;
    }
    const best = this.data.points[String(missionId)];
    if (best === undefined || points > best) {
      this.data.points[String(missionId)] = points;
    }
    if (missionId + 1 > this.data.highestUnlocked) {
      this.data.highestUnlocked = missionId + 1;
    }
    this.save();
  }

  reset(): void {
    this.data = fresh();
    this.save();
  }

  /** Re-rolls the canyon and starts the campaign over. */
  newCanyon(): void {
    this.reset();
  }

  /**
   * Pins the canyon to a chosen seed, leaving unlocks and ranks alone. This is for the
   * inspector: reproducing a layout someone reported should not also wipe their
   * campaign, which is what going through `reset` would do.
   */
  useSeed(seed: number): void {
    this.data.seed = seed | 0;
    this.save();
  }
}

/**
 * Scores a touchdown. Fuel economy dominates, because that is the skill the game
 * actually teaches: a clean line burns less than a corrected one.
 *
 * `padHalfWidth` is null for a landing on open ground, where there is no centre to be
 * off. Rather than award the centring points for free — which would make the one
 * mission flown without a pad the easiest S in the campaign — that weight is
 * redistributed onto the two things such a landing does still measure.
 */
export function scoreLanding(
  fuelRemaining: number,
  fuelCapacity: number,
  touchdownSpeed: number,
  offsetFromCentre: number,
  padHalfWidth: number | null,
): LandingScore {
  const fuelPct = fuelCapacity > 0 ? fuelRemaining / fuelCapacity : 0;
  const openGround = padHalfWidth === null;

  const fuelPoints = fuelPct * (openGround ? 70 : 60);
  // Under 0.6 u/s is a kiss; 2.5 is the outer edge of survivable.
  const softness = Math.max(0, 1 - Math.max(0, touchdownSpeed - 0.6) / 1.9);
  const softPoints = softness * (openGround ? 30 : 25);
  const centring = openGround
    ? 0
    : Math.max(0, 1 - offsetFromCentre / Math.max(0.001, padHalfWidth));
  const centrePoints = centring * 15;

  const points = Math.round(fuelPoints + softPoints + centrePoints);
  const rank: Rank = points >= 82 ? 'S' : points >= 66 ? 'A' : points >= 45 ? 'B' : 'C';

  return { rank, points, fuelPct, touchdownSpeed, offset: offsetFromCentre };
}
