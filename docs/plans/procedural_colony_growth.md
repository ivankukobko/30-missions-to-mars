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

`tower`/`gantry`/`mast`/`platform` are gone from the ledger entirely (see the `Prop`
doc comment in `Colony.ts`) — every mission's structure is `colony` now, not just the
ones this file originally scoped growth to. `buildColonyStructure` gives every occupied
cell its own physics box (full-cell, not the leaner mesh drawn inside it — same
"collider is the solid box, the frame is just see-through" rule every other structure's
collider already used), so a grown colony is lethal on contact like everything else in
this canyon.

Vertical placement is one flat sample per colony (`CanyonGenerator.surfaceFloorAt`, at
the colony's own anchor `x`, digs excluded), not per column. Per-column sampling was
tried — it does follow real terrain relief more precisely — and reverted: once a wall
corp reaches several columns wide, `floorRelief`'s noise varies enough across that span
that every column landed its row 0 at a visibly different height, and the structure read
as a jagged staircase instead of one grown mass with level floors. A real foundation
grades the site it sits on rather than following it verbatim; one sample at the anchor
is that grading. (`ColonyGrowth.ts`'s `GrowthPlacement.floorAt` still exists for a
narrower, genuinely two-level site — a dig's shoulder — where a single step is the
honest answer; `Colony.ts` just doesn't reach for it in the general case any more.)

### Terrain-aware fitting

Colony placement, `cappedMouths`, and a dig's own position/orientation all used to be
decided *before* any terrain existed for the mission being loaded — `worldAt()` ran
before `Game.loadMission`'s `canyon.build()`, so every one of them stood in fixed
constants (`CANYON.PLAY_HALF_X`, "the wall is roughly here") for the real, per-seed
canyon. That produced three concrete failures on live seeds in one session: colonies
stopping short of the real wall; a colony's nominal reach silently overlapping a
neighbour's territory once an excavation had displaced its anchor off the position that
reach was sized against; and a dig's mouth reading as unmarked bare canyon in the debug
gizmo view rather than a legible reserved zone, because no corp's grid extended far
enough to cover it.

Fixed by reordering the pipeline to what it always should have been — **generate the
landscape, fit a grid to it, then grow on what's available** — moving colony generation
out from behind `worldAt()`'s pure signature to run after `canyon.build()`:

- `src/world/ColonyAvailability.ts` (new) — the shared per-mission cell mask every corp's
  growth reads: a cell is non-available if real terrain covers it more than 50%
  (`isLandscapeCovered`, sampled via `CanyonGenerator.sampleFloorRow`, one row
  resolution reused across every sample rather than paying its cost per cell) or it's
  adjacent to a shaft mouth (`nearShaftMouth`, also used standalone during anchor search,
  before terrain exists).
- `src/campaign/ColonyGeneration.ts` (new) — `synthesizeColonies` and its territory/
  anchor-search machinery, relocated verbatim from `Missions.ts`, now taking the mask as
  one more term in `growGrid`'s `reserved` combinator.
- `src/campaign/TerrainDigs.ts` (new) — `WallAnchoredDig`: a dig authored with
  `anchorToWall: 'west' | 'east'` instead of a fixed `x`, resolved against the real
  wall position (`floorEdgeAt`) and the wall's own local slope (`direction` computed
  orthogonal to it) once terrain exists, but *before* `canyon.build()` — verified safe
  because `floorEdgeAt`/`heightAt` are pure functions of the seed, not of anything
  `build()` sets up. Also resolves `attachToDig` on a `pad`/`caveRoof` (`Colony.ts`) to
  the bore's real endpoint, for a prop authored as "the destination inside this shaft."
  Helion's cavern dig is the first (and so far only) consumer — its shaft is now
  genuinely wall-mounted, angled into the rock rather than straight down, anchored to
  wherever the real wall sits for that seed instead of a fixed constant that used to
  land on open floor as often as not.
- `Layout.ts`'s `cappedMouths` gained a wall-mount branch (`cappedWallMouth`), measuring
  a mouth's real opening (`wallMouthY`, now public) instead of assuming every mouth
  faces up. `checkLayout` takes an optional `terrain` parameter for this; callers
  without it (most pure tests) still get full floor-mount coverage, just not a
  wall-mount check that would need terrain to mean anything.
- `worldAt()` shrank back to what its name always implied: pads, digs, decommissions,
  the radar — no `seed` parameter (nothing left inside it needs one), no colonies.

One real, pre-existing bug surfaced building this, unrelated to anything above except
that it's the first time a wall-mounted dig existed to trigger it: `CanyonGenerator`'s
`row()` gathered *every* excavation for floor-pit carving regardless of mount type, so a
wall-mounted dig's `depth` got misread as a floor-pit depth wherever `onFloor` hadn't
fully decayed to zero yet — which reaches surprisingly far past `floorHalf` (`WALL_RUN`
is the blend width). Measured live: `heightAt` at Helion's new mouth read 45 units lower
than the natural wall surface once the dig existed, gouging a phantom pit into a slope
that should have stayed solid rock. Fixed by filtering `row()`'s dig gathering to
floor-mounted digs only — `overShaft`/`carveWallMouths` already carve a wall mount's
opening by omitting mesh quads, not by height-lerping, so nothing about the mesh needed
this loop to also see wall mounts.

Also worth recording: `reservedCellsFor` (`Layout.ts`) briefly regressed to judging a
cell's clearance by distance from a pad's *centre* rather than by overlap with its real
footprint and corridor intervals — cheaper to write, but a cell one full lattice column
off-centre could pass a distance check while still overlapping a wide pad's edge. Live
result: Kessler's colony grew straight onto `kessler-crest`'s own footprint on several
missions, caught by the `[layout]` dev-console warning `worldAt` already prints rather
than by any test, because the check being wrong doesn't stop `Missions.test.ts`'s
own `checkLayout` assertion from agreeing with it. Fixed by going back to interval
overlap against the pad's actual `footprint`/`core`, mirroring `checkLayout` rule for
rule instead of approximating it.

### One shared grid, not one per corp

Each corp used to compute its own `cols` before growing anything — a wall corp's reach
sized from `wallEdgeColumn` (the first row-0 cell the mask read as open, walking in from
`colBoundsLo`/`colBoundsHi`) capped at the canyon's own centre column (`midCol`), Ixion a
flat `cols = 3`. That once-per-corp window undersold real terrain in a way per-cell
testing alone doesn't: a canyon wall recedes with altitude (`canyonWidthAt`'s own doc
comment), so a column that's real rock at row 0 can be open ground four rows up — but
`wallEdgeColumn` only ever tested row 0, and that single low read decided the whole
column *budget* for every row above it, not just the anchor's own foundation. Live
consequence, seed 1009610 mission 19: Helion's row-0 read landed at column −2 (a real
measurement, not a bug — its true floor genuinely doesn't reach farther out at ground
level there, cut off by a dig lane and the rising wall both), a search from there
running only toward the centre (wall corps can't search back toward their own wall —
see `findAnchorX`) walked straight into Ixion's and Kessler's already-claimed columns,
exhausted its budget, and Helion's whole side of the canyon built nothing that mission.

