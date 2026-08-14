import type { Excavation } from '../world/CanyonGenerator.ts';
import type { Prop } from '../world/Colony.ts';
import { snapToColumn } from '../world/ColonyLattice.ts';

/**
 * A dig anchored to the real canyon wall rather than an authored `x`.
 *
 * Every other dig in the campaign is a fixed constant — fine for a floor pit, since the
 * flat floor barely varies by seed. It's wrong for a wall-mounted bore: the canyon's
 * centreline wanders up to ±38 by seed while an authored `x` doesn't, so a fixed
 * "near the wall" position sits on open floor on some seeds and inside solid rock on
 * others (this is the corner-shaft problem the plan doc already recorded as open,
 * before there was a wall-mounted dig in the campaign to hit it). `x` and `direction`
 * are resolved from the real per-seed terrain instead, once it exists — see
 * `resolveTerrainAnchoredDigs`.
 */
export interface WallAnchoredDig {
  anchorToWall: 'west' | 'east';
  /**
   * `'wall'` (default) opens a mouth partway up the wall face, direction resolved from
   * the wall's own local slope — see `wallNormalInward`. `'floor'` keeps the dig on the
   * canyon floor, direction left at `Excavation`'s own straight-down default; only `x`
   * moves, pulled back *toward centre* from the wall edge by its own half-width plus
   * clearance, so it never straddles the floor-to-wall blend (`CANYON.WALL_RUN`) —
   * the opposite direction from `'wall'`'s own inset, which pushes *past* the edge.
   *
   * Kessler's shaft is the first `'floor'` consumer, and it needs its own mode rather
   * than reusing `'wall'` unmodified: `wallNormalInward` always returns a direction with
   * `dir.y` well clear of `isFloorMounted`'s threshold (its real-slope branch reads the
   * wall's own rise, and its shallow-slope fallback is a fixed 60°-off-vertical, neither
   * ever close to straight down — see that function's own doc comment), so anchoring
   * Kessler to the wall with `'wall'`'s existing direction math would silently turn its
   * shaft diagonal. The campaign text won't allow that: *"Come down slow and come down
   * straight, tin can"* (mission 16), *"Line up over the mouth and descend
   * straight... barely wider than your gear"* (mission 23) — explicitly a vertical
   * descent, contrasted against Helion's own wall-mounted cavern in the same ledger
   * (*"Kessler dug a hole. We are digging a room."*, mission 19).
   */
  mount?: 'wall' | 'floor';
  halfWidth: number;
  depth: number;
  lengthZ?: number;
  /** Looked up by `resolveDigEndpoint` so a prop authored as "the destination inside
   *  this shaft" (a pad, a cave roof) can find where the shaft's own bore actually
   *  ends, once that end is no longer directly below the mouth. */
  id?: string;
}

export type DigEntry = Excavation | WallAnchoredDig;

function isWallAnchored(d: DigEntry): d is WallAnchoredDig {
  return 'anchorToWall' in d;
}

/** The slice of `CanyonGenerator` a wall anchor needs — both methods are pure
 *  functions of z and the seed-derived noise field, so (verified) they're safe to call
 *  on a `CanyonGenerator` instance before its own `.build()` runs for this mission,
 *  which is exactly when this has to run: a dig's real position and direction have to
 *  be known *before* `canyon.build()` can carve them. */
export interface WallTerrain {
  floorEdgeAt(z: number, side: 1 | -1): number;
  heightAt(x: number, z: number, includeDigs?: boolean): number;
}

/** How far in from the real wall edge an anchored dig's mouth sits — the same "sunk
 *  just enough to read as anchored" margin every other floor-anchored prop in
 *  `Colony.ts` already uses, big enough that the bore's own half-width doesn't poke
 *  back out through the wall face it's meant to be driven into. */
const WALL_INSET = 6;

/** How far *back toward centre* a `mount: 'floor'` dig's mouth sits from the real wall
 *  edge — the opposite direction from `WALL_INSET`, and a wider margin, because this
 *  side has to clear the *whole* floor-to-wall blend (`CANYON.WALL_RUN`) rather than
 *  sink just past a wall face. Own half-width added on top at the call site, so a wider
 *  dig automatically keeps its far edge clear too, not just its centre. */
