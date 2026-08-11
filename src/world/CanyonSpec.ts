/**
 * Every dimension of the world lives here. Nothing downstream invents a number.
 *
 * The canyon runs **into the screen**, along -Z. The camera sits at +Z looking down
 * its length, and the playable plane at z=0 is the canyon's mouth — a cross-section
 * with the west wall to the left, the east wall to the right, the floor below and a
 * slot of sky above.
 *
 * That orientation is the whole point. Slicing *along* a canyon shows you a floor and
 * a backdrop; slicing *across* it shows you the void between two walls, which is what
 * a canyon actually is. It also fills the mid-ground: the canyon recedes through
 * dozens of depth slices instead of jumping from the play plane straight to a wall
 * 85 units back, so fog and scale finally have something to grade across.
 *
 *   z = +0.02   NEAR CUT    caps the cross-section. Only drawn below the contour, so
 *                           it frames the shot without occluding the lander.
 *   z =  0      PLAY SLICE  the only layer with colliders.
 *   z <  0      THE CANYON  receding down its length into fog.
 *   z = -1600   BACKDROP    mesas seen through the slot, above the rim.
 */

export const CANYON = {
  /** Canyon floor at the mouth. Altitude readout is simply lander.y. */
  FLOOR_Y: 0,
  /** The rim, where the walls top out. */
  RIM_Y: 240,

  /** Half-width of the canyon floor at the mouth, before it meanders. */
  FLOOR_HALF: 62,
  /** Horizontal run the wall takes to climb from floor to rim. */
  WALL_RUN: 78,
  /**
   * Thickness of a rock stratum. Wall height is snapped toward multiples of this,
   * turning the climb into a staircase of benches at constant altitude — which is
   * how layered sedimentary rock actually erodes, and what stops the wall reading as
   * a ramp. Eight benches between floor and rim.
   */
  TERRACE_HEIGHT: 30,
  /** How strongly the wall snaps to those benches. 1 would be a pure staircase. */
  TERRACE_STRENGTH: 0.72,

  /**
   * Lateral bound for gameplay. Just past the floor edge, so the walls themselves
   * are the boundary — no invisible line, and both of them are always in frame.
   */
  PLAY_HALF_X: 70,

  /**
   * One cell of the terrain grid, in world units, used for *both* axes.
   *
   * The mesh is a plain uniform lattice: same pitch across x, same pitch along z,
   * everywhere. That is the point — every quad is congruent, so every facet catches
   * light the same way and none of them can smear. It replaces two independent LOD
   * schemes (a profile pitch with geometrically widening outer columns, and a fine depth
   * band with geometrically widening rows capped against a fan) which between them
   * produced every seam and ribbon this file has had: the two rates only agreed where
   * they happened to, and each was a separate knob to keep in proportion by hand.
   *
   * The value serves the *look*, not fidelity. Low-poly means a grid coarser than the
   * terrain's own features: the shortest wavelength in the floor and upland relief is
   * about 11 units, so 4 gives under three samples per feature and the surface can only
   * resolve as angular plates. At 0.5 it was 22 samples per feature and came out a
   * shimmering smooth sheet. The lander is 1.24 across and pads carry their own
   * colliders, so nothing it has to land on needs finer.
   *
   * This is also the collider pitch, so the cross-section the lander hits is the one
   * that gets drawn — by construction, not by matching two numbers.
   */
  CELL: 4,
  /** Collider profile half-width: out past the rim on both sides. */
  PROFILE_HALF_X: 210,
  /**
   * Half-width of the terrain sheet.
   *
   * Sized to the fog, because a uniform grid pays full price for every cell and there is
   * no longer a fan making distant width free. Above the rim the fog density is 0.0011,
   * so FogExp2 reaches 90% opacity at 1378 units and 99% at 1952 — past about 1400 the
   * terrain contributes nothing visible. Was 1300 with columns splayed to ~7000 at the
   * far end.
   */
  WORLD_HALF_X: 1000,
  /**
   * How far down its length the canyon is built. Cut from 4200 for the same reason as
   * the width: at a uniform pitch the far 2700 units would be 40% of the entire mesh,
   * and all of it invisible through the haze.
   */
  LENGTH: 1500,
  /**
   * How far the canyon extends *toward* the camera, past the play plane.
   *
   * This is what ends the ant-farm. Previously the world was sliced off at z=0 and
   * capped with a cross-section, so the camera sat outside a diorama looking in. Now the
   * valley continues past the lander and the camera flies *inside* it — which is also
   * what makes a steep, close, high-altitude shot possible without the frame filling
   * with the void where the world used to stop.
   */
  FRONT_Z: 200,

  /** Camera clearance above whatever terrain is beneath it. */
  CAMERA_CLEARANCE: 16,

} as const;

/**
 * Width of one wall facet, in units across the face.
 *
 * The cross-section is sampled at PROFILE_STEP, which is coarser than this cell, so
 * the plates are resolved by the grid rather than smoothed away. Quantising the wall relief to this cell
 * makes the height piecewise-linear across the face: each cell is a flat plate meeting
 * its neighbours at a crease, which is what the floor already looks like. Small enough
 * that the wall still has shape, large enough that the plates read as plates.
 */
export const FACET_CELL = 8;

export type CorpId = 'outpost' | 'helion' | 'kessler';

export interface Corp {
  id: CorpId;
  name: string;
  /** Neon / signage colour. Also tints this corp's pads and markers. */
  color: number;
  /** Structural colour of their buildings. */
  hull: number;
  /** Claim territory across the canyon. */
  claim: [number, number];
}

/**
 * Three parties share the canyon, and now they face each other across it: Helion
 * holds the west wall, Kessler the east, and the outpost the floor between them.
 * Over thirty missions the two corporations build toward each other — so the
 * corridor closes horizontally, in frame, directly in front of the player.
 */
export const CORPS: Record<CorpId, Corp> = {
  outpost: {
    id: 'outpost',
    name: 'IXION OUTPOST',
    color: 0x36f5a0,
    hull: 0x7d8a92,
    claim: [-16, 16],
  },
  helion: {
    id: 'helion',
    name: 'HELION EXTRACTION',
    color: 0xffa42b,
    hull: 0x8a6248,
    claim: [-66, -20],
  },
  kessler: {
    id: 'kessler',
    name: 'KESSLER DEEP',
    color: 0x35c8ff,
    hull: 0x6d8299,
    claim: [20, 66],
  },
};

export const PALETTE = {
  dust: 0xb75a30,
  skyHigh: 0x6d3f2e,
  rockLow: 0x51240f,
  rockMid: 0x99441a,
  rockHigh: 0xd98f57,
  sun: 0xffcf9a,
} as const;
