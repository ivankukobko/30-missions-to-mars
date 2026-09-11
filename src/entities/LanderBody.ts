import type { PhysicsWorld, Hit } from '../physics/PhysicsWorld.ts';
import type { InputState } from '../core/InputManager.ts';
import type { Payload } from '../campaign/Missions.ts';
import { AIRFRAMES, engineForInput, engineThrust, type Airframe } from './Airframe.ts';
import { damp } from '../world/Noise.ts';

/**
 * The flight model, with no renderer attached.
 *
 * Separated from the vehicle you can see because these are two genuinely different
 * concerns that were sharing a class: integration, thrust, mass and contact resolution
 * on one side, and about two hundred and fifty lines of cone-and-strut construction on
 * the other. Keeping them together meant the physics could not be instantiated without a
 * `THREE.Scene`, which put every tolerance in the game — the landing speed, the tilt
 * limit, the rejection of a pad's underside — beyond the reach of a test.
 *
 * Nothing here imports three.js, and nothing here should.
 */

/**
 * The envelope every airframe shares: hull size, what counts as a survivable arrival,
 * and when the gear comes out. Anything that differs between vehicles — thrust, burn
 * rates, whether the thing can rotate at all — lives in `Airframe.ts` instead.
 *
 * `THRUST` and the burn rates stay here as the *baseline* the campaign was tuned
 * against. `AIRFRAMES.lander` restates them, and the hauler is scaled against them,
 * so the numbers thirty missions were balanced on remain in one place.
 */
export const LANDER = {
  RADIUS: 0.62,
  DRY_MASS: 1,
  /** Payload mass counts for slightly less than dry mass, to keep heavy runs flyable. */
  PAYLOAD_MASS_FACTOR: 0.55,
  /**
   * Sized against the worst case: heaviest payload (1.9t → mass 2.05) entering at
   * ~88 u/s must stop well inside the entry altitude. That gives 17.6 u/s² of thrust
   * against 6 of gravity — a net 11.6, so it sheds entry velocity in ~365 units of
   * the ~550 available. Light cargo brakes in under 160.
   */
  THRUST: 36,
  /**
   * Seconds for an engine to wind from cold to full output — and the same back down.
   *
   * Every engine used to be a switch: full thrust on the step the key went down, nothing
   * on the step it came up. Honest to the data and wrong to the hand, because nothing with
   * a turbopump behaves like that and the vehicle read as weightless for it.
   *
   * **Symmetric, so it is latency and not loss.** The ramp up owes exactly what the ramp
   * down repays: the level climbs from 0 and falls from 1 by the same step, and the curve
   * is point-symmetric (`s(x) + s(1 − x) = 1`), so every lower-ramp shortfall is matched by
   * an upper-ramp surplus. A burn long enough to reach full delivers the impulse an
   * instant engine would have, for the fuel it would have — so `FuelBudget` and the tanks
   * thirty missions were balanced on still hold. What changes is *when*: thrust arrives
   * `ENGINE_SPOOL / 2` late on average.
   *
   * That figure is the whole tuning question, because the landing tolerance is 2.5 u/s
   * and the lander's engine is worth about 28 u/s² on a mid-weight load. At 0.15 s the
   * late half-ramp withholds
   * 2.1 u/s — nearly the entire tolerance, spent before the player's correction has
   * started to arrive. 0.125 is 15 fixed steps and holds back 1.8 u/s on the lander, and
   * only 1.1 on the heaviest hauler, which is proportionally the softer vehicle and should
   * feel it.
   *
   * Settled on the reference pilot rather than by feel, sweeping 0.10 / 0.125 / 0.15 /
   * 0.20: every one of them lands all twenty straight descents on exactly the fuel they
   * used before, and the score spread goes 13 / 12 / 13 / 20 — the last failing the
   * spread test outright, with mission 11 dropping a rank. 0.125 is the tightest.
   * Mission 3 slips from 67 to 65, under the A cut, at every value from 0.10 up; it was
   * one point clear before and that pilot lands it 2.8 off centre, so it is the first to
   * feel any lag at all.
   *
   * A tap shorter than the spool never reaches full, and delivers less than its duration
   * suggests — a 60 ms blip gives about a third of what it used to. That is the point:
   * feathering is now something the hand does rather than something the key repeat does.
   */
  ENGINE_SPOOL: 0.125,
  /** Gear swings out below this height above whatever is underneath. */
  GEAR_DEPLOY_HEIGHT: 20,
  /** Touchdown tolerances. Outside any of these, it is a crash. */
  MAX_LANDING_SPEED: 2.5,
  MAX_LANDING_TILT: 0.26,
} as const;

