# Lore & Factions

## The Player

There is no cockpit and no seat. You fly cargo lander airframes in Coprates Chasma on Mars over a real-time telemetry uplink — thrusters, vector angle, flight attitude, all remote — to corporate target platforms across the canyon.

The game never names what's on the other end of that link. That's deliberate, not an omission: see "What They Call You" below.

- **Uplink & Telemetry**: In Mission 1, your primary objective is to deploy Ixion's Navigation Radar onto open canyon ground. Once planted, your guidance algorithms slave all altitude, range, and target bearing calculations to this single radar mast.
- **Airframe Interface**: Depending on contract requirements, your control system interfaces with two distinct vehicle control schemes—managing manual pitch and attitude on standard landers, or executing twin-engine vector translation on locked-attitude shaft haulers.
- **Persistent Wrecks**: When a lander crashes due to impact or excessive tilt, your telemetry link is severed. The destroyed airframe remains half-buried in the canyon rock in the trim of whichever faction commissioned that run—serving as a physical marker of past failed runs.

### What They Call You

No brief addresses a human pilot; there is no seat, no stick and no cockpit. What each client calls you instead is the cheapest characterisation in the game, because it reveals what they think you are — and none of them are right.

| Client | Address | What it reveals |
| --- | --- | --- |
| Ixion Outpost | **navigator** | Thinks you are a someone. Generous, and wrong. |
| Helion Extraction | an asset class | Nobody is at the other end at all. |
| Kessler Deep | **tin can** | Nearest the truth, least generous about it. |

**The name is earned, not assigned.** Mission 1 addresses you as nothing — you have not done anything yet. You plant Ixion's navigation radar, and because `setMastX` freezes that position for the rest of the campaign it is the one structure in the canyon the player sited themselves. From mission 2 Ixion calls you *the navigator*, after the navigation you built them. They explain it once and never again.

**Kessler uses one name, and repetition is the point.** *Tin can* appears in roughly half his twelve runs and is absent from every genuinely lethal one — missions 21, 25 and 27, where he is concentrating on keeping you intact. The omission does more work than the word. A rotating set of insults was considered and rejected: a nickname that never repeats is a thesaurus, not a relationship, and it leaves nothing to measure the ending against.

**There is exactly one deviation in the campaign.** Ixion goes off the air at mission 28. At mission 30 — the last brief in the game — Kessler calls you *navigator*, the only time he ever uses it, two missions after the only client who ever thought you were a someone stopped transmitting. It is never explained and the player is never told to notice. `Missions.test.ts` asserts all of it, because prose drifts.

---

## The Corporate Factions

Three distinct parties share Coprates Chasma, each claiming a specific domain across the canyon cross-section:

### 1. Ixion Outpost (*Canyon Floor*)

- **Identity**: The original scientific research expedition that arrived first on Mars.
- **Philosophy**: Scientific discovery and legal precedence (*"We are the only thing at the bottom of this canyon, and we intend to stay that way."*).
- **Architecture**: Open ground landing pads, telemetry masts, and a memorial yard of recovered probe wreckage hauled in from across Mars.
- **Vehicle**: TD-4 Lander.
- **Voice**: A named human, same one every time, with the time to talk because the outpost is small and failing. They keep a memorial yard for dead probes; of course they talk to their guidance package. The only client who ever compliments you.
- **Campaign Arc**: Chronically underfunded and outnumbered. Despite filing early legal injunctions (*"We filed first. It will not matter."*), Ixion is slowly crowded out by commercial extraction charters. When the outpost eventually shuts down, its floor pad is cleared for corporate claims.

### 2. Helion Extraction (*West Wall*)

- **Identity**: A major commercial extraction charter operating along the West canyon wall.
- **Philosophy**: Lateral expansion and cliff face excavation (*"Helion drills sideways"*).
- **Architecture**: High crest platforms, wall gantries, structural towers, and deep horizontal caverns carved into cliff walls.
- **Vehicle**: TD-4 Lander (entering wall caverns requires pitch-over maneuverability and manual attitude control).
- **Voice**: Nobody. Auto-generated contract text with the fields filled in — not cold out of cruelty, cold because no human was ever involved. Classifies you by function and carries a line for whether you are expected back. *(Not yet written: Helion's ten briefs are still in the original register.)*

### 3. Kessler Deep (*East Wall & Floor Shafts*)

- **Identity**: A heavy industrial mining charter operating along the East canyon wall and drilling into the floor.
- **Philosophy**: Vertical shaft mining and deep excavation (*"Kessler drills down"*).
- **Architecture**: East wall towers, winches, heavy bore casings, and deep vertical shafts descending straight into the floor.
- **Vehicle**: KD-9 Shaft Hauler (locked 0° attitude rotation with splayed twin engines, designed specifically to translate laterally down 24-unit vertical bores).
- **Voice**: A shift foreman who talks to equipment all day and does not distinguish. Opens by calling you scrap metal and worrying about the airframe instead. Flies you twelve missions — more than anyone — which is the only relationship in the game long enough to change.

---

## The Campaign Arc (30 Missions)

The 30 missions represent the progressive industrialization of Coprates Chasma across six distinct phases. Because every delivered payload builds structures that persist for all subsequent missions, your past completed deliveries actively construct the environmental hazards of future runs:

1. **The Descent (Missions 1–4)**: Siting the Ixion navigation radar, delivering early scientific equipment, and receiving initial corporate survey filings.
2. **The Corporations (Missions 5–9)**: Helion and Kessler arrive on the West and East walls, building their first crest platforms and starting territorial expansion.
3. **The Corridor (Missions 10–14)**: Helion and Kessler build gantries, masts, and towers extending toward each other across the canyon, closing the central flight airspace.
4. **The Digging (Missions 15–19)**: Excavations begin—Helion carves horizontal caverns into the West wall while Kessler sinks vertical shafts into the canyon floor.
5. **The Abyss Opening (Missions 20–24)**: Ixion Outpost fails and shuts down. Deep mining bores break into subterranean chasms, dramatically lowering the failure depth.
6. **The Gauntlet (Missions 25–30)**: The final missions demand high-precision threading through dense corporate gantries, cliff caverns, and deep narrow shaft bores.
