# Plan: Dedicated Airframe & Corporate HUD System

## Status

**Proposed.** This document outlines the design and technical architecture for dedicated per-airframe HUD instruments and corporate visual identities.

---

## Goal

Provide every airframe in the game with custom-tailored HUD instrumentation and corporate color themes matching its flight mechanics, lore, and primary hazards:
1. **TD-4 LANDER** (*Ixion Outpost*): Unified circular vector compass with movement direction hand, scalar velocity magnitude, and outer tilt warning ring.
2. **KD-9 SHAFT HAULER** (*Kessler Deep*): Twin vertical thruster power meters, differential vector arrow, and shaft wall centering gauge (replacing the redundant tilt dial).
3. **HD-7 SIDEWINDER** (*Helion Extraction*): Decoupled orthogonal vector crosshair, lateral RCS impulse lights, and cosmetic bank arc.

---

## Corporate Visual & Aesthetic Identities

| Property | IXION OUTPOST (TD-4 Lander) | KESSLER DEEP (KD-9 Hauler) | HELION EXTRACTION (HD-7 Sidewinder) |
| :--- | :--- | :--- | :--- |
| **Primary Theme Color** | Neon Mint / Emerald (`#36f5a0`) | Electric Cyan / Ice (`#36d1f5`) | Copper Amber / Orange (`#ffa42b`) |
| **Gauge Aesthetics** | Circular radar glass, clean rounded bezel | Vertical heavy industrial bars, high-contrast grid lines | Angular faceted glass, horizontal crosshair grid |
| **Flight Focus** | Rotational attitude & 360° velocity vector | Shaft wall clearance & differential thruster balance | Decoupled lateral translation & RCS impulse firing |

---

## Instrument Designs per Vehicle

### 1. TD-4 LANDER (`lander` — Ixion Outpost)
- **Flight Characteristics**: Free 360° rotation; single centerline engine; tilt > 15° or total velocity > 3.0 m/s is fatal on landing.
- **Dedicated HUD Instrument — Unified Circular Vector Compass**:
  - **Mint/Emerald Glass Dial**: Circular flight compass themed in Ixion `#36f5a0`.
  - **Direction Hand**: An indicator needle pointing in the exact 2D movement vector direction $\theta = \text{atan2}(V_y, V_x)$.
  - **Center Readout**: Displays scalar total speed magnitude $\|V\| = \sqrt{V_x^2 + V_y^2}$.
  - **Attitude Outer Ring**: Surrounds the vector dial with an outer pitch ring showing vehicle tilt, highlighting dangerous tilt zones ($\pm 15^\circ$) in warning amber/red arcs.

### 2. KD-9 SHAFT HAULER (`hauler` — Kessler Deep)
- **Flight Characteristics**: Locked rotation ($0^\circ$ tilt, cannot tip over); twin $30^\circ$ splayed thrusters; flies inside narrow 24-unit vertical mine shafts.
- **Dedicated HUD Instrument — Twin Thruster & Shaft Alignment Gauge**:
  - **Electric Cyan Thruster Output Bars**: Dual vertical power meters showing active Port and Starboard engine thrust side-by-side.
  - **Differential Vector Arrow**: Visual indicator showing lateral thrust bias between left and right engines.
  - **Shaft Centering Gauge**: Replaces the redundant tilt dial with a horizontal bore-clearance bar showing lateral margin to adjacent shaft rock walls.

### 3. HD-7 SIDEWINDER (`helion` — Helion Extraction)
- **Flight Characteristics**: Decoupled vertical (+Y) and lateral ($\pm X$) translation RCS jets; cosmetic bank lean ($\le 0.14\text{ rad}$).
- **Dedicated HUD Instrument — Decoupled Orthogonal Vector Crosshair**:
  - **Amber/Orange Crosshair Grid**: Independent vertical and horizontal speed sliders crossing at a central target point.
  - **Lateral RCS Impulse Lights**: Left/Right firing indicators that light up when lateral RCS translation thrusters engage.
  - **Cosmetic Bank Arc**: Small top arc showing current visual bank angle.

---

## Technical Architecture & Implementation Steps

### 1. Telemetry Data Model (`src/ui/Interface.ts`)
Extend `HudData` to include telemetry fields for airframe-specific instruments:
```ts
export interface HudData {
  airframeId: AirframeId;
  corpId: CorpId;
  fuel: number;
  fuelCapacity: number;
  altitude: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  tilt: number;
  abyssProximity: number;
  // Airframe-specific telemetry:
  engineLevels?: [number, number]; // Port & Starboard thrust (Hauler)
  rcsActive?: { left: boolean; right: boolean }; // RCS impulse firing (Sidewinder)
  shaftMargins?: { left: number; right: number }; // Shaft wall distance (Hauler)
}
```

### 2. Interface Component (`src/ui/Interface.ts`)
- Build DOM containers for `.hud-instrument-lander`, `.hud-instrument-hauler`, and `.hud-instrument-helion`.
- Implement dynamic CSS theme variable binding (`--hud-color`, `--hud-glow`) when switching clients/airframes.
- In `updateHud()`, compute vector needle angles, differential bar heights, and crosshair coordinates.

### 3. Styling & Graphics (`style.css`)
- Define theme CSS custom properties per corporate client.
- Add styling for circular compass dials, SVG needles, vertical power meters, and crosshair reticles.

---

## Verification Plan

1. **Automated Unit Tests**: Run `npm test` (`vitest run`) to verify HUD initialization and data structures.
2. **Visual Inspection**: Test each airframe across campaign missions:
   - Mission 1 (TD-4 Lander): Verify circular vector compass needle and total speed readout.
   - Mission 6 (KD-9 Shaft Hauler): Verify twin thruster power meters and shaft centering gauge.
   - Helion Missions (HD-7 Sidewinder): Verify orthogonal vector crosshairs and RCS impulse lights.
