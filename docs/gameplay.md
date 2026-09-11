# Gameplay

## Entry

Missions do not begin hovering — they begin at 550–660u, well above the 250u rim,
already falling at 34 u/s. Including the drop that is roughly **88 u/s to shed** before
touchdown, and killing it is the first job of every run.

`LANDER.THRUST` is sized against the worst case rather than picked: heaviest payload
(1.9t → mass 2.05) gets 17.6 u/s² against 6 of gravity, a net 11.6, which sheds entry
velocity in ~365 of the ~550 units available. Light cargo brakes in under 160.

### Uplink

The first three seconds are not yours. The vehicle was released before you were connected
to it, so a mission opens already falling with **UPLINK ESTABLISHING** on screen and the
controls dead — the input system registers the keys, and the vehicle ignores them. Then
the game holds and the brief appears; `BEGIN DESCENT` hands over control.

**Nothing of the vehicle's is on screen for any of it** — no console, no augmented layer,
only the status line. The console belongs to the airframe and you are not connected to the
airframe yet; drawing its instruments mid-handshake says the opposite of what the sequence
is for.

So the console's own 900 ms boot sweep plays when the console appears, at `BEGIN DESCENT`.
It runs off `consoleTime` — `missionTime` minus a mark taken when the HUD comes up — not
off `missionTime` itself, which would fire it at mission load while nothing was drawn. The
mark is taken at `begin` rather than when the handshake completes, because the brief sits
between the two and a sweep started at the handshake would be over before the player
stopped reading. The augmented layer arrives at the same moment, for the same reason: it
is the AI's projection onto a vehicle it has connected to.

It costs no altitude budget. Three seconds of free fall is ~190 units and leaves the
vehicle at 73 u/s, and that is what already happened: burning at entry altitude only buys
a longer fight with gravity, so the uplink takes away a thing nobody was doing.

Three seconds rather than the whole descent-from-the-sky shot, because this is a landing
game and missions are re-flown a great deal. The sequence plays on every attempt, retries
included — at this length that is a beat rather than a toll.

## Controls

The same three inputs drive all three vehicles; what each one *does* depends on which one
you are flying.

| | Desktop | Touch | TD-4 LANDER | KD-9 HAULER | HD-7 SIDEWINDER |
| --- | --- | --- | --- | --- | --- |
| Left | `←` / `A` | left third | rotate left | go left | slide left |
| Right | `→` / `D` | right third | rotate right | go right | slide right |
| Main | `↑` / `W` / `Space` | middle third | main engine | both engines, straight up | lift engine |
| Pause | `P` / `Esc` | corner button | | | |

On the lander, attitude control stays available under main thrust — fighting the two
against each other is the whole skill. The hauler has no attitude to fight; its skill is
that you cannot go sideways without also going up, so crossing the canyon is a matter of
pulsing one engine against gravity. The sidewinder's side jets are dedicated, so its axes
are genuinely independent: it holds altitude while it translates and neither input
disturbs the other. Which engine a side lights on the hauler is itself a setting — "go
where I point" against "fire the thruster I point at" — offered in the brief of any
mission that flies the twin.

### Engines spool; jets do not

Every engine in an airframe's `engines` list winds from cold to full over
`LANDER.ENGINE_SPOOL` — 0.125 s, fifteen fixed steps — and back down the same way when the
key comes up. Output follows a smoothstep of the spool position, so an engine catches
softly, builds fast and eases into full. The flame, the throat glow, the engine note, the
dust and the HUD lamps all read the same per-engine output (`Firing.power`) the physics
multiplies thrust and burn by, so nothing on screen claims a thrust the vehicle is not
getting.

**It is latency, not loss.** The ramp is symmetric and the curve is point-symmetric, so the
shortfall on the way up is repaid exactly on the way down: a burn that reaches full delivers
the impulse an instant engine would, on the same fuel. `LanderBody.test.ts` holds that
against the integrator on all three engine layouts. What moves is *when* — thrust arrives
about 60 ms late on average, which withholds ~1.8 u/s of braking on the lander at the start
of a burn and ~1.1 on the heaviest hauler, against a 2.5 u/s landing tolerance. That margin
is why the figure is not larger.

The number came from the reference pilot, not from feel. Across 0.10 / 0.125 / 0.15 / 0.20 s
it lands all twenty straight descents on unchanged fuel, with score spreads of 13 / 12 / 13
/ 20 — the last failing the spread test. At 0.125 the spread is 65–77; mission 3 slips from
67 to 65, under the A cut, at every value tried, because that pilot lands it 2.8 off centre
with one point to spare.

Two consequences worth knowing:

- **A tap shorter than the spool never reaches full**, and delivers less than its duration
  suggests — a 60 ms blip is about a third of what it was. Feathering is now done with the
  length of the press.
- **A dry tank cuts the spool dead.** The wind-down is the engine burning its way to idle,
  and with nothing left to burn there is no wind-down to draw. Touchdown also cuts it:
  contact is engine stop.

