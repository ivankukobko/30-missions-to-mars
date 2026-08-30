# Lore & Factions

The campaign's design record. Everything here is shipped unless a section is tagged
**Proposed**, which means it is designed but not built — `docs/plans/` holds those.

That distinction is load-bearing. This file previously claimed persistent faction-trimmed
wrecks and an Ixion memorial yard, and neither exists in the code. A lore document that
overstates is worse than one that is thin, because the next feature gets planned against
furniture that was never there.

---

## The Player

There is no cockpit and no seat. You fly cargo airframes in Coprates Chasma over a
real-time telemetry uplink — thrust, vector angle, attitude, all remote.

**The game never names what is on the other end of that link.** That is the campaign's
central omission, not a gap in it, and every rule below exists to protect it.

- **Uplink & telemetry.** From mission 1 your ranging, altitude and target bearing are
  slaved to one navigation radar, standing wherever you set it down. `setMastX` freezes
  that position for the rest of the campaign, so the mast is the one structure in the
  canyon the player sited themselves.
- **Airframe interface.** Three control schemes, one per charter: manual pitch and
  attitude on the TD-4 lander, decoupled lateral translation on the HD-7 sidewinder,
  locked-attitude twin vectoring on the KD-9 hauler. See `docs/vehicles.md`.

### What They Call You

No brief addresses a human pilot. What each client calls you instead is the cheapest
characterisation in the game, because it reveals what they think you are.

| Client | Address | What it is |
| --- | --- | --- |
| Ixion Outpost | **navigator** | A proper noun. They think you are a someone — generous, and wrong. |
| Helion Extraction | a classification | Category work, done correctly. The only client that ever gets the answer, and it means nothing. |
| Kessler Deep | **tin can** | A common noun. The trade word for whatever turns up on the end of a link. Not wrong, and not about you. |

The axis is not accuracy. It is **what kind of noun you get**, and the three positions do
not overlap.

**The name is earned, not assigned.** Mission 1 addresses you as nothing — you have not
done anything yet. From mission 2 Ixion calls you *the navigator*, after the navigation
you built them. They explain it once and never again.

**Kessler's is a category, not a nickname.** *Tin can* is what he calls any remote unit on
a telemetry link; he used it before you and he will use it after. It appears in four of his
ten runs and is absent from every genuinely lethal one — 20, 24 and 26, where he is
concentrating on keeping the airframe intact. The omission does more work than the word.

A rotating set of insults was considered and rejected: a nickname that never repeats is a
thesaurus, not a relationship. But the repetition is not a relationship either — it is
ten runs of a category noun, which is what gives the single deviation its weight.

**There is exactly one deviation.** At mission 29 Kessler calls you *navigator*, the only
proper noun he ever uses, two missions after the only client who thought you were a someone
stopped transmitting. He stops addressing a type and addresses the one in front of him. It
is never explained and the player is never told to notice. `Missions.test.ts` asserts all of
it, because prose drifts.

### The Carrier

Mission 29 is the only brief in the game that somebody interrupts.

Kessler is mid-sentence — measuring how long he has been at this mouth, the outpost dark a
couple of months back — when a card arrives headed **IXION OUTPOST**, carrying one sentence
and nothing else: *"We are the
only thing at the bottom of this canyon, and we intend to stay that way."* It is the second
sentence of mission 1, the same string, and the first thing the player ever read. Kessler's
next card opens `...say again.`, gets nothing, picks up the exact word he was cut off on,
and finishes the job.

Three things hold it up, and all three are asserted:

- **Verbatim, or it is a reference rather than a recurrence.** A paraphrase reads as the
  writer pointing at mission 1. The identical string reads as the channel doing something.
- **The line carries no name.** Mission 1 addresses you as nothing, so there is no
  *navigator* in it for Kessler to have picked up off the air. His use of it three cards
  later stays his own, uncaused.
