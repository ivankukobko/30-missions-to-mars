export interface InputState {
  /** Rotate counter-clockwise — nose to the left. */
  left: boolean;
  /** Rotate clockwise — nose to the right. */
  right: boolean;
  main: boolean;
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
 */
export class InputManager {
  private state: InputState = { left: false, right: false, main: false };
  private keys = { left: false, right: false, main: false };
  private touches = new Map<number, number>();
  private disposers: (() => void)[] = [];

  constructor() {
    this.bind(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.bind(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.bind(window, 'blur', () => this.releaseAll());

    for (const type of ['touchstart', 'touchmove'] as const) {
      this.bind(window, type, (e) => {
        const te = e as TouchEvent;
        for (let i = 0; i < te.changedTouches.length; i++) {
          const t = te.changedTouches[i];
          this.touches.set(t.identifier, t.clientX);
        }
        this.merge();
      });
    }

    for (const type of ['touchend', 'touchcancel'] as const) {
      this.bind(window, type, (e) => {
        const te = e as TouchEvent;
        for (let i = 0; i < te.changedTouches.length; i++) {
          this.touches.delete(te.changedTouches[i].identifier);
        }
        this.merge();
      });
    }
  }

  private bind(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler, { passive: true });
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

  private merge(): void {
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