Fixed: every corp now grows on *one* shared grid — `cols = colBoundsHi − colBoundsLo + 1`
(the mask's own full-canyon-width bound), one shared position (`x` = world x of the
grid's own column 0), identical for every colony prop in a mission (`Colony.ts`'s
`colony` variant doc comment). A corp's own identity is just where its `anchorCol` — its
**gravitational centre**: the nearest available, unclaimed row-0 cell walking in from
its own wall, or from its claim's midpoint for Ixion — lands inside that shared range,
and what its own `reserved` callback excludes. `wallEdgeColumn` still exists and still
only tests row 0 — an anchor is a physical foundation, so *that one cell* genuinely does
need a single-row test — it just no longer sizes anything beyond itself.

The "wall corp reaches toward the centre, not a narrow spike" shape used to be an
explicit `growGrid` term (`weightedDist`, gated on `anchorCol === 0 || cols − 1`). That
test stopped meaning anything once the grid is shared and full-width — a wall corp's
anchor typically lands somewhere in the *middle* of the shared column range now, not at
the array's edge — so it's gone; the shape is entirely emergent instead: real rock and
another corp's already-claimed columns sit on the wall side, so the flood's only open
direction is inward. See `ColonyGrowth.ts`'s own doc comment on `growGrid`.

**Invalidated per cell, not per row or per column** — the property that actually matters
here, since a coarser rule silently undersells real terrain either way. Verified live
against seed 1009610 mission 19: at the shared grid's own column −8, rows 0–9 read
non-available (real rock) but rows 10–11 flip to available as the wall recedes — same
column, different rows, different answers. Columns right at the true edge
(`colBoundsLo`/`colBoundsHi` themselves, and one step in) stay non-available at every
row within the grid's 12-row ceiling — genuinely inside the wall at every height this
grid reaches. `AvailabilityMask.nonAvailable(col, row)` already took both a column and a
row before this change; the fix was making sure nothing downstream (`wallEdgeColumn`'s
old `cols` sizing) overrode that per-cell answer with a coarser, once-per-corp column
veto. The corp-territory buffer (`blockedGlobalCols`, `nearOtherWallAnchor` — "keep one
empty column between two corps' structures") is deliberately *not* per-cell: it is a
turf rule, not a terrain fact, so a column either holds another corp's claim or it
doesn't, independent of row.

**Anchor search finds the nearest available cell, in either direction — a wall corp's
own wall edge is a starting guess, not owned territory it's confined to.** Used to search
only toward the canyon centre for a wall corp (`bias` in `findAnchorX`), never back
toward its own wall — reasoned as a one-cell dead end by construction, since
`wallEdgeColumn` already found the nearest open row-0 point walking in from the true
edge. True on its own, but it also meant the search could never look *past* whatever
blocked its one permitted direction — a dig lane or another corp's claim a few columns
toward the centre — even when real, reachable ground sat past it from a different
angle. Live case, seed 1009610: Helion's own wall-side direction is genuinely dead, but
its centre-ward direction ran straight into a pad corridor, Ixion's anchor, Kessler's
own dig lane, and Kessler's reserved wall anchor, in that order — four separate,
individually legitimate reservations that happened to fully occupy the one direction
Helion was allowed to search, manufacturing "no room" out of what should have been a
"keep looking" case. Fixed by searching outward from the gravitational centre in both
directions, nearest offset first (`bias: 0`, the same search Ixion always used), for
every corp — the wall-side direction still gets ruled out in a couple of cheap,
immediately-failing checks, it just isn't forbidden from being checked.

**Also worth recording, found verifying the above:** the debug gizmo (`?gizmos`,
`buildGrowthGizmos`) used to render a reserved cell as a distinctly-coloured but still
fully opaque, still depth-tested, still fog-affected box — which reads as *present* to
anyone looking at the shape rather than the colour legend, and genuinely disappears
behind opaque terrain or into heavy in-canyon fog for any cell more than a few columns
from the camera. Both defeated the one thing this view exists for: telling by eye
whether a cell is there. Fixed by giving every gizmo material `fog: false`,
`depthTest: false` (so nothing is hidden by terrain it's meant to be compared against),
and — the bigger change — not drawing a box at all for a reserved cell, rather than a
coloured one. An absent box can't be misread as present regardless of camera angle or
palette; a coloured one, it turns out, reliably was.

### Shaft/terrain mesh stitching

`CanyonGenerator.overShaft` omits terrain quads over a shaft's opening; `Shaft` builds
its own, completely independent bore geometry from an unrelated noise field. Nothing
used to connect the two — real, measured on Helion's cavern across three seeds before
writing the fix: gaps of 2 to 27 units (mean ~15) between the terrain's own cut edge and
the bore's own mouth ring. Floor-mounted digs (Kessler's shaft) turned out already fine
— `Shaft.boreAt(0)` resolves to exactly `dig.x`/`dig.halfWidth` at the mouth, matching
`overShaft`'s omission rectangle within `RELIEF` (2.6 units) by construction — so only
the wall-mounted case needed a fix.

The measurement also overturned the planned approach. The expectation going in was "two
closed loops, resample by arc length, align rotation and winding" — but `Shaft`'s own
mouth ring is never closed (deliberately open toward the camera, the same reason the
canyon itself is a cross-section and not a tube), and the terrain's hole boundary turned
out to have its own surprise: the height band `overShaft` tests is often *wider* than
`WALL_MOUTH_RUN` itself. The edge further into the wall reliably closes on a genuine
terrain crossing; the edge toward the canyon floor — where the wall eases into the wide,
gently-terraced blend (`CANYON.WALL_RUN`) — routinely never closes within the window at
all, so `overShaft`'s own clip *is* that edge, not a fallback for one. Both curves end up
monotonic in z regardless, which is what actually made the fix simple: bridge them by
matching z-station to z-station (a plain 1D lerp), never an arc-length/rotation problem.

Shipped as `CanyonGenerator.wallHoleBoundary` (walks outward from `dig.x`, stopping at
the first genuine crossing or the `WALL_MOUTH_RUN` window edge, whichever comes first —
this also makes a fragmented, multi-interval band impossible to return by construction)
and `Shaft.buildCollar` (bridges that boundary to the bore's own `mouthEdges()` ring with
two triangle strips, colour lerped between the terrain's real `shade()` output and the
lining's own `rockAt()` — position-only continuity still reads as a seam if the colour
jumps). Render-only; the physics collider (`Shaft.addColliders`, `carveWallMouths`)
already starts from the same mouth-ring/height-band criteria and needed no change. A
dig `wallHoleBoundary` can't resolve cleanly for (should not happen for any dig
currently in the campaign, verified across seeds) skips the collar rather than
fabricating one — the same "fail contained, not silently wrong" precedent `findAnchorX`
and `applyDigAttachments` already set.

