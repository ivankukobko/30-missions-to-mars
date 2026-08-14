import type { Prop } from '../world/Colony.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import { boreDirection, isFloorMounted } from '../world/Shaft.ts';
import { CHANNEL_HALF, type Channel } from './ColonyChannels.ts';

/**
 * The slice of `CanyonGenerator` a wall-mounted mouth's precise position needs — narrow
 * on purpose so this module doesn't have to import the concrete class (which would pull
 * terrain generation into a module that otherwise never touches it) just to type one
 * parameter. A real `CanyonGenerator` satisfies this structurally.
 */
export interface MouthTerrain {
  wallMouthY(dig: Excavation): number;
}

/**
 * Layout rules for the colony planner.
 *
 * What a pad demands of everything built afterwards, checked mechanically rather
 * than by eye:
 *
 *   1. Nothing stands *on* a landing surface. A pad's footprint is reserved from just
 *      under the deck to well above it.
 *   2. Something has to be able to *reach* it. A corridor over the pad's core stays
 *      clear all the way up, so a descent has somewhere to come down.
 *
 * Rule 2 deliberately stops at a cave roof. A pad under a deliberate ceiling is a
 * cave — the roof is the level design, not a violation — so the corridor requirement
 * applies only to the open air beneath it.
 *
 * Rule 2 is now carried by `ColonyChannels.ts` for colonies specifically: a pad's real
 * approach is a route that bends around rock, not a vertical column, and growth is
 * generated against that route rather than checked against a column afterwards. The
 * column rule stays here for everything else, and for callers with no routes to hand.
 *
 * This module used to also *resolve* violations — relocating a hand-authored
 * `tower`/`mast`/`gantry` that drifted into a pad's rules over a campaign where
 * nothing was ever removed. Those prop kinds are gone (see the `Prop` doc comment in
 * `Colony.ts`): every mission's structure is now `colony`, grown safe-by-construction
 * against the channel network, so there is nothing left to relocate. `resolveLayout` is
 * now a pass-through for that reason, not an oversight — see its own doc comment.
 */

/**
 * How far above a deck a structure must start to count as *over* it rather than *on*
 * it. Deliberately small: the deck rule is about things planted through the landing
 * surface, and anything clear of it is judged by the corridor rule instead, which
 * cares about how much of the approach is blocked rather than a fixed height.
 */
const DECK_CLEAR = 3;
/** How far below a deck the keep-out starts, catching things bolted underneath. */
const DECK_UNDER = 5;
/**
 * Half-width of the corridor that must stay clear above a pad. The hull is 1.24
 * across, so this is not about fitting — it is about having room to be wrong and
 * still correct, on a vehicle that answers the stick slowly under load.
 */
const CORE_HALF = 5;
/** How far up the corridor is enforced. Above this a span reads as scenery. */
const CORRIDOR_HEIGHT = 130;
/**
 * Props are treated as this much wider than they are. Clearance measured to the exact
 * face means grazing it counts as passing.
 */
const MARGIN = 1.2;

export interface Violation {
  /** Mission that introduced the offending prop, when known. */
  mission?: number;
  rule: 'deck' | 'corridor' | 'mouth' | 'channel';
  pad: string;
  prop: string;
  detail: string;
}

/**
 * Horizontal extent of a prop, widened by `m`. Clearance against a *pad* uses the full
 * margin on the prop alone; clearance between two props must not apply it twice, or
 * two structures need 2.4 units of air between them and the resolver rejects slots
 * that are perfectly legal.
 */