- **He never investigates.** No speculation, then or ever. The last human voice on the
  canyon hears the first one, asks it to repeat, and detonates the charge anyway. *Say
  again* rather than *repeat* — on an industrial channel *repeat* means do it again, which
  is an unfortunate thing to say while holding a Final Charge.

Whether the mast is looping a stored ident or something is still down there is never
raised. Ixion left the radar powered at mission 27 and said so; that is the whole of the
mechanism the game offers.

There is a second reading, and it is left standing: the mast is broadcasting a territorial
claim on a channel nobody is left to hear, from equipment deliberately left powered by the
party who benefits if everyone else leaves.

### You Are Not The First — **Proposed**

Four carriers flew this canyon before you. They flew for **Ixion**, during Ixion's own dig,
and none of them came back — which is plausibly why that dig stopped. Not a decision: an
attrition rate an underfunded outpost could not fund.

Their machines are still here, half-buried on the floor and lower slopes, dark. Yours
blinks on the rim. Same silhouette, one lit and four not, and the player learns what the
shape means from the one that is alive.

Ixion is the only party who knows what happened to them, and never mentions it. See
`docs/plans/mission_zero.md`.

### How Good You Are

Landing here is genuinely hard, and the corps say so — which establishes that other
carriers exist without one ever appearing, and validates the player instead of taunting
them.

Three registers, same pattern as everything else:

- **Ixion** says it warmly and specifically. *"You placed it better than the specification
  asked for"* (mission 2).
- **Kessler** says it comparatively. He ranks you against units he has flown.
- **Helion** emits a centile. No praise, just a figure — and one that moves with your
  actual `Progress` points.

Comparative and infrequent, stated as fact rather than compliment.

---

## The Canyon

### Depth is the axis, and arrival order is the cause

The three parties are not three philosophies of mining. They are a budget, a survey, and a
leftover.

| | Arrived | Depth | Why there |
| --- | --- | --- | --- |
| **Ixion** | First | ~0, just under the floor | Dug where they could reach, not where the ore was |
| **Helion** | Mission 5 | −12, lateral | Surveyed properly and stopped where the return stopped |
| **Kessler** | Mission 6 | −58 → −169 → −300 | The optimum was already taken |

**Ixion started digging and was outrun.** They saw what the seam was worth first and were
the least equipped to take it, so they took the affordable seam — shallow, close, and not
the good one. Then Helion arrived with proper survey equipment, found the actual optimum,
and drove laterally into the west wall. Kessler arrived one contract later to find it
claimed, and went down because down was what was left.

So *"Helion drills sideways, we drill down"* is not two styles. It is a consequence: one of
them had a choice. Kessler is not reckless by temperament, he is reckless by **position**,
and he goes deeper every contract because stopping means Helion won.

Ixion's virtue and Ixion's poverty are indistinguishable, and that is deliberate.

The two wall pads sit at **y 73** against a rim of 240 — 30% of the way up, resting on grown
colony. *Crest* is a stale name from a model where the charters had authored crest structures;
they are **decks**, and the briefs already call them that half the time.

### The pillar

Two workings converging on one seam thin the rock between them.

Ixion's abandoned working sits at the junction — they got there first — so their
instruments have been sitting in the middle of the convergence since before either charter
landed. They know what is happening to the pillar. They file it. The arbitration is about
who *owns* the seam, not whether it will hold, so nobody reads it.

Mission 23 is already this, unexplained: *"Both charters have hit the same seam from
opposite sides. We have recommended evacuation. Nobody has acknowledged it."*

### Why Ixion leaves

Two reasons at different scopes, and neither is dramatic:

- **The window** explains the timing. You do not evacuate Mars when you feel like it. Miss
  the transfer and you are here another 759 sols, and they cannot fund that.
- **The pillar** explains the recommendation — why they told everyone *else* to go.

Together they are why the outpost that said *we intend to stay that way* is on a ship.

### The timeline — **Proposed**

