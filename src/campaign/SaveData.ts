import type { Rank } from './Progress.ts';

/**
 * Everything in storage that is not one campaign's own record: the player's
 * preferences, which slot is live, and the campaigns they have already finished.
 *
 * Split out of `Progress` because those three things have different lifetimes. A
 * campaign is discarded when a canyon is rerolled; a preference belongs to the person and
 * the room they are sitting in; a finished playthrough outlives both. Keeping them in one
 * record is what made `reset()` silently unmute somebody's music, which was fixed by
 * carrying three fields across the wipe by hand — a workaround for the split that had not
 * happened yet.
 */

/**
 * The methods this needs from `localStorage`.
 *
 * Narrower than the DOM `Storage` type on purpose: what is wanted is a seam, not a
 * reimplementation of the whole interface. It makes the save format testable without a
 * browser, and leaves room for a backend that is not the local machine.
 *
 * `removeItem` is optional because a store standing in for one does not have to
 * implement it — see `forget`, which degrades to writing an empty string, a value every
 * reader here already treats as absent.
 */
export interface ProgressStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/**
 * `localStorage` is not merely absent in a non-browser context — touching it can throw
 * outright (a sandboxed frame, or Safari with storage blocked). Resolving it behind a
 * try/catch means construction never throws, it only forgets.
 */
export function defaultStore(): ProgressStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read<T>(store: ProgressStore | null, key: string): Partial<T> | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(store: ProgressStore | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full quota. The campaign still plays, it just forgets.
  }
}

function forget(store: ProgressStore | null, key: string): void {
  try {
    if (store?.removeItem) store.removeItem(key);
    else store?.setItem(key, '');
  } catch {
    // As `write`.
  }
}

// ------------------------------------------------------------------ slots

/**
 * How many campaigns can be alive at once.
 *
 * Three rather than more because a slot is a *canyon*, and the whole premise is that a
 * player has one of their own — the number wants to be small enough that picking one is
 * a glance rather than a filing exercise. Raising it costs nothing but menu space.
 */
export const SLOT_COUNT = 3;

const LEGACY_KEY = 'mtm.progress.v1';
const PREFS_KEY = 'mtm.prefs.v1';
const ACTIVE_KEY = 'mtm.active.v1';
const HISTORY_KEY = 'mtm.history.v1';

/**
 * Where a slot's campaign lives.
 *
 * **Slot 0 is the key the game has always used**, unsuffixed, and that is the whole
 * migration: every existing player's campaign is already slot 0 and is neither moved nor
 * rewritten. A format change that relocates records is a format change that can lose
 * them, and this one has never lost anybody's data.
 */
export function slotKey(slot: number): string {
  return slot === 0 ? LEGACY_KEY : `${LEGACY_KEY}.${slot}`;
}

/** Enough of a campaign to draw a slot without loading it. */
export interface SlotSummary {
  slot: number;
  occupied: boolean;
  seed: number | null;
  /** Missions with a rank recorded. */
  delivered: number;
  highestUnlocked: number;
  totalPoints: number;
  lastPlayed: number | null;
}

interface StoredCampaign {
  seed: number;
  highestUnlocked: number;
  ranks: Record<string, Rank>;
  points: Record<string, number>;
  lastPlayed: number;
}

function summarise(store: ProgressStore | null, slot: number): SlotSummary {
  const data = read<StoredCampaign>(store, slotKey(slot));
  if (!data || typeof data.seed !== 'number') {
    return { slot, occupied: false, seed: null, delivered: 0, highestUnlocked: 1, totalPoints: 0, lastPlayed: null };
  }
  const points = data.points ?? {};
  return {
    slot,
    occupied: true,
    seed: data.seed,
    delivered: Object.keys(data.ranks ?? {}).length,
    highestUnlocked: typeof data.highestUnlocked === 'number' ? data.highestUnlocked : 1,
    totalPoints: Object.values(points).reduce((sum, p) => sum + (typeof p === 'number' ? p : 0), 0),
    lastPlayed: typeof data.lastPlayed === 'number' ? data.lastPlayed : null,
  };
}

/**
 * Every slot, occupied or not, in slot order.
 *
 * Read straight from the records rather than from an index of them. The plan this
 * follows proposed an index key "so the menu can render empty ones without parsing every
 * record", and that is a cache: three small `JSON.parse` calls cost nothing measurable,
 * whereas an index is a second copy of the truth that can disagree with it — and the
 * disagreement would be a slot the menu says is empty over a campaign that is not.
 */
