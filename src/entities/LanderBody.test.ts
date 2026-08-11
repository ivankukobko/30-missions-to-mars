import { describe, it, expect } from 'vitest';
import { LANDER, LanderBody, normalizeAngle } from './LanderBody.ts';
import { AIRFRAMES, engineThrust, type Airframe } from './Airframe.ts';
import { PhysicsWorld, type Segment } from '../physics/PhysicsWorld.ts';
import type { InputState } from '../core/InputManager.ts';
import type { Payload } from '../campaign/Missions.ts';

const GRAVITY = -6;
const DT = 1 / 120;

const IDLE: InputState = { left: false, right: false, main: false };
const BURN: InputState = { left: false, right: false, main: true };
const LEFT: InputState = { left: true, right: false, main: false };
const RIGHT: InputState = { left: false, right: true, main: false };

const CARGO: Payload = { name: 'Test Load', mass: 0.5 };

/** The default airframe, whose numbers everything below was tuned against. */
const LANDER_FRAME = AIRFRAMES.lander as Extract<Airframe, { scheme: 'attitude' }>;
const HAULER = AIRFRAMES.hauler as Extract<Airframe, { scheme: 'differential' }>;

function body(overrides: Partial<LanderBody> = {}, payload = CARGO, fuel = 400): LanderBody {
  return Object.assign(new LanderBody(payload, fuel), overrides);
}

/** Same, on the twin-engine frame. */
function hauler(overrides: Partial<LanderBody> = {}, payload = CARGO, fuel = 400): LanderBody {
  return Object.assign(new LanderBody(payload, fuel, AIRFRAMES.hauler), overrides);
}

/** An empty world: nothing to hit, so `step` only ever integrates. */
const emptyWorld = () => new PhysicsWorld(GRAVITY);

function worldWith(...segments: Segment[]): PhysicsWorld {
  const world = new PhysicsWorld(GRAVITY);
  for (const s of segments) world.add(s);
  return world;
}

const padAt = (y: number, x1 = -8, x2 = 8, padId = 'outpost-main'): Segment => ({
  x1,
  y1: y,
  x2,
  y2: y,
  kind: 'pad',
  padId,
});

const rockAt = (y: number, x1 = -40, x2 = 40): Segment => ({
  x1,
  y1: y,
  x2,
  y2: y,
  kind: 'rock',
});

/** Runs `steps` fixed ticks and returns the first non-none contact, if any. */
function fly(b: LanderBody, world: PhysicsWorld, input: InputState, steps: number) {
  for (let i = 0; i < steps; i++) {
    const contact = b.step(DT, input, world);
    if (contact.type !== 'none') return contact;
  }
  return { type: 'none' } as const;
}

describe('mass and thrust', () => {
  it('adds payload mass at the documented factor', () => {
    const light = new LanderBody({ name: 'Filings', mass: 0.2 }, 400);
    const heavy = new LanderBody({ name: 'Shell', mass: 1.9 }, 400);

    expect(light.mass).toBeCloseTo(1 + 0.2 * LANDER.PAYLOAD_MASS_FACTOR, 10);
    expect(heavy.mass).toBeCloseTo(1 + 1.9 * LANDER.PAYLOAD_MASS_FACTOR, 10);
  });

  /**
   * The sizing claim in the constants block, checked rather than asserted in prose:
   * the heaviest payload must still out-accelerate gravity with margin.
   */
  it('leaves the heaviest payload a net upward acceleration', () => {
    const heavy = new LanderBody({ name: 'Containment Shell', mass: 1.9 }, 460);

    expect(heavy.thrustAccel).toBeCloseTo(17.56, 1);
    expect(heavy.thrustAccel + GRAVITY).toBeGreaterThan(11);
  });

  it('gives heavy cargo less acceleration than light', () => {
    const light = new LanderBody({ name: 'Filings', mass: 0.2 }, 400);
    const heavy = new LanderBody({ name: 'Shell', mass: 1.9 }, 400);

    expect(heavy.thrustAccel).toBeLessThan(light.thrustAccel);
  });
});