The campaign spans roughly **660 sols**: just under one Mars year, comfortably inside a
single Earth–Mars transfer gap of ~759 sols. The charters clear orbit together at mission 4
because that is what a launch window means. Mission 29 lands about a hundred sols before
the next one, which means something is already on its way, and the game never says what.

Roughly 22 sols between your deliveries — and you fly the *notable* twenty-nine out of a
much larger traffic volume, which is what Helion's consignment index is for.

Three registers for time, as usual: Ixion counts sols, Kessler measures in felt time
(*going on a year down this mouth*), Helion carries a machine date stamp nobody reads. None
of the three, and no charter ever, states a run number or a total — Kessler included, now:
an earlier draft had him counting his own contracts, which is a tally only somebody
watching *him* would keep, and no charter is watching a charter.

**Never state the total.** If Ixion's briefs carry a sol count, a player who subtracts
mission 1 from mission 27 gets the campaign length and nobody ever says it out loud.

### Everything arrives from orbit

There is no ground logistics in this game. `ENTRY_VELOCITY` is −55 and every mission starts
830–1050 units above a rim at 240; `Missions.ts` is explicit — *"You do not spawn hovering —
you arrive."* Every delivery is an insertion, flown down from whatever is parked above. The
game never says what that is.

That sets the cadence. The charters clear orbit together on one transfer window (mission 4)
with a year of equipment behind them, and the next ~660 sols are spent bringing it down a
piece at a time — roughly one drop every 22 sols. Which is why there are twenty-nine
missions, and why the colony visibly grows *between* them: a month passes, and other
carriers fly the loads you do not.

**Frames are recovered; carriers are not.** Kessler cares about the airframe from his first
contract — *"the frame costs more than the contract does"* — because it goes back up and
flies again. That keeps the canyon floor clear, which the four dark relays depend on:
twenty-nine spent landers lying about would drown them.

It also leaves Helion's `RETURN EXPECTED: NO` pointing at something that is not the frame.
Read as shipping it is as routine as the payload mass; read as anything else it is the
coldest line in the game. Both stand, which is the point.

### What counts as cargo

Two filters, and a payload passes both or it is not a mission:

1. **It could not be made here.** Off-world manufacture, or a facility Mars does not have.
   Nothing bulk, nothing fabricable from regolith, nothing symbolic.
2. **It has to fly.** The destination has no ground route — up a wall, down a bore, behind a
   roof.

**If it could have been transmitted, it is not cargo.** You are a telemetry link; the one
thing this canyon demonstrably has is bandwidth. Four payloads were once pure paperwork —
filings, an injunction, an evacuation order, a writ — and each was the setting refuting
itself. (A beacon and a case of drill cores are objects; those two only needed names that
stop sounding like filings.)

**Legal standing is held by working the ground, not by marking it.** A claim lapses when work
stops, so Ixion's legal missions are the minimum hardware needed to keep sites in continuous
operation while two funded charters close in. Not a clerk posting letters — an outpost
scrambling to stay operational. The record is still their weapon; it is assays and filings,
*transmitted*, and the cargo is the fieldwork that generates them.

### What the colony is made of

If only the unmakeable is shipped, everything bulk is local. **Mass is regolith; mechanism is
imported.**

- Blocks, decks, walls: sintered regolith and cast basalt, sitting in the canyon's own range
  (`PALETTE.rockLow` `0x51240f` → `rockHigh` `0xd98f57`).
- Metal only where it must be — gantry trusses, winches, pad decks. Little enough that it
  reads as precious.

`CanyonSpec` already calls the corp colour a *neon / signage* colour. So **identity lives
entirely in the light**: at distance the player sees three colours of lamp on identical rock.
The charters are indistinguishable as matter and tell apart only by what they switched on.

Which hands over the shutdown for free — at mission 27 Ixion's lamps go out and their
structures stay exactly where they are. Same rock, no light. No new assets.

