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
 * Touch layout: the left half of the screen rotates left, the right half rotates
 * right, and holding both fires the main engine — so one thumb steers and two thumbs
 * burn, with no on-screen buttons stealing canyon.
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
    const mid = window.innerWidth / 2;
    let touchLeft = false;
    let touchRight = false;
    for (const clientX of this.touches.values()) {
      if (clientX < mid) touchLeft = true;
      else touchRight = true;
    }
    const bothHalves = touchLeft && touchRight;

    this.state.left = this.keys.left || (touchLeft && !bothHalves);
    this.state.right = this.keys.right || (touchRight && !bothHalves);
    this.state.main = this.keys.main || bothHalves;
  }

  getState(): InputState {
    return this.state;
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