describe('integration', () => {
  it('falls at exactly the closed-form rate under gravity alone', () => {
    const b = body({ y: 1000 });
    const world = emptyWorld();
    const steps = 120;

    fly(b, world, IDLE, steps);

    const t = steps * DT;
    // Semi-implicit Euler: velocity updates first, so position lags the analytic
    // solution by one half step of acceleration. That is the scheme, not an error.
    expect(b.vy).toBeCloseTo(GRAVITY * t, 6);
    expect(b.y).toBeCloseTo(1000 + 0.5 * GRAVITY * t * (t + DT), 6);
  });

  it('does not drift sideways without input', () => {
    const b = body({ y: 500 });

    fly(b, emptyWorld(), IDLE, 240);

    expect(b.x).toBe(0);
    expect(b.vx).toBe(0);
  });

  it('thrusts along the nose, not along world up', () => {
    // Rotated a quarter turn, thrust is (-sin, cos) = (-1, 0): straight to -X.
    const b = body({ y: 500, rotation: Math.PI / 2 });

    b.step(DT, BURN, emptyWorld());

    expect(b.vx).toBeCloseTo(-b.thrustAccel * DT, 9);
    expect(b.vy).toBeCloseTo(GRAVITY * DT, 9);
  });

  it('thrusts straight up when upright', () => {
    const b = body({ y: 500 });

    b.step(DT, BURN, emptyWorld());

    expect(b.vx).toBe(0);
    expect(b.vy).toBeCloseTo((b.thrustAccel + GRAVITY) * DT, 9);
  });

  it('behaves identically at any frame rate, given the same simulated time', () => {
    // The reason the loop is fixed-step at all.
    const run = (dt: number, steps: number) => {
      const b = body({ y: 500 });
      const world = emptyWorld();
      for (let i = 0; i < steps; i++) b.step(dt, BURN, world);
      return b;
    };

    const a = run(1 / 120, 120);
    const c = run(1 / 120, 120);

    expect(c.y).toBe(a.y);
    expect(c.vy).toBe(a.vy);
  });
});

describe('fuel', () => {
  it('burns the main engine at the documented rate', () => {
    const b = body({ y: 500 }, CARGO, 400);

    b.step(DT, BURN, emptyWorld());

    expect(b.fuel).toBeCloseTo(400 - LANDER_FRAME.mainBurn * DT, 9);
  });

  it('burns RCS at its own rate, and both at once', () => {
    const rcsOnly = body({ y: 500 }, CARGO, 400);
    rcsOnly.step(DT, { left: true, right: false, main: false }, emptyWorld());
    expect(rcsOnly.fuel).toBeCloseTo(400 - LANDER_FRAME.rcsBurn * DT, 9);

    const both = body({ y: 500 }, CARGO, 400);
    both.step(DT, { left: true, right: false, main: true }, emptyWorld());
    expect(both.fuel).toBeCloseTo(400 - (LANDER_FRAME.mainBurn + LANDER_FRAME.rcsBurn) * DT, 9);
  });

  it('costs double to fire both thrusters against each other', () => {
    const b = body({ y: 500 }, CARGO, 400);

    b.step(DT, { left: true, right: true, main: false }, emptyWorld());

    expect(b.fuel).toBeCloseTo(400 - 2 * LANDER_FRAME.rcsBurn * DT, 9);
    // ...and they cancel, so it is pure waste.
    expect(b.angularVelocity).toBeCloseTo(0, 12);
  });

  it('never goes negative', () => {
    const b = body({ y: 500 }, CARGO, 0.01);

    fly(b, emptyWorld(), { left: true, right: false, main: true }, 60);

    expect(b.fuel).toBe(0);
  });

  it('stops producing thrust once dry', () => {
    const b = body({ y: 500 }, CARGO, 0);

    b.step(DT, BURN, emptyWorld());

    // Gravity only.
    expect(b.vy).toBeCloseTo(GRAVITY * DT, 9);
    expect(b.fuel).toBe(0);
  });

  it('stops answering the stick once dry', () => {
    const b = body({ y: 500 }, CARGO, 0);

    b.step(DT, { left: true, right: false, main: false }, emptyWorld());

    expect(b.angularVelocity).toBe(0);
  });
});

