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
