import type { Prop } from '../world/Colony.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import type { Lattice } from '../world/ColonyLattice.ts';
import type { SubstrateField } from '../world/ColonySubstrate.ts';
import { boreDirection, isFloorMounted } from '../world/Shaft.ts';

/**
 * The flight-route network, and the one hard guarantee the colony is built around:
 * **every pad that has been built keeps a permanent channel to the rim, and no colony cell
 * may enter it.**
 *
 * **Nothing here is reserved before the structure that needs it exists.** This module is
 * handed the pads and digs standing at one mission and answers for that mission only;
 * `ColonyPlan` re-runs it on every step of its campaign walk. A pad reserves its deck, its
 * bench and its channel on the mission it is built. A shaft reserves its mouth on the
 * mission it is driven. Until then that ground is ordinary canyon and the colonies are
 * free to grow on it — which does mean a new approach can demolish what stood in it. See
 * `planColonies` for why that trade was taken and what replaced the guarantee it cost.
 *
 * Four things make this stronger than the corridor rule it replaces, which reserved a
 * vertical column over the *currently targeted* pad's core:
 *
 *   - Every live pad keeps one for the rest of the campaign, so the canyon accumulates a
 *     route network all later growth has to respect rather than one mission's approach at
 *     a time.
 *   - A route is a polyline, not a column, so it can jog around rock as it climbs.
 *   - Routes *merge*: a climb that reaches a column another route already occupies adopts
 *     that route's points and becomes it, so the upper canyon carries one shared trunk
 *     rather than one keep-out strip per pad.
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
 * Half-width of the lane down the middle of a bore's opening that must stay clear.
 *
 * **A lane, not the whole opening.** The rule this replaces reserved `halfWidth +
 * MOUTH_LANE` either side — for Kessler's shaft, three columns held from the mouth to the
 * rim, the single widest reservation in the canyon and most of Ixion's ground on a narrow
 * seed. It was not needed. `Layout.cappedFloorMouth` does not require the opening to be
 * *empty*; it measures the widest surviving gap and asks for `MIN_MOUTH` (5). Reserving
 * the column the mouth sits on leaves a clear way one cell wide — twelve units — whatever
 * the colony does with the rest of the opening.
 *
 * Any value under half a cell reserves that one column, so this is really a statement that
 * the lane is narrower than a cell rather than a tuned number. It goes wider only if the
 * mouth straddles two columns, which for a floor bore it no longer does: those are snapped
 * to the lattice at resolution (`TerrainDigs`).
 */
const MOUTH_LANE = 3;

/** How far a route may drift sideways per row it climbs. One column per row is 45°,
 *  which is plenty of room to dodge a wall and still be a descent rather than a
 *  slalom the player is asked to thread blind. */
const DRIFT_PER_ROW = 1;

/**
 * How far a route may cross *in one row* to reach a way that already exists.
 *
 * Drifting toward a trunk at `DRIFT_PER_ROW` is right when there is nothing there yet —
 * the route is choosing a direction. It is wrong when the way is already built, because
 * every row spent creeping toward it is a row with two corridors in it. Measured on seed
 * 631729407 at mission 18: four ways converging a column per row put seven reserved
 * columns in one row and five in the next, a funnel the width of the canyon, and the
 * routes did not become one until three rows above the decks they left.
 *
 * Crossing in a single row makes that a traverse — leave the deck, cross, climb — which is
 * both a shape a pilot flies and one row of keep-out instead of three. Each column crossed
 * still has to be open (`openness`), so this cannot cut a route through rock.
 */
const JOIN_REACH = 5;

/** How far either side the ascent looks when judging which column is most open. Beyond
 *  this the answer stops changing the choice and only costs samples. */
const OPENNESS_REACH = 4;

/**
 * The height, as a fraction of the lattice, above which routes start looking for each
 * other. Below it every route climbs in its own column, straight up from its own deck.
 *
 * Not a taste decision — the canyon floor is the one place that cannot afford a shared
 * corridor. Converging from row 0 was tried and it seals the bottom of the canyon: the
 * merged trunk lands on the same few columns as `outpost-main`'s own deck and bench, and
 * between them they leave *no* unreserved floor at all. Measured on seed 12345, rows 0 and
 * 1 came out with two free cells in the whole canyon, both against the east wall — so
 * Ixion, whose home is the middle of the floor, rooted on Kessler's wall instead and
 * Kessler finished the campaign with one cell.
 *
 * Starting the merge partway up costs nothing anyone can see. The pads are all low; the
 * part of a descent a player actually reads as "the way in" is the upper canyon, and that
 * is exactly the part that collapses to a single trunk.
 */