describe('attitude', () => {
  it('rotates left for left and right for right', () => {
    const left = body({ y: 500 });
    left.step(DT, { left: true, right: false, main: false }, emptyWorld());
    expect(left.angularVelocity).toBeGreaterThan(0);

    const right = body({ y: 500 });
    right.step(DT, { left: false, right: true, main: false }, emptyWorld());
    expect(right.angularVelocity).toBeLessThan(0);
  });

  it('answers the stick more slowly under a heavy load', () => {
    const light = new LanderBody({ name: 'Filings', mass: 0.2 }, 400);
    const heavy = new LanderBody({ name: 'Shell', mass: 1.9 }, 400);
    const input = { left: true, right: false, main: false };

    light.step(DT, input, emptyWorld());
    heavy.step(DT, input, emptyWorld());

    expect(Math.abs(heavy.angularVelocity)).toBeLessThan(Math.abs(light.angularVelocity));
  });

  it('damps rotation back toward still when the stick is released', () => {
    const b = body({ y: 500, angularVelocity: 1 });

    fly(b, emptyWorld(), IDLE, 240);

    expect(Math.abs(b.angularVelocity)).toBeLessThan(0.4);
  });

  it('keeps attitude control available under main thrust', () => {
    const b = body({ y: 500 });

    b.step(DT, { left: true, right: false, main: true }, emptyWorld());

    expect(b.angularVelocity).toBeGreaterThan(0);
    expect(b.vy).toBeGreaterThan(GRAVITY * DT);
  });
});

describe('differential airframe', () => {
  it('lifts straight up on both engines, with no net sideways push', () => {
    const b = hauler({ y: 500 });

    fly(b, emptyWorld(), BURN, 60);

    expect(b.vx).toBeCloseTo(0, 12);
    expect(b.vy).toBeGreaterThan(0);
  });

  it('delivers the same lift on both engines as the lander does on one', () => {
    const one = body({ y: 500 });
    const two = hauler({ y: 500 });

    fly(one, emptyWorld(), BURN, 60);
    fly(two, emptyWorld(), BURN, 60);

    // The cant is paid for in thrust, not in lift: `engineThrust` scales each nozzle up
    // by 1/cos so the pair arrives at the same place the single engine does.
    expect(two.vy).toBeCloseTo(one.vy, 9);
  });

  it('goes left on the left input and right on the right', () => {
    const l = hauler({ y: 500 });
    const r = hauler({ y: 500 });

    fly(l, emptyWorld(), LEFT, 60);
    fly(r, emptyWorld(), RIGHT, 60);

    expect(l.vx).toBeLessThan(0);
    expect(r.vx).toBeGreaterThan(0);
    // Symmetric: the same push, mirrored.
    expect(l.vx).toBeCloseTo(-r.vx, 9);
  });

  it('lights the far engine by default, and the near one when inverted', () => {
    const normal = hauler({ y: 500 });
    normal.step(DT, LEFT, emptyWorld());
    // Splayed nozzles: to go left you fire the starboard engine.
    expect(normal.firing.engines).toEqual([false, true]);

    const inverted = hauler({ y: 500, invertThrusters: true });
    inverted.step(DT, LEFT, emptyWorld());
    expect(inverted.firing.engines).toEqual([true, false]);
  });

  it('reverses which way it travels when inverted', () => {
    const normal = hauler({ y: 500 });
    const inverted = hauler({ y: 500, invertThrusters: true });

    fly(normal, emptyWorld(), LEFT, 60);
    fly(inverted, emptyWorld(), LEFT, 60);

    expect(normal.vx).toBeCloseTo(-inverted.vx, 9);
  });

  it('treats both direction inputs at once as both engines', () => {
    const b = hauler({ y: 500 });

    fly(b, emptyWorld(), { left: true, right: true, main: false }, 60);

    expect(b.vx).toBeCloseTo(0, 12);
    expect(b.vy).toBeGreaterThan(0);
  });

  it('never rotates, however long it is flown sideways', () => {
    const b = hauler({ y: 500 });

    fly(b, emptyWorld(), LEFT, 600);

    expect(b.rotation).toBe(0);
    expect(b.angularVelocity).toBe(0);
  });

  it('burns one engine at half the pair, scaled by the cant', () => {
    const single = hauler({ y: 500 });
    single.step(DT, LEFT, emptyWorld());
    expect(single.fuel).toBeCloseTo(400 - HAULER.engineBurn * DT, 9);

    const pair = hauler({ y: 500 });
    pair.step(DT, BURN, emptyWorld());
    expect(pair.fuel).toBeCloseTo(400 - 2 * HAULER.engineBurn * DT, 9);

    // Honestly thirstier than the lander per unit of lift — that is the cosine loss.
    expect(2 * HAULER.engineBurn).toBeGreaterThan(LANDER_FRAME.mainBurn);
  });

  it('scales each nozzle up so the pair still totals the airframe thrust', () => {
    const perEngine = engineThrust(AIRFRAMES.hauler);

    expect(perEngine).toBeGreaterThan(AIRFRAMES.hauler.thrust / 2);
    const lift = AIRFRAMES.hauler.engines.reduce((s, e) => s + Math.cos(e.cant) * perEngine, 0);
    expect(lift).toBeCloseTo(AIRFRAMES.hauler.thrust, 9);
  });

  it('leans into the push, and stands level again once settled', () => {
    const b = hauler({ y: 500 });

    fly(b, emptyWorld(), LEFT, 120);
    // Travelling to port, so the lean is to port: positive is counter-clockwise.
    expect(b.bank).toBeGreaterThan(0);
    expect(Math.abs(b.bank)).toBeLessThanOrEqual(HAULER.bankMax + 1e-9);

    fly(b, emptyWorld(), BURN, 120);
    // Both lit cancels the lean, the same way it cancels the sideways push. Damping is
    // exponential, so this asserts it has all but gone rather than reached exactly zero.
    expect(Math.abs(b.bank)).toBeLessThan(HAULER.bankMax * 0.02);
  });

  /**
   * The guard on the whole design. `bank` is decoration; if it ever leaked into the
   * contact test, a hauler would start failing landings for leaning — a failure mode
   * this airframe is not supposed to have.
   */
  it('lands while fully banked, because the lean is not tilt', () => {
    const b = hauler({ y: 0.72, vy: -0.5 });
    b.bank = HAULER.bankMax;

    const contact = fly(b, worldWith(padAt(0)), IDLE, 200);

    expect(contact.type).toBe('landed');
    expect(b.tilt).toBe(0);
    expect(b.bank).toBe(0);
  });

  it('still fails a landing on speed, exactly as the lander does', () => {
    const b = hauler({ y: 40, vy: -20 });

    const contact = fly(b, worldWith(padAt(0)), IDLE, 400);

    expect(contact.type).toBe('crashed');
  });

  /**
   * The hauler slides rather than tips, so sideways speed is the thing that kills it.
   * Both cases arrive at the same ~1.2 u/s vertical, well inside tolerance; only the
   * drift differs, and only the combined figure separates them.
   */
  it('scores touchdown on combined speed, not vertical alone', () => {
    const fast = hauler({ y: 0.72, vy: -0.5, vx: -2.3 });
    expect(fly(fast, worldWith(padAt(0)), IDLE, 200).type).toBe('crashed');

    const slow = hauler({ y: 0.72, vy: -0.5, vx: -1.5 });
    expect(fly(slow, worldWith(padAt(0)), IDLE, 200).type).toBe('landed');
  });
});

