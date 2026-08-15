import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { CanyonGenerator, type Excavation } from './CanyonGenerator.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CANYON } from './CanyonSpec.ts';

const SEED = 12345;
const DIGS: Excavation[] = [{ x: 10, halfWidth: 12, depth: 172 }];
const PAD_SITES = [-14, -33];

/**
 * One built canyon, shared across the suite.
 *
 * Building costs the better part of a second — which is the point of the performance
 * work these tests guard — so it happens once rather than per case. Nothing here mutates
 * the generator, only samples it.
 */
let canyon: CanyonGenerator;

beforeAll(() => {
  canyon = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), SEED);
  canyon.build(DIGS, PAD_SITES);
});

/**
 * A golden sample of the terrain.
 *
 * `heightAt` is the single most consequential function in the generator: the mesh, the
 * colliders, the shelf under every ground pad and the floor of every shaft are all
 * derived from it, and it is built from ten interacting noise fields whose interactions
 * nobody can check by reading. So its output is pinned, and any change to the terrain
 * has to be a deliberate act that updates these numbers.
 *
 * Recapture with a script that sums the same grid if the landscape is meant to change.
 */
describe('heightAt is stable for a given seed', () => {
  it('matches the recorded sum over a grid spanning the world', () => {
    let sum = 0;
    for (let z = 200; z > -1500; z -= 37) {
      for (let x = -1000; x <= 1000; x += 17) sum += canyon.heightAt(x, z);
    }

    expect(sum).toBeCloseTo(1181369.751132148, 6);
  });

  it.each([
    [0, 0, -174.794065357],
    [-14, 0, -1.046319957],
    [-33, 0, -6.152910103],
    [10, 0, -174.794065357],
    [65, 0, -1.922765538],
    [-65, 0, -4.007675352],
    [300, -400, 218.299444741],
    [-300, -900, 253.844075152],
    [0, -1499, -46.573897475],
    [999, 200, 212.488759656],
  ])('matches the recorded height at (%i, %i)', (x, z, expected) => {
    expect(canyon.heightAt(x, z)).toBeCloseTo(expected, 6);
  });

  it('is a pure function of the seed', () => {
    const twin = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), SEED);
    twin.build(DIGS, PAD_SITES);

    // Retrying a mission has to rebuild an identical canyon.
    for (const [x, z] of [[0, 0], [40, -100], [-70, 30], [500, -700]]) {
      expect(twin.heightAt(x, z)).toBe(canyon.heightAt(x, z));
    }
  });

  it('gives a different canyon on a different seed', () => {
    const other = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), SEED + 1);
    other.build(DIGS, PAD_SITES);

    expect(other.heightAt(40, -100)).not.toBe(canyon.heightAt(40, -100));
  });
});

/**
 * Continuity. Both discontinuities this generator has shipped were creases along an
 * axis — `Math.abs(z)` in the floor ramp and `Math.abs(x)` in the plateau — and both
 * were invisible to any check aimed at a single cross-section.
 */
describe('the landscape has no seams', () => {
  /** A bore mouth is a deliberate cliff; everything else should be landscape. */
  const inBore = (x: number) =>
    DIGS.some((d) => Math.abs(x - d.x) < d.halfWidth + CANYON.CELL * 3);

  it('is continuous across x, including through the centreline', () => {
    for (const z of [0, -40, -300, -1200, 150]) {
      let worst = 0;
      let where = 0;
      for (let x = -900; x < 900; x += 0.5) {
        if (inBore(x) || inBore(x + 0.5)) continue;
        const jump = Math.abs(canyon.heightAt(x + 0.5, z) - canyon.heightAt(x, z));
        if (jump > worst) {
          worst = jump;
          where = x;
        }
      }
      expect(worst, `z=${z}, worst step at x=${where}`).toBeLessThan(12);
    }
  });

  it('is continuous across z, including through the play plane', () => {
    for (const x of [-500, -70, 40, 200, 800]) {
      let worst = 0;
      let where = 0;
      for (let z = 190; z > -1400; z -= 0.5) {
        const jump = Math.abs(canyon.heightAt(x, z - 0.5) - canyon.heightAt(x, z));
        if (jump > worst) {
          worst = jump;
          where = z;
        }
      }
      expect(worst, `x=${x}, worst step at z=${where}`).toBeLessThan(12);
    }
  });

  /**
   * Specifically the z=0 crease. `floorYAt` uses a softened one-sided ramp rather than
   * `-Math.abs(z)` because absolute value put a V-shaped kink in the floor at exactly
   * the plane the lander flies in, which `terrace` then amplified into a hard line
   * drawn clean across the map.
   */
  it('has no kink in the floor at the play plane', () => {
    for (const x of [-40, -10, 30, 55]) {
      const before = canyon.heightAt(x, 4) - canyon.heightAt(x, 8);
      const after = canyon.heightAt(x, -4) - canyon.heightAt(x, 0);
      expect(Math.abs(after - before), `x=${x}`).toBeLessThan(4);
    }
  });
});

