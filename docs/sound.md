# Sound

> Spoilers. This is a design record, and it discusses where the campaign ends up.

The score is a drawbar organ over a five-voice pad, one chord progression per charter, a wobble bass, and a drum kit playing the mission's own callsign — the mission number in binary, MSB first.

## The vocabulary

Chords are **scale degrees over a tonic**, in `DEGREES` — the four the campaign uses plus
enough to write a progression without editing the table first. A key is a pitch class and
an octave through `keyHz`, not a frequency.

Both were closed before. Four triads were bare constants named by an *identity* map, which
works exactly as long as every chord in the game is one of those four objects: a
progression built in `synth.html` is a new array, so the lookup returned nothing and the
editor could not name what it had just made. Naming by value costs a reverse scan nobody
runs in a hot path and stops the vocabulary being finite.

Offsets are absolute from the tonic rather than inversions, because the voicing that
consumes them — `[a−12, a, b, c, a+12]` — doubles the **first** tone an octave down and up.
So `IV` is `[5, 9, 12]` and not `[0, 5, 9]`: the fourth is the chord's own root and has to
be the note the sub and the air are an octave from. A test asserts every degree is spelled
that way, because a chord that broke it would not be wrong so much as quietly voiced around
the wrong note.

The roots were written as bare frequencies with the note name in a trailing comment — the
only record that they were named notes at all. They are pinned against `keyHz` now, along
with the interval the set turns on: **Ixion's A is exactly a fifth above Kessler's D**, so
Ixion's tonic is Kessler's dominant, and Kessler's progression opens on it.

## The number, twice