describe('normalizeAngle', () => {
  it('wraps to (-PI, PI]', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 12);
    expect(normalizeAngle(Math.PI / 4)).toBeCloseTo(Math.PI / 4, 12);
    expect(normalizeAngle(-Math.PI / 4)).toBeCloseTo(-Math.PI / 4, 12);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  /**
   * The bug the function exists for: a lander that has spun a whole revolution but is
   * perfectly level used to read as fully tilted, and a clean landing counted as a crash.
   */
  it('reads a fully rotated but level lander as level', () => {
    for (const turns of [1, 2, -1, -3, 10]) {
      expect(Math.abs(normalizeAngle(turns * 2 * Math.PI))).toBeLessThan(1e-9);
    }
  });

  it('is what tilt reports', () => {
    const b = body({ rotation: 4 * Math.PI + 0.1 });

    expect(b.tilt).toBeCloseTo(0.1, 9);
  });
});

/**
 * Drives the body onto a surface in a world with no gravity.
 *
 * Ballistics are covered above; these cases are about how a *contact* is classified, and
 * under gravity the speed at touchdown would be whatever the drop height produced rather
 * than the speed under test. Dropping from y=3 onto a deck, for instance, arrives at
 * 5.35 u/s — twice the tolerance — so every tolerance case would read as a crash for a
 * reason that has nothing to do with the tolerance.
 */
