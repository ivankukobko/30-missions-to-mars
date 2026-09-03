# The ending

> **Spoilers, all of them.** This page exists to record why the last flight is built the
> way it is, and it cannot do that without saying what happens.

The epilogue is three transmission cards and then the `FALL` state, which is the `UPLINK` state with the handover deleted.

## The handover that never comes

Every mission opens the same way: falling, no console, no instruments, dead controls, and a bar that completes in exactly three seconds and hands the vehicle over. The ending runs that sequence and never runs the line that ends it. Nothing is a cutscene — real simulation, real entry, real camera — and the beat is legible in the player's hands rather than in prose, because twenty-nine times they have felt three seconds pass and their thumbs come alive. The bar crawls to an asymptote at 0.88 rather than freezing, since frozen reads as a bug, and is already visibly behind at the three-second mark.

The vehicle is a new one and the game never says whose. Its airframe comes off the campaign seed and it carries **mission 1's payload on mission 1's fuel** — the same fact the beacon transmits and the same fact Helion files as `CARRIER: CLASSIFICATION PENDING`.

## The beacon

The callsign the score has been sounding all campaign is what the epilogue's beacon transmits, and the reason it can say anything at all. Because mission numbers grow, the figure has been thickening for twenty-nine missions — `11101` is four strokes — so `00001`, four rests and one stroke, is the sparsest thing the system can produce and the first thing the player ever heard. `emitDistantIdent` sounds it weak, detuned twenty-two cents flat so it sits outside the harmony rather than joining it, and fading across its repeats because the receiver is falling away from it. What is transmitting is undecidable **because both candidates make the same sound**: the relay landed on mission 1, still running because nothing told it to stop, or the carrier falling past you on its own first mission. No line of dialogue can collapse that, and none is offered.

## What it falls past

The player's own colony, brought down in place by `Colony.collapse`: about a fifth of it struck from the scene, the rest leaning and dropped and slid, every emissive fitting and point light out, and stone piled over the mouths of the downward bores. Not swapped for anonymous debris — the canyon is the one their twenty-nine deliveries grew, and the shot only works if you recognise the frontage a second before you notice it is lying on its side. Rotation goes through a pivot at each object's own centre, because colony geometry is baked in world coordinates and setting `rotation` directly swings a building around the middle of the canyon.

## Where it ends

Detection and cut are both tested two ways — absolute altitude and height above ground — and take whichever comes first, offset by the same `FALL_SIGNAL_RUN`. Either test alone is wrong somewhere: altitude alone buries the vehicle in a shoulder that stands 170 above `FLOOR_Y`, and a ground lookup alone carries it 300 metres down a shaft. The shared offset is what makes the beacon's three and a half seconds a fact rather than an estimate. Nothing may land or crash here — a touchdown would run the scoring path and a crash would put a retry button on the last thing in the game.