export function readSlots(store: ProgressStore | null = defaultStore()): SlotSummary[] {
  const out: SlotSummary[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) out.push(summarise(store, slot));
  return out;
}

/** Which slot the game loads. Out-of-range or unreadable values fall back to slot 0. */
export function activeSlot(store: ProgressStore | null = defaultStore()): number {
  const data = read<{ slot: number }>(store, ACTIVE_KEY);
  const slot = data?.slot;
  return typeof slot === 'number' && slot >= 0 && slot < SLOT_COUNT ? Math.floor(slot) : 0;
}

export function setActiveSlot(store: ProgressStore | null, slot: number): void {
  write(store, ACTIVE_KEY, { slot });
}

/** Discards a slot's campaign outright. The history it was archived into survives. */
export function clearSlot(store: ProgressStore | null, slot: number): void {
  forget(store, slotKey(slot));
}

// ------------------------------------------------------------ preferences

export interface PreferenceData {
  mutedSfx: boolean;
  mutedMusic: boolean;
  invertThrusters: boolean;
}

/**
 * Facts about the person, not about a campaign — kept in one unslotted record.
 *
 * Muting the music in one canyon and having it come back in another is not something
 * anybody would read as intentional, which is the argument for these living outside the
 * slot. The same argument retires the control mapping: how somebody's hands work does not
 * change when they roll a new canyon.
 */
export class Preferences {
  private data: PreferenceData;
  private store: ProgressStore | null;

  constructor(store: ProgressStore | null = defaultStore()) {
    this.store = store;
    this.data = this.load();
  }

  /**
   * Preferences from their own key, or **lifted out of the legacy campaign record**.
   *
   * Every save written before slots existed carries these three fields inside the
   * campaign. Reading them back out on first load is what stops the split from silently
   * resetting a returning player's audio settings, and it is deliberately a copy rather
   * than a move: the fields stay where they were, so a build from before this change
   * still finds them and nothing is destroyed to complete a migration.
   */
  private load(): PreferenceData {
    const own = read<PreferenceData>(this.store, PREFS_KEY);
    const source = own ?? read<PreferenceData>(this.store, LEGACY_KEY) ?? {};
    return {
      mutedSfx: source.mutedSfx === true,
      mutedMusic: source.mutedMusic === true,
      invertThrusters: source.invertThrusters === true,
    };
  }

  get mutedSfx(): boolean {
    return this.data.mutedSfx;
  }

  get mutedMusic(): boolean {
    return this.data.mutedMusic;
  }

  get invertThrusters(): boolean {
    return this.data.invertThrusters;
  }

  set(patch: Partial<PreferenceData>): void {
    this.data = { ...this.data, ...patch };
    write(this.store, PREFS_KEY, this.data);
  }
}

// --------------------------------------------------------------- history

/** One finished — or abandoned — campaign, kept after its slot is gone. */
export interface PlaythroughRecord {
  seed: number;
  /** Missions with a rank recorded when the campaign ended. */
  delivered: number;
  totalPoints: number;
  tally: Record<Rank, number>;
  /** Whether every delivery was flown, as opposed to the canyon being rerolled early. */
  completed: boolean;
  startedAt: number;
  endedAt: number;
}

/**
 * How many finished campaigns are kept.
 *
 * Bounded because this is the one key that would otherwise grow without limit, and
 * localStorage has a quota that fails writes rather than pruning. Newest first, oldest
 * dropped — a player who has finished twenty campaigns is not looking for the first.
 */
export const HISTORY_LIMIT = 20;

export function readHistory(store: ProgressStore | null = defaultStore()): PlaythroughRecord[] {
  const data = read<{ runs: PlaythroughRecord[] }>(store, HISTORY_KEY);
  const runs = data?.runs;
  if (!Array.isArray(runs)) return [];
  return runs.filter((r): r is PlaythroughRecord => !!r && typeof r.seed === 'number');
}

/** Files a campaign, newest first. */
export function appendHistory(store: ProgressStore | null, record: PlaythroughRecord): void {
  const runs = [record, ...readHistory(store)].slice(0, HISTORY_LIMIT);
  write(store, HISTORY_KEY, { runs });
}
