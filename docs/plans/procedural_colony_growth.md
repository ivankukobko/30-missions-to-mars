# Plan: Procedural Colony Growth

## Status

**Live in the campaign.** `Missions.synthesizeColonies` appends one grown colony per
active corp to every mission's world — Ixion centre-rooted from mission 1, Helion and
Kessler wall-rooted from their own first missions, growing toward the centre per the
lore. Maturity comes from how far into its own mission sequence a corp is; density
("quality") from the player's best-rank record (`Progress.ranks`) — fly better for a
corp and its colony visibly builds better, rooms over scaffold. All of it is a pure
function of `(campaign position, mastX/Y, ranks, seed)`, so a retry rebuilds an
identical world; `Missions.test.ts` asserts the purity, the per-corp placement, the
rank→density monotonicity, and — campaign-wide, every mission × every mast position —
that no colony ever violates a pad's layout rules.

One behaviour worth knowing about rather than discovering: a colony can *shrink*
between missions when a newly built pad reserves a corridor through cells it had grown
into (observed with Helion, m10→m30). That is the safety rule outranking growth by
design — and it happens to be lore-consistent (Helion demolishes its own crest deck at
mission 19 to open the cavern).

Earlier sections below are kept for the design rationale; per-section **Shipped** tags
mark what landed at each stage. `docs/colony.md` is the record of current behaviour.

## Goal

Give the colony real per-playthrough variation — what grows around a pad, not just how
the terrain around it happens to be seeded — without touching the two things that
currently make the campaign work: the hand-authored 30-mission narrative (exact numbers
in briefs, pacing, difficulty curve) and the `resolveLayout`/`checkLayout` flyability
guarantee every mission ships with today.

## The core model: anchors vs. grown flesh

The split that makes this tractable: some props are **anchors** — load-bearing for
gameplay, and they stay exactly where hand-authored, forever. Everything else is **grown
flesh** — connective/decorative structure that can vary per seed because nothing in a
mission brief or a fuel budget depends on its exact shape.

| | Anchor | Grown flesh |
| --- | --- | --- |
| Examples | `pad`, `platform` (coupled to its pad), `Excavation` (dig depth/width) | `tower`, `gantry`, `mast`, lattice bracing |
| Why fixed / why free | Briefs cite exact numbers off these (`"fifty-eight metres below the canyon"`); `checkLayout` reserves corridor space against them | Briefs never commit to a tower's bay count or a gantry's exact route |
| Precedent already in the codebase | — | `resolveLayout` already relocates `mast` when it conflicts with something — the one existing example of "this prop kind is allowed to move," generalised here to "this whole class can vary" |

This is why the risk is much smaller than "procedural colony generation" sounds: the
thing that has to stay exactly right (reachability, brief accuracy, difficulty) is
carried entirely by anchors, which never move. Growth only touches material that was
already cosmetic.

## Mount type: wall / floor / tunnel

A pad's mount describes what it's set into, and it should decide what growth around it
looks like — a wall mount reads as things cantilevered off a rock face (the natural home
for the "labyrinth" horizontal-hazard idea below); a floor mount grows a tower standing
on ground; a tunnel mount grows ring bracing hugging a bore's curve.

**Shipped, as substrate only:** [`Shaft.ts`](../../src/world/Shaft.ts) now supports a
bore travelling in any direction (`Excavation.direction`, default straight down), and
[`CanyonGenerator.ts`](../../src/world/CanyonGenerator.ts) carves the mouth correctly for
either case — a floor mouth still dips the heightfield; a wall mouth omits render quads
and splits the collider profile around the opening, since a heightfield can't hold
"solid, gap, solid" at one x no matter which way the bore points. This is *not* colony
growth — it's the prerequisite that makes a wall-mounted anchor buildable at all. No
mission authors one yet, and `Layout.ts`'s `cappedMouths` corridor-safety rule still
assumes a mouth opens upward — that has to be generalised before any real mission uses
this.

