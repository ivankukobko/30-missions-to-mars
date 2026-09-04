import { describe, it, expect } from 'vitest';
import { PhysicsWorld, type Segment } from './PhysicsWorld.ts';

/** A horizontal deck at `y`, spanning `x1..x2`. */
function deck(y: number, x1 = -10, x2 = 10, kind: Segment['kind'] = 'pad'): Segment {
  return { x1, y1: y, x2, y2: y, kind, padId: kind === 'pad' ? 'test-pad' : undefined };
}

describe('PhysicsWorld.sweep', () => {
  /**
   * The reason this class exists. With instant death on contact, a missed contact is
   * not a graze — it is the lander falling through the world, and the player watching
   * a mission end for no visible reason.
   */
  it('catches a deck the step jumps clean over', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0));

    // One 1/120s step at entry speed moves ~0.52 units, but the worst case is a step
    // far larger than the hull: here the body travels 100 units through a deck it would
    // straddle for none of the endpoints.
    const hit = world.sweep(0, 50, 0, -50, 0.62);

    expect(hit).not.toBeNull();
    expect(hit!.segment.kind).toBe('pad');
  });

  it('catches contact at the speed `docs/architecture.md` claims was verified', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0));

    // 62.8 u/s at the fixed 1/120 timestep.
    const step = 62.8 / 120;
    const hit = world.sweep(0, step / 2, 0, -step / 2, 0.62);

    expect(hit).not.toBeNull();
  });

  it('reports the body position at contact, not the position it was aiming for', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0));

    const radius = 0.62;
    const hit = world.sweep(0, 40, 0, -40, radius);

    expect(hit).not.toBeNull();
    // Stopped above the deck, within one sweep step of resting on it.
    expect(hit!.bodyY).toBeGreaterThan(0);
    expect(hit!.bodyY).toBeLessThanOrEqual(radius + radius * 0.4);
  });

  it('returns a normal pointing away from the surface toward the body', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0));

    const above = world.sweep(0, 40, 0, 0.3, 0.62);
    expect(above).not.toBeNull();
    expect(above!.ny).toBeGreaterThan(0.55);

    // Approaching the same deck from underneath must report a downward normal, which is
    // what lets Lander reject "landing" on a pad's underside.
    const below = world.sweep(0, -40, 0, -0.3, 0.62);
    expect(below).not.toBeNull();
    expect(below!.ny).toBeLessThan(0);
  });

  it('misses when the motion passes beside the segment', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0, -10, 10));

    // Well clear of the deck's x range, and further than the hull radius from its end.
    expect(world.sweep(40, 50, 40, -50, 0.62)).toBeNull();
  });

  it('finds the first contact along the motion, not the nearest to the destination', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(100, -10, 10, 'structure'));
    world.add(deck(0));

    const hit = world.sweep(0, 200, 0, -50, 0.62);

    expect(hit).not.toBeNull();
    // Falling from 200, the structure at y=100 is met before the pad at y=0.
    expect(hit!.segment.kind).toBe('structure');
  });

  it('detects a vertical wall met head-on', () => {
    const world = new PhysicsWorld(-6);
    world.add({ x1: 5, y1: -50, x2: 5, y2: 50, kind: 'rock' });

    const hit = world.sweep(-20, 0, 20, 0, 0.62);

    expect(hit).not.toBeNull();
    expect(hit!.nx).toBeLessThan(0); // pushed back the way it came
  });
});

describe('PhysicsWorld bucketing', () => {
  /**
   * Buckets are keyed by `Math.floor(x / BUCKET_SIZE)`, and floor on negatives rounds
   * away from zero — the classic place for an off-by-one that silently drops colliders
   * on the west side of the canyon, which is where half the campaign is flown.
   */
  it('finds segments at negative x', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0, -60, -40));

    expect(world.sweep(-50, 30, -50, -30, 0.62)).not.toBeNull();
    expect(world.groundBelow(-50, 30)).toBe(0);
  });

  it('finds a segment spanning many buckets from anywhere along it', () => {
    const world = new PhysicsWorld(-6);
    // BUCKET_SIZE is 8, so this crosses about 50 of them.
    world.add(deck(0, -200, 200, 'rock'));

    for (const x of [-199, -100, -8, 0, 7, 100, 199]) {
      expect(world.sweep(x, 30, x, -30, 0.62), `x=${x}`).not.toBeNull();
    }
  });

  it('clear() empties both the list and the bucket index', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0));
    expect(world.sweep(0, 30, 0, -30, 0.62)).not.toBeNull();

    world.clear();

    expect(world.sweep(0, 30, 0, -30, 0.62)).toBeNull();
    expect(world.groundBelow(0, 30)).toBeNull();
  });
});

describe('PhysicsWorld.groundBelow', () => {
  it('returns the highest surface at or below the query point', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0, -10, 10, 'rock'));
    world.add(deck(20, -10, 10));
    world.add(deck(50, -10, 10, 'structure'));

    expect(world.groundBelow(0, 40)).toBe(20);
    expect(world.groundBelow(0, 10)).toBe(0);
    expect(world.groundBelow(0, 100)).toBe(50);
  });

  it('returns null when nothing is underneath', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0, -10, 10));

    expect(world.groundBelow(0, -5)).toBeNull(); // below everything
    expect(world.groundBelow(500, 100)).toBeNull(); // beside everything
  });

  it('interpolates along a sloping segment', () => {
    const world = new PhysicsWorld(-6);
    world.add({ x1: 0, y1: 0, x2: 10, y2: 10, kind: 'rock' });

    expect(world.groundBelow(5, 100)).toBeCloseTo(5, 6);
    expect(world.groundBelow(2, 100)).toBeCloseTo(2, 6);
  });

  it('ignores a segment the query point is not horizontally within', () => {
    const world = new PhysicsWorld(-6);
    world.add(deck(0, -10, 10));

    expect(world.groundBelow(10.5, 50)).toBeNull();
  });
});

describe('PhysicsWorld builders', () => {
  it('addPolyline chains consecutive points', () => {
    const world = new PhysicsWorld(-6);
    world.addPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 0 },
      ],
      'rock',
    );

    expect(world.groundBelow(5, 50)).toBeCloseTo(2.5, 6);
    expect(world.groundBelow(15, 50)).toBeCloseTo(2.5, 6);
  });

  it('addBox encloses its interior on all four sides', () => {
    const world = new PhysicsWorld(-6);
    world.addBox(0, 0, 5, 5, 'structure');

    // Every approach direction meets a face.
    expect(world.sweep(0, 50, 0, 0, 0.62)).not.toBeNull(); // from above
    expect(world.sweep(0, -50, 0, 0, 0.62)).not.toBeNull(); // from below
    expect(world.sweep(-50, 0, 0, 0, 0.62)).not.toBeNull(); // from the west
    expect(world.sweep(50, 0, 0, 0, 0.62)).not.toBeNull(); // from the east
  });
});
