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
   *
   * **And it has to divide half a shaft cell.** An excavation's mouth boundary falls at
   * `col · SHAFT_CELL ± SHAFT_CELL/2` — at ±6, ±18, ±30 — while terrain vertices fall at
   * multiples of this. At 4 those two sets never meet: 6 is not a multiple of 4, on any
   * seed, for any column. So the hole could only ever be cut along terrain columns up to
   * two units off the true boundary, and the shaft met the landscape approximately rather
   * than exactly. Every seam at a mouth came from that, and no amount of care in the
   * cutting could have fixed it — the two grids were incommensurable.
   *
   * Three divides both 6 and 12, so a shaft's boundary now lands on terrain vertices by
   * construction. It costs a third more columns and takes the sampling from 2.75 per
   * 11-unit feature to 3.7, which is the smoothest this can go before the surface starts
   * resolving as a sheet rather than as plates — 6 would be coarser, cheaper and more in
   * keeping with the paragraph above, at the cost of visibly blockier landscape.
   *
   * `Missions.test.ts` asserts the divisibility, because it is the kind of relationship
   * that reads as an arbitrary number and silently stops holding.
   */
  CELL: 6,
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
  /** Neon / signage colour. Also tints this corp's pads. */
  color: number;
  /** Structural colour of their buildings. */
  hull: number;
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
  },
  helion: {
    id: 'helion',
    name: 'HELION EXTRACTION',
    color: 0xffa42b,
    hull: 0x8a6248,
  },
  kessler: {
    id: 'kessler',
    name: 'KESSLER DEEP',
    color: 0x35c8ff,
    hull: 0x6d8299,
  },
};

/**
 * What colony structures are *made of*, as opposed to who built them.
 *
 * These used to come from `Corp.hull`, so a Helion room was brown, a Kessler room blue-grey
 * and an Ixion one grey-green — three charters reading as three different **materials**,
 * which is not what a charter chooses. What they are made of is fixed by what is available
 * on Mars: you sinter what you dig, and you fly in what you cannot make.
 *
 * Corp identity is carried entirely by the emissive fittings now — beacons, marks, walkways
 * — which is the register that can afford it. A colour that means "whose" and a colour that
 * means "what of" were competing for the same surface, and the material lost.
 */
/**
 * One named grading of the whole canyon — structure materials and the terrain/fog/sun
 * palette together, since a scheme is what they agree to look like as a set, not two
 * independent choices. `STRUCTURE` and `PALETTE` below are the *live* values every
 * renderer reads; this is the shape a scheme has to fill to become one of them.
 */
export interface ColorScheme {
  structure: {
    /** Sintered regolith: pressure hulls, pressed from the same ground the shafts cut.
     *  Warmer and lighter than the canyon so a settlement still separates from the rock
     *  behind it. */
    regolith: number;
    /** Shipped structural steel: scaffolding, gantries, lamp housings, the radar mast.
     *  The expensive material, and visibly the imported one. */
    steel: number;
  };
  palette: {
    /** Warm terracotta — settled fines, kicked-up thruster dust, the tint mixed into
     *  sunlit rock at grazing angles. Ground material, never atmosphere; see `haze`. */
    dust: number;
    /** Fog, sky and background clear colour — what the whole canyon is seen *through*,
     *  not what it is made of. See the `reference` scheme's own comment for why this
     *  is a separate field from `dust` at all. */
    haze: number;
    /** Shadowed rock — where dust cover is thinnest. Darker than `rockMid`, which is
     *  what makes it read as shadow rather than as a different material entirely. */
    rockLow: number;
    rockMid: number;
    /** Sunlit highlight. */
    rockHigh: number;
    /**
     * The excavations' own rock — `AntFarm`'s face, back and corridor walls — as opposed
     * to `rockLow`/`rockMid`/`rockHigh`, which is everything the wind and thirty missions
     * of dust have had time to work on.
     *
     * A shaft is cut open the mission it is dug: nothing has settled on it yet, so it is
     * the one surface in this canyon that gets to be *fresh* rock rather than weathered
     * rock, and fresh rock is exactly the cool blue-grey the warm gradient above never
     * carries. `rockCut` is the face and the corridor walls; `rockCutLow` is the back
     * wall, darker for the same reason `rockLow` is darker than `rockMid` — depth needs
     * two steps, not one.
     */
    rockCut: number;
    rockCutLow: number;
    sun: number;
  };
}