describe('the canyon is not a mirror', () => {
  /**
   * Fed only the distance from the centreline, both walls sampled identical noise and
   * the canyon came out an exact reflection — measured, the two sides agreed to 0.000 —
   * so the reflection axis showed as a crease straight down the middle of the frame.
   */
  it('gives each wall its own rock', () => {
    for (const d of [40, 65, 90, 120]) {
      expect(canyon.heightAt(-d, 0), `distance ${d}`).not.toBeCloseTo(canyon.heightAt(d, 0), 3);
    }
  });

  it('gives the upland its own rock on each side too', () => {
    // The plateau creased along x=0 for the same reason, out past the rim.
    for (const x of [300, 600, 900]) {
      expect(canyon.heightAt(-x, -400), `x=${x}`).not.toBeCloseTo(canyon.heightAt(x, -400), 3);
    }
  });
});

describe('the collider profile', () => {
  it('samples the play plane exactly', () => {
    // The plane the lander flies in has to match its colliders bit for bit, or the
    // vehicle appears to clip geometry it did not hit.
    for (const point of canyon.profile) {
      expect(point.y).toBe(canyon.heightAt(point.x, 0));
    }
  });

  it('lands on whole terrain cells, so every sample is also a mesh column', () => {
    for (const point of canyon.profile) {
      expect(Math.abs(point.x % CANYON.CELL)).toBeLessThan(1e-9);
    }
  });

  it('spans the canyon out past both rims', () => {
    const xs = canyon.profile.map((p) => p.x);

    expect(Math.min(...xs)).toBeLessThan(-CANYON.PLAY_HALF_X);
    expect(Math.max(...xs)).toBeGreaterThan(CANYON.PLAY_HALF_X);
  });

  it('is evenly spaced at the cell pitch', () => {
    for (let i = 1; i < canyon.profile.length; i++) {
      expect(canyon.profile[i].x - canyon.profile[i - 1].x).toBeCloseTo(CANYON.CELL, 9);
    }
  });
});

describe('shelves and excavations', () => {
  it('levels the ground under a pad site', () => {
    // A ground pad always finds level rock without the generator being told how high
    // that rock is. Built with one pad site, so no other shelf competes for this ground.
    const solo = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), SEED);
    solo.build([], [-14]);

    const level = solo.heightAt(-14, 0);
    for (let dx = -9; dx <= 9; dx += 1.5) {
      expect(solo.heightAt(-14 + dx, 0), `offset ${dx}`).toBeCloseTo(level, 6);
    }
  });

  /**
   * Documents a real limitation rather than asserting it is right.
   *
   * Shelves are applied in sequence and each one lerps the ground toward its own centre
   * height, so a later shelf whose *shoulder* reaches an earlier shelf's bench drags
   * part of that bench away. In the campaign the outpost pad at x=-14 and the Helion
   * cavern at x=-33 are 19 apart while each shelf spans 9 plus a 10-unit shoulder — so
   * they overlap exactly, and the outpost bench survives only on its eastern side.
   *
   * The pad's collider is a single flat segment at one height, so this costs nothing in
   * flight. What it costs is visual: the deck's western end stands about 4.5 units clear
   * of the ground it is supposed to be resting on.
   */
  it('lets a later shelf erode an earlier bench where their shoulders overlap', () => {
    const east = canyon.heightAt(-10, 0);
    const centre = canyon.heightAt(-14, 0);
    const west = canyon.heightAt(-20, 0);

    expect(east).toBeCloseTo(centre, 6); // clean side
    expect(Math.abs(west - centre)).toBeGreaterThan(3); // eaten by the x=-33 shelf
  });

  it('opens the floor over a bore', () => {
    const dig = DIGS[0];
    const insideBore = canyon.heightAt(dig.x, 0);
    const beside = canyon.heightAt(dig.x + dig.halfWidth + 20, 0);

    expect(insideBore).toBeLessThan(beside - dig.depth * 0.5);
  });

  it('leaves a pad beside a pit on its own level ground', () => {
    // The mouth carve is one cell wide precisely so it does not reach sideways into a
    // neighbouring pad's approach.
    const dig = DIGS[0];
    const clear = dig.x - dig.halfWidth - CANYON.CELL * 2;

    expect(canyon.heightAt(clear, 0)).toBeGreaterThan(-20);
  });

  it('merges two records of the same bore into the deeper one', () => {
    const staged = new CanyonGenerator(new THREE.Scene(), new PhysicsWorld(-6), SEED);
    staged.build(
      [
        { x: 10, halfWidth: 12, depth: 58 },
        { x: 10, halfWidth: 12, depth: 172 },
      ],
      PAD_SITES,
    );

    // The shallow record must not lay a lid across the deep bore.
    expect(staged.heightAt(10, 0)).toBeCloseTo(canyon.heightAt(10, 0), 6);
  });
});

