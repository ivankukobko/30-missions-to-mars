import { hash01 } from './Noise.ts';
import type { CorpId } from './CanyonSpec.ts';
import type { Lattice } from './ColonyLattice.ts';
import type { SubstrateField } from './ColonySubstrate.ts';

/**
 * The organism. Three colonies grow as branching filaments across the canyon's rock,
 * competing for the same substrate, in one interleaved simulation.
 *
 * Pure: no terrain sampling, no pads, no missions, no corp lore. Substrate in, forbidden
 * cells in, spores in, cell budgets in — cells out. Everything this file decides comes
 * out of five local behaviours a tip has (score neighbours, prefer substrate, seek its
 * own hardware, avoid a rival, branch or die), which is the whole point of replacing the
 * previous model: that one decided each cell with an independent distance-weighted coin
 * flip, so the output had no parts and no build order, and every shape problem had to be
 * answered with another global term compensating for the last one.
 *
 * **Growth order is the campaign clock.** Cells come out numbered in the order they were
 * colonised, and a corp's budget is simply how many of them it has built by now. A later
 * mission runs the same sequence further, so a colony can only ever be *older* — it
 * never re-rolls into a different shape. That is the whole maturity model; there is no
 * distance-to-anchor reach formula any more.
 *
 * **Support is what lets it leave the ground.** A cell may be built if the cell below it
 * is rock or already built, *or* it touches a rock face, *or* two of its neighbours are
 * already built. Not "the cell below is occupied", which is the rule that forced the old
 * model to be a floor-standing mass with level rows. A filament can therefore climb a
 * wall and terrace along a bench, but it can never bridge open air horizontally — so it
 * can never roof over a flight channel it is forbidden from entering.
 */

/** Which neighbours a cell is joined to, as a bitmask — this is what the renderer reads
 *  to decide whether a cell is an end pod, a straight can, an elbow or a hub, and where
 *  to draw a walkway. */
export const LINK = { east: 1, west: 2, up: 4, down: 8 } as const;

export interface OrganismCell {
  corp: CorpId;
  /** 0-based position in this corp's own build order — see the doc comment above. */
  order: number;
  links: number;
}

/**
 * One built cell in world space, which is all anything downstream of generation needs —
 * the renderer, the colliders and `Layout.ts` all work in world units, so the lattice
 * stops at the boundary of this module rather than leaking onward the way the previous
 * model's column arithmetic did.
 */
export interface PlacedCell {
  /** Cell centre. */
  x: number;
  y: number;
  /** `LINK` bitmask — which neighbours this cell is joined to. */
  links: number;
  /** Part of the growing edge: drawn as bare frame, built hull next mission. */
  scaffold: boolean;
}

export interface Spore {
  corp: CorpId;
  col: number;
  row: number;
}

