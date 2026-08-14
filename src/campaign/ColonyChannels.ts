import type { Prop } from '../world/Colony.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import type { Lattice } from '../world/ColonyLattice.ts';
import type { SubstrateField } from '../world/ColonySubstrate.ts';
import { boreDirection, isFloorMounted } from '../world/Shaft.ts';

/**
 * The flight-route network, and the one hard guarantee the colony is built around:
 * **every pad ever built keeps a permanent channel to the rim, and no colony cell may
 * enter it.**
 *
 * Three things make this stronger than the corridor rule it replaces, which reserved a
 * vertical column over the *currently targeted* pad's core:
 *
 *   - Every live pad keeps one, forever, so the canyon accumulates a route network all
 *     later growth has to respect rather than one mission's approach at a time.
 *   - A route is a polyline, not a column, so it can jog around rock as it climbs.
 *   - A route follows the way a pad is actually reached — down a bore, out through a
 *     wall mouth — instead of assuming every approach comes straight down. The old rule
 *     got Helion's cavern wrong for exactly that reason: straight up from that deck is
 *     solid rock.
 *
 * Difficulty stops coming from airspace closing and starts coming from the channel being
 * narrow and *walled*: the colony is drawn toward its own pads (see `ColonyOrganism`'s
 * attractors), so it masses hard against both sides of the descent it can never enter.
 */

/**
 * Colony-free air either side of the route, perpendicular to it. The hull is 1.24 across,
 * so this is not about fitting — it is about having room to be wrong and still correct,
 * on a vehicle that answers the stick slowly under load, along the *whole* descent rather
 * than only above the deck. Still wider than `Layout.ts`'s own `CORE_HALF` of 5, which is
 * the clearance the game shipped with over a pad.
 *
 * **Sized to fall just inside half a cell, and that is the whole point.** A cell is
 * reserved when its near face comes within this distance of the route, so at 6 or more a
 * vertical route reserves its own column *and both neighbours* — 36 units of canyon for a
 * corridor that needs 12. Measured on seed 1 at mission 30 that came to 206 of 560 cells
 * reserved, more of the lattice than the rock itself occupied, and the colonies froze
 * against it twelve missions from the end of the campaign with nowhere legal left to
 * build. At 5.5 a straight run reserves exactly the column it flies down and spills into
 * a second only where it runs diagonally.
 *
 * So the corridor a player actually gets is one full lattice cell wide — 12 units — plus
 * whatever the neighbouring cells' own undersized geometry adds back (a module fills
 * 0.54–0.78 of its cell, so typically another 1.3–2.8 either side). The colliders are the
 * full cells, so 12 is the honest floor.
 */
export const CHANNEL_HALF = 5.5;

/** Keep-out above and below a pad deck itself, matching `Layout.ts`'s own deck rule so a
 *  cell is reserved by precisely the rule that would otherwise flag it afterwards. */
const DECK_CLEAR = 3;
const DECK_UNDER = 5;

/**
 * How far either side of a ground-resting pad the terrain itself moves.
 *
 * `CanyonGenerator.build` levels a bench under every pad with no authored `y`
 * (`{ halfWidth: 9, shoulder: 10 }`), and levelling *raises* ground as readily as it
 * lowers it. That is the one remaining way a colony cell can stop being a colony cell:
 * not demolished by a route, but buried by a bench that appeared under it when a later
 * mission added the pad. Observed once across five seeds × thirty missions — Ixion losing
 * twelve of forty-four cells at mission 15 on seed 7 — which is exactly often enough to
 * be worth closing rather than explaining.
 *
 * Reserved along with the deck, so no colony ever stands where the ground is going to
 * move under it.
 */
const BENCH_HALF = 19;

