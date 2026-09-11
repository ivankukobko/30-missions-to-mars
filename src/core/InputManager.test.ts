import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager } from './InputManager.ts';

/**
 * A minimal stand-in for the bits of `window` InputManager binds to — and, as a second
 * instance, for the flight surface its touch listeners go on.
 *
 * Deliberately hand-rolled rather than pulling in jsdom: what is under test is the
 * merge table, and a fake that records listeners keeps the test honest about which
 * events the class actually subscribes to.
 */
class FakeWindow {
  innerWidth = 1000;
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  /** Recorded because `{ passive: false }` is load-bearing — see `InputManager`'s header. */
  private options = new Map<string, AddEventListenerOptions | undefined>();

  addEventListener(
    type: string,
    handler: (e: unknown) => void,
    options?: AddEventListenerOptions,
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    this.options.set(type, options);
  }

  optionsFor(type: string): AddEventListenerOptions | undefined {
    return this.options.get(type);
  }

  removeEventListener(type: string, handler: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  get typesBound(): string[] {
    return [...this.listeners.keys()].sort();
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

let fake: FakeWindow;
/** `#app`. A separate target from `fake` so a test can tell which one a listener is on. */
let surface: FakeWindow;
const realWindow = globalThis.window;

beforeEach(() => {
  fake = new FakeWindow();
  surface = new FakeWindow();
  (globalThis as { window?: unknown }).window = fake;
});

const manager = () => new InputManager(surface as unknown as EventTarget);

afterEach(() => {
  if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = realWindow;
});

const key = (code: string) => ({ code });
const touch = (identifier: number, clientX: number) => ({
  changedTouches: { length: 1, 0: { identifier, clientX } },
});

/**
 * A touch carrying the hit-test result iOS would have given it, plus a spy for the one
 * call that decides whether the browser or the game owns the gesture.
 */
const touchOn = (tagName: string, identifier: number, clientX: number) => {
  let prevented = false;
  return {
    ...touch(identifier, clientX),
    target: { tagName },
    preventDefault: () => {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
};

describe('InputManager keyboard', () => {
  it('starts with nothing held', () => {
    const input = manager();

    expect(input.getState()).toEqual({ left: false, right: false, main: false });
  });

  it.each([
    ['ArrowLeft', 'left'],
    ['KeyA', 'left'],
    ['ArrowRight', 'right'],
    ['KeyD', 'right'],
    ['ArrowUp', 'main'],
    ['KeyW', 'main'],
    ['Space', 'main'],
  ])('maps %s to %s', (code, action) => {
    const input = manager();

    fake.emit('keydown', key(code));
    expect(input.getState()[action as keyof ReturnType<typeof input.getState>]).toBe(true);

    fake.emit('keyup', key(code));
    expect(input.getState()[action as keyof ReturnType<typeof input.getState>]).toBe(false);
  });

  it('ignores keys it does not bind', () => {
    const input = manager();

    fake.emit('keydown', key('KeyZ'));

    expect(input.getState()).toEqual({ left: false, right: false, main: false });
  });

  it('allows attitude control under main thrust', () => {
    // Fighting the two against each other is the whole skill of a lander, so these are
    // never mutually exclusive.
    const input = manager();

    fake.emit('keydown', key('Space'));
    fake.emit('keydown', key('KeyA'));

    expect(input.getState()).toEqual({ left: true, right: false, main: true });
  });

  /**
   * Without this, alt-tabbing mid-burn leaves the engine latched on: the keyup lands on
   * a window that is no longer listening, and the lander flies away by itself.
   */
  it('releases everything on blur', () => {
    const input = manager();
    fake.emit('keydown', key('Space'));
    fake.emit('keydown', key('KeyD'));

    fake.emit('blur');

    expect(input.getState()).toEqual({ left: false, right: false, main: false });
  });
});

describe('InputManager touch', () => {
  it('rotates left from a touch in the left third', () => {
    const input = manager();

    surface.emit('touchstart', touch(1, 100));

    expect(input.getState()).toEqual({ left: true, right: false, main: false });
  });

  it('rotates right from a touch in the right third', () => {
    const input = manager();

    surface.emit('touchstart', touch(1, 900));

    expect(input.getState()).toEqual({ left: false, right: true, main: false });
  });

  it('fires the main engine from a touch in the middle third', () => {
    const input = manager();

    surface.emit('touchstart', touch(1, 500));

    expect(input.getState()).toEqual({ left: false, right: false, main: true });
  });

  /**
   * The whole reason for three disjoint zones rather than the old "both halves at
   * once" trick: a side zone and the middle zone are independent touches, so this is
   * a touch player's equivalent of the keyboard's Left+Up — which `applyAttitude`'s
   * own comment calls "the whole skill of a lander," and which the two-zone scheme
   * could never produce.
   */
  it('holds a side zone and the middle zone at the same time', () => {
    const input = manager();

    surface.emit('touchstart', touch(1, 100));
    surface.emit('touchstart', touch(2, 500));

    expect(input.getState()).toEqual({ left: true, right: false, main: true });
  });

  it('drops only the zone whose finger lifted', () => {
    const input = manager();
    surface.emit('touchstart', touch(1, 100));
    surface.emit('touchstart', touch(2, 500));

    surface.emit('touchend', touch(2, 500));

    expect(input.getState()).toEqual({ left: true, right: false, main: false });
  });

  it('tracks a finger dragged from the left third to the right third', () => {
    const input = manager();
    surface.emit('touchstart', touch(1, 100));

    surface.emit('touchmove', touch(1, 900));

    expect(input.getState()).toEqual({ left: false, right: true, main: false });
  });

  it('treats two touches in the same zone as that zone only', () => {
    const input = manager();

    surface.emit('touchstart', touch(1, 100));
    surface.emit('touchstart', touch(2, 200));

    expect(input.getState()).toEqual({ left: true, right: false, main: false });
  });

  it('releases a cancelled touch', () => {
    const input = manager();
    surface.emit('touchstart', touch(1, 100));

    surface.emit('touchcancel', touch(1, 100));

    expect(input.getState()).toEqual({ left: false, right: false, main: false });
  });

  it('scales the three thirds to the live window width', () => {
    const input = manager();
    fake.innerWidth = 300; // thirds at 100 and 200

    surface.emit('touchstart', touch(1, 50));
    expect(input.getState()).toEqual({ left: true, right: false, main: false });

    surface.emit('touchstart', touch(1, 150));
    expect(input.getState()).toEqual({ left: false, right: false, main: true });

    surface.emit('touchstart', touch(1, 250));
    expect(input.getState()).toEqual({ left: false, right: true, main: false });
  });

  it('combines keyboard and touch', () => {
    const input = manager();

    fake.emit('keydown', key('Space'));
    surface.emit('touchstart', touch(1, 100));

    expect(input.getState()).toEqual({ left: true, right: false, main: true });
  });
});

/**
 * The gesture the browser would otherwise have taken for itself.
 *
 * On iOS a press-and-hold on the canyon opens a selection gesture and arrives back as
 * `touchcancel`, which reads to a player as a throttle that never fires. Refusing the
 * default is the only thing that stops it, and a passive listener cannot refuse — so
 * both halves are asserted here: that the listener is registered able to cancel, and
 * that it cancels a canyon touch and leaves a control touch alone.
 */
describe('InputManager gesture ownership', () => {
  for (const type of ['touchstart', 'touchmove'] as const) {
    it(`registers ${type} able to cancel the default`, () => {
      manager();

      expect(surface.optionsFor(type)?.passive).toBe(false);
    });

    it(`cancels a ${type} on the canyon`, () => {
      manager();
      const e = touchOn('CANVAS', 1, 500);

      surface.emit(type, e);

      expect(e.prevented).toBe(true);
    });

    /**
     * No control reaches the surface today — the UI is a sibling of `#app` — so this
     * guards the day something tappable is put inside it. Cancelling there would cancel
     * the `click` iOS synthesises from the touch, and on `touchmove`, any scroll.
     */
    it(`leaves a ${type} on a control alone`, () => {
      manager();
      const e = touchOn('BUTTON', 1, 500);

      surface.emit(type, e);

      expect(e.prevented).toBe(false);
    });
  }

  it('still reads the zone off a cancelled canyon touch', () => {
    const input = manager();

    surface.emit('touchstart', touchOn('CANVAS', 1, 500));

    expect(input.getState()).toEqual({ left: false, right: false, main: true });
  });
});

describe('InputManager lifecycle', () => {
  it('binds keyboard and blur on the window, and the full touch set on the surface', () => {
    manager();

    expect(fake.typesBound).toEqual(['blur', 'keydown', 'keyup']);
    expect(surface.typesBound).toEqual(['touchcancel', 'touchend', 'touchmove', 'touchstart']);
  });

  /**
   * The scope is the fix, so it is asserted on its own. A touch listener on `window` sees
   * every touch on the page: it read a tap on the pause button as a touch in the right
   * third and steered with it, and, being non-passive, it made the browser wait on the
   * main thread before scrolling a menu card. The UI is a sibling of `#app`, so on the
   * surface neither can reach it.
   */
  it('puts no touch listener on the window', () => {
    manager();

    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      expect(fake.count(type), type).toBe(0);
    }
  });

  it('unbinds everything on dispose', () => {
    const input = manager();

    input.dispose();

    for (const type of ['keydown', 'keyup', 'blur']) {
      expect(fake.count(type), type).toBe(0);
    }
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      expect(surface.count(type), type).toBe(0);
    }
  });

  it('stops responding once disposed', () => {
    const input = manager();
    input.dispose();

    fake.emit('keydown', key('Space'));

    expect(input.getState().main).toBe(false);
  });
});

/**
 * The relay: thrust and nothing else. See `InputManager.setSideControl`.
 */
describe('InputManager with one control', () => {
  it('makes a touch in any third the throttle', () => {
    const input = manager();
    input.setSideControl(false);

    for (const x of [100, 500, 900]) {
      surface.emit('touchstart', touch(1, x));
      expect(input.getState(), `x=${x}`).toEqual({ left: false, right: false, main: true });
      surface.emit('touchend', touch(1, x));
    }
  });

  it('cuts the throttle when the last finger lifts', () => {
    const input = manager();
    input.setSideControl(false);
    surface.emit('touchstart', touch(1, 100));
    surface.emit('touchstart', touch(2, 900));

    surface.emit('touchend', touch(1, 100));
    expect(input.getState().main).toBe(true);

    surface.emit('touchend', touch(2, 900));
    expect(input.getState().main).toBe(false);
  });

  /**
   * Dropped, not passed through for the physics to ignore. The physics did ignore them —
   * the relay has no rotation — but the jets still lit and the side-jet sound still
   * played, on a vehicle that could not turn.
   */
  it('drops the side keys', () => {
    const input = manager();
    input.setSideControl(false);

    fake.emit('keydown', key('ArrowLeft'));
    fake.emit('keydown', key('KeyD'));

    expect(input.getState()).toEqual({ left: false, right: false, main: false });
  });

  it('still fires main from the keyboard', () => {
    const input = manager();
    input.setSideControl(false);

    fake.emit('keydown', key('Space'));

    expect(input.getState()).toEqual({ left: false, right: false, main: true });
  });

  /** A finger held through a mission change must not keep its old meaning. */
  it('re-reads what is already held when the mode changes', () => {
    const input = manager();
    surface.emit('touchstart', touch(1, 100));
    expect(input.getState().left).toBe(true);

    input.setSideControl(false);
    expect(input.getState()).toEqual({ left: false, right: false, main: true });

    input.setSideControl(true);
    expect(input.getState()).toEqual({ left: true, right: false, main: false });
  });
});