export interface GrowthInput {
  lattice: Lattice;
  substrate: SubstrateField;
  /** Cells no colony may ever enter: flight channels and pad decks. Checked before
   *  anything else, so safety is a property of the simulation rather than something
   *  checked afterwards and patched. */
  forbidden: (col: number, row: number) => boolean;
  spores: Spore[];
  /** How many cells each corp has built by this point in the campaign. */
  budget: Record<CorpId, number>;
  /** World positions of each corp's own hardware — its pads. A colony grows toward the
   *  things it services, which is what replaced a hand-authored "reach toward the canyon
   *  centre" bias with a reason. */
  attractors: Partial<Record<CorpId, Array<{ x: number; y: number }>>>;
  /**
   * Per-corp gravity: the point a colony leans toward as it grows, weighted by `W_APEX`.
   * Defaults to the top centre of the lattice. A corp on the canyon floor wants the
   * canyon's *own* bottom centre instead — see `ColonyPlan`, which is the only thing that
   * knows where the canyon actually is.
   */
  apex?: Partial<Record<CorpId, { x: number; y: number }>>;
  /**
   * Per-corp shape. `lateral` scales the preference for spreading sideways, `height` the
   * cost of climbing — both multipliers on the shared weights, both defaulting to 1.
   *
   * `gravity` scales `W_APEX`, the pull toward that corp's own `apex` point.
   *
   * What this is for: a corp does not choose its silhouette, its ground does. Ixion sits
   * on the canyon floor between every route it serves and simply has no width available;
   * asking it to spread is asking it to fail. Told to climb narrow instead, the same
   * squeeze reads as a pine rather than a stump. It also needs a much stronger pull to its
   * own centre than the wall corps do: with everyone on the default it drifted toward
   * whichever side had room and ended up 32 units off the canyon's middle, leaning into
   * Helion's ground.
   */
  shape?: Partial<Record<CorpId, { lateral?: number; height?: number; gravity?: number }>>;
  seed: number;
  /**
   * What these colonies had already built, from the previous mission. Growth *continues*
   * from here rather than starting over: this is what makes a colony something that can
   * only ever be extended, and it is the whole reason `ColonyPlan` walks the campaign
   * forward instead of deriving one mission in isolation.
   *
   * A cell that is now rock or now inside a flight channel is dropped rather than kept —
   * a route is absolute and a new pad's approach genuinely demolishes what stood in it.
   * That is the one way a colony can lose ground, and it is meant to be visible.
   */
  existing?: Map<number, OrganismCell>;
}

const DIRS = [
  { dc: 1, dr: 0, link: LINK.east, back: LINK.west },
  { dc: -1, dr: 0, link: LINK.west, back: LINK.east },
  { dc: 0, dr: 1, link: LINK.up, back: LINK.down },
  { dc: 0, dr: -1, link: LINK.down, back: LINK.up },
] as const;

/**
 * Scoring weights. Deliberately few and each one a behaviour you can name, rather than
 * the six mutually-compensating noise terms this replaced.
 */
const W_SURFACE = 1.0; // creep along rock rather than across a void (thigmotropism)
const W_ATTRACT = 0.85; // grow toward this corp's own pads
const W_STRAIGHT = 0.3; // a filament tends to keep going the way it was going
const W_RIVAL = 0.7; // give a competing colony a visible seam instead of interleaving
const W_JITTER = 0.75; // enough that two seeds diverge, not so much it overrides the rest
/**
 * Gravity, in effect: a colony fills the ground it has before it climbs.
 *
 * Without this a filament that reaches a wall face never comes back down — every cell up
 * a rock face is `surface` and scores the full substrate bonus, while a lateral move
 * across open floor scores nothing, so a colony that touched a wall early ran straight
 * up it and read as a vine rather than a settlement (measured: 4 columns wide, all 20
 * rows tall, on the first seeds checked).
 *
 * **Quadratic in height, not linear.** Linear was tried and is the wrong shape: any
 * constant per-row cost either kills terracing a few rows up the wall (which is the look
 * this whole model exists for) or is small enough that a determined filament still pays
 * it all the way to the rim. Squared, the first few rows are nearly free and the last few
 * are unaffordable, which is both the behaviour wanted and what building actually costs.
 *
 * Sized against `W_JITTER`, not chosen for feel: the cost only bites where its gradient
 * outruns what a lucky roll can pay for, so at 2.4 a well-rolled filament still reached
 * row 18 of 20 on a bare cliff with no attractor pulling it home (seed 1, measured). At
 * 4.0 the ceiling lands around 70% of the lattice height — most of the wall, which is
 * the point, without anything cresting the rim.
 */
const W_HEIGHT = 4.0;

/**
 * The pull toward the top centre of the lattice — what makes two colonies on opposite
 * walls lean *in* toward each other over the canyon as they rise, rather than each
 * standing up its own side as a separate tower.
 *
 * Plays against `W_HEIGHT` rather than replacing it: the height cost still decides how
 * high a colony gets, this decides which way it leans on the way up. The horizontal half
 * of the pull is unopposed, so the lean shows long before the climb does.
 */
