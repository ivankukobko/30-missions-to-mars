/**
 * The transmission strip: what the canyon says to you while you are falling through it.
 *
 * Everything else in this game that carries a voice stops the world to do it. That was the
 * right call for a brief — a page turn is a beat, and the address has to be readable — and
 * it left the campaign with no way to be *inhabited*, because a place you only hear from
 * across a modal is a place you visit rather than one you are inside.
 *
 * So: bottom-left, no dismissal, no input, and nothing on it the player needs. It types
 * itself in, holds long enough to be read by somebody who is not reading, and goes. A pilot
 * on final approach who never looks at it has lost nothing.
 *
 * **Outside `.hud`, and that is structural.** `Interface.setAirframe` sets `--corp` on the
 * HUD to the *client's* colour, and a call can come from somebody who is not the client —
 * the cut-in that mission 29 is built on. So the strip sets its own livery per call, from
 * the sender, exactly as `Brief.ts` does per card.
 *
 * Wall-clock paced, like `Teletype` and for the same reason: this is presentation over a
 * simulation that is still running, and nothing here feeds back into it. What decides
 * *when* a call fires is `missionTime` — see `Game.updateRadio` — so a retry gets the same
 * calls at the same points in the same descent.
 */

import { teletype, type Typing } from './Teletype.ts';

/** How long a call stays up after it has finished typing, in seconds. */
const HOLD = 4.6;
/** The fade out, in seconds. Long enough to read as a channel closing rather than a cut. */
const FADE = 0.7;

export class Radio {
  readonly root: HTMLElement;

  private header: HTMLElement;
  private body: HTMLElement;
  private typing: Typing | null = null;
  private timer: number | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'radio hidden';
    this.header = document.createElement('div');
    this.header.className = 'radio-sender';
    this.body = document.createElement('div');
    this.body.className = 'radio-body';
    this.root.append(this.header, this.body);
  }

  /**
   * Put a call on the glass.
   *
   * `sender` omitted is Helion's case and is not an empty header but no header at all: the
   * colour is the only routing the transmission carries. See `RadioCall.sender`.
   */
  show(sender: string | undefined, content: string, color: string): void {
    this.clearTimer();
    this.root.style.setProperty('--corp', color);
    this.root.classList.toggle('anonymous', sender === undefined);
    this.header.textContent = sender ?? '';
    this.root.classList.remove('hidden', 'leaving');
    // Restart the arrival animation on a call that replaces one still on screen.
    this.root.style.animation = 'none';
    void this.root.offsetWidth;
    this.root.style.animation = '';

    this.typing?.finish();
    this.typing = teletype(this.body, content);

    this.timer = window.setTimeout(
      () => this.leave(),
      (HOLD + content.length / 90) * 1000,
    );
  }

  /** Takes the strip down now, without the fade. For a landing, a crash, or the pause. */
  clear(): void {
    this.clearTimer();
    this.typing?.finish();
    this.typing = null;
    this.root.classList.add('hidden');
    this.root.classList.remove('leaving');
  }

  private leave(): void {
    this.clearTimer();
    this.root.classList.add('leaving');
    this.timer = window.setTimeout(() => {
      this.root.classList.add('hidden');
      this.root.classList.remove('leaving');
    }, FADE * 1000);
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
