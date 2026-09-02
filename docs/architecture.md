# Architecture

## Physics Engine

Instant death on contact, which raises the bar on fairness considerably:

- **Fixed 120 Hz timestep**, decoupled from render rate. Frame-rate-dependent damping
  makes a 144 Hz player fall at a fifth the speed of a 30 Hz one; there is none here.
- **Swept collision.** Motion is walked in steps no larger than 40% of the hull radius,
  so the first contact is always found. Verified catching a pad at 62.8 u/s.
- **Angles are normalised** before the upright test, so a lander that has rotated a full
  turn but is perfectly level counts as level.
- Pads sit slightly *above* the terrain, so touchdown resolves against exactly one
  collider rather than racing a coincident ground segment.

### Structures that move

There are none, and there is no machinery for them any more. `Kinematics.ts` and the
`PhysicsWorld` moving tier were removed once it was clear nothing could ever populate
them: no `Prop` kind carried a `motion`, so `addMoving` was only ever called from the
module that defined it, and the flat list it scanned was empty on every frame the game
has ever run. `PhysicsWorld`'s own header records the shape it had, for whoever wants it
back — a scanned list rather than a bucketed one, posed from `missionTime` so a retry
replays it, and bounded by hull diameter per substep so nothing tunnels through.

### Rendering between steps

The simulation advances in fixed 1/120 jumps and the display does not, so a frame lands
part-way through a step. The leftover accumulator is drawn rather than dropped: the hull
renders at `lerp(prev, current, accumulator / FIXED_DT)`, via `Lander.present`.

Without it a frame shows the last completed substep, and the number of substeps consumed
per frame varies with the accumulator — 2, 2, 1, 2, 3. At entry speed that is a jump
alternating between half a unit and a whole one, about eighty per cent of a hull radius,
and it reads as the vehicle vibrating.

It was only ever visible on the entry shot, because both of its causes peak there: speed
is at its highest, so a substep covers the most ground, and the sky framing is the
tightest standoff in the game (3.8 behind, against 82 in flight), so a given world-space
error subtends the largest angle. Measured at 57 u/s the correction is 0.474 units per
frame, against a predicted substep of 57/120 = 0.475.

Presentation only — the interpolated pose is never fed back, so a mission still replays
identically. Two consequences worth knowing:

- Anything that moves the vehicle without stepping it must call `Lander.pin()`, or the
  next frame smears the hull across the jump. Mission load and the debug `place` both do.
- Everything that wants an on-screen position reads `renderX`/`renderY`, the camera above
  all. A camera chasing the stepped position while the hull draws at the interpolated one
  puts the jitter back, into the background instead of the vehicle.

**`elapsed` is clamped at zero as well as at 0.25.** `begin`, `beginUplink` and `resume`
reset `lastFrame` from `performance.now()` inside a click handler, so the next rAF
timestamp — the moment that frame *started* — can predate the reset and hand the loop a
negative delta. That drives the accumulator below zero, where it sits until several frames
of real time pay it back, stalling the simulation and pinning the render throughout.
Measured at −0.08 s, about five frames, arriving immediately after the player takes
control.

## Camera

`CameraDirector` picks one of four framings from where the vehicle is and eases every value
toward it, so a phase change is a camera move rather than a cut. `phaseFor` takes the
absolute altitude and the height over whatever is directly below; first match wins:

| Phase | Trigger | distance → | offsetY → | fov |
| --- | --- | --- | --- | --- |
| `shaft` | below `floor − 20`, **or** within 20 of the ground | 10→14 | 3→6 | 80 |
| `landing` | height over ground < 85 | 16→28 | 2.7→4.8 | 50 |
| `sky` | altitude > 620 **and** height > 250 | 3.8 | 6.1 | 60 |
| `flight` | everything else | 20→82 | 5.5→23 | 50→54 |

Each range lerps on `pace` — speed over 45, clamped.

**Distance, height and both leads are lengths, so they scale together.** Halving all four
halves the range without touching the composition: the vehicle sits in the same place in
frame at twice the size, and the leads still show the same angular slice of what is coming.
Pitch and fov are angles and do not scale. A retune should move them as a set.

Three things the names do not say:

- **`shaft` is the close-quarters framing, not the bore framing.** It was built for a bore,
  but what it is *for* is a tight space — near lens, wide angle, the rock either side
  legible. It also triggers within 20 units of any ground, so a pad touchdown and a cavern
  floor get it too.
- **Caves arrive as `landing`.** A Helion cavern sits a few units under the rim —
  `shaft-gallery` is at y ≈ −8, above the floor−20 line — so it never qualifies on altitude
  and only picks up `shaft` in the last twenty units.
- **`flight` covers two different jobs.** Low `pace` is threading the colony grid, where
  what matters is the structure a hull's length either side; high `pace` is the long fall,
  where the same framing would put the vehicle a handful of pixels across. Tightening only
  the near end of the lerp moves the camera in where the flying is close work and leaves
  the descent alone.

### Known gap: the clamp is terrain-only