function spanX(p: Prop, m: number = MARGIN): [number, number] {
  switch (p.kind) {
    case 'pad':
      return [p.x - p.width / 2 - m, p.x + p.width / 2 + m];
    // Not centred on `x` the way a pad is on its own `x` — `x` is the shared grid's
    // own column-0 origin, not this corp's anchor, and growth away from the anchor is
    // one-directional for a wall-rooted corp, so the occupied span is tracked
    // explicitly rather than assumed symmetric. See the `colony` variant's doc
    // comment in Colony.ts.
    case 'colony':
      return [p.footprintX[0] - m, p.footprintX[1] + m];
    case 'caveRoof':
      return [p.x - p.halfWidth, p.x + p.halfWidth];
    /**
     * Degenerate, to say plainly that the radar occupies nothing. Note that this alone
     * does not exempt it — `overlaps` counts a point strictly inside an interval as
     * overlapping, so a zero-width span still trips the corridor rule. `hasCollider` is
     * what actually enforces the exemption; this stays degenerate so that any future
     * caller reaching for the radar's extent gets an honest answer.
     */
    case 'radar':
      return [p.x, p.x];
  }
}

/**
 * Whether this prop is something a lander can hit.
 *
 * Only the radar is not. It is a landmark rather than colony hardware — the one
 * structure the player sited themselves, deliberately built without a collider so it can
 * stand wherever they set down, including inside ground a later colony grows through. So
 * it can neither block an approach nor be blocked by one, and the layout rules have to
 * ignore it outright.
 *
 * This used to be left to `spanX` returning a zero-width span, which does not work:
 * `overlaps([7, 7], [5, 15])` is true, because a degenerate interval inside another
 * still satisfies both halves of the test. The consequence was live but invisible — from
 * mission 21, where `kessler-ledge` sits at y=-45, a radar planted anywhere near x=10
 * was reported as blocking the shaft's approach corridor. Nothing acted on it, because
 * the only consumer was a `console.warn` behind the DEV flag.
 */
function hasCollider(p: Prop): boolean {
  return p.kind !== 'radar';
}

/**
 * Vertical extent of a prop.
 *
 * A colony stands on the canyon floor, whose exact height is a function of the seed
 * and not known here. `FLOOR_BASE` is a floor-with-relief estimate: low enough to be
 * conservative for anything at grade, but *not* unbounded — treating it as infinitely
 * deep would have it reaching down into excavations it stands beside, and wrongly
 * condemn every pad at the bottom of a shaft.
 *
 * Exported for `ColonyAvailability.ts`, which needs the same "floor-with-relief
 * estimate" as the shared row-to-Y datum its availability grid measures cells against
 * — see that file's doc comment for why a shared, fixed datum (not per-column real
 * terrain) is the right call there too.
 */
export const FLOOR_BASE = -6;

function spanY(p: Prop): [number, number] {
  switch (p.kind) {
    // Real, measured bounds — growth is fitted to real terrain (`ColonyLattice.ts`), so
    // unlike every other floor-anchored prop here a colony's vertical extent is known
    // rather than estimated off `FLOOR_BASE`.
    case 'colony':
      return p.spanY;
    case 'caveRoof':
      return [p.y, p.y + 4];
    case 'pad':
      return [(p.y ?? 0) - 0.9, p.y ?? 0];
    // Occupies no space in the layout system — see spanX.
    case 'radar':
      return [FLOOR_BASE, FLOOR_BASE];
  }
}

