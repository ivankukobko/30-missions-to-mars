# Promo

Store art and copy for publishing the game, and the rig that produced them.

- **[STORE-COPY.md](STORE-COPY.md)** — Steam and itch.io store text, tags, metadata, a
  trailer beat sheet, and the four practical things to settle before a Steam page goes up.

## Which asset goes where

Only the derived art is store-specific, and the folder says which: **`steam/` is Steam
only**, **`itch/` is itch only**. The screenshots at the top level go to both stores
unaltered — only the order they are uploaded in changes.

## Screenshots

Seven 1920×1080 frames, which is Steam's preferred size and comfortably over its 1280×720
minimum; itch has no size requirement and displays the same files. Captured from a real
build at native resolution with the DOM HUD composited in — not upscaled, and not a canvas
grab, which would have dropped `#ui-layer` entirely.

| File | What it shows |
| --- | --- |
| `01-final-approach.png` | Final approach to a lit Helion pad, gear out, engine burning |
| `02-threading-the-corridor.png` | The red west wall, a delivery deck below |
| `03-the-colony-you-built.png` | Deep in the settlement, gantries either side |
| `04-entry.png` | The wide chasm from entry altitude — the scale shot |
| `05-transmission.png` | A Helion brief, fully typed, over the colony |
| `06-early-canyon.png` | The same canyon early in a campaign |
| `07-missions.png` | The mission grid over the player's own canyon |

**Upload order matters, and it differs by store.**

- **Steam** — `01`, `04`, `02`, `03`, `05`, `06`, `07`. The first frame carries the
  carousel, so it leads with the vehicle large and the engine lit; the scale shot follows
  to establish where the game is set. The mission grid goes last: a menu is the weakest
  thing a carousel can open on.
- **itch** — `04`, `01`, `03`, `05`, `02`, `06`. The gallery sits in a narrow column, so
  the wide chasm reads better at small sizes than a close approach does. `07` is worth
  dropping entirely: itch pages are scrolled fast and a menu earns none of that space.

Steam requires screenshots to be **actual gameplay with no overlaid logos, marketing text
or awards**, which is why these are clean frames and why nothing in `steam/` may be
substituted for one.

## Steam capsules

Every asset Steamworks asks for, at the exact pixel dimensions it rejects submissions
for missing. In `steam/`.

| File | Size | Where Steam uses it |
| --- | --- | --- |
| `small-capsule-231x87.png` | 231×87 | Search results, tiny lists |
| `header-capsule-460x215.png` | 460×215 | The main store-page header |
| `main-capsule-616x353.png` | 616×353 | Front-page and category features |
| `vertical-capsule-374x448.png` | 374×448 | Seasonal-sale and front-page slots |
| `library-capsule-600x900.png` | 600×900 | The player's library grid |
| `library-header-920x430.png` | 920×430 | Library detail header |
| `library-hero-3840x1240.png` | 3840×1240 | Library page banner — art only, no text |
| `library-logo-1280x720.png` | 1280×720 | Transparent logotype, overlaid on the hero |
| `page-background-1438x810.png` | 1438×810 | Store-page backdrop, heavily settled |

Two of these are load-bearing in ways that are easy to get wrong:

- **The hero carries no text.** Steam composites `library-logo` over it and positions that
  logo itself, so a title baked into the hero ends up printed twice and misaligned.
- **The logo must actually have an alpha channel.** It is painted on `<body>` alone,
  because a background on `<html>` survives Chrome's transparent-capture override and
  yields an opaque PNG that Steam accepts and then renders as a grey slab.

## itch.io cover

`itch/cover-630x500.png`. itch's one required image and the only asset here that is not a
Steam size — it is what every browse and search listing shows, at **half** the size it is
uploaded at, so the lockup is set to survive 315×250 rather than to look best at 630×500.

itch has no banner size to hit; the page background is a colour, set in the page editor.

## Capsule art plates

`art/` holds clean, HUD-free renders of the world, each at its capsule's own aspect ratio
so nothing is upscaled — `plate-hero.png` is a native 3840-wide frame rather than a 1920
one stretched, and `plate-cover.png` is rendered at 1260×1000 for the itch cover rather
than cropped out of a 16:9 frame. The HUD is hidden for these: instruments in a store capsule read as a
screenshot somebody forgot to crop.

## Regenerating

**This rig runs on the host, not in the container**, and it is the one exception to the
rule in [CLAUDE.md](../../CLAUDE.md). It drives the host's Chrome over the DevTools
Protocol against the dev server, so it needs a real GPU — the container has none, and a
software rasteriser would grade the canyon differently. Node ≥20 with
`--experimental-websocket`, which is what the CDP client is built on.

With `docker compose up` serving the game on 5173:

```bash
node --experimental-websocket docs/promo/rig/shots.mjs
```

```bash
node --experimental-websocket docs/promo/rig/plates.mjs
```

Capsules need the art plates reachable over HTTP, since a `file://` page cannot load
them:

```bash
cd docs/promo && python3 -m http.server 8899
```

```bash
node --experimental-websocket docs/promo/rig/capsules.mjs
```

### What the rig knows that is not obvious

- **A brief card takes two clicks, not one.** `Brief.next` spends the first on finishing
  the teletype and only advances on the second, so a click-per-card loop stalls on card
  one. `lib.mjs` polls `game.state` instead of counting clicks.
- **`.click()` is not enough.** The brief's handlers ignore untrusted events; the rig
  dispatches real mouse events through `Input.dispatchMouseEvent`.
- **The colony is drawn from saved progress, not from the mission being flown.** The seed
  and the banked points in `localStorage` decide how built-up the canyon is, which is why
  `lib.mjs` writes a save before it photographs anything — and why the same canyon can be
  shot early and late.
- **`__mtm.place` snaps the camera.** That is what lets a brief card be staged over the
  colony instead of over the entry haze it would otherwise always appear against.
- **The debug panel is removed before every capture**, never merely scrolled out of frame.
