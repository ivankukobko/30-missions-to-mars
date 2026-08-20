# Plan: Mission Zero — the UL-5 Relay

## Status

**Proposed.** Nothing is built. This is the decision record to argue with before anything
in `Airframe`, `Mission`, `Progress`, `Layout`, `Colony` or `Game.loadMission` moves.

---

## What it is

A prologue flown before mission 1. The vehicle is an antenna with legs, it lands on the
**rim** rather than the canyon floor, and it has exactly one control: thrust.

It is the uplink relay. Once it is standing, the charters can reach you. Until then
nobody can, which is the whole design.

## What it buys

**The only silent mission in the game.** No brief, no card, no sender, no music. Nobody
can talk to you before the link exists, so the first voice in the campaign — Ixion's
mission 1 transmission — is a *consequence of your first landing*. `docs/lore.md` already
says mission 1 addresses you as nothing; this addresses you not at all.

**An instrument ramp that is already half-written.** Mission 1's brief says you have no
altimeter, no ranging and no bearing until the radar is planted. So:

| | Voice | Instruments | Controls |
| --- | --- | --- | --- |
| **0** | none | none | thrust only |
| **1** | Ixion | none | full |
| **2** | Ixion | slaved to the mast | full |

Three stages, each turned on by something the player did, none of it a tooltip.

**A light on the rim for thirty missions.** Every mission starts between y 1070 and 1290
and the rim is at `CANYON.RIM_Y` = 240, so every entry falls 830–1050 units *past* the
relay — during the one stretch of a run where the player has nothing to do but watch. It
is the only fixed point in a canyon that spends thirty missions changing.

**It belongs to nobody.** Ixion is green, Helion orange, Kessler blue; the relay is
`--sys`, the register `Interface.ts` already reserves for what is the player's rather than
a charter's. It is the first prop in the game with no `corp`, and that is the point.

### It pairs with the mast rather than repeating it

The worry was two consecutive site-a-permanent-object missions. They turn on different
things:

| | Where | Whose | Turns on |
| --- | --- | --- | --- |
| UL-5 relay | Rim | Yours | Being reachable at all |
| Navigation radar | Floor | Ixion's | Measurement |

Both are placed by the player and frozen for the rest of the campaign. They are the only
two objects in the canyon whose position the player chose.

---

## Decisions

### The prologue is not in the mission table

`MISSION_COUNT` is 30, `Missions.test.ts` asserts the ids are exactly 1…30, and
`getMission(0)` returning null is itself an assertion — it is the guard that triggers
victory. The game is called *30 Missions to Mars*.

So: `export const PROLOGUE: Mission` with `id: 0`, of the same shape as the table's
entries but not in it. `Game.loadMission` takes a `Mission` and does not care where it
came from, so this costs no second load path — which is the reason not to build the
prologue as a bespoke scene instead.

`getMission(0)` stays null. The prologue is reached by name, not by index.

### The relay is a prop with no owner

```ts
| { kind: 'relay'; x: number; y?: number; live: boolean }
```

Modelled on `radar`, which is already the exempt case: no collider, ignored by the layout
resolver, standing wherever the player put it. `relay` needs the same exemption for the
same reason and one more — a half-buried mast that could eat a landing or be relocated
into an approach corridor would be a hazard nobody authored.

No `corp` field. Every other prop has one; this is the first that cannot.

`live` is the entire reveal mechanism. See below.

### Four dead siblings, and they are Ixion's

Four more relays, authored at fixed positions on the floor and lower slopes, half-buried
in dust, `live: false`. They are in the world from the prologue onward — they predate
every charter.

**They are Ixion's, not Kessler's.** Kessler arrives at mission 6; hardware that has been
in this canyon long enough to be buried cannot be his. Ixion got here first, keeps records
nobody reads, memorialises dead machines, and is broke enough to be running equipment that
was second-hand when it landed. Four dead relays is what a long-running underfunded
outpost accumulates.

An earlier draft had Kessler saying *"I have run four of these links before yours — two of
them are still in the hole."* It is cut: it welded his career to this canyon's history,
and it forced hardware into a shaft he had not dug yet.

