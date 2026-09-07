# Excavations

An excavation is **drawn**, not generated. The campaign authors it as characters — `0` is
rock taken out, `x` is rock left in — cumulatively, so each stage shows the whole complex
as it stands and one mission can be read without replaying the campaign:

```yaml
- id: shaft
  anchorToWall: east
  mount: floor
  cells: |
    xxxxx00xxxx      the mouth Ixion cut
    x000000xxxxx     the shared gallery; its west end is Helion's
    xxxx000xxxxx
    xxxxxx0xxxxx     Kessler, going down under the mouth's own east half
```

Authored rather than procedural because a generator has to *prove* three landing decks stay
reachable on every seed the game can roll, which you can only ever sample. Over drawn cells
the same question is a set of assertions: one mouth, no sealed pockets, every deck standing
on rock, every deck reachable from the sky. `Missions.test.ts` checks all of them
exhaustively, and the drawing anchors on the run of carved cells in its own top row, so
adding rock to the left of a picture cannot move the excavation.

## Why the cell pitch is 6

Two grids have to agree for the hole to meet the landscape. Terrain vertices fall at
multiples of `CANYON.CELL`; a mouth's boundary falls at `col · SHAFT_CELL ± SHAFT_CELL/2`.
At `CELL: 4` those sets were disjoint — 6 is not a multiple of 4 — so an exact join was
arithmetically impossible and every seam at a mouth was inevitable, however careful the
cutting. `CELL: 6` divides both, and is *also* 2.3× cheaper than 4 because the pitch scales
both axes: 188k terrain triangles against 425k.

The geometry is one indexed mesh on a shared vertex lattice. Each lattice point is created
once, jittered once, and every polygon touching that corner indexes the same number — so
the face, the back and the corridor walls cannot come apart. They did, three times, for as
long as each surface was an independent plate displaced by a field and the three agreed
only by arithmetic that had to keep being re-earned.

## Measuring the hole

`npm run growth:report` walks the campaign headlessly and prints what the excavation and
the settlement have become at every mission. It reads the shipping pipeline — the resolved
ledger from `missionWorlds`, the cells from `carveFromDig`, the colony from `planColonies`
— so a number out of it is a fact about the world the player flies, not about a model of
one. `src/testing/GrowthModel.ts`.

It exists because everything about how this hole *reads* was being judged by flying to it
and looking, and none of the questions worth asking are ones a screenshot can answer. Two
were sitting in plain sight the first time the table printed:

| | m3 | m14 | m20 | m24 |
|---|---|---|---|---|
| cells | 3 | 22 | 31 | 42 |
| depth | 24 | 60 | 168 | 300 |
| widest run | 2 | 9 | 9 | 9 |
| **blind ends** | 2 | **1** | **1** | **1** |
| rock out, this stage | 10,368 | 65,664 | 31,104 | 38,016 |

**From mission 14 on the complex has exactly one blind end, and every Kessler deck is
standing on it.** The deck rows say the same thing from the other side: `shaft-head`,
`shaft-ledge` and `shaft-deep` each score `nb 1` — one carved neighbour of four — with
`down 0`, meaning nothing continues past them. Each was authored into the last row its own
mission dug, so the bore stops at the deck and the deck is the reason the bore stops. That
is a tube cut to hold a pad rather than a working somebody drove and then landed in; a real
shaft is transport, its bottom is a sump, and the deck belongs at a *station* off the side
of a hole that carries on down. `shaft-gallery` is the exception and reads better for it —
`nb 3`, three cells short of the gallery's west end, a place on a route rather than a face.

**145,152 of rock has left this canyon and none of it is anywhere.** `docs/lore.md` already
recorded that spoil was missing; the number is `cells × SHAFT_CELL² × CORRIDOR_DEPTH`, and
having it makes the gap something you can size a tailings pile against rather than a note.

The report's assertions are deliberately thin — the excavation never un-digs itself, every
in-shaft destination resolves into a carved cell, every deck leaves four hull radii to its
nearest wall. Nothing asserts the *current* shape is right. That is the open question, and
a test that froze today's answer would be the thing in the way of it.
