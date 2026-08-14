import type { Prop } from '../world/Colony.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import { CORPS, type CorpId } from '../world/CanyonSpec.ts';
import { buildLattice, COLONY_CELL_SIZE, COLONY_ROWS, type Lattice, type LatticeTerrain } from '../world/ColonyLattice.ts';
import { buildSubstrate, type SubstrateField, type SubstrateTerrain } from '../world/ColonySubstrate.ts';
import { growColony, type OrganismCell, type PlacedCell, type Spore } from '../world/ColonyOrganism.ts';
import { buildChannels, type ChannelNetwork, type ChannelTerrain } from './ColonyChannels.ts';
import type { Rank } from './Progress.ts';
import { MISSIONS, worldAt } from './Missions.ts';
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

/** 0–3, so an average of several ranks is a plain number rather than a string compare. */
const RANK_VALUE: Record<Rank, number> = { C: 0, B: 1, A: 2, S: 3 };

/**
 * How many cells a corp has built, from where it stands in its own mission sequence and
 * how well those missions went. Both terms only ever rise as the campaign progresses and
 * as `Progress.complete` raises stored ranks, and the organism builds in a fixed order —
 * so a later mission runs the same sequence further and a colony can only ever be
 * *older*, never a different shape. That is the entire maturity model.
 */
