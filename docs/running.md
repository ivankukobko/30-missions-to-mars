# Running

```bash
docker compose up
```

Then open http://localhost:5173.

## Query flags

Append `?debug=1` for a mission jump control, the canyon seed, a reroll button, and a `window.__mtm` console handle with `place(x, y)`, `overTarget(height)` and `scale(n)`.

`?gizmos` draws what colony growth actually read: the flight routes as lines, cells reserved against them in red, and the growable rock surface in white. `?colonies` strips the world back to colonies and pads.

`?scale=N` sets the pixelation divisor (1 native, 2–4 chunky). It defaults to **1**.

## Typecheck and tests

Everything Node runs in the container, never on the host:

```bash
docker compose run --rm --no-deps app sh -c "npm run typecheck && npm test"
```

`run --rm --no-deps` works whether or not the service is already up and cleans up after
itself. `docker compose exec app` is only for a container that is already running — `exec`
fails outright if it is not, which is the usual reason a command appears broken.

Changing a dependency means `docker compose build app`: `node_modules` is baked into the
image, so a new entry in `package.json` is invisible until the image is rebuilt. The
symptom is a package that is plainly in `package.json` reporting `not found`.

See [CLAUDE.md](../CLAUDE.md) for the full set of development rules and the reasoning
behind them.

## Balance harnesses

Four reports, none of which need a browser:

```bash
docker compose run --rm --no-deps app npm run growth:report
docker compose run --rm --no-deps app npm run colony:report
docker compose run --rm --no-deps app npm run fuel:report
docker compose run --rm --no-deps app npm run pilot:report
```

`growth:report` walks the whole campaign and prints what the *world* has become at each
mission — the excavation's cells, depth, widest gallery, blind ends and the rock it
displaced, beside the settlement's size — plus a row per deck standing inside the hole.
See [Excavations](excavations.md#measuring-the-hole) for what the columns mean and what
they currently say.

`colony:report` grows the campaign on four seeds and prints the tables its assertions are
drawn from — total cells at checkpoint missions, and the spread between a C-rank and an
S-rank playthrough — rather than only the failures. That is the tuning loop: change a
coefficient in `ColonyPlan`, run this, read the shape of the campaign off the output. The
other two are described in [Fuel and rank](fuel.md).

## Benches

Two pages that are not the game, served by the same dev server and excluded from the
build — `vite.config.js` names no extra inputs, so `npm run build` emits `index.html`
alone and neither of these ships.

| Page | What it is for |
| --- | --- |
| `/preview.html` | One in-game object at a time — a vehicle, a colony cell run — with an orbit camera and no mission under it. |
| `/synth.html` | The score, with no canyon and no campaign under it. |

Both run the game's own code rather than a second copy of it. `preview.ts` builds a real
`Lander`; `synth.ts` drives a real `MusicComposer` and reads its exported constants, so the
readout cannot drift from what is actually sounding — the groove comes from `wobbleBar`,
the word from `identBit`, the degrees from `CHORD_NAMES`.

**`synth.html` knows nothing about missions**, and that is what makes it an instrument
rather than a viewer. There are three tracks and a five-bit callsign: which mission plays
which track is a campaign question `musicTrackFor` answers, and a callsign here is any of
the 32 values the encoding holds — including the ones no mission number reaches, which is
the range the groove still has to sound good across. `←`/`→` walk the callsign, space is
transport, and every control re-sounds the word on the spot.

### The grid

BPM, bars per chord and callsign rate are live, and the panel prints what they imply: bar,
chord and cycle length, the cycle against the reference pilot's **28.0-second median
descent** — coloured when it overruns, because a progression longer than the run never
completes in play — and how often the five-bar word realigns with the progression. That
last number is the argument for one setting over another. See [Sound](sound.md#the-grid).

### Harmony

Key and progression are editable: a pitch class, an octave, and four slots over the whole
of `DEGREES`. The playing step lights up in the editor rather than only in the readout, so
the slot worth changing is the one being pointed at.

`MusicComposer.setTheme` is what makes this possible, and the game never calls it — its
themes are per-charter and mean something. It exists so the bench is an instrument rather
than a viewer: a key and a progression no mission plays still has to be auditionable, or
harmony can only be worked out by editing `THEMES` and reloading.

The three charters load as *starting points*, and the lit button is decided by comparing
what is sounding against `THEMES` — edit a chord after loading Kessler and the button goes
out, because you are no longer in Kessler. The readout says `custom` there.

### Altitude

The **ALTITUDE** slider walks a whole descent — entry at 1020, the rim at 240, the floor at
0, the deepest shaft at −320 — and the meters show what each voice group is doing there.
The game feeds `setSounding` three heights that can disagree; one slider cannot reproduce
that, so the bench models the simple case honestly and says which: a descent to open floor,
then straight down a hole. The disagreeing case — high in the canyon and metres off a
raised deck at once — is what `layerMix`'s tests cover. See
[Sound](sound.md#the-score-follows-the-vehicle-down).

### The kit

**COUNTS / BAR**, **KIT**, **TOM ↔ SNARE** and **TOM ON** drive the percussion. The third
morphs the high drum between a bare tom and something close to a snare; the fourth is where
the tom sits after its kick, as a fraction of a count — 50% is the &, small values are a
flam, 0 stacks them. The PATTERN panel draws the six counts
for the current callsign and says what the word does against the bar — square, or how many
bars until it returns to the downbeat. Setting KIT to 0 silences the drums without
disturbing the grid. See [Sound](sound.md#the-callsign-is-a-kit).

### Drawbars

Six sine partials per pad voice at organ footages, off by default. They ride inside each
voice's own layer gain, so pulling them up cannot flatten the altitude layering — see
[Sound](sound.md#drawbars) for why that would otherwise happen. The registration rides the
hash like everything else, and the patch emits it.

### The patch

The three fields *are* the export; the SHA-256 digest above them only names one, since a
hash is one-way and nothing could restore a tuning from it. What the digest is good for is
talking about a tuning — two people looking at `68dce469` are looking at the same grid, and
a patch either matches the shipped `TEMPO` or is marked edited. **COPY LITERAL** yields the
line to paste into `src/audio/MusicComposer.ts`, and the URL carries the whole state, so a
tuning is a link rather than a screenshot of three sliders.

`window.__synth` exposes `composer`, `sound`, `arm`, `toggle`, `applyTempo`, `tempo()`,
`ctx()` and `master()` — the hook for measuring the mix rather than describing it: hang an
`AnalyserNode` off `master()` and read the level back. See [Sound](sound.md#headroom).
