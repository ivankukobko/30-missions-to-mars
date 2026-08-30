# 30 Missions to Mars

A 2.5D physics lander built with **TypeScript** and **Three.js**.

Three parties share one Martian chasm: a scientific outpost that got there first, and two extraction charters that did not. You fly the cargo runs, and what you deliver stays in the canyon — so by mission twenty-nine you are threading a corridor you spent twenty-eight missions helping to close. What comes after is the campaign's own thirtieth flight: the epilogue, over a canyon nobody is left to fly for.

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

Which theme plays comes from the mission's client by default, and a mission can override it with `musicTrack` — resolved by `musicTrackFor`, the same shape as `airframeFor`. Exactly one mission uses it. Mission 29 is a Kessler contract flown in Kessler's hauler to Kessler's own shaft, scored in **Ixion's key**: the outpost went dark two missions earlier and cuts into the brief anyway, quoting mission 1's opening line word for word. Deriving the theme from the client was right for twenty-eight missions and had no way to say that, because the thing being said is precisely that the music and the employer have come apart.

That callsign is also the rhythm. One bar per bit at 2.1 seconds, five bars against a four-step progression, and a set bit is a bar of wobble bass while a clear one is a rest. Each *consecutive* set bit ratchets one division faster — 1/4, 1/8, 1/8 triplet, 1/16 — so mission 29, the campaign's own last delivery (`11101`), spends three bars building into a bar of silence and closes on one more lone stroke; mission 16 (`10000`) is one slow stroke and four bars of nothing, and mission 21 (`10101`) ticks rather than builds. Twenty-nine grooves, none of them authored, none able to drift out of step with the campaign.

The bass is two saws and a square, saturated and then swept by two cascaded lowpass stages — 24 dB/oct, because one biquad is 12 and leaves the harmonics the sweep is meant to travel past plainly audible. The sweep drives `detune` in cents rather than `frequency` in Hz, so the movement is even end to end instead of spending its life open and slamming shut.

Each bar's sweep is a `Float32Array` scheduled with `setValueCurveAtTime`, not an LFO. An `OscillatorNode` cannot be phase-reset, so it cannot be made to land on a bar line, and automating its rate makes the phase at the next bar a function of every change before it. Phase is accumulated by hand instead, which is also what makes the ratchet possible. Everything is placed at an absolute time off the audio clock, so a throttled background tab resyncs rather than falls behind.

The callsign is what the epilogue's beacon transmits, and the reason it can say anything at all. Because mission numbers grow, the figure has been thickening for twenty-nine missions — `11101` is four strokes — so `00001`, four rests and one stroke, is the sparsest thing the system can produce and the first thing the player ever heard. `emitDistantIdent` sounds it weak, detuned twenty-two cents flat so it sits outside the harmony rather than joining it, and fading across its repeats because the receiver is falling away from it. What is transmitting is undecidable **because both candidates make the same sound**: the relay landed on mission 1, still running because nothing told it to stop, or the carrier falling past you on its own first mission. No line of dialogue can collapse that, and none is offered.

`WOBBLE_LEVEL` in `src/audio/MusicComposer.ts` is the mix knob. It sits at 0.11, which measures ~0.045 peak against the pad's ~0.10 and leaves the master peaking near 0.15 — deliberately conservative, since the engine is a control surface and has to stay the loudest thing the player steers by.

## The ending

The epilogue is three transmission cards and then the `FALL` state, which is the `UPLINK` state with the handover deleted.

Every mission opens the same way: falling, no console, no instruments, dead controls, and a bar that completes in exactly three seconds and hands the vehicle over. The ending runs that sequence and never runs the line that ends it. Nothing is a cutscene — real simulation, real entry, real camera — and the beat is legible in the player's hands rather than in prose, because twenty-nine times they have felt three seconds pass and their thumbs come alive. The bar crawls to an asymptote at 0.88 rather than freezing, since frozen reads as a bug, and is already visibly behind at the three-second mark.

The vehicle is a new one and the game never says whose. Its airframe comes off the campaign seed and it carries **mission 1's payload on mission 1's fuel** — the same fact the beacon transmits and the same fact Helion files as `CARRIER: CLASSIFICATION PENDING`.

