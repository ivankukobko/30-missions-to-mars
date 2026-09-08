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

## The contact shadow

A blob shadow under the vehicle, because the real one is not affordable here. The scene has
one shadow-casting light and a shadow map sized for the vehicle — enough for the lander to
shade itself, nowhere near enough to put a legible mark on terrain a hundred metres wide.
What a player actually needs from a shadow on final is one thing, *how close am I to that
surface*, and a drawn circle answers it better than a correct shadow would at this
resolution, because it is unambiguous at any sun angle.

**Its reach is `GEAR_DEPLOY_HEIGHT`, derived rather than picked.** Twenty units was the
number asked for and the gear's own trigger is already 20, so the blob appears exactly as
the legs come out and the exhaust starts marking the surface — three proximity cues on one
height. Picking 20 separately would have made that agreement a coincidence that the next
change to either could quietly end.

It is handed the ground sample `updateProximity` already took, rather than looking one up.
The shadow, the legs and the dust all respond to a single `groundBelow` call and cannot
disagree about where the ground is; a blob sitting on a deck the gear had not noticed would
be worse than no blob. `null` — a shaft mouth, the end of a deck — puts it away, which is
honest and also useful: losing your shadow on approach means there is nothing under you to
land on. The same `null` retires it when the run ends, or a crash leaves the wreck's shadow
sitting on the sand under the failure card.

It tightens and darkens as the vehicle arrives (2.2× wide at full reach, down to 1× at
touchdown). The size change is the half doing the work — it is legible in peripheral vision
while the player is watching the horizon bar, where a brightness change alone is not. It is
also wider than the hull at touchdown, since a shadow the size of the vehicle disappears
under it exactly when it is most wanted.

**It is a black material with a radial alpha map, not multiply blending.** Multiply was the
first attempt and it drew the quad: multiply needs its rim to be pure white to be the
identity, and the renderer's ACES tone mapping pulls white below 1 before the blend happens,
so every corner of the plane tinted the ground and the disc read as a lit square. Alpha 0 at
the rim is identity whatever the tone curve does. The material is `toneMapped: false` for the
same family of reason — tone mapping a pure black fragment only lifts it towards grey at the
moment it is darkest — and the alpha texture is `NoColorSpace`, since decoding a mask as sRGB
bends the falloff into something much tighter than the gradient drawn.

The camera runs about 15° above horizontal in cruise and near 58° on final, so the disc is
foreshortened almost to nothing at altitude and fully readable on approach. That is the
right way round, and it is why no attempt is made to billboard it.

## The landing light

A lamp under the vehicle — a shaft and the pool it throws — white until the approach stops
being survivable and red after it. **It replaced the augmented layer's drift arrow.**

The arrow carried two things at once: which way you were sliding, and whether you were doing
it too fast. The first is now told better by the exhaust trails, which are the actual motion
rather than a projection of it. What was left was a warning drawn as a compass, standing off
the hull at a fixed radius and crossing the vehicle on the commonest heading there is —
straight down. A lamp says the same thing without the geometry: it is *on* the vehicle so
nothing has to be kept clear of the hull, and it lands on the surface the player is aiming
at, so the warning appears where they are already looking.

Its threshold is `MAX_LANDING_SPEED`, the same figure the arrow turned at and the same one
the scoring reads, so it reddens when the approach stops being survivable rather than at a
number chosen to look tense. It starts moving a fifth early, so the change is a warning
rather than an alarm after the fact.

**Every frame carries one, including the relay.** The arrow reddened even with the radar in
the hold, because knowing you are coming in too hot is not a ranging readout — it is what
the vehicle's own gear screams about — and mission one would be unfair without it. So
unlike the augmented layer, this is not a capability an airframe can lack.

Two tunings were wrong first and are worth recording:

- **The cone was 16°**, a plausible half-angle for a real lamp and completely wrong here.
  The vehicle is 1.2 units across and the light throws tens of units, so 16° put a
  7.3-unit pool under a 1.2-unit lander — a wash across the whole approach rather than a
  spot on the thing being aimed at. It is 6° now. The beam has to be tight relative to the
  *vehicle*, not to the distance it travels.
- **It reached 30 units and never faded**, so a thirty-unit shaft hung under the vehicle
  from entry altitude, lit through most of a descent it has nothing to say about. Reach is
  `GEAR_DEPLOY_HEIGHT` now and both parts fade to nothing at it, so the lamp, the contact
  shadow and the legs all arrive together.

Note the vehicle already carries a second light: `Lander.thrustLight`, a cool-blue point
light driven by thrust. That is an engine effect and always was — the landing light is the
first lamp on the vehicle that is about the *ground*.