function cellBudget(maturity: number, quality: number): number {
  return Math.round(8 + 62 * maturity + 16 * quality);
}

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
): Spore | null {
  const west = terrain.floorEdgeAt(0, -1);
  const east = terrain.floorEdgeAt(0, 1);
  const preferred =
    corp === 'helion' ? lattice.colAt(west) : corp === 'kessler' ? lattice.colAt(east) : lattice.colAt((west + east) / 2);
  /**
   * How far a corp may wander from home looking for ground. A wall corp can range along
   * its own wall; **Ixion cannot**, because the roomiest ground in the canyon is whichever
   * wall is least built on, and given the freedom Ixion walks straight over to it and
   * takes the ground Helion was going to root in. Observed exactly that: Ixion spread
   * across the west side and Helion had nowhere to go.
   */
  const range = corp === 'outpost' ? OUTPOST_RANGE : maxStep;

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
      if (step > maxStep) continue;
      for (const col of step === 0 ? [preferred] : [preferred - step, preferred + step]) {
        if (!lattice.inBounds(col, row)) continue;
        if (substrate.at(col, row) !== 'surface') continue;
        if (network.blocked(col, row)) continue;
        const index = lattice.index(col, row);
        if (taken.has(index)) continue;
        if (!hasRoom(col, row, lattice, substrate, network)) continue;
        candidates.push({ spore: { corp, col, row }, room: roomAround(col, row, lattice, substrate, network), cost });
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
export function missionWorlds(
  mastX: number | null,
  mastY: number | null,
  terrain: PlanTerrain,
): (missionId: number) => MissionWorld {
  const cache = new Map<number, MissionWorld>();
  return (missionId) => {
    const hit = cache.get(missionId);
    if (hit) return hit;
    const world = worldAt(missionId, mastX, mastY);
    const resolved = resolveTerrainAnchoredDigs(world.digs, terrain);
    const out: MissionWorld = {
      props: applyDigAttachments(world.props, resolved.endpoints),
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
  ranks: Readonly<Record<string, Rank>>,
  seed: number,
  terrain: PlanTerrain,
): ColonyPlan {
  const lattice = buildLattice(terrain, COLONY_CELL_SIZE, COLONY_ROWS);
  const substrate = buildSubstrate(terrain, lattice);

  /**
   * **Every route the campaign will ever have, reserved from mission one.**
   *
   * The alternative — reserving only the routes that exist by the mission being loaded —
   * is what makes a colony shrink, and no amount of tuning fixes it, because the cause is
   * a genuine conflict rather than a bug: a colony is drawn toward its own corp's pads
   * (`attractors`), so it builds densely exactly where that corp's *next* pad is going to
   * go, and that pad's route then demolishes what it just built. Measured across three
   * seeds × thirty missions: twelve demolitions, one of them taking Ixion's entire
   * sixteen-cell colony to nothing at mission 2.
   *
   * Reserving the whole network up front costs one rasterisation and makes the guarantee
   * structural: the forbidden set never grows, growth only ever adds, so a colony can
   * never lose a cell. What it buys with is a permanent gap where a future pad's approach
   * will be — which is not something a player can read as anything but canyon, and is a
   * good deal cheaper than watching a settlement get bulldozed between two missions.
   *
   * Deliberately keyed on pads by `id` rather than the current ledger: a pad
   * decommissioned partway through the campaign keeps its route reserved for good. The
   * route was flown, the ground stayed clear, and un-reserving it would reintroduce
   * exactly the shrink this exists to prevent.
   */
  const everyPad = new Map<string, Prop>();
  const everyDig: Excavation[] = [];
  for (let m = 1; m <= MISSIONS.length; m++) {
    const world = worldFor(m);
    for (const p of world.props) {
      if (p.kind === 'pad' && !everyPad.has(p.id)) everyPad.set(p.id, p);
    }
    for (const d of world.digs) {
      if (!everyDig.some((x) => Math.abs(x.x - d.x) < 0.5 && Math.abs(x.depth - d.depth) < 0.5)) everyDig.push(d);
    }
  }
  const network = buildChannels([...everyPad.values()], everyDig, lattice, substrate, terrain);

  let cells = new Map<number, OrganismCell>();

  for (let m = 1; m <= id; m++) {
    const world = worldFor(m);
    const spores: Spore[] = [];
    const budget = {} as Record<CorpId, number>;
    const attractors: Partial<Record<CorpId, Array<{ x: number; y: number }>>> = {};
    const taken = new Set(cells.keys());

    for (const corp of Object.keys(CORPS) as CorpId[]) {
      const corpMissions = MISSIONS.filter((x) => x.client === corp);
      const first = corpMissions[0];
      if (!first || first.id > m) continue; // this corp hasn't started yet

      const elapsed = corpMissions.filter((x) => x.id <= m);
      const maturity = elapsed.length / corpMissions.length;
      const graded = elapsed.map((x) => ranks[String(x.id)]).filter((r): r is Rank => r != null);
      const quality =
        graded.length === 0 ? 0 : graded.reduce((sum, r) => sum + RANK_VALUE[r], 0) / graded.length / RANK_VALUE.S;

      budget[corp] = cellBudget(maturity, quality);
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
       * is strictly additive that corp is then stuck with its bad start for the rest of
       * the campaign. Tuning where the first spore lands only moves which seeds it happens
       * on — every ordering tried starved a different corp on a different seed. Letting a
       * starved colony put out a second nucleus fixes the whole class, and it is what a
       * colony under pressure actually does. It cannot break the never-shrink guarantee,
       * because a spore only ever adds a cell.
       */
      const standing = [...cells.values()].filter((c) => c.corp === corp).length;
      if (standing >= budget[corp] * STARVED) continue;
      const spore = sporeFor(
        corp,
        lattice,
        substrate,
        network,
        terrain,
        taken,
        standing === 0 ? Math.round(lattice.cols / 3) : lattice.cols,
      );
      if (spore) spores.push(spore);
    }

    cells = growColony({
      lattice,
      substrate,
      forbidden: network.blocked,
      spores,
      budget,
      attractors,
      // Ixion is the outpost on the canyon floor, so its gravity is the canyon's own
      // bottom centre rather than the lattice's top centre the wall corps lean toward.
      // The canyon's middle wanders by seed, so this is measured, not world x=0.
      apex: {
        outpost: {
          x: (terrain.floorEdgeAt(0, -1) + terrain.floorEdgeAt(0, 1)) / 2,
          y: lattice.worldY(0),
        },
      },
      // Ixion grows as a pine: the floor between the routes is all the width it will ever
      // have, so it spends its budget upward instead of starving against the sides.
      shape: { outpost: { lateral: 0.2, height: 0.4 } },
      seed,
      existing: cells,
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
  for (const [index, cell] of cells) {
    const total = built.get(cell.corp) ?? 0;
    const list = byCorp.get(cell.corp) ?? [];
    list.push({
      x: lattice.worldX(lattice.colOf(index)),
      y: lattice.worldY(lattice.rowOf(index)),
      links: cell.links,
      scaffold: cell.order >= total - frontierCount(total),
    });
    byCorp.set(cell.corp, list);
  }

  const colonies: ColonyProp[] = [];
  for (const [corp, list] of byCorp) {
    if (list.length === 0) continue;
    // Stable order regardless of Map iteration, so two runs of the same seed emit
    // identical props — determinism is load-bearing here, not a nicety.
    list.sort((a, b) => a.x - b.x || a.y - b.y);
    const half = COLONY_CELL_SIZE / 2;
    const xs = list.map((c) => c.x);
    const ys = list.map((c) => c.y);
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
