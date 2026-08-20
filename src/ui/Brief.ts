/**
 * The pre-mission brief, as a sequence of transmissions rather than one modal.
 *
 * You are an AI on the end of a link, and a link carries messages. So the brief is paged:
 * the client says its piece, your own console reports what it has been handed, and the
 * contract states the address. Each arrives on its own card, typed rather than pasted.
 *
 * The pages are not a fixed three. A card with nothing to say is not shown, and a short
 * transmission shares its page with the objective instead of padding a sequence out to a
 * round number — several late briefs are two sentences, and making those three screens
 * would turn a beat into a chore on every retry.
 *
 * Registers follow the same rule as everything else in this game: a client's transmission
 * wears the client's colour, and the console's own diagnostic wears `--sys`. See the
 * system-console block in style.css.
 */

import { CORPS } from '../world/CanyonSpec.ts';
import { resolveBriefCards, type Mission } from '../campaign/Missions.ts';
import { audio } from '../audio/AudioManager.ts';
import { teletype, type Typing } from './Teletype.ts';

interface Page {
  /** Whose voice this is. Decides the card's chrome. */
  register: 'corp' | 'sys';
  eyebrow: string;
  /** Livery for this card, as a hex string. Follows the sender, not the client. */
  color: string;
  /** Authored markup, typed out on arrival. */
  body: string;
}

