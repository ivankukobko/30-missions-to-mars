import { CAMPAIGN_FLIGHTS, EPILOGUE_ID, MISSION_COUNT } from '../campaign/Missions.ts';
import { Progress } from '../campaign/Progress.ts';
import {
  readHistory,
  readSlots,
  setActiveSlot,
  SLOT_COUNT,
  type ProgressStore,
} from '../campaign/SaveData.ts';
import type { GameSettings, Interface } from '../ui/Interface.ts';

/**
 * Every screen the player reaches without flying: the main menu, the mission grid, the
 * canyons, the history, the settings, and the one confirmation.
 *
 * Split out of `Game` because none of it is the simulation. It reads the save, formats
 * rows and calls back into the host to change what is loaded — no physics, no frame loop,
 * no renderer beyond the camera parking `presentBackdrop` does. What is left in `Game` is
 * the loop and the mission, which is the line the module layout is drawn along
 * everywhere else.
 *
 * `pause`/`resume` deliberately stay behind. They look like menu screens and are not:
 * they belong to a flight in progress, they stop the engine note and take the console
 * down, and the pause overlay is the one panel that shows the manifest.
 */
export interface MenuHost {
  readonly ui: Interface;
  readonly store: ProgressStore | null;
  /** Replaced outright when the player switches canyon. */
  progress: Progress;
  /** How deep into the menu the player is, so Escape steps back one screen at a time. */
  menuDepth: number;
  /** Builds a mission's world without presenting its brief — what the menu sits over. */
  loadWorld(id: number): void;
  /** Into a mission proper, through its brief. */
  enterMission(id: number): void;
  /** Throws away the canyon generator and builds one for whatever seed is current. */
  rebuildCanyon(): void;
  /** The settings block's live view of what is stored. */
  settings(): GameSettings;
  /** Menu state: camera on the canyon, vehicle and console out of sight. */
  presentBackdrop(): void;
}

export class MenuController {
  private host: MenuHost;

  constructor(host: MenuHost) {
    this.host = host;
  }

  private get progress(): Progress {
    return this.host.progress;
  }

  /** All twenty-nine deliveries flown, so the ending is unlocked. */
  campaignDone(): boolean {
    return this.progress.highestUnlocked > MISSION_COUNT;
  }

  /**
   * Flights behind the player, out of `CAMPAIGN_FLIGHTS`.
   *
   * The ending counts as one, and it is derived rather than recorded: landing mission 29
   * unlocks it and the result card's ordinary `NEXT MISSION` runs it, so `highestUnlocked`
   * past the last mission already says the campaign is done. Counting ranked missions
   * alone left a finished save reporting 29/30 forever.
   */
  private flownCount(): number {
    return Object.keys(this.progress.ranks).length + (this.campaignDone() ? 1 : 0);
  }

  private historyDetail(): string {
    const runs = readHistory(this.host.store).length;
    return runs === 0 ? 'NONE' : `${runs} RUN${runs === 1 ? '' : 'S'}`;
  }

  /**
   * The main menu, over the player's own canyon.
   *
   * The world behind it is real — this is entered after a world load, so what the menu
   * sits on is this save's seed and this save's colony, grown to wherever the player has
   * reached. A menu over a black page would have been less work and would have thrown
   * away the one thing this game generates that is theirs.
   */
  open(): void {
    this.host.menuDepth = 0;
    this.host.presentBackdrop();

    /**
     * Once every delivery is flown there is still one flight left, so CONTINUE points at
     * the ending rather than parking on mission 29 for the rest of the save's life. It
     * stays there afterwards: the epilogue is replayable, and a finished campaign
     * offering CONTINUE → MISSION 29 reads as though something is still owed.
     */
    const done = this.campaignDone();
    const next = done ? EPILOGUE_ID : this.progress.highestUnlocked;

    this.host.ui.showMenu([
      {
        label: 'CONTINUE',
        detail: done ? 'EPILOGUE' : `MISSION ${String(next).padStart(2, '0')}`,
        onSelect: () => this.host.enterMission(next),
      },
      {
        label: 'MISSIONS',
        detail: `${this.flownCount()} / ${CAMPAIGN_FLIGHTS}`,
        onSelect: () => this.openMissions(),
      },
      {
        label: 'CANYONS',
        detail: `${this.progress.slot + 1} OF ${SLOT_COUNT}`,
        onSelect: () => this.openSlots(),
      },
      { label: 'HISTORY', detail: this.historyDetail(), onSelect: () => this.openHistory() },
      { label: 'SETTINGS', onSelect: () => this.openSettings() },
      { label: 'NEW CANYON', danger: true, onSelect: () => this.confirmNewCanyon() },
    ]);
  }

