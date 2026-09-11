import {
  activeSlot,
  appendHistory,
  defaultStore,
  Preferences,
  slotKey,
  type PlaythroughRecord,
  type ProgressStore,
} from './SaveData.ts';

export type { ProgressStore };

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
  /**
   * Where the uplink relay ended up: exactly where the player set down in the prologue.
   *
   * The same write-once mechanism as `mastX`/`mastY`, and for the same reason — it is a
   * fixture of this canyon from mission 1 onward, and re-flying the prologue must not
   * move a landmark that thirty missions have entered past.
   *
   * The two are deliberately not merged into one "player placements" structure. They are
   * written at different times by different vehicles, and either can be null while the
   * other is set: a save that predates the prologue has a mast and no relay, which is
   * exactly the case `worldAt` has to render correctly.
   *
   * Null leaves the rim empty rather than guessing a position — the same discipline
   * `mastY` keeps, where a save from before the height was tracked omits it rather than
   * resampling terrain for a plausible-looking answer.
   */
  relayX: number | null;
  relayY: number | null;
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
  /**
   * Muted effects and muted music, kept apart.
   *
   * Two flags rather than one, because they are switched for different reasons: effects
   * off is usually "I am in a quiet room", music off is "I do not like this score". A
   * player who wants the second should not have to take the first — the engine note is
   * the vehicle telling them what it is doing.
   *
   * Preferences rather than campaign state, filed here for the reason `invertThrusters`
   * already gives: there is exactly one place that survives a reload.
   */
  /**
   * Carried for a save written before preferences moved out of the campaign record.
   *
   * Read once by `Preferences` and then left alone — never written, never cleared. They
   * are dead weight in a new record and the only copy in an old one, and deleting them to
   * tidy a migration is how a format loses data.
   */
  mutedSfx: boolean;
  mutedMusic: boolean;
  /** When this canyon was rolled, and when it was last flown. */
  startedAt: number;
  lastPlayed: number;
  /**
   * When this campaign was written into the playthrough history, or null.
   *
   * Guards against filing the same run twice — a campaign is archived both when it is
   * completed and when it is discarded, and a completed campaign that is then discarded
   * would otherwise appear in the history under both headings.
   */
  archivedAt: number | null;
}

const RANK_ORDER: Record<Rank, number> = { C: 0, B: 1, A: 2, S: 3 };

