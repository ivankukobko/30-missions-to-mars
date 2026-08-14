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
   * `'wall'` (default) opens a mouth partway up the wall face and drives **horizontally**
   * into the rock. `'floor'` keeps the dig on the canyon floor and drives straight down;
   * only `x` moves, pulled back *toward centre* from the wall edge by its own half-width
   * plus clearance, so it never straddles the floor-to-wall blend (`CANYON.WALL_RUN`) —
   * the opposite direction from `'wall'`'s own inset, which pushes *past* the edge.
   *
   * So the two modes are the two axes and nothing between them. A wall bore used to
   * follow the wall's own local slope, which drove it diagonally downward and put a
   * horizontal pad in the upper half of a tube whose floor had fallen away — see
   * `resolveTerrainAnchoredDigs`.
   *
   * The campaign text is what fixes each mode to its axis. Kessler: *"Come down slow and
   * come down straight, tin can"* (mission 16), *"Line up over the mouth and descend
   * straight... barely wider than your gear"* (mission 23). Helion, in the same ledger:
   * *"Kessler dug a hole. We are digging a room."* (mission 19) — a room you fly into,
   * level, which is why its own airframe cannot rotate (`airframeFor`).
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
 * The wall's own inward normal used to set a wall bore's direction, sampled either side of
 * the mouth. It is gone, along with `SLOPE_PROBE`/`SLOPE_DELTA` and a fallback for probes
 * that landed on a terrace tread and read as nearly flat.
 *
 * What it produced was a bore driven at whatever angle the rock happened to slope at —
 * about 17° below horizontal for Helion's cavern — and both things that live in a bore
 * want it level. A horizontal deck in a descending tube ends up in the upper half of it
 * with the floor fallen away beneath, and an approach that has to be flown in level
 * (`airframeFor`) should not also be a descent inside a tube whose far end the player
 * cannot see. `resolveTerrainAnchoredDigs` now drives straight in, and a floor mount
 * straight down; there is no third case.
 */

export interface DigEndpoint {
  /** The bore's *axis* at its far end. A pad is set down on the floor below this, not
   *  here — see `applyDigAttachments`. */
  x: number;
  y: number;
  halfWidth: number;
  /** Vertical distance from the axis to the tube's floor, per unit of half-width: 1 for a
   *  level bore, 0 for a vertical one whose endpoint already *is* its floor. */
  floorPerHalfWidth: number;
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
    /**
     * Straight down, or straight in — **never a diagonal.**
     *
     * A wall bore used to follow the wall's own inward normal (`wallNormalInward`), which
     * on a sloped face carries a real downward component: Helion's cavern came out driven
     * at about 17° below horizontal. That is a nice idea and it is wrong for the two things
     * that actually have to happen inside it.
     *
     * A pad in a bore is a horizontal deck, and a bore that descends puts its far end
     * below its mouth by a third of its own width — so the deck ends up in the upper half
     * of a tube whose floor has dropped away beneath it, which is what a platform floating
     * near the roof of the cavern looked like. And the approach is a pitch-over-and-fly-in
     * problem by design (see `airframeFor`); a lane that also sinks as it goes asks the
     * player to hold a descent rate inside a tube they cannot see the far end of.
     *
     * Level, both of those are ordinary: the deck sits at the height of the mouth you flew
     * through, and the flight is fly in, stop, land. A floor mount keeps the straight-down
     * default explicitly, not omitted, so the endpoint formula below is one expression for
     * both branches rather than a special case that has to agree with it by hand.
     */
    const direction = onFloor ? { x: 0, y: -1 } : { x: side, y: 0 };
    // Natural (un-carved) height at the mouth — the same quantity `CanyonGenerator`'s
    // own `wallMouthY` measures post-build; computed the same way here, pre-build,
    // since this dig's own bore doesn't exist yet to be included either way.
    const mouthY = terrain.heightAt(x, 0, false);
    if (d.id) {
      endpoints.set(d.id, {
        x: x + direction.x * d.depth,
        y: mouthY + direction.y * d.depth,
        halfWidth: d.halfWidth,
        /**
         * How far the bore's floor lies below its axis, per unit of half-width — the
         * vertical drop to the tube wall, which is the full half-width for a level bore
         * and nothing at all for a vertical one (a shaft's endpoint *is* its floor).
         */
        floorPerHalfWidth: Math.sqrt(1 - direction.y * direction.y),
      });
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
    if (p.kind !== 'pad') {
      // A roof hangs from the far end, it does not rest on it — the axis is where it goes.
      return { ...p, x: end.x, y: end.y };
    }
    /**
     * **A pad goes on the bore's floor, not on its axis.**
     *
     * The endpoint is the centre of the tube's far end, which for a shaft driven straight
     * down is also its floor — so this was invisible for as long as every bore was
     * vertical. A level bore's floor is a full half-width below its axis, and Helion's
     * cavern pad sat at the axis: measured on seed 631729407, a deck at y −13.8 in a tube
     * whose floor was at −26.4, a platform hanging twelve units clear of the ground in the
     * upper half of the cavern.
     *
     * Dropped by the tube's own geometry rather than by its full half-width, so the deck's
     * *corners* land on the wall instead of its centre landing on the lowest point and its
     * edges burying themselves in rock: in a circular section of radius `R`, a deck of
     * half-width `w` meets the wall `sqrt(R² − w²)` below the axis.
     *
     * Then lifted clear, the same mistake a ground pad avoids with its own 1.3 in
     * `buildPad` — deck and rock coplanar means the platform loses its shadow and its
     * silhouette, and at the end of a dark bore it stops reading as a structure at all.
     */
    const halfDeck = Math.min(p.width / 2, end.halfWidth);
    const drop = end.floorPerHalfWidth * Math.sqrt(end.halfWidth ** 2 - halfDeck ** 2);
    return { ...p, x: end.x, y: end.y - drop + DIG_PAD_LIFT };
  });
}