const CONVERGE_ABOVE = 0.35;

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
  /** True for a cell inside a route's clearance volume only — the flight lanes without
   *  the decks and bore mouths `blocked` folds in with them. See where it is built. */
  onLane(col: number, row: number): boolean;
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
 * The canyon's own middle — midway between its two floor edges, which wander by seed, so
 * this is the real centreline rather than world x=0 or the middle of the lattice array.
 *
 * Where the first route to climb any given row heads, and therefore where the shared
 * trunk ends up: every later route steers at whatever way is already going up, and only
 * falls back to this when there is nothing yet to join. See `routeFor`.
 */
function trunkColumn(lattice: Lattice, terrain: ChannelTerrain): number {
  return lattice.colAt((terrain.floorEdgeAt(0, -1) + terrain.floorEdgeAt(0, 1)) / 2);
}

/**
 * A row of an already-built route, and everything that route does from there to the rim.
 *
 * This is what lets one route *become* another rather than merely run beside it: a climb
 * that arrives in an occupied column adopts that column's tail verbatim and stops, so the
 * two are the same polyline above the merge — identical points, one reserved corridor.
 */
interface Join {
  col: number;
  row: number;
  tail: Array<{ x: number; y: number }>;
}

/**
 * One pad's route: out of whatever it sits inside, then up to the rim — **joining any way
 * that is already climbing rather than opening a second one beside it.**
 *
 * Routes used to ascend independently, each in its own column, and the cost is the whole
 * reason the upper canyon had nothing left in it: N pads sliced the lattice into N
 * vertical keep-out strips, and a colony got whatever slivers were left between them. A
 * merged network reserves one corridor for as many pads as share it, which is both what
 * the canyon looks like from the air and considerably cheaper in ground.
 *
 * Merging is what makes convergence affordable at all. Steering every route at the
 * canyon's middle *without* it was measured as strictly worse than leaving them straight —
 * 77 of 486 corp-missions under ten cells, against 0 — because the diagonals cost ground
 * on the way in and then still ended in separate columns. The steering here is the same
 * idea; what changed is that arriving now costs nothing, because the route that got there
 * first is already paid for.
 *
 * Deterministic: a pure function of the seed's terrain and the order pads are routed in,
 * which `buildChannels` fixes. The same route every mission for as long as the pad stands.
 */
