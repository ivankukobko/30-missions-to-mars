# Plan: Main Menu & Save Slots

## Status

**Done, slots included.** The menu shipped first; slots and playthrough history followed.

Two things the slot plan below got wrong, both corrected in place and flagged
**Corrected**: the index key it proposed is a cache nobody needs, and preferences had to
move *before* slots rather than alongside them.

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

## Save slots

`Progress` wrote one record at one key. Slots mean keying by slot and choosing one
before the campaign loads, and the shape was already close: `ProgressStore` is
deliberately a two-method seam, and the constructor takes it injected, so a slot-aware
store is a parameter rather than a rewrite.

What shipped:

- **`mtm.progress.v1` is slot 0**, unsuffixed and unmoved, so every existing player's
  campaign is already slot 0 and is neither relocated nor rewritten. A format change that
  moves records is a format change that can lose them.
- `mtm.progress.v1.<n>` for the rest, `mtm.active.v1` for which one is live.
- **Preferences left the slot**, to `mtm.prefs.v1`. `Progress` keeps the accessors `Game`
  already called and delegates them, so nothing above had to change.
- `mtm.history.v1` for finished campaigns — see below.

> **Corrected — the index key is not worth having.** This plan proposed "an index key
> listing which slots are occupied, so the menu can render empty ones without parsing
> every record". That is a cache: three small `JSON.parse` calls cost nothing measurable,
> and an index is a second copy of the truth that can disagree with it. The disagreement
> would be a slot the menu calls empty over a campaign that is not. `readSlots` reads the
> records.

> **Corrected — preferences had to move first, not alongside.** The plan filed this under
> "design slots before building them", but it is not a slot problem at all: `reset()`
> already hand-copied three fields out of the record and back into a fresh one to stop a
> reroll unmuting somebody's music. That workaround *was* the missing split, and doing it
> properly deleted the workaround rather than adding to it.

**The migration is a copy, not a move.** Every save written before this keeps its
preferences inside the campaign record; `Preferences` lifts them out on first load and
leaves the originals exactly where they were. Nothing is destroyed to complete a
migration, so a build from before the change still finds what it expects.

## Playthrough history

A campaign is filed when it ends, either way it can end — completed, or discarded for a
new canyon — and `archivedAt` on the record is what stops a campaign that is completed
and *then* rerolled being filed under both. A canyon nobody flew is not filed at all.

Kept per run: seed, deliveries, total points, the rank tally, whether it was completed,
and when it started and ended. Bounded at `HISTORY_LIMIT`, newest first — it is the one
key that would otherwise grow without limit, and localStorage fails writes rather than
pruning.

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
