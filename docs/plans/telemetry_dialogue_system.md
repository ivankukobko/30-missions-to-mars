# Brief Cards

## Status

**Live.** `src/ui/Brief.ts` and `src/ui/Teletype.ts`, entered from `Interface.showBrief`;
the data side is `resolveBriefCards` in `src/campaign/Missions.ts`. Tests live in
`Missions.test.ts` — there is no `Interface.test.ts`.

This file was written as a plan and is kept as the record. What shipped differs from what
was planned in almost every specific, and the differences are the useful part.

---

## What was cut, and why

The plan prescribed a fixed three cards: corporate transmission, system diagnostic,
contract manifest. All three were built and two were removed; the third was never a
speaker.

- **The manifest card was the HUD written out in words.** Payload sits top-left, fuel is
  a gauge, and the vehicle is the console you are about to look at. Reading it back first
  taught nothing and cost a page on every retry. It lives on the pause overlay now, where
  it is there if you want it and absent if you do not.
- **The diagnostic card talked over the fiction.** A keybinding switch in the middle of a
  charter's transmission is the game interrupting at the exact moment the fiction is doing
  its work. Worse than redundant.
- **The objective card invented a speaker.** An earlier version split the legacy brief at
  its `<b>OBJECTIVE</b>` marker and gave the tail its own page, headed `OBJECTIVE` —
  but nobody on this canyon is called Objective. You take work from employers, and the
  address is a line inside what the employer said, so it stays where it was written.

What survives is the only part that was ever load-bearing: **every card is somebody
sending you something.** A sender, and what they said.

---

## The card count is authoring, not formatting

Not "normalised 2–3 cards". A mission spends the pages it needs, and where the breaks
fall is a decision about beats: **24 missions run to two cards, six to three** — 66 cards
across the campaign.

A page turn is a beat, and a card holding four sentences has spent that beat on nothing.
The Helion contract form is the worked example: authored as a single card first, it read
as a wall — seven fields and a three-sentence route note arriving together, which is the
exact shape the sequence exists to break up.

Everything else split at the paragraph boundaries the briefs already had, with the
objective riding the last card rather than taking one. The breaks are chosen, not
mechanical: mission 1 gives *"where you set it down is where it stays"* a page to itself
because missions 2 and 30 are built on it, and mission 28 isolates *"fly it home one last
time, navigator"* on a 37-character card, the shortest in the game.

The longest card is now **228 visible characters, ≈2.5s of teletype**, down from a
568-character brief at 6.3s. No Helion card exceeds 240 and a test holds it; the Helion
count also carries that faction's arc — two cards, three once the arbitration annex
exists. See `docs/lore.md`.

### Who a card is from

A charter with a person behind it is the same person on card three, so **the sender
repeats on every card**. That is not decoration: it is what will make a *changed* sender
legible on the day a rival cuts in mid-brief. If the name appeared only on card one, an
interruption would be invisible.

Helion is a form rather than a person, so its headings move instead — `HELION EXTRACTION`,
then `CONDITIONS OF CARRIAGE`, then `ANNEX A — ARBITRATION`. A document's pages are headed
by their section. Both rules are asserted.

**A card wears its sender's livery, not the client's.** Painting every card in the colour
of whoever the mission was flown for was indistinguishable from correct right up until a
card arrived from somebody else: mission 15's `IXION OUTPOST` header came out in Kessler's
blue, which is the one thing an interruption must not look like. Senders that are not
charters — `CONDITIONS OF CARRIAGE`, an annex — are that client's own paperwork and keep
the client's colour.

---

## Data model

Not `brief: string | BriefSegment[]`. One required field:

```ts
messages: BriefMessage[];   // { sender: string; content: string }
```

`sender` rather than the planned optional `title` is the difference that matters. It lets
a card be somebody other than the client — a rival charter cutting in, or the outpost
commenting on someone else's contract — which a single string could never express and
`BriefSegment.title?` did not say out loud.

The `brief` string it replaced is **gone**, along with `stripLeadName` and the fallback
branch of `resolveBriefCards`, which is now a pass-through. Both forms were carried for a
while so the thirty briefs could be split as authoring work rather than in one refactor;
once all thirty were converted the string had no missions left and was deleted rather than
left as a path nothing takes.

---

## Teletype

**90 characters per second**, wall-clock paced on `requestAnimationFrame` — not a
15–20 ms `setInterval`. Both departures were forced:

- **The markup.** Briefs are authored HTML, so the obvious implementation — revealing a
  growing prefix of the string — renders half of `<b>` as literal text for a frame and
  rebuilds the element's DOM every tick. Instead the markup is parsed once and the *text
  nodes* are emptied and refilled, so a bold run is bold from its first character.
- **The clock.** Everything that moves in this game is posed from `missionTime` so a retry
  replays identically. This runs while the simulation is stopped behind a brief, so there
  is no mission clock to pose from and nothing about it can reach a run.

Longest card in the campaign is 228 visible characters, ≈2.5s.

---

## Interaction and chrome

- `Space`, `Enter` or a click advances. The **first** press finishes the typing rather
  than paging — and the handler is captured on `window`, not the card, because the button
  holds focus and would otherwise swallow `Space` as a click, paging past text the player
  has not read on the very first keystroke.
- Progress dots appear only when there is more than one page.
- The button reads `NEXT`, and `BEGIN DESCENT` on the last card.
- The eyebrow is the sender, painted in the client's colour from `CORPS`: Ixion
  `#36f5a0`, Helion `#ffa42b`, Kessler `#35c8ff`. The three hex values in the original
  plan were all wrong, and had Kessler red — he is blue.
- `.card` is `max-height: 100%; overflow-y: auto`, so a long card scrolls rather than
  overflowing the panel.

---

## Open

- **The `sys` register is unreachable.** `Page.register` supports `'sys'` and `.card-sys`
  is styled and used by the game's own screens, but `buildBrief` hardcodes `'corp'`. The
  console's own voice is built and nothing can currently speak in it.
- **No skip-all.** The plan wanted `Esc` to jump to the last card for retry flow; it was
  not built. Paging a three-card Helion contract on a retry is three keystrokes.
Cut-ins are live: the outpost interrupts a charter's contract at **15, 19 and 30**, and
the mission 30 carrier is the case the `sender` field was built for. See `docs/lore.md`.
A cut-in never takes the last card — the client resumes and still gives the address.
