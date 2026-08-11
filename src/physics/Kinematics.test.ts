import { describe, it, expect } from 'vitest';
import {
  KinematicBody,
  KinematicWorld,
  maxSafeSpeed,
  offsetAt,
  peakSpeed,
  type Motion,
} from './Kinematics.ts';
import { PhysicsWorld } from './PhysicsWorld.ts';
import { LANDER, LanderBody } from '../entities/LanderBody.ts';
import type { InputState } from '../core/InputManager.ts';

const DT = 1 / 120;
const IDLE: InputState = { left: false, right: false, main: false };

describe('offsetAt', () => {
  it('starts at the authored position', () => {
    // Adding motion to a prop must not move where it nominally is, or every hand-placed
    // coordinate in the campaign quietly changes meaning.
    expect(offsetAt({ dx: 10, dy: 4, period: 8 }, 0)).toEqual({ x: 0, y: 0 });
  });

  it('reaches its amplitude at a quarter cycle and returns at a half', () => {
    const motion: Motion = { dx: 10, period: 8 };

    expect(offsetAt(motion, 2).x).toBeCloseTo(10, 9);
    expect(offsetAt(motion, 4).x).toBeCloseTo(0, 9);
    expect(offsetAt(motion, 6).x).toBeCloseTo(-10, 9);
  });

  it('never exceeds its amplitude', () => {
    const motion: Motion = { dx: 7, dy: 3, period: 5 };

    for (let t = 0; t < 40; t += 0.01) {
      const o = offsetAt(motion, t);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(7 + 1e-9);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(3 + 1e-9);
    }
  });

  it('repeats exactly every period', () => {
    const motion: Motion = { dx: 6, dy: 2, period: 9, phase: 0.3 };

    for (const t of [0, 1.7, 4.2, 8.9]) {
      expect(offsetAt(motion, t + 9).x).toBeCloseTo(offsetAt(motion, t).x, 9);
      expect(offsetAt(motion, t + 27).y).toBeCloseTo(offsetAt(motion, t).y, 9);
    }
  });

  it('puts two identical structures out of step when given different phases', () => {
    const a: Motion = { dx: 10, period: 8 };
    const b: Motion = { dx: 10, period: 8, phase: 0.5 };

    expect(offsetAt(a, 2).x).toBeCloseTo(-offsetAt(b, 2).x, 9);
  });

  /**
   * A triangle wave reverses instantaneously, which is both a physics problem — infinite
   * acceleration between two substeps — and an unreadable one for a pilot judging when a
   * lethal surface will turn.
   */
  it('eases into its reversals rather than snapping', () => {
    const motion: Motion = { dx: 10, period: 8 };
    const speedAt = (t: number) => Math.abs(offsetAt(motion, t + 1e-4).x - offsetAt(motion, t).x);

    // Slowest at the ends of the stroke, fastest through the middle.
    expect(speedAt(2)).toBeLessThan(speedAt(0));
    expect(speedAt(6)).toBeLessThan(speedAt(4));
  });

  it('holds still given a nonsensical period', () => {
    expect(offsetAt({ dx: 10, period: 0 }, 3)).toEqual({ x: 0, y: 0 });
    expect(offsetAt({ dx: 10, period: -5 }, 3)).toEqual({ x: 0, y: 0 });
  });

  it('is a pure function of time', () => {
    const motion: Motion = { dx: 6, dy: 2, period: 9, phase: 0.3 };

    // Evaluated in a different order, out of sequence, from a fresh call — same answer.
    expect(offsetAt(motion, 3.25)).toEqual(offsetAt(motion, 3.25));
  });
});

