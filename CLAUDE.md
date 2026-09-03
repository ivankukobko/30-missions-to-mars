# Working in this repo

## Run every CLI command inside the container

Node tooling — `npm test`, `npm run typecheck`, `npm run build`, `npx vitest`, `npx tsc`,
installing a dependency — goes through Docker. Not the host.

```bash
docker compose run --rm --no-deps app sh -c "npm run typecheck && npm test"
```

`run --rm --no-deps` works whether or not the service is already up, and cleans up after
itself. Use `docker compose exec app <cmd>` only when a container is already running —
`exec` fails outright if it is not, which is the usual reason a command appears broken.

### Why, so you do not helpfully undo it

- **The host `npm run typecheck` fails.** `node_modules/typescript/bin/tsc` has no file
  extension, and TypeScript's `package.json` declares `"type": "module"`, so Node ≥19 on
  the host refuses to load it (`ERR_UNKNOWN_FILE_EXTENSION`). The container runs
  node 20-alpine where the installed layout works. If you hit this, the fix is to use the
  container — not to invoke `node node_modules/typescript/lib/tsc.js` directly, and not to
  edit anything under `node_modules`.
- **Host `node_modules` may be missing or stale**, because nothing here needs it. Running
  `npm install` on the host is wasted work: `docker-compose.yml` mounts an anonymous
  volume over `/app/node_modules`, so the container never sees the host copy.
- **Changing dependencies means rebuilding the image.** `node_modules` is baked in at
  build time, so a new entry in `package.json` is invisible until:

  ```bash
  docker compose build app
  ```

  The symptom is a package that is plainly in `package.json` reporting `not found`.

## Dev server

Use the Browser pane's preview tooling, which starts the `dev` config in
`.claude/launch.json` (port 5199). Never start a dev server with `Bash`.

`docker compose up` serves the same app on 5173 for a human.

## Verifying a change to the vehicle or the world

Tests and typecheck are necessary but not sufficient here — much of what can go wrong is
geometric, and passes every test while looking wrong or being quietly unfair.

Two failures found that way, both invisible to the suite and to a screenshot:

- cargo hanging 0.90 **below** the pad the vehicle had landed on
- a canted engine pod reaching 0.037 below the deck, because rotating a pod about its
  centre swings its lower corner down by `halfHeight·cos θ + radius·|sin θ|`

So when geometry moves, **measure it**: walk `lander.group` in the browser console,
transform each mesh's bounding box by its `matrixWorld`, and assert nothing sits below
`−LANDER.RADIUS` — for every cargo shape, at both mass extremes, with gear both deployed
and stowed. `?debug=1` exposes `window.__mtm` (`place(x, y)`, `overTarget(height)`,
`scale(n)`) and a mission jump control.

Prefer deriving a dimension over authoring one when a constraint fixes it. `LEG_DEPLOYED`
and `mountHeight` in `src/entities/Lander.ts` are both solved from
`LANDER.RADIUS`, so a later change to a hinge, a leg length or an engine cant cannot
silently put part of the vehicle back underground.

## House style

The code explains **why**, not what. Comments carry the reasoning, the alternative that
was rejected, and the measurement that settled it — see `src/world/CanyonSpec.ts` or the
`missionTime` field in `src/core/Game.ts` for the register. Match it. A comment restating
the line below it is noise.

`docs/` is the design record and is kept current with the code — one page per subject,
indexed from `README.md`, which is an index and a pitch rather than a chapter. A change
that alters behaviour, tuning or a tolerance belongs on the page that owns it.

## Determinism is load-bearing

A mission must replay identically: same seed, same layout, same hazard phase. Anything
that moves is posed from `missionTime`, which counts fixed 120 Hz steps since the mission
loaded. Never pose from `performance.now()` or accumulated frame deltas — it breaks a
retry in the one direction a player cannot argue with, and it breaks it silently.