/**
 * Margin outside a bore's own opening that must also stay clear — the same "a structure
 * at the doorway is a structure in the way" rule the pre-growth layout checks applied to
 * a dig, and the same value.
 *
 * A mouth needs clearance across *its own width*, which is not the same as the width of
 * the route that descends through it: Kessler's shaft opens 24 units across while its
 * route reserves the one 12-unit column it flies down. Once the route was narrowed to
 * that column, colony grew over the rest of the opening and `checkLayout` correctly
 * reported the mouth as capped — 1.8 units of way in against the 5 it requires.
 */
const MOUTH_LANE = 2;

/** How far a route may drift sideways per row it climbs. One column per row is 45°,
 *  which is plenty of room to dodge a wall and still be a descent rather than a
 *  slalom the player is asked to thread blind. */
const DRIFT_PER_ROW = 1;

/** How far either side the ascent looks when judging which column is most open. Beyond
 *  this the answer stops changing the choice and only costs samples. */
const OPENNESS_REACH = 4;

export interface Channel {
  padId: string;
  /** World-space, deck first, rim last. */
  points: Array<{ x: number; y: number }>;
}

export interface ChannelNetwork {
  channels: Channel[];
  /** The column every route converges on as it climbs — see `trunkColumn`. Exposed so
   *  spore placement can keep a colony off the canyon's own highway. */
  trunkCol: number;
  /** True for a cell inside any route's clearance volume, or in a pad's own deck
   *  keep-out. This is what `ColonyOrganism` is handed as `forbidden`. */
  blocked(col: number, row: number): boolean;
}

/** What a route needs from `CanyonGenerator`, kept narrow like every other terrain
 *  boundary in the campaign layer. */
export interface ChannelTerrain {
  heightAt(x: number, z: number, includeDigs?: boolean): number;
  wallMouthY(dig: Excavation): number;
  /** The canyon's own floor edges, whose midpoint is the trunk — see `trunkColumn`. */
  floorEdgeAt(z: number, side: 1 | -1): number;
}

type Pad = Extract<Prop, { kind: 'pad' }>;

/**
 * A pad's deck height, **snapped to the lattice**.
 *
 * The reservation this feeds is cell-granular, so deriving it from terrain at full
 * precision is false precision with a real cost: a pad resting on ground reads its height
 * off whatever terrain exists *this* mission, and terrain keeps moving as the campaign
 * digs shafts and levels benches. A route that shifts by a fraction of a cell between two
 * missions rasterises to a different cell set, and a colony standing in the difference is
 * demolished by a route that did not meaningfully move. Measured: two such cases across
 * five seeds × thirty missions, both a colony losing cells to a route it had lived beside
 * for fourteen missions.
 *
 * Snapping makes the network piecewise-constant in terrain — it can only change when a
 * deck genuinely crosses a cell boundary, rather than continuously.
 */
function deckOf(pad: Pad, lattice: Lattice, terrain: ChannelTerrain): number {
  // Natural floor, digs excluded, for a pad that rests on the ground. Including them ties
  // the whole route network to how much of the canyon has been excavated so far: digging
  // Kessler's shaft at mission 15 moved the deck height read for pads near it, moved
  // their routes with it, and took cells off colonies that had stood beside those routes
  // for fourteen missions. Every pad that genuinely sits *inside* a bore carries an
  // authored `y` or an `attachToDig` resolution instead, so none of them is reading this
  // branch — a pad with no `y` is by definition one standing on the canyon floor.
  const raw = pad.y ?? terrain.heightAt(pad.x, 0, false);
  return lattice.worldY(lattice.rowAt(raw));
}

/** Where a bore opens. A floor pit opens at the natural floor above it; a wall bore
 *  opens partway up the rock face, which is a height only the terrain can answer. */
function mouthOf(dig: Excavation, terrain: ChannelTerrain): { x: number; y: number } {
  const { dir } = boreDirection(dig);
  return {
    x: dig.x,
    y: isFloorMounted(dir) ? terrain.heightAt(dig.x, 0, false) : terrain.wallMouthY(dig),
  };
}

