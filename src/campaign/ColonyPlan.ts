import type { Prop } from '../world/Colony.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import { CORPS, type CorpId } from '../world/CanyonSpec.ts';
import {
  buildLattice,
  COLONY_CELL_SIZE,
  COLONY_LAYERS,
  COLONY_ROWS,
  type Lattice,
  type LatticeTerrain,
} from '../world/ColonyLattice.ts';
import { buildSubstrate, type SubstrateField, type SubstrateTerrain } from '../world/ColonySubstrate.ts';
import {
  growColony,
  TRAIT,
  type OrganismCell,
  type PlacedCell,
  type Spore,
  type SpineColumn,
  type SpineTarget,
  MAX_CANTILEVER,
} from '../world/ColonyOrganism.ts';
import { buildChannels, type ChannelNetwork, type ChannelTerrain } from './ColonyChannels.ts';
import { MISSIONS, worldAt } from './Missions.ts';
import { snapToColumn } from '../world/ColonyLattice.ts';
import { resolveTerrainAnchoredDigs, applyDigAttachments } from './TerrainDigs.ts';

/**
 * Composition root for colony growth: campaign facts in, props out.
 *
 * Called from `Game.loadMission` *after* `canyon.build()`, which is the ordering the
 * whole design rests on — generate the landscape, fit a lattice to it, reserve the
 * flight channels, then grow on what is left. Everything mission- and corp-specific
 * lives here; the lattice, the substrate, the channels and the organism itself each know
 * nothing about the campaign.
 */

type ColonyProp = Extract<Prop, { kind: 'colony' }>;

/**
 * How many cells a corp has built, from where it stands in its own mission sequence and
 * how well those missions went. Both terms only ever rise as the campaign progresses and
 * as `Progress.complete` raises stored ranks, and the organism builds in a fixed order —
 * so a later mission runs the same sequence further and a colony can only ever be
 * *older*, never a different shape. That is the entire maturity model.
 */
function cellBudget(flown: number, points: number, isOpeningMission: boolean): number {
  if (isOpeningMission) return FIRST_MISSION_CELLS;
  const ramped = Math.min(flown, RAMP_MISSIONS);
  const full = Math.max(0, flown - RAMP_MISSIONS);
  return Math.round(
    BASE_CELLS + RAMP_PER_MISSION_CELLS * ramped + PER_MISSION_CELLS * full + PER_POINT_CELLS * points,
  );
}

/**
 * What a charter's colony is worth: a base, plus what each run you fly for them buys, plus
 * what flying it well buys on top.
 *
 * **Points per mission rather than a fraction of the campaign**, and the difference is not
 * cosmetic. The old form was `66 · elapsed / thisCorpsTotalMissions`, which normalises the
 * three charters against each other: whoever commissions eight runs and whoever commissions
 * twelve both arrive at exactly the same size by mission 30, and a run you fly for a corp
 * moves its colony by a different amount depending on how many *other* runs that corp
 * happens to have in the ledger. Adding missions to a charter made each of its existing
 * ones count for less. Points make the relationship the obvious one — a delivery is worth a
 * fixed number of rooms, and a charter you fly more for builds more.
 *
 * **Sized against the canyon's volume, not its cross-section**, which is the correction the
 * layers forced. A single plane's face holds forty to seventy cells depending on the seed,
 * and the old numbers ran out at about the moment it filled — so depth, which only unlocks
 * *past* a full face, could never be more than leftovers. Measured before the change, a
 * colony was budget-bound rather than space-bound for the whole campaign: 35 cells at
 * mission 16 on seed 631729407 against a face that could hold 68. Mid-campaign colonies
 * were flat by arithmetic, not by choice.
 *
 * There is no runaway risk in raising them, because the budget is not the only limit — it
 * is capped by `standing + reachableGround`, so a corp still cannot be granted cells it has
 * nowhere to put. Raising these changes *which* of the two limits binds, and that is the
 * whole intent: space should decide a colony's size, not a coefficient.
 */
const BASE_CELLS = 10;
const PER_MISSION_CELLS = 7;
/**
 * A slower rate for a corp's own first few missions, so the jump off `FIRST_MISSION_CELLS`
 * reads as a start rather than a reveal.
 *
 * The steady-state rate is tuned for a colony already standing — a mission-to-mission
 * addition next to what is already there. Applied from mission 1 of a corp's own sequence,
 * the same rate instead measures a jump off a floor held at three cells by design (see
 * `FIRST_MISSION_CELLS`), and the two are not the same quantity: three missions in, the raw
 * formula already answers as if a colony had been standing for that long, so mission 3 reads
 * as a reveal of a city that was apparently there all along rather than as one more
 * building going up. `RAMP_MISSIONS` of `RAMP_PER_MISSION_CELLS` first, then
 * `PER_MISSION_CELLS` — a slower opening act, and `PER_MISSION_CELLS` itself came down
 * alongside it (10 to 7): without that, the mission right after the ramp ends buys as much
 * in one jump as the whole ramp bought across five, which reads as a jolt rather than a
 * resumption — and on a seed where a route has already narrowed the corp's own floor by
 * then, that jolt has nowhere left to go but up.
 */
const RAMP_PER_MISSION_CELLS = 3;
const RAMP_MISSIONS = 5;
/**
 * Per landing point, where a landing is scored 0–100 (`scoreLanding`).
 *
 * **The real score, not the rank it falls into.** Ranks are four buckets, so a 46-point
 * landing and a 65-point landing were both a B and bought a charter exactly the same
 * amount of building — thirty missions of that is a campaign where flying materially
 * better than "good enough for the bucket" changes nothing anybody can see. Points are
 * continuous, so every unit of fuel saved and every centimetre off the pad centre shows up
 * in the canyon.
 *
 * At 0.03 a flawless run is worth three cells on top of the ten the delivery itself buys,
 * so a perfect campaign runs about a third larger than a scraped one. Chosen to match what
 * the rank-bucket scheme paid at its maximum, so this is a refinement in *resolution*
 * rather than a change in what a good campaign is worth.
 */
