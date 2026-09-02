import { hash01 } from './Noise.ts';
import type { CorpId } from './CanyonSpec.ts';
import { COLONY_LAYERS as LAYERS, type Lattice, type Layer } from './ColonyLattice.ts';
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

/**
 * What a cell's *surroundings* are, as opposed to what it is joined to — the second thing
 * the renderer is allowed to vary a structure on.
 *
 * A bitmask like `LINK`, and for the same reason: a cell can be several of these at once
 * (a face onto the approach lane that is also a rival seam), so an enum would force a
 * priority order nobody has a reason to pick, and picking one wrong is a silent loss of
 * the other fact rather than an error.
 *
 * **Set by `ColonyPlan`, never here and never by the renderer.** Growth decides where a
 * colony goes and knows nothing about routes beyond `forbidden`; these are read off the
 * settled cell set and the network it was grown against, in one pass, at the point where
 * determinism is already guaranteed. That keeps the renderer's own rule intact — it reads
 * facts the simulation produced, it does not form a second opinion about what a cell is.
 */
export const TRAIT = { laneWest: 1, laneEast: 2, laneBehind: 4, grounded: 8 } as const;

/**
 * Fronting a lane on either side.
 *
 * The two sides are separate bits rather than one `routeFront` flag because a lamp that
 * marks a route has to be mounted on the face the route actually runs past — a light on
 * the camera-facing side tells a pilot inside the lane nothing, since that face is edge-on
 * to them. Which side is therefore not decoration, it is the whole content of the fact.
 *
 * Both bits at once is legitimate and means a cell with lanes to east and west — a pillar
 * between two approaches, lit on both flanks.
 */
export const LANE = TRAIT.laneWest | TRAIT.laneEast | TRAIT.laneBehind;

/**
 * `laneBehind` is the cell's *own* column being a lane, which only an outer layer can be:
 * growth bars the play plane from a channel (`layer === 0 && forbidden(...)`) and bars
 * nothing else, so the layers front and back build straight through one.
 *
 * That makes those cells the wall a pilot is flying *at* while they are in the channel —
 * the single most valuable surface in the colony for navigation, and until now the only
 * unlit one. They take a camera-facing panel rather than a flank vane, because "beside the
 * lane" and "at the end of it" are seen from completely different angles.
 *
 * A cell can hold this and a flank bit at once, and gets both fittings, each square to its
 * own face. No attempt is made to blend the pair into some diagonal compromise: two
 * fittings that each face the right way read better than one facing neither, and the
 * diagonal case is rare enough that it would be tuning nobody could see.
 */

export interface OrganismCell {
  corp: CorpId;
  /** 0-based position in this corp's own build order — see the doc comment above. */
  order: number;
  links: number;
  /**
   * How many steps of cantilever this cell was built on — `reachOf`'s own answer, frozen
   * at the moment the cell was claimed. `0` is rock, ground, or the corp's own roof
   * directly under it; `MAX_CANTILEVER` is as far from anything load-bearing as growth is
   * ever allowed to reach.
   *
   * Kept rather than only used to decide legality, because it is the one fact the
   * simulation already has that answers "how far is this from the ground or the wall" —
   * which is a question about the *cell*, permanently, not about this mission's frontier.
   * The scratch `reach` map in `growColony` answers a different question (is this cell
   * legal footing for something new *this mission*) and forces every carried-forward cell
   * to 0 for that purpose; a mast built two missions ago must not read as a tank the
   * moment it stops being the growing edge, so its own history has to survive the mission
   * boundary on the cell object rather than in that map. See `growColony`'s `existing`
   * branch, which carries it forward by spreading the old cell rather than recomputing it.
   */
  reach: number;
}

/**
 * Moves between layers, which the `LINK` mask deliberately does not describe.
 *
 * A link is what the renderer reads to pick a module shape and to draw a walkway, and
 * both of those are decisions about the *face* of the colony — a connection running away
 * from the camera has no silhouette to contribute and no walkway anyone can see. Depth is
 * volume, not more of the same drawing.
 */
const DEPTH_DIRS = [
  { dc: 0, dr: 0, dl: 1 },
  { dc: 0, dr: 0, dl: -1 },
] as const;

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
  /** Cell centre in depth. Zero is the play plane — the only layer that gets colliders,
   *  and the only one `Layout.ts` judges. See `COLONY_LAYERS`. */
  z: number;
  /** `LINK` bitmask — which neighbours this cell is joined to. */
  links: number;
  /** Part of the growing edge: drawn as bare frame, built hull next mission. */
  scaffold: boolean;
  /** `TRAIT` bitmask — what this cell's surroundings are. */
  traits: number;
  /** Cantilever steps from rock, ground or this corp's own roof — `0` is standing on one
   *  of them directly. See `OrganismCell.reach`, which this is copied from unchanged; the
   *  renderer reads it to decide how far a structure has reached from what holds it up. */
  reach: number;
}

/** One candidate column of cells that would hold a deck up, ordered bottom-up. */
export type SpineColumn = Array<{ col: number; row: number }>;