const FLOOR_CLEARANCE = 20;

/** How far a pad bolted to a dig's far end stands proud of it — see `applyDigAttachments`.
 *  Above the 1.3 a ground pad uses, and for a reason that is about reading rather than
 *  physics: a bore's floor and its pad are the same colour in the same dark, so the deck
 *  needs enough separation to throw a shadow of its own. */
const DIG_PAD_LIFT = 3;

/**
 * How far *further* into the wall (past the mouth itself) to sample for the bore's own
 * direction. Deliberately not sampled right at the mouth: the mouth sits close to
 * `floorEdgeAt`'s own boundary, right where the floor-to-wall blend and the wall's own
 * terracing benches are least representative of the wall's overall rise — a probe that
 * happened to land on a near-flat tread there would read as barely sloped at all.
 * Probing further in averages across at least one terrace's worth of the real slope.
 */
const SLOPE_PROBE = 20;
/** Half-span of the two heightAt samples the local slope is estimated from. */
const SLOPE_DELTA = 10;

/**
 * The unit direction orthogonal to the wall's local surface at `x`, pointing *into* the
 * rock (never into open air — a bore has to go somewhere solid).
 *
 * For a heightfield `y = f(x)`, the outward/up normal is `(-f'(x), 1)` (verified against
 * the flat-floor case: `f'(x) = 0` gives straight up, which is correct), so the inward
 * one — the direction this returns — is its opposite, `(f'(x), -1)`, normalised. This
 * formula needs no wall-side branch: it comes out pointing the right way for both walls
 * from the sign of the sampled slope alone.
 *
 * `includeDigs: false` on both samples — probing across an *existing* dig's own carved
 * pit would read that pit's slope, not the wall's, which is exactly wrong for a mouth
 * being anchored to virgin rock.
 */
function wallNormalInward(terrain: WallTerrain, x: number): { x: number; y: number } {
  const y0 = terrain.heightAt(x - SLOPE_DELTA, 0, false);
  const y1 = terrain.heightAt(x + SLOPE_DELTA, 0, false);
  const slope = (y1 - y0) / (2 * SLOPE_DELTA);
  const mag = Math.hypot(slope, 1);

  // A slope this shallow means the probe landed somewhere that reads as nearly flat
  // (a terrace tread, or still inside the floor-to-wall blend) — trusting it would
  // produce a direction close enough to straight down that `isFloorMounted` (Shaft.ts,
  // `dir.y < -0.9`) would silently reclassify this as a floor mount. A fixed 60°-off-
  // vertical fallback, angled toward the wall the probe was sampling, stays honestly
  // "roughly orthogonal to a wall that's here somewhere" rather than shipping a bore
  // that reads as boring straight down.
  if (1 / mag > 0.85) {
    const side = Math.sign(slope) || 1;
    return { x: side * Math.sin((60 * Math.PI) / 180), y: -Math.cos((60 * Math.PI) / 180) };
  }
  return { x: slope / mag, y: -1 / mag };
}

export interface DigEndpoint {
  x: number;
  y: number;
}

export interface ResolvedDigs {
  digs: Excavation[];
  /** Where each *identified* dig's bore actually ends (mouth plus `depth` along its own
   *  `direction`) — keyed by `WallAnchoredDig.id`. A pad or cave roof authored as "the
   *  destination inside this shaft" used to just share the dig's own hand-typed `x`/`y`,
   *  which only worked because the shaft went straight down. Once a shaft's direction
   *  carries real horizontal travel, the destination has to be looked up here instead —
   *  see `Game.loadMission`, where the Helion-cavern pad and cave roof get repositioned
   *  to this. Only entries with an `id` appear; ordinary digs have nothing to look up. */
  endpoints: Map<string, DigEndpoint>;
}

/**
 * Resolves every `WallAnchoredDig` in a mission's ledger to a real `Excavation`, using
 * terrain that has to already exist for this to mean anything — see `WallTerrain`'s doc
 * comment for why calling it before *this* mission's own `canyon.build()` is still
 * sound. Ordinary `Excavation` entries pass through untouched.
 */
