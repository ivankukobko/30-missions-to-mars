import * as THREE from 'three';
import { AIRFRAMES } from '../entities/Airframe.ts';
import { LanderBody } from '../entities/LanderBody.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CanyonGenerator } from '../world/CanyonGenerator.ts';
import { Colony } from '../world/Colony.ts';
import { CANYON } from '../world/CanyonSpec.ts';
import {
  campaignPadSites,
  missionWorlds,
  planColonies,
} from '../campaign/ColonyPlan.ts';
import { airframeFor, ENTRY_VELOCITY, RIM_SITES, PROLOGUE, type Mission } from '../campaign/Missions.ts';
import { scoreLanding, type LandingScore } from '../campaign/Progress.ts';
import { Autopilot } from './Autopilot.ts';

/**
 * Flies a mission headlessly, on the real physics, and reports what it scored.
 *
 * The world is assembled exactly as `Game.loadMission` assembles it — terrain from the
 * seed, wall-anchored digs resolved, every campaign pad site graded, the colony grown and
 * built into the same `PhysicsWorld` — because a run that flies through structure the
 * game would have put in the way is not measuring the game.
 *
 * A renderer is never constructed. `CanyonGenerator` and `Colony` both take a
 * `THREE.Scene`, which is a container rather than a renderer, so meshes are built into an
 * object graph nobody draws; the colliders they register are the point.
 */

const FIXED_DT = 1 / 120;
const GRAVITY = -6;
/** Long enough for the deepest descent, short enough that a stuck run ends. */
const MAX_SECONDS = 240;

export type FlightOutcome =
  | { kind: 'landed'; onTarget: boolean; score: LandingScore; seconds: number; fuelLeft: number }
  | { kind: 'crashed'; surface: string; speed: number; seconds: number }
  | { kind: 'lost'; reason: 'failDepth' | 'timeout'; seconds: number };

/**
 * Whether to track the pad's reserved route rather than descending its column.
 *
 * **Off by default, and that is a measured choice.** Following the route sounds strictly
 * better — it is the path the level design guarantees is clear — and flying the campaign
 * both ways says otherwise: 20 of 29 missions land with a straight descent and 7 with
 * route tracking. The reason is that the routes *merge into a shared trunk* as they climb,
 * so the reserved path bends, and a controller that holds `routeX(y)` chases the bend at
 * descent speed instead of flying it.
 *
 * Nine missions genuinely need it, and they are the ones whose approach is not vertical
 * at all: `shaft-gallery` is reached by descending the bore and turning west, so there is
 * legally colony directly above it. Those need a proper path follower with lookahead
 * rather than a point-tracker, which is the work this harness stops short of.
 */
export interface FlightOptions {
  followRoute?: boolean;
}

export function flyMission(
  mission: Mission,
  seed: number,
  options: FlightOptions = {},
): FlightOutcome {
  const scene = new THREE.Scene();
  const physics = new PhysicsWorld(GRAVITY);
  const canyon = new CanyonGenerator(scene, physics, seed);

  /**
   * No mast. `Colony.buildRadar` paints its glow on a `<canvas>`, which does not exist
   * here — and the radar is a landmark with no collider, so a flight cannot touch it
   * either way. Leaving it out costs the measurement nothing and keeps this out of a DOM.
   */
  const worlds = missionWorlds(null, null, canyon);
  const current = worlds(mission.id);
  canyon.build(current.digs, [...campaignPadSites(worlds), ...RIM_SITES]);

  const plan = planColonies(mission.id, worlds, {}, seed, canyon);
  const colony = new Colony(scene, physics);
  colony.build([...current.props, ...plan.colonies], canyon, plan);

  const frame = AIRFRAMES[airframeFor(mission)];
  const lander = new LanderBody(
    mission.payload,
    Math.round(mission.fuel * frame.fuelScale),
    frame,
  );
  lander.x = mission.start.x;
  lander.y = mission.start.y;
  lander.vx = mission.entry?.vx ?? ENTRY_VELOCITY.vx;
  lander.vy = mission.entry?.vy ?? ENTRY_VELOCITY.vy;
  // Mission 1 has no address: any survivable touchdown completes it.
  lander.allowGround = mission.target === null;

  const pad = current.props.find((p) => p.kind === 'pad' && p.id === mission.target);
  const target =
    pad && pad.kind === 'pad'
      ? { x: pad.x, y: pad.y ?? canyon.heightAt(pad.x, 0, true) + 1.3 }
      : { x: mission.start.x, y: canyon.heightAt(mission.start.x, 0, true) };
  const padHalfWidth = pad && pad.kind === 'pad' ? pad.width / 2 : null;

  const route = options.followRoute
    ? (plan.network.channels.find((c) => c.padId === mission.target)?.points ?? [])
    : [];
  const pilot = new Autopilot(frame, target, route);
  const steps = Math.round(MAX_SECONDS / FIXED_DT);

  for (let step = 0; step < steps; step++) {
    const contact = lander.step(FIXED_DT, pilot.next(lander), physics);
    const seconds = step * FIXED_DT;

    if (contact.type === 'landed') {
      const onTarget = mission.target === null || contact.padId === mission.target;
      return {
        kind: 'landed',
        onTarget,
        score: scoreLanding(
          lander.fuel,
          lander.fuelCapacity,
          contact.speed,
          contact.offset,
          // The prologue scores on open ground, where there is no centre to be off.
          mission.id === PROLOGUE.id ? null : padHalfWidth,
        ),
        seconds,
        fuelLeft: lander.fuel,
      };
    }
    if (contact.type === 'crashed') {
      return { kind: 'crashed', surface: contact.hit.segment.kind, speed: lander.speed, seconds };
    }
    if (lander.y < mission.failDepth) {
      return { kind: 'lost', reason: 'failDepth', seconds };
    }
    if (lander.y > CANYON.RIM_Y + 1500) {
      return { kind: 'lost', reason: 'timeout', seconds };
    }
  }

  return { kind: 'lost', reason: 'timeout', seconds: MAX_SECONDS };
}