What it falls past is the player's own colony, brought down in place by `Colony.collapse`: about a fifth of it struck from the scene, the rest leaning and dropped and slid, every emissive fitting and point light out, and stone piled over the mouths of the downward bores. Not swapped for anonymous debris — the canyon is the one their twenty-nine deliveries grew, and the shot only works if you recognise the frontage a second before you notice it is lying on its side. Rotation goes through a pivot at each object's own centre, because colony geometry is baked in world coordinates and setting `rotation` directly swings a building around the middle of the canyon.

Detection and cut are both tested two ways — absolute altitude and height above ground — and take whichever comes first, offset by the same `FALL_SIGNAL_RUN`. Either test alone is wrong somewhere: altitude alone buries the vehicle in a shoulder that stands 170 above `FLOOR_Y`, and a ground lookup alone carries it 300 metres down a shaft. The shared offset is what makes the beacon's three and a half seconds a fact rather than an estimate. Nothing may land or crash here — a touchdown would run the scoring path and a crash would put a retry button on the last thing in the game.

## Excavations

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

## Documentation

Detailed documentation is organized in the [`docs/`](docs/) directory:

- **[Lore & Factions](docs/lore.md)**: The campaign's design record — what each client calls you and why none of the three names mean the same kind of thing, depth as the faction axis with arrival order as its cause, the pillar between the two workings, and the rules about what the game must never answer. Shipped material and proposed material are tagged separately.
- **[Gameplay](docs/gameplay.md)**: Entry velocity mechanics, desktop & touch controls, payload mass & landing scoring, and seed persistence.
- **[Environment](docs/environment.md)**: Canyon geometry & orientation, uniform lattice sampling, terracing, level shelves, and terrain noise generation.
- **[Architecture](docs/architecture.md)**: 120 Hz fixed-timestep physics engine, fragment-bound rendering pipeline, codebase module layout, and automated tests.
- **[Vehicles](docs/vehicles.md)**: Flatbed vehicle design, leg & nozzle geometry, comparative specifications for the TD-4 Lander, KD-9 Shaft Hauler and HD-7 Sidewinder airframes, and the one-frame-per-charter assignment rule.
- **[Colony](docs/colony.md)**: Colony progression over 29 missions, layout resolver rules, navigation radar exemption, landmark system, and open design notes.

### Feature & Narrative Plans

- **[Airframe HUD](docs/plans/dedicated_airframe_hud.md)**: Shipped. A diegetic console per airframe in its charter's livery, an augmented layer on the vehicle that stays the player's own, and a system register for everything that is not the mission.
- **[Main Menu & Save Slots](docs/plans/main_menu.md)**: Menu shipped — boots over the player's own canyon, with a mission grid for replaying ranks already earned. Save slots still proposed, under the constraint that the save format has never yet lost a player's data.
- **[Brief Cards](docs/plans/telemetry_dialogue_system.md)**: How a pre-mission brief is paged, what was cut from the original three-card plan and why, and the `messages` data model.
- **[Mission Zero](docs/plans/mission_zero.md)**: Proposed. A silent prologue that lands the uplink relay on the rim — one control, no console, no voice, because the thing being delivered is the channel every later brief arrives on. Also the four dark relays half-buried on the canyon floor, and why they are Ixion's rather than Kessler's.
- **[Campaign Narrative Enhancements](docs/plans/campaign_narrative_enhancements.md)**: Ixion shutdown visual shifts, AI corridor diagnostics, and shaft acoustic audio effects.
- **[Mycelial Colony Growth](docs/plans/mycelial_colony_growth.md)**: The live model — three colonies growing as branching filaments across the canyon's rock, competing for substrate. Every pad standing keeps a flight channel to the rim, and routes merge into a shared trunk as they climb rather than each reserving a column of their own. Nothing is reserved before the pad that needs it exists, so a new approach can demolish what stood in it — deterministically, so a retry replays the same canyon.
- **[Procedural Colony Growth](docs/plans/procedural_colony_growth.md)**: Superseded by the above; kept as the record of the voxel/WFC-lite model that shipped before it and why it was replaced.