const PER_POINT_CELLS = 0.03;

/**
 * Mission 1 is the outpost's first landing and there is nothing there yet. Held at three
 * cells so the canyon the player first sees is empty enough to read as unclaimed.
 *
 * **The campaign's opening mission, not each corp's own debut**, and the difference cost
 * the middle of the campaign its pacing. The floor exists to make the *first canyon the
 * player ever sees* read as unclaimed; a charter arriving at mission 6, into a canyon that
 * already has an outpost in it, is not that situation and gets the ordinary formula.
 *
 * Read as a per-corp debut it produced a cliff: Helion was granted 30 by mission 6's
 * `colonyBudget`, then dropped to this 3 on its very next mission, and `cellBudget` did not
 * climb back past 30 until the corp's *eighth* run. Growth never removes cells, so the
 * colony simply sat at 30 — Helion from mission 6 to 20, Kessler from 7 to 19. Measured
 * across all three corps at C-rank play: 92 cells at mission 8 and 91 at mission 20, a net
 * of −1 across thirteen missions, while mission 8's brief promises the player that "the gap
 * you fly closes a little more each mission."
 */
const FIRST_MISSION_CELLS = 3;

/** How much of a colony's own growing edge reads as bare scaffold rather than built
 *  hull. The promise this makes to the player: the scaffold you flew past last mission
 *  is a building this mission, and the scaffold has moved one ring outward. */
function frontierCount(built: number): number {
  return Math.max(2, Math.round(built * 0.18));
}

export interface PlanTerrain extends LatticeTerrain, SubstrateTerrain, ChannelTerrain {
  floorEdgeAt(z: number, side: 1 | -1): number;
}

export interface ColonyPlan {
  colonies: ColonyProp[];
  lattice: Lattice;
  substrate: SubstrateField;
  network: ChannelNetwork;
}

/**
 * Where each corp's colony started life. A wall corp roots on its own rock face, Ixion on
 * the floor between them — the nearest cell to that preference that is actually
 * *surface* (open air touching rock), unclaimed and outside every channel.
 *
 * One rule, replacing `findAnchorX`, `wallEdgeColumn`, `wallAnchors` and
 * `nearOtherWallAnchor` between them. The territory machinery those made up is gone
 * entirely: three organisms grow in one interleaved simulation, so a cell simply goes to
 * whichever filament reaches it first, and a corp's own reach is decided by the contest
 * rather than by a buffer computed in advance.
 */
function sporeFor(
  corp: CorpId,
  lattice: Lattice,
  substrate: SubstrateField,
  network: ChannelNetwork,
  terrain: PlanTerrain,
  taken: Set<number>,
  /** How far from home to look. A corp placing its *first* spore stays near its own side
   *  of the canyon; one that has been starved out of its pocket may look anywhere, since
   *  the alternative is not building at all. */
  maxStep: number,
  /** Whether a standing colony belonging to some *other* corp touches this cell. */
  rivalNear: (corp: CorpId, col: number, row: number) => boolean,
): Spore | null {
  const west = terrain.floorEdgeAt(0, -1);
  const east = terrain.floorEdgeAt(0, 1);
  /**
   * Home is the corp's own side of the canyon, not any particular pad's column.
   *
   * Anchoring to a pad was tried twice and rejected both times. Any pad moves Ixion off
   * the middle — `outpost-main` sits at x −14, so the outpost's search window shifts onto
   * Helion's half. Restricting it to *elevated* pads, on the theory that a raised deck is
   * a structural obligation its charter should root under, measured as no help at all:
   * one cell of difference for Helion across three seeds, and Kessler's own deck ended up
   * *further* from support on two of them. Which side of the canyon a charter holds is the
   * one thing about it that never changes; where it happened to put a pad is not.
   */
  const preferred =
    corp === 'helion'
      ? lattice.colAt(west)
      : corp === 'kessler'
        ? lattice.colAt(east)
        : lattice.colAt((west + east) / 2);
  /**
   * How far a corp may wander from home looking for ground. A wall corp can range along
   * its own wall; **Ixion cannot**, because the roomiest ground in the canyon is whichever
   * wall is least built on, and given the freedom Ixion walks straight over to it and
   * takes the ground Helion was going to root in. Observed exactly that: Ixion spread
   * across the west side and Helion had nowhere to go.
   *
   * This used to bound the *cost* loop only, while the per-candidate gate below tested
   * `maxStep` — which for a corp already standing is the whole canyon. So `OUTPOST_RANGE`
   * had no effect on where a rescue spore could actually land, and once rescue spores
   * started being honoured Ixion used it: on seed 631729407 it put nuclei seven columns
   * west and five columns east of the middle, roofed over Helion's colony four rows deep,
   * and finished the campaign as three disconnected masses on two other charters' ground.
   */
  const range = Math.min(maxStep, corp === 'outpost' ? OUTPOST_RANGE : maxStep);

  /**
   * Searched by cost, not by one axis then the other: climbing a row costs `ROW_COST`
   * columns of walking, and the cheapest cell that clears every check wins.
   *
   * Both single-axis orders were tried and both fail on a congested seed, in opposite
   * directions. Rows-outermost sweeps a whole row before trying the next, so a corp
   * whose own wall is blocked at ground level walks the entire canyon and roots on its
   * rival's side (Helion at x=+54, on Kessler's east wall, seed 12345 mission 22).
   * Columns-outermost tries every row of its own column first, so the same corp roots at
   * *the rim* — 230 units up, three cells clinging to the top of the wall (same seed,
   * same mission, after the first fix). A cost that trades the two off keeps a spore
   * both near home and near the ground, which is the only pair of properties a
   * foundation actually has to have.
   */
  const ROW_COST = 2;

  /**
   * Candidates in cost order, then the roomiest of them — not simply the first that is
   * legal.
   *
   * "First legal cell" is what put colonies in pockets they could never leave. A cell can
   * pass every check and still be a dead end, boxed in by rock on one side and a flight
   * route on the other, and because growth is strictly additive a corp that starts there
   * is stuck with it for the rest of the campaign. Ixion hit this hardest — it lives at
   * the canyon's middle, which is where every route converges — and came out with one or
   * two cells while the wall corps built forty.
   *
   * Looking at the free space around a candidate before committing to it costs one small
   * neighbourhood scan and turns "somewhere legal" into "somewhere a colony can actually
   * grow." Cost order still decides *which* candidates are considered, so a corp stays
   * near home; roominess only picks between the ones it was already willing to take.
   */
  const candidates: Array<{ spore: Spore; room: number; cost: number }> = [];
  for (let cost = 0; cost <= range + ROW_COST * lattice.rows; cost++) {
    for (let row = 0; row * ROW_COST <= cost && row < lattice.rows; row++) {
      const step = cost - row * ROW_COST;
      if (step > range) continue;
      for (const col of step === 0 ? [preferred] : [preferred - step, preferred + step]) {
        if (!lattice.inBounds(col, row)) continue;
        if (substrate.at(col, row) !== 'surface') continue;
        if (network.blocked(col, row)) continue;
        const index = lattice.index(col, row);
        if (taken.has(index)) continue;
        // Not on another charter's doorstep. A rescue spore is looking for *unclaimed*
        // ground, and landing beside — or on top of — a standing rival is how Ixion came
        // to be sitting four rows deep across Helion's roof. Being unable to land on the
        // cell itself was not enough: the cell above one is just as much an invasion.
        if (rivalNear(corp, col, row)) continue;
        if (!hasRoom(col, row, lattice, substrate, network)) continue;
        // Superlinear in distance from home, so a corp will climb several rows up its own
        // wall before it will walk the same distance onto somebody else's.
        const encroachment = (step / 3) ** 2;
        candidates.push({
          spore: { corp, col, row },
          room: roomAround(col, row, lattice, substrate, network),
          cost: step + row * ROW_COST + encroachment,
        });
      }
    }
    // Enough to choose between without walking the whole canyon — the first candidates
    // found are the nearest ones, which is the property that matters.
    if (candidates.length >= 24) break;
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.cost - b.cost || b.room - a.room);
    const best = candidates[0].spore;
    taken.add(lattice.index(best.col, best.row));
    return best;
  }
  return null; // no room on this seed — contained, the corp simply has no colony
}

