# Fuel and rank

Every landing is scored mostly on fuel — 60 of 100 on a pad — so the size of a tank
against what the run *unavoidably* costs is the strongest balance lever in the game, and
for a long time nothing measured it. Two harnesses do now, and they disagreed with the
authored numbers in the same direction.

## The bound

`FuelBudget.ts` bounds the cost: the optimal brake solves in closed form, and the
crossing is charged at whatever that airframe actually pays to move sideways — which is
not the same for the three of them, and getting that wrong once reversed the whole
conclusion. `npm run fuel:report`.

## The pilot

The reference pilot in `src/testing/` flies the campaign on the real physics with one
controller that behaves identically everywhere, so any difference between two missions is
a difference in the missions. It lands 20 of 29; the nine it cannot are the deliveries
whose approach is not vertical. `npm run pilot:report`.

## What they found

**An S was arithmetically unreachable on fourteen of the twenty-eight
scored missions** — not hard, impossible, on a flight with no mistake in it — and they
were the manoeuvre-heavy charter runs. `fuelScale` was charging the hauler twice for its
canted engines, which burn `11/cos 30°` for the same lift it already scaled down by 0.9.
Cancelling that recovered eight of the fourteen; sixteen tanks were then raised for the
rest. Every mission now tops out at S, and the same pilot scores 67–78 everywhere instead
of 64–78 across a rank boundary.

Both figures are pinned as ratchets rather than targets. How *hard* an S should be is a
question for playtests; whether one exists is arithmetic, and arithmetic can be asserted.