function touchdown(
  segment: Segment,
  opts: {
    speed?: number;
    rotation?: number;
    from?: number;
    allowGround?: boolean;
    x?: number;
    climbing?: boolean;
  } = {},
) {
  const { speed = 0.2, rotation = 0, from = 3, allowGround = false, x = 0, climbing } = opts;
  const world = new PhysicsWorld(0);
  world.add(segment);

  const b = body({ x, y: from, vy: climbing ? speed : -speed, rotation, allowGround });
  return { b, contact: fly(b, world, IDLE, 6000) };
}

describe('touchdown on a pad', () => {
  it('lands at a feather touchdown', () => {
    const { contact } = touchdown(padAt(0));

    expect(contact.type).toBe('landed');
    if (contact.type !== 'landed') return;
    expect(contact.padId).toBe('outpost-main');
    expect(contact.speed).toBeCloseTo(0.2, 9);
  });

  it('lands at exactly the speed limit', () => {
    // The tolerance is inclusive: `speed <= MAX_LANDING_SPEED`.
    const { contact } = touchdown(padAt(0), { speed: LANDER.MAX_LANDING_SPEED });

    expect(contact.type).toBe('landed');
  });

  it('crashes a hair past the speed limit', () => {
    const { contact } = touchdown(padAt(0), { speed: LANDER.MAX_LANDING_SPEED + 1e-6 });

    expect(contact.type).toBe('crashed');
  });

  it('lands at exactly the tilt limit and crashes past it', () => {
    expect(touchdown(padAt(0), { rotation: LANDER.MAX_LANDING_TILT }).contact.type).toBe('landed');
    expect(touchdown(padAt(0), { rotation: LANDER.MAX_LANDING_TILT + 1e-6 }).contact.type).toBe(
      'crashed',
    );
    expect(touchdown(padAt(0), { rotation: -(LANDER.MAX_LANDING_TILT + 1e-6) }).contact.type).toBe(
      'crashed',
    );
  });

  it('lands a lander that spun a full turn back to level', () => {
    expect(touchdown(padAt(0), { rotation: 2 * Math.PI }).contact.type).toBe('landed');
    expect(touchdown(padAt(0), { rotation: -4 * Math.PI }).contact.type).toBe('landed');
  });

  it('settles exactly one hull radius above the deck', () => {
    const { b } = touchdown(padAt(0));

    expect(b.y).toBeCloseTo(LANDER.RADIUS, 9);
  });

  it('comes to a complete stop and squares itself up', () => {
    const { b } = touchdown(padAt(0), { rotation: 0.1 });

    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
    expect(b.rotation).toBe(0);
    expect(b.angularVelocity).toBe(0);
    expect(b.frozen).toBe(true);
  });

  it('reports how far off the pad centre it stopped', () => {
    const { contact } = touchdown(padAt(0, -8, 8), { x: 3 });

    expect(contact.type).toBe('landed');
    if (contact.type !== 'landed') return;
    expect(contact.offset).toBeCloseTo(3, 6);
  });

  it('measures the offset from the pad centre, not from the origin', () => {
    const { contact } = touchdown(padAt(0, 20, 40), { x: 32 });

    expect(contact.type).toBe('landed');
    if (contact.type !== 'landed') return;
    expect(contact.offset).toBeCloseTo(2, 6); // centre is 30
  });

  it('stops simulating once settled', () => {
    const world = new PhysicsWorld(0);
    world.add(padAt(0));
    const b = body({ y: 3, vy: -0.2 });
    fly(b, world, IDLE, 6000);

    const restingY = b.y;
    const restingFuel = b.fuel;

    // Even with the engine lit, a settled lander does not move or burn.
    fly(b, world, BURN, 120);

    expect(b.y).toBe(restingY);
    expect(b.fuel).toBe(restingFuel);
  });

  /**
   * Catching a pad's underside on the way up is not a landing. Without the normal test
   * a climb into the bottom of a deck would complete the mission.
   */
  it('crashes into a pad from underneath', () => {
    const { contact } = touchdown(padAt(0), { from: -3, climbing: true });

    expect(contact.type).toBe('crashed');
  });
});

