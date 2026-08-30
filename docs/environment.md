# Environment

## The Canyon & Terrain

The canyon is oriented along **-Z**, away from the camera. The playable plane at z=0
is its **mouth** — a cross-section with the west wall to the left, the east wall to the
right, the floor below and a slot of sky above.

That orientation is the whole design. Slicing *along* a canyon shows you a floor and a
backdrop wall, and the canyon-ness has to be asserted rather than shown. Slicing
*across* it shows the void between two walls, which is what a canyon actually is. It
also fills the mid-ground: the world recedes through some 425 depth slices instead of
jumping from the play plane straight to a wall 85 units behind it, so fog and scale
finally have something to grade across.

| Layer | Z | Purpose | Colliders |
| --- | --- | --- | --- |
| In front | +200 … 0 | The valley continues past the lander, so the camera flies *inside* it | none |
| **Play slice** | 0 | Floor, walls, structures, pads, lander | all |
| The canyon | 0 … −1500 | Receding down its length into fog | none |
| Backdrop colony | −24 … −138 | Echoes of the settlement, packed so they interleave | none |

There is no near-cut plane and no separate backdrop mesh any more. The world used to be
sliced off at z=0 and capped, so the camera sat outside a diorama looking in; it now runs
from `FRONT_Z` all the way down `LENGTH` as one uniform lattice.

The cross-section is built from distance to a **wandering centreline**: the canyon
meanders, its floor pinches and widens, and it descends downstream, so depth reads as
a direction rather than a wall.

Walls are **terraced**. Height is snapped toward multiples of a stratum thickness, which
turns the climb into a staircase of benches at constant altitude — how layered rock
actually erodes, and what stops a wall reading as a ramp. Eight benches between floor
and rim, the band phase drifting slowly downstream so terraces tilt rather than ringing
the chasm at identical heights. Terracing is applied *before* facet noise so the benches
stay legible.

The two corporations now face each other **across** the canyon — Helion holds the west
wall, Kessler the east, the outpost the floor between them. They build toward each other
over twenty-nine missions, so the corridor closes horizontally, in frame, in front of the
player. The mine descends as a shaft in the floor between them.

### Sampling

The grid is a **plain uniform lattice** — same pitch across x, same pitch along z,
everywhere — so every quad is congruent and every facet catches light the same way. That
replaced two independent LOD schemes (a profile pitch with geometrically widening outer
columns, and a fine depth band with geometrically widening rows capped against a fan),
which between them produced every seam and ribbon the generator has had: the two rates
only agreed where they happened to, and each was a separate knob to keep in proportion by
hand. At a sane cell size the grid is its own LOD. Aerial perspective is a continuous
function of depth.

Sampling is **hoisted per slice**. The centreline, floor width, floor height, terrace
phase and every shelf's level depend only on z, so `row(z)` resolves them once and
`heightIn(x, row)` sweeps the columns — worth 2.15x on the terrain sampling, measured, for
bit-identical output. `heightAt(x, z)` is still there and still correct; it just builds a
row of one.

Triangle winding is load-bearing and easy to get backwards: it decides both which way
`computeVertexNormals` points (lighting) and which faces survive back-face culling. Get
it wrong and the walls are culled outright — the canyon renders with no walls at all,
looking straight through to the backdrop, while the floor lights from underneath.

### One Landscape, Tweaked for Play

Flat ground comes from **shelves**: instead of carving terrain down to a fixed height —
which digs a crater wherever the ground happens to sit high — a shelf levels the
ground to *its own* height at the shelf centre and eases back into the surrounding
contour. It reads as a natural terrace, never a quarry.

Every ground pad gets one, which is how a pad always finds level rock without the
generator needing to know how high that rock is (measured tilt under a pad: 0.00°).
Four more are placed by seed. Their positions are **stratified**, one per band with
jitter, because independent draws clump: an earlier version put three of four shelves
within 26 units of each other, merging into one 60-unit plateau while half the canyon
got none.

### Noise

`fbm()` is normalised and centred to [−1, 1], with smoothstep lattice interpolation.
Both matter: summing raw [0,1] octaves produces a signal with a DC bias of ~0.94, which
makes every amplitude ~94% vertical offset and ~6% shape, and linear interpolation
leaves a derivative discontinuity at every lattice line that reads as grid-aligned
creases.
