# Plan: Mycelial Colony Growth

## Status

**Live in the campaign**, replacing the previous model outright — `ColonyGrowth.ts`,
`ColonyGeneration.ts`, `ColonyAvailability.ts`, their tests and the `?growth` demo scene
are all deleted. `Game.loadMission` and the inspector both call `planColonies`.

### The guarantee

**A colony never disappears and never loses a cell.** Measured over six seeds × thirty
missions — 486 corp-missions: zero disappearances, zero colonies under ten cells, zero
cells lost, smallest colony 13 cells, median 26. `ColonyPlan.test.ts` holds this as a
test over every consecutive mission pair, asserting *cell-position inclusion* rather than
counts, because a count that merely stays level would also pass for a colony demolished
and regrown somewhere else the same size — which is exactly what used to happen.

Four things make it structural rather than lucky. Each replaced a measured failure:

1. **Growth walks the campaign forward.** `planColonies` replays missions 1..N, each
   starting from what the last actually built, rather than deriving mission N alone.
   Deriving one mission looked equivalent — growth builds in a fixed order, so a bigger
   budget just runs the sequence further — but the *world* changes underneath: a new pad
   reserves a route, and a route landing on a colony's home does not merely stop it, it
   moves the spore search and regrows a different colony. Sixteen shrink events across
   three seeds, including Helion dropping 45 cells to 9 the mission its own cavern route
   appeared, and staying there for eleven missions.
2. **Every route the campaign will ever have is reserved from mission one.** A colony is
   drawn toward its own corp's pads, so it builds densely exactly where that corp's *next*
   pad goes, and that pad's route then demolishes it. Twelve demolitions, one taking
   Ixion's entire sixteen-cell colony to nothing at mission 2. The cost is a permanent gap
   where a future approach will be, which reads as canyon.
3. **The canyon is graded for the whole campaign at once** (`campaignPadSites`). Levelling
   a bench under a pad moves terrain; grading one mission at a time meant the ground a
   colony was grown on changed underneath it. Ixion's entire mission-1 colony relocated at
   mission 2 when the first pad's bench appeared under it.
4. **Growth reads the natural rock, excavations excluded** (`ColonySubstrate.ts`). Digging
   Kessler's shaft at mission 15 altered the ground near x=60 enough to flip a race Ixion
   had won for fourteen missions; twelve of its cells came back as Kessler's. Nothing was
   demolished — the cells were never built, by a colony recomputing a past it no longer
   had. Excavations only remove rock, so ignoring them makes the substrate a pure function
   of the seed.

Cost: about 3ms per mission step, against a canyon build's 800ms.

### Source, gravity and shape are separate, per corp

The three things that decide where a colony is and what it looks like are independent
knobs, which is what makes a corp's character something you configure rather than
something you fight:

- **Source** — its spore, where the colony starts (`sporeFor`).
- **Gravity** — the point it leans toward as it grows (`apex`, weighted by `W_APEX`).
  Wall corps lean at the lattice's top centre; Ixion leans at the canyon's own bottom
  centre, because it is the outpost on the floor.
- **Shape** — per-corp multipliers on the lateral preference and the height cost
  (`shape`). Ixion grows as a pine: the floor between the routes is all the width it will
  ever have, so it spends its budget upward instead of starving against the sides.

**Spore selection must be nearest-first.** Picking the *roomiest* candidate instead was
tried and is badly wrong: the roomiest ground in the canyon is whichever wall is least
built on, so Ixion walked over and took the ground Helion was going to root in, and 75 of
486 corp-missions fell under ten cells. Roominess survives only as a tie-break between
candidates at equal distance.

### Sideways branches

Support is a bounded **reach**, not a binary: a cell may cantilever up to `MAX_CANTILEVER`
bays from real load-bearing before it needs a leg. Without it the only legal move off the
top of a strand is straight up, and the canyon filled with one-cell-wide poles. Rock,
ground, a colony's own roof, or two neighbours all count as load-bearing.

### Open, with measurements

- **Exits should lean toward the canyon's middle as they climb, and do not yet.** This is
  the biggest single item. Each pad ascending in its own column slices the upper canyon
  into as many narrow vertical strips as there are pads; colonies fill the strips, and
  that — not anything in the growth rules — is why a colony comes out four times taller
  than wide. Converging the routes on the canyon's real centreline measurably fixes it
  (width/height 0.27 → 0.31–0.50, median colony 26 → 37 cells) but at today's capacity it
  strangles whoever lives at the middle, which is Ixion by construction: 77 corp-missions
  under ten cells, and 127 if the convergence is limited to the upper canyon — worse,
  because colonies climb to rows 13–14 and that is precisely the ground it takes.