/**
 * One raised deck and the ways a colony could get under it.
 *
 * Alternatives rather than a single column because the obvious column is routinely
 * unavailable and giving up on it leaves the deck in the sky. Measured on the first
 * implementation, which tried only the deck's own column: Helion's ran straight into a
 * flight channel along the canyon floor, and Kessler's hit an Ixion cell one row up.
 * Neither is a reason the deck cannot be held up — both are a reason to stand the column
 * a cell to one side and reach back.
 */
export interface SpineTarget {
  /** The column directly under the deck — where the bracket is trying to get to. */
  centre: number;
  /** The highest row support may occupy: one below the deck's own, which is `forbidden`. */
  top: number;
  /** Candidate columns, nearest the deck's axis first. */
  columns: SpineColumn[];
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
   * Per-corp gravity: the points a colony leans toward as it grows, weighted by `W_APEX`.
   * Defaults to the top centre of the lattice.
   *
   * **A set rather than a single point**, because a colony has more than one reason to
   * lean. It wants the open middle of the canyon, and it wants to get *under its own
   * elevated pads* — a deck bolted to structure at row 12 is a place the corp has to
   * build up to, and saying so here is what puts scaffolding beneath it. The pull is to
   * the nearest of them, so the points compete locally rather than averaging into a
   * direction that satisfies neither.
   *
   * Which points those are is `ColonyPlan`'s business — it is the only thing that knows
   * where the canyon is and which pads are standing in mid-air.
   */
  apex?: Partial<Record<CorpId, Array<{ x: number; y: number }>>>;
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
  shape?: Partial<Record<CorpId, { lateral?: number; height?: number; gravity?: number; depth?: number }>>;
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
  /**
   * Cells a corp builds **before** anything else, bottom-up and charged to its budget:
   * the column under each of its own decks that stands in open air.
   *
   * A raised deck is the one structure a charter cannot grow toward at its leisure — it
   * is load-bearing from the mission it appears, and until something reaches it the deck
   * is a slab hanging in the sky. `apex` already leaned growth that way and it was not
   * enough by a wide margin: measured over 208 deck-missions on eight seeds, 63% had no
   * cell of the deck's own charter beneath it and only 3% touched it from below, with the
   * nearest own cell a median of 20 units from the deck edge. A weight cannot guarantee
   * arrival; an ordered placement can.
   *
   * Ordered bottom-up so every cell rests on the one below it or on rock, which is why
   * these can be claimed at reach 0 without consulting `reachOf` — the same footing the
   * spore path relies on. `ColonyPlan` derives the column, because it is the only thing
   * that knows where the decks and the terrain are.
   */
  spine?: Partial<Record<CorpId, SpineTarget[]>>;
}

const DIRS = [
  { dc: 1, dr: 0, link: LINK.east, back: LINK.west },
  { dc: -1, dr: 0, link: LINK.west, back: LINK.east },
  { dc: 0, dr: 1, link: LINK.up, back: LINK.down },
  { dc: 0, dr: -1, link: LINK.down, back: LINK.up },
] as const;

/** `DIRS` minus climbing — every direction that keeps a tip at the same row. Support and
 *  adjacency checks (`reachOf`, `rivals`, the final link pass) need all four neighbours
 *  regardless of growth order and still use `DIRS`; only `candidates`' own growth choice
 *  needs the climb held back, which is what this exists for. See its own doc comment. */
const GROUND_DIRS = DIRS.filter((d) => d.dr <= 0);
const CLIMB_DIR = DIRS.find((d) => d.dr === 1)!;

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
 * A plain preference for growing sideways over down, within the ground tier.
 *
 * Used to be the whole fix for a colony climbing too eagerly — every other term quietly
 * favours *up* (a cell above the tip stands on its own roof and collects the full
 * substrate bonus; a cell beside it usually stands on nothing and collects none, and
 * `W_APEX` pulls toward the top centre, which is up as well as inward), and colonies kept
 * coming out four times taller than wide (width/height 0.27 median across six seeds) with
 * only this constant leaning against it. It no longer has to win that fight alone: climbing
 * is gated behind `GROUND_DIRS`/`CLIMB_DIR` in `candidates` now, offered only once the
 * ground and every layer behind it are genuinely spent. `W_LATERAL` still earns its keep as
 * the tie-break *inside* that ground tier — sideways over down when both are viable — which
 * is a smaller job than it used to have, not a redundant one.
 */
const W_LATERAL = 0.7;

/** Small edge for climbing a real rock face over spreading past it — see `scoreDir`'s own
 *  comment. Sized to decide a near tie, not to compete with `W_APEX` or the height cost:
 *  a wall a colony is already touching should win a close call against open floor, not
 *  override the reasons — budget, rivals, the pull toward its own hardware — a filament
 *  might have for going anywhere else instead. */
const W_ROCK_CLIMB = 0.2;

