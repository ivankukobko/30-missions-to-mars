# Plan: Mycelial Colony Growth

## Status

**Live in the campaign**, replacing the previous model outright — `ColonyGrowth.ts`,
`ColonyGeneration.ts`, `ColonyAvailability.ts`, their tests and the `?growth` demo scene
are all deleted. `Game.loadMission` and the inspector both call `planColonies`.

### Where it stands

Measured across seven seeds × thirty missions, counting from mission 10 so a corp that has
only just arrived is not scored as starving — 441 corp-missions: **zero with a play-plane
face under ten cells**, median face 39, median colony 45 including the layers behind it,
median width-to-height 0.50 (it was 0.27 when a colony read as four times taller than
wide). Routes reserve **14–16%** of the open lattice by mission 30, and the widest corridor
in the upper canyon is one or two cells. Every cell lost anywhere in the sweep is a cell a
flight channel or risen rock now occupies.

### Nothing is reserved before it exists

**Ground becomes forbidden on the mission its structure appears, and not one mission
earlier.** A pad reserves its deck, its bench and its flight channel when the pad is built;
a shaft reserves its mouth when it is driven. The forbidden set at mission *m* is derived
from the pads and digs standing at mission *m*, and nothing else — `planColonies`
re-rasterises the whole network on each step of its campaign walk.

This replaced the opposite rule, and the trade is worth stating plainly because the old
rule was load-bearing for a guarantee that is now gone. Rasterising the whole campaign's
network once, from mission one, made the forbidden set monotonic: it could never grow, so
growth could only ever add, so **a colony could never lose a cell** — structurally, not
luckily. What it cost was a canyon full of keep-out for approaches nobody had flown. On
mission 1 the player was looking at mission 30's airspace: around a third of the open
lattice sterile before the second delivery, and every colony in the game grown around
obstacles that were not there yet.

So a colony can lose ground again, in exactly one way: a route appearing this mission
through cells it already occupies (`growColony` drops those from `existing`). That is a
legible event — the charter cleared its own approach — bounded by the width of one
channel, and it happens where the player can watch it happen.

**What replaced "never shrinks" is determinism.** A colony losing cells to a new approach
is a campaign event; a colony losing *different* cells when the player retries the mission
is unfairness they cannot argue with, because the world they crashed into is not the world
they get back. `planColonies` is a pure function of (mission, seed, ledger), so a retry
replays the identical demolition. `ColonyPlan.test.ts` asserts both halves: every cell
that disappears is a cell a channel now occupies, and planning the same mission twice is
byte-identical.

A *decommissioned* pad keeps its reservation. That is not premature — the route was flown
and the ground stayed clear the whole time it was — and releasing it would let a colony
grow into a corridor that was open air a mission ago, which reads as structure appearing
out of nothing rather than as a colony growing.

Three things that were structural are still structural, and each replaced a measured
failure:

1. **Growth walks the campaign forward.** `planColonies` replays missions 1..N, each
   starting from what the last actually built, rather than deriving mission N alone.
   Deriving one mission looked equivalent — growth builds in a fixed order, so a bigger
   budget just runs the sequence further — but the *world* changes underneath: a new pad
   reserves a route, and a route landing on a colony's home does not merely stop it, it
   moves the spore search and regrows a different colony. Sixteen shrink events across
   three seeds, including Helion dropping 45 cells to 9 the mission its own cavern route
   appeared, and staying there for eleven missions. This is what keeps a demolition a
   *demolition* rather than a relocation.
2. **The canyon is graded for the whole campaign at once** (`campaignPadSites`). Levelling
   a bench under a pad moves terrain; grading one mission at a time meant the ground a
   colony was grown on changed underneath it. Ixion's entire mission-1 colony relocated at
   mission 2 when the first pad's bench appeared under it. Note this is *grading*, not
   reserving — the terrain has to be one shape for the whole replay or history rewrites
   itself; airspace does not.