- **Depth is the unlock.** Two or three z-layers multiply buildable volume without
  touching the canyon's cross-section, which is exactly the capacity convergence spends.
  These two should land together. The growth rules are written so a third axis is an
  added neighbour set, not a rewrite.
- **Ixion drifts off the canyon middle on some seeds** — 32 units west on seed
  2135022333, because the middle is fully reserved there and the spore search walks
  outward. Raising its gravity did not move it (the spore, not the growth, is what is
  displaced); the fix belongs in how much of the middle the routes reserve.
- **The colony should read wilder and more organic.** Still a regular stack of modules
  rather than a branched mass.

Supersedes `procedural_colony_growth.md`, which stays as the design record of what was
tried and what it cost. That model shipped and is live in the campaign; this one replaces
it wholesale. The honest summary of why: it never fully worked. Not a tuning failure —
a modelling one. It decided every cell with an independent coin flip weighted by distance
from an anchor, so the output had no *parts*: no thing you could point at and name, no
build order, no reason for any particular shape. Every fix since has been another term
compensating for that (`colCeiling`, `wallBoost`, `edgeBias`, `lateralBoost`,
`spatialNoise`, then a bidirectional flood, then room clustering, then frontier demotion),
and each one made the next failure harder to reason about.

## What the colony is now

**A mycelium.** Three organisms — one per corp — growing across the canyon's rock as
filaments that branch, creep along surfaces, thicken into modules, and compete for the
same substrate. Not a mass extruded from an anchor.

That single change carries most of what the old model needed separate machinery for:

| Property | Old model | Mycelium |
| --- | --- | --- |
| Growth over the campaign | `reach = maturity × maxDist`, a radius | number of simulation steps — literally "how long it has been growing" |
| Climbing a wall | impossible; one flat floor sample per colony, level rows | free: a tip creeps along whatever substrate it touches, and a wall is substrate |
| Corp territory | `blockedGlobalCols`, `wallAnchors`, `nearOtherWallAnchor`, ordered claims | first tip to reach a cell owns it; three organisms in one loop |
| Structure/variety | six noise terms tuned against symptoms | branching, dead-ending and thickening, which are three local rules |
| Maze around a flight route | hoped for, emergent, unverified | hyphae are repelled by the route and hug its walls, by construction |

## The one hard guarantee

**Every pad ever built keeps a permanent flight channel to the rim, and colony never
enters it.** Not the pad currently targeted — every live pad, forever, so the canyon
accumulates a route network that all later growth must respect. This is stronger than
the rule it replaced (a vertical column over the target pad's core, `CORRIDOR_HEIGHT`
tall) in three ways: it covers every pad, it is a *route* rather than a column, and it follows the
route through a bore and out of a wall mouth rather than assuming approaches come
straight down.

Difficulty does not come from the airspace closing any more. It comes from the channel
being narrow and walled — the colony massed hard against both sides of the descent
instead of standing off in open canyon. That is the labyrinth the previous plan wanted
and could only hope for.

## Architecture

Six modules, each with exactly one job. The pain this replaced was that terrain sampling,
coordinate conversion, corp politics, pad safety and the growth rule all reached into
each other; nothing below reaches sideways.

```
Canyon (real terrain, already built)
   │
   ├─ Lattice ........ the only place that converts (col,row) ⇄ world (x,y)
   ├─ Substrate ...... per cell: SOLID / SURFACE / OPEN, from real terrain
   ├─ Channels ....... flight routes for every live pad → the forbidden cell set
   │
   └─ Growth ......... the organism. Pure. Knows nothing about pads, corps or terrain
                       sampling — only substrate, forbidden, spores, step budgets, seed
   ↓
   Plan .............. composition root: campaign facts in, Prop[] out
   Render ............ cells + links + birth steps → meshes and colliders
```

### 1. `ColonyLattice.ts` — coordinates, once

Owns `cellSize`, the row-0 datum (`canyon.lowestFloorY()`), and the column bounds
(from `canyon.canyonWidthAt` at the lattice ceiling). Converts both directions and
nothing else. Every other module speaks `(col, row)` and never does arithmetic on world
coordinates.

This exists because the old code had five overlapping notions of position — global col,
local `c`, `place.x`, `colBoundsLo`, and `FLOOR_BASE` standing in for real terrain in
`Layout.ts` — with conversions duplicated across four files. Two live bugs came from
exactly that duplication.