/**
 * What a move into the layer in front or behind is worth, flat.
 *
 * Sized against the play-plane terms, and the sizing is the whole difficulty. A move on the
 * play plane pays the height cost and the rival penalty and earns a surface bonus only
 * where it touches rock, so its *typical* score is far lower than its best score — which
 * means a flat depth reward competes with the average, not the maximum, and wins far more
 * often than it looks like it should.
 *
 * Measured at 0.45: colonies grew to ~65 cells but their play-plane face collapsed from
 * about 40 cells to 12, and 121 of 441 corp-missions had a face under ten. The canyon
 * filled with volume nobody can see while the silhouette the player actually flies past
 * thinned out. Depth has to be what a tip does when the face in front of it is finished or
 * fenced — a last resort, not a preference — so it sits barely above `MIN_SCORE`.
 */
const W_DEPTH = 0.05;

/**
 * How much more a filament in an outer layer wants rock under it than one in the play plane.
 *
 * The play plane is where a charter builds its showpiece — cantilevered, ambitious, and the
 * thing the player flies past. The layers behind and in front are service: storage, plant,
 * the mass you bury for shielding, which on Mars is the only reason to build back there at
 * all. Two different jobs, and until now they were scored identically.
 *
 * What that produced is visible from any off-axis camera: `reachOf` lets depth neighbours
 * brace each other at **no cantilever cost**, so while `MAX_CANTILEVER` holds a run to two
 * cells in-plane, a run in z is unbounded. A mass can therefore spread arbitrarily deep on
 * a few thin legs, and it did — a slab of pipework hanging in mid-canyon with the rock
 * nowhere near it.
 *
 * Multiplying `W_SURFACE` by `1 + PER_LAYER * |layer|` is the whole fix: an outer tip pays a
 * real price for leaving the rock, while layer 0 keeps exactly the freedom it has today.
 * Nothing else needs saying, because the scaffold rule already reads support — whatever
 * still reaches into open air is `!grounded` and renders as bare frame on its own.
 */
const W_SURFACE_PER_LAYER = 1.1;

/** How far off the play plane a cell is, for the surface weighting above. */
function layerSurface(layer: number): number {
  return W_SURFACE * (1 + W_SURFACE_PER_LAYER * Math.abs(layer));
}

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
export const MAX_CANTILEVER = 2;

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

/**
 * Of those splits, the share that sends the new front into depth rather than sideways.
 *
 * This is the knob that decides whether a colony reads as a wall or as a building. Depth
 * is otherwise a last resort — a tip goes backwards only once its own layer is finished or
 * fenced — which is right for the *leading* tip, because the face is the silhouette, but
 * it means the layers do not start filling until a colony is essentially complete. Late,
 * all at once, and only for whoever happened to be boxed in.
 *
 * Spending branches on it instead costs the face nothing: a branch is a second front by
 * definition, and the leading tip carries on across the face regardless. So this can be
 * raised without reproducing the failure that `W_DEPTH` caused at 0.45 — a face collapsing
 * from about 40 cells to 12, on 121 of 441 corp-missions — because that came from depth
 * *competing* with face moves rather than running beside them.
 */
const DEPTH_BRANCH_CHANCE = 0.25;
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
  layer: number;
  corp: CorpId;
  life: number;
  lastDir: number;
  /**
   * Whether this tip is allowed to build into another layer.
   *
   * Only a tip budded *after* the colony has run out of viable work on the layers it
   * already occupies carries this — see the rebud in the step loop. A per-tip gate is not
   * enough on its own: a tip in a corner has no viable move while the colony still has
   * plenty of face left elsewhere, and letting that tip turn backwards was worth twenty
   * cells of silhouette a mission. The question has to be asked of the whole colony, and
   * `budTips` is the only place that looks at the whole colony.
   */
  depth: boolean;
}

