/**
 * The canyon seed as a URL, so a chasm can be handed to somebody else.
 *
 * Its own module rather than a pair of helpers on `Progress` because the hash is a
 * contract with two ends that never run in the same session: it is *written* whenever the
 * canyon changes and *read* once at boot, later, possibly in another browser. Parsing is
 * a pure function over a string for that reason — `CanyonLink.test.ts` can hold both ends
 * to each other without a DOM, which is the only place they meet.
 *
 * The hash and not the query string: `?debug`, `?gizmos`, `?scale` and `?colonies` are
 * developer flags that belong to a session, and a seed is the opposite of that — it is
 * the one parameter a player is meant to pass on. Keeping them in different halves of the
 * URL means a shared link never carries a debug bar into somebody else's game.
 */

/** The hash key. Named rather than bare because `synth.ts` owns the hash on its own page. */
const KEY = 'canyon';

/**
 * A seed as `Progress.fresh` rolls it: `(Math.random() * 0x7fffffff) | 0`, so a
 * non-negative 31-bit integer.
 *
 * Anything else is a typo or a paste that lost its tail, and is discarded rather than
 * coerced. Digits and nothing else, checked before the number is even formed, because
 * every looser reading of "is this a seed" admits something: `parseInt('12x')` is 12 and
 * would have generated a canyon nobody shared, and `Number` — the obvious fix for that —
 * still takes `'1e9'` for a billion and `'+5'` for five. A seed is only ever written here
 * as plain digits, so plain digits is the whole contract.
 */
export function parseSharedSeed(hash: string): number | null {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get(KEY);
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const seed = Number(raw);
  return seed <= 0x7fffffff ? seed : null;
}

/** The hash fragment for a seed, including its `#`. */
export function hashFor(seed: number): string {
  return `#${KEY}=${seed | 0}`;
}

/** The seed the current URL is asking for, or null. Never throws. */
export function readSharedSeed(): number | null {
  try {
    return parseSharedSeed(window.location.hash);
  } catch {
    // An opaque-origin frame can refuse `location` outright. No shared seed, then.
    return null;
  }
}

/**
 * Points the address bar at the canyon now being flown.
 *
 * `replaceState` rather than assigning `location.hash`, which pushes a history entry: a
 * player who switched canyon twice would have to press Back three times to leave the
 * page. The relative `#...` keeps path and query, so a debug session stays a debug
 * session across a reroll.
 *
 * Wrapped because a sandboxed frame throws on `history` the same way it throws on
 * `localStorage`, and an embed can be sandboxed. The hash is a convenience; nothing reads
 * it back within a session, so losing it costs the player nothing they can see.
 */
export function writeSharedSeed(seed: number): void {
  try {
    history.replaceState(null, '', hashFor(seed));
  } catch {
    // No history API, or a frame not allowed one.
  }
}

/**
 * The link to hand somebody, as an absolute URL.
 *
 * Query string deliberately dropped: the flags in it are all developer ones, and a player
 * who happened to be in a `?debug=1` session should not be shipping a debug bar to a
 * friend along with the canyon.
 */
export function shareUrl(seed: number): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${hashFor(seed)}`;
}

/**
 * The old selection-and-`execCommand` copy, which is deprecated and still necessary.
 *
 * `navigator.clipboard` is gated on Permissions Policy, and in a cross-origin frame that
 * means the *embedder* has to have granted `clipboard-write` on the iframe tag. An itch
 * HTML5 page is exactly that frame, and whether the grant is there is not ours to decide
 * — so the one platform this feature exists for is the one where the modern API can be
 * switched off from outside. `execCommand` is gated on user activation instead, which a
 * click on the menu row already is, so it survives where the other fails.
 *
 * Measured rather than assumed: the Clipboard API returned `NotAllowedError: Write
 * permission denied` in a secure, focused context on the first run of this code.
 */
function copyBySelection(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  // Off-screen rather than hidden: `display:none` and `hidden` cannot hold a selection,
  // and anything on-screen flashes a text box across the middle of the menu.
  field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.append(field);
  try {
    field.select();
    // iOS ignores `select()` on a readonly field and copies nothing without this.
    field.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * Puts a link on the clipboard, reporting whether it landed.
 *
 * Modern API first and the old one only as a fallback, in that order because
 * `execCommand` is deprecated and will eventually stop working — but note that the
 * fallback runs after an `await`, so it leans on the click's activation still being live.
 * Chrome allows five seconds for that and the rejection arrives immediately, so the gap
 * is not one a player can land in.
 *
 * A failed copy is reported and never thrown: it is something to tell the player about,
 * not a fault, and the seed is on the row above for them to read either way.
 */
export async function copyShareLink(seed: number): Promise<boolean> {
  const url = shareUrl(seed);
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return copyBySelection(url);
  }
}
