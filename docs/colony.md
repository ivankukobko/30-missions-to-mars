# Colony

## Colony as Difficulty Curve

Caves, gantries, towers and platforms are **authored props, not terrain**. That is the
trick that makes overhangs possible: a heightfield has one Y per (x, z) and can never
express a ceiling, but a structure the colonists *built* can. Excavations do modify the
terrain, but only downward — the roof that turns a pit into a cave is a separate prop.

The world for mission N is every addition from missions 1…N. The invariant that has to
hold is that the world is a pure function of *where you are in the campaign*: retrying
after a crash rebuilds an identical canyon, and no save data is needed for correctness.
That it is currently a plain accumulation — props only ever appended, never moved,
replaced or removed — is a simplification, not the invariant.

### The Layout Resolver

Thirty missions of hand-typed coordinates accumulate and are never removed, so a span
authored in mission 12 can end up hanging over a pad placed in mission 5 and nothing in
the source connects the two. `Layout.ts` is that connection: a pad reserves its footprint
and an approach corridor above it, an excavation reserves the lanes at its lips, and
anything that would stand in either is relocated — as little as the rules allow, on its
own corp's side of the canyon. Towers, platforms and cave roofs are load-bearing and are
reported rather than moved: sliding a crest platform silently tears the deck off the
tower bracing it.

The **navigation radar is exempt from all of it**. It is the one structure the player
sited themselves, deliberately built with no collider so it can stand wherever they set
down — including inside ground a later Helion tower grows through. It can neither block an
approach nor be blocked by one.

That exemption used to be expressed by giving the radar a zero-width span, which does not
work: a degenerate interval strictly inside another still overlaps it. From mission 21,
where `kessler-ledge` sits 45 units below the floor, a radar planted near the shaft was
reported as blocking its approach corridor. Nothing acted on the report, because the only
consumer was a `console.warn` — which is the whole argument for the campaign layout check
being a test rather than a log line.

The campaign runs in six phases: the descent, the corporations arriving, the corridor
closing, the digging, the abyss opening, and the gauntlet.

## Landmarks

Procedural terrain is forgettable. Noise has no features you can name, and a canyon you
cannot name anything in is nobody's canyon — but the seed is frozen for all thirty
missions, so the same ground is under you for the whole campaign and there is somewhere
for memory to accumulate. What it needs is singular objects: a handful, hand-placed,
never repeating.

They carry **no colliders**. Difficulty is meant to be the colony you built; a landmark
that could kill you is difficulty you did not choose, and it would turn every one of them
into a thing to avoid rather than a thing to look at.

The **shelves** are where they go. Four are already placed by seed, stratified one per
band, and they are the only naturally level ground in the canyon that nothing else claims
— which is exactly what a derelict needs in order to sit on the ground rather than float
above it or sink into it.

Two kinds, doing different jobs:

- **Recovered probes.** Ixion keeps a memorial yard beside the outpost pad: wreckage
  hauled in from across Mars, because a chronically underfunded science station is
  precisely the organisation that would spend scarce mass on that and the charters are
  precisely the ones who would not. It sits next to the pad you land on in missions 1, 2,
  3, 4, 9, 12, 24 and 28, which makes it the most-seen object in the game. When the
  outpost shuts down, it is also the first thing cleared for the claim.
- **Your own wrecks.** Where you died, in the trim of whoever you were flying for that
  day, half-buried and never remarked on. This is the only thing in the canyon not
  derived from the mission index, which is why it stays strictly cosmetic: it may be
  remembered, but nothing about correctness may depend on it.

## Deliberately Unsettled

Everything above describes what the game does now and what each decision cost. These are
the parts still in motion, written down so the confidence of the prose above is not
mistaken for a finished design.

- **What the colony is made of.** Structures are steel-coloured boxes, which quietly
  contradicts the manifest: every payload in the campaign is a *machine* — drill head,
  winch, processor, bore casing — and never a beam, a panel or a sack of cement. If the
  colonists ship technology and build with what is already here, the buildings want to be
  sintered regolith, cast basalt and bagged dust, with shipped hardware reduced to a small
  bright accent. That has a real consequence rather than being a repaint: stone works in
  compression and cannot span, so gantries become arcades on piers, and an arcade has
  openings to thread instead of a bar to avoid.
- **Legibility if it changes.** Instant death on contact makes silhouette a safety
  requirement, not a preference. Local material means structures stop separating from the
  rock by hue, so the separation has to move to value — and the emissive trim already on
  every prop gets promoted from garnish to the thing you actually navigate by.
- **Whether structures can be removed.** They currently cannot, and two exceptions look
  worth the cost: a charter that revises its own work rather than only adding to it, and
  an outpost whose contributions are quietly cleared away as it fails. The second is the
  campaign's whole argument delivered without a line of dialogue.
- **Corporate identity.** The three parties have a colour and nothing else. Marks on
  pads, structures and cargo would make ownership readable from the air, which is a direct
  win for a game where landing on the wrong pad is already its own failure. At a third of
  display resolution they have to survive as ~12px silhouettes, which is the same thing
  real industrial signage is solving for.
- **Player choice.** The campaign is a fixed sequence. Anything that branches has to be
  reconciled with the determinism above — a locked choice vector kept with the seed, not
  a world that drifts.