/**
 * Two gradings, switchable live from the debug panel (`?debug=1` — see `Inspector`'s
 * `dbg-scheme` control) rather than only in source, so a look can be judged the way it
 * is actually seen: flying the same seed and mission, not read as a column of hex.
 *
 * **`signature`** is every value this file shipped with, unedited — "Mars orange", one
 * saturated warm colour doing the ground, the dust, the fog and the sky all at once.
 *
 * **`reference`** is retuned against real Mars photography instead: a set of Curiosity,
 * Perseverance and Spirit frames showing dune faces, rock pavement, layered outcrop and
 * hazy panoramas. Two findings drove every change in it:
 *
 * **Ground dust and atmosphere are not the same colour, and `signature` makes them one.**
 * `signature.palette.dust` is the fog/sky/background colour too (`Game.ts`'s `FogExp2`
 * used to read `PALETTE.dust` directly). In every reference frame the ground is a
 * saturated warm terracotta and the sky is pale, low-saturation, close to neutral grey
 * with only a faint warm cast — closer to dusty stone than to rust. One constant cannot
 * honestly be both, so `reference` gives the atmosphere its own: `haze`.
 *
 * **Real Mars rock is often grey, not orange.** The colour is in the dust *coating* the
 * rock, not the rock itself — fresher fracture faces and rock the wind has scoured clean
 * read distinctly cool and blue-grey against the warm dust around them, which is most of
 * what gives the reference photos their depth. `signature`'s rock gradient is warm at
 * every step, shadow to highlight; `reference.rockLow` carries some of that coolness,
 * since a rock's own shadowed face is exactly where dust cover is thinnest.
 *
 * `skyHigh` existed in `signature` and is not carried into this type at all: the sky
 * dome it tinted was disabled (`CanyonGenerator.buildSky` is a no-op — the background is
 * now a flat clear colour, see `haze`), so the field had stood doing nothing for a while.
 * Keeping a dead key around a live colour-grading tool would have made it look like a
 * lever that still worked.
 *
 * **`rockCut` is new rather than retuned**, and `signature` sets it equal to `rockMid`/
 * `rockLow` — the excavations used to be cut from the same warm gradient as everything
 * else, so `signature` reproduces that exactly rather than inventing a look it never
 * had. `reference` sets it to `STRUCTURE.steel`'s own hue, darkened for the back wall the
 * same way `rockLow` sits darker than `rockMid`: a deliberately *close* match rather than
 * the identical value, because steel is what a charter ships and cut rock is what was
 * already here, and a colour in this game means what something is made of — collapsing
 * the two to one constant would have said they were the same material.
 */
export const COLOR_SCHEMES: Record<string, ColorScheme> = {
  signature: {
    structure: { regolith: 0x9a7a60, steel: 0x7d8a92 },
    palette: {
      dust: 0xb75a30,
      haze: 0xb75a30,
      rockLow: 0x51240f,
      rockMid: 0x99441a,
      rockHigh: 0xd98f57,
      rockCut: 0x99441a,
      rockCutLow: 0x51240f,
      sun: 0xffcf9a,
    },
  },
  reference: {
    structure: { regolith: 0x9a7a60, steel: 0x7d8a92 },
    palette: {
      dust: 0xa8552e,
      haze: 0xb8a696,
      rockLow: 0x4a3a35,
      rockMid: 0x8a4a2c,
      rockHigh: 0xc99568,
      rockCut: 0x7d8a92,
      rockCutLow: 0x464d52,
      sun: 0xffcf9a,
    },
  },
};

/** Which of `COLOR_SCHEMES` the live `STRUCTURE`/`PALETTE` below currently hold. Read by
 *  the debug panel so its selector opens on the scheme actually showing, not always on
 *  the first entry. */
export let currentColorScheme: string = 'reference';

/**
 * Writes a named scheme into the live `STRUCTURE` and `PALETTE` objects, in place.
 *
 * In place rather than reassigning the exports: both are read all over the render side
 * (`CanyonGenerator`, `AntFarm`, `Rubble`, `Effects`, `Game`), almost always as
 * `PALETTE.someKey` at the moment a mesh is built rather than a reference held onto — so
 * mutating the values a fresh world-build will read is enough. This does not itself
 * repaint anything already on screen; the caller still has to rebuild the world, the way
 * `Inspector`'s `dbg-scheme` control calls `Game.setColorScheme` and that reloads the
 * current mission, exactly as changing the seed already does.
 */
export function applyColorScheme(name: string): void {
  const scheme = COLOR_SCHEMES[name];
  if (!scheme) return;
  Object.assign(STRUCTURE, scheme.structure);
  Object.assign(PALETTE, scheme.palette);
  currentColorScheme = name;
}

export const STRUCTURE: { regolith: number; steel: number } = {
  ...COLOR_SCHEMES[currentColorScheme].structure,
};

export const PALETTE: {
  dust: number;
  haze: number;
  rockLow: number;
  rockMid: number;
  rockHigh: number;
  rockCut: number;
  rockCutLow: number;
  sun: number;
} = { ...COLOR_SCHEMES[currentColorScheme].palette };
