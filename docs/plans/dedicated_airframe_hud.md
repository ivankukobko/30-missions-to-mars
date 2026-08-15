# Plan: Dedicated Airframe HUD

## Status

**Implemented.** Per-airframe instrument panels and per-charter livery are in.

- `airframeFor` is one frame per charter with no exceptions — see
  [Vehicles → Who Flies What](../vehicles.md).
- `src/ui/Instruments.ts` — the maths, with `Instruments.test.ts` against it.
- `src/ui/HudData.ts` — telemetry as a discriminated union.
- `src/ui/InstrumentPanel.ts` — the three panels.
- `Shaft.clearanceAt` / `CanyonGenerator.clearanceAt` — bore clearance, tested in
  `CanyonGenerator.test.ts`.
- `Interface.setAirframe` replaces `setTiltInstrument`.

The one item deferred is noted under [Open](#open).

---

## Why

The HUD is diegetic. You are an AI connecting to a vehicle and flying it through the
interface it came with — not a game drawing a game's HUD over three different ships. Each
charter bought its own hardware from its own supplier for its own kind of work, and the
console says so before the first burn.

That premise does the design work here. It says what the instruments show (whatever *that*
vehicle's builder thought mattered), how they look (whoever built them), and how they
behave (how old they are). It also explains the panel changing at all, which a
non-diegetic HUD has to either hide or apologise for.

The strongest single beat available is the TD-4 being **visibly older than the other two**.
Ixion is a science outpost flying the campaign's baseline frame; Kessler and Helion are
extraction charters with newer, purpose-built equipment. Fly the TD-4 for four missions,
then connect to a Helion sidewinder at mission 5, and the generational gap lands without a
line of dialogue.

---

## Two axes, and why they still stay separate in code

| | Comes from | Governs |
| --- | --- | --- |
| **Instrument set** | `airframe.scheme` | Which gauges exist, what they read, how they behave |
| **Livery** | `mission.client` | Colour, chrome, bezel treatment, boot banner |

Because assignment is 1:1, these two always agree in play and the doc can talk in charter
terms. Keep them separate in the code anyway: `scheme` is what an instrument is actually
*about*, `setTiltInstrument` already branches on it, and `mission.airframe` survives as an
override. Keying instruments off the corp would make that override render a panel that
does not match the vehicle being flown.

Livery colours come from `CORPS` in `world/CanyonSpec.ts`. Do not restate the hex values
anywhere — including in this document — or they will drift.

`--corp` already flows through the brief card and the target marker. The HUD block itself
is not themed yet; that is the hook.

---

## Instruments

### TD-4 LANDER — `attitude` — Ixion

An old panel that tells the whole truth slowly.

- **Twin-needle cross-pointer.** One needle for vertical speed, one for horizontal, on a
  single round dial. **Not** a single needle plus a scalar magnitude: the landing test
  checks the two axes separately against `MAX_LANDING_SPEED`, so a combined `‖V‖` of 2.9
  hides whether you are about to land or about to skid. The reference is the LM panel,
  which was thoroughly archaic and still kept its axes apart. Archaic is the *idiom*, never
  the accuracy.
- **Attitude ring** around the dial, replacing today's separate `tilt-dial` rather than
  sitting beside it. Danger arcs past `MAX_LANDING_TILT`.
- **No numerals on the instrument.** Coarse ticks, thick glass, wear.
- **Needles settle.** This is where the age actually reads. The TD-4's needles lag and
  overshoot; the KD-9's bars snap; the HD-7's crosshair is exact and instantaneous. Half a
  second of play tells them apart.

Damp the needle inside the fixed step, like `LanderBody.bank`, not per frame.

**Mission 1 gets a better excuse.** `setInstruments(id > 1)` hides ALT and H/S on the first
mission as a teaching device. Under this fiction it stops being a game-design switch and
becomes a fact about the airframe — the old bird's ranging package is not fitted. Same
mechanic, no longer needs apologising for. Whatever the compass shows must respect it: no
horizontal-speed information on mission 1, in any form.

### KD-9 SHAFT HAULER — `differential` — Kessler

- **Two engine lamps, port and starboard.** `Firing.engines` is `boolean[]` — there is no
  throttle in the physics. Two honest lamps, not analog power bars. Heavy industrial
  treatment, high-contrast, no glass.
- **Differential bias arrow** between them, showing which way the imbalance is pushing.
- **Bore clearance gauge**, replacing the tilt dial that this frame does not need. A
  horizontal bar reading lateral margin to each wall.

Two things the gauge needs that do not exist yet:

- `Shaft.boreAt(s)` gives the cross-section, but `CanyonGenerator.shafts` is private. Needs
  a narrow accessor — `clearanceAt(x, y): { left: number; right: number } | null`.
- The hauler *descends to* a bore; it is not inside one for the first half of the run.
  Outside, the gauge has no reading. It returns `null` and the gauge fades out. An
  instrument that shows garbage half the flight is worse than no instrument.

### HD-7 SIDEWINDER — `translation` — Helion

Nearly free — every input already exists on the body.

- **Orthogonal crosshair.** Independent vertical and lateral sliders crossing at a target
  point. This is the one frame where re-presenting V/S and H/S earns its keep, because
  decoupled axes are the vehicle's entire premise.
- **RCS impulse lamps**, left and right, from `Firing.rcsLeft` / `rcsRight`.
- **Bank arc** from `LanderBody.bank`, marked cosmetic.

Plumbing: HUD horizontal speed is currently `Math.abs(lander.vx)` in `Game.updateHud`. A
left/right crosshair needs the sign. Carry signed `vx` in `HudData` and take the absolute
value at the one readout that wants a magnitude.

---

## The rest of the console

The instrument is not the whole panel. If the dial belongs to the vehicle and everything
around it belongs to the game, the premise only holds in one corner of the screen — so
the fuel gauge, the manifest line and the readouts carry the same three treatments, keyed
off `.hud[data-scheme]`.

- **Fuel.** TD-4 a rounded lit tube with a glass highlight; KD-9 segmented into blocks,
  because an industrial gauge counts in units rather than sliding; HD-7 a thin bar read
  against tick marks in the track.
- **Backing plates.** Rounded and glassy / square with a heavy 4px rule / thin with a
  machined corner cut.
- **Readouts.** Same numbers, three typographic registers — glow, weight, and a light
  precise face respectively. Deliberately not three different *accuracies*.

Two things are exempt, and the exemptions matter more than the theming:

- **`--danger` is never themed.** A player who has learned that red is the alarm cannot
  be asked to learn a second alarm colour because the contract changed hands. Cautions
  take the livery; criticals do not.
- **The target name and marker take the *pad's* corp, not the client's livery.** Most
  runs those agree and nobody notices. The ones that matter are the runs where they do
  not — a charter paying you to put something on a rival's slab — and there the mismatch
  is the only thing on screen saying who owns the ground. The marker is a sibling of
  `.hud` rather than a child so the livery variable cannot inherit into it.

**Position is not part of the treatment.** Every block stays where it was on all three
airframes. A player re-hunting for the fuel gauge each time the contract changes hands is
paying a real cost, and the fiction does not repay it.

## The augmented layer

Painted on the vehicle itself, in `src/ui/Reticle.ts`. Corner brackets, an attitude arc,
and a vector arrow with a speed on it.

**This one is the player's, not the airframe's.** It looks identical on all three frames
and never takes a client's colour — `--ar` is deliberately none of the three liveries. The
console in the corner is whatever hardware the charter bought and changes hands with the
contract; the overlay is the AI doing the flying. As the panel changes underneath, the
brackets are the one thing on screen that stays yours. The overlay element is a *sibling*
of `.hud` rather than a child, which is what stops the livery `--corp` inheriting into it.

**It divides labour with the panel instead of duplicating it.** The overlay answers *where
am I going and how level am I* — direction and attitude, read at the vehicle where the eyes
already are on final approach. The panel answers *will this kill me* — magnitude against
tolerance, per axis. That is why the arrow may carry a scalar speed without reopening the
argument against a scalar on the panel: the axes are still split where the landing is
actually decided.

**Brackets, not a silhouette outline.** A real outline needs a post-process edge pass, and
this scene is fragment-bound — CLAUDE.md records MSAA alone measuring about half again the
frame cost. Brackets sized from the projected hull cost nothing and read more like a
targeting overlay anyway.

**The frame is measured, not authored.** `Lander.visualBounds` walks the group and
transforms each mesh's bounding box, per the CLAUDE.md rule. It has to: the silhouette is
dominated by the cargo, which is per-mission. Measured across the campaign the hull runs
from 0.900 above the origin on mission 1 to 1.368 on mission 30, against a collider of
0.62 — and its visual centre sits about 0.38 *above* the point the physics tracks, because
the load stands on the deck and the gear hangs below. A frame drawn from `LANDER.RADIUS`
sits inside the load it is supposed to be framing. Invisible meshes are skipped, which
keeps the exhaust plumes out; a box that grew by `FLAME_LEN` on every burn would pulse
with the throttle.

**Attitude only on the frame that has one.** Null rather than zero for the locked-rotation
vehicles, same reasoning as the tilt dial. Their cosmetic `bank` is never fed here.

**It goes down with the vehicle.** `setHudVisible(false)` takes the overlay with it, and a
crash now calls it — the hull is hidden and the wreck settles for 1.3 seconds, and the
brackets used to track a hull that was no longer drawn while the fuel gauge reported on a
vehicle that had stopped existing. `fail` always did this; the crash path reaches the same
place a beat earlier and never did.

**It arrives when the camera does.** Gated on `CameraDirector.phase` leaving `'sky'`, and
eased in over 320 ms. On the entry framing the vehicle is a speck, the brackets would be
clamped to their minimum around a few pixels of hull, and the arrow would only ever read
"straight down, very fast" — while covering the one shot that asks the player to look at
the canyon rather than at instrumentation. Position keeps updating while stowed, so it
fades in already in place instead of sliding into it. Reads as the AI acquiring the
vehicle rather than a HUD switching on.

**Mission 1 keeps its arrow but loses its numeral.** Direction is not ranging — which way
you are sliding is something your own eyes report — but a figure in u/s is, and printing
one on the hull would undo that mission's lesson more thoroughly than the panel ever
could, sitting exactly where the player is already looking. The arrow still reddens past
tolerance: knowing you are coming in too hot is not a readout, and withholding it would
make mission 1 unfair rather than merely bare.

## Boot sequence

When the brief closes, the panel wakes: bezel draws in, needles sweep to full scale and
fall back, lamps self-test, livery announces itself. Roughly 900 ms, distinct per airframe
— the TD-4's sweep is slow and mechanical, the HD-7's is an instant snap.

This is the single cheapest thing that sells "different system, different handshake," and
it is the moment the charter's colour arrives.

**Pose it from `missionTime`, not `performance.now()`.** `Interface` does not currently
receive it; `Game.updateHud` will need to pass it through. A retry must replay identically.

---

## Data model

`HudData` becomes a common part plus a discriminated variant, **not** one wide interface
with optional fields. `Airframe.ts`'s own header argues this case: a union means the
differential branch cannot read a field that has no meaning for it.

```ts
interface HudCommon {
  fuel: number;
  fuelCapacity: number;
  altitude: number;
  verticalSpeed: number;
  /** Signed. The crosshair needs a direction; readouts take the magnitude. */
  horizontalSpeed: number;
  abyssProximity: number;
  /** Fixed-step mission clock, for boot and needle damping. */
  missionTime: number;
}

export type HudData =
  | (HudCommon & { scheme: 'attitude'; tilt: number })
  | (HudCommon & {
      scheme: 'differential';
      engines: boolean[];
      /** null outside a bore — the gauge fades rather than lying. */
      clearance: { left: number; right: number } | null;
    })
  | (HudCommon & {
      scheme: 'translation';
      rcsLeft: boolean;
      rcsRight: boolean;
      bank: number;
    });
```

---

## Verification

Tests and a screenshot are not sufficient here, for the same reason they are not sufficient
for geometry: a needle 90° off its axis, a mirrored clearance bar, or a crosshair that
drifts with the sign of `vx` all pass a suite and look plausible in a still.

So the instrument maths does not live inline in `updateHud`. Put it in a pure module —
needle angle from a velocity pair, bar fill from a clearance pair, boot phase from
`missionTime` — and test it directly:

- Needle angles at the axis extremes and both signs of `vx`.
- Clearance bar symmetric about bore centre; `null` outside a bore.
- Boot phase is a pure function of `missionTime`: same time, same frame, always.
- Mission 1 emits no horizontal-speed information through any instrument.

Then fly it: mission 4 (last TD-4 before the handover), mission 5 (first HD-7), mission 6
(first KD-9) — three consecutive missions covering all three panels and the generational
contrast the design rests on.

**What that turned up.** Two things no test would have:

- The bore gauge kept its warning class on the way out of a bore, so a hauler climbing
  back into open air carried a red wall alarm under a dimmed gauge for the rest of the
  run. The `offline` branch cleared the reading but not the warning.
- Measured against the live `Firing` state, the lamps and the bias arrow agree with the
  physics rather than the keypress — which is the case that matters, since the
  invert-controls setting moves which engine a key lights without moving which way the
  vehicle goes.

---

## Open

- **Mission 5's fuel changed.** It now flies the HD-7 at `fuelScale` 0.92, so the brief
  reads 350 where it read 380. Untested against the approach; may want the authored figure
  raised to compensate.
- Whether the archaic treatment should extend to a slower **refresh** on the TD-4 — a
  panel that visibly updates less often — or whether that crosses from character into
  unfairness.
