# Plan: Campaign Narrative & Environmental Storytelling Enhancements

## Goal

Enhance the narrative impact, environmental storytelling, and faction immersion across the 29-mission campaign without breaking the core physics loop or campaign determinism.

---

> **Framing note:** this plan predates the discipline that the carrier is never named. Where
> the original text said "Guidance AI" or "flight AI", read *the carrier* — an unidentified
> thing on the end of the telemetry link. See `docs/lore.md`.

## Core Narrative Pillars

1. **Deliveries Build the World**: what the carrier delivers in mission $N$ remains in the canyon for all future missions ($N+1 \dots 29$). Player success actively constructs future flight hazards.
2. **Physics as Faction Philosophy**:
   * **Ixion Outpost** (*Science & Precedence*): open pads, TD-4 Lander (manual attitude control).
   * **Helion Extraction** (*works the hole along*): the west end of the shared gallery, entered level and sideways; HD-7 Sidewinder (decoupled lateral translation).
   * **Kessler Deep** (*works the hole down*): the shaft driven down Ixion's mouth, winches, KD-9 Shaft Hauler (locked-attitude twin vectoring).
3. **Telemetry**: all lore and briefings arrive as remote transmissions and system diagnostics on the carrier's feed.

---

## Planned Enhancements

### 1. Ixion Outpost Shutdown & Visual Transformation (Mission 27)

* **Current State**: Ixion Outpost's pad is targetable in early missions, but its eventual decline is conveyed only through text — and `Colony.darken` was removed, so nothing dims the outpost per-mission.
* **Enhancement**:
  * **Pad Power-Down**: at Mission 27 — the shutdown brief — the outpost pad's landing lights
    go dark. The navigation radar does **not**: Ixion leaves it powered on purpose and says
    so, and mission 29 and the epilogue both depend on it still transmitting. The briefs are
    already written not to require this (mission 18 says *"off the surface"*, not *"lights
    off"*), so it is additive. See `docs/lore.md`.
  * **Corporate Claim Beacons**: Helion and Kessler emissive survey beacons spawn over the abandoned pad.
  * **Prop Eviction**: Scientific equipment is replaced by corporate construction staging props in later missions.

---

### 2. Contextual Diagnostics

Integrate real-time environmental analysis into the carrier's system diagnostics (Card 2 of the Paged Telemetry Uplink):

* **Corridor Density Readout**: Display active airspace clearance statistics:
  > `[ANALYSIS · CORRIDOR CLEARANCE: 42% (REDUCED BY HELION GANTRY M10)]`
* **Depth Hazard Warning**: As Kessler sinks deeper shafts:
  > `[HAZARD · FAIL DEPTH EXTENDED TO -450U (ABYSS BORE OPEN)]`
* **Wreck Proximity Alert**: If a past crash occurred near the current mission's target pad:
  > `[TELEMETRY · PRIOR AIRFRAME WRECKAGE DETECTED NEAR TARGET APRON]`

---

### 3. Atmospheric Audio & Acoustic Feedback

* **Teletype Audio Chimes**: Retro terminal key clicks during pre-mission uplink briefings.
* **Corridor Wind Shear**: Procedural wind audio pitch rises as the canyon corridor narrows between Helion and Kessler structures.
* **Shaft Reverberation**: Low-frequency acoustic rumble and tight reverb when the lander descends below the floor line into Kessler bores.

---

## Implementation Plan

1. **Phase 1: Prop & Lighting State Shifts (`Colony.ts` / `Missions.ts`)**
   * Add `unpowered` / `abandoned` prop visual states for Ixion structures post-Mission 27,
     excluding the radar. (`Colony.darken` was removed and would need reinstating.)
2. **Phase 2: Contextual Diagnostic Generator (`Missions.ts`)**
   * Add helper to calculate canyon clearance & past wreck metrics for the carrier's briefing card.
3. **Phase 3: Web Audio Acoustic Effects (`Game.ts` / `Effects.ts`)**
   * Trigger ambient audio filters based on lander depth and corridor width.
