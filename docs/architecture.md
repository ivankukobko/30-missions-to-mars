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