- `cellSize = 12` — unchanged, and now load-bearing rather than incidental: a cell is
  **one module**, pad-sized (pads are 7–12 wide). "This cell will become a building" is
  only a legible promise when a cell *is* a building.
- `rows = 20` — floor to rim (`RIM_Y` 240), not the old 12. Growth climbs walls now, so
  the ceiling has to be the rim, not an arbitrary height above the floor.

### 2. `ColonySubstrate.ts` — what can be grown on

Replaces `ColonyAvailability.ts`. Same real-terrain sampling, but it answers a richer
question, because mycelium needs to know where the rock *is*, not just where it isn't:

- **SOLID** — real terrain covers the cell (the existing >50% coverage test).
- **SURFACE** — open air, but orthogonally adjacent to SOLID. The growable skin: canyon
  floor, wall faces, terrace benches, a dig's shoulder. This is the class the old model
  had no concept of, and its absence is why nothing could ever cling to a wall.
- **OPEN** — air with no rock adjacency. Reachable only by growing out from structure.

### 3. `ColonyChannels.ts` — the route network

For each live pad (built by this mission, not decommissioned), a polyline from the deck
to the rim, assembled from parts that already exist:

1. **Inside a dig** — the bore's own axis, from `Shaft.boreAt`. A pad partway down a
   shaft is approached down that shaft; nothing else is flyable and nothing else should
   be claimed.
2. **Through the mouth** — for a wall-mounted cavern, out along the bore direction until
   clear of the wall. Straight up would be through solid rock, which is exactly the case
   the old vertical-column rule got wrong.
3. **Ascent to the rim** — from there, one row at a time, choosing the lateral offset that
   maximises clearance from SOLID, limited to one column of drift per row so the result
   is flyable rather than a zigzag.

Rasterised to cells with a width contract: **every point on the polyline has at least
`CHANNEL_HALF = 8` units of colony-free air perpendicular to it.** Strictly more than
`CORE_HALF` (5), and enforced along the whole route rather than only above the deck.

Two channels that overlap simply union — a shared trunk is what a road network looks
like, and it costs the colony less territory than three parallel shafts of empty air.

`checkLayout` then flips from "no prop sits in a corridor" to "no colony cell sits in a
channel". True by construction; kept as the net that catches a construction bug, which is
the same reason the current check is kept.

### 4. `ColonyOrganism.ts` — the organism

Pure. Signature roughly:

```ts
growColonies(input: {
  substrate: Substrate,
  forbidden: (col, row) => boolean,   // channels, pad decks, out of bounds
  spores: Array<{ corp: CorpId; col: number; row: number }>,
  steps: Record<CorpId, number>,
  seed: number,
}): ColonyCells   // Map<cellKey, { corp, birthStep, links: Dir[] }>
```

State is a set of **tips** (position, heading, corp, energy, age) plus the claimed cells.
One global step advances every live tip once, in a stable order, all three corps
interleaved. A tip:

- **Scores its neighbours.** Rejected outright: forbidden, SOLID, already claimed by
  another corp, or unsupported. **Support** is the no-floating rule, and it is the rule
  that lets the colony leave the ground: a cell is supported if any neighbour is SOLID
  rock or an existing colony cell. Not "the cell below is occupied" — that rule is what
  forced the old model to be a floor-standing mass with level rows.
- **Prefers substrate** (thigmotropism — real hyphae creep along surfaces rather than
  crossing voids). This is the entire reason a colony ends up spread across a wall face
  and terraced along benches instead of forming a block.
- **Is attracted to its own corp's hardware** — its live pads and digs. A colony grows
  toward the things it services. This replaces a hand-authored "reach toward the canyon
  centre" bias with a reason.
- **Is repelled by channels and by rival cells**, mildly, so it hugs a route's edge
  without ever entering it, and two organisms meeting produce a visible seam rather than
  interpenetrating.