function fresh(): Saved {
  return {
    seed: (Math.random() * 0x7fffffff) | 0,
    mastX: null,
    mastY: null,
    relayX: null,
    relayY: null,
    highestUnlocked: 1,
    ranks: {},
    points: {},
    invertThrusters: false,
    mutedSfx: false,
    mutedMusic: false,
    startedAt: Date.now(),
    lastPlayed: Date.now(),
    archivedAt: null,
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
  /** Which slot this campaign is, and so which key it is written to. */
  readonly slot: number;
  /**
   * The player's own settings, shared by every slot.
   *
   * Held rather than mixed in so that `Progress` can keep the accessors `Game` already
   * calls while the values live outside the campaign record — switching canyons must not
   * change the volume.
   */
  private prefs: Preferences;

  constructor(store: ProgressStore | null = defaultStore(), slot: number = activeSlot(store)) {
    this.store = store;
    this.slot = slot;
    this.prefs = new Preferences(store);
    this.data = this.load();
    // Persist immediately. A freshly rolled seed was previously only written once the
    // player completed a mission, so reloading before the first landing handed them a
    // different canyon every time — and the colony ledger assumes a frozen one.
    this.save();
  }

  private load(): Saved {
    try {
      const raw = this.store?.getItem(slotKey(this.slot));
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
        // Absent in every save written before the prologue existed. The rim stays empty
        // in that case; see the field comment on `Saved.relayX`.
        relayX: typeof parsed.relayX === 'number' ? parsed.relayX : null,
        relayY: typeof parsed.relayY === 'number' ? parsed.relayY : null,
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
        // Absent on every save written before the pause menu, so both default to
        // unmuted — which is what those players already had.
        mutedSfx: parsed.mutedSfx === true,
        mutedMusic: parsed.mutedMusic === true,
        // Absent on every save written before slots. Dating those to now rather than to
        // zero keeps a returning player's campaign at the top of the slot list, which is
        // where it belongs — it is the one they were playing.
        startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now(),
        lastPlayed: typeof parsed.lastPlayed === 'number' ? parsed.lastPlayed : Date.now(),
        archivedAt: typeof parsed.archivedAt === 'number' ? parsed.archivedAt : null,
      };
    } catch {
      return fresh();
    }
  }

  private save(): void {
    try {
      this.store?.setItem(slotKey(this.slot), JSON.stringify(this.data));
    } catch {
      // Private browsing or a full quota. The campaign still plays, it just forgets.
    }
  }

  /** Stamps this campaign as the one most recently flown, for the slot list's ordering. */
  private touch(): void {
    this.data.lastPlayed = Date.now();
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

  get relayX(): number | null {
    return this.data.relayX;
  }

  get relayY(): number | null {
    return this.data.relayY;
  }

  /**
   * Plants the relay. Write-once, exactly like `setMastPosition`.
   *
   * No rank and no points are recorded for the prologue anywhere, and that is not an
   * omission. There is no charter on the other end of this landing to pay for it — the
   * link does not exist yet, which is the whole premise — and `planColonies` spends
   * `progress.points` as a growth budget, so scoring the prologue would quietly make the
   * colony bigger for a delivery nobody commissioned.
   */
  setRelayPosition(x: number, y: number): void {
    if (this.data.relayX !== null) return;
    this.data.relayX = x;
    this.data.relayY = y;
    this.save();
  }

  /**
   * Whether pressing a direction lights the engine on that side rather than the one
   * that pushes you that way. Only meaningful on the twin-engine frame, whose splayed
   * nozzles mean the two are opposites.
   */
  get invertThrusters(): boolean {
    return this.prefs.invertThrusters;
  }

  setInvertThrusters(on: boolean): void {
    this.prefs.set({ invertThrusters: on });
  }

  /** What the pause menu's audio switches were left at. */
  get audioPrefs(): { sfx: boolean; music: boolean } {
    return { sfx: this.prefs.mutedSfx, music: this.prefs.mutedMusic };
  }

  setMutedSfx(muted: boolean): void {
    this.prefs.set({ mutedSfx: muted });
  }

  setMutedMusic(muted: boolean): void {
    this.prefs.set({ mutedMusic: muted });
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
    this.touch();
    this.save();
  }

  /**
   * Files this campaign in the playthrough history, once.
   *
   * Called on both the ways a campaign ends — reaching the last delivery, and being
   * discarded for a new canyon — because both are runs the player made and only one of
   * them is a completion. `archivedAt` is what keeps a campaign that is completed and
   * *then* discarded from being filed under both headings.
   *
   * `completed` is passed in rather than derived here: `Progress` deliberately knows
   * nothing about how many missions the campaign holds, which is `MISSION_COUNT`'s
   * business and would be a dependency on the mission table for one boolean.
   */
  archive(completed: boolean): void {
    if (this.data.archivedAt !== null) return;
    // Nothing was flown. An untouched canyon is not a playthrough, and filing one would
    // put a row in the history every time somebody looked at a fresh slot.
    if (Object.keys(this.data.ranks).length === 0) return;

    const tally: Record<Rank, number> = { S: 0, A: 0, B: 0, C: 0 };
    for (const rank of Object.values(this.data.ranks)) tally[rank]++;

    const record: PlaythroughRecord = {
      seed: this.data.seed,
      delivered: Object.keys(this.data.ranks).length,
      totalPoints: Object.values(this.data.points).reduce((sum, p) => sum + p, 0),
      tally,
      completed,
      startedAt: this.data.startedAt,
      endedAt: Date.now(),
    };
    appendHistory(this.store, record);
    this.data.archivedAt = record.endedAt;
    this.save();
  }

  /**
   * Wipes the campaign.
   *
   * Nothing is carried across any more. This used to hand-copy audio and control
   * settings out of the record and back into a fresh one, on the grounds that they are
   * facts about the person rather than about a run — a correct argument that the record's
   * shape could not express. They now live in their own unslotted key (`Preferences`),
   * so a wipe simply cannot reach them.
   */
  reset(): void {
    this.data = fresh();
    this.save();
  }

  /**
   * Files the campaign being discarded, then rolls a new canyon in the same slot.
   *
   * Preferences no longer need carrying across: they live outside the campaign record
   * entirely, which is what the hand-kept `kept` object here used to stand in for.
   */
  newCanyon(): void {
    this.archive(false);
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

/** What a finished campaign looked like, for the closing card. */
export interface PlaythroughSummary {
  seed: number;
  delivered: number;
  ofTotal: number;
  totalPoints: number;
  averagePoints: number;
  tally: Record<Rank, number>;
  best: { id: number; points: number } | null;
  worst: { id: number; points: number } | null;
}

/**
 * The campaign as a set of figures, read off what `Progress` already stores.
 *
 * A free function rather than a method because it derives and stores nothing — every
 * number here is a fold over `ranks` and `points`. Keeping it out of the class is what
 * lets the closing card be tested without a browser or a save.
 */
export function summarise(progress: Progress, ofTotal: number): PlaythroughSummary {
  const tally: Record<Rank, number> = { S: 0, A: 0, B: 0, C: 0 };
  for (const rank of Object.values(progress.ranks)) tally[rank]++;

  const scored = Object.entries(progress.points).map(([id, points]) => ({ id: Number(id), points }));
  const totalPoints = scored.reduce((sum, m) => sum + m.points, 0);
  // Sorted by points, then by mission id, so a tie reports the same run every time
  // rather than whichever one the object happened to enumerate first.
  const ordered = [...scored].sort((a, b) => b.points - a.points || a.id - b.id);

  return {
    seed: progress.seed,
    delivered: scored.length,
    ofTotal,
    totalPoints,
    averagePoints: scored.length > 0 ? totalPoints / scored.length : 0,
    tally,
    best: ordered[0] ?? null,
    worst: ordered[ordered.length - 1] ?? null,
  };
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
