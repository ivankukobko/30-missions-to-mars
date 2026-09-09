import type { Scheme } from './InstrumentPanel.ts';

/**
 * The one-time "here is where the controls are" hint, shown over the uplink hold on a
 * touch device and gone the instant control is handed over.
 *
 * It draws the three zones `InputManager` reads flight from — screen thirds, left /
 * middle / right — as full-height columns with a label apiece. It never handles a touch
 * itself: the zones are read off raw coordinates, and the element is `pointer-events:
 * none`, so a finger that lands on it during the hold still reaches the window listener
 * underneath. The columns are equal flex children of a full-width row, so their edges
 * fall exactly where `merge()`'s `width / 3` splits are with no shared constant to keep
 * in step.
 *
 * What a side does changes per airframe — rotation on the lander, lateral thrust on the
 * other two — so the labels are keyed on `scheme`. The middle third is the lift engine
 * on every frame, so its label never has to branch on more than the verb.
 *
 * Untested, like `Radio` and `Reticle`: it constructs DOM and holds no logic worth a
 * jsdom dependency. When it shows and hides, and the once-ever gate, live in `Game` and
 * `Progress`, which are covered.
 */
const LABELS: Record<Scheme, readonly [string, string, string]> = {
  attitude: ['‹ ROTATE', 'THRUST ▲', 'ROTATE ›'],
  differential: ['‹ GO LEFT', 'UP ▲', 'GO RIGHT ›'],
  translation: ['‹ SLIDE', 'LIFT ▲', 'SLIDE ›'],
};

export class TouchHint {
  readonly root: HTMLElement;
  private readonly labels: HTMLElement[] = [];

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

    const caption = document.createElement('div');
    caption.className = 'touch-hint-caption';
    // The interaction model in three words: these are held, not tapped, and two at once
    // is the point — which the vehicle then teaches live once the controls wake up.
    caption.textContent = 'HOLD TO FLY';
    this.root.append(caption);
  }

  show(scheme: Scheme): void {
    const text = LABELS[scheme];
    for (let i = 0; i < 3; i++) this.labels[i].textContent = text[i];
    this.root.classList.add('visible');
  }

  hide(): void {
    this.root.classList.remove('visible');
  }
}
