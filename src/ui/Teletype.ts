/**
 * Prints text into an element a character at a time, markup intact.
 *
 * The briefs are authored HTML — `<b>`, `<i>`, `<br/>` — so the obvious implementation,
 * revealing a growing prefix of the string, is wrong twice over: it would render half of
 * `<b>` as literal text for a frame, and it would rebuild the element's DOM every tick.
 *
 * Instead the markup is parsed once and the *text nodes* are emptied and refilled. Tags
 * are therefore never partially present — a bold run appears bold from its first
 * character — and each tick writes a string into an existing node rather than reparsing
 * anything.
 *
 * Wall-clock paced, deliberately. Everything posed from `missionTime` is posed that way
 * because a retry has to replay identically; this runs while the simulation is stopped
 * behind a brief, so there is no mission clock advancing to drive it, and nothing about
 * it can affect a run.
 */

/** Characters per second. Fast enough to read along with, slow enough to be a machine. */
const RATE = 90;

export interface Typing {
  /** Reveals the rest immediately. Safe to call after it has finished. */
  finish(): void;
  /** Whether there is still text to print. */
  readonly running: boolean;
}

export function teletype(host: HTMLElement, html: string, onTick?: () => void): Typing {
  host.innerHTML = html;

  const nodes: { node: Text; full: string }[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    nodes.push({ node: text, full: text.data });
    text.data = '';
  }

  const total = nodes.reduce((sum, n) => sum + n.full.length, 0);
  let shown = 0;
  let raf = 0;
  let last = performance.now();
  let done = total === 0;

  const paint = () => {
    let left = Math.floor(shown);
    for (const { node, full } of nodes) {
      const take = Math.max(0, Math.min(full.length, left));
      // Only touch a node whose visible length actually changed. Most ticks move one
      // character inside one node, and assigning to the rest would dirty the whole
      // subtree for nothing.
      if (node.data.length !== take) node.data = full.slice(0, take);
      left -= full.length;
      if (left < 0) left = 0;
    }
  };

  const step = (now: number) => {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    shown += dt * RATE;
    if (shown >= total) {
      shown = total;
      done = true;
    }
    paint();
    onTick?.();
    if (!done) raf = requestAnimationFrame(step);
  };

  if (!done) raf = requestAnimationFrame(step);

  return {
    finish() {
      if (done) return;
      cancelAnimationFrame(raf);
      shown = total;
      done = true;
      paint();
    },
    get running() {
      return !done;
    },
  };
}
