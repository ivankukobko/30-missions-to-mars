# Localisation

The game is in English (`en`), German (`de`) and Ukrainian (`uk`). Translated: the interface
— menus, HUD captions, settings, failure cards, the touch hint — and the campaign's words:
briefs, radio calls, debriefs, payload names, goals and the epilogue.

Not translated, deliberately or not yet: charter names where the interface prints them from
`CORPS` (the pause manifest's CLIENT row, the owner on a WRONG ADDRESS card), airframe names,
pad names, and units.

## Words and structure live apart

`src/campaign/missions.yaml` holds everything about a mission except its words: entry,
velocity, mass, cargo shape, fuel, pads, excavations, radio triggers, and one entry per brief
card saying whose card it is. Every word the player reads is in `src/locales/<code>.yaml` —
English included — laid over the table by mission id and entry index. The simulation never
reads a locale file.

Two arrangements were rejected on the way here:

- **A copy of `missions.yaml` per language.** It puts physics in a translator's file: a slip
  changes a mission in one language only, and every balance harness (`FuelBudget`,
  `ReferencePilot`, `ColonyBalance`) measures the one table.
- **English in `missions.yaml`, translations laid over it.** That was the first cut, and it
  held only until English got a locale file of its own. From then English existed twice, the
  file won, and the copies had already drifted: two lines reworded in the locale file were not
  the lines in the table, and nothing said so.

Each language is one file in two sections:

| Section | Holds | Read by |
| --- | --- | --- |
| `ui` | Interface strings | `i18n.t` in `src/i18n/I18n.ts` |
| `campaign` | Mission words, by mission id | `src/campaign/CampaignLocale.ts`, resolved in `Missions.ts` |

`src/i18n/Locales.ts` finds the files by glob, so a language is added by adding its file. A
hand-kept import list is one more step to forget, and forgetting it does not fail: the language
quietly resolves to English.

**YAML, parsed at build time.** The campaign half is prose edited by hand, and YAML carries it
without escaping and with room for a note — the reasoning behind a line sits beside it, as it
does for missions 25 and 26's debriefs. `vite.config.js` turns each file into a plain object
during the build: parsing them in the page measured 10–20 ms a language in Node, against under
1 ms for the same data as JSON, and a syntax slip belongs in the build output rather than a
player's console.

Strings are written one per line, unwrapped, so a changed line in a diff is a changed string.
Quote a value that starts with `{` — `"{{count}} RUNS"` — or contains `: ` or ` #`. Unquoted,
YAML reads those as something other than text; the key-parity tests fail on it.

## Editing the campaign

A line's words are edited in `src/locales/en.yaml` and its translations. How many cards a
mission has, and whose each one is, is `messages` in `missions.yaml`: adding or removing a card
means an entry there and one at the same index in every language file, and the tests name each
file that is missing it.

## Where a string comes from

### Interface: `t(key, params)`

The active language's `ui` section, then English's, then the key itself. `{{name}}` is
interpolated from `params`. With a numeric `count`, `_zero` is tried first for 0, then the
form `Intl.PluralRules` names for that language (`_one`, `_few`, `_many`, `_other`), then
`_other`.

### Campaign

The mission table decides what exists; the words come from the language asked for, else from
English. English is the fallback for every language, and a language with no file reads as
English.

| What | Resolved by | Structure from | Words |
| --- | --- | --- | --- |
| Brief cards | `resolveBriefCards` | `messages`: how many, in what order, whose livery | `sender`, `content` at that index |
| Payload name | `resolvePayloadName` | — | `payloadName` |
| Goal | `missionGoal` | — | `goal`, else `defaultGoal` |
| Debrief | `resolveDebrief`, `debriefLine`, `resolveDebriefSender` | English: whether there is one, and which variants | `sender`, `content`, `strong`, `weak` |
| Radio call | `resolveRadioCall`, `resolveRadioCalls` | `radio`: when it fires, whose colour | `sender`, `content` at that index |
| Epilogue | `resolveEpilogueCards` | `epilogue`: how many, livery, register | `sender`, `content` at that index |

Why none of the structure is a translation's to decide:

- **Card and call counts** are the mission's pacing, and a retry must fly the same. A card past
  the table's count is ignored; a missing one shows English.
- **Radio triggers** (`atAltitude`, `atSeconds`) come from the table untouched, so a German
  retry fires the same calls at the same points as an English one. See *Determinism* in
  `CLAUDE.md`.
- **Debrief variants** are English's. They were first chosen from each language's own file,
  which let a translation that left out a `strong` line answer an S-rank landing with the
  standard line in that language alone.
- **Goals** are authored as `goal` in every language and held to the brief by a test: a goal
  must appear word for word in its own language's brief. The readout used to be scanned out
  of the brief after `<b>OBJECTIVE</b>`, and that marker is copy — `ZIEL`, `ЦІЛЬ`, and in
  English a word in a file edited by hand. Reword one and the readout fell back to the generic
  line with nothing to say it had.
- **Cargo shape** is `Payload.shape`, authored on all 29 payloads. It used to be inferred from
  the English payload name, which put what hangs under the lander one edit away from changing.
  The inferred shapes were written in unchanged, and every resolved string, colour and shape
  was compared before and after the words moved: identical, in all three languages.
- **A Helion radio call has no sender** in any language, and the files write that as `""`.
  `Radio.show` draws a card with no header only for `undefined`, so an empty sender counts as
  none; taken literally, it gave every Helion call a blank header bar.

## Liveries follow `from`

A brief card wears its sender's colour, not the client's — Ixion cutting into a Kessler
contract must look like an interruption. The colour comes from the card's `from` in
`missions.yaml`, a charter id (`outpost`, `helion`, `kessler`), never from the name printed on
the card. A paperwork card — `CONDITIONS OF CARRIAGE`, an arbitration annex — is `from` its
client. On the epilogue, the console's own card has no `from` and wears the `sys` register.

The first cut looked the colour up by the sender's name, and so kept a map of every
language's spelling of every charter. It went stale the first time a Ukrainian sender was
reworded, and Kessler's epilogue card fell back to the outpost's green.

## Choosing the language

1. The saved preference: the `locale` field of `mtm.prefs.v1`, stored with the sound and
   control settings, and kept across canyons.
2. On a first run, `navigator.language` reduced to its first subtag by
   `i18n.normalizeLocale` — `de-CH` is `de`, `uk-UA` is `uk`.
3. Anything not offered is English.

`Game`'s constructor applies the language **before** `new Interface()`. The HUD's captions
and the pause button's label are built once in that constructor, and in the other order a
German or Ukrainian player saw them in English until they changed language by hand.

## Changing it mid-game

The toggle sits in SETTINGS and on the pause card.

- **From the menu**, the settings card is rebuilt, and everything after it is drawn fresh.
- **From the pause card**, `Interface.updateStaticLabels` rewords what was built once: HUD
  captions, the payload line, the pause manifest, and the instrument captions. The captions
  are tagged with their key (`data-i18n`) and rewritten in place, because rebuilding a panel
  starts its needles at rest and a flight resumed with every reading gliding in from centre.
  Warnings, the uplink line and the touch hint call `t` each time they are drawn. A radio
  card already on the glass stays in the language it arrived in.

## Case

A value interpolated into a sentence takes whatever case that sentence governs, and a string
translated as its own key cannot know which. Ukrainian printed *"належить ІНШИЙ ОПЕРАТОР"* —
nominative where `належить` wants the dative — because ANOTHER OPERATOR was a separate key
dropped into the WRONG ADDRESS sentence.

So a slot is filled only by what no language here declines: figures, pad names, and charter
names, which are Latin-script. Anything that would decline gets a whole sentence of its own —
`crash.wrong_address_unowned_detail` beside `crash.wrong_address_detail`. If charter names are
ever translated, they need a key per case they appear in; `t` already resolves nested keys, so
that takes no new machinery. `t` has no ICU-style `select`, and nothing yet needs one.

## Ordinals

`{CENTILE}` in a Helion debrief becomes `i18n.formatOrdinal(points, locale)`:

| Language | Rule | 95 |
| --- | --- | --- |
| `en` | `Intl.PluralRules` ordinal: ST, ND, RD, TH | `95TH` |
| `de` | A full stop | `95.` |
| `uk` | `-Й`, which agrees with ПРОЦЕНТИЛЬ (masculine, nominative) | `95-Й` |

The Ukrainian suffix is grammar, not decoration: a template that puts the figure in another
case or gender needs a different ending, and `formatOrdinal` would need to know which.

## Tests

`src/i18n/I18n.test.ts` and `src/campaign/CampaignLocale.test.ts` check structure, and neither
quotes a translated line. The copy is still being edited, and a test pinned to a sentence
fails on every edit while catching nothing an edit can break. `Missions.test.ts` keeps the
campaign's own editorial rules — Helion's datagram form, the joke's order, no tally of runs —
and reads the English they apply to through the same `resolve*` functions the game does.

They fail when:

- a language's `ui` section has a key or `{{placeholder}}` English lacks, or the reverse
  (plural forms folded — Ukrainian's `_few`/`_many` are grammar, not extra keys);
- a language file exists that the settings toggle does not offer, or the reverse, or its
  strings do not reach `t` — including a YAML value that parsed as something other than text;
- English lacks words for a card, call, epilogue card, payload name or goal the table needs;
- a language adds, drops or splits a brief card, radio call or epilogue card;
- a translation's debriefs or `strong`/`weak` variants differ from English's, or a `{TOKEN}`
  is lost or invented;
- a translation lacks a payload name, goal or debrief that English has;
- a goal contains markup or does not appear word for word in its own brief, or a card runs to
  240 characters in any language;
- a card's livery, a radio call's triggers or colour, or an epilogue card's register differ
  from the table's.

## Adding a language

1. **Offer it.** Add `{ code, label }` to `SUPPORTED_LOCALES` in `src/i18n/I18n.ts`. `label`
   is what the settings toggle prints, in the language itself.
2. **Translate it.** Copy `src/locales/en.yaml` to `src/locales/<code>.yaml` and translate
   both sections; nothing needs registering. In `ui`, give `history.runs` whichever plural
   forms `Intl.PluralRules(<code>)` names. In `campaign`, keep every list the same length as
   English's, keep `{CENTILE}` where it is, write `goal` wherever English has one — word for
   word as it appears in your brief — and keep the same `strong`/`weak` variants.
3. **Ordinals.** Add a branch to `formatOrdinal` if the language's rule is not English's.
   Unknown codes get English suffixes.
4. **Check it:**

   ```bash
   docker compose run --rm --no-deps app sh -c "npm run typecheck && npm test"
   ```

   The structural tests name each missing key, card, variant or token by mission and index.

Nothing else needs to know the language exists: liveries, radio timing and cargo shapes all
come from `missions.yaml`.