export type Contact =
  | { type: 'none' }
  /** `padId` is null for a landing on open ground — see `LanderBody.allowGround`. */
  | { type: 'landed'; padId: string | null; speed: number; offset: number; hit: Hit }
  | { type: 'crashed'; hit: Hit };

/**
 * Flattest a rock face may be and still not count as ground you can land on, as the
 * upward component of its normal. 0.80 is about 37 degrees: it takes in the canyon
 * floor and the terrace benches, and excludes the walls.
 *
 * The upright test already constrains the *lander*; this constrains the *ground*.
 * Without it a vehicle held level against a 50-degree face reads as a landing.
 */
export const MAX_GROUND_LANDING_SLOPE = 0.8;

/**
 * Contact normal must point at least this far upward for a touchdown to count. Catching
 * a pad's underside on the way up is not a landing.
 */
export const MIN_LANDING_NORMAL_Y = 0.55;

/** Wraps an angle to (-PI, PI]. The old upright test skipped this and called a fully
 *  rotated but perfectly level lander a crash. */
export function normalizeAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Which thrusters were firing on the last step, for anything that draws them. */
export interface Firing {
  /** One flag per engine, in the airframe's own order: producing any thrust at all. */
  engines: boolean[];
  /**
   * What each engine actually delivered on the step, 0..1 — the same number the physics
   * multiplied its thrust and its burn by. Everything that shows an engine (plume, glow,
   * lamp, note) reads this rather than the flag, so none of them can claim an output the
   * simulation did not have.
   */
  power: number[];
  /**
   * Attitude jets. A differential airframe has none, so these stay false. On the
   * translation frame these mirror its lateral engines, which *do* spool — see `power`.
   */
  rcsLeft: boolean;
  rcsRight: boolean;
}

/** Nothing lit, sized to whatever vehicle is asking. */
export function idleFiring(frame: Airframe): Firing {
  return {
    engines: frame.engines.map(() => false),
    power: frame.engines.map(() => 0),
    rcsLeft: false,
    rcsRight: false,
  };
}

/**
 * Spool position to delivered thrust: slow to catch, quick through the middle, easing in
 * at the top.
 *
 * Smoothstep rather than the linear ramp underneath it, which reached full with a visible
 * corner, or a first-order lag, which never reaches full at all and so would have burned
 * a fraction of a percent short for the whole of every long burn. Its point symmetry is
 * what `ENGINE_SPOOL`'s impulse argument rests on — do not replace it with a curve that
 * lacks it.
 */
export function spoolCurve(level: number): number {
  return level * level * (3 - 2 * level);
}

export class LanderBody {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  rotation = 0;
  angularVelocity = 0;
  fuel: number;
  readonly fuelCapacity: number;
  readonly mass: number;
  readonly payload: Payload;
  readonly airframe: Airframe;

  /**
   * Which physical engine each control input drives — see `engineForInput`. Player
   * setting, and meaningless on an airframe with one engine.
   */
  invertThrusters = false;

  /**
   * Cosmetic lean, in radians, on top of `rotation`.
   *
   * The differential airframe cannot rotate, and a vehicle that slides sideways while
   * staying rigidly level reads as an elevator rather than a machine under thrust. This
   * leans it into the push. **Nothing in the simulation may read this** — not
   * `resolveContact`, not `tilt`, not the landing test. It is damped inside the fixed
   * step rather than per frame only so it stays deterministic like everything else the
   * campaign's reproducibility rests on.
   */
  bank = 0;

  /** Accumulated simulation time. Drives anything that blinks. */
  age = 0;

  /** Set once the lander is no longer under player control. */
  frozen = false;

  /**
   * Whether a soft touchdown on bare rock counts as a landing rather than a wreck.
   * Set by missions that name no delivery address — which is mission one, where the
   * cargo *is* the navigation system and there is nowhere yet to deliver it to.
   */
  allowGround = false;

  /** 0 stowed, 1 fully deployed. */
  private legDeploy = 0;

  private bankTarget = 0;

  private thrusters: Firing;

  /**
   * Where each engine is along its spool, 0 cold to 1 full, moving linearly in time. What
   * it delivers is `spoolCurve` of this. Attitude jets are not on it: they are valves, and
   * lag on the one control that turns the thrust vector compounds through two integrations
   * before it reaches position — see `applyAttitude`.
   */
  private spool: number[];