**Design principle for future digs: closer to the canyon edges, not the centre.** A
wall mount gets this for free — it's carved into the wall, so it's at the edge by
definition. But it should hold for floor and tunnel mounts too, for the same two
reasons the grown structure's own placement does: a shaft dug into open ground in the
middle of the canyon doesn't read as mined into rock the way one nearer a wall does, and
centring a dig is exactly where it maximises interference with the corridor the player
actually flies down the middle of. Today's digs don't do this — Kessler's shaft
(`x: 10`) and Helion's cavern (`x: -33`) are hand-authored constants, fairly central
relative to a typical canyon's floor width, and because the canyon's actual shape
(`centreAt`, `floorHalfAt`) varies by seed while these x-coordinates don't, how close a
dig actually sits to an edge on any given seed is closer to accidental than designed.
Not changing this now — it's real campaign content, out of scope for this file — but
when digs do get positioned more procedurally, `CanyonGenerator.floorEdgeAt` (built for
the grown structure's own canyon-fit) is the mechanism already sitting there to use:
anchor a dig some margin in from the edge it returns, the same way `loadGrowthDemo`
anchors its structure now, rather than picking an x and hoping.

## Growth mechanism: a voxel grid, WFC-lite over it

Rejected **marching cubes** specifically: it earns its cost extracting a smooth isosurface
from a continuous volume, which is exactly the capability colony structures don't need —
they're additive props sitting on the terrain, not carved into it, unlike a shaft mouth.
It's also the wrong aesthetic: this game is hard-faceted throughout (`flatShading`,
fixed-segment lathe hulls, lattice bracing), and a smoothed isosurface is a different
visual language.

Discrete cubic cells fit both the problem and the look:

- **Every cell is a true cube — same edge length on all three axes — at least the width
  of the pad it grows from.** Pad width varies (~9–16 units across the campaign via
  `padWidth()`), so each colony's cell size is its own pad's width, floored so a very
  narrow pad still grows at a legible scale. A single `cellSize`, not a width/height
  pair: one number can't drift out of a cube the way two numbers changed independently
  could. A colony serving a narrower pad grows finer-grained than one serving a wide
  one, for free.
- **The grid is a placement lattice, not the render primitive.** An occupied cell
  resolves to the existing per-corp module vocabulary (barrel/box, lattice, scaffold) —
  it never draws as a literal cube.
- **Pad cells are pre-collapsed.** The anchor's cell (or the few it spans) is pinned
  before WFC runs; propagation only decides what fills the cells around it. This is the
  standard "pinned seed cells, grow outward" WFC pattern, and it costs little because the
  pad's grid alignment is already exact by construction (cell size *is* pad width).

**Shipped, as a standalone prototype:** [`ColonyGrowth.ts`](../../src/world/ColonyGrowth.ts)
implements exactly this — `growGrid(cols, rows, anchorCol, seed)` is the pure, tested
generator (support rule, anchor pinning, distance-based room/scaffold/empty odds, tube
edges); `buildColonyGrowth` renders a grid with plain boxes/cylinders, not yet the full
barrel/lattice module vocabulary. It is a 2D grid (columns × rows) rather than the 3D
one described below — towers don't currently vary along z at all, so a third axis was
complexity this prototype had nothing to spend it on yet. **Not called from anywhere in
the game** — no mission, no `worldAt`, no `Colony` class references it. Verified by
[`ColonyGrowth.test.ts`](../../src/world/ColonyGrowth.test.ts) and by hand in the
browser: same seed reproduces the same grid, different seeds read as visibly different
structures, nothing renders as floating or disconnected.

One real bug surfaced building this, worth recording because it's a class of mistake
this codebase already had a name for: the first version hashed each cell decision with
a `sin()`-based formula (a fourth term folded into one `sin()` call, à la the old
`buildTower` module hash), and two of its salts turned out correlated enough that the
tube gate never fired once across 400 real seeds, despite 40 real adjacent-room pairs
existing to place one on. `Noise.ts`'s own header comment already named this exact
failure mode — *"avoids the precision drift of sin()-based hashes"* — for exactly this
reason. Fixed by exposing `Noise`'s integer bit-mixing as a standalone `hash01()` and
using that instead; 290/400 seeds produce a tube now. `ColonyGrowth.test.ts` has a
regression test pinning this specifically, not just a "seems fine" spot check.

### Tile types

- **Room** — the basic occupied cell, deliberately undersized within its cell bound
  (same convention `buildTower`'s hung modules already use: 0.72–0.85 of the bay,
  "because a shape reads smaller than the bound it shares"). The margin this leaves is
  where the lattice frame keeps doing its job, and where a tube has somewhere to sit.
