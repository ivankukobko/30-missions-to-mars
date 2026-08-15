# Plan: Main Menu & Save Slots

## Status

**The menu is done. Save slots are not** — that section stands as the plan for them.

Shipped: a `MENU` state entered on boot over the player's own canyon, the four entries
below, a mission grid, `MAIN MENU` on the pause overlay, and an Escape stack replacing the
old two-way toggle. `newCanyon` no longer reloads the page.

Two things found while building it, neither of which the plan predicted:

- **`Progress.reset()` wiped preferences along with the campaign**, because it replaced
  the whole record with `fresh()`. Rolling a new canyon would have silently unmuted
  someone's music. Fixed by carrying audio and control preferences across the reset —
  which is the same separation the save-slot section below argues for, arriving early.
- **The camera followed the vehicle in `MENU`.** The frame loop ran `director.update` for
  every state except `BRIEF`, so one frame after `frameCanyon` aimed the shot it was
  hauled back to the lander parked at entry altitude, and the backdrop was empty sky.

---

## What already exists

The groundwork landed with the pause menu and is worth stating, because most of the menu
is assembly rather than invention:

- **A system visual register.** `.card-sys` — phosphor green, square, prompt glyph, block
  cursor. Three registers now answer three questions about who is talking: `--corp` is the
  client, `--ar` is you flying, `--sys` is you *not* flying. The menu is `--sys`.
- **A shared settings block.** `Interface.settingsBlock(settings: GameSettings)` renders
  SOUND, MUSIC and (only on the twin) CONTROLS. It was built shared precisely so the menu
  would not grow a second copy to keep in step.
- **Persisted preferences.** `Progress` stores `mutedSfx` / `mutedMusic` alongside
  `invertThrusters`, with the established backfill pattern for older saves.

So the menu needs a shell, a boot path, and the entries below — not new UI machinery.

---

## The problem it solves

The game currently boots straight into a mission:

```ts
this.loadMission(Math.min(this.progress.highestUnlocked, MISSION_COUNT));
```

There is no way in without flying, and three things have nowhere to live as a result:

1. **Settings before you commit.** Audio is a preference you want *before* the first
   engine lights, not after.
2. **Rolling a new canyon.** `Progress.newCanyon()` exists and is reachable only from the
   victory card, via `window.location.reload()` — a full page reload used as a state
   reset because there is nowhere else to go.
3. **Replaying a mission.** `highestUnlocked` is tracked and every rank is stored, but
   nothing lets a player go back and improve a C.

---

## Ways out, added after the menu landed

Every terminal screen now offers one, because the menu made that possible and their
absence became obvious once it existed:

| Screen | Options |
| --- | --- |
| Pause | `RESUME` · `RESTART MISSION` · `MAIN MENU` |
| Result | `RETRY MISSION` · `NEXT MISSION` |
| Failure | `RETRY MISSION` · `MAIN MENU` |

None of them confirm. Nothing is scored until a landing resolves, so an abandoned attempt
costs only itself — unlike `NEW CANYON`, which does confirm and focuses `CANCEL`.

`RETRY` on the result card is safe because `Progress.complete` keeps the best of each
measure: re-flying can only raise a rank, never lower it. Without it the only route back to
a C was the mission grid, two screens away, at the moment the player was told they got one.

The pause overlay also carries the **manifest** — payload, mass, fuel, vehicle, client —
which used to be read at the player before every run. See
[Brief Cards](telemetry_dialogue_system.md).

## Entries

| Entry | Behaviour | Notes |
| --- | --- | --- |
| **CONTINUE** | Loads `highestUnlocked`. | Hidden on a save that has never flown. |
| **MISSIONS** | Grid of 1–30, unlocked up to `highestUnlocked`, each showing its best rank. | The replay path. Data is already in `Progress.ranks` and `.points`. |
| **SETTINGS** | `settingsBlock` — the same rows the pause menu shows. | CONTROLS row absent with no vehicle loaded; see Open. |
| **NEW CANYON** | `Progress.newCanyon()`, then straight into mission 1. | Destructive: must confirm. |

The mission grid is the entry that earns the menu. Everything else could have been bolted
onto the pause overlay; a thirty-mission campaign with per-mission ranks and no way to
revisit one is the actual gap.

---

## Boot flow

Replace the unconditional `loadMission` in the constructor with a `MENU` state.

`State` gains `'MENU'`, and the frame loop already ignores unknown states for simulation
purposes — it only steps on `PLAYING` and `SETTLING` — so the menu costs no special
casing there. What it does need:

- The canyon still builds, so the menu sits over a live scene rather than a black page.
  The camera parks on its `'sky'` framing, which is what that phase is already for.
- `setHudVisible(false)` while in `MENU`, exactly as `pause()` does.
- Entering a mission from the menu goes through the existing `loadMission` → brief →
  `BEGIN DESCENT` path. No second entry route, or the two will drift.

**`newCanyon` should stop reloading the page.** `useSeed` already rebuilds the world in
place — disposes the generator, repoints the director's ground probe, reloads the mission
— and `newCanyon` can take the same path. The reload is there because there was no menu to
return to; once there is one, it is a state transition like any other.

---

## Save slots (stretch)

`Progress` writes one record at one key:

```ts
const KEY = 'mtm.progress.v1';
```

Slots mean keying by slot and choosing one before the campaign loads. The shape is
already close: `ProgressStore` is deliberately a two-method seam ("a seam, not a
reimplementation of the whole interface"), and the constructor takes it injected, so a
slot-aware store is a wrapper rather than a rewrite.

Sketch:

- `mtm.progress.v1` stays as **slot 0**, so existing players keep their campaign without a
  migration step. This is the constraint that matters — the format has already been
  extended twice by backfill rather than by discarding records, and slots should hold that
  line.
- `mtm.progress.v1.<n>` for the rest.
- An index key listing which slots are occupied, so the menu can render empty ones without
  parsing every record.
- Each slot's summary needs: seed, `highestUnlocked`, total points, and a timestamp. The
  first three exist; a `lastPlayed` field would be new.

**Preferences do not belong in a slot.** Audio settings are a property of the person and
their room, not of a campaign, so `mutedSfx` / `mutedMusic` should move to a separate
unslotted key when slots land. `invertThrusters` is arguably the same. Leaving them inside
the slot record means muting the music in one campaign and having it come back in another,
which nobody would read as intentional.

That last point is the reason to design slots before building them, and the reason this is
a stretch goal rather than a quick follow-up: it is a save-format change, and this format
has so far never lost a player's data.

---

## Open

- **Settings before a vehicle exists.** `settingsBlock` takes `GameSettings.invert`, which
  is null off the twin — so from the menu the CONTROLS row is simply absent. Defensible
  (the setting is about a vehicle you are not in), but it means the option is only
  discoverable mid-mission on the right airframe. Alternative: show it always from the
  menu, writing straight to `Progress`.
- **Does the menu need its own music cue?** `MusicComposer` is driven by
  `setMissionContext(corp, missionId)` and has no notion of a menu.
- **Escape from the menu.** `onKey` currently toggles `PLAYING`/`PAUSED` on the same key.
  With a menu behind pause, Escape needs a stack rather than a toggle.
