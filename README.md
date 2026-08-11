# 30 Missions to Mars

A 2.5D physics lander built with **TypeScript** and **Three.js**.

Three parties share one Martian chasm: a scientific outpost that got there first, and two extraction charters that did not. You fly the cargo runs, and what you deliver stays in the canyon — so by mission thirty you are threading a corridor you spent twenty-nine missions helping to close.

## Running

```bash
docker compose up
```

Then open http://localhost:5173.

Append `?debug=1` for a mission jump control, the canyon seed, a reroll button, and a `window.__mtm` console handle with `place(x, y)`, `overTarget(height)` and `scale(n)`.

`?scale=N` sets the pixelation divisor (1 native, 2–4 chunky). It defaults to **1**.

Typecheck and tests, which run in the container:

```bash
docker compose run --rm --no-deps app sh -c "npm run typecheck && npm test"
```

See [CLAUDE.md](CLAUDE.md) for development commands and rules.

## Documentation

Detailed documentation is organized in the [`docs/`](docs/) directory:

- **[Lore & Factions](docs/lore.md)**: Guidance AI player identity, the three corporate factions (Ixion, Helion, Kessler), and the 6 campaign narrative phases.
- **[Gameplay](docs/gameplay.md)**: Entry velocity mechanics, desktop & touch controls, payload mass & landing scoring, and seed persistence.
- **[Environment](docs/environment.md)**: Canyon geometry & orientation, uniform lattice sampling, terracing, level shelves, and terrain noise generation.
- **[Architecture](docs/architecture.md)**: 120 Hz fixed-timestep physics engine, fragment-bound rendering pipeline, codebase module layout, and automated tests.
- **[Vehicles](docs/vehicles.md)**: Flatbed vehicle design, leg & nozzle geometry, and comparative specifications for the TD-4 Lander and KD-9 Shaft Hauler airframes.
- **[Colony](docs/colony.md)**: Colony progression over 30 missions, layout resolver rules, navigation radar exemption, landmark system, and open design notes.

### Feature & Narrative Plans

- **[Telemetry Dialogue System](docs/plans/telemetry_dialogue_system.md)**: Multi-card Guidance AI pre-mission telemetry uplink system.
- **[Campaign Narrative Enhancements](docs/plans/campaign_narrative_enhancements.md)**: Ixion shutdown visual shifts, AI corridor diagnostics, and shaft acoustic audio effects.