/** Columns either side of the canyon's own middle that Ixion is allowed to root within.
 *  Tight on purpose — see `sporeFor`'s `range`. */
const OUTPOST_RANGE = 7;

/** Below this fraction of what it should have built by now, a corp puts out another
 *  spore — see the call site for why this exists rather than better first-spore placement. */
const STARVED = 0.5;

/** How much genuinely buildable space sits around a candidate spore — the measure that
 *  separates "legal" from "worth starting from". A plain count of free cells in a small
 *  box, which is all the resolution this decision needs. */
function roomAround(
  col: number,
  row: number,
  lattice: Lattice,
  substrate: SubstrateField,
  network: ChannelNetwork,
): number {
  const REACH = 3;
  let free = 0;
  for (let dc = -REACH; dc <= REACH; dc++) {
    for (let dr = -REACH; dr <= REACH; dr++) {
      const c = col + dc;
      const r = row + dr;
      if (!lattice.inBounds(c, r)) continue;
      if (substrate.isSolid(c, r) || network.blocked(c, r)) continue;
      free++;
    }
  }
  return free;
}

/**
 * How much unclaimed ground a colony can actually get to from where it already stands —
 * a flood fill out of its own cells, through free lattice cells only, never through rock,
 * a channel, or anybody's structure.
 *
 * This is what a corp's allowance is capped against, and the reason is the failure it
 * fixes. A budget derived from campaign maturity alone asks for cells without asking
 * whether there is anywhere to put them, and on a narrow canyon the gap is enormous:
 * Ixion is entitled to 45 cells by mission 30 while its slot on the floor of seed
 * 631729407 is *one column wide*, boxed by the descent corridors either side. Being
 * permanently short of budget kept it permanently "starved", so the rescue mechanism kept
 * handing it new nuclei, and it spent the difference walking outward until it was sitting
 * across two other charters' walls.
 *
 * Capping the budget makes the starvation flag mean what it says. A corp hemmed into a
 * small pocket is *contained* — its allowance shrinks to fit, it is not starved, and it
 * asks for nothing. A corp in a genuinely dead pocket has almost no reachable ground, so
 * its cap sits near its standing count and it *is* starved, which is exactly the case the
 * rescue spore exists for.
 *
 * Bounded by `REACH_CAP` because the only question here is "more ground than the campaign
 * will ever grant", and past that the exact number changes nothing.
 */
const REACH_CAP = 400;

