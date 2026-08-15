import * as THREE from 'three';
import { CORPS } from '../world/CanyonSpec.ts';
import type { PadInfo } from '../world/Colony.ts';
import type { Mission } from '../campaign/Missions.ts';
import type { LandingScore, Rank } from '../campaign/Progress.ts';
import type { Airframe } from '../entities/Airframe.ts';
import { LANDER } from '../entities/Lander.ts';
import { audio } from '../audio/AudioManager.ts';
import type { HudData } from './HudData.ts';
import { createInstrument, type InstrumentPanel, type Scheme } from './InstrumentPanel.ts';
import { Reticle, type HullBounds, type ReticleState } from './Reticle.ts';
import { buildBrief } from './Brief.ts';

/** What the brief needs to know about the vehicle actually loaded for this run. */
export interface BriefVehicle {
  airframe: Airframe;
  /** After the airframe's fuel scaling — what is really in the tank. */
  fuel: number;
  invertThrusters: boolean;
  onInvert: (on: boolean) => void;
}

export type { HudData } from './HudData.ts';

/**
 * Everything the settings block can change, and how to write it back.
 *
 * Passed in rather than reached for, so `Interface` neither owns the preferences nor
 * knows where they are stored — the pause overlay and, later, the main menu can hand it
 * the same shape from wherever they keep it.
 */
export interface GameSettings {
  mutedSfx: boolean;
  mutedMusic: boolean;
  onMuteSfx: (muted: boolean) => void;
  onMuteMusic: (muted: boolean) => void;
  /** Only on a frame with two engines to tell apart. Absent means no row. */
  invert: { inverted: boolean; onChange: (on: boolean) => void } | null;
}

/** One row of a system-console list. */
export interface MenuEntry {
  label: string;
  /** Right-hand annotation — the mission a CONTINUE would resume, and the like. */
  detail?: string;
  /** Marks a row that destroys something. Colours it, and nothing else. */
  danger?: boolean;
  onSelect: () => void;
}

/** Columns in the mission grid. Kept beside the CSS that lays it out — see
 *  `.mission-grid`, whose `grid-template-columns` must agree with this or arrow-key
 *  navigation walks the wrong way through it. */
const MISSION_GRID_COLUMNS = 6;

