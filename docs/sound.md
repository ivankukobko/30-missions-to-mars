# Sound

> Spoilers. This is a design record, and it discusses where the campaign ends up.

The score is a five-voice pad, one chord progression per charter, and the mission's own callsign — the mission number in binary, MSB first, sounded once per forty-second cycle.

## Which theme plays

Which theme plays comes from the mission's client by default, and a mission can override it with `musicTrack` — resolved by `musicTrackFor`, the same shape as `airframeFor`. Exactly one mission uses it. Mission 29 is a Kessler contract flown in Kessler's hauler to Kessler's own shaft, scored in **Ixion's key**: the outpost went dark two missions earlier and cuts into the brief anyway, quoting mission 1's opening line word for word. Deriving the theme from the client was right for twenty-eight missions and had no way to say that, because the thing being said is precisely that the music and the employer have come apart.

## The callsign is the rhythm

One bar per bit at 2.1 seconds, five bars against a four-step progression, and a set bit is a bar of wobble bass while a clear one is a rest. Each *consecutive* set bit ratchets one division faster — 1/4, 1/8, 1/8 triplet, 1/16 — so mission 29, the campaign's own last delivery (`11101`), spends three bars building into a bar of silence and closes on one more lone stroke; mission 16 (`10000`) is one slow stroke and four bars of nothing, and mission 21 (`10101`) ticks rather than builds. Twenty-nine grooves, none of them authored, none able to drift out of step with the campaign.

What that system is finally *for* is [the ending](ending.md).

## The bass

Two saws and a square, saturated and then swept by two cascaded lowpass stages — 24 dB/oct, because one biquad is 12 and leaves the harmonics the sweep is meant to travel past plainly audible. The sweep drives `detune` in cents rather than `frequency` in Hz, so the movement is even end to end instead of spending its life open and slamming shut.

Each bar's sweep is a `Float32Array` scheduled with `setValueCurveAtTime`, not an LFO. An `OscillatorNode` cannot be phase-reset, so it cannot be made to land on a bar line, and automating its rate makes the phase at the next bar a function of every change before it. Phase is accumulated by hand instead, which is also what makes the ratchet possible. Everything is placed at an absolute time off the audio clock, so a throttled background tab resyncs rather than falls behind.

`WOBBLE_LEVEL` in `src/audio/MusicComposer.ts` is the mix knob. It sits at 0.11, which measures ~0.045 peak against the pad's ~0.10 and leaves the master peaking near 0.15 — deliberately conservative, since the engine is a control surface and has to stay the loudest thing the player steers by.