function reachableGround(
  own: number[],
  cells: Map<number, OrganismCell>,
  lattice: Lattice,
  substrate: SubstrateField,
  network: ChannelNetwork,
): number {
  const seen = new Set<number>(own);
  const queue = [...own];
  let free = 0;
  for (let head = 0; head < queue.length && free < REACH_CAP; head++) {
    const col = lattice.keyCol(queue[head]);
    const row = lattice.keyRow(queue[head]);
    const layer = lattice.keyLayer(queue[head]);
    /** Sideways and up within a layer, plus straight in and out of it — the same move set
     *  a tip actually has (`DIRS` and `DEPTH_DIRS` in `ColonyOrganism`), because the point
     *  of this is to count ground the colony can genuinely get to. */
    const around: Array<[number, number, number]> = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const [dc, dr, dl] of around) {
      const c = col + dc;
      const r = row + dr;
      const l = layer + dl;
      if (!lattice.inBounds(c, r) || !COLONY_LAYERS.includes(l as (typeof COLONY_LAYERS)[number])) continue;
      const key = lattice.key(c, r, l);
      if (seen.has(key)) continue;
      seen.add(key);
      // A channel is airspace on the play plane only, so the layers behind it are open
      // ground for this count — which is most of the capacity depth was added for.
      if (substrate.isSolid(c, r) || (l === 0 && network.blocked(c, r)) || cells.has(key)) continue;
      free++;
      queue.push(key);
    }
  }
  return free;
}

/** Whether a cell has at least one neighbour a filament could actually move to. */
function hasRoom(
  col: number,
  row: number,
  lattice: Lattice,
  substrate: SubstrateField,
  network: ChannelNetwork,
): boolean {
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (!lattice.inBounds(col + dc, row + dr)) continue;
    if (substrate.isSolid(col + dc, row + dr)) continue;
    if (network.blocked(col + dc, row + dr)) continue;
    return true;
  }
  return false;
}

/**
 * Notes on the lane bits set below, which are the renderer's only source for where a
 * flight channel runs past a colony.
 *
 * **`onLane`, not `blocked`** — routes only, without the pad decks and bore mouths that
 * `blocked` unions in with them. The first version used `blocked`, on the reasoning that a
 * deck is just the end of a lane and a charter would light both. Measured, that flagged
 * 42–52% of every colony and 87% of Ixion's outpost, a small settlement ringed by its own
 * pads: at that density the trait stops being information and the renderer is branching on
 * something very close to "is a cell". A mycelial colony is almost all surface, so a
 * predicate this cheap has to be about the *lane* specifically or it degenerates.
 *
 * **Sideways only.** A lane runs vertically down the canyon, so the cells that face one are
 * the ones beside it; a cell with a lane directly above or below is looking at it end-on
 * and has no wall along it to light. Dropping the vertical pair is most of what separates
 * "this wall runs alongside the approach" from "this cell is near the approach".
 *
 * Tested in the play plane at every layer, with no layer term, because that is where the
 * routes are: a cell one layer forward of the lane is still beside that lane in x, and its
 * flank is what a pilot in the channel sees when they look forward.
 */

/** One mission's resolved world — what `Game.loadMission` already builds for the mission
 *  it is loading, asked for any earlier mission too so growth can be walked forward. */
export interface MissionWorld {
  props: Prop[];
  digs: Excavation[];
}

/**
 * Every mission's resolved world, memoised — the exact sequence `Game.loadMission` used
 * to inline for the one mission it was loading, needed for every earlier mission too now
 * that growth walks the campaign forward.
 *
 * Safe to build before `canyon.build()` and reuse after it: `resolveTerrainAnchoredDigs`
 * only reads `floorEdgeAt`/`heightAt`, both pure functions of the seed rather than of
 * anything `build()` sets up (see `TerrainDigs.ts`'s `WallTerrain`). The memo is what
 * makes that reuse exact rather than merely likely — the caller and the campaign walk get
 * the same object, not two resolutions that agree.
 */
/**
 * Pads whose x is taken from their own charter's canyon wall — see `xFromWall`.
 *
 * Resolved here rather than in `worldAt` for the reason every other terrain-derived
 * position is: `worldAt` is deliberately pure and has no canyon to ask. `floorEdgeAt` is a
 * function of the seed alone and is safe to call before `build()`, exactly like the wall
 * anchoring in `TerrainDigs`, so this can run at the front of the pipeline where every
 * later stage — the mouth-clearance list, the channels, growth, the layout check — sees
 * one resolved position rather than each resolving its own.
 */
function resolveWallAnchoredPads(props: Prop[], terrain: PlanTerrain): Prop[] {
  return props.map((p) => {
    if (p.kind !== 'pad' || p.xFromWall === undefined) return p;
    const side = p.xFromWall === 'east' ? 1 : -1;
    return { ...p, x: snapToColumn(terrain.floorEdgeAt(0, side)) };
  });
}

export function missionWorlds(
  mastX: number | null,
  mastY: number | null,
  terrain: PlanTerrain,
  /** Where the player's relay stands, or null before the prologue is flown. */
  relay: { x: number; y: number | null } | null = null,
): (missionId: number) => MissionWorld {
  const cache = new Map<number, MissionWorld>();

  /**
   * Every deck a floor bore must not open underneath, across the whole campaign — see
   * `mouthSpan` in `TerrainDigs.ts`.
   *
   * **Every deck outside the bore, not just the ones resting on the ground.** A ground deck
   * seals a mouth with the bench graded under it; an elevated one seals it by being a solid
   * platform in the only airspace the shaft can be entered through. Measured on all three
   * test seeds, the mouth resolved to x 36 and `kessler-crest` — authored at 40, snapped to
   * 36, standing at y 73 — sat squarely across it for the whole campaign.
   *
   * Decks that name a dig are excluded, and have to be: those are the destinations *inside*
   * the bore, and keeping the mouth clear of them would be keeping it clear of itself.
   *
   * Read from the *authored* ledger rather than from resolved worlds, which looks like a
   * shortcut and is the only thing that works — resolution consumes this list, so deriving
   * it from resolved output would be circular. It is exact anyway: the decks this collects
   * are precisely the ones resolution never moves.
   *
   * Computed once per `missionWorlds` rather than per lookup: it walks all thirty missions,
   * and the resolver it feeds is called on every one of them.
   */
  const decksOutsideBores = (() => {
    const seen = new Map<string, { x: number; halfWidth: number; onGround: boolean }>();
    for (let m = 1; m <= MISSIONS.length; m++) {
      for (const p of resolveWallAnchoredPads(worldAt(m, mastX, mastY, relay).props, terrain)) {
        if (p.kind !== 'pad' || p.attachToDig !== undefined) continue;
        // A deck with no `y` rests on the ground and is graded a bench; one with a `y`
        // stands on a tower and denies only the air it occupies.
        seen.set(p.id, { x: p.x, halfWidth: p.width / 2, onGround: p.y === undefined });
      }
    }
    return [...seen.values()];
  })();

  return (missionId) => {
    const hit = cache.get(missionId);
    if (hit) return hit;
    const world = worldAt(missionId, mastX, mastY, relay);
    const resolved = resolveTerrainAnchoredDigs(world.digs, terrain, decksOutsideBores);
    const out: MissionWorld = {
      props: applyDigAttachments(resolveWallAnchoredPads(world.props, terrain), resolved.endpoints),
      digs: resolved.digs,
    };
    cache.set(missionId, out);
    return out;
  };
}