The lander's attitude jets are **not** on the spool. They are valves, and a lag on the jets
is a lag on where the thrust *points*, which reaches position through two more integrations
than a lag on how hard it pushes — the vehicle would overshoot its lean, then overshoot the
correction. The sidewinder's side jets are engines in its list and do spool: they push the
hull directly rather than turning it, so they carry only the same one lag as the lift engine.

### The touch layout is three thirds, not two halves

It was left-half, right-half, and both-halves-at-once for main. That scheme derived `main`
from two touches, so a hand was either wholly on one half or straddling both, and it could
not hold one side *and* main as separate inputs — there was no touch equivalent of the
keyboard's Left+Up, which `applyAttitude` calls the whole skill of a lander. Three
vertical thirds — left, middle, right, read off raw x and never drawn — make a side touch
and a middle touch independent, so they combine exactly like two keys. Every frame needed
that: the lander's fight and the sidewinder's hold-altitude-while-translating both want a
side and main at once, and the hauler's middle third now fires both engines directly
rather than the physics inferring it from "both halves." Flight stays gesture-only
otherwise — no on-screen sticks stealing canyon — the one exception being a pause button,
because a phone has no Escape key to fall back to. It sits top centre, between the two
corner readouts. It was bottom-right, which is where the right thumb rests on a phone, so
the one button in flight was under the hand doing the flying. It is on every mission, the
relay's included: the relay has no console, and hiding one used to mean hiding all of
`.hud`, button and all, so mission 1 could not be paused on a phone. A console-less
vehicle now gets `.hud--bare` instead, which takes every readout and leaves the button.

**The relay has one zone, not three.** Mission 1's vehicle has exactly one control —
thrust — by design (see [Mission Zero](plans/mission_zero.md)), and the physics always
honoured that: `rotationPower` and `rcsBurn` are zero. The input did not. Left and right
still reached the vehicle, so its jets lit and the side-jet sound played on a craft that
could not turn, and on a phone two thirds of the glass were controls that answered with
nothing. `InputManager.setSideControl` now takes the sides away outright on a frame with
no side authority: every touch anywhere is the throttle, and the side keys do nothing.
Which frames that is comes from `hasSideControl` in `Airframe.ts`, derived from the data
rather than flagged, and `LanderBody.test.ts` holds it against what the physics actually
does with a side input — so a frame given jets later gets its sides back without an edit.

### Teaching the zones

Because nothing is drawn, a touch player has no way to see where the thirds are. So on a
touch device, every uplink hold shows them: three faint full-height columns labelled for
the airframe on the glass — `ROTATE / THRUST / ROTATE` on the lander, `SLIDE / LIFT /
SLIDE` on the sidewinder — under the caption `HOLD TO FLY`. On the relay it is one column
across the full width, `THRUST ▲`, because that is the whole control. It is neither timed
nor dismissed by a touch: it fills the uplink hold — 1.5 s of mission time — and any brief
after it, dead time that costs no altitude anyway, and it is gone the instant `begin` hands
control over. On mission 1, which has no brief, that is the 1.5 s alone.

Every mission rather than once, ever. It was once, on the grounds that the layout does not
move — but what a side *does* changes with the airframe, the relay has no sides at all,
and a player back after a week has no way to see thirds that are never drawn. The hold is
dead time either way, so the repeat costs nothing a player could want back. Retries count:
a retry is an uplink like any other.

It is `pointer-events: none`, so a finger resting on it during the hold falls through to
the canvas and the flight listener on it. The columns are equal flex children of a
viewport-width row, so their edges land on `merge()`'s `width / 3` splits with no shared
constant to drift.

### On a phone

`index.html` carries the home-screen web-app metas, so a launch from the home screen runs
chromeless on both platforms. In a browser tab, the first user gesture also asks for the
Fullscreen API — touch devices only, and swallowed if refused; iPhone Safari has no such
API, which is what the home-screen route is for. The page suppresses text selection, the
callout menu and the tap-highlight box globally: a press-and-hold in a flight zone would
otherwise raise the iOS selection magnifier over whatever HUD text sat under the thumb.

Those CSS rules turned out to be necessary and not sufficient. iOS still read a hold on
the canyon as the opening of a *system* gesture and reclaimed it, which arrives back as
`touchcancel` — and `touchcancel` releases the touch, so `main` went false inside the
long-press threshold and the throttle read as though it had never fired. The magnifier and
the dead thrust were one fault. CSS states an intent; `preventDefault` on `touchstart` is
the answer to the browser's own question of whose gesture this is, and a passive listener
cannot give it — passive *is* the promise not to cancel. So `InputManager` registers
`touchstart` and `touchmove` with `{ passive: false }` explicitly, since iOS has defaulted
both to passive on `window` since 11.3, and cancels the default on canyon touches only.