- **Tube** — a property of the *edge* between two **adjacent** occupied cells, not a
  cell of its own and not a connector that can span a gap or skip an empty cell.
  Unconditional, not seeded: two rooms that share a cell face are always connected —
  there is no in-fiction reason a colonist could walk between two adjacent rooms on
  some seeds and not others. Crew-scale, not vehicle-scale — small enough to read
  unambiguously as detail, the same way running lights and RCS nozzles are sized
  deliberately below anything the player needs to reason about. Never a flight route,
  never a hazard, never part of the corridor-safety conversation.
- **Scaffold** — open lattice, per-corp material identity, the default at a colony's
  outer edge. Matures into a room over campaign time (see below).
- **Empty** — nothing. The only option inside a corridor's reserved margin (see Safety).

### Growth rules (as shipped, after the lateral-growth correction)

A cell above ground is occupiable if the cell **below** it is occupied *or* its
anchor-side lateral neighbour is a **room** — rooms are load-bearing, scaffold only
climbs. A cell may only *become* a room if it touches the room network (below or
anchor-side; the anchor counts), so the rooms form one connected mass and — since every
adjacent room pair gets a tube — every room reaches every other through the corridor
network, verified by flood fill in `ColonyGrowth.test.ts`.

**This lateral growth is where the labyrinth comes from.** The mass extends
horizontally around whatever `reserved` carved out — pad corridors, dig mouths — so a
reserved flight channel ends up walled in by colony rather than standing in open sky.
The stated direction this enables: **shafts dug in the canyon corners**, with the
owning corp's colony massed around the shaft's reserved mouth channel — the descent
becomes navigating a maze the colony built. Moving the campaign's real digs cornerward
is the remaining content step (see Open questions: dig positions are authored constants
while the canyon's wall positions vary per seed, so "near the wall" needs either
seed-derived dig placement or a constant that tolerates the wall sometimes coming to
meet it).

### Maturation — reuse, not a new mechanism

`buildBackdropColony` already computes a building's age straight from its index in the
accumulated `props` list — *"it is not that more buildings appear, it is that the ones
already there keep rising. Play mission 8 and then mission 30 on the same seed and the
skyline... is recognisably the same place, twenty-two missions older."* Pointing that
exact computation at a colony's own cells — a cell's type is a pure function of (seed,
cell identity, missions elapsed since this colony was first anchored) — turns edge
scaffold into rooms over the campaign, at no new rebuild cost: every colony already
regenerates fresh from `props` on every mission load. Must stay monotonic per seed (a
cell never regresses from room back to scaffold on replay), matching the backdrop's own
"rising, not fluctuating" framing.

### Masts cap the column

The topmost occupied cell in a column is a candidate mast site — a direct generalisation
of the one prop kind already flexible today (`mast` is what `resolveLayout` relocates
rather than holds fixed).

## Safety model

**Shipped: corridor adjacency restricts occupancy, not content type.**
[`growGrid`](../../src/world/ColonyGrowth.ts) takes an optional `reserved(r, c)`
predicate; a cell it marks true is forced empty unconditionally, checked before the
anchor pin and before any seed gets a say — decided once, at generation, never
revisited. Not "restricted to scaffold": if it could later mature into a room, a
corridor that was flyable in mission 8 could seal itself by mission 20 on the exact same
seed, which is the one guarantee this whole design isn't allowed to touch. Making it
occupancy-only removes the tension by construction instead of needing a special case for
it. The existing support rule (a cell needs the one beneath it to be non-empty) does the
cascading for free — reserving one cell empties its entire column above it, no separate
propagation logic required.

`?growth` demonstrates it with an illustrative — not yet real — reservation: a whole row
reserved rather than a column, capping how *tall* the structure may grow the way a
gantry or a flight path crossing overhead actually would. Checked against seed 46, whose
structure grows to row 6 unrestricted: with the row-5 reservation on, it stops cleanly at
row 4 and nothing is supported above it. `ColonyGrowth.test.ts` covers the mechanism
exhaustively — a reserved cell is always empty regardless of seed, reserving a cell
empties its column, reserving the anchor cell fails safe rather than silently ignoring
the reservation, and omitting `reserved` entirely is identical to reserving nothing.
What's still missing is a *real* reservation — one derived from an actual pad's flight
corridor via `Layout.ts`, not a hand-picked row for demonstration purposes.