One separate, unrelated artifact found while measuring, deliberately left alone: a
floor-mounted dig's own rim carries a redundant near-vertical sliver of terrain (one
cell wide, spanning the dig's full depth) just outside `overShaft`'s omission rectangle,
where the pit-blend transition still draws a quad. Overlap, not a gap — almost certainly
hidden behind the opaque shaft wall from normal play angles — and a different failure
shape than what this pass was for. Possible follow-up: does `overShaft`'s floor-mount
rectangle need to grow by one cell to swallow it.

Earlier sections below are kept for the design rationale; per-section **Shipped** tags
mark what landed at each stage. `docs/colony.md` predates this file and still describes
the pre-growth tower/gantry/mast system — it has not been brought current.

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
- ~~`cappedMouths` generalisation for wall-mounted mouths~~ **Shipped** — see
  "Terrain-aware fitting" above.
- ~~**Corner shafts.**~~ **Shipped for both digs.** Helion's is seed-derived
  (`anchorToWall`, `TerrainDigs.ts`), wall-mounted rather than a floor pit near centre.
  Kessler's shaft is now anchored the same way, via a second `mount: 'floor'` mode on
  `WallAnchoredDig` — this item's own earlier note claiming Kessler "would stay
  `isFloorMounted` even wall-anchored" turned out wrong once actually traced through
  `wallNormalInward`: that function's direction math (both its real-slope branch and its
  explicit 60°-off-vertical shallow-slope fallback) never returns anything close to
  straight down, on any wall, on any seed — its own doc comment says as much, and exists
  specifically to prevent a shallow-slope probe from reading as accidentally vertical.
  Reusing `mount: 'wall'` unmodified for Kessler would have silently turned its shaft
  diagonal, contradicting a campaign's worth of "come down straight" briefing text.
  `mount: 'floor'` sidesteps the wall-slope math entirely: it only moves `x` (pulled
  back toward centre from the wall edge, the opposite direction from a wall mount's own
  inset), and keeps `Excavation`'s ordinary straight-down default. See "Shaft/terrain
  mesh stitching" below for the other half of what made this dig-repositioning work
  worth finishing.