/**
 * The dig a pad sits inside, if any — measured along the bore rather than by x alone,
 * because a wall bore's far end is displaced sideways from its own mouth and a pad
 * partway down it is nowhere near `dig.x`.
 */
function containingDig(pad: Pad, deckY: number, digs: Excavation[], terrain: ChannelTerrain): Excavation | null {
  let best: { dig: Excavation; along: number } | null = null;
  for (const dig of digs) {
    const { dir, perp } = boreDirection(dig);
    const mouth = mouthOf(dig, terrain);
    const dx = pad.x - mouth.x;
    const dy = deckY - mouth.y;
    const along = dx * dir.x + dy * dir.y;
    const across = Math.abs(dx * perp.x + dy * perp.y);
    if (along < 2 || along > dig.depth + dig.halfWidth) continue;
    if (across > dig.halfWidth + pad.width / 2) continue;
    if (!best || along > best.along) best = { dig, along };
  }
  return best?.dig ?? null;
}

/** How much clear air a column has either side of it at one row — the ascent's own
 *  measure of "which way is more open", read straight off the substrate rather than
 *  re-approximating where the wall is. */
function openness(substrate: SubstrateField, col: number, row: number): number {
  if (substrate.isSolid(col, row)) return -1;
  let reach = 0;
  for (let d = 1; d <= OPENNESS_REACH; d++) {
    if (substrate.isSolid(col - d, row) || substrate.isSolid(col + d, row)) break;
    reach = d;
  }
  return reach;
}

/**
 * One pad's route: out of whatever it sits inside, then up to the rim, drifting at most
 * `DRIFT_PER_ROW` columns per row toward whichever column is most open. Deterministic —
 * a pure function of the seed's terrain — and the same route every mission for as long
 * as the pad stands, which is what makes it a *permanent* channel rather than one
 * mission's approach.
 */
/**
 * The canyon's most open column across the upper half of the lattice — where a shared
 * flight trunk would go, and a fair proxy for "where the traffic is".
 *
/**
 * The canyon's own middle — midway between its two floor edges, which wander by seed, so
 * this is the real centreline rather than world x=0 or the middle of the lattice array.
 *
 * Routes *should* lean toward it as they climb rather than each ascending in its own
 * column — that is what stops the network slicing the upper canyon into as many narrow
 * vertical strips as there are pads, which is why a colony currently comes out four times
 * taller than wide (width-to-height 0.27; 0.31–0.50 with convergence, and median colony
 * size 26 → 37).
 *
 * It is not wired up, and the reason is measured rather than assumed: at today's capacity
 * the two things cannot both be had. Converging from the floor strangles whoever lives at
 * the canyon's middle — Ixion, by construction — for 77 of 486 corp-missions under ten
 * cells against 0 without it. Converging only in the upper canyon is *worse* (127), because
 * colonies climb to rows 13–14 and that is precisely the ground it takes. Rooting spores
 * by how much free space surrounds them (`ColonyPlan`) recovered a third of it and no more.
 *
 * The missing ingredient is capacity, not cleverness. Depth — two or three z-layers —
 * multiplies buildable volume without touching the canyon's cross-section, which is exactly
 * what convergence spends. See docs/plans/mycelial_colony_growth.md; these two land
 * together.
 */
function trunkColumn(lattice: Lattice, terrain: ChannelTerrain): number {
  return lattice.colAt((terrain.floorEdgeAt(0, -1) + terrain.floorEdgeAt(0, 1)) / 2);
}