**Everything else here is free from a verification standpoint.** `checkLayout` already
validates at the coarse prop-footprint level — a tower's `x ± width`, not what's rendered
inside it. Individual tower modules aren't separately collidable today. So room shape,
tube placement, and maturation stage are all decoration inside a cell whose *occupancy*
was already validated once; none of it re-enters the safety-critical path. `checkLayout`
still runs as the final net regardless — cheap, and it's the exact mechanism that caught
the mission-19 cavern-mouth bug.

## Explicitly rejected

- **Full procedural narrative** (mission structure itself varying per seed) — breaks
  hand-written briefs and the six-phase campaign arc. `docs/colony.md`'s own "Player
  choice" note already carries this caveat: *"a locked choice vector kept with the seed,
  not a world that drifts."*
- **Marching cubes / voxel density fields** — see above.

**Shipped, as a standalone playable scene:** `?growth` on the game's URL loads
[`Game.loadGrowthDemo`](../../src/core/Game.ts) instead of the campaign — a hand-built
pad plus a grown structure a safe hand-placed distance clear of it, flown with the real
physics, scoring, and crash/retry state machine. Deliberately **not** mission 31: its
mission `id` is `0`, never a real entry in `MISSIONS`, and `resolveSettle`/`fail`/
`useSeed` all check a `demoMode` flag so a run here — success or crash — never calls
`progress.complete()` or transitions into a real campaign mission. Verified by hand:
landing writes nothing to `localStorage` (byte-identical before/after against a save
with real progress on it), a forced crash retries back into the demo, and loading a real
mission afterward correctly clears `demoMode` and resumes normal saving. The structure's
cell size comes from the demo pad's own resolved width, so it demonstrates the
per-anchor pitch rule for real rather than with a hardcoded number.

**Shipped: the grid fits the canyon it's in.** [`CanyonGenerator.floorEdgeAt(z, side)`](../../src/world/CanyonGenerator.ts)
returns the wall's near edge on one side of the canyon's own wandering centreline — not
a fixed distance from world x=0, which the floor is rarely centred on. `loadGrowthDemo`
sizes its column count off the actual span between the pad and that wall (clamped
2–5) rather than a fixed guess, so the structure grows wider where the canyon is wide
and narrower — deliberately running a column into the wall rather than stopping short —
where it isn't. Checked across seeds 1–39: column count tracked the wall's distance
correctly at every one, from 2 columns (wall at world x≈23) up to the cap of 5 (wall
past x≈80).

## Open questions

- Exact WFC adjacency rule set (which tile may border which) — not authored yet.
- `cappedMouths` generalisation for wall-mounted mouths — needed before any mission
  content uses the direction work, independent of whether colony growth ships.
- **Corner shafts.** Kessler's and Helion's digs are authored constants near the canyon
  centre; the labyrinth design wants them near the walls, wrapped by their corp's
  colony. But the canyon's centreline wanders ±38 by seed while dig x does not, so a
  fixed "near the wall" x sits on open floor on some seeds and inside the wall on
  others. Either dig placement becomes seed-derived (which means `MISSIONS`' authored
  pad positions inside those digs must follow — a structural change to how the ledger
  is authored) or the constant is chosen to tolerate both. Not started; decide before
  moving any real dig.
- **Scaffold visuals.** The X-brace placeholder reads as a flat star from the flight
  camera; a second crossing plane was tried and read worse. The real fix is rendering
  scaffold cells with `latticeMembers` (Colony.ts's own frame vocabulary), which is the
  module-vocabulary step — deliberately not hacked around further.

## Recommended next step

Campaign wiring is done — see Status at the top. What's still open:

1. Swap the plain boxes/cylinders for the real per-corp module vocabulary
   (`buildTower`'s barrel/box/lattice), so a grown structure actually looks like it
   belongs next to a hand-authored one. Now the highest-value remaining item, since the
   placeholder geometry is in every mission of the real campaign.
2. Ixion's colony freezing at their mission-28 shutdown — `synthesizeColonies` needs a
   corp's *last* active mission, not just missions-elapsed; small, and the lore already
   supports it.
3. Colliders. Colonies are currently render-only, like the backdrop: no physics
   segments, so a lander flies through them. Layout keeps them clear of every corridor
   regardless, but "lethal like every other beam in this canyon" is the eventual
   right answer, and wants the same measured care the tower colliders got.
