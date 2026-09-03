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

### Pans, and the Patch the Prologue Lands On

Shelves are a floor feature — `heightIn` applies them inside `floorDetail`, scaled by
`onFloor`, which is zero anywhere up the wall. The prologue lands on the **rim**, and it
lands there on one control: `AIRFRAMES.relay` locks rotation and carries no lateral
thruster, so the column it is dropped down is the only ground it will ever be offered,
and `resolveContact` refuses bare rock steeper than `MAX_GROUND_LANDING_SLOPE`.

The campaign carried a `RIM_SITES = [132, 150, 168]` that was meant to guarantee a flat
there. It did nothing at all, for two independent reasons — and the two together are why
the patch is now a landform in the generator rather than data in the campaign:

- it was passed to `build` as ordinary shelves, so it was multiplied by `onFloor` and
  vanished. Grading with those sites and grading with none produce heights identical to
  three decimal places, on every seed measured;
- the rim is not at a fixed x. It stands at `centre + floorHalf + WALL_RUN`, and the
  centreline wanders ±38 while `floorHalf` swings ±42%, so the lip falls anywhere between
  x=122 and x=234. On the worst seeds the authored sites were a quarter of the way *down
  the wall* — the entry column stood at y=57 against a rim of 240.

So `RIM_BENCH` is posed relative to the centreline, and the mission's entry column is
`canyon.rimSiteX()` rather than an authored `start.x`, so the ground and the vehicle
cannot drift apart. It is applied **last**, after the terracing and after the plateau
handover, since a patch folded in earlier is re-corrugated by one and blended away by the
other.

**The disguise is the harder half, and it is not shaping — it is context.** A single flat
in a landscape with no other flats in it reads as construction however carefully it is
shaped, by elimination rather than by appearance. So `pan` turns the mesa terracing that
already builds the walls up to a hard staircase through a low-frequency mask: roughly half
of each band is a dead-flat tread at full strength, so a patchy mask puts flats through
the upland and leaves the rest the ridged noise it was. Between 14% and 23% of the upland
is now level, and the share **away** from the landing patch is the same as the share near
it — which is the measurement that says the patch is no longer an outlier. One pan is
forced around the patch rather than left to the mask, so the claim holds on every seed
rather than on the lucky ones.

Three sizings were wrong before this one, and each was wrong in an instructive way:

- **54 units wide, applied to every row.** Only z=0 carries colliders, so the other 1699
  units of canyon were scenery paying for a guarantee they played no part in. It rendered
  as a graded road running to the horizon.
- **30 wide, tapered.** A promontory. Better, still infrastructure.
- **20 wide, levelled to a terrace tread.** The tread snap was meant to put the patch at
  the altitudes the natural pans sit at. At half a band, that moves the level by up to 15
  units, let out over an 8-unit shoulder — a cliff around a patch 20 across. It sits at
  local ground height instead; the pan around it does the blending.

Widening the rim's reach also broke something quieter. On a high-centreline seed the patch
stood at x=212 and the collider profile stopped at 204. Terrain past the profile is drawn
like any other ground with nothing solid in it, so the vehicle falls *through* it to
`failDepth` with rock rendered underneath the whole way. `PROFILE_HALF_X` is derived from
`LANDABLE_HALF_X` now — an exact bound, since both noise terms are fbm and return [−1, 1]
— rather than a figure that happened to be large enough.

### Noise

`fbm()` is normalised and centred to [−1, 1], with smoothstep lattice interpolation.
Both matter: summing raw [0,1] octaves produces a signal with a DC bias of ~0.94, which
makes every amplitude ~94% vertical offset and ~6% shape, and linear interpolation
leaves a derivative discontinuity at every lattice line that reads as grid-aligned
creases.