describe('peakSpeed and the pass-through bound', () => {
  it('matches the analytic peak of the stroke', () => {
    // A sine of amplitude A and period T peaks at 2*pi*A/T.
    expect(peakSpeed({ dx: 10, period: 8 })).toBeCloseTo((2 * Math.PI * 10) / 8, 9);
  });

  it('combines both axes', () => {
    expect(peakSpeed({ dx: 3, dy: 4, period: 10 })).toBeCloseTo((2 * Math.PI * 5) / 10, 9);
  });

  it('is the hull diameter per substep', () => {
    // Below this, a moving surface cannot be between two poses that both clear the hull.
    expect(maxSafeSpeed(LANDER.RADIUS, DT)).toBeCloseTo(2 * 0.62 * 120, 6);
    expect(maxSafeSpeed(LANDER.RADIUS, DT)).toBeGreaterThan(148);
  });

  it('leaves plausible colony machinery far inside the limit', () => {
    const limit = maxSafeSpeed(LANDER.RADIUS, DT);

    // A deck traversing 20 units in 16 seconds, and a brisk hoist.
    expect(peakSpeed({ dx: 20, period: 16 })).toBeLessThan(limit / 10);
    expect(peakSpeed({ dy: 12, period: 6 })).toBeLessThan(limit / 10);
  });

  it('reports a structure that is too fast to collide honestly', () => {
    const world = new KinematicWorld();
    world.add(new KinematicBody({ dx: 20, period: 16 })); // fine
    world.add(new KinematicBody({ dx: 200, period: 1 })); // 1257 u/s

    expect(world.unsafeAt(LANDER.RADIUS, DT)).toEqual([1]);
  });

  it('reports nothing when every structure is safe', () => {
    const world = new KinematicWorld();
    world.add(new KinematicBody({ dx: 20, period: 16 }));

    expect(world.unsafeAt(LANDER.RADIUS, DT)).toEqual([]);
  });
});

describe('KinematicBody colliders', () => {
  it('registers its segments with the world', () => {
    const physics = new PhysicsWorld(-6);
    const body = new KinematicBody({ dx: 5, period: 10 });

    body.box(physics, 0, 0, 5, 1, 'structure');

    expect(physics.movingCount).toBe(4);
  });

  it('moves its colliders with it', () => {
    const physics = new PhysicsWorld(-6);
    const body = new KinematicBody({ dx: 10, period: 8 });
    body.box(physics, 0, 50, 5, 1, 'structure');

    // At rest the deck spans -5..5, so a probe at x=30 finds nothing.
    expect(physics.groundBelow(30, 100)).toBeNull();

    // A quarter cycle later it has traversed its full amplitude.
    body.update(2);

    expect(physics.groundBelow(0, 100)).toBeNull();
    expect(physics.groundBelow(10, 100)).toBeCloseTo(51, 6);
  });

  it('returns to exactly where it started after a full cycle', () => {
    const physics = new PhysicsWorld(-6);
    const body = new KinematicBody({ dx: 10, dy: 3, period: 8 });
    body.box(physics, 0, 50, 5, 1, 'structure');

    const rest = physics.groundBelow(0, 100);
    body.update(3.7);
    body.update(8);

    // No accumulated drift: poses are absolute, never integrated.
    expect(physics.groundBelow(0, 100)).toBeCloseTo(rest!, 9);
  });

  it('does not drift however many times it is stepped', () => {
    const physics = new PhysicsWorld(-6);
    const body = new KinematicBody({ dx: 10, period: 8 });
    body.box(physics, 0, 50, 5, 1, 'structure');

    for (let i = 1; i <= 10_000; i++) body.update(i * DT);
    body.update(0);

    expect(physics.groundBelow(0, 100)).toBeCloseTo(51, 9);
  });
});