const W_APEX = 0.55;

/**
 * A plain preference for growing sideways.
 *
 * Needed because every other term quietly favours *up*. A cell above the tip stands on
 * its own roof and collects the full substrate bonus; a cell beside it usually stands on
 * nothing and collects none. `W_APEX` pulls toward the top centre, which is up as well as
 * inward. Even with cantilever making a sideways arm *legal*, none of that made it
 * attractive, and colonies kept coming out four times taller than wide (width/height 0.27
 * median across six seeds). This is the counterweight, and it is a plain constant rather
 * than a rule because there is nothing clever to say: a settlement spreads.
 */
const W_LATERAL = 0.7;

/**
 * How far a run of structure may reach with nothing under it before it needs a leg.
 *
 * The rule that produces sideways branches at all. Support otherwise means rock, ground,
 * your own roof, or two neighbours — and the top cell of a strand has none of those to
 * either side, so the *only* legal move it ever has is straight up. That is exactly what
 * it did: the canyon filled with one-cell-wide poles. Two bays of cantilever is a bracket
 * an engineer would actually build, and it is enough for an arm to leave a strand, find
 * ground or another arm, and become a loop.
 */
const MAX_CANTILEVER = 2;

/**
 * A tip stops rather than taking the least-bad move available.
 *
 * The rule that actually bounds a colony's height, and the one whose absence was
 * measured: a tip on a rock face has exactly two candidates, up and the parent it came
 * from, so "always take the best" meant "always climb", and colonies ran the full 20
 * rows to the canyon rim as one-column strands however hard the height penalty pushed
 * back. Growth that has run out of *good* ground stopping is both how an organism
 * behaves and how a construction budget behaves.
 */
const MIN_SCORE = -0.3;

/** A tip stops after this many moves. Bounded growth without a distance clamp: a colony
 *  that runs out of tips re-buds from somewhere it already stands (see `rebud`). */
const TIP_LIFE = 22;
/** Chance a tip splits after a move. Branching and dead-ending are where every bit of
 *  shape variety now comes from. */
const BRANCH_CHANCE = 0.3;
/** Live tips per corp. A crew is finite, and this is what keeps a step cheap. */
const MAX_TIPS = 12;
/** Tips a colony carried over from the previous mission restarts with. More than one so
 *  a season's growth opens on several fronts rather than extruding a single arm. */
const RESUME_TIPS = 3;
/** Safety stop. A corp normally reaches its budget long before this. */
const MAX_STEPS = 600;

/** So two corps whose situations happen to mirror each other across the canyon don't
 *  roll identical jitter and grow as each other's reflection. Arbitrary; only needs to
 *  be distinct per corp. */
const CORP_SALT: Record<CorpId, number> = { outpost: 0, helion: 4001, kessler: 8009 };

interface Tip {
  col: number;
  row: number;
  corp: CorpId;
  life: number;
  lastDir: number;
}

