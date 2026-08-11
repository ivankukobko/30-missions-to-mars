import type { Prop } from '../world/Colony.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import type { Offset } from '../physics/Kinematics.ts';

/**
 * Layout rules for the colony planner.
 *
 * The campaign ledger is thirty missions of hand-typed coordinates that accumulate
 * and are never removed, so a span authored in mission 12 can end up hanging over a
 * pad that mission 5 placed — and nothing in the source connects the two. This module
 * is that connection: the constraints a pad imposes on everything built afterwards,
 * checked mechanically rather than by eye.
 *
 * Two rules, and they say different things:
 *
 *   1. Nothing stands *on* a landing surface. A pad's footprint is reserved from just
 *      under the deck to well above it.
 *   2. Something has to be able to *reach* it. A corridor over the pad's core stays
 *      clear all the way up, so a descent has somewhere to come down.
 *
 * Rule 2 deliberately stops at a cave roof. A pad under a deliberate ceiling is a
 * cave — the roof is the level design, not a violation — so the corridor requirement
 * applies only to the open air beneath it.
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
  rule: 'deck' | 'corridor' | 'mouth';
  pad: string;
  prop: string;
  detail: string;
}

/**
 * Entry lanes at an excavation mouth.
 *
 * A pad at the bottom of a dig is roofed on purpose, so its vertical corridor stops at
 * the ceiling and the way in is *around* the lip instead. That entrance is invisible to
 * the corridor rule — it is a gap in the terrain, not airspace over a deck — so without
 * it a resolver is free to park a mast in the one slot that matters. It did exactly
 * that: a mast displaced from the outpost pad landed at x=-24, one unit off the pit
 * wall at -23, and sealed the only route into the Helion cavern.
 *
 * Only the lanes are reserved, not the whole mouth. Reserving the mouth outright ate so
 * much floor that the resolver started throwing masts sixty units clear of the canyon
 * to find somewhere legal — and a mast standing in the middle of a wide pit is fine, it
 * is a mast at the doorway that is not.
 */
const LANE_WIDTH = 5;
const LANE_OUTSIDE = 2;

/** Reserved airspace a pad imposes on everything built after it. */
interface PadZone {
  id: string;
  y: number;
  /** Footprint no structure may stand through. */
  footprint: [number, number];
  /** Approach corridor that must stay clear from the deck up to `ceiling`. */
  core: [number, number];
  ceiling: number;
}

/**
 * Horizontal extent of a prop, widened by `m`. Clearance against a *pad* uses the full
 * margin on the prop alone; clearance between two props must not apply it twice, or
 * two structures need 2.4 units of air between them and the resolver rejects slots
 * that are perfectly legal.
 */
/**
 * How far a prop's colliders stray from its authored position over a whole cycle.
 *
 * Every extent below is widened by this, so a moving structure is judged by the airspace
 * it *sweeps* rather than by where it happens to rest. Without it the rules go blind at
 * exactly the wrong moment: a travelling gantry authored clear of a pad, whose stroke
 * carries it straight through that pad's approach corridor, passes every check — and the
 * mission becomes unflyable in a way no static reading can detect.
 */
function reach(p: Prop): Offset {
  const motion = 'motion' in p ? p.motion : undefined;
  if (!motion) return { x: 0, y: 0 };
  return { x: Math.abs(motion.dx ?? 0), y: Math.abs(motion.dy ?? 0) };
}

