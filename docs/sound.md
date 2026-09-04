# Sound

> Spoilers. This is a design record, and it discusses where the campaign ends up.

The score is a five-voice pad, one chord progression per charter, and the mission's own callsign — the mission number in binary, MSB first, sounded twice over in two different encodings.

## The number, twice

**The melody reads it.** At the top of every cycle the ident sounds all five bits: a chord tone high for a one, the same tone an octave lower for a zero, sine under triangle so the low note is duller as well as lower. A clear bit used to be silence, which made the figure a rhythm derived from a number rather than a number you could hear — five strokes with gaps in them is a groove, five notes each high or low is a *word*, and the player can count it. Nothing else may use the octave now: the old version climbed one halfway through the word so five even strokes would not read flat, which was a cosmetic use of the exact axis that carries the meaning. `chord[i % 3]` keeps the line moving instead.

**The rhythm feels it**, and keeps its rests — see below. Two readings of one word: one you count, one you feel.

## The cycle is one descent long

Four steps of 7 seconds, so the progression comes round every **28** — the reference pilot's median descent, to the tenth. A typical run now hears the harmony arrive exactly once: out on the step it took off under, home by touchdown. At the old 10.5-second step the cycle ran 42 and no descent in the game was long enough to complete one, so the progression's single move was something a run either caught or missed depending where in the loop it started. `GLIDE` scaled with it — 0.7 was a fifth of a 10.5 step, 0.47 is the same fifth of 7 — because the proportion is what was tuned.

## Which theme plays

Which theme plays comes from the mission's client by default, and a mission can override it with `musicTrack` — resolved by `musicTrackFor`, the same shape as `airframeFor`. Exactly one mission uses it. Mission 29 is a Kessler contract flown in Kessler's hauler to Kessler's own shaft, scored in **Ixion's key**: the outpost went dark two missions earlier and cuts into the brief anyway, quoting mission 1's opening line word for word. Deriving the theme from the client was right for twenty-eight missions and had no way to say that, because the thing being said is precisely that the music and the employer have come apart.

## The callsign is the rhythm

One bar per bit at 1.4 seconds, five bars against a four-step progression, and a set bit is a bar of wobble bass while a clear one is a rest. Each *consecutive* set bit ratchets one division faster — 1/4, 1/8, 1/8 triplet, 1/16 — so mission 29, the campaign's own last delivery (`11101`), spends three bars building into a bar of silence and closes on one more lone stroke; mission 16 (`10000`) is one slow stroke and four bars of nothing, and mission 21 (`10101`) ticks rather than builds. Twenty-nine grooves, none of them authored, none able to drift out of step with the campaign.

What that system is finally *for* is [the ending](ending.md).

## The bass

Two saws and a square, saturated and then swept by two cascaded lowpass stages — 24 dB/oct, because one biquad is 12 and leaves the harmonics the sweep is meant to travel past plainly audible. The sweep drives `detune` in cents rather than `frequency` in Hz, so the movement is even end to end instead of spending its life open and slamming shut.

Each bar's sweep is a `Float32Array` scheduled with `setValueCurveAtTime`, not an LFO. An `OscillatorNode` cannot be phase-reset, so it cannot be made to land on a bar line, and automating its rate makes the phase at the next bar a function of every change before it. Phase is accumulated by hand instead, which is also what makes the ratchet possible. Everything is placed at an absolute time off the audio clock, so a throttled background tab resyncs rather than falls behind.

`WOBBLE_LEVEL` in `src/audio/MusicComposer.ts` is the mix knob. It sits at 0.11, which measures ~0.045 peak against the pad's ~0.10 and leaves the master peaking near 0.15 — deliberately conservative, since the engine is a control surface and has to stay the loudest thing the player steers by.