- **Moves** to the best-scoring candidate with seeded jitter (`hash01`, never a
  `sin()`-based hash — see `Noise.ts`'s header for why), records the parent→child link,
  and spends energy.
- **Branches** with a probability that rises with local substrate quality, spawning a
  second tip. Branching and dead-ending are where all shape variety now comes from.
- **Dies** with no legal candidate, or out of energy. Bounded growth without a distance
  clamp.

Everything the old model needed a separate term for is one of these five behaviours.

### 5. `ColonyPlan.ts` — composition root

Campaign facts in, `Prop[]` out. Decides:

- **Spores.** One per active corp: the SURFACE cell nearest that corp's claim centre —
  Helion on the west wall face, Kessler on the east, Ixion on the floor between them —
  skipping forbidden cells. If none is available the corp simply has no colony this
  mission, contained rather than papered over. This one rule replaces `findAnchorX`,
  `wallEdgeColumn`, `wallAnchors` and `nearOtherWallAnchor` entirely.
- **Step budget** per corp: `steps = round(6 + 34 × maturity + 6 × quality)`, where
  maturity is how far into its own mission sequence the corp is and quality is its mean
  best rank. Both terms only ever rise as the campaign progresses and as ranks improve,
  so a colony can only ever be older, never younger.
- Splits the resulting cell map into one `colony` prop per corp, so `Layout.ts` keeps
  per-corp footprints.

### 6. `ColonyRender.ts`

A cell's mesh is chosen by **what it links to** and **how old it is**, both of which the
simulation already produced — no new noise field.

- **Age → scaffold or building.** `steps − birthStep < FRONTIER_STEPS` renders as bare
  lattice frame (`latticeMembers`, the game's real frame vocabulary); older renders as a
  hull module. This is the promise the player can check: the scaffold at the edge last
  mission is a building this mission, and the scaffold has moved one ring out. It also
  makes maturity physical rather than a formula, and the transition only runs one way.
- **Degree → shape.** One link = end pod. Two collinear = a can. Two at a corner = an
  elbow node. Three or more = a hub, drawn larger. Links themselves are the walkways —
  derived from real parent/child growth, not from "any two adjacent rooms", so the
  network reads as something that grew outward from one point.
- **Colliders.** One full-cell box per occupied cell, scaffold included. A grown colony
  stays lethal on contact, and flyability is carried entirely by the channels rather than
  by gaps in the massing.

## Determinism and monotonicity

Same seed, same campaign position, same ranks ⇒ identical colony, as required. Two
honest exceptions, recorded rather than hidden:

- **A new pad's channel can cut through existing colony.** New pads appear over the
  campaign; their route is absolute. Cells in the way go. That is a demolition, it is
  lore-consistent (the charters already demolish their own work — mission 19), and it is
  the safety rule outranking growth by design.
- **Simultaneous competition couples the corps.** A corp growing faster this mission can
  take a cell its rival held last mission. The contest was the point; per-corp
  monotonicity was not a guarantee worth buying it back with.

## Implementation order

Straight into the campaign, replacing the old path — no parallel flag, no standalone
demo scene. Each step below leaves the game running.

1. **`Lattice.ts` + `Substrate.ts`**, with tests against real seeds asserting that a wall
   cell reads SOLID low and SURFACE where the wall recedes with altitude (the exact
   per-cell property the old model verified live at seed 1009610).
2. **`Channels.ts`**, plus flipping `checkLayout`'s corridor rule to a channel-clearance
   rule. Verifiable before any growth exists: assert every live pad in all 30 missions has
   a channel reaching the rim, on many seeds.
3. **`Growth.ts`** pure and tested: determinism, no floating cells, no cell in a forbidden
   set, monotonicity in step count, links form one connected network per corp.
4. **`Plan.ts` wiring** in `Game.loadMission`, replacing `synthesizeColonies`. Delete
   `ColonyGrowth.ts`, `ColonyGeneration.ts`, `ColonyAvailability.ts`, their tests, and
   `loadGrowthDemo`/`?growth` — the demo existed to prove the mechanism in isolation, and
   shipping in-campaign supersedes it. `?gizmos` and `?colonies` re-point at the new
   model.
5. **`Render.ts`** — module vocabulary and the scaffold frontier. Last, deliberately: the
   thing to be wrong about first is where cells go, not what they look like.

Then measure it in the browser the way `CLAUDE.md` requires for anything geometric —
walk the built group, transform each mesh's bounding box by its `matrixWorld`, and assert
no colony cell intersects any channel volume on real seeds. Geometry that passes every
test and still looks wrong is the failure mode this whole rewrite exists to escape.

## Deferred to v2

- **Shallow depth (z).** 2–4 layers so the colony has thickness and the backdrop rows can
  be the same organism at a different seed rather than a separate generator. Deliberately
  out of scope; the growth rules are written so a third axis is an added neighbour set,
  not a rewrite.
- **Multi-cell modules.** Cells stay 1:1 with modules for now; a vocabulary of 2×1 and
  2×2 pieces snapped onto clusters of linked cells is a rendering-layer change later.
