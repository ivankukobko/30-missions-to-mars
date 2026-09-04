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
done anything yet, and mission 2 still does not use the word: it is the run that *sends*
you to plant the radar. From mission 3, once the mast is standing, Ixion calls you *the
navigator*, after the navigation you built them. They explain it once and never again —
and the explanation is what the name is worth: *"Nobody had the standing to make it
official, and it stuck."*

**Kessler's is a category, not a nickname.** *Tin can* is what he calls any remote unit on
a telemetry link; he used it before you and he will use it after. It appears in four of his
ten runs and is absent from every genuinely lethal one — 20, 24 and 26, where he is
concentrating on keeping the airframe intact. The omission does more work than the word.

A rotating set of insults was considered and rejected: a nickname that never repeats is a
thesaurus, not a relationship. But the repetition is not a relationship either — it is
ten runs of a category noun, which is what gives the single deviation its weight.

**There is exactly one deviation, and it is motivated.** At mission 29 Kessler calls you
*navigator*, the only proper noun he ever uses. On the card before it he breaks the
reticence he kept at mission 26 and says plainly what the quiet on the outpost channel
meant — that the crew went silent one voice at a time and *nobody pulls out of here*.
Speaking of them as people, once, is what costs him the category noun; the name lands on
that card, mid-break, not as a sign-off. This is a deliberate trade against an earlier cut
where the name arrived uncaused: the price of the payoff is the *did they leave or did they
die* ambiguity. The parked voice tests in `Missions.test.ts` pin the shape, to be
un-skipped once the text settles.

### The Carrier

Mission 29 is the only brief in the game that somebody interrupts.

Kessler is mid-sentence — telling the carrier the outpost did not pull out, that he heard
their channel go quiet one voice at a time until nobody was left keying it — when a card
arrives headed **IXION OUTPOST**, carrying one sentence and nothing else: *"We are the only
thing at the bottom of this canyon, and we intend to stay that way."* It is the second
sentence of mission 1, the same string, and the first thing the player ever read. Kessler
does not react to it at all. He carries the sentence he was cut off on straight across the
interruption — *"—of hole. Take it down"* — and finishes the job.

Two things hold it up:

- **Verbatim, or it is a reference rather than a recurrence.** A paraphrase reads as the
  writer pointing at mission 1. The identical string reads as the channel doing something.
- **He never engages with it.** No *say again*, no speculation, then or ever. Whether the
  mast is looping a stored ident or something is still down there is never raised. Ixion
  left the radar powered at mission 27 and said so; that is the whole of the mechanism the
  game offers.

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

- **Ixion** says it warmly and specifically. *"You set the mast down tighter than the spec
  asked"* (mission 3).
- **Kessler** says it comparatively. He ranks you against units he has flown.
- **Helion** emits a centile. No praise, just a figure — the run's own points, interpolated
  through `{CENTILE}` so the answer moves continuously rather than landing in one of three
  authored buckets — and a disposition line that leads nowhere: `NO ACTION ARISING`. It is
  the only client with no `strong` or `weak` anywhere, because a form has nothing to choose.
  The exception is mission 28, where the form stops reporting and *classifies* — see
  *The classifier*, which is shipped now and branches on the same figure.

Comparative and infrequent, stated as fact rather than compliment.

**It is said on the score card now, not in the next brief.** `Mission.debrief`, on all
twenty-eight missions that have one. See *The two channels that do not stop the world*.

### The two channels that do not stop the world

Until this, everything with a voice in it stopped the game to speak. That was right for a
brief and it left the campaign with one narrative surface and no way to be *inhabited*.

**The debrief was always here, delivered a mission late.** The opening card of mission 3 was
mission 2's debrief; mission 2's opening card was the prologue's — which is why **the
campaign's first voice is now on mission 1's score card**, arriving because the relay is
standing, instead of at the top of the next brief where nothing caused it. The convention only works
while Ixion flies the first five contracts in a row: ten of twenty-eight handoffs are
same-corp, nine hand to a form with no second person to acknowledge anybody with, and no
party has standing to grade a run it did not commission. So for two thirds of the campaign
the run you just flew was answered by nobody, and the late missions quietly stopped trying.