function routeFor(
  pad: Pad,
  digs: Excavation[],
  lattice: Lattice,
  substrate: SubstrateField,
  terrain: ChannelTerrain,
  joins: Join[],
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
  const trunk = trunkColumn(lattice, terrain);
  const startRow = Math.max(0, lattice.rowAt(start.y) + 1);
  const needed = Math.ceil((CHANNEL_HALF + lattice.cellSize / 2) / lattice.cellSize);
  /** Rows this route climbed on its own, for later routes to join. Recorded only up to a
   *  merge: above one, an identical entry already exists from the route it merged into. */
  const mine: Array<{ col: number; row: number; at: number }> = [];
  let col = lattice.colAt(start.x);

  for (let row = startRow; row < lattice.rows; row++) {
    /**
     * Whatever is already climbing through this row.
     *
     * **If there is a way here, take it — at any height.** Two roads running side by side
     * up the same canyon are two corridors' worth of keep-out doing one corridor's job,
     * and no player reads them as anything but a wide red band.
     *
     * Seeking the canyon's *middle* when there is no way to join is the separate half, and
     * it stays gated to `CONVERGE_ABOVE`, because that is the half that costs floor. A
     * route bending toward the centreline from row 0 puts the trunk on the same columns as
     * `outpost-main`'s own deck and bench, and between them they leave no unreserved floor
     * at all — seed 12345 came out with two free cells across rows 0 and 1, both against
     * the east wall, and Ixion rooted on Kessler's face instead. Joining costs nothing by
     * comparison: the column is already reserved by whoever got there first.
     */
    const ways = joins.filter((j) => j.row === row);
    let target: number | null = null;
    if (ways.length > 0) {
      let nearest = Infinity;
      for (const way of ways) {
        const d = Math.abs(way.col - col);
        if (d < nearest) {
          nearest = d;
          target = way.col;
        }
      }
    } else if (row >= lattice.rows * CONVERGE_ABOVE) {
      target = trunk;
    }
    if (target !== null && col !== target) {
      // Joining an existing way crosses in one row; choosing a direction with nothing to
      // join drifts a column at a time. See `JOIN_REACH`.
      const budget = ways.length > 0 ? JOIN_REACH : DRIFT_PER_ROW;
      const dir = col < target ? 1 : -1;
      for (let n = 0; n < budget && col !== target; n++) {
        const step = col + dir;
        if (!lattice.inBounds(step, row) || openness(substrate, step, row) < needed) break;
        col = step;
      }
    }

    /**
     * Climb straight unless this column is genuinely too tight, and only then take the
     * most open neighbour.
     *
     * The rule that was here — always move to whichever of the three candidates is *most*
     * open — is subtly and expensively wrong. A route leaving a wall mouth is next to
     * rock, so "more open" points inward every row, and the route drifts a column per row
     * for as long as the gap keeps widening. Its clearance volume is the union of that
     * whole diagonal sweep, so one route sterilised a band thirteen columns wide instead
     * of a tube two wide: on seed 1, Helion's own cavern route (mission 19, deck at
     * x=-134) wiped out the entire west wall, and Helion — whose home *is* the west wall —
     * dropped from 45 cells to 1 for the rest of the campaign, along with Ixion beside it.
     *
     * `needed` is what the channel actually has to have, not what it would prefer: enough
     * open columns to hold its own clearance volume. Above that, extra room buys nothing
     * and costs a colony its ground.
     */
    if (openness(substrate, col, row) < needed) {
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

    // Arrived on a way that is already going up: become it. Everything above this point is
    // literally the other route's own points, so the two share one corridor to the rim.
    const merged = ways.find((w) => w.col === col);
    if (merged) {
      points.push(...merged.tail);
      break;
    }
    mine.push({ col, row, at: points.length });
    points.push({ x: lattice.worldX(col), y: lattice.worldY(row) });
  }

  for (const { col: c, row, at } of mine) joins.push({ col: c, row, tail: points.slice(at) });
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

  /**
   * Deepest deck first, and the order is load-bearing rather than incidental: routes join
   * whichever way is already climbing (`routeFor`), so whoever goes first lays the trunk
   * everyone else merges into. The deepest pad is the one with the whole canyon left to
   * climb, so its route is the longest — start anywhere else and the trunk begins partway
   * up with nothing under it for the floor pads to join.
   *
   * Ties break on `id` so the order is a function of the ledger, not of array order.
   */
  const ordered = [...pads].sort(
    (a, b) => deckOf(a, lattice, terrain) - deckOf(b, lattice, terrain) || (a.id < b.id ? -1 : 1),
  );
  const joins: Join[] = [];
  const routed = new Map<string, Channel>();
  for (const pad of ordered) routed.set(pad.id, routeFor(pad, digs, lattice, substrate, terrain, joins));
  // Back into ledger order, so a caller reading `channels[i]` gets the pad it expects.
  const channels = pads.map((pad) => routed.get(pad.id)!);

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

  /**
   * A snapshot of the routes alone, before the decks and mouths are marked into the same
   * array — the flight lanes, without the places a lane terminates.
   *
   * `blocked` deliberately unions all three, because growth's question is "may I stand
   * here" and the answer is no for every one of them. But a caller asking *what a colony
   * is looking at* needs them apart, and the measurement is what settled it: with decks
   * folded in, 42–52% of every colony reads as lane-facing and Ixion's outpost — a small
   * settlement ringed by its own pads — reaches 87%, which is not frontage, it is the
   * whole colony. See `ColonyPlan.routeFront`, the one consumer.
   */
  const lane = blocked.slice();

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
    /**
     * Every height the deck is read at, spanned together.
     *
     * Three of them, and leaving any out has been measured to produce a violation:
     *
     *   - `deckY`, this module's own reading, **snapped down to the lattice** — which is
     *     the one that bites. `kessler-crest` is authored at y 73 and snaps to 68, so a
     *     band computed from the snapped value alone stops at 71 and leaves the cell at
     *     73.9–85.9 legal here and a `deck` violation in `Layout.ts`. Seen on four of the
     *     ten mission/seed pairs checked.
     *   - The pad's *real* height, which is what `Layout` measures an elevated pad at.
     *   - `y = 0`, but only for a pad resting on the ground: `Layout.checkLayout` has no
     *     terrain, so it models those as sitting at zero — a documented approximation it
     *     has always made. A pad bolted to structure in mid-air carries an authored height
     *     and is judged there, so including zero for those would reserve the entire column
     *     beneath it, which is exactly the ground its own scaffolding has to grow up.
     *
     * Covering all of them makes the reservation a superset of what the check can flag,
     * which is the only relationship between the two that can never produce a violation.
     */
    const real = pad.y ?? terrain.heightAt(pad.x, 0, false);
    const heights = pad.y === undefined ? [deckY, real, 0] : [deckY, real];
    const lo = Math.min(...heights) - DECK_UNDER;
    const hi = Math.max(...heights) + DECK_CLEAR;
    /**
     * Exactly the columns whose cells would actually overlap the deck, tested rather than
     * approximated by a half-width.
     *
     * The approximation was `pad.width / 2 + cellSize / 2`, which for a 12-wide pad is a
     * full cell either side — three columns of keep-out for a deck that occupies one. With
     * pads snapped to the lattice (`snapToColumn`) the honest answer is usually a single
     * column, because `Layout`'s own deck rule asks whether a cell's span overlaps the
     * pad's footprint, and a cell in the next column along only ever *touches* it.
     */
    const footprint: [number, number] = [pad.x - pad.width / 2, pad.x + pad.width / 2];
    const reach = Math.ceil((pad.width / 2 + lattice.cellSize / 2) / lattice.cellSize);
    const centre = lattice.colAt(pad.x);
    for (let col = centre - reach; col <= centre + reach; col++) {
      const cellLo = lattice.worldX(col) - lattice.cellSize / 2;
      const cellHi = lattice.worldX(col) + lattice.cellSize / 2;
      if (cellHi <= footprint[0] || cellLo >= footprint[1]) continue;
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
   * Every bore's opening, kept clear across its full width — **for one bore-width above
   * the lip, not to the rim.**
   *
   * The height is not a taste call: it mirrors `Layout.cappedFloorMouth`'s own `headroom`
   * exactly, so this stays the superset of what that check can flag, which is the only
   * relationship between a reservation and a check that can never produce a violation. If
   * the two ever disagree it is this comment that is wrong.
   *
   * It used to run the full height of the lattice, because the check used to have no
   * height test — a colony module a hundred and fifty units up sealed a shaft it could
   * not reach, so the keep-out had to go that high too. Three columns from floor to rim,
   * per occupied bore, and on seed 631729407 that was three of the four reserved columns
   * in the whole canyon. Above the headroom the route itself is still reserved, one column
   * wide, which is what stops anything roofing the descent.
   */
  for (const dig of digs) {
    const mouth = mouthOf(dig, terrain);
    const half = dig.halfWidth + MOUTH_LANE;
    // Only a bore somebody is actually sent down. `Layout.ts`'s own mouth rule asks the
    // same question first, and for the same reason — a hole with no pad in it is a hole
    // nobody is flying into, and reserving over every bore the campaign ever drives is
    // what starved the colonies when this was written without the test.
    const occupied = pads.some((p) => Math.abs(p.x - mouth.x) < half && (p.y === undefined || p.y < 0));
    if (!occupied) continue;
    const from = Math.max(0, lattice.rowAt(mouth.y));
    const to = lattice.rowAt(mouth.y + dig.halfWidth * 2);
    for (let col = lattice.colAt(mouth.x - half); col <= lattice.colAt(mouth.x + half); col++) {
      for (let row = from; row <= to && row < lattice.rows; row++) mark(col, row);
    }
  }

  return {
    channels,
    trunkCol,
    blocked: (col, row) => !lattice.inBounds(col, row) || blocked[lattice.index(col, row)] === 1,
    // Out of bounds is *not* a lane — the opposite of `blocked`'s answer, and deliberately
    // so. `blocked` is asked "may I stand here", where the canyon's edge is a no; this is
    // asked "is there a lane here", where the edge is simply nothing, and treating it as a
    // lane would light the outermost ring of every colony against bare rock.
    onLane: (col, row) => lattice.inBounds(col, row) && lane[lattice.index(col, row)] === 1,
  };
}
