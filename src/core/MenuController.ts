import { copyShareLink, readSharedSeed, writeSharedSeed } from '../campaign/CanyonLink.ts';
import { CAMPAIGN_FLIGHTS, EPILOGUE_ID, MISSION_COUNT } from '../campaign/Missions.ts';
import { Progress } from '../campaign/Progress.ts';
import {
  readHistory,
  readSlots,
  setActiveSlot,
  SLOT_COUNT,
  type ProgressStore,
} from '../campaign/SaveData.ts';
import type { GameSettings, Interface, MenuNote } from '../ui/Interface.ts';

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
  /**
   * What the last SHARE CANYON press did, shown once and then forgotten.
   *
   * Held here rather than pushed into `Interface` because it is menu state, and the menu
   * is rebuilt from scratch on every `open()` — a row cannot report its own outcome when
   * the row is thrown away and rebuilt. Cleared by the render that shows it, so stepping
   * into CANYONS and back does not resurrect a message about something the player did a
   * minute ago.
   */
  private linkNote: string | null = null;

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
      /**
       * The seed is on the row rather than behind it because it is the thing being
       * shared, and a player on itch cannot see the address bar to read it off — the
       * game is in an iframe there, so the URL the hash is written into is invisible.
       * That is also why this copies rather than merely displaying: on the one platform
       * where sharing needs help, reading the number back is all the player could do.
       */
      {
        label: 'SHARE CANYON',
        detail: `SEED ${this.progress.seed}`,
        onSelect: () => this.copyLink(),
      },
      { label: 'SETTINGS', onSelect: () => this.openSettings() },
      { label: 'NEW CANYON', danger: true, onSelect: () => this.confirmNewCanyon() },
    ], this.notes());
    // Consumed by the render above: the copy result is about the press that caused it.
    this.linkNote = null;
  }

  /**
   * What the menu has to say that is not a choice.
   *
   * The storage warning is unconditional and permanent while it applies, because the
   * failure it describes is silent otherwise — the campaign plays perfectly and rolls a
   * different canyon on every load, which reads as a bug in the generator rather than as
   * a browser refusing to store anything. Measured: with storage blocked, four
   * consecutive loads produced four seeds and no error of any kind.
   */
  private notes(): MenuNote[] {
    const notes: MenuNote[] = [];
    if (this.host.store === null) {
      notes.push({
        text: 'STORAGE UNAVAILABLE — THIS CAMPAIGN WILL NOT SURVIVE A RELOAD, AND THE CANYON IS REROLLED EACH TIME. SHARE CANYON COPIES A LINK THAT COMES BACK TO THIS ONE.',
        warn: true,
      });
    }
    if (this.linkNote) notes.push({ text: this.linkNote });
    return notes;
  }

  /**
   * Puts the canyon on the clipboard, and says whether it landed.
   *
   * Reporting failure matters more than it looks: the Clipboard API needs a secure
   * context, so a player running the built game off a plain-HTTP LAN address gets nothing
   * and would otherwise have no idea whether to paste.
   */
  private copyLink(): void {
    void copyShareLink(this.progress.seed).then((copied) => {
      this.linkNote = copied
        ? 'LINK COPIED. ANYONE WHO OPENS IT CAN FLY THIS CANYON.'
        : 'COULD NOT REACH THE CLIPBOARD — THE SEED IS ON THE ROW ABOVE.';
      this.open();
    });
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

  /**
   * A canyon somebody else is flying, arriving as a link.
   *
   * An offer and never an application, because the alternative corrupts the one thing the
   * save format guarantees: `mastX` and `relayX` are write-once precisely so twenty-nine
   * missions of layout cannot shift under a player, and dropping a foreign seed onto a
   * campaign in progress would move the canyon out from under a colony ledger that has
   * already been grown against the old one. So a link can only ever *start* something.
   *
   * Silent when the hash names the canyon already being flown, which is the ordinary
   * case: the player's own URL carries their own seed, so every reload arrives here with
   * a seed that matches and nothing to ask about.
   */
  offerSharedCanyon(): boolean {
    const seed = readSharedSeed();
    if (seed === null || seed === this.progress.seed) return false;

    /**
     * Nothing flown, so the seed costs nothing: take it where we stand. This is also the
     * path a storage-blocked browser takes on *every* load — each one starts an untouched
     * campaign — and is what makes a link survive a reload in a browser that will not
     * store anything, the player's own link included.
     */
    if (this.flownCount() === 0 && this.progress.highestUnlocked === 1) {
      this.adoptSeed(this.progress.slot, seed);
      return true;
    }

    this.host.menuDepth = 1;
    const free = readSlots(this.host.store).find((slot) => !slot.occupied);
    if (!free) {
      // No free slot and no offer to replace one. Overwriting on somebody else's say-so
      // is the single most destructive thing a URL could do here, and the player is two
      // screens from doing it deliberately if they want to.
      this.host.ui.showConfirm(
        'SHARED CANYON',
        `Someone shared canyon <b>${seed}</b>.<br/><br/>All ${SLOT_COUNT} of your canyons are in use, and a link never replaces one. Discard a campaign from CANYONS and open the link again.`,
        'OPEN CANYONS',
        // Hash deliberately left alone on this one path: the card has just told the
        // player to come back to this link once they have freed a canyon, and rewriting
        // it here is what would make that instruction a lie.
        () => this.openSlots(),
        () => this.dismissShared(),
      );
      return true;
    }

    this.host.ui.showConfirm(
      'SHARED CANYON',
      `Someone shared canyon <b>${seed}</b>.<br/><br/>It starts a new campaign at mission one, in canyon ${free.slot + 1}, which is empty. The campaign you are in now is not touched.`,
      `FLY CANYON ${free.slot + 1}`,
      () => this.adoptSeed(free.slot, seed),
      () => this.dismissShared(),
    );
    return true;
  }

  /**
   * Declining the offer, which includes putting the address bar back.
   *
   * Without the rewrite the URL keeps naming a canyon the player just said no to, and
   * every reload asks again — and worse, SHARE CANYON would hand somebody a link to a
   * chasm this player is not flying.
   */
  private dismissShared(): void {
    writeSharedSeed(this.progress.seed);
    this.open();
  }

  /**
   * Pins a slot to a seed and drops the player into it at mission one.
   *
   * `useSeed` rather than `reset`: the slot being adopted into is either empty or
   * untouched, so there are no ranks to discard, and going through `reset` would file an
   * empty campaign in the history for every shared link anybody opened.
   */
  private adoptSeed(slot: number, seed: number): void {
    if (slot !== this.progress.slot) {
      setActiveSlot(this.host.store, slot);
      this.host.progress = new Progress(this.host.store, slot);
    }
    this.progress.useSeed(seed);
    this.host.rebuildCanyon();
    this.host.loadWorld(1);
    this.open();
  }
}