It belongs on the score card, which is also the first position in the game that can read the
rank — the old form could not, and *"tighter than the spec asked"* prints whatever the
player actually did. `Debrief.strong` and `.weak` cover S/A and C, both optional, and a
mission with neither says one thing however you flew. That is the honest default: only two
of the three clients are watching that closely.

**The radio is the other half.** `Mission.radio` puts a transmission on the glass mid-descent
— bottom-left, no dismissal, nothing the player needs. It carries **no instruction**, which
is what lets it fire on **every attempt**: a canyon that falls silent on your fourth try was
performing for you. Which fixes the register — these are *observations, not events*. "Radar
is up on your feed now" is an event and a lie by attempt seven.

The budget is measured, not guessed. The reference pilot flies the campaign in 28 seconds
median (18.0–33.3 across the twenty it can fly); the callsign owns the first 10.5 sounding
the mission number, and the flare owns the last ten. Two calls — fifty-six across the
campaign — and `Missions.test.ts` holds the ceiling.

The anchors are `620` and `300` (`240` below the floor), measured rather than picked: that
same pilot crosses 620 at t≈11 and 300 at t≈18 on every mission in the campaign. But the
triggers only say *earliest*. **`RADIO_MIN_GAP` says readable**, and it is the rule the
authored anchors could not express — found by flying, not by reading. A pilot who dives
crosses both thresholds inside four seconds, and the second transmission used to replace the
first mid-sentence, costing the player both. A call that comes due inside the gap waits;
`nextRadioCall` is the whole selection rather than a predicate for exactly that reason, since
a per-call test has nothing to say about two calls.

**Two silences, for opposite reasons.** Mission 1 has no calls — there is no link to carry
one, which is the same reason its `messages` are empty. Mission 29 has calls and *no
debrief*, because what follows that landing is the epilogue, and a client answering the run
would be the last human voice in the campaign arriving after the one it was built to end on.

**Helion transmits too, and announces nothing.** The rule was always no second person and no
first — never silence. An unannounced field set assumes whatever receives it parses field
sets, so the form addresses the carrier by *format* while never owning a `you`, and the
livery is the only routing it carries. A **datagram, not a handshake**: nothing acknowledged,
nothing negotiated, no notice taken of whether anything read it. The moment Helion's protocol
responds to the carrier, Helion has observed it and the canyon has a third party with
opinions in it — which is what got the wry-middle-manager register cut.

It is the only client that gets what the carrier is right, and it gets there by never asking.
Eleven contracts of that is also what the classifier at 28 is finally *stating* — see
*The classifier*, which until now arrived with nothing under it.

---

## The Canyon

### Where this actually is

**A fissure in the floor of Coprates Chasma, not the chasma itself.**

The numbers were always saying so and nobody had read them back. This canyon is 240 units
floor to rim and about 280 rim to rim — a ratio of roughly 1:1. Coprates is ~60 km wide and
~8 km deep, which is 1:7.5. At the real trough's proportions you could fly the whole campaign
without seeing a wall, and two of the game's own rules would collapse: *it has to fly, the
destination has no ground route* (in a 60 km basin you would drive) and the entire arc of the
corridor closing because of what you delivered (you cannot close 60 km with thirty pads).

`CanyonSpec` had already committed to it in one line — the backdrop at `z = -1600` is *mesas
seen through the slot, above the rim*, and mesas standing above your rim means the rim opens
onto a floor with massifs on it rather than onto open plain.

So `MASSIF` builds the rest of it: west of the rim the ground sets back, then climbs past
1250 — the wall of Valles Marineris, seen across the chasma floor. The depth stack that
gives is the campaign's own subject, which is going down:

| | |
| --- | --- |
| Plateau surface | 0 |
| Coprates floor — **this canyon's `RIM_Y`** | −8 km |
| The fissure floor — `FLOOR_Y` | −240 more |
| Kessler's shaft at −303, `failDepth` −320 | −300 more |

Mission 1's *"We are the only thing at the bottom of this canyon"* becomes the bottom of the
bottom, and the last delivery of the campaign sits about 8.6 km below the Martian datum.