function hex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export class Interface {
  private hud: HTMLElement;
  private fuelFill: HTMLElement;
  private fuelText: HTMLElement;
  private altText: HTMLElement;
  private vsText: HTMLElement;
  private hsText: HTMLElement;
  private instrumentSlot: HTMLElement;
  private instrument: InstrumentPanel | null = null;
  private instrumentScheme: Scheme | null = null;
  private targetText: HTMLElement;
  private payloadText: HTMLElement;
  private warning: HTMLElement;
  private uplink: HTMLElement;
  private uplinkBar: HTMLElement;

  private marker: HTMLElement;
  private panel: HTMLElement;
  private reticle = new Reticle();

  private altRow: HTMLElement;
  private hsRow: HTMLElement;

  private targetPad: PadInfo | null = null;
  private navOnline = true;

  constructor(root: HTMLElement) {
    // ------------------------------------------------------------------ HUD
    this.hud = el('div', 'hud hidden');

    const left = el('div', 'hud-block hud-left');
    // No mission number here. The brief has just said it, and once you are flying it is
    // the one line on the panel that cannot change anything you do about it.
    this.payloadText = el('div', 'hud-payload', '');
    this.targetText = el('div', 'hud-target', '');

    // No mute button on the console. Sound is a setting, and settings live in the pause
    // overlay now — where there is room to separate effects from music, which a single
    // speaker glyph could never do.
    left.append(this.payloadText, this.targetText);

    const fuelBox = el('div', 'hud-fuel');
    const fuelLabel = el('div', 'hud-label', 'FUEL');
    const fuelTrack = el('div', 'fuel-track');
    this.fuelFill = el('div', 'fuel-fill');
    fuelTrack.append(this.fuelFill);
    this.fuelText = el('div', 'fuel-text', '0');
    fuelBox.append(fuelLabel, fuelTrack, this.fuelText);
    left.append(fuelBox);

    const right = el('div', 'hud-block hud-right');
    const mkReadout = (label: string) => {
      const row = el('div', 'readout');
      row.append(el('span', 'readout-label', label));
      const value = el('span', 'readout-value', '0.0');
      row.append(value);
      right.append(row);
      return { row, value };
    };
    const alt = mkReadout('ALT');
    const vs = mkReadout('V/S');
    const hs = mkReadout('H/S');
    this.altText = alt.value;
    this.vsText = vs.value;
    this.hsText = hs.value;
    this.altRow = alt.row;
    this.hsRow = hs.row;

    this.instrumentSlot = el('div', 'instrument-slot');
    right.append(this.instrumentSlot);

    this.warning = el('div', 'warning hidden');

    // Outside `.hud`, like the augmented layer and for the same reason: this is the AI's
    // own status, not the vehicle's, so it must not inherit the charter's livery.
    this.uplink = el('div', 'uplink hidden');
    this.uplinkBar = el('div', 'uplink-fill');
    const uplinkTrack = el('div', 'uplink-track');
    uplinkTrack.append(this.uplinkBar);
    this.uplink.append(el('div', 'uplink-text', 'UPLINK ESTABLISHING'), uplinkTrack);

    this.hud.append(left, right, this.warning);

    // --------------------------------------------------------------- marker
    this.marker = el('div', 'marker hidden');
    this.marker.append(el('div', 'marker-arrow'), el('div', 'marker-dist', ''));

    // ---------------------------------------------------------------- panel
    this.panel = el('div', 'panel hidden');

    // The overlay is a sibling of `.hud`, deliberately. `setAirframe` sets the client's
    // livery on `.hud`, and the augmented layer is the player's rather than the
    // charter's — being outside that subtree is what stops `--corp` inheriting into it.
    root.append(this.hud, this.reticle.root, this.uplink, this.marker, this.panel);

    this.installKeyboardNav();
  }

  // ------------------------------------------------------------------ panels

  private showPanel(content: HTMLElement): void {
    this.panel.innerHTML = '';
    this.panel.append(content);
    this.panel.classList.remove('hidden');
  }

  hidePanel(): void {
    this.panel.classList.add('hidden');
    this.panel.innerHTML = '';
  }

  /**
   * Arrow keys move between the choices on whatever panel is open.
   *
   * Every control here is already a real `<button>`, so Tab and Enter worked from the
   * start and none of that is reimplemented — this only adds the arrows, which is what a
   * console like this invites you to reach for. Enter and Space stay the browser's.
   *
   * Installed once on the panel rather than per card: the panel outlives every screen
   * shown in it, so there is no listener to add and remove as the player moves between
   * the menu, the grid and the settings, and nothing to leak if a card forgets.
   *
   * The mission grid is the one screen where up and down are not the same as previous
   * and next, so the step is the column count there and one everywhere else.
   */
  private installKeyboardNav(): void {
    this.panel.addEventListener('keydown', (e) => {
      const key = e.key;
      if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'ArrowLeft' && key !== 'ArrowRight') {
        return;
      }

      const items = [
        ...this.panel.querySelectorAll<HTMLButtonElement>(
          '.menu-row, .mission-cell:not(:disabled), .setting-toggle, button.primary, button.secondary',
        ),
      ];
      if (items.length === 0) return;

      // Held arrows would otherwise also be feeding the flight controls, and the page
      // would scroll underneath.
      e.preventDefault();
      e.stopPropagation();

      const grid = this.panel.querySelector('.mission-grid');
      const inGrid = grid !== null && grid.contains(document.activeElement);
      const columns = inGrid ? MISSION_GRID_COLUMNS : 1;

      const step =
        key === 'ArrowDown' ? columns : key === 'ArrowUp' ? -columns : key === 'ArrowRight' ? 1 : -1;

      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      // Nothing focused yet: the first arrow press picks an end rather than being eaten.
      const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : at + step;
      items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
    });
  }

  /**
   * The brief, as a paged sequence of transmissions.
   *
   * The single modal it replaced put the client's voice, the manifest and the objective
   * on one slab, all in the client's colour — including the manifest, which is the
   * console's own reading of what it is holding and never was theirs to say. Paging it
   * splits those voices, and `Brief.ts` decides how many pages a given mission actually
   * warrants rather than always spending three.
   *
   * The pieces the pages are built from stay here, because the pause overlay and the
   * result card use the same row and toggle constructors.
   */
  showBrief(
    mission: Mission,
    bestRank: Rank | null,
    vehicle: BriefVehicle,
    onBegin: () => void,
  ): void {
    this.pauseManifest = this.manifestFor(mission, vehicle, bestRank);
    buildBrief(mission, { showPanel: (content) => this.showPanel(content) }, onBegin);
  }

  /**
   * The manifest as the pause overlay shows it, built when the mission loads.
   *
   * Kept rather than rebuilt on pause because the brief is the only place that has the
   * vehicle's real fuel figure to hand — `Game` computes it once for the run — and
   * threading it through the pause path again would mean two sources for one number.
   */
  private pauseManifest: HTMLElement | null = null;

  private manifestFor(mission: Mission, vehicle: BriefVehicle, best: Rank | null): HTMLElement {
    const manifest = el('div', 'manifest');
    manifest.append(
      row('PAYLOAD', `${mission.payload.name}`),
      row('MASS', `${mission.payload.mass.toFixed(1)} t`),
      // The airframe's own figure, not the mission's: a frame with a fuel penalty flies
      // with less than the manifest asked for, and the brief should say what is aboard.
      row('FUEL', `${vehicle.fuel}`),
      row('VEHICLE', vehicle.airframe.name),
      row('CLIENT', CORPS[mission.client].name),
    );
    if (best) manifest.append(row('BEST', best));
    return manifest;
  }

  /**
   * One switch: a label and a button that reads its own state.
   *
   * Deliberately not a checkbox. Every other control in this game is a labelled button
   * that says what it currently is, and a settings row that behaved differently would be
   * the only one.
   */
  private toggle(
    label: string,
    on: boolean,
    text: (on: boolean) => string,
    onChange: (on: boolean) => void,
  ): HTMLElement {
    const wrap = el('div', 'setting');
    const button = el('button', 'setting-toggle');

    let state = on;
    const paint = () => {
      button.innerText = text(state);
      button.classList.toggle('on', state);
    };
    paint();

    button.addEventListener('click', () => {
      state = !state;
      paint();
      onChange(state);
      // After the change, so muting is silent and unmuting is audible — the beep is the
      // confirmation that sound is back.
      audio.init();
      audio.playUiBeep(900, 'sine', 0.03);
    });

    wrap.append(el('span', 'setting-label', label), button);
    return wrap;
  }

  /**
   * The settings block, shared rather than duplicated.
   *
   * The pause overlay shows it now and the main menu will show the same rows, so it is
   * built once. Anything added here appears in both without a second implementation to
   * keep in step — which is the failure mode this exists to prevent, since two copies of
   * a settings panel drift the moment one of them gains a row.
   */
  settingsBlock(settings: GameSettings): HTMLElement {
    const wrap = el('div', 'settings');

    wrap.append(
      this.toggle('SOUND', !settings.mutedSfx, (on) => (on ? 'ON' : 'MUTED'), (on) =>
        settings.onMuteSfx(!on),
      ),
      this.toggle('MUSIC', !settings.mutedMusic, (on) => (on ? 'ON' : 'MUTED'), (on) =>
        settings.onMuteMusic(!on),
      ),
    );

    // Only where it means something. On a single-engine frame there is no second engine
    // to tell apart, and the row would be a control that does nothing — the same reason
    // the brief only offers it on the twin.
    if (settings.invert) {
      const invert = settings.invert;
      wrap.append(
        this.toggle(
          'CONTROLS',
          invert.inverted,
          (on) => (on ? 'INVERTED · KEY FIRES ITS OWN ENGINE' : 'DIRECT · KEY IS THE WAY YOU GO'),
          (on) => invert.onChange(on),
        ),
      );
    }

    return wrap;
  }

  /**
   * The pause overlay.
   *
   * `PAUSED` has been a real state since long before this existed — `onKey` has always
   * flipped it and a comment in `Game` has always claimed it had "its own overlay" — but
   * nothing was ever drawn, so pausing silently froze the picture with the console still
   * live over it. This is that overlay.
   */
  showPause(
    settings: GameSettings,
    onResume: () => void,
    onRestart: () => void,
    onMenu: () => void,
  ): void {
    // `card-sys` rather than a client's livery: this is the only screen in the game that
    // is not somebody transmitting to you. See the system-console block in style.css.
    const card = el('div', 'card card-sys');
    card.append(el('div', 'card-eyebrow', 'PAUSED'));
    // What the brief used to read out before the run. Here it is on demand instead of
    // on arrival: a player who wants the mass or the fuel again can stop and look.
    if (this.pauseManifest) card.append(this.pauseManifest);
    card.append(this.settingsBlock(settings));

    const button = el('button', 'primary', 'RESUME');
    button.addEventListener('click', onResume);
    card.append(button);

    /**
     * Start the run again from entry.
     *
     * Above `MAIN MENU` because it is the more likely of the two: a player who has opened
     * this menu mid-descent has usually just realised the approach is spoiled, and wants
     * another go rather than the way out. Like `MAIN MENU` it needs no confirmation —
     * nothing is scored until a landing resolves, so an abandoned attempt costs only
     * itself.
     */
    const restart = el('button', 'secondary', 'RESTART MISSION');
    restart.addEventListener('click', onRestart);
    card.append(restart);

    // The way out. Abandoning a run costs nothing but the attempt — nothing is scored
    // until a landing resolves — so this needs no confirmation, unlike NEW CANYON.
    const menu = el('button', 'secondary', 'MAIN MENU');
    menu.addEventListener('click', onMenu);
    card.append(menu);

    this.showPanel(card);
    button.focus();
  }

  // -------------------------------------------------------------------- menu

  /**
   * A list of choices in the system register.
   *
   * Generic rather than one bespoke card per screen, because in a terminal every screen
   * *is* a list — the root menu, the settings back-link and the confirmations are the
   * same shape with different rows. Writing four cards would have meant four places for
   * the register to drift.
   */
  private showList(title: string, entries: MenuEntry[]): void {
    const card = el('div', 'card card-sys card-menu');
    card.append(el('div', 'card-eyebrow', title));

    const list = el('div', 'menu-list');
    let first: HTMLButtonElement | null = null;

    for (const entry of entries) {
      const row = el('button', 'menu-row');
      row.append(el('span', 'menu-label', entry.label));
      if (entry.detail) row.append(el('span', 'menu-detail', entry.detail));
      if (entry.danger) row.classList.add('danger');
      row.addEventListener('click', () => {
        audio.init();
        audio.playUiBeep(760, 'square', 0.03);
        entry.onSelect();
      });
      list.append(row);
      first ??= row;
    }

    card.append(list);
    this.showPanel(card);
    first?.focus();
  }

  showMenu(entries: MenuEntry[]): void {
    this.showList('30 MISSIONS TO MARS', entries);
  }

  /**
   * Every mission flown or waiting, with the rank already earned on each.
   *
   * This is the screen that earns the menu. Ranks and points have always been stored per
   * mission and there has never been a way back to a bad one — a thirty-mission campaign
   * that records a C and then never lets you answer it.
   */
  showMissions(
    unlocked: number,
    rankFor: (id: number) => Rank | null,
    total: number,
    onPick: (id: number) => void,
    onBack: () => void,
  ): void {
    const card = el('div', 'card card-sys card-menu');
    card.append(el('div', 'card-eyebrow', 'MISSIONS'));

    const grid = el('div', 'mission-grid');
    for (let id = 1; id <= total; id++) {
      const locked = id > unlocked;
      const rank = rankFor(id);
      const cell = el('button', 'mission-cell');
      cell.append(el('span', 'mission-no', String(id).padStart(2, '0')));
      // A flown mission shows what it was worth; an unflown but reachable one shows a
      // dash, and a locked one shows nothing at all. Three states, three glyphs — a
      // locked cell must not read as "flown, scored nothing".
      cell.append(el('span', 'mission-rank', locked ? '' : (rank ?? '·')));
      cell.classList.toggle('locked', locked);
      if (rank) cell.classList.add(`rank-${rank}`);
      cell.disabled = locked;
      if (!locked) {
        cell.addEventListener('click', () => {
          audio.init();
          audio.playUiBeep(760, 'square', 0.03);
          onPick(id);
        });
      }
      grid.append(cell);
    }
    card.append(grid);

    const back = el('button', 'primary', 'BACK');
    back.addEventListener('click', onBack);
    card.append(back);

    this.showPanel(card);
    back.focus();
  }

  showSettings(settings: GameSettings, onBack: () => void): void {
    const card = el('div', 'card card-sys');
    card.append(el('div', 'card-eyebrow', 'SETTINGS'));
    card.append(this.settingsBlock(settings));

    const back = el('button', 'primary', 'BACK');
    back.addEventListener('click', onBack);
    card.append(back);

    this.showPanel(card);
    back.focus();
  }

  /**
   * Confirmation for anything that destroys a campaign.
   *
   * Focus lands on the cancel row, not the confirm one — the whole point of the screen
   * is that the destructive answer should take a deliberate act, and a focused button
   * one Enter away from thirty missions of progress is not that.
   */
  showConfirm(title: string, body: string, confirmLabel: string, onConfirm: () => void, onCancel: () => void): void {
    const card = el('div', 'card card-sys');
    card.append(el('div', 'card-eyebrow', title), el('div', 'card-body', body));

    const list = el('div', 'menu-list');
    const cancel = el('button', 'menu-row');
    cancel.append(el('span', 'menu-label', 'CANCEL'));
    cancel.addEventListener('click', onCancel);

    const confirm = el('button', 'menu-row danger');
    confirm.append(el('span', 'menu-label', confirmLabel));
    confirm.addEventListener('click', onConfirm);

    list.append(cancel, confirm);
    card.append(list);
    this.showPanel(card);
    cancel.focus();
  }

  showResult(
    mission: Mission,
    score: LandingScore,
    onNext: () => void,
    onRetry: () => void,
  ): void {
    const corp = CORPS[mission.client];
    const card = el('div', 'card');
    card.style.setProperty('--corp', hex(corp.color));

    card.append(
      el('div', 'card-eyebrow', 'PAYLOAD DELIVERED'),
      el('div', `rank rank-${score.rank}`, score.rank),
      el('div', 'rank-points', `${score.points} PTS`),
    );

    const manifest = el('div', 'manifest');
    manifest.append(
      row('FUEL REMAINING', `${Math.round(score.fuelPct * 100)}%`),
      row('TOUCHDOWN', `${score.touchdownSpeed.toFixed(2)} u/s`),
    );
    // No address, no offset. Reporting a pad offset of 0.00 for a landing on open
    // ground reads as a perfect centring the player was never scored on.
    if (mission.target !== null) {
      manifest.append(row('PAD OFFSET', `${score.offset.toFixed(2)} u`));
    }
    card.append(manifest);

    /**
     * Fly it again, before moving on.
     *
     * A rank is the thing the player is scored on and the campaign already keeps the best
     * of each measure — `Progress.complete` only ever raises a rank or a point total, so
     * a worse second attempt costs nothing. Without this the only route back to a C was
     * the mission grid in the main menu, two screens away, at exactly the moment the
     * player has just been told they got a C.
     *
     * Above the primary, because it is the qualifier on the result you are still looking
     * at; `NEXT MISSION` stays the bright one, since moving on is what most runs do.
     */
    const retry = el('button', 'secondary', 'RETRY MISSION');
    retry.addEventListener('click', () => {
      audio.init();
      audio.playUiBeep(700, 'square', 0.03);
      onRetry();
    });
    card.append(retry);

    const label = mission.id >= 30 ? 'FINISH CAMPAIGN' : 'NEXT MISSION';
    const button = el('button', 'primary', label);
    button.addEventListener('click', () => {
      audio.init();
      audio.playUiBeep();
      onNext();
    });
    card.append(button);

    this.showPanel(card);
    button.focus();
  }

  showFailure(
    title: string,
    detail: string,
    onRetry: () => void,
    onMenu: () => void,
  ): void {
    const card = el('div', 'card card-fail');
    card.append(el('div', 'card-eyebrow', 'MISSION FAILED'), el('div', 'fail-title', title));
    card.append(el('div', 'card-body', detail));

    const button = el('button', 'primary', 'RETRY MISSION');
    button.addEventListener('click', () => {
      audio.init();
      audio.playUiBeep();
      onRetry();
    });
    card.append(button);

    // A wreck used to be the one screen with no way out but flying again. Every other
    // terminal state in the game offers the menu, and this is the one a player is most
    // likely to want to leave from — it is the screen you reach by having a bad time.
    const menu = el('button', 'secondary', 'MAIN MENU');
    menu.addEventListener('click', onMenu);
    card.append(menu);

    this.showPanel(card);
    button.focus();
  }

  showVictory(onRestart: () => void): void {
    const card = el('div', 'card');
    card.append(
      el('div', 'card-eyebrow', 'CAMPAIGN COMPLETE'),
      el('div', 'fail-title', '30 / 30'),
      el(
        'div',
        'card-body',
        'Every structure between the west wall and the chasm floor was placed by something you carried down here. The canyon is theirs now.<br/><br/>A new canyon can be rolled at any time.',
      ),
    );
    const button = el('button', 'primary', 'ROLL A NEW CANYON');
    button.addEventListener('click', () => {
      audio.init();
      audio.playUiBeep();
      onRestart();
    });
    card.append(button);
    this.showPanel(card);
    button.focus();
  }

  // --------------------------------------------------------------------- HUD

  /**
   * The uplink status line, 0..1 through the handshake, or `null` once it is up.
   *
   * Driven from `missionTime` by the caller rather than animated here, so the bar is a
   * pure function of how far into the mission you are — same reasoning as the panel's
   * boot sweep. A CSS animation would drift from the state that ends the sequence and
   * would not survive a retry identically.
   */
  setUplink(progress: number | null): void {
    this.uplink.classList.toggle('hidden', progress === null);
    if (progress !== null) this.uplinkBar.style.width = `${progress * 100}%`;
  }

  setHudVisible(visible: boolean): void {
    this.hud.classList.toggle('hidden', !visible);
    this.marker.classList.toggle('hidden', !visible || !this.navOnline);
    this.reticle.setVisible(visible);
  }

  /**
   * Paints the augmented layer on the vehicle. Needs the camera, so it rides with
   * `updateMarker` rather than `updateHud`.
   */
  updateReticle(
    camera: THREE.Camera,
    state: Omit<ReticleState, 'ranging'>,

    hull: HullBounds,
  ): void {
    // Filled here rather than by the caller, so the "no radar on mission one" rule stays
    // in the one place that already owns it — alongside the H/S masking in `updateHud`.
    this.reticle.update(camera, { ...state, ranging: this.navOnline }, hull);
  }

  /**
   * Brings the ranging instruments up or takes them away. Off, the player flies on
   * descent rate, attitude and their own eyes — which is the whole of what mission one
   * has to teach, and it is easier to teach with the numbers that would answer it for
   * them switched off.
   */
  setInstruments(navOnline: boolean): void {
    this.navOnline = navOnline;
    this.altRow.classList.toggle('hidden', !navOnline);
    this.hsRow.classList.toggle('hidden', !navOnline);
    if (!navOnline) this.marker.classList.add('hidden');
  }

  /**
   * Fits the panel the vehicle came with, and paints it in the client's colours.
   *
   * Rebuilt only when the scheme actually changes, so a retry on the same airframe keeps
   * the needles where they were rather than snapping them to zero and settling again —
   * which would read as the panel rebooting mid-mission. The boot sweep is posed from
   * `missionTime`, so an actual mission load replays its wake-up regardless.
   *
   * This is also what retires the old standalone tilt dial. Attitude is one instrument
   * among several on the frame that has an attitude, and simply absent on the two that
   * do not — an instrument on the panel asserts that the quantity it shows can kill you,
   * and on a locked-rotation vehicle it cannot.
   */
  setAirframe(scheme: Scheme, corpColor: number): void {
    this.hud.style.setProperty('--corp', hex(corpColor));
    this.hud.dataset.scheme = scheme;

    if (this.instrumentScheme === scheme) return;
    this.instrumentScheme = scheme;
    this.instrument = createInstrument(scheme);
    this.instrumentSlot.innerHTML = '';
    this.instrumentSlot.append(this.instrument.root);
  }

  setMission(mission: Mission, target: PadInfo | null): void {
    this.targetPad = target;
    this.payloadText.innerText = `${mission.payload.name.toUpperCase()} · ${mission.payload.mass.toFixed(1)}t`;

    if (target) {
      /**
       * The pad's own corp, deliberately not the client's livery.
       *
       * Most runs those agree and nobody notices. The ones that matter are the runs
       * where they do not — a charter paying you to put something on a rival's slab —
       * and there the mismatch between the console you are flying and the colour of the
       * address on it is the whole point. Painting the target in the livery would erase
       * the only place on screen that says who actually owns the ground.
       *
       * The marker is a sibling of `.hud`, not a child, so the livery `--corp` set in
       * `setAirframe` does not inherit into it. That separation is load-bearing.
       */
      const corp = CORPS[target.corp];
      this.targetText.innerText = `→ ${target.id.replace(/-/g, ' ').toUpperCase()}`;
      this.targetText.style.color = hex(corp.color);
      this.marker.style.setProperty('--corp', hex(corp.color));
    } else {
      this.targetText.innerText = '';
    }
  }

  updateHud(data: HudData, dt: number): void {
    const pct = data.fuelCapacity > 0 ? data.fuel / data.fuelCapacity : 0;
    this.fuelFill.style.width = `${Math.max(0, pct) * 100}%`;
    this.fuelFill.classList.toggle('low', pct < 0.2);
    this.fuelText.innerText = Math.max(0, Math.round(data.fuel)).toString();

    this.altText.innerText = data.altitude.toFixed(0);

    const descending = data.verticalSpeed < 0;
    this.vsText.innerText = `${descending ? '▼' : '▲'}${Math.abs(data.verticalSpeed).toFixed(1)}`;
    this.vsText.classList.toggle(
      'danger',
      descending && Math.abs(data.verticalSpeed) > LANDER.MAX_LANDING_SPEED,
    );

    /**
     * Mission one flies with no ranging package fitted, so there is no drift measurement
     * to show — not a hidden one. Masking it here rather than inside each panel keeps
     * the rule in one place: whatever an instrument does with `horizontalSpeed`, on that
     * mission it is handed a zero, and the cross-pointer's drift needle sits centred
     * because the vehicle genuinely cannot tell it otherwise.
     *
     * Hiding it in CSS instead would leave the number on the wire, one stylesheet edit
     * away from teaching the player what mission one is built to withhold.
     */
    const telemetry: HudData = this.navOnline ? data : { ...data, horizontalSpeed: 0 };

    // Signed on the wire, because the crosshair needs a direction. The readout wants the
    // magnitude — a drift of -1.2 is not a speed of minus anything.
    const drift = Math.abs(telemetry.horizontalSpeed);
    this.hsText.innerText = drift.toFixed(1);
    this.hsText.classList.toggle('danger', drift > LANDER.MAX_LANDING_SPEED);

    this.instrument?.update(telemetry, dt);

    if (data.abyssProximity > 0.55) {
      this.setWarning('SIGNAL DEGRADING · PULL UP', true);
    } else if (data.fuel <= 0) {
      this.setWarning('FUEL EXHAUSTED', true);
    } else if (pct < 0.12) {
      this.setWarning('FUEL CRITICAL', false);
    } else {
      this.clearWarning();
    }
  }

  private setWarning(text: string, critical: boolean): void {
    this.warning.innerText = text;
    this.warning.classList.remove('hidden');
    this.warning.classList.toggle('critical', critical);
  }

  private clearWarning(): void {
    this.warning.classList.add('hidden');
  }

  /**
   * Points the marker at the delivery target. On screen it sits over the pad; off
   * screen it pins to the nearest edge and rotates to point the way.
   */
  updateMarker(camera: THREE.Camera, landerX: number, landerY: number): void {
    if (!this.targetPad || !this.navOnline) {
      this.marker.classList.add('hidden');
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    const pos = new THREE.Vector3(this.targetPad.x, this.targetPad.y + 3, 0).project(camera);
    const behind = pos.z > 1;

    let x = (pos.x * 0.5 + 0.5) * w;
    let y = (pos.y * -0.5 + 0.5) * h;
    if (behind) {
      x = w - x;
      y = h - y;
    }

    const pad = 42;
    const onScreen = !behind && x > pad && x < w - pad && y > pad && y < h - pad;

    const dist = Math.hypot(this.targetPad.x - landerX, this.targetPad.y - landerY);
    const distEl = this.marker.querySelector('.marker-dist') as HTMLElement;
    distEl.innerText = `${dist.toFixed(0)}`;

    this.marker.classList.remove('hidden');
    this.marker.classList.toggle('on-screen', onScreen);

    const cx = Math.max(pad, Math.min(w - pad, x));
    const cy = Math.max(pad, Math.min(h - pad, y));
    const angle = onScreen ? 0 : Math.atan2(y - h / 2, x - w / 2) + Math.PI / 2;

    this.marker.style.left = `${cx}px`;
    this.marker.style.top = `${cy}px`;
    const arrow = this.marker.querySelector('.marker-arrow') as HTMLElement;
    arrow.style.transform = `rotate(${angle}rad)`;
  }
}

function row(label: string, value: string): HTMLElement {
  const line = el('div', 'manifest-row');
  line.append(el('span', 'manifest-label', label), el('span', 'manifest-value', value));
  return line;
}
