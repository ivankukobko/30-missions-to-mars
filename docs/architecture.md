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

### Moving Structures

Platforms and gantries take an optional `motion` — a travelling deck, a gantry on a rail —
and the collision world has a second tier for them. No mission uses one yet; the
capability exists and the level design does not.

The split is about indexing, not about what the geometry is. Static colliders are
bucketed on x once at insertion, because there are thousands of them and they never move.
Moving colliders live in a flat list that is scanned in full, because there are only ever a
handful and the bucket key is derived from x — anything travelling horizontally would
invalidate its own index every frame.

Three things make this cheap rather than the beginning of a physics engine:

- **Nothing is dynamic.** Bodies follow an authored path and are unmoved by what they hit.
  Contact is terminal, so a moving hazard only ever has to be *detected*, never resolved —
  no impulses, no friction, no resting contact, none of the machinery that is actually hard.
- **Motion is a pure function of mission time**, and mission time is the fixed-step count
  since the mission loaded. Nothing reads a wall clock. A crane phased off `performance.now()`
  would break the campaign's foundation silently and in the one direction a player cannot
  argue with: fail a run, retry, find the hazard somewhere else.
- **Within a substep a moving segment is stationary**, which keeps the query identical to
  the static one. That is sound below a stated bound — a surface travelling more than the
  hull *diameter* between two poses leaves a band the vehicle could occupy at both instants
  without overlapping it, and flies clean through. At 120 Hz and a 0.62 hull that is about
  149 u/s, faster than the lander's own entry velocity. `KinematicWorld.unsafeAt` reports
  anything over it at mission load rather than clamping, because a structure quietly running
  slower than authored is a level-design change made behind the author's back.

The layout rules judge a moving prop by the airspace it **sweeps**, not where it rests.
Without that a gantry authored clear of a pad, whose stroke carries it through that pad's
approach corridor, passes every check — and the mission becomes unflyable with nothing in
the source connecting the two. A travelling span that does intrude is *reported* rather
than trimmed or slid, like a tower: its span is a machine's stroke on a rail, and reshaping
it would be the resolver redesigning working hardware to satisfy a rule.

Rotation is not modelled. A swinging jib needs a rotational sweep to be collided honestly;
translation covers the structures the colony would plausibly build.

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
  `helion-cavern` is at y ≈ −8, above the floor−20 line — so it never qualifies on altitude
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
Measured at mission 30: 52 draw calls and 116k triangles are nowhere near mattering,
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
| `src/world/Shaft.ts` | Mined bores, built as geometry rather than carved |
| `src/world/Colony.ts` | Authored props, their colliders and the backdrop settlement |
| `src/physics/PhysicsWorld.ts` | Bucketed static world plus a scanned moving tier, swept-circle queries |
| `src/physics/Kinematics.ts` | Structures that move, posed from the mission clock |
| `src/entities/Airframe.ts` | The two vehicles as data: flight model and engine layout |
| `src/entities/LanderBody.ts` | Integration, thrust, mass, contact resolution — no renderer |
| `src/entities/Lander.ts` | The vehicle you can see, wrapped around the one that flies |
| `src/entities/Effects.ts` | Pooled dust and smoke |
| `src/campaign/Missions.ts` | The 30-mission table and the colony ledger |
| `src/campaign/Layout.ts` | The rules a pad imposes on everything built after it |
| `src/campaign/Progress.ts` | Seed, unlocks, ranks, landing score |
| `src/core/CameraDirector.ts` | The rim transition, framed rather than guessed |
| `src/core/InputManager.ts` | Keyboard and multi-touch, normalised to one state |
| `src/core/Inspector.ts` | Map editor and generator readout, behind `?debug=1` |
| `src/core/Game.ts` | Fixed-timestep loop, mission flow, atmosphere |
| `src/ui/Interface.ts` | HUD, briefs, results, target marker |

## Tests

307 tests, run with `docker compose exec app npm test`. They cover the simulation rather
than the rendering, which is the line the modules are drawn along: `Noise`,
`PhysicsWorld`, `Layout`, `Missions`, `Progress` and `LanderBody` import no renderer and
test in plain Node.

What they are actually for:

- **Tunnelling.** Contact is instant death, so a missed contact is not a graze — it is
  the lander falling through the world and the mission ending for no visible reason. The
  sweep is tested against steps far larger than the hull, at every descent rate from 10 to
  400 u/s.
- **The campaign ledger.** `checkLayout(worldAt(id, mastX))` is asserted clean for all
  thirty missions across ten radar positions. This check already existed but only as a
  `console.warn` behind the DEV flag, which is exactly why a live violation sat unnoticed
  in it — see the radar note in [Colony Documentation](colony.md).
- **Frame-rate independence.** `damp` is asserted to land in the same place whether the
  time is taken in one step or a thousand, and a 30 Hz and a 144 Hz budget are compared
  directly. Frame-rate-dependent damping is the classic way for a lander to play
  differently on different machines.
- **Terrain stability.** `heightAt` is pinned to a golden sample for a fixed seed, so the
  landscape cannot change by accident. Continuity is asserted across both axes: every
  discontinuity this generator has shipped was a crease along an axis, and each was
  invisible to any check aimed at a single cross-section.
- **Tolerance boundaries.** Landing speed and tilt are tested at exactly the limit and a
  hair past it, along with the two gates that are easy to conflate — the one that says the
  contact came from above, and the one that says the *ground* is flat enough to stand on.