3. **Growth reads the natural rock, excavations excluded** (`ColonySubstrate.ts`). Digging
   Kessler's shaft at mission 15 altered the ground near x=60 enough to flip a race Ixion
   had won for fourteen missions; twelve of its cells came back as Kessler's. Nothing was
   demolished — the cells were never built, by a colony recomputing a past it no longer
   had. Excavations only remove rock, so ignoring them makes the substrate a pure function
   of the seed.

Cost: about 3ms per mission step, against a canyon build's 800ms. Re-rasterising per
mission rather than once did not change that materially.

### Paths collapse into one wherever one is present

A climb that arrives in a column another route already occupies **adopts that route's
points verbatim and stops** (`routeFor`). Above the merge the two are one polyline: one
corridor, one reservation, however many pads share it. Routes are laid deepest-deck-first,
so the longest climb establishes the trunk and everyone else joins it. Two roads running
side by side up the same canyon are two corridors' worth of keep-out doing one corridor's
job, and no player reads them as anything but a wide red band.

**Joining and trunk-seeking are separate rules, and only the second is height-gated.**
Joining a way that already exists happens at any height, because it costs nothing — the
column is already reserved by whoever got there first. Bending toward the canyon's
*centreline* when there is nothing to join is gated to `CONVERGE_ABOVE` (35% of lattice
height), because that is the half that costs floor: a route leaning inward from row 0 puts
the trunk on the same columns as `outpost-main`'s own deck and bench, and between them they
leave no unreserved floor at all. Measured on seed 12345, rows 0 and 1 came out with two
free cells in the entire canyon, both against the east wall — so Ixion, whose home is the
middle of the floor, rooted on Kessler's wall instead and Kessler finished with one cell.

Merging is what made convergence affordable at all. Steering every route at the middle
*without* it is measurably worse than leaving them straight — 77 of 486 corp-missions under
ten cells against 0 — because the diagonals cost ground on the way in and the routes still
ended in separate columns.

One consequence worth knowing: **a route is no longer fixed once laid.** A pad added this
mission can re-lay the trunk, and the ways feeding it move with it, so ground is released
as well as taken. That is why the demolition test walks consecutive missions rather than
checkpoints — sample every fifth mission and a cell taken by a corridor at 17 reads as
"lost to nothing" at 19, because by 19 the corridor has moved on.

### The colony is three layers deep

`COLONY_LAYERS` is `[-1, 0, 1]` — the play plane and one layer in front of and behind it,
a cell-size apart. Every problem this model has fought is the same shortage, which is that
a canyon cross-section has no spare volume: Ixion hemmed into a one-column slot, a corridor
costing a charter its ground, free cells stranded in pockets nothing can reach. Three
layers is three times the buildable volume without widening the canyon by a unit.

**Only layer 0 is the play plane**, and the rule has to be one rule in three places or it
is not a rule: it carries the colliders (`PhysicsWorld` is a 2D cross-section — `addBox`
has no depth argument), it is the only layer `Layout.ts` judges, and it is the only one a
flight channel reserves. The layers front and back therefore build *straight past* a
corridor, which is most of what depth is for: a route becomes a slot cut through a deep
mass rather than a gap the settlement politely grew around.

**Depth is a last resort, and it has to be a rule rather than a weight.** A depth move can
only be scored as a flat constant — the cell behind is the same column, the same row, the
same distance from every attractor and every apex — and a flat constant competes with the
*average* in-plane score rather than the best one, so it wins far more often than it looks
like it should. At 0.45 colonies reached 65 cells while the play-plane face collapsed from
40 to 12, with 121 of 441 corp-missions under a ten-cell face. Dropping the constant to
0.05 only moved the number to 66. Gating it on viability instead — depth offered only when
a tip has nothing worth doing on its own layer — got to 43, and gating it at the *colony*
level (`budTips`, which is the only thing that looks at every cell a corp owns) got to
**zero**, with the face back to a median of 39. A tip stuck in a corner must defer to the
face the colony still has elsewhere; letting it turn backwards was worth twenty cells of
silhouette a mission.

**The rock profile is sampled per layer.** A canyon wall flares and wanders in z as well as
y, so one profile for all three would put a module inside the wall on one layer and
floating clear of it on another — invisible in a test, obvious on screen.