**On `#app`, not `window`.** The first version of that listener went on `window`, and a
non-passive listener there has two costs. It sits on the path of every touch on the page,
so the browser can no longer scroll the mission grid or the settings list without first
waiting on a main thread busy rendering the canyon. And every touch was read as flight:
the pause button sat in the right third, and `click` lands after `touchend`, so tapping it
steered the vehicle for as long as the finger was down. The UI lives in `#ui-layer`, a
sibling of `#app` rather than a child, so on `#app` neither can happen — a control touch
never reaches the flight listener, let alone gets cancelled by it, and its `click` and its
scroll are the browser's as before. Touch events keep the target they began on for their
whole life, which is why `touchend` and `touchcancel` live there too: a thumb that lands on
the canyon and lifts over a button still ends where it started. The
`three-brawl` prototype, which never showed the magnifier on an iPhone,
does the same thing through Pointer Events — cancelling on the canvas, from a listener
able to — and sets no `-webkit-touch-callout` at all, which is the clearest sign the CSS
was never what stopped iOS.

## Payload and Scoring

Payload mass is real. It is added to the dry mass, so thrust acceleration is
`THRUST / mass` and rotation response falls with it — heavy cargo genuinely handles
differently, and the load on the deck grows so you can see it.

Each landing is ranked S/A/B/C from fuel remaining (60%), touchdown softness (25%) and
pad centring (15%). Best rank per mission persists. Softness is measured on *combined*
speed, `hypot(vx, vy)`, not descent rate — which is what makes the hauler's lateral drift
a scoring term and not just a way to miss.

Every pad is 20% narrower than authored, applied in one place (`PAD_WIDTH_SCALE`) because
pad width is the strongest single difficulty lever in the game. It bites twice: less deck
to hit, and centring is scored as `1 − offset/halfWidth`, so a landing that used to rank S
now has to be placed proportionally more accurately to hold it. The apron stays an
absolute margin, so platforms shrink with their pads and the lethal skirt does not grow.

Delivering to the wrong pad is a distinct failure. Corporate clients pay for addresses.

## Progress and Seeds

The canyon layout is per-player: a seed is rolled on first launch, stored in
`localStorage` alongside campaign progress, and then frozen for all twenty-nine missions
so the colony ledger stays coherent.

### Sharing a canyon

The seed is written to the URL fragment as `#canyon=<seed>` whenever the canyon changes —
a reroll, a slot switch, an adopted link, the inspector's own Apply — so the address bar
always names the chasm on screen. **SHARE CANYON** on the main menu shows the seed and
copies that link.

The copy tries `navigator.clipboard` first and falls back to the deprecated
selection-and-`execCommand` route. That fallback is not belt-and-braces: `navigator.clipboard`
is gated on Permissions Policy, so inside a cross-origin frame it works only if the
embedder set `allow="clipboard-write"` on the iframe. An itch.io HTML5 page is exactly
that frame, which makes the modern API switchable-off from outside on the one platform
where sharing needs the most help. `execCommand` is gated on user activation instead, and
a click on the menu row already is one.

Opening a link is an **offer and never an application**. A foreign seed dropped onto a
campaign in progress would move the canyon out from under a colony ledger already grown
against the old one, and `mastX`/`relayX` are write-once precisely so twenty-nine missions
of layout cannot shift underneath a player. So:

| Arriving with a foreign seed | What happens |
| --- | --- |
| Nothing flown yet | Adopted in place, silently — there is nothing it can cost |
| A campaign in progress, a free canyon | A card offering to start it in the empty slot; the current campaign is untouched |
| A campaign in progress, all three full | A card saying so. A link never replaces a canyon; discard one from CANYONS first |

The hash belongs to the offer until the player answers it: boot does not overwrite a
pending card, declining puts the player's own seed back, and only the "all three full"
path leaves the foreign seed in place — because that card's whole instruction is to come
back to the link later.

The fragment and not the query string, because `?debug`, `?gizmos`, `?scale` and
`?colonies` are developer flags that belong to a session where a seed is the opposite: the
one parameter meant to be passed on. Keeping them in different halves of the URL means a
shared link never carries a debug bar into somebody else's game — `shareUrl` drops the
query for the same reason.

### When the browser will not store anything

`localStorage` is not merely absent in a sandboxed frame or in Safari with storage
blocked — touching it throws, which is why every access goes through the guards in
`SaveData`. The campaign then plays perfectly and forgets, and the failure is otherwise
completely silent: measured with storage blocked, four consecutive loads produced four
different seeds, a canvas, a full menu and no error of any kind. A player would read that
as a bug in the generator rather than as a browser refusing to store anything.

Two things answer it. The main menu carries a permanent warning while it applies, and the
`#canyon=` link is the way back — with storage blocked, a link holds the same canyon
across reloads where an unlinked load rerolls every time. It is the whole campaign's
persistence reduced to one number, which is all that fits in a URL, but it is the
difference between a chasm you can return to and one that dissolves on refresh.