The drift to correct is `hull`: Ixion `0x7d8a92` and Kessler `0x6d8299` are cool greys that
read as shipped metal, and only Helion's `0x8a6248` is anywhere near the canyon.

**Spoil is missing.** A 46-metre cavern and a 300-metre shaft displace an enormous volume,
and the canyon currently gets holes with no piles. Tailings are local material, monotonic,
derivable from the dig ledger, and the most honest evidence in the game that the excavation
took something out of the ground.

---

## The Three Parties

### Ixion Outpost — the floor

- **Identity**: the original scientific expedition, first to this canyon, now a mining
  concern that failed at mining.
- **Vehicle**: TD-4 lander.
- **Voice**: a named human, the same one every time, with time to talk because the outpost
  is small and failing. The only client who ever compliments you.
- **Weapon**: the record. *"We filed first. It will not matter, but it will be on the
  record — and the record is the only thing we have that they cannot dig up."*

#### The turn — **Proposed**

Ixion does not start as a villain and does not end as one either. They were in the race,
they lost it, and they stayed to watch the winners.

**Where it happens: the eleven-mission gap.** They vanish as a client from mission 11 to 22,
which was a structural flaw before it was a mechanism. They go quiet, and when they come
back something has changed that nobody names. The cut-ins at 14 and 18 are the only
glimpses — unremarkable at the time, wrong in hindsight.

**What they do is an omission.** They never lie and never sabotage anything. They file every
warning to be *sufficient* rather than *effective*. A warning that stops the digging saves
the charters; a warning correctly lodged and comprehensively ignored destroys them and
leaves a record showing Ixion was right, with Ixion's claim the only one standing.

The arbitration is still running because of how they filed. **The Final Charge exists
because the arbitration is still running.** Their fingerprint is on the timing, not the
event.

**Their motive stays small.** Not saving humanity — this game has never zoomed out past one
canyon. The local version: *this place makes everyone who comes here into the same thing,
and it has already done it to us.* They came to do science and Mars turned them into a
litigant.

**The generosity is real.** A villain can be sincere — Moriarty's regard for Holmes is the
most human thing about him. Ixion means every word of mission 2, and it never costs them
anything, and it never once stops you flying.

> **The rule: no brief may confirm or refute the intent.** Written as true underneath, so
> both readings hold on the surface — the same discipline as the seismic data reading as
> geology or as the hole. One warm sentence added later closes this by accident.

### Helion Extraction — the optimum

- **Identity**: a commercial extraction charter that surveyed properly and stopped where
  the return stopped. It has no ambition because ambition is a human error and there is
  nobody there to make it.
- **Vehicle**: HD-7 Sidewinder — attitude locked, translation decoupled. A wall cavern is
  entered level and sideways, with no attitude to recover.
- **Voice**: nobody. Auto-generated contract text with the fields filled in — not cold out
  of cruelty, cold because no human was ever involved. All ten briefs are one form under
  one contract number, 4471-C, amended.

Three rules keep it a machine rather than a terse employee, and `Missions.test.ts` holds
all three:

- **No second person, and no first.** The other two charters address you — that is what
  their names for you are *for*. Helion has no *you* and no *we* in nine contracts. One of
  either puts somebody on the other end of the link.
- **One weight throughout.** No emphasis anywhere in the body, including on `RETURN
  EXPECTED: NO`, which is on the first contract and every one after. Bolding it would mean
  somebody had decided it mattered.
- **The form drifts, because nobody maintains it.** Revisions climb 1 → 11 and skip 10,
  which was generated and never sent. `ATTRITION: WITHIN TOLERANCE` arrives at 25 and never
  leaves. The drift is structural too: a contract is two cards — manifest, then `CONDITIONS
  OF CARRIAGE` — until the arbitration annex exists at 21, from which point it is three. The
  annex is always **last**, so the final three Helion runs begin descent from a page of
  boilerplate with nothing about flying on it.

