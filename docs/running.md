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

Three reports, none of which need a browser:

```bash
docker compose run --rm --no-deps app npm run colony:report
docker compose run --rm --no-deps app npm run fuel:report
docker compose run --rm --no-deps app npm run pilot:report
```

`colony:report` grows the campaign on four seeds and prints the tables its assertions are
drawn from — total cells at checkpoint missions, and the spread between a C-rank and an
S-rank playthrough — rather than only the failures. That is the tuning loop: change a
coefficient in `ColonyPlan`, run this, read the shape of the campaign off the output. The
other two are described in [Fuel and rank](fuel.md).