**Branches seed the layers; the leading tip never does.** Depth as a pure last resort is
right for the tip drawing the silhouette and wrong for the colony as a whole — the layers
only start filling once a colony is essentially finished, so they arrive late, all at once,
and only for whoever happened to be boxed in. A quarter of branches now go backwards
instead of sideways (`DEPTH_BRANCH_CHANCE`), which costs the face nothing because a branch
is a second front by definition. Measured across seven seeds: single-layer colonies fell
from 37% of corp-missions to 1%, and the three layers came out 838 / 732 / 578 cells with
the play plane still the plurality. The face pays for it in size — median 51 → 34 at a
fixed budget — and that is the real trade: at 0.5 the split is even thirds but the face
drops to 29 and five corp-missions fall under ten cells.

**Modules are elongated along z, and the layers moved apart to suit.** A module used to be
a cube — `moduleScale` gives 0.54–0.78 of a cell in x and y, and the depth clamp of 15 that
a 9-unit module never reached — so the camera saw one face of each and a settlement six
cells across came out as flat as the wall behind it. At flight distance the only cues that
survive the fog are silhouette and the different angle a *side* face catches light at, and
a cube seen head-on has neither. Stretching depth to 1.6× the cross-section gives both.

That forced the layer spacing: at one cell apart, modules a full cell deep abut face to
face and fuse the three layers into a slab. Spacing is now two cells, and the depth cap is
*derived* from it (`COLONY_LAYER_SPACING − LAYER_GAP`) rather than written down beside it —
two constants that have to agree, agreeing by coincidence, is how a later edit to either
quietly fuses the layers again, and the failure does not look like a bug, it just looks
slightly wrong.

**Aerial perspective applies behind the play plane only.** The dimming and shrinking that
separate the layers were keyed on `|layerZ|`, so the *foreground* layer was treated as
though it were as distant as the background one — darkened 34% and shrunk to 88% while
perspective drew it larger than everything else, since it sits two cells nearer the camera.
A near thing lit like a far thing and sized like neither reads as a separate, wrongly-scaled
object rather than as the front of the same building. Front and play-plane modules are now
identical in all three dimensions; only what is behind is dimmed and narrowed. The front
layer needs no help to read as nearer — perspective, its own lit side faces and the fade
around the lander already say so.

**The foreground layer is faded only where it is in the way.** A module at z = +cellSize
sits between the camera and the vehicle. The first version made the whole front layer
translucent for the entire mission, which solves the occlusion and throws away what the
layer was for — a colony you can see through everywhere reads as a diagram rather than as
mass. It now keeps a soft hole around the lander (`FRONT_FADE_RADIUS`), the same trick a
third-person camera uses on a wall, driven by a world-space distance term patched into the
stock standard material through `onBeforeCompile`. Away from the vehicle the layer is fully
opaque and the settlement looks deep.

**A rival's seam counts as fenced.** The depth gate asks whether the colony has anywhere
worth going on *unclaimed* ground, not merely anywhere legal — a move onto a competitor's
edge clears `MIN_SCORE` easily, since `W_RIVAL` docks it 0.7 and a surface bonus pays that
straight back, so a colony boxed in by neighbours rather than rock never discovered it had
a third dimension. Both options stay on the table once the gate opens, scored against each
other, because a seam does have to get built by somebody.

It is a smaller effect than it sounds, and the reason is worth recording: on seed
631729407 Ixion takes the eastern floor during missions 1–4, *before Kessler exists*. No
rule about rivals can prevent an invasion that happens before there is anyone to invade —
what governs there is the four-mission head start the outpost has by construction.

**Depth is where flying well becomes visible, and this was not designed — it fell out.**
A budget is `4 + 66·maturity + 16·quality`, and depth only unlocks once the face is full,
so the sixteen cells that landing ranks are worth are almost exactly the cells that spill
into the layers behind. A rank-C campaign spends its whole allowance on the face and stays
one layer deep; an S campaign is two layers deep by the middle of the campaign. Measured on
seed 631729407 at mission 16, Kessler is `z0:35` with no ranks and `z−12:17 / z0:34` with
all S; by mission 30 it is `z−12:50 / z0:34` — more structure behind the play plane than on
it, with the face still healthy. **Every sweep quoted in this document uses empty ranks**,
so the figures here are the floor rather than the typical case.