`liftAboveGround` samples `groundAt`, which is the heightfield. It cannot see the colony,
so it will not lift over a structure. At the old 30–52 unit standoff that rarely mattered;
at 10–14 it does, at every pad the colony has grown around — measured at the outpost pad
with the camera 14 units *above* the terrain and still looking through a building.

`LanderFade` has the same blind spot from the other side: it thins the canyon wall, the
colony's **front** layer and (now) the shaft walls, but not the colony's other layers. Both
want one thing — a query for structure height — which is the argument for fixing the cause
rather than widening the framing again.

## Entry effects

Above 60 u/s the vehicle is coming in through the top of the atmosphere, and one speed ramp
(`BUFFET_FROM` 60 → `BUFFET_FULL` 78) drives both the camera buffet and the entry trail, so
they arrive and fade together instead of reading as two unrelated effects. A mission enters
at 55 and gravity carries it to about 73 across the handshake, so the trail is not there on
the first frame — it comes in about a second down and builds, which is the right shape for
compression heating.

The trail is **line segments**, not smoke. The first version reused the puff pool and read
as flying boulders: the entry camera sits 3.8 units back against 82 in flight, so a puff
sized for the flight shot fills the lens. (Worth knowing if you touch `Effects.spawn`: its
`scale * 0.35` lasts exactly one frame — `update` overwrites the scale with
`scale * sizeFactor`, peaking at 1.3.) Streaks are additive and fade to black rather than
by alpha, and are fixed in world space: it is heated air, and the vehicle leaves it behind
by moving.

## Rendering

The scene can render at **1/N of display resolution** and be scaled back up with
nearest-neighbour, for chunky pixels rather than a blurry upscale. N defaults to 1 and is
set with `?scale=N` or `__mtm.scale(n)`. The divisor is an
integer and the buffer is floored, so every source pixel maps to the same number of
screen pixels — a fractional scale leaves some two screen-pixels wide and others three,
and the grid crawls as the camera moves. Antialiasing is off: it would soften exactly
the pixel edges the look depends on, and cost the fragments the downscale exists to
save. The HUD is DOM, so it stays sharp over the top.

It is also the largest performance lever, because the scene is entirely fragment-bound.
Measured at mission 29: 52 draw calls and 116k triangles are nowhere near mattering,
but the canvas was 3.06M pixels running a PBR loop over 13 lights. Cost falls with the
square of the divisor.

Two other things came out of that profiling:

- **Shadows are off.** With the sun on the horizon and the canyon shadow baked into
  vertex colour, cast shadows were invisible and cost ~30% of the frame.
- **`flatShading` buys look, not speed.** It changes the normal via screen-space
  derivatives; lighting is still per fragment. Three.js removed Gouraud per-vertex
  lighting years ago — in 0.185 `MeshLambertMaterial` has only
  `lights_lambert_fragment`, no vertex variant. Baking static light into vertex colours
  is the way to get lighting off the fragment shader, which is what the canyon shadow
  already does.

## Modules

| Path | Role |
| --- | --- |
| `src/world/CanyonSpec.ts` | Every dimension in the world. Nothing downstream invents a number. |
| `src/world/Noise.ts` | Centred fbm, ridged noise, frame-rate-independent damping |
| `src/world/CanyonGenerator.ts` | Terrain height, floor profile, per-slice sampling |
| `src/world/ShaftGrid.ts` | An excavation as cells on the colony's own grid, drawn in the campaign |
| `src/world/AntFarm.ts` | Those cells as one indexed mesh on a shared vertex lattice |
| `src/world/Shaft.ts` | Bore direction and mount, all that is left of the tube model |
| `src/world/Colony.ts` | Authored props, their colliders and the backdrop settlement |
| `src/physics/PhysicsWorld.ts` | Bucketed static world, swept-circle queries |
| `src/entities/Airframe.ts` | The four airframes as data: flight model and engine layout |
| `src/entities/LanderBody.ts` | Integration, thrust, mass, contact resolution — no renderer |
| `src/entities/Lander.ts` | The vehicle you can see, wrapped around the one that flies |
| `src/entities/Effects.ts` | Pooled dust and smoke |
| `src/campaign/Missions.ts` | The 29-mission table (parsed from `missions.yaml`) and the authored ledger |
| `src/campaign/Layout.ts` | The rules a pad imposes on everything built after it |
| `src/campaign/ColonyPlan.ts` | Composition root for growth: campaign facts in, colony props out |
| `src/campaign/ColonyChannels.ts` | Every live pad's flight route to the rim, as reserved airspace |
| `src/campaign/TerrainDigs.ts` | Resolving wall-anchored excavations and deck attachments against real terrain |
| `src/world/ColonyOrganism.ts` | The growth simulation itself — filaments, support, budget |
| `src/world/ColonyLattice.ts` | The one place a column becomes a coordinate |
| `src/world/ColonySubstrate.ts` | What each cell is made of, sampled from the rock |
| `src/world/ColonyRender.ts` | Grown cells as vessels, frames and cages |
| `src/testing/canyonFixture.ts` | Built canyons shared between tests, cached on the dig signature |
| `src/campaign/Progress.ts` | Seed, unlocks, ranks, landing score |
| `src/core/CameraDirector.ts` | The rim transition, framed rather than guessed |
| `src/core/InputManager.ts` | Keyboard and multi-touch, normalised to one state |
| `src/core/Inspector.ts` | Map editor and generator readout, behind `?debug=1` |
| `src/core/Game.ts` | Fixed-timestep loop, mission flow, world assembly |
| `src/core/MenuController.ts` | Every screen reached without flying |
| `src/core/CrashReport.ts` | What the failure card says, and the tolerances it quotes |
| `src/core/Atmosphere.ts` | How thick and how dark the air is, from where you are looking |
| `src/core/EpilogueFall.ts` | The ending's timing: the stalled handshake, the beacon, the cut |
| `src/campaign/SaveData.ts` | Preferences, save slots and playthrough history |
| `src/campaign/FuelBudget.ts` | What a mission's fuel is unavoidably spent on |
| `src/testing/Autopilot.ts` | A reference pilot: consistent rather than good |
| `src/testing/flyMission.ts` | Flying a mission headlessly, on the real physics |
| `src/ui/Interface.ts` | HUD, briefs, results, target marker |