export function resolveTerrainAnchoredDigs(digs: DigEntry[], terrain: WallTerrain): ResolvedDigs {
  const endpoints = new Map<string, DigEndpoint>();
  const resolved = digs.map((d): Excavation => {
    if (!isWallAnchored(d)) return d;
    const side: 1 | -1 = d.anchorToWall === 'east' ? 1 : -1;
    const wallX = terrain.floorEdgeAt(0, side);
    const onFloor = d.mount === 'floor';
    // `side` already points in the "further into this wall" direction (+1 = east wall
    // sits at increasing x, -1 = west wall at decreasing x). A wall mount pushes past
    // the edge, into the rock; a floor mount pulls back the opposite way, staying on
    // flat floor clear of the blend — never both, never straddling it.
    /**
     * A floor bore is snapped to the colony lattice; a wall bore is not.
     *
     * A shaft driven straight down is a vertical corridor like any other, and an unsnapped
     * one straddles two columns for its whole height — plus the mouth keep-out either
     * side of it, which is the single widest reservation in the canyon. Half a cell of
     * drift along a floor that was chosen for being flat costs nothing.
     *
     * A wall bore's `x` *is* the wall face, measured from terrain, and the mouth ring, the
     * cave roof and the bore's own geometry are all built from it. Moving it six units
     * would put the opening somewhere the rock is not.
     */
    const raw = onFloor ? wallX - side * (d.halfWidth + FLOOR_CLEARANCE) : wallX + side * WALL_INSET;
    const x = onFloor ? snapToColumn(raw) : raw;
    // A floor mount keeps `Excavation`'s own straight-down default explicitly (not
    // omitted) so the endpoint formula below is one expression for both branches,
    // rather than a floor-mount special case that has to agree with it by hand.
    const direction = onFloor ? { x: 0, y: -1 } : wallNormalInward(terrain, x + side * SLOPE_PROBE);
    // Natural (un-carved) height at the mouth — the same quantity `CanyonGenerator`'s
    // own `wallMouthY` measures post-build; computed the same way here, pre-build,
    // since this dig's own bore doesn't exist yet to be included either way.
    const mouthY = terrain.heightAt(x, 0, false);
    if (d.id) {
      endpoints.set(d.id, { x: x + direction.x * d.depth, y: mouthY + direction.y * d.depth });
    }
    return { x, halfWidth: d.halfWidth, depth: d.depth, lengthZ: d.lengthZ, direction };
  });
  return { digs: resolved, endpoints };
}

/**
 * Moves every `pad`/`caveRoof` authored with `attachToDig` to that dig's real endpoint,
 * and every pad authored with `xFromDig` to that dig's real *x* only — see those two
 * doc comments on `Colony.ts`'s `Prop` variants for why they're different mechanisms,
 * not two names for one. A prop whose named dig has no endpoint (a typo, or a plain
 * `Excavation` id that was never meant to have one) is left at its authored placeholder
 * and reported, the same way an unknown mission target pad already is in
 * `Game.loadMission` — silently wrong is worse than visibly wrong.
 */
export function applyDigAttachments(props: Prop[], endpoints: Map<string, DigEndpoint>): Prop[] {
  return props.map((p) => {
    if (p.kind === 'pad' && p.xFromDig) {
      const end = endpoints.get(p.xFromDig);
      if (!end) {
        console.warn(`Prop x-locked to unknown dig "${p.xFromDig}"`);
        return p;
      }
      return { ...p, x: end.x };
    }
    if ((p.kind !== 'pad' && p.kind !== 'caveRoof') || !p.attachToDig) return p;
    const end = endpoints.get(p.attachToDig);
    if (!end) {
      console.warn(`Prop attached to unknown dig "${p.attachToDig}"`);
      return p;
    }
    // A pad stands *on* the bore's end, not in it. Landing flush with the floor it rests
    // on is the same mistake a ground pad avoids with its own 1.3 of lift (`buildPad`) —
    // deck and rock end up coplanar, the platform loses its own shadow and silhouette, and
    // at the bottom of a dark shaft it stops reading as a structure at all. A little more
    // than the ground case, because down a bore there is no horizon behind it to separate
    // the two. A roof gets none of this: it hangs from the far end, it does not rest on it.
    return { ...p, x: end.x, y: p.kind === 'pad' ? end.y + DIG_PAD_LIFT : end.y };
  });
}