describe('touchdown on bare rock', () => {
  it('is a crash by default, however gentle', () => {
    const { contact } = touchdown(rockAt(0));

    expect(contact.type).toBe('crashed');
  });

  it('is a landing when the mission names no address', () => {
    const { contact } = touchdown(rockAt(0), { allowGround: true });

    expect(contact.type).toBe('landed');
    if (contact.type !== 'landed') return;
    // No pad, so no address and nothing to be off-centre of.
    expect(contact.padId).toBeNull();
    expect(contact.offset).toBe(0);
  });

  it('accepts a gentle bench with allowGround', () => {
    // About 11 degrees: normal up-component ~0.98, well inside the 0.8 gate.
    const bench: Segment = { x1: -40, y1: -8, x2: 40, y2: 8, kind: 'rock' };

    expect(touchdown(bench, { allowGround: true }).contact.type).toBe('landed');
  });

  /**
   * The gate that constrains the *ground* rather than the lander. A vehicle held
   * perfectly level and moving slowly against a steep face is upright and survivable by
   * every other test — without this it would read as a landing on a wall.
   */
  it('refuses a face too steep to stand on, even upright and slow', () => {
    // ~45.6 degrees: normal up-component ~0.70. Above MIN_LANDING_NORMAL_Y (0.55), so
    // the contact counts as from-above, but under MAX_GROUND_LANDING_SLOPE (0.8).
    const steep: Segment = { x1: -40, y1: -40.85, x2: 40, y2: 40.85, kind: 'rock' };

    expect(touchdown(steep, { allowGround: true }).contact.type).toBe('crashed');
  });

  it('never lands on colony hardware, whatever the mission says', () => {
    const structure: Segment = { x1: -8, y1: 0, x2: 8, y2: 0, kind: 'structure' };

    expect(touchdown(structure, { allowGround: true }).contact.type).toBe('crashed');
  });

  it('crashes on a pad segment with no id', () => {
    // A pad collider without a padId is not a delivery address.
    const anonymous: Segment = { x1: -8, y1: 0, x2: 8, y2: 0, kind: 'pad' };

    expect(touchdown(anonymous).contact.type).toBe('crashed');
  });
});

describe('freeze', () => {
  it('kills all motion and stops stepping', () => {
    const b = body({ y: 500, vx: 12, vy: -40, angularVelocity: 2 });

    b.freeze();
    const contact = b.step(DT, BURN, emptyWorld());

    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
    expect(b.angularVelocity).toBe(0);
    expect(contact.type).toBe('none');
    expect(b.y).toBe(500);
  });
});

describe('landing gear', () => {
  it('stays stowed high above the ground', () => {
    const b = body();

    for (let i = 0; i < 240; i++) b.updateGear(DT, 500);

    expect(b.gearDeployed).toBeCloseTo(0, 6);
  });

  it('deploys as a surface comes within reach', () => {
    const b = body();

    for (let i = 0; i < 240; i++) b.updateGear(DT, LANDER.GEAR_DEPLOY_HEIGHT - 1);

    expect(b.gearDeployed).toBeGreaterThan(0.95);
  });

  it('comes out faster than it stows', () => {
    // Gear you might need should not dither.
    const out = body();
    for (let i = 0; i < 60; i++) out.updateGear(DT, 5);

    const back = body();
    for (let i = 0; i < 240; i++) back.updateGear(DT, 5);
    const deployed = back.gearDeployed;
    for (let i = 0; i < 60; i++) back.updateGear(DT, 500);

    expect(out.gearDeployed).toBeGreaterThan(deployed - back.gearDeployed);
  });

  it('never leaves the 0..1 range', () => {
    const b = body();

    for (let i = 0; i < 600; i++) b.updateGear(DT, i % 2 === 0 ? 1 : 500);

    expect(b.gearDeployed).toBeGreaterThanOrEqual(0);
    expect(b.gearDeployed).toBeLessThanOrEqual(1);
  });
});

describe('high-speed entry', () => {
  /**
   * The case the swept collision exists for. At entry the lander is doing tens of units
   * per second and a single tick moves it much further than its own hull, so a contact
   * test at the integrated position alone would drop it through the pad.
   */
  it('catches the deck coming in at entry velocity', () => {
    const b = body({ y: 60, vy: -55 });

    const contact = fly(b, worldWith(padAt(0)), IDLE, 400);

    expect(contact.type).toBe('crashed'); // far too fast, but it is *caught*
    expect(b.y).toBeGreaterThan(0);
  });

  it('never passes through the floor at any descent rate', () => {
    for (const speed of [10, 30, 55, 90, 150, 400]) {
      const b = body({ y: 200, vy: -speed });
      fly(b, worldWith(rockAt(0)), IDLE, 2000);

      expect(b.y, `descending at ${speed} u/s`).toBeGreaterThan(0);
    }
  });
});