Rendering: one merged mesh set per corp *per layer*, so a layer can be dimmed and shrunk
with distance (`LAYER_DIM`, `LAYER_SHRINK`) and the front layer faded (`FRONT_OPACITY`) so
it cannot hide the lander. Transparency rather than culling — a hole where a building
should be is worse than a translucent building. Only the play plane casts shadows.

### Pads and floor bores are snapped to the lattice

`snapToColumn` moves every authored pad and every floor-mounted bore onto the nearest
column centre — at most half a cell of drift, on positions that were round numbers somebody
typed in the first place. A wall bore is left alone: its `x` *is* the wall face, and the
mouth ring, cave roof and bore geometry are all built from it.

Keep-out is rasterised per cell, so an approach running *between* two columns takes both —
twenty-four units of canyon for a corridor that needs twelve — and the deck keep-out either
side does the same. With the reservations narrowed to what the layout rules actually
require (the columns a deck genuinely overlaps, rather than `width/2 + cellSize/2`; one
bore-width of headroom over a mouth, rather than a chimney to the rim), the whole network
came down hard:

| | before | after |
|---|---|---|
| reserved share of open lattice | 30–38% | **18–23%** |
| widest corridor, upper canyon | 4 cells | **1–2 cells** |
| median colony (441 corp-missions) | 33 | **37** |
| corp-missions under ten cells | 7 | **0** |

The mouth change needed `Layout.cappedFloorMouth` to grow a height test — it had none, so a
colony module a hundred and fifty units up capped a shaft it could not reach, and the
reservation had to run that high to stay a superset of the check. One bore-width above the
lip is the honest reading of "at the doorway"; above that the descent is governed by the
route check, which measures the real approach.

### Source, gravity and shape are separate, per corp

The three things that decide where a colony is and what it looks like are independent
knobs, which is what makes a corp's character something you configure rather than
something you fight:

- **Source** — its spore, where the colony starts (`sporeFor`). Home is the corp's own
  side of the *canyon*, never its first pad's column: `outpost-main` sits at x −14, so
  rooting Ixion at its pad shifts its whole search window west of centre and it goes
  hunting on Helion's half.
- **Gravity** — the points it leans toward as it grows (`apex`, weighted by `W_APEX`), and
  a **set**, not one point, pulled to whichever is nearest. All three lean at the canyon's
  top centre, which is what makes them arch in toward each other over the descent; for
  Ixion that point is straight overhead, so the lean is a pure climb.

  Ixion held the canyon's *bottom* centre for a while and it was wrong in a way the narrow
  seeds make obvious: a gravity point on the floor makes every upward move score negative,
  so a colony can only spend its budget sideways — and Ixion's budget arrives four missions
  before either rival exists. On seed 631729407 it had 36 cells by mission 5, laid flat
  across the east half of the floor and stopping dead at row 7, and Kessler landed at
  mission 6 to find its ground already built on. It also contradicted the pine shape below.
  What had made the floor point look necessary was a different bug — with skyward gravity
  Ixion used to cross the canyon and climb the *far wall*, because a rival's roof counted as
  footing and the trunk sealed the middle from row 0. Neither is true any more, and the
  shared skyward point took median width-to-height from 0.27 to 0.50.
- **Shape** — per-corp multipliers on the lateral preference and the height cost
  (`shape`). Ixion grows as a pine: the floor between the routes is all the width it will
  ever have, so it spends its budget upward instead of starving against the sides.

**A corp's own mid-air pads are gravity points too.** A deck bolted to structure at row 12
is somewhere the charter is obliged to be able to reach, so growth leans toward it, climbs
to it, and the scaffolding that appears underneath is structure the colony built for its
own reasons. The first attempt wrote those cells straight into the map beneath each raised
deck — bypassing support, budget and build order, so the "scaffolding" could stand in mid
air, belonged to no tip, and was invisible to every invariant the organism enforces.
Expressing it as gravity costs one term and cannot produce anything the model would not
have built anyway. Only pads genuinely in the air qualify: a deck down a bore or in a wall
face reads as solid substrate, and pulling a colony at rock only leans it into the wall.