function el(tag: string, className?: string, html?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export interface BriefHost {
  showPanel(content: HTMLElement): void;
}

export interface BriefOptions {
  /**
   * True when this mission has already been briefed in this session — a retry, a reseed,
   * or a jump back to it.
   *
   * The brief then opens on its **last** card rather than its first. Nothing is hidden:
   * that card carries the address and the button, which is all a returning player needs,
   * and the dots show the pages behind it as already passed.
   *
   * This is the single biggest reason briefs go unread. Text length is not — the whole
   * campaign is about two minutes of teletype — but a player who crashes three times on
   * mission 21 pages the same cards four times, learns that briefs are an obstacle, and
   * never reads one again.
   */
  resumed?: boolean;
}

export function buildBrief(
  mission: Mission,
  host: BriefHost,
  onBegin: () => void,
  opts: BriefOptions = {},
): void {
  const corp = CORPS[mission.client];
  const cards = resolveBriefCards(mission);

  /**
   * Transmissions and nothing else.
   *
   * There was a manifest page here — payload, mass, fuel, vehicle, client — and it was
   * the HUD written out in words. The payload line already sits top-left, the fuel is a
   * gauge, and the vehicle is the console you are about to look at. Reading it out first
   * taught nothing and cost a page on every retry. It lives on the pause overlay now,
   * where it is there if you want it and absent if you do not.
   *
   * The control mapping went with it, and that one was worse than redundant: a keybinding
   * switch in the middle of a charter's transmission is the game talking over the fiction
   * at the exact moment the fiction is doing its work.
   *
   * How many cards a mission spends is the mission's business — an authored `messages`
   * list is shown as written, and a legacy brief yields one or two.
   */
  /**
   * A card wears its *sender's* livery, not the client's.
   *
   * Every card used to be painted in the colour of whoever the mission was flown for,
   * which was indistinguishable from correct right up until a card arrived from somebody
   * else. Mission 15 has the outpost cut into a Kessler contract; under the old rule its
   * header read IXION OUTPOST in Kessler's blue, which is the one thing an interruption
   * must not look like.
   *
   * Senders that are not charters — Helion's `CONDITIONS OF CARRIAGE`, an annex — are
   * not voices and take the client's colour, because they are that client's paperwork.
   */
  const liveries = new Map(Object.values(CORPS).map((c) => [c.name, c.color]));
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

  const pages: Page[] = cards.map((card) => ({
    register: 'corp' as const,
    eyebrow: card.title,
    color: hex(liveries.get(card.title) ?? corp.color),
    body: card.body,
  }));

  new BriefRun(pages, host, onBegin, opts.resumed ? pages.length - 1 : 0).show();
}

class BriefRun {
  private typing: Typing | null = null;

  constructor(
    private pages: Page[],
    private host: BriefHost,
    private onBegin: () => void,
    private at = 0,
  ) {}

  show(): void {
    const page = this.pages[this.at];
    const last = this.at === this.pages.length - 1;

    const card = el('div', `card card-brief ${page.register === 'sys' ? 'card-sys' : ''}`);
    if (page.register === 'corp') card.style.setProperty('--corp', page.color);

    /**
     * Sender on the left, signal strength on the right.
     *
     * The bars are decoration and say so: nothing in the game models link quality, and
     * inventing a number for it would be a readout the player could not act on. What they
     * are for is placing the card — this is a transmission crossing a long way to reach
     * you, not a dialog box the game opened.
     */
    const head = el('div', 'card-eyebrow brief-head');
    head.append(el('span', 'brief-sender', page.eyebrow));
    const signal = el('span', 'brief-signal');
    for (let i = 0; i < 4; i++) signal.append(el('i', `brief-bar b${i}`));
    head.append(signal);
    card.append(head);

    const body = el('div', 'card-body brief-body');
    card.append(body);

    // Dots, so a player who has read this brief before knows how much is left.
    if (this.pages.length > 1) {
      const dots = el('div', 'brief-dots');
      for (let i = 0; i < this.pages.length; i++) {
        dots.append(el('span', `brief-dot ${i === this.at ? 'on' : ''}`));
      }
      card.append(dots);

      // Escape is the only way out of a brief that does not read it, so it has to be
      // visible. Sitting in the dots row rather than beside the button keeps it out of
      // the path of the key a player is already pressing.
      if (!last) {
        const skip = el('button', 'brief-skip', 'SKIP · ESC');
        skip.addEventListener('click', () => this.skip());
        dots.append(skip);
      }
    }

    const advance = el('button', 'primary', last ? 'BEGIN DESCENT' : 'NEXT');
    advance.addEventListener('click', () => this.next());
    card.append(advance);

    this.host.showPanel(card);
    advance.focus();

    // A card with no prose — the diagnostic is a table — has nothing to type.
    this.typing = page.body
      ? teletype(body, page.body, () => {
          card.classList.toggle('typing', this.typing?.running ?? false);
          audio.playTeletype();
        })
      : null;
    card.classList.toggle('typing', this.typing?.running ?? false);

    this.key = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', this.key, true);
  }

  private key: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Space and Enter do what the button does; the first press finishes the typing rather
   * than skipping the page.
   *
   * Captured on the window rather than the card, because the button has focus and would
   * otherwise swallow Space as a click — which would page past text the player has not
   * read yet on the very first keystroke.
   */
  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.skip();
      return;
    }
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    e.preventDefault();
    e.stopPropagation();
    this.next();
  }

  /**
   * Jump to the last card — the one with the address and the button — without launching.
   *
   * Deliberately not "skip the brief and fly": a player who mistakes Escape for a pause
   * key should lose the prose, not be thrown into a descent they did not ask for.
   */
  private skip(): void {
    if (this.at >= this.pages.length - 1) return;
    this.typing?.finish();
    this.detach();
    audio.init();
    audio.playUiBeep(520, 'square', 0.03);
    this.at = this.pages.length - 1;
    this.show();
  }

  private next(): void {
    if (this.typing?.running) {
      this.typing.finish();
      return;
    }
    this.detach();
    audio.init();
    audio.playUiBeep(760, 'square', 0.03);

    if (this.at >= this.pages.length - 1) {
      audio.playLaunch();
      this.onBegin();
      return;
    }
    this.at++;
    this.show();
  }

  private detach(): void {
    if (this.key) window.removeEventListener('keydown', this.key, true);
    this.key = null;
  }
}