describe('the lander against moving geometry', () => {
  /** Drops a lander from `from` onto whatever is in `physics`, in a gravity-free world. */
  function drop(physics: PhysicsWorld, from: number, speed = 0.2, steps = 6000) {
    const body = new LanderBody({ name: 'Test', mass: 0.5 }, 400);
    body.y = from;
    body.vy = -speed;
    for (let i = 0; i < steps; i++) {
      const contact = body.step(DT, IDLE, physics);
      if (contact.type !== 'none') return { body, contact };
    }
    return { body, contact: { type: 'none' } as const };
  }

  it('collides with a moving deck exactly as with a static one', () => {
    const physics = new PhysicsWorld(0);
    const body = new KinematicBody({ dx: 10, period: 8 });
    body.box(physics, 0, 0, 5, 1, 'structure');
    body.update(0);

    expect(drop(physics, 5).contact.type).toBe('crashed');
  });

  it('misses a deck that has traversed out of the way', () => {
    const physics = new PhysicsWorld(0);
    const body = new KinematicBody({ dx: 40, period: 8 });
    body.box(physics, 0, 0, 5, 1, 'structure');

    // A quarter cycle: the deck is 40 units east and no longer under the drop.
    body.update(2);

    expect(drop(physics, 5, 0.2, 2000).contact.type).toBe('none');
  });

  it('still finds the static world underneath', () => {
    const physics = new PhysicsWorld(0);
    physics.add({ x1: -40, y1: -20, x2: 40, y2: -20, kind: 'rock' });
    const body = new KinematicBody({ dx: 40, period: 8 });
    body.box(physics, 0, 0, 5, 1, 'structure');
    body.update(2); // moved clear

    const { contact } = drop(physics, 5, 0.2, 20000);

    expect(contact.type).toBe('crashed');
    if (contact.type !== 'crashed') return;
    expect(contact.hit.segment.kind).toBe('rock');
  });

  /**
   * The bound in action. A surface travelling under the limit is caught wherever the
   * lander meets it; the sweep never has to know the obstacle was moving.
   */
  it('catches a deck moving toward the lander at the top of its safe range', () => {
    const limit = maxSafeSpeed(LANDER.RADIUS, DT);
    // A hoist rising at ~half the bound, which is already absurdly fast for a crane.
    const motion: Motion = { dy: 30, period: (2 * Math.PI * 30) / (limit * 0.5) };
    expect(peakSpeed(motion)).toBeLessThan(limit);

    const physics = new PhysicsWorld(0);
    const body = new KinematicBody(motion);
    body.box(physics, 0, 0, 5, 1, 'structure');

    // Hold the lander still and drive the deck up into it. Parked inside the stroke:
    // the deck's top rises from 1 to 31, so 25 is somewhere it genuinely passes through.
    const lander = new LanderBody({ name: 'Test', mass: 0.5 }, 400);
    lander.y = 25;
    lander.vy = 0;

    let hit = false;
    for (let i = 1; i <= 400 && !hit; i++) {
      body.update(i * DT);
      hit = lander.step(DT, IDLE, physics).type !== 'none';
    }

    expect(hit).toBe(true);
  });
});

describe('KinematicWorld', () => {
  it('advances every body to the same time', () => {
    const world = new KinematicWorld();
    const a = world.add(new KinematicBody({ dx: 10, period: 8 }));
    const b = world.add(new KinematicBody({ dx: 10, period: 8, phase: 0.25 }));

    world.update(2);

    expect(a.offset.x).toBeCloseTo(10, 9);
    expect(b.offset.x).toBeCloseTo(0, 9);
  });

  it('reports the fastest structure in the mission', () => {
    const world = new KinematicWorld();
    world.add(new KinematicBody({ dx: 5, period: 10 }));
    world.add(new KinematicBody({ dx: 40, period: 10 }));

    expect(world.peakSpeed).toBeCloseTo(peakSpeed({ dx: 40, period: 10 }), 9);
  });

  it('is empty and harmless with no bodies', () => {
    const world = new KinematicWorld();

    expect(world.count).toBe(0);
    expect(world.peakSpeed).toBe(0);
    expect(() => world.update(5)).not.toThrow();
  });

  it('drops everything on clear, so a mission cannot inherit the last one', () => {
    const world = new KinematicWorld();
    world.add(new KinematicBody({ dx: 10, period: 8 }));

    world.clear();

    expect(world.count).toBe(0);
  });

  /**
   * The property the campaign rests on. Two runs of the same mission must pose the
   * colony identically at the same point in the descent — otherwise retrying a crash
   * gives you a different world and the failure was never yours to learn from.
   */
  it('reproduces a run exactly when replayed', () => {
    const poses = (steps: number) => {
      const world = new KinematicWorld();
      const deck = world.add(new KinematicBody({ dx: 14, dy: 5, period: 11, phase: 0.37 }));
      const out: number[] = [];
      let t = 0;
      for (let i = 0; i < steps; i++) {
        t += DT;
        world.update(t);
        out.push(deck.offset.x, deck.offset.y);
      }
      return out;
    };

    expect(poses(900)).toEqual(poses(900));
  });

  it('gives the same pose at the same mission time whatever the frame rate', () => {
    // The clock counts fixed steps, so a machine drawing 30 fps and one drawing 144
    // reach a given mission time having posed the world the same way.
    const at = (seconds: number) => {
      const world = new KinematicWorld();
      const deck = world.add(new KinematicBody({ dx: 14, period: 11 }));
      let t = 0;
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        t += DT;
        world.update(t);
      }
      return deck.offset.x;
    };

    expect(at(3)).toBeCloseTo(offsetAt({ dx: 14, period: 11 }, 3).x, 6);
  });
});