**Spore selection must be nearest-first.** Picking the *roomiest* candidate instead was
tried and is badly wrong: the roomiest ground in the canyon is whichever wall is least
built on, so Ixion walked over and took the ground Helion was going to root in, and 75 of
486 corp-missions fell under ten cells. Roominess survives only as a tie-break between
candidates at equal distance.

**A starved corp gets a second nucleus, and this is the mechanism that carries the floor.**
A spore can land in a pocket that rock, a route and a bore mouth between them close off,
and because growth resumes from what already stands, that corp is otherwise stuck with its
bad start for the rest of the campaign. `ColonyPlan` offers another spore to any corp
below `STARVED` of what it should have built; the new tip is added as a second front
rather than replacing the work in progress.

`growColony` used to refuse it — "already standing, no second spore" — which made the
whole rescue path dead code and cost exactly what you would predict: Kessler spored into a
dead pocket on seed 2135022333 and sat at **one cell from mission 10 to the end of the
campaign**, the only corp-mission under ten cells in six seeds. Honouring the spore took it
to 40 and took the count of starved corp-missions to zero.

### A budget is capped by ground, not just by progress

**A corp's allowance is `min(what the campaign earned it, what it can actually reach)`** —
standing cells plus a flood fill out of them through free lattice (`reachableGround`).

Earned-only was what turned the rescue mechanism into an invasion, and the narrow-canyon
seeds show it plainly. On seed 631729407 Ixion is entitled to 45 cells by mission 30 and
its slot on the canyon floor is *one column wide*, boxed by descent corridors on both
sides. Permanently short of an allowance it had nowhere to spend, it read as permanently
starved, took a new nucleus every mission, and walked outward until it was sitting across
both other charters' walls — 45 cells in three disconnected masses. Capped, the same corp
builds 12 and stops, Helion holds the west at 52 and Kessler the east at 50.

The cap is what makes the starvation flag mean *boxed in* rather than *modest*. A corp in
a small pocket is contained: its allowance shrinks to fit and it asks for nothing. A corp
in a genuinely dead pocket has almost no reachable ground, so its cap sits at its standing
count and it is starved — which is the case the rescue spore exists for.

Two territory rules go with it:

- **Only a corp's own structure carries its load** (`reachOf`). Rock holds anybody up; a
  charter does not bolt its modules to a competitor's roof. Reading a rival's cell as
  footing is a free storey, and Ixion took it — boxed into its one-column slot, the only
  move left was up, and Helion's colony was the nearest thing to climb. Four rows deep
  across Helion's roof. `W_RIVAL` cannot fix this: a scoring penalty does not compete with
  the alternative being *no legal move at all*.
- **A rescue spore may not land on a rival's doorstep** — the eight-neighbourhood, not just
  the cell. The cell above a standing colony is as much an invasion as the cell itself.
  `OUTPOST_RANGE` also has to actually bind: it used to bound the search's cost loop while
  the per-candidate gate tested a limit that, for a corp already standing, was the whole
  canyon.

**Attraction to pads is a ramp, not a switch.** `homeward` fades in over six cells. Making
it a step — full pull until one cell away, then nothing — was tried with `W_ATTRACT` at
2.5 and starves colonies outright: any move away from a pad then scores −2.5 against a
−0.3 death threshold, so a colony becomes a one-cell-wide filament aimed at its own pad
and every tip dies on arrival. Kessler finished the campaign with a single cell on two of
five seeds.

### A raised deck is held up, not merely leaned toward

**A charter builds a supported column to its own mid-air deck before it spends budget on
anything else** (`spine`, derived in `ColonyPlan`, placed in `growColony` ahead of free
growth). Candidate columns are tried from the deck's own axis outward to
`MAX_CANTILEVER`, the highest-reaching one wins, and an offset column finishes with a
horizontal bracket back under the deck — each cell of which costs one step of reach,
which is exactly why the search never offers a column further out than the cantilever
allows.

