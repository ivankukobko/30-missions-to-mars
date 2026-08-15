/**
 * The three panels, one per flight scheme.
 *
 * The HUD is diegetic: you are an AI connecting to a vehicle and flying it through the
 * interface it shipped with, so the panel is a fact about the airframe rather than a
 * layer the game draws over it. That premise decides what each one shows — whatever its
 * builder thought mattered — and, more usefully, how each one *behaves*.
 *
 * The behaviour is where the storytelling actually lands. Ixion is a science outpost
 * flying the campaign's oldest frame; Kessler and Helion are extraction charters with
 * newer, purpose-built equipment. So the TD-4's needles lag and swing, and the other two
 * are exact. Four missions of the first, then a Helion panel at mission 5, and the
 * generational gap reads without a line of dialogue.
 *
 * Keyed on `scheme` and not on the client, even though `airframeFor` now makes those
 * agree one-to-one. `scheme` is what an instrument is actually about — `Interface`
 * already drops the tilt dial on that basis — and a mission using the `airframe`
 * override would otherwise render a console belonging to a vehicle it is not flying.
 */

import { LANDER } from '../entities/LanderBody.ts';
import { VELOCITY_SPAN, type HudData } from './HudData.ts';
import {
  NEEDLE_RATE,
  bootPhase,
  bootSweep,
  clearanceRisk,
  clearanceSplit,
  needleOffset,
  pegged,
  settle,
} from './Instruments.ts';

export type Scheme = HudData['scheme'];

export interface InstrumentPanel {
  readonly root: HTMLElement;
  update(data: HudData, dt: number): void;
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

/**
 * Widest the bore ever gets, for the clearance gauge's warning band.
 *
 * Kessler's own dig is 24 across, and the gauge is scaled against half of that: a hauler
 * with 12 units to the nearer wall is dead centre in the widest shaft it will ever fly,
 * which is the only sensible zero for "how close am I to rock".
 */
const BORE_HALF = 12;

// ------------------------------------------------------------------- TD-4

/**
 * A cross-pointer, which is what a panel of this vintage would carry.
 *
 * Two straight needles across one round face: a horizontal one riding up and down for
 * descent rate, a vertical one sliding left and right for drift. Deliberately *not* one
 * needle on a heading with a speed in the middle — the landing test checks the two axes
 * separately, so a combined magnitude of 2.4 hides whether the vehicle is about to land
 * or about to skid sideways off the pad. The archaism is the idiom, never the accuracy:
 * the instrument this imitates was thoroughly old and still kept its axes apart.
 *
 * The tilt ring around the outside replaces the old standalone dial rather than sitting
 * next to it. Two attitude instruments on one panel is one more than the vehicle has
 * attitudes.
 */
class AttitudePanel implements InstrumentPanel {
  readonly root = el('div', 'inst inst-attitude');
  private vNeedle = el('div', 'cp-needle cp-needle-v');
  private hNeedle = el('div', 'cp-needle cp-needle-h');
  private ring = el('div', 'cp-ring');
  private index = el('div', 'cp-index');
  private face = el('div', 'cp-face');

  /** Where the needles actually are, which is not where the vehicle is. */
  private vAt = 0;
  private hAt = 0;

  constructor() {
    this.face.append(this.hNeedle, this.vNeedle, el('div', 'cp-hub'));
    this.ring.append(this.index);
    const dial = el('div', 'cp-dial');
    dial.append(this.ring, this.face);
    this.root.append(dial, el('div', 'inst-label', 'VEL'));
  }

  update(data: HudData, dt: number): void {
    if (data.scheme !== 'attitude') return;

    const sweep = bootSweep(bootPhase(data.consoleTime));
    const live = sweep === 0;

    // During the self-test the needles are driven to their stops and released, so what
    // they chase is the sweep rather than the vehicle. They settle either way, which is
    // what makes the test look mechanical instead of scripted.
    const vTarget = live ? needleOffset(data.verticalSpeed, VELOCITY_SPAN) : -sweep;
    const hTarget = live ? needleOffset(data.horizontalSpeed, VELOCITY_SPAN) : sweep;

    this.vAt = settle(this.vAt, vTarget, NEEDLE_RATE.archaic, dt);
    this.hAt = settle(this.hAt, hTarget, NEEDLE_RATE.archaic, dt);

    // Positive vertical speed is up, and up the face is negative in screen space.
    this.hNeedle.style.transform = `translateY(${-this.vAt * 42}%)`;
    this.vNeedle.style.transform = `translateX(${this.hAt * 42}%)`;

    const fast = Math.abs(data.horizontalSpeed) > LANDER.MAX_LANDING_SPEED;
    const dropping =
      data.verticalSpeed < 0 && Math.abs(data.verticalSpeed) > LANDER.MAX_LANDING_SPEED;
    this.hNeedle.classList.toggle('danger', live && dropping);
    this.vNeedle.classList.toggle('danger', live && fast);
    this.face.classList.toggle(
      'pegged',
      live && (pegged(data.verticalSpeed, VELOCITY_SPAN) || pegged(data.horizontalSpeed, VELOCITY_SPAN)),
    );

    const deg = (data.tilt * 180) / Math.PI;
    this.index.style.transform = `rotate(${-deg}deg)`;
    this.ring.classList.toggle('danger', Math.abs(data.tilt) > LANDER.MAX_LANDING_TILT);
  }
}

// ------------------------------------------------------------------- KD-9

/**
 * Two lamps and a clearance bar. Industrial, high contrast, no glass.
 *
 * Lamps rather than power meters because `Firing.engines` is a boolean array — there is
 * no throttle anywhere in this vehicle's physics, and an analog bar would be drawing a
 * quantity the simulation does not have.
 *
 * The clearance gauge replaces the tilt dial this frame does not need. It reads a
 * *position* across the bore rather than a pair of distances, so dead centre stays dead
 * centre as the bore narrows on the way down — which it does, by construction.
 */
class DifferentialPanel implements InstrumentPanel {
  readonly root = el('div', 'inst inst-differential');
  private port = el('div', 'eng-lamp');
  private stbd = el('div', 'eng-lamp');
  private bias = el('div', 'eng-bias');
  private gauge = el('div', 'bore-gauge');
  private mark = el('div', 'bore-mark');

