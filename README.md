# 30 Missions to Mars

A 2.5D physics lander built with **TypeScript** and **Three.js**.

Three parties share one Martian chasm: a scientific outpost that got there first, and two extraction charters that did not. You fly the cargo runs, and what you deliver stays in the canyon — so by mission thirty you are threading a corridor you spent twenty-nine missions helping to close.

## Running

```bash
docker compose up
```

Then open http://localhost:5173.

Append `?debug=1` for a mission jump control, the canyon seed, a reroll button, and a `window.__mtm` console handle with `place(x, y)`, `overTarget(height)` and `scale(n)`.

`?gizmos` draws what colony growth actually read: the flight routes as lines, cells reserved against them in red, and the growable rock surface in white. `?colonies` strips the world back to colonies and pads.

`?scale=N` sets the pixelation divisor (1 native, 2–4 chunky). It defaults to **1**.

Typecheck and tests, which run in the container:

```bash
docker compose run --rm --no-deps app sh -c "npm run typecheck && npm test"
```

See [CLAUDE.md](CLAUDE.md) for development commands and rules.

## Sound

The score is a five-voice pad, one chord progression per charter, and the mission's own callsign — the mission number in binary, MSB first, sounded once per forty-second cycle.

That callsign is also the rhythm. One bar per bit at 2.1 seconds, five bars against a four-step progression, and a set bit is a bar of wobble bass while a clear one is a rest. Each *consecutive* set bit ratchets one division faster — 1/4, 1/8, 1/8 triplet, 1/16 — so mission 30 (`11110`) is a four-bar build into a bar of silence, mission 16 (`10000`) is one slow stroke and four bars of nothing, and mission 21 (`10101`) ticks rather than builds. Thirty grooves, none of them authored, none able to drift out of step with the campaign.

The bass is two saws and a square, saturated and then swept by two cascaded lowpass stages — 24 dB/oct, because one biquad is 12 and leaves the harmonics the sweep is meant to travel past plainly audible. The sweep drives `detune` in cents rather than `frequency` in Hz, so the movement is even end to end instead of spending its life open and slamming shut.

Each bar's sweep is a `Float32Array` scheduled with `setValueCurveAtTime`, not an LFO. An `OscillatorNode` cannot be phase-reset, so it cannot be made to land on a bar line, and automating its rate makes the phase at the next bar a function of every change before it. Phase is accumulated by hand instead, which is also what makes the ratchet possible. Everything is placed at an absolute time off the audio clock, so a throttled background tab resyncs rather than falls behind.

`WOBBLE_LEVEL` in `src/audio/MusicComposer.ts` is the mix knob. It sits at 0.11, which measures ~0.045 peak against the pad's ~0.10 and leaves the master peaking near 0.15 — deliberately conservative, since the engine is a control surface and has to stay the loudest thing the player steers by.

## Documentation

Detailed documentation is organized in the [`docs/`](docs/) directory:

- **[Lore & Factions](docs/lore.md)**: Player identity and the corp voice pattern, the three corporate factions (Ixion, Helion, Kessler), and the 6 campaign narrative phases.
- **[Gameplay](docs/gameplay.md)**: Entry velocity mechanics, desktop & touch controls, payload mass & landing scoring, and seed persistence.
- **[Environment](docs/environment.md)**: Canyon geometry & orientation, uniform lattice sampling, terracing, level shelves, and terrain noise generation.
- **[Architecture](docs/architecture.md)**: 120 Hz fixed-timestep physics engine, fragment-bound rendering pipeline, codebase module layout, and automated tests.
- **[Vehicles](docs/vehicles.md)**: Flatbed vehicle design, leg & nozzle geometry, comparative specifications for the TD-4 Lander, KD-9 Shaft Hauler and HD-7 Sidewinder airframes, and the one-frame-per-charter assignment rule.
- **[Colony](docs/colony.md)**: Colony progression over 30 missions, layout resolver rules, navigation radar exemption, landmark system, and open design notes.

### Feature & Narrative Plans

- **[Airframe HUD](docs/plans/dedicated_airframe_hud.md)**: Shipped. A diegetic console per airframe in its charter's livery, an augmented layer on the vehicle that stays the player's own, and a system register for everything that is not the mission.
- **[Main Menu & Save Slots](docs/plans/main_menu.md)**: Menu shipped — boots over the player's own canyon, with a mission grid for replaying ranks already earned. Save slots still proposed, under the constraint that the save format has never yet lost a player's data.
- **[Brief Cards](docs/plans/telemetry_dialogue_system.md)**: How a pre-mission brief is paged, what was cut from the original three-card plan and why, and the `messages` data model.
- **[Campaign Narrative Enhancements](docs/plans/campaign_narrative_enhancements.md)**: Ixion shutdown visual shifts, AI corridor diagnostics, and shaft acoustic audio effects.
- **[Mycelial Colony Growth](docs/plans/mycelial_colony_growth.md)**: The live model — three colonies growing as branching filaments across the canyon's rock, competing for substrate. Every pad standing keeps a flight channel to the rim, and routes merge into a shared trunk as they climb rather than each reserving a column of their own. Nothing is reserved before the pad that needs it exists, so a new approach can demolish what stood in it — deterministically, so a retry replays the same canyon.
- **[Procedural Colony Growth](docs/plans/procedural_colony_growth.md)**: Superseded by the above; kept as the record of the voxel/WFC-lite model that shipped before it and why it was replaced.
