# The Only Thing at the Bottom

*a story about 30 missions to Mars*

A 2.5D physics lander built with **TypeScript** and **Three.js**.

Three parties share one Martian chasm: a scientific outpost that got there first, and two extraction charters that did not. You fly the cargo runs, and what you deliver stays in the canyon — so by mission twenty-nine you are threading a corridor you spent twenty-eight missions helping to close. What comes after is the campaign's own thirtieth flight.

### ▶ [Play now](https://ivankukobko.github.io/30-missions-to-mars/)

No install, no account. Your canyon is rolled on first load and kept in `localStorage`, so
the colony you grow is yours and a campaign survives a reload — see [Gameplay](docs/gameplay.md).

## Running

```bash
docker compose up
```

Then open http://localhost:5173. Everything else — the debug flags, the container rules,
the balance harnesses — is in [Running](docs/running.md), and the development rules are in
[CLAUDE.md](CLAUDE.md).

## Documentation

Written as a design record rather than a manual: each page carries the reasoning, the
alternative that was rejected, and the measurement that settled it.

### The game

- **[Lore & Factions](docs/lore.md)**: The campaign's design record — what each client calls you and why none of the three names mean the same kind of thing, depth as the faction axis with arrival order as its cause, the pillar as Ixion's reading of the seismic data, the ground rules the canyon runs on, and what the game must never answer. Shipped material and proposed material are tagged separately.
- **[Gameplay](docs/gameplay.md)**: Entry velocity mechanics, desktop & touch controls, payload mass & landing scoring, and seed persistence.
- **[Fuel & Rank](docs/fuel.md)**: Why the tank is the strongest balance lever in the game, the two harnesses that measure it, and what they found when nothing had been measuring it.
- **[Sound](docs/sound.md)**: The five-voice pad, one progression per charter, and the mission callsign that is also the rhythm — twenty-nine grooves, none of them authored. *Spoilers.*
- **[The Ending](docs/ending.md)**: How the last flight is built and why. **Spoilers, all of them.**

### The world

- **[Environment](docs/environment.md)**: Canyon geometry & orientation, uniform lattice sampling, terracing, level shelves, and terrain noise generation.
- **[Excavations](docs/excavations.md)**: Why the holes are drawn as characters rather than generated, what that buys in assertions, and why the cell pitch is 6.
- **[Colony](docs/colony.md)**: Colony progression over 29 missions, layout resolver rules, navigation radar exemption, landmark system, and open design notes.
- **[Vehicles](docs/vehicles.md)**: Flatbed vehicle design, leg & nozzle geometry, comparative specifications for the TD-4 Lander, KD-9 Shaft Hauler and HD-7 Sidewinder airframes, and the one-frame-per-charter assignment rule.

### The code

- **[Architecture](docs/architecture.md)**: 120 Hz fixed-timestep physics engine, fragment-bound rendering pipeline, codebase module layout, and automated tests.
- **[Running](docs/running.md)**: Dev server, debug query flags, the container rules, and the balance harnesses.

### Feature & narrative plans

- **[Airframe HUD](docs/plans/dedicated_airframe_hud.md)**: Shipped. A diegetic console per airframe in its charter's livery, an augmented layer on the vehicle that stays the player's own, and a system register for everything that is not the mission.
- **[Main Menu & Save Slots](docs/plans/main_menu.md)**: Shipped. Boots over the player's own canyon, with a mission grid for replaying ranks already earned, three canyons alive at once, and a history of campaigns already finished. Slot 0 is the key the game has always used and preferences moved out of the campaign record entirely — the save format has never yet lost a player's data, and this change is a copy rather than a move.
- **[Brief Cards](docs/plans/telemetry_dialogue_system.md)**: How a pre-mission brief is paged, what was cut from the original three-card plan and why, and the `messages` data model.
- **[Mission Zero](docs/plans/mission_zero.md)**: Shipped as mission 1. A silent prologue that lands the uplink relay on the rim — one control, no console, no voice, because the thing being delivered is the channel every later brief arrives on. Also the four dark relays half-buried on the canyon floor, and why they are Ixion's rather than Kessler's.
- **[Campaign Narrative Enhancements](docs/plans/campaign_narrative_enhancements.md)**: Ixion shutdown visual shifts, AI corridor diagnostics, and shaft acoustic audio effects.
- **[Mycelial Colony Growth](docs/plans/mycelial_colony_growth.md)**: The live model — three colonies growing as branching filaments across the canyon's rock, competing for substrate. Every pad standing keeps a flight channel to the rim, and routes merge into a shared trunk as they climb rather than each reserving a column of their own. Nothing is reserved before the pad that needs it exists, so a new approach can demolish what stood in it — deterministically, so a retry replays the same canyon.
- **[Procedural Colony Growth](docs/plans/procedural_colony_growth.md)**: Superseded by the above; kept as the record of the voxel/WFC-lite model that shipped before it and why it was replaced.

### Roads not taken

Neither shipped nor proposed. `docs/lore.md` is the campaign; these are campaigns it could
have been, kept because the exercise they record is that the machinery underneath is
stronger than the story currently mounted on it — same canyon, same three parties, same
prologue and epilogue, different reason for all of it.

- **[Alternative Plots](docs/alternative_plots.md)**: Three campaigns against the same baseline, and what each one would cost.
- **[Alternative Plot & Narrative Concepts](docs/alternative_plots2.md)**: An earlier pass at the same question.