**The strobe is the tell.** Yours blinks on the rim. Theirs are dark. Same silhouette, one
lit and four not — the player learns what the shape means from the one that is alive, and
every dark one is a corpse. No text anywhere.

The recognition works because the player *flew* it: thirty seconds of third-person camera
on an antenna with legs, and then that shape turns up in the dust.

**Guarantee one sighting.** Scattered props in a canyon this size get missed. One goes
within sight of `outpost-main`, a pad the player lands on eight times from mission 2. The
other three stay properly missable, which is what makes them feel found rather than
placed.

**Nothing in any brief refers to them.** One line, from Ixion, at mission 23 — the
contract where the outpost is patching a twenty-mission-old reclaimer it cannot replace —
and it never says *you will have seen them*.

### No console

Not a reduced console: none. The relay has no instruments because the radar is not up, and
`AIRFRAMES` needs to express that rather than `Interface.setAirframe` special-casing an id.

Fuel is carried but ungauged, and generous enough that it cannot be the fail condition —
an invisible resource the player can run out of is not a lesson. The only way to fail
mission zero is to land too hard, which is the only thing it teaches.

### Silence

No `musicTrack`. The prologue is engine and wind. It is the one mission with no charter to
be scored for, and the score arriving with the first voice is worth more than a theme
here.

### The blink is posed from `missionTime`

`Colony.ts` currently advances the radar's strobe with `radar.phase += dt`. That is
tolerable for a dish nobody counts, and it is not good enough for the object the player
looks at on every entry for thirty missions — `CLAUDE.md` is explicit that anything that
moves is posed from the fixed 120 Hz step. The relay's blink is derived, not accumulated.

Migrating the radar to match is worth doing at the same time and is not a prerequisite.

---

## What has to change

| Area | Change |
| --- | --- |
| `Airframe.ts` | Fourth `AirframeId`. `UL-5 RELAY`. One control, no console, no `fuelScale` tuning that matters. |
| `Missions.ts` | `PROLOGUE` export. `worldAt` gains the relay position alongside `mastX`. |
| `Colony.ts` | `relay` prop kind, mesh, strobe, `--sys` livery. |
| `Layout.ts` | Exempt `relay` the way `radar` is exempt. |
| `Progress.ts` | Store `relayX` and prologue completion. No points — the relay has no charter to pay. |
| `Interface.ts` | An airframe with no console. |
| `Game.ts` | Route the prologue through `loadMission`; suppress the brief when a mission has no `messages`. |

### Signature churn worth knowing about

`worldAt(id, mastX)` becomes two placements rather than one. `Missions.test.ts` drives it
from `MAST_POSITIONS` in several places, so this is the change most likely to be tedious.
An options object is probably worth it rather than a second positional argument.

### Saves

A save written before the prologue existed has no `relayX`. The rim stays empty rather
than the relay being placed at a guess — the same discipline as the mast height, where
`Missions.test.ts` asserts a pre-tracking save *omits* `y` rather than inventing one.

---

## Verify before building

- **Is there ground on the rim to land on?** The canyon generator raises walls to
  `RIM_Y`; whether the surface above is flat enough to be a landing site, and how wide,
  decides whether the prologue works at all. Everything else here assumes it does.
- **Is the relay actually visible on entry?** 830–1050 units of fall past it is the
  argument, but the camera director frames the lander, and fog thickens with depth
  (`Game.ts` lerps toward `0x2e1409` below the rim). A light that is never legible is a
  feature nobody sees.

---

## Deliberately not in scope

- **What you are.** `docs/lore.md` is explicit that the game never names what is on the
  other end of the link. The relay is equipment, like the mast. If it reads as your
  *body*, it answers the question the campaign is built on not answering. It is an
  antenna, it points up, and the game never says at what.
- **The other four antennas' fate.** That two of them failed is available. How, and what
  became of the links behind them, is not.
- **Whether there is a sixth.** Helion's mission 29 classifier leaves the file open. That
  is the whole of the answer.