function routeFor(
  pad: Pad,
  digs: Excavation[],
  lattice: Lattice,
  substrate: SubstrateField,
  terrain: ChannelTerrain,
): Channel {
  const deckY = deckOf(pad, lattice, terrain);
  const points: Array<{ x: number; y: number }> = [{ x: pad.x, y: deckY + DECK_CLEAR }];

  const dig = containingDig(pad, deckY, digs, terrain);
  if (dig) {
    const { dir } = boreDirection(dig);
    const mouth = mouthOf(dig, terrain);
    // Straight from the deck to the mouth. The bore's own wander is clamped inside
    // `dig.halfWidth` (see `Shaft.boreAt`), so a straight segment stays inside the hole
    // the terrain actually opened — and the clearance volume below is wider than the
    // wander regardless.
    points.push(mouth);
    // Step clear of the rock face before starting to climb, or a wall mouth's channel
    // would turn upward while still inside the wall it just came out of.
    if (!isFloorMounted(dir)) {
      points.push({ x: mouth.x + dir.x * -dig.halfWidth * 1.5, y: mouth.y + dir.y * -dig.halfWidth * 1.5 });
    }
  }

  const start = points[points.length - 1];
  let col = lattice.colAt(start.x);
  for (let row = Math.max(0, lattice.rowAt(start.y) + 1); row < lattice.rows; row++) {
    /**
     * Climb straight unless this column is genuinely too tight, and only then take the
     * most open neighbour.
     *
     * The rule that was here — always move to whichever of the three candidates is *most*
     * open — is subtly and expensively wrong, and the measurement is unambiguous. A route
     * leaving a wall mouth is next to rock, so "more open" points inward every row, and
     * the route drifts a column per row for as long as the gap keeps widening. Its
     * clearance volume is the union of that whole diagonal sweep, so one route sterilised
     * a band thirteen columns wide instead of a tube two wide: on seed 1, Helion's own
     * cavern route (mission 19, deck at x=-134) wiped out the entire west wall, and
     * Helion — whose home *is* the west wall — dropped from 45 cells to 1 for the rest of
     * the campaign, along with Ixion beside it.
     *
     * `NEEDED` is what the channel actually has to have, not what it would prefer: enough
     * open columns to hold its own clearance volume. Above that, extra room buys nothing
     * and costs a colony its ground.
     */
    const NEEDED = Math.ceil((CHANNEL_HALF + lattice.cellSize / 2) / lattice.cellSize);
    if (openness(substrate, col, row) < NEEDED) {
      let bestCol = col;
      let bestScore = -Infinity;
      for (let d = -DRIFT_PER_ROW; d <= DRIFT_PER_ROW; d++) {
        const candidate = col + d;
        if (!lattice.inBounds(candidate, row)) continue;
        // Straightness still breaks ties, so a forced bend is the smallest one that works.
        const score = openness(substrate, candidate, row) - Math.abs(d) * 0.1;
        if (score > bestScore) {
          bestScore = score;
          bestCol = candidate;
        }
      }
      col = bestCol;
    }
    points.push({ x: lattice.worldX(col), y: lattice.worldY(row) });
  }

  return { padId: pad.id, points };
}

