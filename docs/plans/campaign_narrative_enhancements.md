# Plan: Campaign Narrative & Environmental Storytelling Enhancements

## Goal

Enhance the narrative impact, environmental storytelling, and faction immersion across the 30-mission campaign without breaking the core physics loop or campaign determinism.

---

## Core Narrative Pillars

1. **Deliveries Build the World**: What the Guidance AI delivers in mission $N$ remains in the canyon for all future missions ($N+1 \dots 30$). Player success actively constructs future flight hazards.
2. **Physics as Faction Philosophy**:
   * **Ixion Outpost** (*Science & Precedence*): Open pads, probe memorial yard, standard landers.
   * **Helion Extraction** (*Sideways Drilling*): Cliff caverns, gantries, TD-4 Lander (manual attitude control).
   * **Kessler Deep** (*Downward Mining*): Vertical shafts, winches, KD-9 Shaft Hauler (locked 0° vector translation).
3. **Guidance AI Telemetry**: All lore and briefings are delivered as remote telemetry data packets and system diagnostics parsed by the flight AI.

---

## Planned Enhancements

### 1. Ixion Outpost Shutdown & Visual Transformation (Mission 20)

* **Current State**: Ixion Outpost's pad is targetable in early missions, but its eventual decline is conveyed mostly through text.
* **Enhancement**:
  * **Pad Power-Down**: Around Mission 20, the Ixion outpost pad's green landing lights flicker and go dark.
  * **Corporate Claim Beacons**: Helion and Kessler emissive survey beacons spawn over the abandoned pad and probe yard.
  * **Prop Eviction**: Scientific equipment is replaced by corporate construction staging props in later missions.

---

### 2. Guidance AI Contextual Diagnostics

Integrate real-time environmental analysis into the Guidance AI's system diagnostics (Card 2 of the Paged Telemetry Uplink):

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
   * Add `unpowered` / `abandoned` prop visual states for Ixion structures post-Mission 20.
2. **Phase 2: Contextual Diagnostic Generator (`Missions.ts`)**
   * Add helper to calculate canyon clearance & past wreck metrics for the Guidance AI briefing card.
3. **Phase 3: Web Audio Acoustic Effects (`Game.ts` / `Effects.ts`)**
   * Trigger ambient audio filters based on lander depth and corridor width.