Gravity toward elevated pads (`apex`) was supposed to do this and cannot. A weight biases
a direction; it does not guarantee an arrival. Measured over 208 deck-missions on eight
seeds before the spine existed: **63% had no cell of the deck's own charter beneath it**,
only 3% touched it from below, and the nearest own cell sat a median of 20 units from the
deck edge. `buildPad` draws no legs and no tower, so those decks were slabs in open air.

Counting cells *alongside* the deck as well — a room bracketed off a wall, which reads
perfectly well — only lifts that to 39% held.

### A deck's x comes from its charter's wall, not from a number

The spine alone got support to 71%. The rest was not a growth problem at all: the crest
decks were authored at a fixed `x` of ∓36 while the canyon's floor edge moves with the
seed by more than fifty units, and each charter's colony moves with it. On seed 0 Helion
spans [−126, −66] and its deck sat at −36 — thirty units clear of the entire colony, on
ground no growth rule could ever have reached, because it was not Helion's ground.

`xFromWall: 'east' | 'west'` resolves a deck to `floorEdgeAt(0, side)` at load, the same
way a shaft deck resolves off its bore. It is the rule the codebase already states —
prefer deriving a dimension over authoring one when a constraint fixes it — applied to
the one number that had no business being typed. **Support went to 100% of 208
deck-missions across eight seeds**, and `ColonyBalance.test.ts` holds it there.

### The budget must always move when the campaign does

`FIRST_MISSION_CELLS` held a corp's *own debut* at three cells, and `colonyBudget` was
being used on missions 6 and 7 as a floor to get stack under a crest deck. Between them
they froze the middle of the campaign: a charter jumped to 30 on its first mission,
dropped to 3 on its second, and because growth never removes cells it simply sat at 30
until the formula caught up eight missions later. Helion did not move from mission 6 to
20; Kessler from 7 to 19. Total cells across all three corps went 92 at mission 8 and 91
at mission 20 — while mission 8's brief tells the player, in so many words, that "the gap
you fly closes a little more each mission."

Two corrections. The opening floor is the *campaign's* first mission, not each corp's —
its whole purpose is that the first canyon the player ever sees reads as unclaimed, which
is not the situation a charter arriving at mission 6 is in. And `colonyBudget` is a cap
only; one field meaning both "hold this down" and "prop this up" is what let a
deck-support patch silently cost thirteen missions of pacing. Deck support is not a budget
problem and is not solved there any more.

### Sideways branches

Support is a bounded **reach**, not a binary: a cell may cantilever up to `MAX_CANTILEVER`
bays from real load-bearing before it needs a leg. Without it the only legal move off the
top of a strand is straight up, and the canyon filled with one-cell-wide poles. Rock,
ground, a colony's own roof, or two neighbours all count as load-bearing.

### Open, with measurements

- **The free middle of the canyon is unreachable, and this is the next real problem.**
  Reserved columns cut the open space into islands. A filament can never step through a
  reserved cell, so a pocket of free cells with a channel between it and the nearest colony
  stays empty for the whole campaign — on seed 12345 row 5 reads Helion, reserved, three
  free, reserved, Ixion. Nor can anything *start* there: a spore needs a `surface` cell,
  open air touching rock, and mid-canyon cells touch nothing. **Scaffold is the candidate
  fix** — today it is only a render state (the last-built ring drawn as bare frame), and
  making it a growth affordance would let a colony throw a cheap span toward an island and
  build rooms off it. Channels stay absolute either way.
- **Carving, rather than avoiding.** Growth currently treats channels as pre-existing walls
  and fills what is left, which is why the free middle fragments into islands and why a
  colony's shape is decided by corridors that were reserved before it started. The
  alternative is to grow against rock only and *subtract* the network afterwards — the same
  cells end up clear, but the settlement is one that grew and then had a lane cut through
  it, which is both the mycelial read and the "narrow and walled" difficulty this document
  already asks for. It needs a settle pass (carving out from under a mass leaves cells with
  nothing supporting them, and the drop can cascade) and it means budget spent on cells that
  are then cut away. Determinism is unaffected; subtraction is still a pure function of the
  mission.
