import type { Excavation } from '../world/CanyonGenerator.ts';
import type { Prop } from '../world/Colony.ts';
import { snapToColumn } from '../world/ColonyLattice.ts';
import { SHAFT_CELL, anchorCells, shaftGrid, type Carved } from '../world/ShaftGrid.ts';

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
  /** The excavation's drawn shape, when the campaign authored one — see
   *  `Excavation.cells`. Carried through resolution unchanged: resolving decides where a
   *  dig opens, and a drawing is what it opens into. */
  cells?: Carved[];
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

/**
 * How much ground a deck resting on the terrain denies a mouth.
 *
 * `CanyonGenerator.build` grades a shelf under every ground-resting deck: level to
 * `halfWidth` 9, then eased back to natural contour over a `shoulder` of 10. Nine is the
 * part that is flatly wrong to open a shaft through; the shoulder only lifts the ground
 * part-way, and charging the full nineteen leaves no legal column at all — measured on
 * seed 12345, a usable band of 66 units and two decks excluding every unit of it.
 *
 * So: the flat core, plus half the shoulder, which is where the shelf has given back most
 * of its lift.
 *
 * This class of fault is what the number is for. A mouth inside a shelf renders as a
 * shaft, colliders and all, under solid ground with somebody's landing pad on it — seed
 * 1158123495 before any of this, mouth spanning x −18…+6 and Ixion's deck at −12.
 */
export const DECK_BENCH_REACH = 14;

/**
 * How much a deck standing *above* the ground denies a mouth: its own footprint and a
 * hull either side, and nothing more.
 *
 * An elevated deck grades nothing — it is a platform on a tower — so the only thing it
 * takes from a shaft is the air it physically occupies. A flat constant was tried first
 * and is too blunt: `kessler-crest` spans x 31…41, so at a fixed reach of 8 it excluded
 * mouths as far away as 22 that its own footprint never touches, and on a narrow seed that
 * was the difference between one legal column and none.
 *
 * Zero, and the footprint alone, because there is nothing left to spend. This canyon is
 * often only a hundred units of floor wide and already carries three decks; measured, a
 * margin of two was the whole difference between a legal mouth and none on three seeds in
 * ten. A deck's edge and a mouth's edge meeting exactly is fine — the deck is twelve units
 * up and the descent passes beside it, not through it.
 */
const DECK_AIR_MARGIN = 0;

/**
 * The ground a mouth opens through, as a span, given the bore's resolved x.
 *
 * **Asymmetric, and that is the whole reason this is a function rather than a radius.**
 * A bore's mouth occupies the two columns `colAt(x) - 1` and `colAt(x)` — the same pair
 * `anchorCells` and the rasteriser both land on — so it reaches a cell and a half west of
 * its own x and only half a cell east. A symmetric clearance built from `x` looks right,
 * passes, and leaves the west half of the opening under the bench by a unit or two.
 */
