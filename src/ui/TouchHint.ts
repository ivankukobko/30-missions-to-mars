import type { Scheme } from './InstrumentPanel.ts';
import { t } from '../i18n/I18n.ts';

/**
 * The "here is where the controls are" hint, shown over every uplink hold on a touch
 * device and gone the instant control is handed over.
 *
 * It draws the three zones `InputManager` reads flight from — screen thirds, left /
 * middle / right — as full-height columns with a label apiece. It never handles a touch
 * itself: the zones are read off raw coordinates, and the element is `pointer-events:
 * none`, so a finger that lands on it during the hold falls through to the canvas and
 * the flight listener on it. The columns are equal flex children of a full-width row, so their edges
 * fall exactly where `merge()`'s `width / 3` splits are with no shared constant to keep
 * in step.
 *
 * What a side does changes per airframe — rotation on the lander, lateral thrust on the
 * other two — so the labels are keyed on `scheme`. The middle third is the lift engine
 * on every frame, so its label never has to branch on more than the verb.
 *
 * The words are looked up on every `show` rather than once at construction, so a language
 * changed from the pause menu is on the next hold's hint without the hint being rebuilt.
 *
 * Untested, like `Radio` and `Reticle`: it constructs DOM and holds no logic worth a
 * jsdom dependency. When it shows and hides, and the once-ever gate, live in `Game` and
 * `Progress`, which are covered.
 */
const LABEL_KEYS: Record<Scheme, readonly [string, string, string]> = {
  attitude: ['touch_hint.rotate_left', 'touch_hint.thrust', 'touch_hint.rotate_right'],
  differential: ['touch_hint.go_left', 'touch_hint.up', 'touch_hint.go_right'],
  translation: ['touch_hint.slide_left', 'touch_hint.lift', 'touch_hint.slide_right'],
};

export class TouchHint {
  readonly root: HTMLElement;
  private readonly labels: HTMLElement[] = [];
  private readonly caption: HTMLElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'touch-hint';
    // Decoration for a sighted player mid-handshake, not content: a screen reader
    // announcing three zone names over "UPLINK ESTABLISHING" is noise.
    this.root.setAttribute('aria-hidden', 'true');

    for (let i = 0; i < 3; i++) {
      const zone = document.createElement('div');
      zone.className =
        i === 1 ? 'touch-hint-zone touch-hint-zone--main' : 'touch-hint-zone';
      const label = document.createElement('div');
      label.className = 'touch-hint-label';
      zone.append(label);
      this.root.append(zone);
      this.labels.push(label);
    }

    // The interaction model in three words: these are held, not tapped, and two at once
    // is the point — which the vehicle then teaches live once the controls wake up.
    this.caption = document.createElement('div');
    this.caption.className = 'touch-hint-caption';
    this.root.append(this.caption);
  }

  /**
   * `sides` false is the one-control frame — see `InputManager.setSideControl`, which
   * makes the whole screen the throttle. The hint says the same thing by drawing one
   * column across the full width with the middle label on it, rather than three columns
   * of which two would be lying.
   */
  show(scheme: Scheme, sides: boolean): void {
    const keys = LABEL_KEYS[scheme];
    for (let i = 0; i < 3; i++) this.labels[i].textContent = t(keys[i]);
    this.caption.textContent = t('touch_hint.caption');
    this.root.classList.toggle('touch-hint--single', !sides);
    this.root.classList.add('visible');
  }

  hide(): void {
    this.root.classList.remove('visible');
  }
}