/** A scored, legal move — a cell the tip could claim next. */
interface Move {
  col: number;
  row: number;
  layer: number;
  link: number;
  back: number;
  score: number;
  reach: number;
  /** Touches a cell belonging to another corp. Not a veto — a seam has to be built from
   *  both sides by somebody — but it is what stops a move counting as *free ground* when
   *  deciding whether the colony still has room to spread. See `candidates`. */
  encroach: boolean;
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
    spine = {},
  } = input;
  const cells = new Map<number, OrganismCell>();
  const tips = new Map<CorpId, Tip[]>();
  const built = new Map<CorpId, number>();
  /** Per cell, how far it sits from something that carries load — see `reachOf`. */
  const reach = new Map<number, number>();

  /** Where each colony leans. The lattice's top third, on centre, unless told otherwise. */
  const defaultApex = [
    {
      x: lattice.worldX((lattice.colLo + lattice.colHi) / 2),
      y: lattice.worldY(Math.round(lattice.rows * (2 / 3))),
    },
  ];
  const apexOf = (corp: CorpId): Array<{ x: number; y: number }> => {
    const own = apexFor[corp];
    return own && own.length > 0 ? own : defaultApex;
  };

  const at = (col: number, row: number, layer: number): OrganismCell | undefined =>
    lattice.inBounds(col, row) && LAYERS.includes(layer as Layer)
      ? cells.get(lattice.key(col, row, layer))
      : undefined;


  /** Distance from a cell to the nearest piece of this corp's own hardware, in cells.
   *  Only ever compared against itself one step away, so an exact metric would buy
   *  nothing over this. */
  /** Distance to the nearest of this corp's gravity points, in world units — see
   *  `W_APEX`. Nearest rather than summed, so a colony under one of its own elevated
   *  decks is not still being tugged at by the canyon's middle behind it. */
  function apexPull(corp: CorpId, col: number, row: number): number {
    const x = lattice.worldX(col);
    const y = lattice.worldY(row);
    let best = Infinity;
    for (const apex of apexOf(corp)) best = Math.min(best, Math.hypot(apex.x - x, apex.y - y));
    return best;
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
   *
   * **Only a corp's own structure carries its load.** Rock is rock and holds anybody up,
   * but a charter does not bolt its modules to a competitor's roof, and letting it read
   * one as footing is not a small licence — it is a free storey. Ixion took it: boxed into
   * a one-column slot on the floor of seed 631729407 by the corridors either side of it,
   * the only move left was up, and Helion's colony was the nearest thing to climb. It
   * finished the campaign four rows deep across Helion's roof. `W_RIVAL` was supposed to
   * discourage this, but a scoring penalty cannot compete with the alternative being *no
   * legal move at all*.
   */
  function reachOf(corp: CorpId, col: number, row: number, layer: number): number | null {
    // Rock is measured from the canyon's own cross-section and so holds up every layer
    // alike — a shelf at this column and row is a shelf at all three depths. The
    // approximation is deliberate: sampling terrain at ±cellSize would make the substrate
    // depend on z for a few units of profile difference and buy nothing anyone can see.
    if (substrate.isSolid(col, row - 1, layer) || at(col, row - 1, layer)?.corp === corp) return 0;
    for (const d of DIRS) {
      if (substrate.isSolid(col + d.dc, row + d.dr, layer)) return 0;
    }
    const neighbours: number[] = [];
    for (const d of DIRS) {
      const n = at(col + d.dc, row + d.dr, layer);
      if (n?.corp === corp) neighbours.push(reach.get(lattice.key(col + d.dc, row + d.dr, layer)) ?? 0);
    }
    // A cell directly in front of or behind one of its own is braced by it, at no
    // cantilever cost — the two share a full face, which is a better connection than the
    // edge contact a sideways neighbour gives. This is what lets a colony thicken.
    for (const d of DEPTH_DIRS) {
      const n = at(col, row, layer + d.dl);
      if (n?.corp === corp) neighbours.push(reach.get(lattice.key(col, row, layer + d.dl)) ?? 0);
    }
    if (neighbours.length === 0) return null;
    // Two supports share the load, so a span between them counts as one step from the
    // *better* of the two rather than accumulating along the weaker arm.
    const from = neighbours.length >= 2 ? Math.min(...neighbours) : neighbours[0];
    const next = from + 1;
    return next <= MAX_CANTILEVER ? next : null;
  }

  /**
   * Whether a cell could be built in at all. Rejected outright — never merely penalised —
   * so no weight tuning can ever talk the organism into a channel.
   */
  function openAt(col: number, row: number, layer: number): boolean {
    // The layer bound is checked *here* and not left to `at`, which answers "is this cell
    // taken" with `undefined` for a layer that does not exist — indistinguishable from
    // "free". Without this a tip walks off the back of the lattice, and because `key`
    // packs the layer into a fixed number of slots per column, a cell at layer 2 collides
    // with a real cell in the next column: growth order stopped being a prefix of itself,
    // reach reported cells three bays from load, and a colony climbed to the rim through
    // keys that were never really there.
    if (!LAYERS.includes(layer as Layer)) return false;
    if (!lattice.inBounds(col, row)) return false;
    if (substrate.isSolid(col, row, layer)) return false;
    // **The play plane only.** A flight channel is airspace at z=0; the layers in front of
    // and behind it are not in anyone's way, and letting them build past a corridor is
    // most of what depth is for — a route becomes a slot cut through a deep mass rather
    // than a gap the settlement grew around.
    if (layer === 0 && forbidden(col, row)) return false;
    return !at(col, row, layer);
  }

  function rivals(corp: CorpId, col: number, row: number, layer: number): number {
    let n = 0;
    for (const d of DIRS) {
      const other = at(col + d.dc, row + d.dr, layer);
      if (other && other.corp !== corp) n++;
    }
    return n;
  }

  function claim(corp: CorpId, col: number, row: number, layer: number, cellReach: number): void {
    const order = built.get(corp) ?? 0;
    cells.set(lattice.key(col, row, layer), { corp, order, links: 0, reach: cellReach });
    reach.set(lattice.key(col, row, layer), cellReach);
    built.set(corp, order + 1);
  }

  /**
   * Every legal move from a cell, best first. A candidate is rejected outright — never
   * merely penalised — for being out of bounds, rock, forbidden, already claimed, or
   * unsupported, so no weight tuning can ever talk the organism into a channel.
   */
  function candidates(tip: Tip, step: number, allowDepth = false): Move[] {
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

    /** One direction's move, scored — shared by the ground pass below and by the climb
     *  candidate, which is the same formula asked about the one direction the ground pass
     *  leaves out. */
    const scoreDir = (d: (typeof DIRS)[number]): Move | null => {
      const col = tip.col + d.dc;
      const row = tip.row + d.dr;
      if (!openAt(col, row, tip.layer)) return null;
      const cellReach = reachOf(tip.corp, col, row, tip.layer);
      if (cellReach === null) return null;
      // Rock *or its own roof*: adding a storey to what it already built is ordinary
      // construction and should not score as badly as reaching into open air. Without
      // this a colony squeezed off the floor by its own pads' channels — Ixion, which
      // sits in the middle of the canyon surrounded by them — has no scoring move left
      // anywhere and stops at a handful of cells.
      const onRock = substrate.at(col, row, tip.layer) === "surface";
      const footing = onRock || at(col, row - 1, tip.layer)?.corp === tip.corp;
      const adjacentRivals = rivals(tip.corp, col, row, tip.layer);
      // `W_LATERAL` rewards staying at the same row *or* hugging rock the tip is already
      // built against — climbing a wall face is the same act as spreading along a floor,
      // both are surface the corp did not have to manufacture, and only one of them used to
      // carry the bonus. A climb this cheap still costs `W_HEIGHT`, so a rock face is not a
      // free ladder to the rim; it is simply no longer taxed twice for the one thing that
      // makes it different from climbing into open air.
      //
      // `W_ROCK_CLIMB` is the tie-break on top of parity: a real wall is a stronger
      // structural reason to go up than a flat floor is to go sideways, since the colony
      // did not choose the wall, the terrain did, and building away from it to keep
      // spreading is the less natural read. Without this the two were merely equal, and
      // equal loses to whichever direction `W_JITTER` happens to favour that cell — a
      // colony spored against a cliff would as often walk the length of the floor as
      // climb the face beside it, which is the wall reading as scenery instead of ground.
      const score =
        layerSurface(tip.layer) * (footing ? 1 : 0) +
        W_ATTRACT * homeward * (here - pull(tip.corp, col, row)) +
        W_LATERAL * (shape[tip.corp]?.lateral ?? 1) * (d.dr === 0 || onRock ? 1 : 0) +
        W_ROCK_CLIMB * (d.dr === 1 && onRock ? 1 : 0) +
        W_STRAIGHT * (d.link === tip.lastDir ? 1 : 0) -
        W_HEIGHT * (shape[tip.corp]?.height ?? 1) * (row / lattice.rows) ** 2 -
        W_RIVAL * adjacentRivals +
        W_APEX *
          (shape[tip.corp]?.gravity ?? 1) *
          ((apexPull(tip.corp, tip.col, tip.row) - apexPull(tip.corp, col, row)) / lattice.cellSize) +
        W_JITTER * hash01(seed + CORP_SALT[tip.corp], lattice.key(col, row, tip.layer), step, 1);
      return { col, row, layer: tip.layer, link: d.link, back: d.back, score, reach: cellReach, encroach: adjacentRivals > 0 };
    };

    const scored: Move[] = [];
    for (const d of GROUND_DIRS) {
      const move = scoreDir(d);
      if (move) scored.push(move);
    }

    /**
     * Climbing onto real rock is ground-tier too, gate and all — hugging a face the corp
     * did not build is thigmotropism, the same reason `footing` already prices standing
     * against a wall like standing on the floor. What the gate below holds back is climbing
     * onto *nothing but the corp's own roof*, which is a different act with a different
     * cost: rock was always there for free; a storey exists only because the one under it
     * does, so it is manufactured floor before it is anything to build on. `cliff` in
     * `ColonyOrganism.test.ts` is the fixture for exactly this distinction — a colony
     * spored against a wall keeps creeping up it from the first tier, budget allowing,
     * while one on open ground defers to the ballooning rule below.
     */
    const climbsOntoRock =
      substrate.at(tip.col + CLIMB_DIR.dc, tip.row + CLIMB_DIR.dr, tip.layer) === 'surface';
    if (climbsOntoRock) {
      const onRock = scoreDir(CLIMB_DIR);
      if (onRock) scored.push(onRock);
    }

    /**
     * **Depth is offered only when the layer a tip is on has nowhere worth going on the
     * ground, and climbing away from rock only when neither the ground nor any layer
     * does.**
     *
     * A rule rather than a weight, because a weight cannot express it. None of the terms
     * above means anything across a layer — the cell behind is the same column, the same
     * row, the same distance from every attractor and every apex — so a depth move can
     * only ever be scored as a flat constant, and a flat constant competes with the
     * *average* in-plane score rather than the best one. Tuned to 0.45 that filled the
     * canyon with volume nobody can see: colonies reached 65 cells while the play-plane
     * face collapsed from about 40 to 12, on 121 of 441 corp-missions under ten. Dropping
     * it to 0.05 only moved the number (66).
     *
     * The real requirement was never a preference, it was an order: fill the ground, then
     * thicken, then climb. Gating on viability says exactly that and needs no constant to
     * hold the line — a tip goes backwards, or up, when it is finished or fenced, which is
     * precisely where the canyon has no width left to give it.
     *
     * Climbing used to compete in the very first pass, scored against the ground by the
     * same terms — and lost only to `W_LATERAL`, a plain constant added specifically
     * because open air above a tip is legal almost everywhere, so "the ground is not
     * viable" was true so rarely that depth, and every corp's own `shape.height`, were
     * fighting a move that had already usually won. Climbing behind the same gate as depth
     * is what makes width and depth a colony's first instinct and height its last one: a
     * settlement's own footprint fills in — a genuine `x`/`z` spread, not girth hidden
     * behind a face nobody sees — before it ever reads as a tower.
     *
     * **A rival's seam counts as fenced.** "Nowhere worth going" originally meant no legal
     * move scoring above `MIN_SCORE`, and a move onto ground a competitor is already
     * standing on clears that bar easily — `W_RIVAL` docks it 0.7 and a surface bonus pays
     * that straight back. So a colony boxed in by *neighbours* rather than by rock never
     * discovered it had a third dimension: on seed 631729407 Ixion spent mission after
     * mission pushing east into Kessler along a seam, with the whole depth of the canyon
     * behind it untouched. Free ground now means free of rivals too, so the choice a hemmed
     * colony faces is between the seam and the layer behind — and both stay on the table,
     * scored against each other, because a seam does have to get built by somebody.
     */
    // The questions below read the *first* option, so the sort has to happen before they
    // are asked rather than once at the end.
    scored.sort((a, b) => b.score - a.score);
    if (viableFace(scored)) return scored;

    if (allowDepth) {
      scored.push(...depthMoves(tip, step));
      scored.sort((a, b) => b.score - a.score);
      if (viableFace(scored)) return scored;
    }

    // Already offered above if it lands on rock — this is only the open-air case, held
    // back until here.
    if (!climbsOntoRock) {
      const climb = scoreDir(CLIMB_DIR);
      if (climb) scored.push(climb);
    }
    return scored.sort((a, b) => b.score - a.score);
  }

  /** The one or two cells directly in front of and behind a tip, scored. Separate from
   *  `candidates` because a branch may take one of these while the face still has room —
   *  see the branch step, and `DEPTH_BRANCH_CHANCE`. */
  function depthMoves(tip: Tip, step: number): Move[] {
    const out: Move[] = [];
    for (const d of DEPTH_DIRS) {
      const layer = tip.layer + d.dl;
      if (!openAt(tip.col, tip.row, layer)) continue;
      const cellReach = reachOf(tip.corp, tip.col, tip.row, layer);
      if (cellReach === null) continue;
      const score =
        W_DEPTH * (shape[tip.corp]?.depth ?? 1) +
        layerSurface(layer) * (substrate.at(tip.col, tip.row, layer) === 'surface' ? 1 : 0) -
        W_HEIGHT * (shape[tip.corp]?.height ?? 1) * (tip.row / lattice.rows) ** 2 +
        W_JITTER * hash01(seed + CORP_SALT[tip.corp], lattice.key(tip.col, tip.row, layer), step, 3);
      // Depth never encroaches: the cell in front of or behind your own is your own
      // building's other side, and no rival has a claim on it.
      out.push({ col: tip.col, row: tip.row, layer, link: 0, back: 0, score, reach: cellReach, encroach: false });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Whether a tip has anywhere worth going, as opposed to merely somewhere legal. Reads
   *  the best option, so callers must pass a sorted list. */
  const viable = (options: Array<{ score: number }>): boolean =>
    options.length > 0 && options[0].score >= MIN_SCORE;

  /** Whether a tip has anywhere worth going *on unclaimed ground* — the question that
   *  decides whether a colony still has room to spread or should start thickening
   *  instead. See the depth gate in `candidates`. */
  const viableFace = (options: Move[]): boolean =>
    options.some((o) => !o.encroach && o.score >= MIN_SCORE);

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
  function budTips(corp: CorpId, step: number, count: number, allowDepth = false): Tip[] {
    const viableCells: Array<{ key: number; order: number }> = [];
    for (const [key, cell] of cells) {
      if (cell.corp !== corp) continue;
      const col = lattice.keyCol(key);
      const row = lattice.keyRow(key);
      const layer = lattice.keyLayer(key);
      const options = candidates({ col, row, layer, corp, life: 1, lastDir: 0, depth: allowDepth }, step, allowDepth);
      // The face-first pass asks for *unclaimed* ground, matching the depth gate in
      // `candidates`. Accepting a cell whose only prospects are a rival's seam would let
      // this pass always succeed, and the depth pass below it would never be reached.
      if (!(allowDepth ? viable(options) : viableFace(options))) continue;
      viableCells.push({ key, order: cell.order });
    }
    viableCells.sort((a, b) => b.order - a.order);
    return viableCells.slice(0, count).map(({ key }) => ({
      col: lattice.keyCol(key),
      row: lattice.keyRow(key),
      layer: lattice.keyLayer(key),
      corp,
      life: TIP_LIFE,
      lastDir: 0,
      depth: allowDepth,
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
    for (const [key, cell] of existing) {
      const col = lattice.keyCol(key);
      const row = lattice.keyRow(key);
      const layer = lattice.keyLayer(key);
      if (!lattice.inBounds(col, row)) continue;
      if (substrate.isSolid(col, row)) continue; // buried
      if (layer === 0 && forbidden(col, row)) continue; // demolished by a route
      // `{ ...cell }` carries `cell.reach` forward untouched — the cantilever it was
      // actually built on, which the renderer reads to decide its shape and must not
      // change just because a mission has passed.
      cells.set(key, { ...cell });
      // The *scratch* reach below is a different question: whether this cell is legal
      // footing for something new this mission. Carried-forward cells are load-bearing by
      // the fact that they are standing — their own reach was checked the mission they
      // were built, and nothing has been removed from under them (growth is strictly
      // additive — see `ColonyPlan`) — so this is unconditionally 0 regardless of what
      // `cell.reach` says, and must stay that way or a colony resuming from a genuinely
      // cantilevered edge would refuse to grow from it a second time.
      reach.set(key, 0);
      built.set(cell.corp, Math.max(built.get(cell.corp) ?? 0, cell.order + 1));
    }
    for (const corp of built.keys()) {
      corps.push(corp);
      tips.set(corp, budTips(corp, 0, RESUME_TIPS));
    }
  }

  /**
   * The support under each raised deck, built before the corp spends anything on itself.
   *
   * A raised deck is the one structure a charter cannot reach at its leisure — it is
   * load-bearing from the mission it appears, and until something gets under it the deck
   * is a slab hanging in the sky.
   *
   * **Best-effort, not all-or-nothing.** Every candidate column is simulated first and the
   * one that climbs highest wins; ties go to the column nearest the deck's own axis, then
   * to the cheaper one. An earlier version demanded a candidate be clear end to end and
   * rejected it otherwise, which threw away columns that were blocked only at the very top
   * and left the deck with nothing at all — worse than a column that gets most of the way.
   *
   * Rock is stepped over rather than treated as an obstacle: it carries load, so the cell
   * above it stands on it. The corp's own structure from an earlier mission does the same.
   * A channel or a rival's module ends that column, and the next candidate is tried.
   *
   * Placement goes through `reachOf` rather than assuming reach 0, because a column
   * standing over a floor-level channel has nothing beneath its lowest cell and the
   * no-floating rule has to catch that here exactly as it would anywhere else.
   */
  for (const corp of Object.keys(spine).sort() as CorpId[]) {
    for (const target of spine[corp] ?? []) {
      const remaining = () => budget[corp] - (built.get(corp) ?? 0);
      if (remaining() <= 0) break;

      /** How far up a candidate would actually get, and what it would cost to get there. */
      const simulate = (column: SpineColumn) => {
        let reached = -Infinity;
        let cost = 0;
        for (const cell of column) {
          if (!lattice.inBounds(cell.col, cell.row)) break;
          if (substrate.isSolid(cell.col, cell.row, 0)) continue;
          const standing = at(cell.col, cell.row, 0);
          if (standing) {
            if (standing.corp !== corp) break;
            reached = cell.row;
            continue;
          }
          if (forbidden(cell.col, cell.row)) break;
          cost++;
          reached = cell.row;
        }
        return { reached, cost };
      };

      let best: { column: SpineColumn; reached: number; cost: number } | null = null;
      for (const column of target.columns) {
        const { reached, cost } = simulate(column);
        if (reached === -Infinity || cost > remaining()) continue;
        if (
          !best ||
          reached > best.reached ||
          (reached === best.reached && cost < best.cost)
        ) {
          best = { column, reached, cost };
        }
      }
      if (!best) continue;

      let placedTop: { col: number; row: number } | null = null;
      for (const cell of best.column) {
        if (remaining() <= 0) break;
        if (cell.row > best.reached) break;
        if (substrate.isSolid(cell.col, cell.row, 0)) continue;
        const standing = at(cell.col, cell.row, 0);
        if (standing) { placedTop = cell; continue; }
        const cellReach = reachOf(corp, cell.col, cell.row, 0);
        // Nothing carries this one. Stop rather than hang a cell in the air; whatever
        // stands below it is still real support, and a later mission tries again.
        if (cellReach === null) break;
        claim(corp, cell.col, cell.row, 0, cellReach);
        placedTop = cell;
      }
      if (!placedTop) continue;

      /**
       * The bracket: a run along the top row back to under the deck, so an offset column
       * still reads as the thing holding it up rather than as a separate tower nearby.
       * Each step costs one of `MAX_CANTILEVER`, which is exactly why the caller never
       * offers a column further out than that.
       */
      if (placedTop.row === target.top && placedTop.col !== target.centre) {
        const stride = placedTop.col < target.centre ? 1 : -1;
        for (let col = placedTop.col + stride; ; col += stride) {
          if (remaining() <= 0) break;
          if (!lattice.inBounds(col, target.top)) break;
          if (substrate.isSolid(col, target.top, 0)) { placedTop = { col, row: target.top }; }
          else {
            const standing = at(col, target.top, 0);
            if (standing && standing.corp !== corp) break;
            if (!standing) {
              if (forbidden(col, target.top)) break;
              const cellReach = reachOf(corp, col, target.top, 0);
              if (cellReach === null) break;
              claim(corp, col, target.top, 0, cellReach);
            }
            placedTop = { col, row: target.top };
          }
          if (col === target.centre) break;
        }
      }

      tips.set(corp, [
        ...(tips.get(corp) ?? []),
        { col: placedTop.col, row: placedTop.row, layer: 0, corp, life: TIP_LIFE, lastDir: 0, depth: false },
      ]);
      if (!corps.includes(corp)) corps.push(corp);
    }
  }

  /**
   * A spore is honoured even when the corp is already standing.
   *
   * The rule here used to be "already standing — no second spore", and it silently killed
   * the only mechanism that can rescue a colony from a bad start. `ColonyPlan` offers a
   * second spore *only* to a corp badly short of what it should have built by now, so by
   * the time one arrives the corp is by definition stuck; refusing it means a filament
   * that spored into a dead pocket on mission 2 stays one cell for the remaining
   * twenty-eight missions. Measured exactly that: Kessler on seed 2135022333, one cell
   * from mission 10 to the end of the campaign, and the only corp-mission under ten cells
   * in six seeds.
   *
   * Nothing about the never-shrink side of the ledger changes — a spore only ever adds a
   * cell — and the corp cannot get two, because the caller offers at most one per mission.
   */
  for (const spore of spores) {
    if (!lattice.inBounds(spore.col, spore.row)) continue;
    if (substrate.isSolid(spore.col, spore.row) || forbidden(spore.col, spore.row)) continue;
    // A nucleus always lands on the play plane — that is where the ground the spore search
    // measured actually is, and a colony that started behind the camera would appear from
    // nowhere as far as the player is concerned.
    if (at(spore.col, spore.row, 0)) continue; // a rival got here first
    claim(spore.corp, spore.col, spore.row, 0, 0);
    // Added to whatever the corp is already working on rather than replacing it — a
    // rescue nucleus is a second front, not a restart.
    tips.set(spore.corp, [
      ...(tips.get(spore.corp) ?? []),
      { col: spore.col, row: spore.row, layer: 0, corp: spore.corp, life: TIP_LIFE, lastDir: 0, depth: false },
    ]);
    if (!corps.includes(spore.corp)) corps.push(spore.corp);
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
        // Face first, then depth. Only when *no* cell this colony owns has anywhere worth
        // going on its own layer does it start building in front of or behind itself.
        live = budTips(corp, step, 1);
        if (live.length === 0) live = budTips(corp, step, 1, true);
        if (live.length === 0) continue; // nowhere left to build — contained, not an error
      }
      active = true;

      const next: Tip[] = [];
      for (const tip of live) {
        if ((built.get(corp) ?? 0) >= budget[corp]) {
          next.push(tip);
          continue;
        }
        const options = candidates(tip, step, tip.depth);
        if (!viable(options) || tip.life <= 0) continue; // tip dies

        const move = options[0];
        claim(corp, move.col, move.row, move.layer, move.reach);
        tip.col = move.col;
        tip.row = move.row;
        tip.layer = move.layer;
        tip.lastDir = move.link;
        tip.life--;
        next.push(tip);

        const room = next.length + 1 <= MAX_TIPS;
        const branch =
          hash01(seed + CORP_SALT[corp], lattice.key(move.col, move.row, move.layer), step, 2) < BRANCH_CHANCE;
        if (room && branch && (built.get(corp) ?? 0) < budget[corp]) {
          /**
           * **A branch may go backwards even when the face still has room.**
           *
           * The leading tip never does — it fills the face first, and the whole reason for
           * that order is that the silhouette is what the player reads. But a branch is a
           * second front by definition, and sending it into depth costs the face nothing
           * while giving the layers somewhere to start. Without this, depth waits until a
           * colony is completely finished or fenced, so it appears late, all at once, and
           * only for whichever corp happened to be hemmed in.
           */
          const backwards =
            hash01(seed + CORP_SALT[corp], lattice.key(move.col, move.row, move.layer), step, 4) <
            DEPTH_BRANCH_CHANCE;
          const side = (backwards ? depthMoves(tip, step)[0] : undefined) ?? options[1];
          if (side && !at(side.col, side.row, side.layer)) {
            claim(corp, side.col, side.row, side.layer, side.reach);
            next.push({
              col: side.col,
              row: side.row,
              layer: side.layer,
              corp,
              life: Math.round(TIP_LIFE * 0.7),
              lastDir: side.link,
              depth: tip.depth,
            });
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
  for (const [key, cell] of cells) {
    const col = lattice.keyCol(key);
    const row = lattice.keyRow(key);
    const layer = lattice.keyLayer(key);
    let links = 0;
    for (const d of DIRS) {
      if (at(col + d.dc, row + d.dr, layer)?.corp === cell.corp) links |= d.link;
    }
    cell.links = links;
  }

  return cells;
}