export function buildChannels(
  props: Prop[],
  digs: Excavation[],
  lattice: Lattice,
  substrate: SubstrateField,
  terrain: ChannelTerrain,
): ChannelNetwork {
  const pads = props.filter((p): p is Pad => p.kind === 'pad');
  const trunkCol = trunkColumn(lattice, terrain);
  const channels = pads.map((pad) => routeFor(pad, digs, lattice, substrate, terrain));

  const blocked = new Uint8Array(lattice.cols * lattice.rows);
  const mark = (col: number, row: number): void => {
    if (lattice.inBounds(col, row)) blocked[lattice.index(col, row)] = 1;
  };

  // Rasterised as an inflated capsule around the polyline: a cell is reserved when its
  // near face comes within `CHANNEL_HALF` of the route, which is the same thing as its
  // centre being within `CHANNEL_HALF + cellSize / 2`. See that constant for why the
  // relationship between the two matters more than the number does.
  const radius = CHANNEL_HALF + lattice.cellSize / 2;
  const span = Math.ceil(radius / lattice.cellSize);
  for (const channel of channels) {
    for (let i = 0; i + 1 < channel.points.length; i++) {
      const a = channel.points[i];
      const b = channel.points[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (lattice.cellSize / 3)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        const c0 = lattice.colAt(px);
        const r0 = lattice.rowAt(py);
        for (let dc = -span; dc <= span; dc++) {
          for (let dr = -span; dr <= span; dr++) {
            const col = c0 + dc;
            const row = r0 + dr;
            if (!lattice.inBounds(col, row)) continue;
            const dx = lattice.worldX(col) - px;
            const dy = lattice.worldY(row) - py;
            if (dx * dx + dy * dy <= radius * radius) mark(col, row);
          }
        }
      }
    }
  }

  // The deck itself. The channel above already covers the approach; this is the "nothing
  // stands *on* the landing surface" half, including what would be bolted underneath.
  for (const pad of pads) {
    const deckY = deckOf(pad, lattice, terrain);
    /**
     * The keep-out spans the deck as *this* module reads it and as `Layout.ts` reads it,
     * which are not the same height and cannot be made the same.
     *
     * `Layout.checkLayout` has no terrain, so it models a pad that rests on the ground as
     * sitting at y=0 — a documented approximation it has always made. This module does
     * have terrain and uses the pad's real height. Reserving only the real band leaves
     * cells that are legal here and a `deck` violation there: found on seed 0, a colony
     * standing at y 1.9–13.9 over `outpost-main`, whose real deck is at −4 and whose
     * assumed deck is 0. Covering both readings makes the reservation a superset of what
     * the check can flag, which is the only relationship between the two that can never
     * produce a violation.
     */
    const lo = Math.min(deckY, 0) - DECK_UNDER;
    const hi = Math.max(deckY, 0) + DECK_CLEAR;
    const half = pad.width / 2 + lattice.cellSize / 2;
    for (let col = lattice.colAt(pad.x - half); col <= lattice.colAt(pad.x + half); col++) {
      for (let row = 0; row < lattice.rows; row++) {
        const cy = lattice.worldY(row);
        if (cy + lattice.cellSize / 2 <= lo) continue;
        if (cy - lattice.cellSize / 2 >= hi) continue;
        mark(col, row);
      }
    }
    // The bench this pad will have levelled under it — see `BENCH_HALF`. Only a pad that
    // rests on the ground gets one; a pad at an authored height is bolted to structure
    // and moves no terrain at all.
    if (pad.y !== undefined) continue;
    for (let col = lattice.colAt(pad.x - BENCH_HALF); col <= lattice.colAt(pad.x + BENCH_HALF); col++) {
      for (let row = 0; row < lattice.rows; row++) {
        if (lattice.worldY(row) - lattice.cellSize / 2 > hi) break;
        mark(col, row);
      }
    }
  }

  /**
   * Every bore's opening, kept clear across its full width from the mouth upward. The
   * route through it only reserves the column it descends; this is what keeps the rest of
   * the opening — and the airspace directly over it, where a colony could otherwise build
   * a lid — from being closed in.
   */
  for (const dig of digs) {
    const mouth = mouthOf(dig, terrain);
    const half = dig.halfWidth + MOUTH_LANE;
    // Only a bore somebody is actually sent down. `Layout.ts`'s own mouth rule asks the
    // same question first, and for the same reason — a hole with no pad in it is a hole
    // nobody is flying into, and reserving a full-height column over every bore the
    // campaign ever drives is what starved the colonies when this was written without the
    // test: three columns to the rim, per dig, from mission one.
    const occupied = pads.some((p) => Math.abs(p.x - mouth.x) < half && (p.y === undefined || p.y < 0));
    if (!occupied) continue;
    const from = Math.max(0, lattice.rowAt(mouth.y));
    for (let col = lattice.colAt(mouth.x - half); col <= lattice.colAt(mouth.x + half); col++) {
      for (let row = from; row < lattice.rows; row++) mark(col, row);
    }
  }

  return {
    channels,
    trunkCol,
    blocked: (col, row) => !lattice.inBounds(col, row) || blocked[lattice.index(col, row)] === 1,
  };
}
