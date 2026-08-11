# Vehicles

## The Vehicle

A flatbed: chassis, deck, load on top, engines under the belly. It was a cone with the
cargo slung underneath, and that was wrong in a way that went unnoticed because it was
only ever seen in flight. `settle()` puts the body's origin `LANDER.RADIUS` above the
pad, so the deck a landed vehicle stands on is the plane y = −0.62 in model space — and
the slung pod reached −1.52 on the heaviest manifest. It hung 0.90 *below the pad*, under
the feet that were supposed to take the landing, with the exhaust passing through it on
the way out.

Three things follow from moving the load on top:

- **The deployed leg angle is solved, not chosen.** It is the angle that stands the feet
  exactly on y = −0.62. The cone hard-coded one that overshot by 0.17 and the comment
  called it a slight interpenetration; on a flatbed, where the gear carries most of the
  silhouette, the same 0.17 read as legs sunk into the pad.
- **Nothing fires through anything.** With the load above the deck there is no longer
  cargo over a nozzle, whatever the manifest.
- **Attitude reads off a line.** The deck and the underdeck lamp are horizontals, and a
  horizontal carries tilt at a distance in a way the old waist ring could not: a circle
  looks the same at every angle.

The same discipline caught the twin's engines: a pod rotated about its own centre reaches
lower than an upright one, by `halfHeight·cos θ + radius·|sin θ|` rather than just
`halfHeight`, which at 30° of cant put the hauler 0.037 inside the pad it had just landed
on. `mountHeight` lifts each mount by whatever its own cant costs, so no future airframe
can angle an engine into the ground.

The trade is vertical. Tall loads stand up to 1.26 above the origin against a 0.62
collider, where the cone topped out at 0.98, so a heavy rig can clip a cave roof without
registering a hit. That errs generous in a game where contact is instant death, and the
horizontal span — the reading that matters when the walls are what you are threading —
is 0.81, near where the cone's gear already reached.

## Two Airframes

The vehicle is data. `Airframe.ts` is a discriminated union describing a flight model and
an engine layout; `LanderBody` branches on `scheme` for how thrust is applied, and
`LanderView` iterates `engines` for where to put a pod and a plume. Neither hard-codes a
vehicle, so a third frame is an entry in that file rather than a change to either.

| | TD-4 LANDER | KD-9 SHAFT HAULER |
| --- | --- | --- |
| Scheme | rotate and thrust | fire engines independently |
| Engines | 1, on the centreline | 2, splayed 30° either side |
| Rotation | yours to manage | locked at zero |
| Fuel | as authored | ×0.9, and thirstier per unit of lift |
| Kills you by | tilt or speed | speed alone |

**Locking rotation is what forces the cant.** With vertical nozzles a single engine
produces pure lift, so a locked-rotation vehicle would have no steering at all. Angle them
and the scheme falls out of vector addition: each engine pushes up-and-sideways, and both
together cancel the horizontals and leave pure lift. "Both buttons go up" is not a case in
the code — it is what adding the two vectors does.

The cant is a straight trade. Steeper buys lateral authority, since the horizontal
component is `sin θ` of engine thrust, and costs lift, since holding altitude only ever
gets you `cos θ` of what you are burning. `engineThrust` scales each nozzle up by `1/cos θ`
so the pair lifts exactly as the single engine does, and the burn rate is scaled by the
same factor — which makes the cosine loss an honest running cost rather than a free
upgrade, and is why the hauler is about 15% thirstier before `fuelScale` touches it.

Splayed nozzles mean the port engine pushes the hull to starboard, so pressing left has to
light the *right* engine for the vehicle to go left. Both readings of that are defensible —
"go where I point" against "fire the thruster I point at" — and which one feels correct is
a fact about the player, so it is a setting, offered in the brief of any mission that flies
the twin.

A locked-rotation vehicle that slid sideways while staying rigidly level would read as an
elevator, so `LanderBody.bank` leans it into the push. **Nothing in the simulation reads
it**: not `resolveContact`, not `tilt`, not the landing test. It is damped inside the fixed
step rather than per frame so it stays deterministic like everything else the campaign's
reproducibility rests on, and there is a test asserting a fully banked hauler still lands.

### Who Flies What

Assignment comes from the client, not a menu. **Kessler Deep flies the hauler; Ixion and
Helion fly the lander.** Kessler dug every shaft in this canyon, and a shaft is where
locked rotation is unambiguously the better tool: it puts the vehicle sideways on demand
without ever having to recover an attitude, which is what threading a 24-wide bore with
rock on both sides actually asks for. Helion's caverns are the opposite problem — you go in
through a mouth in a wall, which wants real rotation — and Ixion lands on an open pad.

There are three clients and two vehicles, and the line that matters is who digs downward
rather than who signs the manifest. It works out to 12 hauler runs against 18, with the
first at mission 6 — five missions of one scheme before the second appears, and that
brief has to teach it.

The tilt dial is removed from the HUD on hauler missions. It would read zero all run,
which is worse than useless: an instrument on the panel asserts that the quantity it shows
can kill you, and on that vehicle it cannot.