function spanX(p: Prop, m: number = MARGIN): [number, number] {
  const swept = reach(p).x;
  switch (p.kind) {
    case 'tower':
    case 'platform':
    case 'pad':
      return [p.x - p.width / 2 - m - swept, p.x + p.width / 2 + m + swept];
    case 'gantry':
      return [Math.min(p.x1, p.x2) - m - swept, Math.max(p.x1, p.x2) + m + swept];
    case 'mast':
      return [p.x - 0.7 - m, p.x + 0.7 + m];
    case 'caveRoof':
      return [p.x - p.halfWidth - m, p.x + p.halfWidth + m];
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
 * stand wherever they set down, including inside ground a later tower grows through. So
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
 * Towers and masts stand on the canyon floor, whose exact height is a function of the
 * seed and not known here. `FLOOR_BASE` is a floor-with-relief estimate: low enough to
 * be conservative for anything at grade, but *not* unbounded — treating them as
 * infinitely deep would have them reaching down into excavations they stand beside,
 * and wrongly condemn every pad at the bottom of a shaft.
 */
const FLOOR_BASE = -6;

function spanY(p: Prop): [number, number] {
  const swept = reach(p).y;
  switch (p.kind) {
    case 'tower':
    case 'mast':
      return [FLOOR_BASE, p.topY];
    case 'gantry':
      return [
        p.y - (p.thickness ?? 2.4) / 2 - swept,
        p.y + (p.thickness ?? 2.4) / 2 + swept,
      ];
    case 'platform':
      return [p.y - 1.8 - swept, p.y + swept];
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
  if (p.kind === 'gantry') return `gantry ${p.corp} ${p.x1}..${p.x2} @${p.y}`;
  if (p.kind === 'pad') return `pad ${p.id}`;
  return `${p.kind} ${p.corp} x=${p.x}`;
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/**
 * The platform a pad rests on, which is allowed to sit under it — that is what a deck
 * is. Matched on position rather than by an explicit link, because `deck()` builds the
 * pair from one call and nothing else in the ledger shares a pad's exact x.
 */
function isOwnDeck(pad: Extract<Prop, { kind: 'pad' }>, p: Prop): boolean {
  if (p.kind !== 'platform') return false;
  return Math.abs(p.x - pad.x) < 0.001 && Math.abs(p.y - ((pad.y ?? 0) - 1)) < 2.5;
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
 * Checks one accumulated world. `owner` maps a prop back to the mission that added
 * it, so a failure names the line to edit.
 */
export function checkLayout(
  props: Prop[],
  digs: Excavation[] = [],
  owner?: Map<Prop, number>,
): Violation[] {
  const out: Violation[] = [];
  const pads = props.filter((p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad');

  // Excavation mouths are checked independently of any pad: the dig may be driven
  // several missions before the pad at the bottom of it exists.
  for (const [lo, hi] of mouths(digs)) {
    for (const p of props) {
      if (p.kind !== 'tower' && p.kind !== 'mast') continue;
      if (!overlaps(spanX(p), [lo, hi])) continue;
      out.push({
        mission: owner?.get(p),
        rule: 'mouth',
        pad: `dig ${lo.toFixed(0)}..${hi.toFixed(0)}`,
        prop: label(p),
        detail: `stands in the excavation mouth, blocking the way in`,
      });
    }
  }

  for (const pad of pads) {
    const padY = pad.y ?? 0;
    const footprint: [number, number] = [pad.x - pad.width / 2, pad.x + pad.width / 2];
    const core: [number, number] = [pad.x - CORE_HALF, pad.x + CORE_HALF];
    const ceiling = ceilingOver(pad, props);

    for (const p of props) {
      if (p === pad || isOwnDeck(pad, p)) continue;
      // A pad resting on ground inside an excavation has no y of its own; the cave
      // roof above it is the level design and is exempt from both rules.
      if (p.kind === 'caveRoof') continue;
      // A landmark cannot block anything — see `hasCollider`.
      if (!hasCollider(p)) continue;

      const sx = spanX(p);
      const sy = spanY(p);

      // Rule 1 — nothing standing on the landing surface. This is about a structure
      // passing *through* the deck plane, which is what "planted on the pad" means;
      // something merely hanging above it is a corridor question, judged by distance.
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
        continue;
      }

      // Rule 2 — the corridor over the pad's core stays clear up to any cave roof.
      //
      // Only built structure counts. Another deck overhead is the shaft's own level
      // design — kessler-shaft, -ledge and -deep are stacked down one hole on purpose,
      // and each necessarily sits under the one above it.
      if (p.kind === 'pad' || p.kind === 'platform') continue;
      const top = Math.min(padY + CORRIDOR_HEIGHT, ceiling);
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
      }
    }
  }
  return out;
}

// --------------------------------------------------------------------- resolver

/** Zones every pad in the world reserves. Pads themselves never move. */
function padZones(props: Prop[]): PadZone[] {
  return props
    .filter((p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad')
    .map((pad) => ({
      id: pad.id,
      y: pad.y ?? 0,
      footprint: [pad.x - pad.width / 2, pad.x + pad.width / 2] as [number, number],
      core: [pad.x - CORE_HALF, pad.x + CORE_HALF] as [number, number],
      ceiling: ceilingOver(pad, props),
    }));
}

/** The two lanes at each dig's lips, which must stay clear of floor structures. */
function mouths(digs: Excavation[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const d of digs) {
    const west = d.x - d.halfWidth;
    const east = d.x + d.halfWidth;
    out.push([west - LANE_OUTSIDE, west + LANE_WIDTH]);
    out.push([east - LANE_WIDTH, east + LANE_OUTSIDE]);
  }
  return out;
}

/** Does this prop intrude on any pad's footprint, approach corridor, or a dig mouth? */
function intrudes(p: Prop, zones: PadZone[], holes: Array<[number, number]> = []): boolean {
  // The radar is appended after the resolver runs, so in practice it never arrives here.
  // Skipped anyway, so the resolver and the check can never disagree about it.
  if (!hasCollider(p)) return false;

  const sx = spanX(p);
  const sy = spanY(p);

  // Only things standing on the floor can block a mouth; a gantry passes overhead.
  if (p.kind === 'tower' || p.kind === 'mast') {
    for (const h of holes) if (overlaps(sx, h)) return true;
  }

  for (const z of zones) {
    if (overlaps(sx, z.footprint) && sy[1] > z.y - DECK_UNDER && sy[0] < z.y + DECK_CLEAR) {
      return true;
    }
    if (p.kind === 'pad' || p.kind === 'platform') continue;
    const top = Math.min(z.y + CORRIDOR_HEIGHT, z.ceiling);
    if (overlaps(sx, z.core) && sy[1] > z.y && sy[0] < top) return true;
  }
  return false;
}

/**
 * Resolves a hand-authored ledger into a legal one.
 *
 * The thirty missions are written as intent — *Helion runs a mast up near the centre
 * line* — with a coordinate attached. Over a campaign where nothing is ever removed,
 * those coordinates drift into conflict with pads placed twenty missions earlier, and
 * the author has no way to see it. So the authored x is treated as a preference, not a
 * commitment: anything that clears the pad rules is left exactly where it was written,
 * and only the pieces that would stand on a landing surface get moved.
 *
 * Displacement searches outward from the authored position and takes the first legal
 * slot, so a moved prop lands as close to its intended spot as the rules allow, and
 * the search is deterministic — the same ledger always yields the same colony.
 */
export function resolveLayout(props: Prop[], digs: Excavation[] = []): Prop[] {
  const zones = padZones(props);
  const holes = mouths(digs);
  const out: Prop[] = [];

  /**
   * Floor-level footprints already committed, so relocations do not stack up. Stored
   * unmargined — `relocate` adds the gap once, on the candidate.
   */
  const floorTaken: Array<[number, number]> = [];
  for (const p of props) {
    // Towers always hold their ground because the resolver never moves them; a mast
    // only holds its authored spot if it is staying there. Leaving an intruding tower
    // out of this list once let a relocated mast be placed straight through one.
    if (p.kind === 'tower') floorTaken.push(spanX(p, 0));
    else if (p.kind === 'mast' && !intrudes(p, zones, holes)) floorTaken.push(spanX(p, 0));
  }

  for (const p of props) {
    if (!intrudes(p, zones, holes)) {
      out.push(p);
      continue;
    }

    // A fixed span is pulled back to the pad's edge. A *travelling* one is not: its
    // span is the stroke of a machine on a rail, so trimming it shortens the run and
    // sliding it moves the rail — either way the resolver would be redesigning working
    // hardware to fit a rule. Moving structures fall through to be reported instead.
    if (p.kind === 'gantry' && !p.motion) {
      out.push(trimGantry(p, zones));
      continue;
    }

    if (p.kind === 'mast') {
      const moved = relocate(p, zones, holes, floorTaken);
      out.push(moved);
      floorTaken.push(spanX(moved, 0));
      continue;
    }

    // Towers are anchors, not scenery: a crest platform braces to the nearest tower
    // face, so sliding one silently tears the deck off its support. Same for platforms
    // and cave roofs, which belong to a deck and an excavation respectively. These are
    // reported rather than moved — a warning the author can act on beats a colony that
    // quietly rearranges its own load-bearing structure.
    out.push(p);
  }
  return out;
}

/**
 * A span across a pad is pulled back to the pad's edge rather than moved. A gantry
 * connects two points and means something structurally, so shortening it — a walkway
 * that stops short of the landing zone — preserves the read where sliding it sideways
 * would leave it bridging nothing.
 *
 * Trimming repeats until it stops changing: retreating from one pad's corridor can
 * push an endpoint into another's, and a single pass would leave that unnoticed.
 */
const MIN_SPAN = 4;

function trimGantry(g: Extract<Prop, { kind: 'gantry' }>, zones: PadZone[]): Prop {
  let lo = Math.min(g.x1, g.x2);
  let hi = Math.max(g.x1, g.x2);
  const sy = spanY(g);

  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const z of zones) {
      const top = Math.min(z.y + CORRIDOR_HEIGHT, z.ceiling);
      if (!(sy[1] > z.y && sy[0] < top)) continue;
      if (!overlaps([lo - MARGIN, hi + MARGIN], z.core)) continue;

      // Retreat to whichever side of the corridor keeps more of the span.
      const west = z.core[0] - MARGIN - lo;
      const east = hi - (z.core[1] + MARGIN);
      if (west >= east) hi = Math.min(hi, z.core[0] - MARGIN);
      else lo = Math.max(lo, z.core[1] + MARGIN);
      changed = true;
    }
    if (!changed) break;
  }

  if (hi - lo >= MIN_SPAN) return { ...g, x1: lo, x2: hi };

  // Nothing worth keeping survived the trim, so slide the original span instead,
  // searching outward for somewhere it clears every corridor at its full length.
  const length = Math.abs(g.x2 - g.x1);
  const start = Math.min(g.x1, g.x2);
  for (let d = 0; d <= 120; d += 0.5) {
    for (const dir of [-1, 1]) {
      const l = start + dir * d;
      const candidate: Prop = { ...g, x1: l, x2: l + length };
      if (!intrudes(candidate, zones)) return candidate;
    }
  }
  return { ...g, x1: lo, x2: lo + MIN_SPAN };
}

/** Nearest legal x to the authored one, searched outward, corp side preferred. */
function relocate(
  p: Extract<Prop, { kind: 'mast' }>,
  zones: PadZone[],
  holes: Array<[number, number]>,
  taken: Array<[number, number]>,
): Prop {
  const STEP = 0.5;
  // Bounded on purpose. Past this the prop is no longer where the mission meant it to
  // be — a mast the brief tells you to mind, parked beyond the canyon wall, is not an
  // obstacle any more. Better to leave it authored and let the check complain.
  const REACH = 26;
  // Search the corp's own side of the canyon first: Helion holds the west approach and
  // Kessler the east, and a mast that hops the centre line breaks that read.
  const side = p.corp === 'helion' ? -1 : p.corp === 'kessler' ? 1 : 0;

  const order: number[] = [];
  for (let d = STEP; d <= REACH; d += STEP) {
    if (side >= 0) order.push(d);
    if (side <= 0) order.push(-d);
    if (side > 0) order.push(-d);
    else if (side < 0) order.push(d);
  }

  // Gap required between two structures. Applied once, to the candidate — `taken`
  // holds raw extents.
  const GAP = 1.5;

  const free = (x: number) => {
    const candidate = { ...p, x };
    if (intrudes(candidate, zones, holes)) return false;
    return !taken.some((t) => overlaps(spanX(candidate, GAP), t));
  };

  for (const delta of order) if (free(p.x + delta)) return { ...p, x: p.x + delta };

  /**
   * Nothing on the open floor. By the late campaign that is the normal case rather
   * than an edge case — pads, dig lanes, towers and platforms leave a single free slot
   * between them — so the fallback is the canyon wall on the corp's own side, which is
   * where the towers were moved for the same reason. A mast up the wall stops being an
   * obstacle in the corridor, which is a real loss, but it beats one standing on a
   * landing pad.
   */
  const wall =
    side < 0 ? WALL_WEST
    : side > 0 ? WALL_EAST
    : Math.abs(p.x - WALL_WEST) < Math.abs(p.x - WALL_EAST) ? WALL_WEST
    : WALL_EAST;
  for (let d = 0; d <= 60; d += STEP) {
    const x = wall + (wall < 0 ? -d : d);
    if (free(x)) return { ...p, x };
  }
  return p;
}

/** Outer edge of the built floor on each side; beyond it the canyon walls rise. */
const WALL_WEST = -68;
const WALL_EAST = 86;