  private openMissions(): void {
    this.host.menuDepth = 1;
    this.host.ui.showMissions(
      Math.min(this.progress.highestUnlocked, CAMPAIGN_FLIGHTS),
      (id) => this.progress.rankFor(id),
      CAMPAIGN_FLIGHTS,
      (id) => this.host.enterMission(id),
      () => this.open(),
      EPILOGUE_ID,
    );
  }

  /**
   * The player's campaigns, one canyon each.
   *
   * A slot is a canyon rather than a save file, which is why the row reports the seed: it
   * is the only thing that distinguishes one from another before you are in it, and it is
   * the number the closing card and the debug bar already use.
   */
  private openSlots(): void {
    this.host.menuDepth = 1;
    const rows = readSlots(this.host.store).map((slot) => {
      const here = slot.slot === this.progress.slot;
      const detail = !slot.occupied
        ? 'EMPTY'
        : `${slot.delivered} / ${MISSION_COUNT} · SEED ${slot.seed}`;
      return {
        label: `CANYON ${slot.slot + 1}`,
        detail: here ? `${detail} · HERE` : detail,
        current: here,
        // The row you are already on does nothing. Reloading the active slot would
        // rebuild the world for no change the player asked for.
        onSelect: here ? undefined : () => this.switchSlot(slot.slot),
      };
    });
    this.host.ui.showSlots(rows, () => this.open());
  }

  /**
   * Switches canyon: a different campaign, a different seed, a different world.
   *
   * The same in-place rebuild `newCanyon` uses rather than a page reload. Preferences are
   * untouched because they never lived in the slot — see `SaveData.Preferences`, which is
   * the whole point of them living outside the record.
   */
  private switchSlot(slot: number): void {
    setActiveSlot(this.host.store, slot);
    this.host.progress = new Progress(this.host.store, slot);
    this.host.rebuildCanyon();
    this.host.loadWorld(Math.min(this.progress.highestUnlocked, MISSION_COUNT));
    this.open();
  }

  /**
   * Campaigns already behind the player.
   *
   * Reporting rows rather than selectable ones: a finished playthrough is a record, and
   * there is nothing to go back to — the canyon it names was discarded when it ended.
   */
  private openHistory(): void {
    this.host.menuDepth = 1;
    const runs = readHistory(this.host.store);
    const rows =
      runs.length === 0
        ? [{ label: 'NOTHING FILED YET', detail: '' }]
        : runs.map((run) => ({
            // The rank tally is deliberately absent: it does not fit beside a nine-digit
            // seed at this card's width, and the figure that answers "how did that run
            // go" is the score.
            label: `${run.completed ? '◆' : '◇'} SEED ${run.seed}`,
            detail: `${run.delivered} / ${MISSION_COUNT} · ${run.totalPoints} PTS`,
            compact: true,
          }));
    this.host.ui.showHistory(rows, () => this.open());
  }

  private openSettings(): void {
    this.host.menuDepth = 1;
    this.host.ui.showSettings(this.host.settings(), () => this.open());
  }

  /** The one destructive action in the menu, and the only one that confirms. */
  confirmNewCanyon(): void {
    this.host.menuDepth = 1;
    this.host.ui.showConfirm(
      'NEW CANYON',
      'Rolls a new seed and starts the campaign at mission one. Every rank on this save is discarded, and the canyon you have been building in is gone.<br/><br/>Your sound and control settings are kept.',
      'ROLL A NEW CANYON',
      () => this.newCanyon(),
      () => this.open(),
    );
  }

  /**
   * Rolls a new campaign without reloading the page.
   *
   * The old route was `progress.newCanyon()` followed by `window.location.reload()` — a
   * page reload standing in for a state transition, because there was nowhere to
   * transition *to*. There is a menu now, so it is a transition like any other.
   */
  private newCanyon(): void {
    this.progress.newCanyon();
    this.host.rebuildCanyon();
    this.host.loadWorld(1);
    this.open();
  }
}
