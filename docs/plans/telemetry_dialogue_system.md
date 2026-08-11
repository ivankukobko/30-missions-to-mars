# Plan: Paged Telemetry Uplink & Dialogue System

## Goal

Upgrade pre-mission briefings from a single static text block into a multi-card, sequential **Paged Telemetry Uplink System** styled around the player's role as a **Guidance AI**.

---

## Design & User Experience

### 1. Narrative Framing (Guidance AI)

Instead of presenting the brief as a generic wall of text, each mission start triggers a multi-card telemetry transmission stream received by the Guidance AI:

* **Card 1: Corporate Transmission (`UPLINK · ESTABLISHED`)**
  * Focus: Faction lore, client dialogue, narrative setup.
  * Header: Corporate client name (`IXION OUTPOST`, `HELION EXTRACTION`, `KESSLER DEEP`).
  * Action: `[ NEXT ]` button (or `Space` / `Enter`).

* **Card 2: System Diagnostic (`SYSTEM · AIRFRAME & TELEMETRY`)**
  * Focus: Guidance AI diagnostics, vehicle handling parameters, payload mass warning.
  * Content: Airframe scheme (TD-4 Lander manual attitude vs. KD-9 Shaft Hauler splayed vectoring), payload mass penalty, steering control preferences.
  * Action: `[ NEXT ]` button (or `Space` / `Enter`).

* **Card 3: Contract Manifest (`TACTICAL · OBJECTIVE`)**
  * Focus: Target address, pad width, failure depth boundary, mission start.
  * Content: Clear objective text and target location.
  * Action: `[ LAUNCH MISSION ]` primary button.

---

### 2. Interaction & Keyboard Controls

* **Paging (`Next` / `Launch`)**:
  * Clicking `[ NEXT ]` or pressing `Space` / `Enter` advances to the next card.
  * The final card replaces `[ NEXT ]` with `[ LAUNCH MISSION ]`.
* **Teletype & Skip**:
  * Brief text streams in via a fast typewriter effect (~15–20ms/char).
  * Pressing `Space` / `Enter` or clicking during teletype instantly reveals the full card text.
  * Pressing `Esc` or clicking `[ SKIP ALL ]` immediately jumps to the final card ready to launch, preserving fast retry flow.

---

## Technical Specifications

### Data Model Updates (`src/campaign/Missions.ts`)

Extend the `Mission` definition to support structured brief segments alongside the legacy string fallback:

```typescript
export interface BriefSegment {
  title?: string;
  body: string;
}

export interface Mission {
  id: number;
  client: CorpId;
  payload: Payload;
  fuel: number;
  start: { x: number; y: number };
  target: string | null;
  failDepth: number;
  brief: string | BriefSegment[];
  // ... existing fields
}
```

Helper function `resolveBriefCards(mission: Mission): BriefSegment[]` will parse existing HTML string briefs or structured arrays into normalized 2–3 card arrays.

---

### UI Implementation (`src/ui/Interface.ts`)

1. **State Management**:
   * `cardIndex`: Tracks current card (0 to `totalCards - 1`).
   * `isTyping`: Boolean indicating active typewriter animation.
   * `typingTimer`: Interval ID for char animation cancellation.

2. **DOM Structure**:
   * Add a paged card container with indicator dots (`● ○ ○`) showing card progress.
   * Footer containing `[ SKIP ALL ]`, `[ PREV ]` (optional), and `[ NEXT ]` / `[ LAUNCH MISSION ]`.

3. **Styling & Retro Theme (`style.css`)**:
   * Monospace terminal styling, glowing borders matching client corp color (`#00f0ff` Ixion, `#ff8800` Helion, `#ff0055` Kessler).
   * CRT scanline accent & subtle teletype text cursor (`█`).

---

## Implementation Phases

1. **Phase 1: Data Normalizer**  
   Implement `resolveBriefCards()` in `Missions.ts` to convert all 30 campaign briefs into structured 3-card sequences.

2. **Phase 2: UI Overlay & Paging Engine**  
   Update `Interface.ts` modal rendering to support multi-card navigation, step indicators, and keyboard controls.

3. **Phase 3: Teletype Animation & Polish**  
   Add fast character streaming, skip keybindings, and corporate color coding.

4. **Phase 4: Verification & Unit Tests**  
   Add unit tests in `Interface.test.ts` / `Missions.test.ts` asserting brief parsing, card bounds, and keybinding actions.
