import type { Excavation } from './CanyonGenerator.ts';

/**
 * What direction a bore travels, and which way its sides face.
 *
 * All that remains of `Shaft`, which built an excavation as a *tube*: two meandering side
 * walls, a far cap, strip lights, and a collar stitching its mouth ring to whatever the
 * terrain happened to do at that x. It is replaced by `AntFarm`, which carves the same
 * excavation out of the colony's own grid — so the mouth is a hole cut from the same cells
 * the geometry is built from, rather than two noise fields brought close and never joined.
 *
 * These two helpers survive because "which way does this dig point" is a question about the
 * ledger, not about how the hole is drawn, and `ColonyChannels`, `Layout`, `ShaftGrid` and
 * the terrain all still ask it.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function boreDirection(dig: Excavation): { dir: Vec2; perp: Vec2 } {
  const raw = dig.direction ?? { x: 0, y: -1 };
  const mag = Math.hypot(raw.x, raw.y) || 1;
  const dir = { x: raw.x / mag, y: raw.y / mag };
  return { dir, perp: { x: -dir.y, y: dir.x } };
}

/** True for a bore close enough to straight-down that the heightfield's own dip-and-
 *  omit carving (see `CanyonGenerator.floorDetail`/`overShaft`) still applies to it. Not
 *  `=== -1` exactly, so a slightly wandering-down bore does not fall through the gap
 *  between the two carving strategies. */
export function isFloorMounted(dir: Vec2): boolean {
  return dir.y < -0.9;
}