## The augmented layer is a property of the airframe

`Airframe.overlay` sits beside `hasConsole` and for the same reason: whether a vehicle
projects hull brackets, an attitude arc and a speed numeral is a fact about the vehicle, not
about the moment. The relay has neither. Its cargo *is* the channel every later brief
arrives on, so the prologue flies before anything exists to project a layer or anybody
exists to project it for.

**Capability is not permission**, and the two gates answer different questions. A frame that
can draw a layer only does so once the player has actually been handed the vehicle, which
is why `Game.updateOverlays` also keeps it off through the uplink handshake and through the
epilogue's fall.

`FALL` was missing from that second test and the layer was drawn over the ending in full —
which `beginEpilogueFall` and the state-machine note both already said it must not be. The
existing `acquired` flag could not have caught it: `acquired` only *stows* the layer, and a
stowed layer is still a layer.

## Three Airframes

The vehicle is data. `Airframe.ts` is a discriminated union describing a flight model and
an engine layout; `LanderBody` branches on `scheme` for how thrust is applied, and
`LanderView` iterates `engines` for where to put a pod and a plume. Neither hard-codes a
vehicle, so a fourth frame is an entry in that file rather than a change to either — the
third one, the sidewinder, was exactly that.

| | TD-4 LANDER | KD-9 SHAFT HAULER | HD-7 SIDEWINDER |
| --- | --- | --- | --- |
| Scheme | rotate and thrust | fire engines independently | decoupled translation |
| Engines | 1, on the centreline | 2, splayed 30° either side | 1 lifting, 2 lateral RCS |
| Rotation | yours to manage | locked at zero | locked at zero |
| Fuel | as authored | ×0.9, and thirstier per unit of lift | ×0.92 |
| Kills you by | tilt or speed | speed alone | speed alone |

Two of the three cannot rotate, and they are not the same vehicle for it. The hauler has
no lateral control except the imbalance between two canted engines, so going sideways
costs lift and every correction is a trade. The sidewinder has dedicated side jets, so
its axes are genuinely independent: it holds altitude while it translates, and neither
input disturbs the other.

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

Assignment comes from the client, not a menu, and it is one frame per charter with no
exceptions: **Ixion flies the lander, Kessler the hauler, Helion the sidewinder.** Each
charter's hardware follows the work it does. Kessler drove the canyon's one shaft straight
down, and a shaft is where locked rotation is unambiguously the better tool: it puts the
vehicle sideways on demand without ever having to recover an attitude, which is what
threading a 24-wide bore with rock on both sides actually asks for. Helion works the west
end of that same hole — a gallery entered level and sideways along the wall — which wants
lateral placement without attitude, decoupled translation, not rotation. Ixion lands on
open pads and flies the frame every tolerance in the game was tuned against.

The rule is total because the HUD is diegetic. You are an AI connecting to the vehicle's
own instruments, so the panel in front of the player is the client's panel; a charter
flying somebody else's airframe would boot the wrong company's console. See
[Airframe HUD](plans/dedicated_airframe_hud.md).

It works out to 12 hauler runs, 10 sidewinder, 8 lander. Four Ixion contracts open the
campaign, so the tutorial teaches a single scheme before anything else appears, and the
two unfamiliar frames then arrive back to back at 5 and 6. That order is deliberate:
translation first, which has nothing to recover, then the twin, which is the one frame
whose control mapping needs explaining in its brief.

The handover happens on each charter's own first contract rather than a mission into it.
The sidewinder used to be held back to mission 6, which left Helion's first job — mission
5, whose brief opens *"You fly for us now"* — flying an Ixion lander. It bought no pacing:
the same two frames still landed back to back, one mission later.

Each frame carries its own console, in its charter's colours — not only the instrument but
the fuel gauge, the manifest line and the readouts. The TD-4 is a mechanical cross-pointer
whose needles lag and settle, behind rounded glass; the KD-9 is engine lamps, a segmented
fuel gauge and a bore clearance bar, square and industrial; the HD-7 is an exact
orthogonal crosshair, thin and machined. There is no standalone tilt dial any more:
attitude is one instrument among several on the frame that has an attitude, and simply
absent on the two that do not, because an instrument on the panel asserts that the
quantity it shows can kill you and on a locked-rotation vehicle it cannot.

Two things resist the livery on purpose. Alarm red is the same on all three consoles, so
that a learned alarm stays learned. And the delivery target keeps the *pad's* corp colour
rather than the client's, so a run that puts a rival's cargo on your own slab still says
so. See [Airframe HUD](plans/dedicated_airframe_hud.md).