export function mouthSpan(x: number): [number, number] {
  return [x - SHAFT_CELL * 1.5, x + SHAFT_CELL * 0.5];
}

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
  /**
   * Where one cell of this dig's drawing sits in the world, for digs that have one.
   *
   * The fields above describe a tube: a pad attached to this dig lands at
   * `mouthY + direction * depth`, adjusted for the tube's floor and end cap. That is
   * exact for a straight bore and **meaningless the moment a drawing bends** — a complex
   * with a gallery running off it has no single far end, so "the endpoint" stops naming
   * anywhere a deck could go.
   *
   * So a pad in a drawn excavation names a cell instead (`atCell`), and this resolves it
   * through the same anchoring the carve uses. Returns the cell's **floor** rather than
   * its centre, because that is what a deck rests on.
   */
  cell?: (col: number, row: number) => { x: number; y: number };
  /**
   * The bore's unit direction, carried through rather than the two scalars that used to be
   * derived from it here.
   *
   * Both things `applyDigAttachments` has to do to fit a deck inside a tube are functions
   * of this one vector — how far below the axis the floor is (`|x|`, since a level bore's
   * floor is a full half-width down and a vertical bore's endpoint already *is* its floor),
   * and how far back along the axis the deck has to sit so its far edge stops at the end
   * cap rather than continuing into rock. Storing a pre-chewed scalar for the first and
   * nothing at all for the second is what let the second go unnoticed.
   */
  direction: { x: number; y: number };
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
export function resolveTerrainAnchoredDigs(
  digs: DigEntry[],
  terrain: WallTerrain,
  /**
   * Ground-pad x positions the mouth must not open on top of — see `PAD_MOUTH_CLEARANCE`.
   *
   * Passed in rather than derived here: resolution sees digs and terrain and never props.
   * The caller that has both is `missionWorlds`, which already collects the campaign's pad
   * sites for the terrain grader and can hand the same list to this.
   */
  keepClearOf: Array<{ x: number; halfWidth: number; onGround: boolean }> = [],
): ResolvedDigs {
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
    /**
     * Then stepped clear of any deck standing on the ground, a column at a time.
     *
     * Compared as spans, not distances — see `mouthSpan` for why a radius is wrong here.
     *
     * Toward the wall, never toward centre: the far side is open floor the colony is free
     * to grow across, while the wall side is ground this dig has already been given
     * `FLOOR_CLEARANCE` of. Capped at four columns so a pathological seed gives up rather
     * than walking the mouth into the wall blend — and if it ever does give up, the layout
     * check is what reports it, in the same DEV pass everything else here is caught by.
     */
    let placed = onFloor ? snapToColumn(raw) : raw;
    if (onFloor) {
      /**
       * Searched outward from the natural position, nearest column first, both ways.
       *
       * This stepped only toward the wall to begin with, on the reasoning that the far side
       * is open floor the colony wants. That is true and it is not worth a mouth that never
       * finds a clear column: three decks stand on this canyon and a narrow seed can put the
       * wall within a couple of columns, so a one-directional walk can run out of room while
       * clear ground sits just the other way. Nearest-first keeps the original preference —
       * ties break toward the wall — without making it the only option.
       */
      const blocked = (at: number): boolean => {
        const [west, east] = mouthSpan(at);
        return keepClearOf.some((deck) => {
          const reach = deck.onGround
            ? DECK_BENCH_REACH
            : deck.halfWidth + DECK_AIR_MARGIN;
          return deck.x + reach > west && deck.x - reach < east;
        });
      };
      /**
       * Bounded by the floor it has to open through.
       *
       * Without this the search walks until it finds clear ground and does not care where
       * that is: measured across four seeds it put the mouth at x 72 with the east floor
       * edge at 44 — a shaft opening inside the wall, which is worse than the deck it was
       * avoiding. A mouth outside the floor is not a candidate at any distance.
       */
      const west = terrain.floorEdgeAt(0, -1) + d.halfWidth + FLOOR_CLEARANCE;
      const east = terrain.floorEdgeAt(0, 1) - d.halfWidth - FLOOR_CLEARANCE;
      const usable = (at: number): boolean => at >= west && at <= east && !blocked(at);

      for (let step = 1; step <= 8 && blocked(placed); step++) {
        const toward = snapToColumn(raw + side * SHAFT_CELL * step);
        const away = snapToColumn(raw - side * SHAFT_CELL * step);
        if (usable(toward)) placed = toward;
        else if (usable(away)) placed = away;
      }
    }
    const x = placed;
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
      /**
       * A cell resolver for drawn digs, built here because this is the only place that
       * knows both halves: the mouth `x` this resolution just chose, and the natural
       * surface height at it. `carveFromDig` anchors the drawing exactly this way, so a
       * pad placed through this lands in the cell the author drew it in rather than near
       * it.
       */
      const grid = shaftGrid(mouthY);
      const anchored = d.cells ? anchorCells(d.cells, grid.colAt(snapToColumn(x))) : null;
      const offset = anchored && d.cells ? anchored[0].col - d.cells[0].col : 0;

      endpoints.set(d.id, {
        x: x + direction.x * d.depth,
        y: mouthY + direction.y * d.depth,
        halfWidth: d.halfWidth,
        direction,
        ...(anchored === null
          ? {}
          : {
              cell: (col: number, row: number) => ({
                x: grid.worldX(col + offset),
                // The cell's floor, not its centre: `worldY` returns the middle of a cell
                // and a deck rests on the bottom face.
                y: grid.worldY(row) - SHAFT_CELL / 2,
              }),
            }),
      });
    }
    // `cells` rides through untouched. Resolution decides *where* a dig opens; a drawing
    // is *what* it opens into, anchored on the mouth at carve time — so rebuilding the
    // record without it silently drops every authored excavation back to a rasterised
    // tube, which is what happened here and which no unit test caught: they carve the
    // authored dig, and only the resolved one ever reaches the canyon.
    return { x, halfWidth: d.halfWidth, depth: d.depth, lengthZ: d.lengthZ, direction, cells: d.cells };
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
     * A deck in a drawn excavation sits in the cell it was drawn in, and none of the tube
     * arithmetic below applies to it.
     *
     * That arithmetic exists to fit a rectangle inside a *circular section* — dropping the
     * deck to where its corners meet the wall, holding it back off the end cap. A drawn
     * excavation has neither: cells are square, the floor is a flat face at a known height,
     * and there is no cap to sit in front of. `cell` already returns that floor, so the
     * only thing left is the same lift clear of it that every ground pad takes, for the
     * same reason — a deck coplanar with rock loses its shadow and stops reading as a
     * structure at the bottom of a dark bore.
     */
    if (p.atCell && end.cell) {
      const at = end.cell(p.atCell.col, p.atCell.row);
      return { ...p, x: at.x, y: at.y + DIG_PAD_LIFT };
    }
    if (p.atCell) {
      console.warn(`Pad "${p.id}" names a cell in "${p.attachToDig}", which has no drawing`);
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
     *
     * **And back from the end cap, not centred on it.** The endpoint is where the bore
     * stops — `Shaft.buildEndCap` closes it there and `addColliders` lays a collider
     * across it — so a deck centred on the endpoint puts half its width beyond the rock
     * face. That was invisible for as long as every bore ran straight down, because a
     * vertical bore's axis is perpendicular to the deck's width and the two never
     * competed for the same units. A level bore's axis *is* the deck's width axis:
     * Helion's cavern deck, 12 wide at the end of a 46-deep bore, had six units of itself
     * inside the west wall. Backing off by the deck's own half-width lands its far edge on
     * the cap exactly, which is also what a deck built against the back of a room does.
     *
     * `direction.x` is 0 for a shaft and ±1 for a bore, so this is one expression for both
     * rather than a branch — the same reason the drop is written as a projection.
     */
    const halfDeck = Math.min(p.width / 2, end.halfWidth);
    const drop = Math.abs(end.direction.x) * Math.sqrt(end.halfWidth ** 2 - halfDeck ** 2);
    return { ...p, x: end.x - end.direction.x * halfDeck, y: end.y - drop + DIG_PAD_LIFT };
  });
}