function label(p: Prop): string {
  if (p.kind === 'pad') return `pad ${p.id}`;
  if (p.kind === 'colony') return `colony ${p.corp} x=${p.footprintX[0].toFixed(0)}..${p.footprintX[1].toFixed(0)}`;
  return `${p.kind} ${p.corp} x=${p.x}`;
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/**
 * Height of the lowest deliberate ceiling over a pad, or Infinity in open air. The
 * corridor is only enforced below this.
 */
function ceilingOver(pad: Extract<Prop, { kind: 'pad' }>, props: Prop[]): number {
  let lowest = Infinity;
  const padY = pad.y ?? 0;
  for (const p of props) {
    if (p.kind !== 'caveRoof') continue;
    if (!overlaps(spanX(p), [pad.x - CORE_HALF, pad.x + CORE_HALF])) continue;
    if (p.y > padY && p.y < lowest) lowest = p.y;
  }
  return lowest;
}

/**
 * Narrowest channel down into an excavation that still counts as a way in.
 *
 * The hull is 1.24 across, so this is not about fitting — it is the same argument as
 * `CORE_HALF`, which reserves ten units over a pad because a vehicle needs room to be
 * wrong and still correct. A hole you can only enter by being exactly right is not a
 * difficult approach, it is a locked door.
 *
 * Five rather than ten because this is measured against the *authored* dig span, and
 * terrain opens a real mouth wider than that — the excavation at x −33 spans 20 by the
 * numbers and about 23.5 on the ground. Five here is closer to seven in the air.
 */
const MIN_MOUTH = 5;

/**
 * Excavations whose opening has been built over.
 *
 * Measures instead of enumerating: subtract every colliding prop above the floor from
 * the width of the opening and ask what is left; if the widest surviving channel is
 * under `MIN_MOUTH`, the excavation is capped no matter what kind of thing capped it.
 * That generality is what caught Helion driving its cavern directly beneath its own
 * hand-authored crest deck — the mouth measured twenty-three units across with a
 * two-unit gap to fly through, on every seed, until this rule existed.
 *
 * A cave roof counts, and that is the deliberate part. Everywhere else in this module a
 * roof is exempt, because a pad under a ceiling is the level design rather than a
 * mistake — but the ceiling still has to leave you a way past it.
 *
 * Reported rather than resolved. What is standing over the hole is usually
 * load-bearing, and choosing between moving it, narrowing it and striking it from the
 * ledger is a level-design decision — not one this module should make silently.
 *
 * A floor-mounted dig's opening is an x-interval at any height above it — "up" is
 * unambiguous when the bore goes straight down. A wall-mounted dig's opening faces
 * *sideways*, at a specific height on the wall face (`terrain.wallMouthY(d)`), so the
 * two cases measure genuinely different things and are kept as separate branches rather
 * than forced through one formula with an axis swapped in by convention.
 */
function cappedMouths(
  props: Prop[],
  digs: Excavation[],
  owner: Map<Prop, number> | undefined,
  terrain: MouthTerrain | undefined,
): Violation[] {
  const out: Violation[] = [];

  for (const d of digs) {
    if (isFloorMounted(boreDirection(d).dir)) {
      out.push(...cappedFloorMouth(d, props, owner));
      continue;
    }
    // A wall mouth's real opening height only exists once real terrain does — see
    // `checkLayout`'s doc comment. Skipping rather than guessing is the safe direction:
    // it can only under-report, never wrongly flag a mission that's actually fine.
    if (!terrain) continue;
    out.push(...cappedWallMouth(d, props, owner, terrain));
  }

  return out;
}

function cappedFloorMouth(
  d: Excavation,
  props: Prop[],
  owner?: Map<Prop, number>,
): Violation[] {
  const west = d.x - d.halfWidth;
  const east = d.x + d.halfWidth;

  /**
   * Only worth asking once there is somewhere to land down there. A bore driven two
   * missions before its pad arrives is a hole nobody is being sent into.
   */
  const occupants = props.filter(
    (p): p is Extract<Prop, { kind: 'pad' }> =>
      p.kind === 'pad' &&
      p.x > west &&
      p.x < east &&
      // Down in the hole, not merely sharing its x. A pad resting on ground has no y
      // of its own and inside an excavation that ground *is* the floor; anything with
      // an authored height is only in the hole if that height is below the datum.
      (p.y === undefined || p.y < 0),
  );
  if (occupants.length === 0) return [];

  /**
   * Everything with a collider that sits over the opening, widened by the usual
   * margin so grazing an edge does not read as passing it — except the pads inside
   * the hole themselves, which are the destination. Counting a pad as its own
   * obstruction is how the first draft of this rule decided the Kessler shaft was
   * sealed by the very pad it exists to deliver to.
   */
  /**
   * How far above the opening a structure still counts as standing in the doorway.
   *
   * This rule used to have no height test at all: any collider sharing the bore's x
   * capped it, at any altitude, so a colony module a hundred and fifty units up sealed a
   * shaft it could not reach. The consequence was not academic — the reservation that
   * keeps growth out of a mouth had to run the full height of the canyon to stay a
   * superset of this check, three columns from the floor to the rim, which on a narrow
   * seed is most of the ground the outpost has.
   *
   * One bore-width above the lip is the honest reading of "at the doorway". Beyond that
   * you are flying in the canyon rather than entering the hole, and the descent is
   * already governed by the route check (`channelIntrusions`), which measures the real
   * approach rather than a vertical column.
   *
   * Measured against the floor datum, the same y=0 approximation for ground level this
   * module makes everywhere else — see `checkLayout`.
   */
  const headroom = d.halfWidth * 2;

  const blockerSpans: Array<{ prop: Prop; sx: [number, number] }> = [];
  for (const p of props) {
    if (!hasCollider(p) || occupants.some((pad) => pad === p)) continue;
    if (p.kind === 'colony') {
      for (const col of colonyCells(p, 0)) {
        if (col.sy[0] >= headroom) continue;
        if (overlaps(col.sx, [west, east])) blockerSpans.push({ prop: p, sx: col.sx });
      }
    } else {
      if (spanY(p)[0] >= headroom) continue;
      const sx = spanX(p, MARGIN);
      if (overlaps(sx, [west, east])) blockerSpans.push({ prop: p, sx });
    }
  }

  const widest = widestGap(blockerSpans.map((b) => b.sx), west, east);
  if (widest >= MIN_MOUTH || blockerSpans.length === 0) return [];

  const worst = blockerSpans.reduce((a, b) =>
    b.sx[1] - b.sx[0] > a.sx[1] - a.sx[0] ? b : a,
  ).prop;
  return [
    {
      mission: owner?.get(worst),
      rule: 'mouth',
      pad: `dig ${west.toFixed(0)}..${east.toFixed(0)}`,
      prop: label(worst),
      detail:
        `caps the excavation: widest way in is ${widest.toFixed(1)}, needs ${MIN_MOUTH}`,
    },
  ];
}

/**
 * The wall-mount analogue of `cappedFloorMouth`, axes swapped: the opening is a y-band
 * (`wallMouthY(d) ± d.halfWidth`) at a fixed x (`d.x`, the wall-face position the bore
 * was driven from — see `boreDirection`'s doc comment on why every wall-mounted prop in
 * this codebase agrees `dig.x` means that and not something else). A pad occupies the
 * shaft if it sits in that band, near that x; a blocker is anything whose *vertical*
 * extent crosses the band while its horizontal extent reaches the mouth's x.
 *
 * First real use of a wall mount in `checkLayout` — the margin/window choices here
 * (`d.halfWidth` on each axis) are the floor case's own margins with the axes swapped,
 * not yet tuned against a second real mission the way `MIN_MOUTH`'s comment can point to
 * one. Worth revisiting once more than Helion's cavern exercises this branch.
 */
function cappedWallMouth(
  d: Excavation,
  props: Prop[],
  owner: Map<Prop, number> | undefined,
  terrain: MouthTerrain,
): Violation[] {
  const mouthY = terrain.wallMouthY(d);
  // The physical opening — what a lander actually flies through — stays at the mouth's
  // own band regardless of how far the bore travels afterward; how deep the shaft goes
  // doesn't move its entrance.
  const low = mouthY - d.halfWidth;
  const high = mouthY + d.halfWidth;
  const xWindow: [number, number] = [d.x - d.halfWidth, d.x + d.halfWidth];

  /**
   * Unlike a floor mount — straight down, so "below datum at this x" always means
   * "inside this shaft" — a wall-mounted bore travels well clear of its own mouth by
   * the time it reaches its destination: Helion's cavern ends up tens of units sideways
   * and down from where it enters the wall, not hovering just past the opening. So "is
   * there actually a destination in here" has to be judged against the bore's real
   * endpoint (mouth plus `depth` along `direction`), not the mouth's own narrow band —
   * checked here, not against `TerrainDigs.ts`'s own endpoint helper, since this only
   * needs the two fields already on a resolved `Excavation` and pulling in a second
   * module for one formula would be the wrong kind of reuse.
   */
  const dir = d.direction ?? { x: 0, y: -1 };
  const endX = d.x + dir.x * d.depth;
  const endY = mouthY + dir.y * d.depth;
  const occupants = props.filter(
    (p): p is Extract<Prop, { kind: 'pad' }> =>
      p.kind === 'pad' && Math.hypot(p.x - endX, (p.y ?? 0) - endY) <= d.halfWidth + MARGIN,
  );
  if (occupants.length === 0) return [];

  const blockerSpans: Array<{ prop: Prop; sy: [number, number] }> = [];
  for (const p of props) {
    if (!hasCollider(p) || occupants.some((pad) => pad === p)) continue;
    if (p.kind === 'colony') {
      for (const col of colonyCells(p, 0)) {
        if (overlaps(col.sx, xWindow) && overlaps(col.sy, [low, high])) {
          blockerSpans.push({ prop: p, sy: col.sy });
        }
      }
    } else {
      const sx = spanX(p, MARGIN);
      const sy = spanY(p);
      if (overlaps(sx, xWindow) && overlaps(sy, [low, high])) blockerSpans.push({ prop: p, sy });
    }
  }

  const widest = widestGap(blockerSpans.map((b) => b.sy), low, high);
  if (widest >= MIN_MOUTH || blockerSpans.length === 0) return [];

  const worst = blockerSpans.reduce((a, b) =>
    b.sy[1] - b.sy[0] > a.sy[1] - a.sy[0] ? b : a,
  ).prop;
  return [
    {
      mission: owner?.get(worst),
      rule: 'mouth',
      pad: `wall dig @x=${d.x.toFixed(0)} y=${low.toFixed(0)}..${high.toFixed(0)}`,
      prop: label(worst),
      detail:
        `caps the excavation: widest way in is ${widest.toFixed(1)}, needs ${MIN_MOUTH}`,
    },
  ];
}

/** Widest surviving gap in `[lo, hi]` once every span in `spans` has been cut out. */
function widestGap(spans: Array<[number, number]>, lo: number, hi: number): number {
  let widest = 0;
  let cursor = lo;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (a > cursor) widest = Math.max(widest, a - cursor);
    cursor = Math.max(cursor, b);
  }
  return Math.max(widest, hi - cursor);
}