describe('the canyon has the shape the spec describes', () => {
  it('puts the walls above the floor', () => {
    const floor = canyon.heightAt(0, -60);
    const wall = canyon.heightAt(CANYON.FLOOR_HALF + CANYON.WALL_RUN, -60);

    expect(wall).toBeGreaterThan(floor + 100);
  });

  it('reaches roughly the rim height at the top of the wall run', () => {
    for (const z of [-100, -500]) {
      const centre = canyon.heightAt(0, z);
      const rim = canyon.heightAt(-(CANYON.FLOOR_HALF + CANYON.WALL_RUN), z);
      expect(rim - centre, `z=${z}`).toBeGreaterThan(CANYON.RIM_Y * 0.5);
    }
  });

  it('never sinks the upland far below the rim', () => {
    // The canyon should stay the deepest thing in view.
    for (let x = 300; x <= 1000; x += 25) {
      expect(canyon.heightAt(x, -600), `x=${x}`).toBeGreaterThan(CANYON.RIM_Y - 60);
    }
  });
});

/**
 * The bore-clearance query the KD-9's centring gauge reads.
 *
 * Asserted as properties rather than pinned numbers: the bore meanders on seeded noise,
 * so the figures move whenever the terrain does, but the sense of the reading must not.
 * A mirrored left/right here would draw a hauler drifting onto the west wall as one
 * drifting off it — a gauge that is wrong in the one direction its pilot cannot argue
 * with, and which no screenshot would catch.
 */
describe('bore clearance', () => {
  // The shared canyon digs one bore: x = 10, half-width 12, running 172 down from its
  // mouth. `build` puts the mouth `depth` above the pit floor `heightAt` reports.
  const MOUTH_Y = -174.794065357 + 172;
  const INSIDE_Y = MOUTH_Y - 60;

  it('reads nothing in open air, so the gauge can go dark instead of lying', () => {
    expect(canyon.clearanceAt(10, MOUTH_Y + 40)).toBeNull();
    expect(canyon.clearanceAt(10, MOUTH_Y - 400)).toBeNull();
  });

  it('reads nothing beside the bore, at a depth where the bore exists', () => {
    expect(canyon.clearanceAt(10 + 400, INSIDE_Y)).toBeNull();
    expect(canyon.clearanceAt(10 - 400, INSIDE_Y)).toBeNull();
  });

  it('reports room on both sides from inside', () => {
    const clear = canyon.clearanceAt(10, INSIDE_Y);

    expect(clear).not.toBeNull();
    expect(clear!.left).toBeGreaterThan(0);
    expect(clear!.right).toBeGreaterThan(0);
  });

  it('gives away on one side exactly what it takes on the other', () => {
    // Both margins run to the same two walls, so the total is the bore's own width and
    // moving across it cannot change that.
    const a = canyon.clearanceAt(10 - 4, INSIDE_Y)!;
    const b = canyon.clearanceAt(10 + 4, INSIDE_Y)!;

    expect(a.left + a.right).toBeCloseTo(b.left + b.right, 6);
  });

  it('loses room to starboard as the vehicle moves that way', () => {
    // The sense of the reading. This is the assertion a mirrored gauge fails.
    const west = canyon.clearanceAt(10 - 4, INSIDE_Y)!;
    const east = canyon.clearanceAt(10 + 4, INSIDE_Y)!;

    expect(east.right).toBeLessThan(west.right);
    expect(east.left).toBeGreaterThan(west.left);
  });

  it('never reports more room than the dig was ever given', () => {
    for (let y = MOUTH_Y - 5; y > MOUTH_Y - 165; y -= 11) {
      const clear = canyon.clearanceAt(10, y);
      expect(clear, `y=${y}`).not.toBeNull();
      // Half-width 12 either side, plus one-sided relief cut into the rock.
      expect(clear!.left + clear!.right, `y=${y}`).toBeLessThan(2 * (12 + 3));
    }
  });
});