  constructor(payload: Payload, fuel: number, airframe: Airframe = AIRFRAMES.lander) {
    this.payload = payload;
    this.fuel = fuel;
    this.fuelCapacity = fuel;
    this.airframe = airframe;
    this.thrusters = idleFiring(airframe);
    this.spool = airframe.engines.map(() => 0);
    this.mass = LANDER.DRY_MASS + payload.mass * LANDER.PAYLOAD_MASS_FACTOR;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get tilt(): number {
    return normalizeAngle(this.rotation);
  }

  /** Thrust acceleration with every engine lit, in u/s². Falls with payload mass. */
  get thrustAccel(): number {
    return this.airframe.thrust / this.mass;
  }

  /** Whether any engine is lit — what the exhaust effects key off. */
  get thrusting(): boolean {
    return this.thrusters.engines.some(Boolean);
  }

  /** How far the gear is out, for anyone who wants to react to it. */
  get gearDeployed(): number {
    return this.legDeploy;
  }

  get firing(): Firing {
    return this.thrusters;
  }

  /**
   * Where the vehicle was at the start of the current step, for rendering between steps.
   *
   * The simulation advances in fixed 1/120 jumps and the display does not, so a frame
   * lands part-way through a step and the leftover has to be drawn rather than dropped.
   * Without it, a frame shows the last completed substep and the number of substeps per
   * frame varies with the accumulator — 2, 2, 1, 2, 3 — which at entry speed is a jump
   * alternating between half a unit and a whole one. That is about eighty per cent of a
   * hull radius, and it reads as the vehicle vibrating.
   *
   * The effect is worst in the sky phase because both of its causes peak there: speed is
   * at its highest, so a substep covers the most ground, and the entry framing is the
   * tightest standoff in the game, so a given world-space error subtends the largest
   * angle. On the pad it is two orders of magnitude smaller and invisible.
   *
   * Presentation only. Nothing here is read by the simulation, so a mission still replays
   * identically — the interpolated pose is never fed back into the body.
   */
  prevX = 0;
  prevY = 0;
  prevRotation = 0;
  prevBank = 0;

  /** Takes the "where it was" reading. Called at the top of every step. */
  private snapshot(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevRotation = this.rotation;
    this.prevBank = this.bank;
  }

  /**
   * Collapses the interpolation, so the next frame draws exactly here.
   *
   * Anything that moves the vehicle without stepping it has to call this — a mission
   * load, a settle onto a pad, the debug `place`. Otherwise the frame after the jump
   * interpolates from wherever it used to be and smears the vehicle across the gap.
   */
  pin(): void {
    this.snapshot();
  }

  /**
   * One fixed physics step. Returns the first contact along the motion, if any.
   * The caller supplies a fixed dt, so behaviour is identical at any frame rate.
   */
  step(dt: number, input: InputState, world: PhysicsWorld): Contact {
    if (this.frozen) return { type: 'none' };
    this.snapshot();

    // Captured locally so the discriminant narrows for the whole step. Reading through
    // `this.airframe` at each use would work, but a local const is narrowing TypeScript
    // cannot lose across the calls in between.
    const frame = this.airframe;
    if (frame.scheme === 'attitude') this.applyAttitude(dt, input, frame);
    else if (frame.scheme === 'differential') this.applyDifferential(dt, input, frame);
    else this.applyTranslation(dt, input, frame);

    if (this.fuel < 0) this.fuel = 0;

    this.age += dt;
    this.vy += world.gravity * dt;

    if (frame.scheme === 'attitude') {
      this.angularVelocity = damp(this.angularVelocity, 0, frame.angularDamp, dt);
      this.rotation += this.angularVelocity * dt;
    } else {
      // Rotation stays locked at zero; only the decoration moves.
      this.bank = damp(this.bank, this.bankTarget, frame.bankRate, dt);
    }

    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    const hit = world.sweep(this.x, this.y, nx, ny, LANDER.RADIUS);

    if (!hit) {
      this.x = nx;
      this.y = ny;
      return { type: 'none' };
    }

    this.x = hit.bodyX;
    this.y = hit.bodyY;

    return this.resolveContact(hit);
  }

  /**
   * Walks every engine one step along its spool toward what is being asked of it, and
   * records what each delivers. Returns the delivered outputs, 0..1, in airframe order.
   *
   * A dry tank cuts the spool outright rather than letting it wind down. The wind-down is
   * the engine still burning propellant on its way to idle; with none left there is
   * nothing to burn, and a plume tapering off an empty tank would be thrust from nothing.
   */
  private spoolEngines(dt: number, demand: boolean[], hasFuel: boolean): number[] {
    const rate = dt / LANDER.ENGINE_SPOOL;
    const power: number[] = [];
    for (let i = 0; i < this.spool.length; i++) {
      const level = !hasFuel
        ? 0
        : demand[i]
          ? Math.min(1, this.spool[i] + rate)
          : Math.max(0, this.spool[i] - rate);
      this.spool[i] = level;
      power.push(spoolCurve(level));
    }
    return power;
  }

  /**
   * One engine on the centreline plus attitude jets: thrust goes wherever the nose is
   * pointing, and pointing it is a separate job. Attitude control stays available under
   * main thrust — fighting the two against each other is the whole skill of a lander.
   *
   * The main engine spools; the jets do not. A jet lag is a lag on *where the thrust
   * points*, which reaches position through two more integrations than a lag on how hard
   * it pushes — the vehicle overshoots its lean, then overshoots the correction, and the
   * pilot is fighting the model rather than the canyon.
   */
  private applyAttitude(
    dt: number,
    input: InputState,
    frame: Extract<Airframe, { scheme: 'attitude' }>,
  ): void {
    const hasFuel = this.fuel > 0;
    const power = this.spoolEngines(dt, [input.main], hasFuel);
    const main = power[0];
    const leftOn = hasFuel && input.left;
    const rightOn = hasFuel && input.right;
    this.thrusters = { engines: [main > 0], power, rcsLeft: leftOn, rcsRight: rightOn };

    if (main > 0) {
      const a = this.thrustAccel * main;
      this.vx += -Math.sin(this.rotation) * a * dt;
      this.vy += Math.cos(this.rotation) * a * dt;
      this.fuel -= frame.mainBurn * main * dt;
    }

    const rotAccel = frame.rotationPower / (1 + this.payload.mass * 0.5);
    if (leftOn) {
      this.angularVelocity += rotAccel * dt;
      this.fuel -= frame.rcsBurn * dt;
    }
    if (rightOn) {
      this.angularVelocity -= rotAccel * dt;
      this.fuel -= frame.rcsBurn * dt;
    }
  }

  /**
   * Canted engines fired independently. Each one pushes opposite its nozzle, so running
   * a single engine translates the vehicle sideways *and* up; running both cancels the
   * horizontals and leaves pure lift. That cancellation is not a special case in the
   * code — it is what adding the two vectors does.
   *
   * Rotation is never touched. The lean this computes is decoration; see `bank`.
   */
  private applyDifferential(
    dt: number,
    input: InputState,
    frame: Extract<Airframe, { scheme: 'differential' }>,
  ): void {
    const hasFuel = this.fuel > 0;
    // Both engines from the dedicated key — on touch, the middle third of the screen —
    // or from holding both directions at once, which is left as a keyboard fallback
    // for pressing both arrows together rather than something touch can produce: the
    // side zones and the middle zone are disjoint, so a touch is never "both."
    const both = input.main || (input.left && input.right);

    const demand = frame.engines.map(() => false);
    if (both || input.left) demand[engineForInput(frame, 'left', this.invertThrusters)] = true;
    if (both || input.right) demand[engineForInput(frame, 'right', this.invertThrusters)] = true;
    const power = this.spoolEngines(dt, demand, hasFuel);
    this.thrusters = { engines: power.map((p) => p > 0), power, rcsLeft: false, rcsRight: false };

    const a = engineThrust(frame) / this.mass;
    let lean = 0;

    for (let i = 0; i < frame.engines.length; i++) {
      const p = power[i];
      if (p === 0) continue;
      const { cant } = frame.engines[i];
      // Thrust leaves opposite the nozzle: one splayed toward +x drives the hull to −x.
      this.vx += -Math.sin(cant) * a * p * dt;
      this.vy += Math.cos(cant) * a * p * dt;
      this.fuel -= frame.engineBurn * p * dt;
      lean += Math.sin(cant) * p;
    }

    // Lean into the push. Positive rotation is counter-clockwise — nose to port — and a
    // nozzle splayed to +x drives the hull to port, so the two already share a sign.
    // Weighted by output, so the hull rolls in as an engine spools rather than on the key.
    this.bankTarget = Math.max(-1, Math.min(1, lean)) * frame.bankMax;
  }

  /**
   * Decoupled horizontal translation scheme (Helion craft).
   * Bottom main nozzle provides vertical lift (+Y).
   * Lateral RCS thrusters shift horizontal position (±X) without tilting/rotating.
   * Holding Left + Right together fires the main vertical thruster — a keyboard
   * fallback for pressing both arrows; on touch the middle zone drives `main` on its
   * own, disjoint from the side zones, which is what finally lets a touch player hold
   * altitude and translate at once instead of only ever getting one axis.
   */
  private applyTranslation(
    dt: number,
    input: InputState,
    frame: Extract<Airframe, { scheme: 'translation' }>,
  ): void {
    const hasFuel = this.fuel > 0;
    const bothSide = input.left && input.right;

    // Airframe order: [main, port engine (fires left to move right), starboard engine
    // (fires right to move left)]. The lateral pair are engines with plumes, so they
    // spool like the main one — they push the hull directly rather than turning it, which
    // is the case `applyAttitude` keeps its jets off the spool for.
    const power = this.spoolEngines(
      dt,
      [input.main || bothSide, input.right && !bothSide, input.left && !bothSide],
      hasFuel,
    );
    const [main, pushRight, pushLeft] = power;
    this.thrusters = {
      engines: power.map((p) => p > 0),
      power,
      rcsLeft: pushLeft > 0,
      rcsRight: pushRight > 0,
    };

    if (main > 0) {
      this.vy += this.thrustAccel * main * dt;
      this.fuel -= frame.mainBurn * main * dt;
    }

    const sideAccel = (frame.sideThrust / this.mass);
    if (pushLeft > 0) {
      this.vx -= sideAccel * pushLeft * dt;
      this.fuel -= frame.rcsBurn * pushLeft * dt;
    }
    if (pushRight > 0) {
      this.vx += sideAccel * pushRight * dt;
      this.fuel -= frame.rcsBurn * pushRight * dt;
    }

    // One side winding down while the other winds up passes through level rather than
    // snapping from one lean to the other.
    this.bankTarget = (pushRight - pushLeft) * frame.bankMax;
  }

  private resolveContact(hit: Hit): Contact {
    const speed = this.speed;
    const upright = Math.abs(this.tilt) <= LANDER.MAX_LANDING_TILT;
    // Contact normal must point upward: catching a pad's underside is not a landing.
    const fromAbove = hit.ny > MIN_LANDING_NORMAL_Y;
    const survivable = upright && fromAbove && speed <= LANDER.MAX_LANDING_SPEED;

    if (survivable && hit.segment.kind === 'pad' && hit.segment.padId) {
      const padCentre = (hit.segment.x1 + hit.segment.x2) / 2;
      const offset = Math.abs(this.x - padCentre);
      this.settle(hit.segment.y1 + LANDER.RADIUS);
      return { type: 'landed', padId: hit.segment.padId, speed, offset, hit };
    }

    /**
     * Bare rock counts as a landing only when the mission says so, which is mission
     * one and nothing else. Every other run is a delivery to an address, and softening
     * terrain contact in general would remove the pressure the whole campaign runs on.
     *
     * Settling happens at the swept body position rather than at a surface height: the
     * floor is a polyline of sloping chords, not a flat deck, so there is no single y
     * to snap to — but the sweep has already resolved exactly where the hull stopped.
     */
    if (
      survivable &&
      this.allowGround &&
      hit.segment.kind === 'rock' &&
      hit.ny >= MAX_GROUND_LANDING_SLOPE
    ) {
      this.settle(hit.bodyY);
      return { type: 'landed', padId: null, speed, offset: 0, hit };
    }

    return { type: 'crashed', hit };
  }

  private settle(y: number): void {
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angularVelocity = 0;
    this.rotation = 0;
    // A settled vehicle sits level on its gear, whichever way it was leaning.
    this.bank = 0;
    this.bankTarget = 0;
    this.frozen = true;
    this.cutEngines();
  }

  freeze(): void {
    this.frozen = true;
    this.vx = 0;
    this.vy = 0;
    this.angularVelocity = 0;
    this.cutEngines();
  }

  /**
   * Straight to cold, with no wind-down. Both callers end the flight — contact on a deck,
   * or the run being taken away — and the spool is a flight behaviour.
   */
  private cutEngines(): void {
    this.thrusters = idleFiring(this.airframe);
    this.spool.fill(0);
  }

  /**
   * Deploys the gear as a surface comes within reach and stows it again on the climb
   * out. `heightAboveGround` comes from the physics world's downward query rather
   * than a raycast — the colliders are already a sorted set of segments, so the
   * answer is a bucket lookup instead of a scene traversal.
   */
  updateGear(dt: number, heightAboveGround: number): void {
    const want = heightAboveGround < LANDER.GEAR_DEPLOY_HEIGHT ? 1 : 0;
    // Out briskly, back in at leisure — gear you might need should not dither.
    this.legDeploy = damp(this.legDeploy, want, want > 0.5 ? 3.4 : 1.5, dt);
  }
}