- **A colony can be cut into disconnected pieces and nothing notices.** A route appearing
  through the middle of one leaves two masses that still report as a single prop with a
  single footprint. It looks fine and may even read well; it is simply not modelled.
- **Ixion drifts off the canyon middle on some seeds**, because the middle is reserved
  there and the spore search walks outward. Raising its gravity does not move it: the
  spore, not the growth, is what is displaced.
- **The colony should read wilder and more organic.** Still a regular stack of modules
  rather than a branched mass.
- **The parallax backdrop rows are switched off** (`BACKDROP_ROWS_ENABLED`, `Colony.ts`)
  while the grown shape is being tuned. They echo whatever the play plane is doing, so
  they double every silhouette under evaluation. A viewing decision, not a verdict.

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
- **Batched by transparency class, not by layer.** Two mesh sets — everything in front of
  the play plane, and everything at or behind it — rather than one per layer: 6 meshes per
  corp instead of 12.

  Per-layer batching existed for exactly one reason: `LAYER_DIM` was a multiply on each
  material's `color`, so a layer needed its own material to be dimmed. That is now a
  fragment multiply keyed off world z, sharing `LanderFade`'s existing world-position
  varying (`patchDepth` — one `onBeforeCompile` for both effects, since assigning it twice
  silently discards the first patch). A **vertex-colour** version was the obvious
  alternative and is wrong: three.js multiplies vertex colour into the diffuse term only, so
  the back layer's lamps would have kept full brightness while their housings dimmed — the
  exact cue whose absence flattened the three layers before. The fragment version also dims
  *continuously*, so a 19-deep module darkens along its own length instead of taking one
  flat tone.

  What this removes is the rule that no geometry may span two layers, which is what a depth
  merge needs. What survives is a gameplay boundary rather than a rendering one: the near
  class must be `transparent` with `depthWrite: false` to thin around the vehicle, and the
  play plane must write depth — so depth merging is available for layers **−1 ↔ 0**, never
  **0 ↔ +1**. The back layer now casts shadows along with the play plane, accepted
  deliberately: keeping it out would have meant a third class and put −1 and 0 back in
  separate meshes, defeating the change.
- **Surroundings → fittings.** `TRAIT`, a bitmask on `PlacedCell` alongside `links`, is the
  third thing a mesh varies on. It is set in `ColonyPlan`, never in growth and never here:
  the renderer's rule is that it reads facts the simulation produced and forms no second
  opinion, and the trait has to be decided where determinism is already guaranteed. A
  bitmask rather than an enum because a cell can be several of these at once, and an enum
  would force a priority order nobody has a reason to pick.

  `laneWest` and `laneEast` record a flight channel beside the cell — **two bits, because
  the side is the whole content of the fact.**

  The fittings split by what they are for. Every hull carries **one lit port**,
  camera-facing: the house design, saying only "pressurised and occupied". A cell beside a
  lane additionally carries **two stripes along that flank's top and bottom edges**, running
  in z. A fitting on the camera-facing side is edge-on to a pilot inside the channel — the
  one place it has to be legible from — so marking a route that way announces it only to
  someone already looking at the colony side-on. Edges rather than a bar across the middle
  of the face, because a pilot in a narrow lane sees the building foreshortened and what
  survives that is the outline; lighting the outline draws the shape of the gap being flown
  through. Walkways glow at **0.45** against the fittings' 1.3, which traces the settlement's
  connective structure out of a mass of dark cubes without putting texture on the same
  footing as the navigational signal.

  A horizontal band on the camera face was tried alongside the port and removed: two lit
  elements on the face you always see is noise, and the lane marking drowned in it. Walkways
  glowed for a while too and no longer do — a corridor is a duct between two pressure hulls,
  and a canyon where every duct is lit puts the plumbing on the same footing as the lane
  markings, which are the only thing a pilot actually steers by.

  **Scaffold carries corp lights at its eight corners.** A bare lattice has no surface to
  hang a fitting on, so it used to say nothing about whose it was — and scaffolding is the
  state the campaign most wants read at a glance, being the visible half of "this charter is
  still expanding". Corners rather than members, so a cluster of scaffold reads as a lit
  wireframe of the volume being claimed.

  **Emissive only, never a `PointLight`:** `Shaft.buildLights` records that real lamps were
  the frame's bottleneck at thirteen, and a mature canyon carries hundreds of these boxes.

  Two things about the predicate, both of which cost a wrong version first. It reads
  `network.onLane`, not `network.blocked` — routes without the decks and bore mouths that
  `blocked` unions in with them — and it tests east and west only, not all four neighbours.
  With decks folded in and the vertical pair included, 42–52% of every colony flagged and
  87% of Ixion's, which is not frontage but very nearly "is a cell"; a mycelial colony is
  almost all surface, so a predicate this cheap has to be about the lane specifically or it
  degenerates. The lane-only, sideways-only form measures 29–32%. `ColonyPlan.test.ts`
  asserts a **band** rather than a floor for exactly this reason: the degenerate version
  passed a floor-only assertion without complaint — and it now checks each side separately,
  since a west lane recorded as an east one lights the wall facing away from the channel and
  is invisible in any aggregate.
