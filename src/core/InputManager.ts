export interface InputState {
  /** Rotate counter-clockwise — nose to the left. */
  left: boolean;
  /** Rotate clockwise — nose to the right. */
  right: boolean;
  main: boolean;
}

/**
 * Whether this device flies the game by touch, so the caller can decide if the first-run
 * zone hint is worth showing. `maxTouchPoints` is the load-bearing signal — a trackpad
 * reports 0, a phone reports 5 — and the coarse-pointer query is a fallback for engines
 * that leave `maxTouchPoints` at 0. Guarded for a non-browser context so a test can
 * import this module without a DOM.
 */
export function hasTouchPointer(): boolean {
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

/**
 * Whether a touch landed on the canyon rather than on anything else.
 *
 * With the listeners on the flight surface a control touch never gets here — the UI is a
 * sibling of `#app`, not inside it — so today this only ever sees the canvas. It stays
 * as the check that decides the cancel regardless, because the surface is a container:
 * the day something with its own gesture is put inside `#app`, it is left alone rather
 * than silently losing its clicks.
 *
 * Tag name rather than `instanceof HTMLCanvasElement`: this module is imported by a test
 * that runs with no DOM at all, where that constructor is not a global.
 */
function onCanyon(target: EventTarget | null): boolean {
  return (target as Element | null)?.tagName === 'CANVAS';
}

/**
 * Keyboard and multi-touch, normalised to one state object.
 *
 * Touch layout: three vertical thirds of the screen, each its own zone rather than a
 * state derived from the others. Middle is always the "forward" control — the main
 * engine, or both engines on the differential scheme — and left/right mean whatever
 * `LanderBody.step` does with `input.left`/`right` on the flown airframe: rotation on
 * the attitude craft, lateral thrust on the other two. The zones themselves never
 * move, so the schema is one thing to learn regardless of which vehicle is loaded;
 * only what a side does changes, and the panel and the vehicle's own response teach
 * that live.
 *
 * Three independent zones rather than the old "hold both halves at once" trick for
 * main: that scheme read as one flag derived from two touches, so a hand was either
 * entirely on one half or straddling both, and it could not reproduce the keyboard's
 * Left+Up — which `applyAttitude`'s own comment calls "the whole skill of a lander."
 * A touch in the middle third and a touch in a side third are unrelated inputs, so
 * they combine exactly like two keys do. No on-screen buttons stealing canyon either
 * way — the zones are read off raw coordinates, never drawn.
 *
 * **The touch listeners are not passive, and that is the point.** iOS reads a
 * press-and-hold on the canyon as the opening of a *system* gesture — selection, the
 * callout, the magnifier — and when it takes a gesture over it fires `touchcancel`.
 * `touchcancel` drops the touch below, so `main` goes false inside the long-press
 * threshold and thrust reads as though it never engaged. The magnifier and the dead
 * throttle are one fault, not two.
 *
 * The `user-select`, `-webkit-touch-callout` and `touch-action: none` already on the
 * document in `style.css` are necessary and not sufficient: they state an intent, while
 * `preventDefault` on `touchstart` is the answer to the browser's own question of whose
 * gesture this is. A passive listener cannot answer it — passive *is* the promise not to
 * cancel — and iOS has defaulted `touchstart` and `touchmove` on `window` to passive
 * since 11.3, so `{ passive: false }` has to be spelled out rather than merely not asking
 * for `true`.
 *
 * **Touch is read off the flight surface, not the window.** Two costs of `window`, both
 * found after the listener went non-passive there. A non-passive `touchmove` on `window`
 * sits on every touch's path, so the browser could no longer scroll the mission grid or
 * the settings list without first waiting on a main thread that is busy rendering the
 * canyon. And every touch on the page was read as flight: the pause button sits in a
 * screen third like anything else, and `click` lands after `touchend`, so tapping it
 * steered the vehicle for as long as the finger was down. The UI lives in `#ui-layer`,
 * a sibling of `#app`, so on the surface neither can happen — a control touch never
 * reaches this class at all. Touch events keep the target they started on for their
 * whole life, which is why `touchend` and `touchcancel` can live there too: a thumb that
 * lands on the canyon and lifts over a button still ends here.
 *
 * Keyboard and `blur` stay on `window`. Neither has a hit target to be scoped to.
 *
 * **A frame with no side authority has one control.** See `setSideControl`.
 */
export class InputManager {
  private state: InputState = { left: false, right: false, main: false };
  private keys = { left: false, right: false, main: false };
  private touches = new Map<number, number>();
  private disposers: (() => void)[] = [];
  private sides = true;

  /** `surface` is the element the canyon is drawn in — `#app`, never the window. */
  constructor(surface: EventTarget) {
    this.bind(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.bind(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.bind(window, 'blur', () => this.releaseAll());

    for (const type of ['touchstart', 'touchmove'] as const) {
      this.bind(
        surface,
        type,
        (e) => {
          const te = e as TouchEvent;
          if (onCanyon(te.target)) e.preventDefault();
          for (let i = 0; i < te.changedTouches.length; i++) {
            const t = te.changedTouches[i];
            this.touches.set(t.identifier, t.clientX);
          }
          this.merge();
        },
        { passive: false },
      );
    }

    for (const type of ['touchend', 'touchcancel'] as const) {
      this.bind(surface, type, (e) => {
        const te = e as TouchEvent;
        for (let i = 0; i < te.changedTouches.length; i++) {
          this.touches.delete(te.changedTouches[i].identifier);
        }
        this.merge();
      });
    }
  }

  private bind(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options: AddEventListenerOptions = { passive: true },
  ): void {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.keys.left = down;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.keys.right = down;
        break;
      case 'ArrowUp':
      case 'KeyW':
      case 'Space':
        this.keys.main = down;
        break;
      default:
        return;
    }
    this.merge();
  }

  private releaseAll(): void {
    this.keys.left = this.keys.right = this.keys.main = false;
    this.touches.clear();
    this.merge();
  }

  /**
   * Whether left and right mean anything on the flown frame — `hasSideControl`.
   *
   * Off, the vehicle has exactly one control, on every device. The whole screen is the
   * throttle, because a zone that does nothing is a third of the glass a first-time pilot
   * can press and get no answer from — and on the relay, which is mission one, that is
   * the first thing they ever touch. Left and right are dropped from the keyboard too
   * rather than passed through for the physics to ignore: the physics ignored them, but
   * the jets still lit and the side-jet sound still played, so a vehicle that cannot turn
   * looked and sounded as though it was trying to.
   *
   * Set per mission, so it follows retries and the airframe changes between missions.
   */
  setSideControl(live: boolean): void {
    this.sides = live;
    this.merge();
  }

  private merge(): void {
    if (!this.sides) {
      this.state.left = false;
      this.state.right = false;
      this.state.main = this.keys.main || this.touches.size > 0;
      return;
    }

    const width = window.innerWidth;
    let zoneLeft = false;
    let zoneMid = false;
    let zoneRight = false;
    for (const clientX of this.touches.values()) {
      if (clientX < width / 3) zoneLeft = true;
      else if (clientX > (2 * width) / 3) zoneRight = true;
      else zoneMid = true;
    }

    this.state.left = this.keys.left || zoneLeft;
    this.state.right = this.keys.right || zoneRight;
    this.state.main = this.keys.main || zoneMid;
  }

  getState(): InputState {
    return this.state;
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