- **Scaffold visuals.** The X-brace placeholder reads as a flat star from the flight
  camera; a second crossing plane was tried and read worse. The real fix is rendering
  scaffold cells with `latticeMembers` (Colony.ts's own frame vocabulary), which is the
  module-vocabulary step — deliberately not hacked around further.

## Recommended next step

Campaign wiring is done — see Status at the top. What's still open:

1. Swap the plain boxes/cylinders for the real per-corp module vocabulary (the old
   `buildTower`'s barrel/box/lattice, now deleted along with `buildTower` itself — see
   git history), so a grown structure actually looks like it belongs next to what the
   campaign used to hand-author. The highest-value remaining item: the placeholder
   geometry is in every mission of the real campaign, and there is no longer a
   hand-authored structure anywhere in the game to compare it against.
2. Ixion's colony freezing at their mission-28 shutdown — `synthesizeColonies` needs a
   corp's *last* active mission, not just missions-elapsed; small, and the lore already
   supports it.
3. ~~Colliders.~~ **Shipped.** `buildColonyStructure` gives every occupied cell a
   full-cell physics box — one box per cell rather than one for the whole footprint,
   because a grown colony's silhouette is stepped and one-sided, not a clean rectangle
   the way a hand-authored tower's was. Still coarser than the eventual right answer:
   a room and the open lattice of a scaffold cell get the identical solid box today, so
   a scaffold cell reads as more solid to the physics than it does to the eye. Tightening
   that is bundled with item 1 — once scaffold renders as `latticeMembers` instead of an
   X-brace placeholder, its collider should be sized to match.
4. ~~**`growGrid`'s own occupancy/connectivity rules.**~~ **Shipped.** The old rule —
   a cell above ground was occupiable only if the cell below it was occupied, *or its
   anchor-side lateral neighbour was a room* — meant a column could only ever hand
   support off to the column one step farther from the anchor, never receive it back
   from one reaching in. That one-sided rule is the actual, diagnosed cause of the
   "narrow towers with open canyon between them" read: once a gap opened in a row's
   anchor-out cascade, nothing on the far side of it could ever be reached or reach
   back — not a density/tuning problem, a connectivity one. Replaced with a genuinely
   bidirectional flood: every below-supported column in a row seeds simultaneously, and
   support spreads outward through rooms in *both* directions, with cells reached
   through an already-decided room drained ahead of ones only reached through bare
   ground (the "priority vs. fallback" split — without it, a low-information ground
   seed could still claim a column moments before the real room-connected wave reached
   it, quietly reintroducing the old bias from the other end). Independent spines
   started in the same row now *merge* rather than standing apart, and a reserved
   flight corridor gets walled in from both sides instead of one. The many compensating
   terms this replaced (`colCeiling`, `wallBoost`, `edgeBias`, `lateralBoost`,
   `spatialNoise`, `isSkybridgeRow`, `isVerticalBreak`) are all gone — each was
   papering over the one-sided rule without fixing it, and the height/shape variety
   they were faking now falls out of the flood's own branching and dead-ending.

   Three more passes, added at the same time, round out the room-type read: **deep
   rooms** (well surrounded, or against a wall corp's own cliff face) **merge into
   bigger rooms** (`ColonyGrid.roomClusters`, capped at 4 cells, rendering-only —
   `cells` itself still marks every member `'room'`); **frontier leaves** — a room
   touching at most one other room — **sometimes demote back to scaffold**, reading as
   a construction-in-progress edge rather than a finished one (guarded against
   orphaning a room from the rest of the network — a real bug caught by the test suite
   during this work, not just designed around: demoting a leaf without checking what
   depends on it could leave a *different* room with zero room-neighbours, which
   `wouldOrphanRoomNeighbor` now rules out before any coin gets flipped); and each
   **column's topmost occupied cell gets a mast/antenna** (`ColonyGrid.tips`), the
   direct implementation of the "masts cap the column" idea this file names above but
   never wired up before. See `ColonyGrowth.ts`'s own doc comments for the full
   invariant list and why each one still holds under the new rule.