- **Runs → pressure vessels.** `colonyRuns` merges up to four contiguous, *joined*, built,
  supported cells into one hull, drawn as an eight-sided cylinder a full cell long per
  section, so a merged run reads as one continuous industrial pipe rather than a stack of
  tins. Adjacency is not enough: two filaments that grew separately and happen to meet are
  two vessels sharing a wall, and the link mask is the only surviving record of which
  happened.

  **Cylinders because pressure.** A habitat holds atmosphere against near-vacuum and there
  is no designing around what shape does that, so a cylinder reads as engineered where a box
  reads as improvised — which was most of why the colony read as a favela. Eight facets, not
  smooth: the game is hard-faceted throughout and one rounded thing would not belong. The
  section is stretched in z to `moduleDepth`, keeping the elongation that stopped the colony
  reading flat; a true circle would have been barely half that, since the radius is bounded
  by the cell.

  **Vertical first, then horizontal over what is left.** Two axes means a 2×2 block is two
  standing pipes or two lying ones and something must choose, or a cell is drawn twice. A
  fixed priority is the cheapest resolution that keeps the partition exact, and vertical wins
  because that is the silhouette the colony was short of. Measured at mission 30: 65% of
  cells in standing pipes, 3% lying, the rest single — 313 cells down to 164 vessels.

  **`moduleScale` is gone.** It sized each cell by its own connectivity — 0.54 for an end
  pod, 0.78 for a hub — so two *joined* modules were routinely different widths, and that
  stepped, mismatched edge was the strongest favela signal in the colony. One hull spec per
  charter is both more plausible and what lets a run read as a single pipe. Connectivity is
  still read; it now decides what merges rather than how fat each cell is.

  This is a **render decision over a settled cell set**, resolved after growth and after the
  routes have taken what they take. Nothing here claims ground, so budget, `reachOf`, the
  cantilever limit and demolition are all untouched, and the merged hull sits inside the
  union of full-cell colliders those cells already carry — whose rule is that what you see
  may be leaner than what stops you, never fatter. Demolition needs no special case either:
  a channel cut through the middle of a three-cell hall arrives first, so what is left is
  two shorter buildings, and the lane reads as having been cut through the block.

  `TRAIT.grounded` gates it, and what that means had to be corrected once. The literal
  reading — `substrate.at() === 'surface'`, adjacent to rock — is 35 of 313 cells at mission
  30, because a mycelial colony is a cantilevered lattice and 89% of it hangs in open air on
  its own structure. Intersected with the runs a merge needs, 220 joined pairs came out as
  **3**, and the feature could not fire at all. Rock-adjacency was the wrong proxy: it
  contradicts the simulation's own notion of support, which is `reachOf`. Adding "or the
  colony's own cell directly below" — a room on the third floor is not floating — takes it
  to **58 halls holding 59% of cells**, over a healthy spread of widths (127 singles, 13
  doubles, 20 triples, 25 quads).

  Bounded at four because the point is a vocabulary — pods, cans, hubs, halls — not "wider
  is better". A run of nine merged into one box stops reading as a structure with parts and
  starts reading as the bounding volume of one.

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