**Nothing inside the rim moved.** The floor, both walls, the entrance and every fuel budget
are the numbers they were; the massif lives past the rim on ground no mission can reach, and
`CanyonGenerator.test.ts` asserts across seeds that nothing stands tall anywhere the vehicle
can legally be. It is visible only from above the rim — the entry and the first seconds of
the descent — because from inside a 240-deep slot the west lip occludes everything beyond it.
That is physically right and it is the honest limit of what it buys.

It also offers a third reading of the ending, and the game still adjudicates nothing.
Fissures in these floors deepen by collapsing into voids — that is how Coprates Catena, the
pit chain on the plateau, was made. So Kessler *"breaking into the chasm"* at mission 24 is
him joining the process that built the place he is standing in, and the epilogue's collapse
has a third candidate alongside the pillar and the Final Charge: **this is what these
features do.** It is the only one of the three with nobody's hand on it.

### Depth is the axis, and arrival order is the cause

The three parties are not three philosophies of mining. They are a budget, a survey, and a
leftover.

| | Arrived | Depth | Why there |
| --- | --- | --- | --- |
| **Ixion** | First | ~0, just under the floor | Dug where they could reach, not where the ore was |
| **Helion** | Mission 5 | −12, along the gallery | Took the west end of Ixion's working by *prior working* |
| **Kessler** | Mission 6 | −58 → −169 → −300 | The optimum was already taken |

There is **one hole** — Ixion's crooked mouth, anchored to the east wall, opening onto the
floor. Off it, two directions: a horizontal drift running west along the gallery (Helion)
and a single column driven straight down (Kessler). `Missions.test.ts` asserts the campaign
digs exactly one excavation.

**Ixion started digging and was outrun.** They saw what the seam was worth first and were
the least equipped to take it, so they took the affordable seam — shallow, close, and not
the good one. Then Helion arrived with proper survey equipment, found the actual optimum,
and took the **west end of the gallery Ixion had already cut**, claiming it by *prior
working* rather than opening a hole of its own. Kessler arrived one contract later, found
the gallery claimed and the shallow seam worked out, and drove the same mouth **downward**
because down was what was left.

So *"Helion works it along, we work it down"* is not two styles. It is a consequence: one of
them had a choice. Kessler is not reckless by temperament, he is reckless by **position**,
and he goes deeper every contract because stopping means Helion won.

Ixion's virtue and Ixion's poverty are indistinguishable, and that is deliberate.

The two wall pads sit at **y 73** against a rim of 240 — 30% of the way up, resting on grown
colony. *Crest* is a stale name from a model where the charters had authored crest structures;
they are **decks**, and the briefs already call them that half the time.

### The pillar

