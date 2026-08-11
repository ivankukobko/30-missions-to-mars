# Gameplay

## Entry

Missions do not begin hovering — they begin at 550–660u, well above the 250u rim,
already falling at 34 u/s. Including the drop that is roughly **88 u/s to shed** before
touchdown, and killing it is the first job of every run.

`LANDER.THRUST` is sized against the worst case rather than picked: heaviest payload
(1.9t → mass 2.05) gets 17.6 u/s² against 6 of gravity, a net 11.6, which sheds entry
velocity in ~365 of the ~550 units available. Light cargo brakes in under 160.

## Controls

The same three inputs drive both vehicles; what they mean depends on which one you are
flying.

| | Desktop | Touch | TD-4 LANDER | KD-9 HAULER |
| --- | --- | --- | --- | --- |
| Left | `←` / `A` | left half | rotate left | go left |
| Right | `→` / `D` | right half | rotate right | go right |
| Both / main | `↑` / `W` / `Space` | both halves | main engine | both engines, straight up |
| Pause | `P` / `Esc` | — | | |

On the lander, attitude control stays available under main thrust — fighting the two
against each other is the whole skill. On the hauler there is no attitude to fight; the
skill is that you cannot go sideways without also going up, so descending across the
canyon is a matter of pulsing one engine against gravity.

The touch layout needed no changes for the second scheme. It was already left-half,
right-half and both-halves-for-up, which is the twin-engine mental model — the physics
had simply been contradicting it.

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
`localStorage` alongside campaign progress, and then frozen for all thirty missions so
the colony ledger stays coherent.