/**
 * Checks one accumulated world. `owner` maps a prop back to the mission that added
 * it, so a failure names the line to edit.
 *
 * `terrain`, when given, is what lets a wall-mounted dig's mouth be judged precisely
 * instead of skipped — see `cappedMouths`/`cappedWallMouth`. Callers without real
 * terrain (most of `Missions.test.ts`'s sweeps, which are deliberately pure) still get
 * every other rule at full strength; they just can't catch a wall mouth being capped,
 * which is fine as long as nothing they check authors one.
 */
export function checkLayout(
  props: Prop[],
  digs: Excavation[] = [],
  owner?: Map<Prop, number>,
  // Only needed to judge a wall-mounted dig's mouth precisely — see `cappedMouths`.
  // Every floor-mounted dig (everything in the campaign except Helion's cavern) is
  // checked exactly as before whether or not a caller has terrain to give it.
  terrain?: MouthTerrain,
  // The real flight routes, when the caller has them. Given these, a colony is judged
  // against the route a pad is actually reached by rather than against a vertical column
  // over its core — see `channelIntrusions`.
  channels?: Channel[],
): Violation[] {
  const out: Violation[] = [];
  const pads = props.filter((p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad');

  out.push(...cappedMouths(props, digs, owner, terrain));
  if (channels) out.push(...channelIntrusions(props, channels, owner));

  for (const pad of pads) {
    const padY = pad.y ?? 0;
    const footprint: [number, number] = [pad.x - pad.width / 2, pad.x + pad.width / 2];
    const core: [number, number] = [pad.x - CORE_HALF, pad.x + CORE_HALF];
    const ceiling = ceilingOver(pad, props);

    for (const p of props) {
      if (p === pad) continue;
      // A pad resting on ground inside an excavation has no y of its own; the cave
      // roof above it is the level design and is exempt from both rules.
      if (p.kind === 'caveRoof') continue;
      // A landmark cannot block anything — see `hasCollider`.
      if (!hasCollider(p)) continue;

      /**
       * A colony is judged cell by cell rather than by its whole-footprint box. The box
       * is honest nowhere a colony matters: cells growing low *under* an elevated deck
       * are legal, but one tall filament elsewhere raises the box until it reads as
       * planted through a deck nothing actually touches. See `colonyCells`.
       */
      const extents = p.kind === 'colony' ? colonyCells(p) : [{ sx: spanX(p), sy: spanY(p) }];

      // Rule 1 — nothing standing on the landing surface. This is about a structure
      // passing *through* the deck plane, which is what "planted on the pad" means;
      // something merely hanging above it is a corridor question, judged by distance.
      let onDeck = false;
      for (const { sx, sy } of extents) {
        if (overlaps(sx, footprint) && sy[1] > padY - DECK_UNDER && sy[0] < padY + DECK_CLEAR) {
          out.push({
            mission: owner?.get(p),
            rule: 'deck',
            pad: pad.id,
            prop: label(p),
            detail:
              `occupies the pad footprint ${footprint[0]}..${footprint[1]} ` +
              `at y ${sy[0] === -Infinity ? '-inf' : sy[0].toFixed(1)}..${sy[1].toFixed(1)}`,
          });
          onDeck = true;
          break;
        }
      }
      if (onDeck) continue;

      // Rule 2 — the corridor over the pad's core stays clear up to any cave roof.
      //
      // Another pad overhead is the shaft's own level design — kessler-shaft, -ledge
      // and -deep are stacked down one hole on purpose, and each necessarily sits
      // under the one above it.
      if (p.kind === 'pad') continue;
      // A colony is judged against the pad's real route instead, when the caller has one
      // — a channel bends around rock as it climbs (`ColonyChannels.ts`), so a vertical
      // column over the core condemns airspace the approach never actually uses, and
      // would report the colony for standing exactly where it is supposed to: massed
      // against the outside of a bend. Without channels this rule still applies to
      // colonies unchanged, which is what keeps the pure, terrain-free tests honest.
      if (p.kind === 'colony' && channels) continue;
      const top = Math.min(padY + CORRIDOR_HEIGHT, ceiling);
      for (const { sx, sy } of extents) {
        if (overlaps(sx, core) && sy[1] > padY && sy[0] < top) {
          const intrusion = Math.min(sx[1], core[1]) - Math.max(sx[0], core[0]);
          out.push({
            mission: owner?.get(p),
            rule: 'corridor',
            pad: pad.id,
            prop: label(p),
            detail:
              `blocks ${intrusion.toFixed(1)} of the ${CORE_HALF * 2}-wide approach ` +
              `corridor at y=${sy[0] === -Infinity ? '-inf' : sy[0].toFixed(1)}`,
          });
          break;
        }
      }
    }
  }
  return out;
}

// --------------------------------------------------------------------- growth safety

/**
 * The independent net under the flight-channel guarantee: no colony cell may sit within
 * `CHANNEL_HALF` of any route.
 *
 * Deliberately measured geometrically, against the polyline itself, rather than by
 * re-reading the same rasterised cell mask growth was handed. A check that consults the
 * generator's own bookkeeping agrees with it by construction and catches nothing — which
 * is exactly how the previous model's corridor check kept passing while a colony grew
 * onto a pad footprint. Distance to a segment is a different computation from "which
 * cells did I mark", so a rasterisation bug has somewhere to show up.
 */
function channelIntrusions(props: Prop[], channels: Channel[], owner?: Map<Prop, number>): Violation[] {
  const out: Violation[] = [];
  for (const p of props) {
    if (p.kind !== 'colony') continue;
    const half = p.cellSize / 2;
    for (const channel of channels) {
      let worst = 0;
      for (const cell of p.cells) {
        // The play plane only — a channel is airspace at z=0, and the layers in front of
        // and behind it carry no colliders and stand in nothing's way. Same rule as
        // `colonyCells`; see its doc comment.
        if (cell.z !== 0) continue;
        for (let i = 0; i + 1 < channel.points.length; i++) {
          const gap = pointToSegment(cell.x, cell.y, channel.points[i], channel.points[i + 1]) - half;
          if (gap < CHANNEL_HALF) worst = Math.max(worst, CHANNEL_HALF - gap);
        }
      }
      if (worst > 0) {
        out.push({
          mission: owner?.get(p),
          rule: 'channel',
          pad: channel.padId,
          prop: label(p),
          detail: `intrudes ${worst.toFixed(1)} into the ${CHANNEL_HALF}-unit clearance of its flight route`,
        });
      }
    }
  }
  return out;
}

/** Perpendicular distance from a point to a line segment, clamped to the segment's own
 *  ends — a route is a chain of finite segments, and treating one as an infinite line
 *  would report clearance failures against airspace the route never passes through. */
function pointToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

/**
 * A colony's cells as individual extents, for the deck and corridor rules.
 *
 * The single `footprintX`/`spanY` box lies as soon as a colony is big: growth under an
 * elevated deck is legal (the channel network saw to that), but one tall filament
 * elsewhere raises the whole box until it reads as standing through a deck no actual
 * cell goes near. Per-cell extents say what is really there — and unlike the per-*column*
 * version this replaces, they do not fill in the gaps a branched structure leaves inside
 * its own silhouette.
 */
function colonyCells(p: Extract<Prop, { kind: 'colony' }>, m: number = 0): Array<{
  sx: [number, number];
  sy: [number, number];
}> {
  const half = p.cellSize / 2;
  /**
   * **The play plane only.** A colony is three layers deep (`COLONY_LAYERS`); the ones in
   * front of and behind z=0 carry no colliders and stand in nobody's way, so every rule in
   * this module — deck, corridor, mouth, channel — has to be blind to them. Judging them
   * would report a pad blocked by a module the lander flies straight past.
   */
  return p.cells
    .filter((cell) => cell.z === 0)
    .map((cell) => ({
      sx: [cell.x - half - m, cell.x + half + m] as [number, number],
      sy: [cell.y - half, cell.y + half] as [number, number],
    }));
}

/**
 * Once resolved every prop the way `tower`/`mast`/`gantry` needed — moving or trimming
 * a hand-authored span that drifted into a pad's rules over a campaign where nothing
 * was ever removed. Those prop kinds are gone (see the `Prop` doc comment in
 * `Colony.ts`): `colony` is generated safe-by-construction against every pad already
 * standing (`reservedCellsFor` above), and `pad`/`caveRoof`/`radar` were never
 * relocated even when this function had somewhere to send them — an anchor, a roof
 * tied to its excavation, and a collider-less landmark were never candidates for it.
 *
 * So there is nothing left to resolve. `checkLayout` remains the real check —
 * verifying the ledger is legal, not fixing it — and this stays a real exported pass
 * rather than being deleted and inlined at its one call site in `Missions.ts`, so a
 * future authored prop that *does* need relocating has an obvious place to add that
 * logic back, instead of one more special case bolted onto `worldAt`.
 */
export function resolveLayout(props: Prop[]): Prop[] {
  return [...props];
}