There is no pillar in the geometry — the excavation is one connected complex and nothing is
rendered thinning. The pillar is **Ixion's reading**: their instruments have logged a rising
seismic count since before either charter landed (*"four hundred last week, forty this time
last year"*), and Ixion calls that the rock between the two workings giving way. Kessler,
alone at the bottom, hears the same tremors and calls it the hole. The game never
adjudicates, and no brief states the pillar as fact — mission 23 is Ixion's claim, not the
campaign's: *"the pillar between them thins every shift. Our instruments have watched it
since before either of them landed."*

The arbitration is about who *owns* the seam, not whether it will hold, so the filing is
never acted on. Whether the epilogue's collapse is the pillar failing or the Final Charge
firing is the same undecided question — dug instead of filed.

### How Ixion ends

Ixion does not leave. *"Shutting down"* (mission 27) and *"went dark"* (mission 29) are
literal, and Kessler confirms it at 29: *"the outpost did not pull out. Nobody pulls out of
here."* No brief shows a ship, a window rendezvous, or a departure — the campaign withholds
the mechanism the same way it withholds what a carrier is.

The chain is in the briefs:

- **Funding.** A survey expedition on a modest grant — eleven people and a barely-working
  rig — for most of eleven years. It ended when the charters landed: lapsed on term, or
  pulled once the canyon became a corporate fight; mission 22 leaves it ambiguous.
- **The drain.** No income, and a claim that only holds while it is worked, so everything
  after went on litigation and on the minimum fieldwork to keep the sites live. *"It bought
  us nine days"* (mission 11).
- **The mechanism.** The water reclaimer from mission 4 fails in mission 22 with nothing to
  replace it. For eleven people that is a slow end, not an inconvenience.
- **The count.** Mission 27: *"eleven of us in the early days; fewer now."* The living
  number only ever decreases — the permanence rule applied to people.

The **window** still explains the timing pressure on the evacuation Ixion recommends for
everyone *else* (mission 23); it is no longer why Ixion itself goes. The outpost that said
*we intend to stay that way* stayed, permanently — and at mission 29 the dead channel says
the line again, and it is true.

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

**Nothing that comes down leaves — the frame least of all.** A stated ground rule (mission
8: *"Nothing that comes down this canyon goes back up. Cargo, fuel, the frames themselves —
it all stays"*). No mission has a return leg and no fuel budget has an ascent stage; the
numbers are sized to brake entry velocity and land, full stop. The frame is stripped to
the last screw and built into the outpost, tanks siphoned (mission 4); Kessler calls it
*"scrap"* the moment it is on the deck (mission 7). The four dark relays on the floor are
not the exception — they are the frames too far out to be worth stripping.

The rule reaches the carrier too, obliquely and without ever saying what a carrier *is*:
Kessler, mission 26 — *"everything that came down this canyon and never flew out is in [the
walls] now"*; Helion, mission 28 — `CARRIER DISPOSITION: DEVOLVES TO SITE`. So Helion's
`RETURN EXPECTED: NO`, once the frame is a known write-off, reads as pointing at the only
thing left. Routine-shipping and coldest-line-in-the-game both still stand.

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

### Three rules the canyon runs on

Stated plainly, once each, by Ixion — the voice that explains the place — then relied on
everywhere:

- **Ownership is working, not marking** (mission 5): *"You hold ore by digging it, not by
  marking it. Stop working a claim and it lapses."* Why Helion can take Ixion's gallery by
  *prior working*, why Ixion's fieldwork missions exist at all, and why the filings never
  save them — a public record is leverage only because it cannot be kept proprietary.
- **Permanence** (mission 8): *"Nothing that comes down this canyon goes back up."* Cargo,
  fuel, frames — and, obliquely, carriers and people. Everything sent here becomes the
  canyon. See *Everything arrives from orbit*.
- **Isolation** (mission 5): the three parties never address each other. They monitor a
  shared open channel and are bound by the same legal process, but there is no private line
  between any two — charter rules forbid sharing survey, method or position. The carrier is
  the only entity all three transmit *to*. Which is why Ixion's evacuation recommendation
  goes unanswered (mission 23): nobody is required to answer the outpost, and there may be
  nobody at Helion to.

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

This *would* hand over the shutdown for free — Ixion's lamps going out at mission 27 while
the structures stay put, same rock, no light, no new assets. **Not built:** `Colony.darken`
was removed and nothing dims a colony per-mission; the only darkening in the game is the
campaign-wide sky decline and the epilogue collapse. The briefs no longer lean on it
(mission 18 says *"off the surface"*, not *"lights off"*). Worth doing — see
`docs/plans/campaign_narrative_enhancements.md`.

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

#### The jokes, and where they stop

There are five, they are all dry, and they all live in the **first half**: 3, 4, 7, 10, 13.
That is the arc rather than an accident of drafting — early on this is a canyon with people
in it who still make jokes, and after the shaft opens at 15 nobody makes another one. Kessler
is funny by accident and only ever about the job; Ixion is funny on purpose and never quite
lands it; Helion cannot be funny at all and is twice the straight man.

- **3, Ixion** — *Corporates Chasm*, below.
- **4, Ixion** — *"Third week here, somebody swore there was a face in the east wall. We
  photographed it for a month. It was a rock."* The same shape as the reclaimer line one card
  away: a story for the setup, an institutional fact for the punchline. It never says Viking
  or Cydonia, so the player who knows the Face on Mars gets a second layer and nobody else
  loses anything.
- **7, Kessler** — *"This used to be done with rovers. Months to cross what you do in a
  minute, and nothing on the far end to talk to."* A back-in-my-day on his first contract,
  and the campaign's only acknowledgement that ground logistics ever existed here. The last
  clause is him assuming what is on the link, which is what *tin can* already does.
- **10, Kessler** — *"We could settle this with rock, paper, scissors. They have the paper, I
  have the rock, and nobody has scissors."* Told while the injunction has his crew stood down,
  which is the only state in which he would bother. Helion **is** the paper — nine auto-filed
  contracts and no person — and Kessler is the rock. The missing scissors is the resolution
  that never arrives.
- **13, Kessler** — *"Crossed the whole of empty space to get here and the job is digging
  dirt. Again. Nobody mentions that part."* On the last delivery that ever lands on a surface,
  which is the moment the complaint becomes literally true.

No mission carries two. One dry aside every few runs is texture; two on one run would make
the speaker the comic relief, which neither of them survives being.

#### Corporates Chasm

The campaign's one joke, and it is a groaner. Mission 3, immediately after Helion's
auto-filed notice of interest — the first time a corporation ever speaks on the outpost's
channel, and the only time anybody in the game says the canyon's real name:

> **HELION EXTRACTION** — *ORE ASSAY READ FROM AN OPEN RELAY, COPRATES CHASMA. NO CLAIM ON
> RECORD. SURVEY DISPATCHED.*
>
> **IXION OUTPOST** — *Coprates Chasma. Corporates Chasm, more like. Nobody here laughed
> either.*

**The machine sets it up and the human takes it**, which is the only arrangement that works.
Helion cannot make the joke: a pun nobody in the fiction perceives is the game elbowing the
player over its cast's heads, and a form that misfiles a proper noun is not a colder machine
but a less reliable one — accuracy is what Helion has instead of a voice. Kessler is funny by
accident and never about anything but the job. Ixion is the only party that can be bitter and
fond in the same breath about a place it has lived in for eleven years.

It is also a **prediction**, made the moment the survey is dispatched and proved right by the
twenty-six missions that follow. And `either` is doing the quiet half: the joke was told to a
telemetry link, and nothing came back.

`Missions.test.ts` holds the order, because the joke is a *reply* — move either card and it
becomes the outpost punning out of nowhere on a name nobody has mentioned. It also holds the
absence of *navigator*: the name is coined on the next card and cannot be used before it.

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
- **Vehicle**: HD-7 Sidewinder — attitude locked, translation decoupled. The gallery is
  entered level and sideways along the west wall, with no attitude to recover.
- **Voice**: nobody. Auto-generated contract text with the fields filled in — not cold out
  of cruelty, cold because no human was ever involved. All ten briefs are one form under
  one contract number, 4471-C, amended.

Both of the other parties say the quiet part out loud, each in register: Kessler — *"if
Helion's got anyone to do the reading"* (mission 13); Ixion — *"we have never been sure
Helion has a crew at all… not one word from a person over there"* (mission 23). Neither can
ask (the parties don't address each other) and the form never answers a question, so
*whether Helion is manned* joins the Never Answered pile. The epilogue only tips it: Helion
files the last revision after everyone else is gone, because Helion is the only party with
nobody to evacuate.

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
  leaves.

  **The drift is in the process, never in a fact.** Helion spells the canyon `COPRATES
  CHASMA` at mission 3 and the form never mislays it. A version of this document had the
  name corrupting to `CORPORATES CHASM` across the arbitration — the machine filing the
  truth by accident, nobody left to correct it — and it is wrong twice over: a pun nobody in
  the fiction perceives is the game elbowing the player over its own cast's heads, and a
  form that cannot spell the place is not a colder machine but a less reliable one. Accuracy
  is what Helion has instead of a voice. See *Corporates Chasm* under Ixion. The drift is structural too: a contract is two cards — manifest, then `CONDITIONS
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

#### The classifier

The annex has spent eight contracts denying you a category — *the carrier is not a party
and has no standing to be heard*. The payoff is the form running out of categories, on
mission 28's debrief, branching on how that run scored:

- high — `NO HUMAN FACTOR DETECTED. CLASSIFICATION: PENDING`
- default — `CLASSIFICATION: PENDING`
- low — `ATTRITION ABOVE FORECAST. CLASSIFICATION: EXPENDABLE. CONTRACT NOT RENEWED`

Both ends are recognition. One cannot file you; the other files you as a write-off. It never
says *you*, never acknowledges, and it is the only client that ever gets the answer right.

**It is the one Helion debrief that branches, and that is not a contradiction.** Everywhere
else the form reports a figure and has nothing to choose, which is why no other Helion
debrief carries a variant. Here it is not judging a landing — it is a document hitting
different branches of its own logic, which is what a form does. The distinction is the whole
reason the exception is legible rather than a lapse.

**What it now has under it.** Eleven contracts of in-flight `radio` arriving as unannounced
field sets, none of which ever asked whether anything could read them. The classification is
the form finally *stating* what its own transmission format assumed all campaign — see
*The two channels that do not stop the world*. Before that channel existed this card was a
clever line with nothing behind it.

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
- **26**: *"I would not hand this run to anyone else"* — trust; also, there is nobody else
  left. On the same brief, flat: *"Outpost's channel has been quiet a long while… not
  something I have the time to chase."* He clocks the last living thing in the canyon fading
  and files it like weather.
- **29**: he breaks. *"The outpost did not pull out, navigator. Nobody pulls out of here. I
  heard their channel go quiet — one at a time."* The one time he speaks of people as
  people, and it is what the run ends on — his and the canyon's.

He talks to equipment. By 26 the hole is the only thing left to talk to. That is not a
departure from his character, it is his character followed to the end.

**The cause never leaves the rock.** Ixion's instruments record seismic events — four
hundred last week, forty this time last year — and that count climbing *is* the pillar
working. Ixion reads it as geology. Kessler, alone at 300 metres, reads it as the hole. The
game never adjudicates.

**He stays functional.** Never misses a delivery, never raves, never says anything a foreman
could not say on an open channel — the flatness is almost why he lasts, where a more feeling
person would not. The player should finish unsure whether anything was wrong with him at all.

**Before mission 29 he notices things about the job. Only at 29 does he notice you.** The
outpost's silence at 26 is still the canyon, not the carrier; the name at 29 is the carrier.

**The Final Charge reads as possible suicide, and stays unconfirmed.** He understates a
1.8-tonne charge as *"six hundred kilos… you have flown this one before"* to the only
witness, and nothing reconciles the manifest — who oversized it (Ixion, Kessler, or
Helion's `AUTO`) is left open. He is the last one, into a seam beside a wall he has listened
to for a year. Against it: he has a crew (*"pulling my crew up… give me twenty minutes"*,
epilogue), so it is not a clean self-ending — a man who set a charge bigger than the job,
meant to lift his people first, and ran out of time, with the hand on the timing never
shown. Same discipline as pillar-versus-charge: hold intent-versus-accident open.

---

## The Campaign Arc

Every delivered payload builds structures that persist, so your completed deliveries
construct the hazards of later runs. But only nine of twenty-nine missions author
anything: **you build the addresses — pads, the shaft, the cavern, the ledge — and the
canyon builds the obstacles**, out of a growth budget that scales with how well you fly.

1. **The Descent (1–4)** — site the radar, early outpost cargo, the charters clear orbit.
2. **The Corporations (5–8)** — Helion takes the west end of Ixion's gallery by *prior
   working*; Kessler takes the east and drives it down.
3. **The Corridor (9–13)** — both charters build toward the centre line. The airspace closes.
4. **The Digging (14–20)** — Kessler drives Ixion's working downward into a proper shaft,
   Helion roofs the gallery and abandons the surface. Ixion is off the air as a client and
   cuts in twice as a voice.
5. **The Seam (21–26)** — the workings press in, the arbitration runs, the abyss deepens.
6. **The Gauntlet (27–29)** — Ixion goes dark at 27 (the crew does not leave — mission 29
   confirms it) and leaves the radar powered. Two runs later, the Final Charge, then the
   epilogue collapse.

---

## Never Answered

Protected by every rule above, and the reason most of them exist:

- **What you are.** Not hinted, not implied, not resolved — *devolves to site* and *in the
  walls* say where you end up, never what ended up there.
- **What happened to the four before you.** That two of them failed is available. How is not.
- **Whether Ixion meant it.** Both readings stand; nothing adjudicates.
- **Whether anyone got out of the outpost.** The briefs lean hard toward no, and Kessler
  says there was none — but no body, no cause, no scene.
- **Whether Helion is manned.** Kessler and Ixion both doubt it aloud; the form never
  answers; the epilogue only implies.
- **What ended it** — the failing pillar, the Final Charge, or both, and whose hand set the
  charge's size and timing.
- **Whether there is a sixth.** Helion's file stays open. The next transfer window is a
  hundred sols out. The game ends.
