import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager } from './InputManager.ts';

/**
 * A minimal stand-in for the bits of `window` InputManager binds to.
 *
 * Deliberately hand-rolled rather than pulling in jsdom: what is under test is the
 * merge table, and a fake that records listeners keeps the test honest about which
 * events the class actually subscribes to.
 */
class FakeWindow {
  innerWidth = 1000;
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, handler: (e: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
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
const realWindow = globalThis.window;

beforeEach(() => {
  fake = new FakeWindow();
  (globalThis as { window?: unknown }).window = fake;
});

afterEach(() => {
  if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = realWindow;
});

const key = (code: string) => ({ code });
const touch = (identifier: number, clientX: number) => ({
  changedTouches: { length: 1, 0: { identifier, clientX } },
});

describe('InputManager keyboard', () => {
  it('starts with nothing held', () => {
    const input = new InputManager();

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
    const input = new InputManager();

    fake.emit('keydown', key(code));
    expect(input.getState()[action as keyof ReturnType<typeof input.getState>]).toBe(true);

    fake.emit('keyup', key(code));
    expect(input.getState()[action as keyof ReturnType<typeof input.getState>]).toBe(false);
  });

  it('ignores keys it does not bind', () => {
    const input = new InputManager();

    fake.emit('keydown', key('KeyZ'));

    expect(input.getState()).toEqual({ left: false, right: false, main: false });
  });

  it('allows attitude control under main thrust', () => {
    // Fighting the two against each other is the whole skill of a lander, so these are
    // never mutually exclusive.
    const input = new InputManager();

    fake.emit('keydown', key('Space'));
    fake.emit('keydown', key('KeyA'));

    expect(input.getState()).toEqual({ left: true, right: false, main: true });
  });

  /**
   * Without this, alt-tabbing mid-burn leaves the engine latched on: the keyup lands on
   * a window that is no longer listening, and the lander flies away by itself.
   */
  it('releases everything on blur', () => {
    const input = new InputManager();
    fake.emit('keydown', key('Space'));
    fake.emit('keydown', key('KeyD'));

    fake.emit('blur');

    expect(input.getState()).toEqual({ left: false, right: false, main: false });
  });
});

describe('InputManager touch', () => {
  it('rotates left from a touch on the left half', () => {
    const input = new InputManager();

    fake.emit('touchstart', touch(1, 100));

    expect(input.getState()).toEqual({ left: true, right: false, main: false });
  });

  it('rotates right from a touch on the right half', () => {
    const input = new InputManager();

    fake.emit('touchstart', touch(1, 900));

    expect(input.getState()).toEqual({ left: false, right: true, main: false });
  });

  it('fires the main engine when both halves are held, and neither thruster', () => {
    const input = new InputManager();

    fake.emit('touchstart', touch(1, 100));
    fake.emit('touchstart', touch(2, 900));

    expect(input.getState()).toEqual({ left: false, right: false, main: true });
  });

  it('falls back to a single thruster when one thumb lifts', () => {
    const input = new InputManager();
    fake.emit('touchstart', touch(1, 100));
    fake.emit('touchstart', touch(2, 900));

    fake.emit('touchend', touch(2, 900));

    expect(input.getState()).toEqual({ left: true, right: false, main: false });
  });

  it('tracks a finger dragged across the midline', () => {
    const input = new InputManager();
    fake.emit('touchstart', touch(1, 100));

    fake.emit('touchmove', touch(1, 900));

    expect(input.getState()).toEqual({ left: false, right: true, main: false });
  });

  it('treats two touches on the same half as that half only', () => {
    const input = new InputManager();

    fake.emit('touchstart', touch(1, 100));
    fake.emit('touchstart', touch(2, 200));

    expect(input.getState()).toEqual({ left: true, right: false, main: false });
  });

  it('releases a cancelled touch', () => {
    const input = new InputManager();
    fake.emit('touchstart', touch(1, 100));

    fake.emit('touchcancel', touch(1, 100));

    expect(input.getState()).toEqual({ left: false, right: false, main: false });
  });

  it('splits on the live window width', () => {
    const input = new InputManager();
    fake.innerWidth = 400;

    fake.emit('touchstart', touch(1, 300)); // right of a 200 midpoint

    expect(input.getState().right).toBe(true);
  });

  it('combines keyboard and touch', () => {
    const input = new InputManager();

    fake.emit('keydown', key('Space'));
    fake.emit('touchstart', touch(1, 100));

    expect(input.getState()).toEqual({ left: true, right: false, main: true });
  });
});

describe('InputManager lifecycle', () => {
  it('binds keyboard, blur and the full touch set', () => {
    new InputManager();

    expect(fake.typesBound).toEqual([
      'blur',
      'keydown',
      'keyup',
      'touchcancel',
      'touchend',
      'touchmove',
      'touchstart',
    ]);
  });

  it('unbinds everything on dispose', () => {
    const input = new InputManager();

    input.dispose();

    for (const type of ['keydown', 'keyup', 'blur', 'touchstart', 'touchmove', 'touchend']) {
      expect(fake.count(type), type).toBe(0);
    }
  });

  it('stops responding once disposed', () => {
    const input = new InputManager();
    input.dispose();

    fake.emit('keydown', key('Space'));

    expect(input.getState().main).toBe(false);
  });
});