/**
 * Every ground-resting pad site the campaign will ever have, for `CanyonGenerator.build`.
 *
 * Levelling a bench under a pad *moves terrain*, and growth is replayed from mission one
 * on every load — so grading one mission at a time means the ground a colony was grown on
 * changes underneath it, and the replay produces a different colony. Measured: Ixion's
 * entire sixteen-cell mission-1 colony relocated at mission 2, when the first pad's bench
 * appeared in the middle of where it stood.
 *
 * Grading the whole plan at once makes terrain a pure function of the seed and the
 * campaign rather than of how far into it you are, which is what lets growth be strictly
 * additive. The same trade as reserving every route up front, and the same answer: a
 * levelled patch of floor that has no pad on it yet reads as canyon, because that is what
 * it looks like — the floor already carries three seed-derived natural shelves of exactly
 * the same shape (`CanyonGenerator.naturalShelves`).
 */
export function campaignPadSites(worldFor: (missionId: number) => MissionWorld): number[] {
  const sites = new Set<number>();
  for (let m = 1; m <= MISSIONS.length; m++) {
    for (const p of worldFor(m).props) {
      if (p.kind === 'pad' && p.y === undefined) sites.add(p.x);
    }
  }
  return [...sites].sort((a, b) => a - b);
}

/**
 * Grows every colony forward through the campaign to `id`, rather than deriving mission
 * `id` on its own.
 *
 * **A colony can only ever be extended.** This is the reason for the loop and the only
 * way to actually guarantee it. Deriving one mission in isolation looked equivalent —
 * growth builds in a fixed order, so a bigger budget just runs the same sequence further
 * — but it is not, because the *world* changes underneath: each new pad reserves a flight
 * channel, and a channel that lands on a colony's home does not merely stop it growing,
 * it moves the spore search somewhere else entirely and regrows a different colony from
 * scratch. Measured across three seeds × thirty missions: sixteen cases where a corp's
 * colony shrank between consecutive missions, including Helion going from 45 cells to 9
 * the mission its own cavern route appeared, and staying there for the remaining eleven
 * missions of the campaign.
 *
 * Walking forward, each mission starts from what the last one actually built. The only
 * thing that can now take ground off a colony is a new route physically demolishing the
 * cells in it — which is a real event, is visible, and is bounded by the size of one
 * channel rather than by an unlucky spore.
 *
 * Costs about 3ms per mission step against a canyon build's 800ms, so the whole campaign
 * walk is cheaper than the terrain it grows on.
 */