  private markAt = 0.5;

  constructor() {
    const row = el('div', 'eng-row');
    row.append(this.port, this.bias, this.stbd);

    const track = el('div', 'bore-track');
    track.append(this.mark);
    this.gauge.append(track, el('div', 'inst-label', 'BORE'));

    this.root.append(row, el('div', 'inst-label', 'ENGINES'), this.gauge);
  }

  update(data: HudData, dt: number): void {
    if (data.scheme !== 'differential') return;

    const booting = bootPhase(data.consoleTime) < 1;
    const port = data.engines[0] ?? false;
    const stbd = data.engines[data.engines.length - 1] ?? false;

    // Both lamps during the self-test — a lamp test is the only way a panel can prove a
    // dark lamp means a dead engine rather than a dead bulb.
    this.port.classList.toggle('lit', booting || port);
    this.stbd.classList.toggle('lit', booting || stbd);

    /**
     * Which way the lit engines are shoving the hull. It points; it does not slide.
     *
     * With two engines and no throttle there are exactly three lateral states — port
     * engine pushing starboard, starboard engine pushing port, and no net push at all —
     * so a direction is the whole reading and a position along a track would encode
     * nothing. It was built as a translation first, which had the arrow drifting a few
     * pixels while still pointing the same way, because a CSS border triangle has a
     * fixed direction unless it is rotated.
     *
     * Absent rather than dimmed at zero. A faded arrow still names a direction, and both
     * of the states that land here — nothing lit, and both lit with the horizontals
     * cancelling — have no direction to name. The lamps already separate those two.
     */
    this.bias.classList.toggle('none', data.bias === 0);
    this.bias.style.transform = data.bias < 0 ? 'rotate(180deg)' : 'none';

    // Outside a bore the quantity does not exist, so the gauge goes dark rather than
    // reporting a wall that is not there. The warning has to be cleared on the way out
    // as well: leaving it set parks a red mark under a dimmed gauge for the rest of the
    // climb, which is a wall alarm on a vehicle in open air.
    const clear = data.clearance;
    this.gauge.classList.toggle('offline', clear === null);
    this.gauge.classList.toggle(
      'danger',
      clear !== null && clearanceRisk(clear.left, clear.right, BORE_HALF) > 0.72,
    );
    if (clear) {
      const split = clearanceSplit(clear.left, clear.right);
      this.markAt = settle(this.markAt, split.left, NEEDLE_RATE.modern, dt);
      this.mark.style.left = `${this.markAt * 100}%`;
    }
  }
}

// ------------------------------------------------------------------- HD-7

/**
 * A crosshair on a grid, exact and instantaneous.
 *
 * This frame's whole premise is that its axes are independent — it holds altitude while
 * it translates, and neither input disturbs the other — so a reticle that moves in two
 * uncoupled directions is the reading rather than a decoration. It is also the sharpest
 * available contrast with the TD-4's swinging needles, which is half the point of
 * meeting this panel one mission after that one.
 */
class TranslationPanel implements InstrumentPanel {
  readonly root = el('div', 'inst inst-translation');
  private reticle = el('div', 'xh-reticle');
  private lampLeft = el('div', 'rcs-lamp rcs-left');
  private lampRight = el('div', 'rcs-lamp rcs-right');
  private bankArc = el('div', 'bank-index');
  private grid = el('div', 'xh-grid');

  constructor() {
    this.grid.append(
      el('div', 'xh-axis xh-axis-v'),
      el('div', 'xh-axis xh-axis-h'),
      this.reticle,
    );
    const arc = el('div', 'bank-arc');
    arc.append(this.bankArc);

    const lamps = el('div', 'rcs-row');
    lamps.append(this.lampLeft, el('div', 'inst-label', 'RCS'), this.lampRight);

    this.root.append(arc, this.grid, lamps);
  }

  update(data: HudData, _dt: number): void {
    if (data.scheme !== 'translation') return;

    const sweep = bootSweep(bootPhase(data.consoleTime));
    const live = sweep === 0;

    const x = live ? needleOffset(data.horizontalSpeed, VELOCITY_SPAN) : sweep;
    const y = live ? needleOffset(data.verticalSpeed, VELOCITY_SPAN) : -sweep;

    // No settle. This panel is new enough to draw exactly what it is told, and the
    // absence of lag is the characterisation.
    this.reticle.style.transform = `translate(${x * 46}%, ${-y * 46}%)`;

    const fast =
      Math.abs(data.horizontalSpeed) > LANDER.MAX_LANDING_SPEED ||
      (data.verticalSpeed < 0 && Math.abs(data.verticalSpeed) > LANDER.MAX_LANDING_SPEED);
    this.reticle.classList.toggle('danger', live && fast);

    this.lampLeft.classList.toggle('lit', !live || data.rcsLeft);
    this.lampRight.classList.toggle('lit', !live || data.rcsRight);

    this.bankArc.style.transform = `rotate(${(data.bank * 180) / Math.PI}deg)`;
  }
}

export function createInstrument(scheme: Scheme): InstrumentPanel {
  switch (scheme) {
    case 'attitude':
      return new AttitudePanel();
    case 'differential':
      return new DifferentialPanel();
    case 'translation':
      return new TranslationPanel();
  }
}
