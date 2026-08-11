import * as THREE from 'three';
import { CORPS } from '../world/CanyonSpec.ts';
import type { PadInfo } from '../world/Colony.ts';
import type { Mission } from '../campaign/Missions.ts';
import type { LandingScore, Rank } from '../campaign/Progress.ts';
import type { Airframe } from '../entities/Airframe.ts';
import { LANDER } from '../entities/Lander.ts';
import { audio } from '../audio/AudioManager.ts';

/** What the brief needs to know about the vehicle actually loaded for this run. */
export interface BriefVehicle {
  airframe: Airframe;
  /** After the airframe's fuel scaling — what is really in the tank. */
  fuel: number;
  invertThrusters: boolean;
  onInvert: (on: boolean) => void;
}

export interface HudData {
  fuel: number;
  fuelCapacity: number;
  altitude: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  tilt: number;
  /** How close the lander is to the abyss fail depth, 0..1. */
  abyssProximity: number;
}

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
  private tiltNeedle: HTMLElement;
  private tiltDial: HTMLElement;
  private targetText: HTMLElement;
  private payloadText: HTMLElement;
  private missionText: HTMLElement;
  private warning: HTMLElement;
  private muteBtn: HTMLElement;

  private marker: HTMLElement;
  private panel: HTMLElement;

  private altRow: HTMLElement;
  private hsRow: HTMLElement;

  private targetPad: PadInfo | null = null;
  private navOnline = true;

  constructor(root: HTMLElement) {
    // ------------------------------------------------------------------ HUD
    this.hud = el('div', 'hud hidden');

    const left = el('div', 'hud-block hud-left');
    this.missionText = el('div', 'hud-mission', 'MISSION 01');
    this.payloadText = el('div', 'hud-payload', '');
    this.targetText = el('div', 'hud-target', '');

    this.muteBtn = el('button', 'hud-mute-btn', '🔊');
    this.muteBtn.setAttribute('title', 'Toggle Mute');
    this.muteBtn.style.pointerEvents = 'auto';
    this.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.init();
      const muted = audio.toggleMute();
      this.muteBtn.innerText = muted ? '🔇' : '🔊';
    });

    left.append(this.missionText, this.payloadText, this.targetText, this.muteBtn);

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

    this.tiltDial = el('div', 'tilt-dial');
    this.tiltNeedle = el('div', 'tilt-needle');
    this.tiltDial.append(this.tiltNeedle, el('div', 'tilt-label', 'TILT'));
    right.append(this.tiltDial);

    this.warning = el('div', 'warning hidden');

    this.hud.append(left, right, this.warning);

    // --------------------------------------------------------------- marker
    this.marker = el('div', 'marker hidden');
    this.marker.append(el('div', 'marker-arrow'), el('div', 'marker-dist', ''));

    // ---------------------------------------------------------------- panel
    this.panel = el('div', 'panel hidden');

    root.append(this.hud, this.marker, this.panel);
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

  showBrief(
    mission: Mission,
    bestRank: Rank | null,
    vehicle: BriefVehicle,
    onBegin: () => void,
  ): void {
    const corp = CORPS[mission.client];
    const card = el('div', 'card');
    card.style.setProperty('--corp', hex(corp.color));

    card.append(
      el('div', 'card-eyebrow', `MISSION ${String(mission.id).padStart(2, '0')} / 30`),
      el('div', 'card-body', mission.brief),
    );

    const manifest = el('div', 'manifest');
    manifest.append(
      row('PAYLOAD', `${mission.payload.name}`),
      row('MASS', `${mission.payload.mass.toFixed(1)} t`),
      // The airframe's own figure, not the mission's: a frame with a fuel penalty flies
      // with less than the manifest asked for, and the brief should say what is aboard.
      row('FUEL', `${vehicle.fuel}`),
      row('VEHICLE', vehicle.airframe.name),
      row('CLIENT', corp.name),
    );
    if (bestRank) manifest.append(row('BEST', bestRank));
    card.append(manifest);

    // Only the twin-engine frame has two engines to tell apart, so the choice only
    // exists there. On a single engine the setting would be a control that does nothing.
    if (vehicle.airframe.scheme === 'differential') {
      card.append(this.thrusterToggle(vehicle));
    }

    const button = el('button', 'primary', 'BEGIN DESCENT');
    button.addEventListener('click', () => {
      audio.init();
      audio.playLaunch();
      onBegin();
    });
    card.append(button);

    this.showPanel(card);
    button.focus();
  }

  /**
   * Which engine a direction key lights. Both readings are defensible — one is "go
   * where I point", the other is "fire the thruster I point at" — and which feels
   * correct is a fact about the player, not about the vehicle, so it is a setting.
   */
  private thrusterToggle(vehicle: BriefVehicle): HTMLElement {
    const wrap = el('div', 'setting');
    const label = el('span', 'setting-label', 'CONTROLS');
    const button = el('button', 'setting-toggle');

    const paint = (on: boolean) => {
      button.innerText = on ? 'INVERTED · KEY FIRES ITS OWN ENGINE' : 'DIRECT · KEY IS THE WAY YOU GO';
      button.classList.toggle('on', on);
    };

    let inverted = vehicle.invertThrusters;
    paint(inverted);
    button.addEventListener('click', () => {
      audio.init();
      audio.playUiBeep(900, 'sine', 0.03);
      inverted = !inverted;
      paint(inverted);
      vehicle.onInvert(inverted);
    });

    wrap.append(label, button);
    return wrap;
  }

  showResult(mission: Mission, score: LandingScore, onNext: () => void): void {
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

  showFailure(title: string, detail: string, onRetry: () => void): void {
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

  setHudVisible(visible: boolean): void {
    this.hud.classList.toggle('hidden', !visible);
    this.marker.classList.toggle('hidden', !visible || !this.navOnline);
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
   * The tilt dial is removed on a frame whose rotation is locked.
   *
   * It would read zero for the whole run, which is not merely useless — an instrument
   * on the panel asserts that the quantity it shows can kill you, and on this vehicle
   * it cannot. What can is lateral drift, and the horizontal-speed readout already
   * flags that past the same tolerance.
   */
  setTiltInstrument(shown: boolean): void {
    this.tiltDial.classList.toggle('hidden', !shown);
  }

  setMission(mission: Mission, target: PadInfo | null): void {
    this.targetPad = target;
    this.missionText.innerText = `MISSION ${String(mission.id).padStart(2, '0')} / 30`;
    this.payloadText.innerText = `${mission.payload.name.toUpperCase()} · ${mission.payload.mass.toFixed(1)}t`;

    if (target) {
      const corp = CORPS[target.corp];
      this.targetText.innerText = `→ ${target.id.replace(/-/g, ' ').toUpperCase()}`;
      this.targetText.style.color = hex(corp.color);
      this.marker.style.setProperty('--corp', hex(corp.color));
    } else {
      this.targetText.innerText = '';
    }
  }

  updateHud(data: HudData): void {
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

    this.hsText.innerText = data.horizontalSpeed.toFixed(1);
    this.hsText.classList.toggle('danger', data.horizontalSpeed > LANDER.MAX_LANDING_SPEED);

    const deg = (data.tilt * 180) / Math.PI;
    this.tiltNeedle.style.transform = `rotate(${-deg}deg)`;
    this.tiltDial.classList.toggle('danger', Math.abs(data.tilt) > LANDER.MAX_LANDING_TILT);

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