## Tests

580 tests, run in the container:

```bash
docker compose run --rm --no-deps app sh -c "npm run typecheck && npm test"
```

They cover the simulation rather than the rendering, which is the line the modules are
drawn along: `Noise`, `PhysicsWorld`, `Layout`, `Missions`, `Progress`, `LanderBody` and
the colony's own model import no renderer and test in plain Node.

The suite runs test *files* in parallel by default, so its wall time is whatever its
slowest file is rather than the sum. Two files dominate and both are terrain-bound; a
canyon build is about 450 ms and used to be repeated for every case that needed one.
`canyonFixture` caches builds on the **dig signature** rather than the mission id — the
campaign only ever reaches five distinct dig states, so twenty-nine ids collapse onto five
builds — which took the suite from 32 s to 12 s without dropping a single case.

What they are actually for:

- **Tunnelling.** Contact is instant death, so a missed contact is not a graze — it is
  the lander falling through the world and the mission ending for no visible reason. The
  sweep is tested against steps far larger than the hull, at every descent rate from 10 to
  400 u/s.
- **The campaign ledger.** `checkLayout` is asserted clean for every mission across
  several seeds, against the *real* pipeline — terrain, resolved digs, grown colonies and
  their colliders — rather than against the authored ledger alone. Two faults lived in
  that gap and both had to be found by flying the game.
- **Fuel margins.** Fuel is 60-70 of the 100 points a landing is scored on, so the size
  of a tank against what the run unavoidably costs is very nearly the rank.
  `FuelBudget.ts` computes that floor — the optimal brake and the crossing — and
  `npm run fuel:report` prints it per mission. It also asserts the **ceiling**: a flawless
  arrival banks 40 points from softness and centring, so an S needs 70% of the tank left,
  which needs the unavoidable cost under 30%. That failed on fourteen of twenty-eight
  missions — every hauler run but one — so S was not merely hard there, it did not exist.
- **What a run actually scores.** `FuelBudget` bounds what a mission costs; the
  reference pilot in `src/testing/` flies it. One controller, the same on every mission,
  on the real `LanderBody` against the real `PhysicsWorld` with the colony built into it —
  so any difference between two missions is a difference in the missions. It lands 20 of
  29 and scores **67 to 78 points** — an eleven-point spread, all of it above the A cut. The
  nine it cannot fly are the deliveries whose approach is not vertical, which need a path
  follower rather than a descend-and-translate profile. `npm run pilot:report`.
- **Campaign pacing, not just legality.** `ColonyBalance.test.ts` asserts the things a
  legality check cannot see: that the canyon closes in across every stretch of the
  campaign, that a charter builds on its own missions, that flying well buys visible
  cells, and that nothing the player lands on is floating. Every one of those was wrong at
  some point while every legality test stayed green. `npm run colony:report` prints the
  tables behind them, which is the tuning loop.
- **The briefs.** Who speaks, what they call you, where an interruption lands, and that
  Helion's mass allowance still equals the ceiling minus everything consigned. Prose
  drifts, and these are the rules no reader can check by eye.
- **Frame-rate independence.** `damp` is asserted to land in the same place whether the
  time is taken in one step or a thousand, and a 30 Hz and a 144 Hz budget are compared
  directly.
- **Terrain stability.** `heightAt` is pinned to a golden sample for a fixed seed, so the
  landscape cannot change by accident. Continuity is asserted across both axes: every
  discontinuity this generator has shipped was a crease along an axis, and each was
  invisible to any check aimed at a single cross-section.
- **Tolerance boundaries.** Landing speed and tilt are tested at exactly the limit and a
  hair past it, along with the two gates that are easy to conflate — the one that says the
  contact came from above, and the one that says the *ground* is flat enough to stand on.