export function planColonies(
  id: number,
  worldFor: (missionId: number) => MissionWorld,
  /** Best landing points per mission id, 0–100 — `Progress.points`. A mission not yet
   *  flown is simply absent, which is the same thing as having earned nothing for it. */
  scores: Readonly<Record<string, number>>,
  seed: number,
  terrain: PlanTerrain,
): ColonyPlan {
  const lattice = buildLattice(terrain, COLONY_CELL_SIZE, COLONY_ROWS);
  const substrate = buildSubstrate(terrain, lattice);

  /**
   * **Nothing is reserved before it exists.** The forbidden set at mission *m* is the
   * routes of the pads that have actually been built by mission *m*, and no others.
   *
   * The alternative was tried and rejected: rasterising the whole campaign's network once,
   * from mission one, so the forbidden set could never grow and a colony could therefore
   * never lose a cell. It buys that guarantee with a canyon that is permanently full of
   * keep-out for approaches nobody has flown yet — mission 1 showing you mission 30's
   * airspace, thirty percent of the lattice sterile before the second delivery. The
   * settlement it produces is one that grew around obstacles that were not there.
   *
   * So a colony *can* now lose ground, and only one way: a route appearing this mission
   * through cells it already occupies (`growColony` drops those from `existing`). That is
   * a real event with a legible cause — the charter cleared its own approach — bounded by
   * the width of one channel, and it happens where the player can see it happen. The
   * invariant that replaces "never shrinks" is the honest one: **a cell is only ever lost
   * to a route that did not exist last mission**, which is what `ColonyPlan.test.ts`
   * asserts.
   *
   * A *decommissioned* pad keeps its reservation. That is not premature — the route was
   * flown and the ground stayed clear the whole time it was — and releasing it would let a
   * colony grow into a corridor that was open air a mission ago, which reads as structure
   * appearing out of nothing rather than as a colony growing.
   */
  const padsSoFar = new Map<string, Prop>();
  const digsSoFar: Excavation[] = [];
  let network = buildChannels([], [], lattice, substrate, terrain);

  let cells = new Map<number, OrganismCell>();

  for (let m = 1; m <= id; m++) {
    const world = worldFor(m);
    for (const p of world.props) {
      if (p.kind === 'pad' && !padsSoFar.has(p.id)) padsSoFar.set(p.id, p);
    }
    for (const d of world.digs) {
      if (!digsSoFar.some((x) => Math.abs(x.x - d.x) < 0.5 && Math.abs(x.depth - d.depth) < 0.5)) digsSoFar.push(d);
    }
    // Re-rasterised per mission rather than once, which is the whole point: the network is
    // what exists now. About 3ms a mission against a canyon build's 800ms.
    network = buildChannels([...padsSoFar.values()], digsSoFar, lattice, substrate, terrain);

    const spores: Spore[] = [];
    const budget = {} as Record<CorpId, number>;
    const attractors: Partial<Record<CorpId, Array<{ x: number; y: number }>>> = {};
    /**
     * Spore placement is a **play-plane** question throughout — a nucleus always lands at
     * layer 0 (`growColony`), the ground it is measured against is the canyon's own
     * cross-section, and the channels it has to avoid are airspace at z=0. So everything
     * here works in 2D column/row and asks the cell map about layer 0 only.
     */
    const taken = new Set([...cells.keys()].filter((k) => lattice.keyLayer(k) === 0).map((k) => lattice.index(lattice.keyCol(k), lattice.keyRow(k))));
    /** A standing colony of some other corp touching this cell — the territory test a
     *  rescue spore has to pass. Diagonals included: a nucleus placed corner-to-corner
     *  with a rival is still growing into its face. */
    const rivalNear = (corp: CorpId, col: number, row: number): boolean => {
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (!lattice.inBounds(col + dc, row + dr)) continue;
          const neighbour = cells.get(lattice.key(col + dc, row + dr, 0));
          if (neighbour && neighbour.corp !== corp) return true;
        }
      }
      return false;
    };

    /**
     * Each corp's decks that stand in open air, resolved once — spore placement needs them
     * (a charter with a raised platform roots under it) and so does gravity (it leans
     * toward them). One derivation rather than two that could drift apart.
     *
     * Only pads genuinely in the air qualify. A deck down a bore or bolted into a wall
     * face reads as solid substrate here, and neither rooting a colony at rock nor pulling
     * one toward it is any use.
     */
    const midAir: Partial<Record<CorpId, Array<{ x: number; y: number; halfWidth: number }>>> = {};
    for (const corp of Object.keys(CORPS) as CorpId[]) {
      midAir[corp] = world.props.flatMap((p) => {
        if (p.kind !== 'pad' || p.corp !== corp || p.y === undefined) return [];
        const row = lattice.rowAt(p.y);
        if (row < 1 || row >= lattice.rows) return [];
        if (substrate.isSolid(lattice.colAt(p.x), row)) return [];
        return [{ x: p.x, y: p.y, halfWidth: p.width / 2 }];
      });
    }

    /**
     * The columns each corp may raise under its own mid-air deck, bottom-up.
     *
     * `midAir` names the decks; this turns each one into the cells that could hold it up.
     * Derived rather than authored, for the reason a deck's own height should be: the
     * column runs from the terrain directly under the deck to the deck's own row, so
     * moving a deck cannot leave its support behind.
     *
     * **Several candidate columns per deck, not one.** The deck's own column is tried
     * first and is routinely unavailable — a flight channel along the floor, or a rival
     * standing in it — so the search widens a cell at a time to either side, staying
     * within the deck's own footprint and one cell beyond it. Anything further out stops
     * reading as the thing holding the deck up.
     *
     * The bottom is the first row above the ground at that column rather than row 0: the
     * canyon floor wanders, and starting at the lattice base would ask for cells inside
     * rock on every seed where the deck stands over high ground.
     */
    const spine: Partial<Record<CorpId, SpineTarget[]>> = {};
    for (const corp of Object.keys(CORPS) as CorpId[]) {
      const targets: SpineTarget[] = [];
      for (const deck of midAir[corp] ?? []) {
        const centre = lattice.colAt(deck.x);
        /**
         * One row **below** the deck, not the deck's own row. A deck is folded into
         * `blocked` along with the channels, so a column reaching its own row is a column
         * whose last cell can never be placed.
         */
        const top = lattice.rowAt(deck.y) - 1;
        /**
         * How far the search may stand a column off the deck's axis: the cantilever the
         * no-floating rule already allows, and not a cell further. That bound is what
         * makes an offset column worth having — it finishes with a horizontal bracket
         * back to under the deck, and each cell of that run costs one step of reach.
         */
        const columns: SpineColumn[] = [];
        for (let step = 0; step <= MAX_CANTILEVER; step++) {
          for (const col of step === 0 ? [centre] : [centre - step, centre + step]) {
            const ground = Math.max(0, lattice.rowAt(terrain.heightAt(lattice.worldX(col), 0, true)));
            const column: SpineColumn = [];
            for (let row = ground; row <= top; row++) column.push({ col, row });
            if (column.length > 0) columns.push(column);
          }
        }
        if (columns.length > 0) targets.push({ centre, top, columns });
      }
      if (targets.length > 0) spine[corp] = targets;
    }

    for (const corp of Object.keys(CORPS) as CorpId[]) {
      const corpMissions = MISSIONS.filter((x) => x.client === corp);
      const first = corpMissions[0];
      if (!first || first.id > m) continue; // this corp hasn't started yet

      /**
       * The corp's own missions so far, minus any this campaign froze for them.
       *
       * A frozen mission is one whose cargo arrived and was never installed — see
       * `colonyFrozen`. Dropping it from the count is what makes the injunction visible
       * in the geometry: for the two missions it holds, the player flies over a colony
       * that does not grow, and nothing anywhere says so in words.
       */
      const elapsed = corpMissions.filter(
        (x) => x.id <= m && !(x.colonyFrozen ?? []).includes(corp),
      );
      const earnedPoints = elapsed.reduce((sum, x) => sum + (scores[String(x.id)] ?? 0), 0);

      const currentMission = MISSIONS.find((x) => x.id === m);
      /**
       * A **cap**, not a floor. The one mission that sets it is mission 2, holding Ixion
       * at three cells so the canyon still reads unclaimed on the run that plants the
       * radar. Missions 6 and 7 used to set it the other way — as a floor, to get enough
       * stack under a crest deck — and a single field meaning both things is what let a
       * deck-support patch silently freeze twelve missions of growth. Deck support is not
       * a budget problem and is no longer solved here; see `missions.yaml`.
       */
      const cap = currentMission?.colonyBudget?.[corp];
      const earned = cap ?? cellBudget(elapsed.length, earnedPoints, m === 1);
      /**
       * What the campaign has earned this corp, capped by what it can actually build on.
       *
       * A corp that has not spored yet has no cells to flood-fill from, so it is uncapped
       * and gets its full allowance — the spore search is what decides where that lands.
       */
      const own = [...cells].filter(([, c]) => c.corp === corp).map(([index]) => index);
      const standing = own.length;
      budget[corp] =
        standing === 0 ? earned : Math.min(earned, standing + reachableGround(own, cells, lattice, substrate, network));
      attractors[corp] = world.props.flatMap((p) =>
        p.kind === 'pad' && p.corp === corp ? [{ x: p.x, y: p.y ?? terrain.heightAt(p.x, 0, true) }] : [],
      );

      /**
       * A corp normally resumes from its own live edge (`growColony`'s `existing`) and
       * needs no spore at all. It gets another one only when it is badly short of what it
       * should have built by now — which is the system healing itself rather than a
       * special case.
       *
       * The failure this answers is real and stubborn: a spore can land in a pocket that
       * rock, a flight route and a bore mouth between them close off, and because growth
       * resumes from what already stands, that corp is then stuck with its bad start for
       * the rest of the campaign. Tuning where the first spore lands only moves which
       * seeds it happens on — every ordering tried starved a different corp on a different
       * seed. Letting a starved colony put out a second nucleus fixes the whole class, and
       * it is what a colony under pressure actually does.
       *
       * `growColony` has to honour it, and for a long time it did not — it refused any
       * spore for a corp already standing, which made every line below here dead code.
       * Kessler sat at one cell from mission 10 to the end of the campaign on seed
       * 2135022333 because of it. See the spore loop there.
       *
       * Read against the *capped* budget, which is what makes the test mean "boxed in"
       * rather than "modest". A corp with a small pocket and a big campaign allowance was
       * permanently below the raw figure and so permanently asking for new nuclei — which
       * is how a rescue mechanism turned into an invasion. See `reachableGround`.
       */
      if (standing >= budget[corp] * STARVED) continue;
      const spore = sporeFor(
        corp,
        lattice,
        substrate,
        network,
        terrain,
        taken,
        standing === 0 ? Math.round(lattice.cols / 3) : lattice.cols,
        rivalNear,
      );
      if (spore) spores.push(spore);
    }

    /**
     * Where each colony leans: the open middle of the canyon, **plus every one of its own
     * decks standing in mid-air.**
     *
     * An elevated pad is a place the corp is contractually obliged to be able to reach, so
     * it is a gravity point in the literal sense the model already has — growth leans
     * toward it, climbs to it, and the structure that appears under it is scaffolding a
     * colony built for its own reasons rather than a tower stamped in by the planner.
     *
     * That distinction is why the first attempt at this was wrong: it wrote cells straight
     * into the map beneath each raised deck, bypassing support, budget and build order,
     * so the "scaffolding" could stand in mid-air, belonged to no tip, and was invisible
     * to every invariant the organism enforces. Expressing it as gravity costs one term
     * and cannot produce anything the model would not have built anyway.
     *
     * Only pads genuinely in the air qualify. A deck down a bore or bolted into a wall
     * face reads as solid substrate here, and pulling a colony at rock it can never
     * occupy just leans it into the wall.
     */
    const canyonMiddle = (terrain.floorEdgeAt(0, -1) + terrain.floorEdgeAt(0, 1)) / 2;
    /**
     * **Every colony leans at the canyon's top centre.** That is what makes the three of
     * them arch in toward each other over the descent rather than each standing up its own
     * side, and Ixion needs it most: it is the one in the middle, so for Ixion the point is
     * straight overhead and the lean is a pure climb.
     *
     * Ixion was given the canyon's *bottom* centre for a while, and the reason it had to be
     * taken away is the clearest thing the narrow seeds show. A gravity point on the floor
     * makes every upward move score negative, so a colony can only ever spend its budget
     * sideways — and Ixion's budget arrives four missions before either rival exists. On
     * seed 631729407 it had 36 cells by mission 5, laid flat across the east half of the
     * canyon floor and stopping dead at row 7, and Kessler landed at mission 6 to find its
     * own ground already built on. It also flatly contradicted the pine shape below, which
     * says *narrow and cheap to climb*; gravity won, and the result was neither.
     *
     * What made the floor point look necessary was a different bug: Ixion given skyward
     * gravity used to cross the canyon and climb the *far wall*, because a rival's roof
     * counted as footing (see `reachOf`) and the middle was reserved floor-to-rim by a
     * trunk that then started at row 0. Neither is true any more.
     */
    const skyward = { x: canyonMiddle, y: lattice.worldY(Math.round(lattice.rows * (2 / 3))) };
    const apex: Partial<Record<CorpId, Array<{ x: number; y: number }>>> = {};
    for (const corp of Object.keys(CORPS) as CorpId[]) {
      apex[corp] = [skyward, ...(midAir[corp] ?? [])];
    }

    cells = growColony({
      lattice,
      substrate,
      forbidden: network.blocked,
      spores,
      budget,
      attractors,
      apex,
      // Ixion grows as a pine: the floor between the routes is all the width it will ever
      // have, so it spends its budget upward instead of starving against the sides.
      shape: { outpost: { lateral: 0.2, height: 0.4 } },
      seed,
      existing: cells,
      spine,
    });
  }

  // Split the one shared cell map into a prop per corp — `Layout.ts` wants per-corp
  // footprints, and the renderer wants one material set per corp. A corp's *actual*
  // built count is what the frontier is measured against, not its budget: a colony
  // hemmed in by rock and channels stops early, and its own last-built ring is still the
  // edge that reads as under construction.
  const built = new Map<CorpId, number>();
  for (const cell of cells.values()) {
    built.set(cell.corp, Math.max(built.get(cell.corp) ?? 0, cell.order + 1));
  }
  const byCorp = new Map<CorpId, PlacedCell[]>();
  for (const [key, cell] of cells) {
    const total = built.get(cell.corp) ?? 0;
    const list = byCorp.get(cell.corp) ?? [];
    const col = lattice.keyCol(key);
    const row = lattice.keyRow(key);
    const layer = lattice.keyLayer(key);
    /**
     * Standing on something, as this simulation means it — rock beside or beneath, **or the
     * colony's own structure directly below**.
     *
     * The first version used `substrate.at() === 'surface'` alone, on the reading that
     * "touching wall or ground" means touching rock. Measured on mission 30, that is 35 of
     * 313 cells: a mycelial colony is a cantilevered lattice, and 89% of it hangs in open
     * air held up by its own structure, which is precisely what `reachOf` and
     * `MAX_CANTILEVER` exist to arbitrate. Intersected with the runs a merge needs, 220
     * joined pairs came out as 3, and the feature could not fire.
     *
     * Rock-adjacency was the wrong proxy because it contradicts the simulation's own notion
     * of support. A room on the third floor of a settlement is not floating; the floor below
     * it is what holds it up, and that is the fact worth reading.
     */
    const grounded = substrate.at(col, row, layer) === 'surface' || cells.has(lattice.key(col, row - 1, layer));
    list.push({
      x: lattice.worldX(col),
      y: lattice.worldY(row),
      z: lattice.worldZ(layer),
      links: cell.links,
      reach: cell.reach,
      /**
       * Bare frame where the colony is *reaching*, hull where it is standing.
       *
       * Age alone used to decide this — the last ring built was scaffold and everything
       * older was a finished module. That reads as a settlement of solid rooms with a thin
       * crust, and at the densities this model reaches it made the whole mass look poured
       * rather than built: aggressive, and with no visible sign of the constant expansion
       * the campaign is supposed to be showing.
       *
       * Support is the better second half of the test, and it is the same fact the merge
       * reads. A cantilevered cell is one the charter has thrown out over open air and has
       * not yet built anything under; drawing it as an open frame says exactly that, and it
       * turns into a hull on the mission a floor appears beneath it. That is the scaffold
       * promise the player could already check — the frame you flew past last mission is a
       * building this mission — extended from the growing edge to every unsupported arm,
       * and it makes the outline of the colony read as under construction everywhere it is
       * actually still reaching.
       */
      scaffold: !grounded || cell.order >= total - frontierCount(total),
      traits:
        /**
         * Exactly the four cells that touch a lane face-to-face, seen in plan:
         *
         * ```
         *   0 0 = 0 0     layer -1
         *   0 = · = 0     layer  0   ( · is the lane )
         *   0 0 = 0 0     layer +1
         * ```
         *
         * Flanks in the play plane only, behind in the layers immediately front and back,
         * and **no diagonals**. This is narrower than it was: the first version tested the
         * flanks with no layer term at all, so a cell one layer back and one column across
         * — touching the lane at a corner, if at all — lit up as though it fronted it. That
         * put lit fittings on cells a pilot in the channel never has square in view, which
         * spends the navigational signal on surfaces that cannot carry it.
         *
         * A cell can still hold a flank bit and `laneBehind` at once where two lanes cross,
         * and gets both fittings, each square to its own face.
         */
        (layer === 0 && network.onLane(col - 1, row) ? TRAIT.laneWest : 0) |
        (layer === 0 && network.onLane(col + 1, row) ? TRAIT.laneEast : 0) |
        (Math.abs(layer) === 1 && network.onLane(col, row) ? TRAIT.laneBehind : 0) |
        (grounded ? TRAIT.grounded : 0),
    });
    byCorp.set(cell.corp, list);
  }

  const colonies: ColonyProp[] = [];
  for (const [corp, list] of byCorp) {
    if (list.length === 0) continue;
    // Stable order regardless of Map iteration, so two runs of the same seed emit
    // identical props — determinism is load-bearing here, not a nicety.
    list.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
    const half = COLONY_CELL_SIZE / 2;
    /**
     * The footprint and vertical span are the **play plane's**, not the whole mass's.
     *
     * Everything downstream of these two is a 2D question about the canyon the player
     * flies down — `Layout.ts`'s rules, the debug readout, the corp's reported extent —
     * and the layers in front of and behind the play plane are scenery with no colliders.
     * Letting a cell three layers back widen the reported footprint would report ground
     * claimed where nothing stands in the way.
     */
    const face = list.filter((c) => c.z === 0);
    const xs = (face.length > 0 ? face : list).map((c) => c.x);
    const ys = (face.length > 0 ? face : list).map((c) => c.y);
    colonies.push({
      kind: 'colony',
      corp,
      cellSize: COLONY_CELL_SIZE,
      cells: list,
      footprintX: [Math.min(...xs) - half, Math.max(...xs) + half],
      spanY: [Math.min(...ys) - half, Math.max(...ys) + half],
    });
  }
  colonies.sort((a, b) => a.corp.localeCompare(b.corp));

  return { colonies, lattice, substrate, network };
}