export function growColony(input: GrowthInput): Map<number, OrganismCell> {
  const {
    lattice,
    substrate,
    forbidden,
    spores,
    budget,
    attractors,
    apex: apexFor = {},
    shape = {},
    seed,
    existing,
  } = input;
  const cells = new Map<number, OrganismCell>();
  const tips = new Map<CorpId, Tip[]>();
  const built = new Map<CorpId, number>();
  /** Per cell, how far it sits from something that carries load — see `reachOf`. */
  const reach = new Map<number, number>();

  /** Where each colony leans. The lattice's top centre unless a caller says otherwise. */
  const defaultApex = {
    x: lattice.worldX((lattice.colLo + lattice.colHi) / 2),
    y: lattice.worldY(lattice.rows - 1),
  };
  const apexOf = (corp: CorpId): { x: number; y: number } => apexFor[corp] ?? defaultApex;

  const at = (col: number, row: number): OrganismCell | undefined =>
    lattice.inBounds(col, row) ? cells.get(lattice.index(col, row)) : undefined;

  /** Distance from a cell to the nearest piece of this corp's own hardware, in cells.
   *  Only ever compared against itself one step away, so an exact metric would buy
   *  nothing over this. */
  /** Distance to this corp's own gravity point, in world units — see `W_APEX`. */
  function apexPull(corp: CorpId, col: number, row: number): number {
    const apex = apexOf(corp);
    return Math.hypot(apex.x - lattice.worldX(col), apex.y - lattice.worldY(row));
  }

  function pull(corp: CorpId, col: number, row: number): number {
    const targets = attractors[corp];
    if (!targets || targets.length === 0) return 0;
    const x = lattice.worldX(col);
    const y = lattice.worldY(row);
    let best = Infinity;
    for (const t of targets) best = Math.min(best, Math.hypot(t.x - x, t.y - y));
    return best / lattice.cellSize;
  }

  /**
   * The no-floating rule, as a *reach*: how far this cell would sit from something that
   * genuinely carries load. `0` means it stands on rock, on the ground, or on its own
   * roof; higher numbers are cantilever, and anything past `MAX_CANTILEVER` is refused.
   * `null` means unsupported outright.
   *
   * Deliberately more permissive than "the cell below is occupied" — that rule is what
   * forced the old model into level floor-standing rows, and its slightly-looser cousin
   * ("below, or against rock, or two neighbours") still left a strand with no legal move
   * but upward. Allowing a bounded reach is what lets an arm leave a strand sideways.
   */
  function reachOf(col: number, row: number): number | null {
    if (substrate.isSolid(col, row - 1) || at(col, row - 1)) return 0;
    for (const d of DIRS) {
      if (substrate.isSolid(col + d.dc, row + d.dr)) return 0;
    }
    const neighbours: number[] = [];
    for (const d of DIRS) {
      const n = at(col + d.dc, row + d.dr);
      if (n) neighbours.push(reach.get(lattice.index(col + d.dc, row + d.dr)) ?? 0);
    }
    if (neighbours.length === 0) return null;
    // Two supports share the load, so a span between them counts as one step from the
    // *better* of the two rather than accumulating along the weaker arm.
    const from = neighbours.length >= 2 ? Math.min(...neighbours) : neighbours[0];
    const next = from + 1;
    return next <= MAX_CANTILEVER ? next : null;
  }

  function rivals(corp: CorpId, col: number, row: number): number {
    let n = 0;
    for (const d of DIRS) {
      const other = at(col + d.dc, row + d.dr);
      if (other && other.corp !== corp) n++;
    }
    return n;
  }

  function claim(corp: CorpId, col: number, row: number, cellReach: number): void {
    const order = built.get(corp) ?? 0;
    cells.set(lattice.index(col, row), { corp, order, links: 0 });
    reach.set(lattice.index(col, row), cellReach);
    built.set(corp, order + 1);
  }

  /**
   * Every legal move from a cell, best first. A candidate is rejected outright — never
   * merely penalised — for being out of bounds, rock, forbidden, already claimed, or
   * unsupported, so no weight tuning can ever talk the organism into a channel.
   */
  function candidates(
    tip: Tip,
    step: number,
  ): Array<{ col: number; row: number; link: number; back: number; score: number; reach: number }> {
    const here = pull(tip.corp, tip.col, tip.row);
    /**
     * The pull toward a corp's own hardware fades once it has arrived. Without this a
     * colony that reaches its own pad is trapped: the pad and its channel are forbidden,
     * so every remaining move is *away* from the attractor, scores negative, and the
     * whole colony stops dead a couple of cells in — measured, and the reason Ixion
     * (which sits in the middle of the canyon, surrounded by its own pads' channels)
     * built two cells and nothing else from mission 8 onward.
     */
    const homeward = Math.min(1, here / 6);
    const scored: Array<{ col: number; row: number; link: number; back: number; score: number; reach: number }> = [];
    for (const d of DIRS) {
      const col = tip.col + d.dc;
      const row = tip.row + d.dr;
      if (!lattice.inBounds(col, row)) continue;
      if (substrate.isSolid(col, row)) continue;
      if (forbidden(col, row)) continue;
      if (at(col, row)) continue;
      const cellReach = reachOf(col, row);
      if (cellReach === null) continue;
      // Rock *or its own roof*: adding a storey to what it already built is ordinary
      // construction and should not score as badly as reaching into open air. Without
      // this a colony squeezed off the floor by its own pads' channels — Ixion, which
      // sits in the middle of the canyon surrounded by them — has no scoring move left
      // anywhere and stops at a handful of cells.
      const footing = substrate.at(col, row) === 'surface' || at(col, row - 1)?.corp === tip.corp;
      const score =
        W_SURFACE * (footing ? 1 : 0) +
        W_ATTRACT * homeward * (here - pull(tip.corp, col, row)) +
        W_LATERAL * (shape[tip.corp]?.lateral ?? 1) * (d.dr === 0 ? 1 : 0) +
        W_STRAIGHT * (d.link === tip.lastDir ? 1 : 0) -
        W_HEIGHT * (shape[tip.corp]?.height ?? 1) * (row / lattice.rows) ** 2 -
        W_RIVAL * rivals(tip.corp, col, row) +
        W_APEX *
          (shape[tip.corp]?.gravity ?? 1) *
          ((apexPull(tip.corp, tip.col, tip.row) - apexPull(tip.corp, col, row)) / lattice.cellSize) +
        W_JITTER * hash01(seed + CORP_SALT[tip.corp], lattice.index(col, row), step, 1);
      scored.push({ col, row, link: d.link, back: d.back, score, reach: cellReach });
    }
    return scored.sort((a, b) => b.score - a.score);
  }

  /** Whether a tip has anywhere worth going, as opposed to merely somewhere legal. */
  const viable = (options: Array<{ score: number }>): boolean =>
    options.length > 0 && options[0].score >= MIN_SCORE;

  /**
   * A corp whose tips have all died starts a new one from somewhere it already stands —
   * the latest-built cell that still has somewhere *worth* going (`viable`, not merely
   * legal), so a colony resumes at its live edge rather than back at the spore — and
   * never resumes at the top of a strand it just stopped climbing for good reason.
   * Without a rebud at all, a single dead end early on would freeze a colony far short of
   * its budget for the rest of the campaign, which is exactly the "one side of the canyon
   * built nothing that mission" failure the previous model kept producing from a
   * different cause.
   */
  function budTips(corp: CorpId, step: number, count: number): Tip[] {
    const viableCells: Array<{ index: number; order: number }> = [];
    for (const [index, cell] of cells) {
      if (cell.corp !== corp) continue;
      const col = lattice.colOf(index);
      const row = lattice.rowOf(index);
      if (!viable(candidates({ col, row, corp, life: 1, lastDir: 0 }, step))) continue;
      viableCells.push({ index, order: cell.order });
    }
    viableCells.sort((a, b) => b.order - a.order);
    return viableCells.slice(0, count).map(({ index }) => ({
      col: lattice.colOf(index),
      row: lattice.rowOf(index),
      corp,
      life: TIP_LIFE,
      lastDir: 0,
    }));
  }

  const corps: CorpId[] = [];

  /**
   * Carry the previous mission's colonies forward, minus anything the world has since
   * made impossible. Each surviving corp restarts from its own most recently built cells
   * (`RESUME_TIPS` of them) rather than from its original spore, so growth continues at
   * the live edge — which is also what keeps the scaffold frontier moving outward instead
   * of reappearing in the middle of finished structure.
   */
  if (existing) {
    for (const [index, cell] of existing) {
      const col = lattice.colOf(index);
      const row = lattice.rowOf(index);
      if (!lattice.inBounds(col, row)) continue;
      if (substrate.isSolid(col, row) || forbidden(col, row)) continue; // demolished
      cells.set(index, { ...cell });
      // Carried-forward cells are load-bearing by the fact that they are standing: their
      // own reach was checked the mission they were built, and nothing has been removed
      // from under them (growth is strictly additive — see `ColonyPlan`).
      reach.set(index, 0);
      built.set(cell.corp, Math.max(built.get(cell.corp) ?? 0, cell.order + 1));
    }
    for (const corp of built.keys()) {
      corps.push(corp);
      tips.set(corp, budTips(corp, 0, RESUME_TIPS));
    }
  }

  for (const spore of spores) {
    if (corps.includes(spore.corp)) continue; // already standing — no second spore
    if (!lattice.inBounds(spore.col, spore.row)) continue;
    if (substrate.isSolid(spore.col, spore.row) || forbidden(spore.col, spore.row)) continue;
    if (at(spore.col, spore.row)) continue; // a rival got here first
    claim(spore.corp, spore.col, spore.row, 0);
    tips.set(spore.corp, [{ col: spore.col, row: spore.row, corp: spore.corp, life: TIP_LIFE, lastDir: 0 }]);
    corps.push(spore.corp);
  }

  // One step advances every live tip of every corp once, in a stable order — the corps
  // are interleaved rather than run one after another, which is what makes a cell go to
  // whoever actually reaches it first and deletes the whole ordered-claim/territory-
  // buffer machinery the previous model needed to keep three sequential runs apart.
  for (let step = 0; step < MAX_STEPS; step++) {
    let active = false;
    for (const corp of corps) {
      if ((built.get(corp) ?? 0) >= budget[corp]) continue;
      let live = tips.get(corp) ?? [];
      if (live.length === 0) {
        live = budTips(corp, step, 1);
        if (live.length === 0) continue; // nowhere left to build — contained, not an error
      }
      active = true;

      const next: Tip[] = [];
      for (const tip of live) {
        if ((built.get(corp) ?? 0) >= budget[corp]) {
          next.push(tip);
          continue;
        }
        const options = candidates(tip, step);
        if (!viable(options) || tip.life <= 0) continue; // tip dies

        const move = options[0];
        claim(corp, move.col, move.row, move.reach);
        tip.col = move.col;
        tip.row = move.row;
        tip.lastDir = move.link;
        tip.life--;
        next.push(tip);

        const room = next.length + 1 <= MAX_TIPS;
        const branch = hash01(seed + CORP_SALT[corp], lattice.index(move.col, move.row), step, 2) < BRANCH_CHANCE;
        if (room && branch && options.length > 1 && (built.get(corp) ?? 0) < budget[corp]) {
          const side = options[1];
          if (!at(side.col, side.row)) {
            claim(corp, side.col, side.row, side.reach);
            next.push({ col: side.col, row: side.row, corp, life: Math.round(TIP_LIFE * 0.7), lastDir: side.link });
          }
        }
      }
      tips.set(corp, next);
    }
    if (!active) break;
  }

  /**
   * Links, resolved once at the end rather than maintained as cells are claimed.
   *
   * They are the same thing either way — a cell always fused with every same-corp cell it
   * touched (real hyphae anastomose, and the loops that puts in the network are what stop
   * a colony reading as a bare tree), so the link set was never anything but same-corp
   * orthogonal adjacency. Computing it here instead of incrementally means a colony
   * carried forward from a previous mission needs no link repair when a cell is
   * demolished out from under its neighbours: the answer is simply recomputed from who is
   * actually still standing.
   */
  for (const [index, cell] of cells) {
    const col = lattice.colOf(index);
    const row = lattice.rowOf(index);
    let links = 0;
    for (const d of DIRS) {
      if (at(col + d.dc, row + d.dr)?.corp === cell.corp) links |= d.link;
    }
    cell.links = links;
  }

  return cells;
}