**The kit reads it.** The bass drum is a clock on every count; a one adds a tom on the &.
See [below](#the-callsign-is-a-kit).

**The wobble feels it**, and keeps its rests, because run length is what drives the
ratchet. Two readings of one word: one you count, one you feel.

**There used to be a third.** A pitched five-note figure sounded the word at the top of
every chord, in the octave above the pad. It was the original reading and the kit is
directly descended from it — the high/low contract, the MSB ordering and the "sound every
bit, never a rest" rule all came from there. It was removed once the drums existed:
the same number arriving three ways inside seven seconds is not emphasis, it is a score
talking over itself, and the melody was the reading that had to compete hardest to be heard
because it sat where the air voice already lives. `IDENT_HIGH` and `IDENT_LOW` are gone with
it; `identBit` remains, since it is what the kit reads.

The epilogue's beacon is still pitched, and is meant to be — it is a different machine, off
key by twenty-two cents, and the only voice in the game that sounds a callsign as a note.

## The grid

**101 BPM, four counts to a bar, two bars to a chord.** One tempo, and every duration in
the score derived from it — bar, chord, glide, and the length of a beacon bit.

There was no tempo before, only a 7-second chord step and a bar that fell out of dividing
it by five. The score therefore *had* a BPM — 171.43 — that nothing named and nothing could
be tuned against, while a wobble is a rhythmic instrument and a callsign is a transmission
on a schedule. Both were being placed in seconds, by hand, against a number nobody had
written down.

**The cycle is no longer one descent long, and that is the trade the new themes bought.**
Two bars to a chord puts the progression at eight bars, or **19.0 seconds**, against the
reference pilot's 28.0-second median descent — so a typical run now hears the harmony come
round about one and a half times rather than exactly once.

That property was load-bearing for two tunings in a row, and giving it up was not an
oversight. It existed because the progressions were *weather*: each sat on the tonic and
made a single move, so a run either caught that move or missed it, and the only way to
guarantee it landed was to make the cycle a descent long. The charters now play actual
four-chord progressions that go somewhere. A figure with four distinct steps wants to come
round often enough to be *heard as a figure*, and a 28-second cycle would give a player one
pass at it per flight.

What replaced the guarantee is a weaker but real one: at 19.0 seconds no descent is too
short to complete a cycle, so every run hears the whole progression at least once. The GRID
panel in `synth.html` still colours the figure when a tuning overruns 28.0, because a cycle
*longer* than a run is still the failure it always was.

`GLIDE` is a fifteenth of the step rather than a number, because three time constants is
then a fifth of the step spent arriving — the proportion that was tuned at 10.5 seconds
(0.7) and again at 7 (0.47). Deriving it means a tempo change cannot leave a chord spending
most of its life on the way somewhere.

`synth.html` moves all three of BPM, bars per chord and callsign rate under a running
score, prints the cycle against the 28.0 median, and exports the literal to paste back into
`TEMPO`. That is how these were chosen; see [Running](running.md#the-grid).

## The three charters

Composed on `synth.html` and pasted back. They arrived as three separate patches, and what
follows fell out of them rather than being designed as a set.

| Track | Key | Progression | Chords | Reaches its tonic |
| --- | --- | --- | --- | --- |
| Ixion | A | `vi ii iii V` | F♯m Bm C♯m E | never |
| Helion | C | `iii iv ii vi` | Em Fm Dm Am | never |
| Kessler | D | `V ii IV I` | A Em G D | **every cycle, on the last step** |
| `shutdown` | A | `vi ii iii V` | *(Ixion's, with no pulse)* | never |

**Ixion never arrives.** It closes on the dominant — the one chord whose entire job is to
demand the tonic — and then turns back to F♯m instead. A is the key and A never comes. For
the charter that has been at the bottom of this canyon for eleven years and goes dark two
missions from the end, there is nothing better available.

**Helion never arrives and is not looking.** Four minor triads, and every transition is
*exact parallel motion*: `+1 +1 +1`, then `−3 −3 −3`, `+7 +7 +7`, `−5 −5 −5`. The whole
progression is one shape translated four times, with no independent voice leading anywhere
in it. That is measurably why it sounds mechanical — planing is a machine sliding a fixed
object around rather than four voices each deciding where to go. For the charter that does
category work correctly and expands sideways forever, a figure that only ever *translates*
is the characterisation. A test asserts the parallelism, because it is the claim.

**Kessler arrives.** Every cycle, on the beat, home — and it is the only one that does.

The keys say the same thing again. **A is a fifth above D**, so Ixion's tonic is Kessler's
dominant, and Kessler's progression *opens on A major*. Kessler begins where Ixion lives and
resolves somewhere Ixion never gets to. For a campaign where the outpost goes dark and the
deep mine keeps running, that is the whole relationship in four chords.

It also sharpens the mission that was already the odd one out. Mission 29 is a Kessler
contract scored in **Ixion's** key, via `musicTrack` — so the campaign's last delivery sits
on the chord Kessler starts from, playing the progression that never comes home.

### Which theme plays

Which theme plays comes from the mission's client by default, and a mission can override it
with `musicTrack` — resolved by `musicTrackFor`, the same shape as `airframeFor`. Exactly
one mission uses it, and it is 29.

## The two flights with no client

The campaign's ends are not scored like its middle, and neither of them is a charter.

**The prologue is silent, and always was.** `Game.loadMission` runs `stopAmbient` for
mission 1: engine and wind, nothing else. It is the one mission with no charter to be
scored for, so there is no theme that would be honest to play — every other track belongs to
somebody who cannot reach you yet, and the score arriving with the first voice at mission 2
is worth more than a theme here.

**The epilogue now has a track of its own.** Until it did, it simply inherited whatever
mission 29 left running — a full charter theme, wobble bass and drum kit included, playing
under a vehicle with dead controls falling past a colony with its lights off. The kit is a
groove and the fall is not.

`shutdown` keeps the pad and drops **everything with a pulse**: no kit, no wobble bass, and
the organ down to its bottom three stops. Measured over six seconds, Ixion schedules twelve
kicks, five toms and two bass bars; `shutdown` schedules nothing. What is left is a
progression walking under a held-sounding chord, and that is the statement — the machine
that kept time has stopped, and the room it was in has not. Twenty-nine missions of groove
and then no groove is a louder event than either.

It stays in **Ixion's key and progression**, which is where mission 29 already put the
campaign by overriding its own client. `vi ii iii V` never reaches A: it closes on the
dominant and turns away. For an ending built entirely around a question it refuses to
answer, a progression permanently about to arrive was already in the game.

### Why not silence

Total silence was the alternative and it is one line away — `stopAmbient` in
`beginEpilogueFall` instead of `setMissionContext('shutdown', 1)`. Two things argue against
it:

- **The beacon is detuned twenty-two cents flat so that it sits outside the harmony.** That
  is the documented reason it reads as a machine rather than as a voice in the score, and
  with nothing playing it has nothing to be outside of.
- The epilogue is three transmission cards and then a three-and-a-half second fall. Silence
  across all of it is long enough to read as a fault rather than as a choice.

The prologue can be silent because it is the *opening* of a game that has not started
making noise yet. The ending cannot borrow that, because by then the player knows exactly
what absence sounds like.

`MusicTrack` was always `CorpId | something`: its own note anticipated "a finale cue, a
shutdown drone" as the reason the alias exists. `Missions.test.ts` asserts no mission ever
names it — a delivery scored by `shutdown` would be one with no employer in the music.

### Tone is separate from harmony

`Theme.voice` carries a charter's timbre — drawbars, kit level, tom noise, tom offset —
over the campaign default in `VOICING`. Key and progression say what a client is *doing*;
drawbars and a drum kit say what they sound like doing it, and there is no reason those
should have to agree across three companies who share nothing else.

All three currently ship *identical* timbre and differ only in harmony, so `VOICING` holds
the values and no charter overrides it. The mechanism exists for the first one that wants
something else; duplicating the same numbers into three themes would only create three
places for them to drift.

## The callsign is a kit

The word is a drum part, running continuously. **The bass drum is the clock and lands on
every count. A one adds a tom half a count later — on the &.** Kick on the number, tom on
the off: tu-dum.

The two drums are one membrane at two pitches a twelfth apart, and a test asserts the kit
and the word agree bit for bit rather than merely looking alike.

**This is presence encoding, and that deserves saying out loud**, because it is what the
score rejected the first time round. The rule then was that a gap pattern is a groove
rather than a value, which is why the melody sounded every bit and the kit's first design
put a *different drum* on a zero. What makes presence work here is exactly what was missing
then: the kick articulates every count, so the frame never disappears. A listener is not
asked to hear a gap, they are asked to hear whether a tom answers a kick they can already
count. It is a clock line and a data line — which is what a machine would have had anyway.

`TOM_OFFSET` is where the tom sits, as a fraction of a count. 0.5 is the &; small values
give a flam instead; 0 stacks the two, which is the one setting that reads as a mistake
rather than a choice.

### Eight counts, three of them lead-in

The word is eight counts: **three leading zeros, then the five callsign bits.** `29` is
`000 11101`, so the toms fall on counts 3, 4, 5 and 7.

**Eight because eight is what common time holds.** Six was tried first and never sat still:
six against a four-count bar is a hemiola returning to the downbeat only every three bars,
so the word started on two different beats and the ear got no fixed place to count from.
Eight is exactly two bars in four — and the sixteen-bar progression holds exactly eight of
them, so the word starts in the same place on every turn of the harmony.

The extra counts go at the front and they are zeros. A parity bit at the back was an
earlier idea and is the more interesting number, since it varies between missions where a
leading zero is the same hit every time. It answers the wrong question. A percussion part's
problem is not that it carries too little information, it is that a listener has to know
where the word *starts* before any of it can be counted, and a beat that differs per mission
cannot mark that. Three kicks can. It is also what a machine does: a run of zeros before the
payload is how serial framing has always worked, and for the same reason — the receiver
needs the edge, not the data.

The cost is that the word is now square with the bar, the chord and the progression all at
once. That is a deliberate move from *transmission* toward *groove*, and it is the one
property the five- and six-count versions had that this does not.

### The meter

`beatsPerBar` sets the meter and `bpm` counts *counts*, not quarter notes, so 6/8 is
unambiguously six of them. At eight counts to a word the meter question is much less
loaded than it was at six: eight is already square against common time.

| Meter | Word against the bar |
| --- | --- |
| 4 counts | **two bars to a word**, always on a downbeat |
| 8 counts | one bar to a word |
| 6 counts | four bars and three words before it comes back round |
| 3 counts | not square — eight against three takes eight bars |

The separate constraint is the 28.0-second median descent: a cycle longer than a run never
completes in play, and the GRID panel colours the figure when it overruns. That is a
function of tempo and bars-per-chord, not of the word.

### The kit

The kick is a sine falling two octaves onto **the key's tonic** over 55 ms — a drop rather
than a fixed pitch, which is what makes a sine read as a struck drum instead of a low beep,
and landing on the tonic keeps it inside the harmony rather than fighting whatever chord is
live. The tom is the same shape a twelfth higher, ringing longer because a smaller head
does.

**It was a snare first, and a snare is the wrong instrument here twice over.** It is
unpitched, so it says nothing about the key while every other voice in the score does; and
its attack is a crack, which under a pad that moves once every seven seconds reads as a
different piece of music arriving. A tom is pitched, sits in the harmony, and still marks a
beat. `PERCUSSION_NOISE` keeps the old sound reachable as a morph rather than a switch —
noise level, noise decay, filter centre and the membrane's own ring all move together,
since a snare is not a tom with hiss added, it is shorter as well as noisier. It ships at
0.25: a tom with some snap on it.

A twelfth because it is the third harmonic — the widest unmistakable interval that is still
consonant with whatever the kick just played. Both decay short of the next count; a hit
still ringing when the following one lands smears the number, and the number is the point.

Verified on `synth.html` by recording what the scheduler actually places, which is the
honest way to check timing — the tom's stick transient is small at low `PERCUSSION_NOISE`
and the pad's saw harmonics reach the band a spectral test would need. At 101 BPM: kicks
every 0.594 s with no gaps, toms at +0.297 s — exactly half a count — and callsign 26
(`11010`) putting them after counts 3, 4 and 6 of every eight.

## The callsign is the rhythm

One bar per bit at 1.4 seconds, five bars against a four-step progression, and a set bit is a bar of wobble bass while a clear one is a rest. Each *consecutive* set bit ratchets one division faster — 1/4, 1/8, 1/8 triplet, 1/16 — so mission 29, the campaign's own last delivery (`11101`), spends three bars building into a bar of silence and closes on one more lone stroke; mission 16 (`10000`) is one slow stroke and four bars of nothing, and mission 21 (`10101`) ticks rather than builds. Twenty-nine grooves, none of them authored, none able to drift out of step with the campaign.

What that system is finally *for* is [the ending](ending.md).

## The score follows the vehicle down

The pad was already voiced in three groups — `[a−12, a, b, c, a+12]`, a sub, the triad, and
an octave of air — doing three different jobs with no way to move them independently. Each
group now has its own gain, and `layerMix` decides them from where the vehicle is:

| Layer | Reads | Sky | Rim | Floor | Deep shaft |
| --- | --- | --- | --- | --- | --- |
| air (`a+12`) | `altitude` | 1.00 | 1.00 | 0.10 | 0.10 |
| body (triad) | `heightAboveGround` | 0.50 | 0.50 | 1.00 | 1.00 |
| sub (`a−12`) | `abyssProximity` | 0.00 | 0.00 | 0.50 | 1.00 |

**The three curves deliberately read three different heights**, because the heights
disagree and the disagreement is the whole point. Air answers `altitude` — how deep in the
canyon you are, so the sky does not come back because you flew over a deck. Body answers
`heightAboveGround` — the harmony swells at whatever you are about to *touch*, which on a
raised pad is the deck and not the floor two hundred metres under it. Sub answers depth
past the floor, and is the one voice simply absent for most of a flight, which is what
makes arriving underground an event rather than a trend.

Nothing new is computed for this. All three numbers already existed — `altitude` and
`abyssProximity` for the HUD, `heightAboveGround` for the gear and the wind — and
`Game.sounding` is now the single definition the HUD and the score share, so a mix that
disagreed with the abyss warning about how deep you are is not expressible.

Two ends are derived rather than authored. The body's swell **finishes at
`GEAR_DEPLOY_HEIGHT`**, so the harmony lands full at the moment the legs come out; its
start, 140 metres, is about four seconds at the reference pilot's average descent rate.
Air fades across `CANYON.RIM_Y`, so a deeper canyon cannot silently leave it fading over
the wrong stretch.

Air stops at 0.1 rather than 0: a voice that leaves entirely reads as a filter shutting
rather than as the sky going away.

**The sub is two stages end to end, not two candidates.** The first attempt took
`Math.max` of the approach to the floor and the descent past it, and it plateaued — the
approach already reads 0.5 when the floor arrives, so the entire top half of a shaft added
nothing and the sub sat still through exactly the part of the descent it exists to
describe. Invisible in a screenshot, inaudible as a bug, and caught only because
`layerMix` is a pure function with a test asserting it rises all the way down.

Measured end to end on `synth.html` by reading the gain nodes: air 1.00 at the rim → 0.63
at 140 → 0.10 at the floor; body 0.50 until 140 → 1.00 at gear height; sub 0.00 above 60 →
0.50 at the floor → 1.00 at −320. `LAYER_GLIDE` is 0.35, deliberately slower than the
vehicle, so the mix describes where you are instead of pumping on every correction.

This is a mix rather than a pose, so it does not owe `missionTime` anything: it is a
function of where the vehicle is, and a replay puts the vehicle in the same places.

**The wind runs the other way and always did.** `updateWind` gets louder and brighter with
height — so the sky is wind plus air, the floor is the triad, and the shaft is sub with no
wind in it at all. That was not designed alongside the layering; it just already agreed
with it.

## Drawbars

Each pad voice can carry sine partials at organ footages — 16′, 5⅓′, 4′, 2⅔′, 2′, 1⅓′ —
on top of its own oscillator.

**An organ is not more voices, it is more harmonics of the same note.** That is the whole
answer to "would more voices make it sound like an organ": adding notes to the triad makes a
thicker pad and nothing else. A drawbar is a sine at a fixed ratio, and the timbre is the
sum of the ratios rather than the shape of any one of them.

**The partials ride inside their own voice's layer gain, and that is not a detail.** The air
layer is the tonic an octave up, and a body voice's 4′ partial is the same pitch. Mixed
anywhere but inside the group, the drawbars would quietly fill the air register with body —
`layerMix` would go on moving the gains while the altitude stopped being audible, which is
the kind of fault that measures fine and sounds wrong. Inside the group, a partial rises and
falls with the voice it belongs to and the layering survives untouched.

Measured on `synth.html`: with everything off, 220 Hz and 330 Hz sit at the floor; pulling
4′ up puts **+11 dB** at 220 and nothing at 330, and 2⅔′ puts **+4 dB** at 330 and nothing at
220. Each stop lights its own harmonic and no other. The smaller figure for 2⅔′ is the pad's
own lowpass, which is doing more work at 330 than at 220.

**It ships silent.** The pad's character is a lowpassed saw-and-triangle bed, and sine
partials on top are a different instrument rather than a louder one, so the registration is
a decision to make by ear on the bench — where the headroom can be re-measured before
anything changes.

## The bass

Two saws and a square, saturated and then swept by two cascaded lowpass stages — 24 dB/oct, because one biquad is 12 and leaves the harmonics the sweep is meant to travel past plainly audible. The sweep drives `detune` in cents rather than `frequency` in Hz, so the movement is even end to end instead of spending its life open and slamming shut.

Each bar's sweep is a `Float32Array` scheduled with `setValueCurveAtTime`, not an LFO. An `OscillatorNode` cannot be phase-reset, so it cannot be made to land on a bar line, and automating its rate makes the phase at the next bar a function of every change before it. Phase is accumulated by hand instead, which is also what makes the ratchet possible. Everything is placed at an absolute time off the audio clock, so a throttled background tab resyncs rather than falls behind.

`WOBBLE_LEVEL` in `src/audio/MusicComposer.ts` is the mix knob. It sits at 0.11, which measures ~0.045 peak against the pad's ~0.10 and leaves the master peaking near 0.15 — deliberately conservative, since the engine is a control surface and has to stay the loudest thing the player steers by.

## Headroom

`synth.html` exposes the bus the composer mixes into, so the mix is now a measurement
rather than an estimate. Hang an analyser on `window.__synth.master()` and divide out its
gain — `AudioManager` mixes at 0.5 — to read the composer's own output:

```js
const { ctx, master } = window.__synth;
const an = ctx().createAnalyser(); master().connect(an);
```

Steady state, one full 19.0-second cycle each, drawbars at the shipped registration:

| Charter | Peak | RMS |
| --- | --- | --- |
| Ixion | 0.250 | 0.059 |
| Helion | 0.290 | 0.060 |
| Kessler | 0.262 | 0.059 |

**The mix did not clip and did not get louder.** Adding six sine partials per voice was the
change most likely to eat the headroom, and it did not — peak came *down* from 0.31, because
the new progressions are mostly minor triads and the five voices beat against each other
differently than the old tonic-heavy voicings did. 0.29 through the 0.5 master gain is 0.145,
still under the 0.15 the mix was budgeted at.

### The low end is at the edge of audible

The sub voice is the tonic an octave down, and two of the three charters now sit low enough
that it falls off the bottom:

| Charter | Root | Sub voice | Kick lands on |
| --- | --- | --- | --- |
| Ixion | A1 55.00 Hz | A0 **27.50 Hz** | A1 |
| Kessler | D1 36.71 Hz | D0 **18.36 Hz** | D1 |
| Helion | C1 32.70 Hz | C0 **16.35 Hz** | C1 |

Human hearing gives out around 20 Hz, and most speakers give out a long way above it. So
Helion's and Kessler's sub voices are essentially inaudible — which matters specifically
because the sub is the layer that *joins underground*, and losing it costs the bottom third
of [the altitude layering](#the-score-follows-the-vehicle-down) on two charters out of three.
Their kicks are low too, at 32.70 and 36.71 Hz against a usual kick fundamental of 40–60.

This is recorded rather than fixed: raising those two roots an octave would solve it and
would also move the whole register the themes were composed in, which is a decision for
whoever wrote them.

What this cannot yet show is any single voice alone. Pad, bass and ident all arrive at one
bus, and isolating them needs a gain per voice inside `MusicComposer` that nothing currently
asks for. That is the first thing to add if the voices are ever reworked.