Card breaks are authoring, not formatting. No Helion card exceeds 240 visible characters.
The form was written as a single card first and read as a wall — seven fields and a
three-sentence route note arriving together, which is the exact shape the sequence exists
to break up.

Helion has no arc because Helion has no character; what changes is the paperwork. A wry,
clipped middle manager was the original register and was cut — it made Helion a third
person with opinions, which left the canyon with three voices and no silence in it.

#### The classifier — **Proposed**

The annex has spent eight contracts denying you a category — *the carrier is not a party
and has no standing to be heard*. The payoff is the form running out of categories, at
mission 28, branching on your accumulated points:

- high — `NO HUMAN FACTOR DETECTED. CLASSIFICATION: PENDING.`
- low — `ATTRITION ABOVE FORECAST. CLASSIFICATION: EXPENDABLE. CONTRACT NOT RENEWED.`

Both are recognition. One cannot file you; the other files you as a write-off. It never says
*you*, never acknowledges, and it is the only client that ever gets the answer right.

### Kessler Deep — everything below

- **Identity**: a heavy industrial charter that arrived one contract too late and dug down
  because down was what was left.
- **Vehicle**: KD-9 Shaft Hauler — locked attitude, splayed twin engines, built to translate
  laterally inside a 24-unit bore.
- **Voice**: a shift foreman who talks to equipment all day and does not distinguish. Opens
  by worrying about the airframe rather than about you. Flies you ten missions, more
  than anyone.

#### He deteriorates, and it is already half-written

His shipped lines are an arc nobody planted:

- **15** (58m): *"I want you learning the hole while it is still forgiving."* — personification,
  on his first descent brief.
- **24** (303m): *"Trust the altimeter, not the optical feed. Down there the two will
  disagree."*
- **26**: *"I would not hand this run to anyone else."* — trust. Also: there is nobody else left.
- **29**: *"...say again."*

He talks to equipment. By 26 the hole is the only thing left to talk to. That is not a
departure from his character, it is his character followed to the end.

**The cause never leaves the rock.** Ixion's instruments record seismic events — four
hundred last week, forty this time last year — and that count climbing *is* the pillar
working. Ixion reads it as geology. Kessler, alone at 300 metres, reads it as the hole. The
game never adjudicates.

**He stays functional.** Never misses a delivery, never raves, never says anything a foreman
could not say on an open channel. The player should finish unsure whether anything was wrong
with him at all.

**Before mission 29 he notices things about the job. Only at 29 does he notice you.**

---

## The Campaign Arc

Every delivered payload builds structures that persist, so your completed deliveries
construct the hazards of later runs. But only nine of twenty-nine missions author
anything: **you build the addresses — pads, the shaft, the cavern, the ledge — and the
canyon builds the obstacles**, out of a growth budget that scales with how well you fly.

1. **The Descent (1–4)** — site the radar, early outpost cargo, the charters clear orbit.
2. **The Corporations (5–8)** — Helion takes the west wall and the optimum; Kessler takes
   the east and what is under it.
3. **The Corridor (9–13)** — both charters build toward the centre line. The airspace closes.
4. **The Digging (14–20)** — Kessler opens the floor, Helion carves and roofs a room and
   abandons the surface. Ixion is off the air as a client and cuts in twice as a voice.
5. **The Seam (21–26)** — the workings converge, the arbitration runs, the abyss deepens.
6. **The Gauntlet (27–29)** — Ixion shuts down at 27 and leaves the radar powered. Two runs
   later, the Final Charge.

---

## Never Answered

Protected by every rule above, and the reason most of them exist:

- **What you are.** Not hinted, not implied, not resolved.
- **What happened to the four before you.** That two of them failed is available. How is not.
- **Whether Ixion meant it.** Both readings stand; nothing adjudicates.
- **Whether there is a sixth.** Helion's file stays open. The next transfer window is a
  hundred sols out. The game ends.
