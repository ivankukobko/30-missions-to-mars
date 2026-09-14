import type { Prop } from '../world/Colony.ts';
import type { CorpId } from '../world/CanyonSpec.ts';
import type { AirframeId } from '../entities/Airframe.ts';
import type { MusicTrack } from '../audio/MusicComposer.ts';
import { resolveLayout } from './Layout.ts';
import { snapToColumn } from '../world/ColonyLattice.ts';
import { parseCells } from '../world/ShaftGrid.ts';
import type { DigEntry } from './TerrainDigs.ts';
import type { LandingScore } from './Progress.ts';
import { i18n } from '../i18n/I18n.ts';
import {
  getMissionOverlay,
  getEpilogueOverlay,
  getDefaultGoal,
} from './CampaignLocale.ts';

/** What the cargo physically looks like strapped under the lander. */
export type CargoShape = 'crate' | 'drum' | 'sphere' | 'rig';

export interface Payload {
  /** Added to the 1.0 dry mass. Heavier cargo means sluggish thrust and rotation. */
  mass: number;
  /**
   * Geometry of the pod on the lander: cargo you can recognise on sight. Mass already drives
   * the pod's size; this gives it a silhouette, so a run reads as "the heavy rig again"
   * rather than "a bigger box".
   *
   * Authored on every payload. It used to be inferred from the cargo's English name when
   * left out, which tied what hangs under the lander to a word any edit or translation could
   * change. The inferred shapes were written into `missions.yaml` unchanged when the words
   * moved to `src/locales/en.yaml`, so the geometry is exactly what it was.
   */
  shape: CargoShape;
}

export interface Mission {
  id: number;
  /**
   * The sol this delivery lands on, counting from the prologue.
   *
   * Twenty-nine deliveries across 628 sols — just under a Mars year, comfortably inside a
   * single Earth–Mars transfer gap of ~759. That is the fact the whole campaign hangs on:
   * the charters clear orbit together because a window is the only time anyone can, they
   * bring a year of equipment down a piece at a time, and mission 29 lands about a hundred
   * sols before the next one opens — so something is already on its way and the game never
   * says what.
   *
   * **Uneven on purpose.** A flat cadence would be a number that changes; the gaps are the
   * story. Three deliveries fall inside nine sols while the injunction holds, because two
   * charters forbidden to build are stockpiling as fast as they can fly it down, and the
   * gaps stretch to thirty-two once the arbitration starts eating windows.
   *
   * **Never stated as a total.** Ixion carries sol counts in their briefs and nobody ever
   * subtracts them out loud — a player who does gets the length of the campaign, which is
   * the only place that number exists. Kessler measures in felt time rather than a tally of
   * jobs flown, Helion carries a machine date stamp nobody reads: three registers, as with
   * everything else here — and none of the three, nor the console between missions, ever
   * says how many are left. A charter cannot announce the campaign is ending because no
   * charter knows it is; the epilogue is the first thing in the campaign that does.
   */
  sol: number;
  client: CorpId;
  payload: Payload;
  fuel: number;
  start: { x: number; y: number };
  /**
   * Pad id that counts as a delivery. Landing anywhere else is the wrong address.
   *
   * Null means the mission has no address: any survivable touchdown completes it, and
   * the scoring drops its pad-centring term. Only mission 1 does this, because mission
   * 1 is where the navigation system is still strapped under the lander.
   */
  target: string | null;
  /** Below this, the abyss takes you: SIGNAL LOST. Deepens as the colony digs. */
  failDepth: number;
  /**
   * The brief, as the ordered transmissions it arrives in.
   *
   * A brief reaches the player a card at a time, so where the breaks fall is authoring
   * rather than formatting: a page turn is a beat, and a card holding four sentences has
   * spent that beat on nothing.
   *
   * This replaced a single `brief` string, which was one wall of text with one speaker.
   * Both forms were carried for a while so the thirty briefs could be split as authoring
   * work rather than in one refactor; the string is gone now that all thirty are here.
   * What it could never express is a second voice — a rival charter cutting in, or the
   * outpost commenting on somebody else's contract — which is what `from` is for.
   *
   * Structure only: one entry per card, saying whose card it is. The words are in
   * `src/locales/en.yaml` under this mission's id, at the same index — see
   * `resolveBriefCards`. What the client says after the landing lives there too, with no
   * entry here at all, because a debrief is nothing but words. See `Debrief`.
   */
  messages: BriefSlot[];
  /** Transmissions that arrive during this descent, without stopping it. See `RadioCall`. */
  radio?: RadioTrigger[];
  /** Overrides the default entry velocity for this mission. */
  entry?: { vx?: number; vy?: number };
  /**
   * Overrides the vehicle this run flies. Left unset, it comes from the client — see
   * `airframeFor`, which is where the campaign's actual answer lives.
   */
  airframe?: AirframeId;
  /**
   * Overrides the theme this run plays. Left unset, it comes from the client — see
   * `musicTrackFor`.
   *
   * Separate from `airframe` on purpose, even though both default off the client. The
   * vehicle is a fact about the contract and cannot disagree with who signed it; the
   * music is a comment on it, and the whole reason to name a track explicitly is to let
   * it say something the client field cannot.
   */
  musicTrack?: MusicTrack;
  /** Built at the start of this mission and standing for every mission after. */
  adds?: { props?: Prop[]; digs?: DigEntry[] };
  /**
   * Pads taken out of service at the start of this mission, by id, along with whatever
   * deck each one rests on.
   *
   * The ledger was append-only until this existed, on the grounds that a world which is
   * a pure function of the mission index is what makes a retry reproducible. Removal
   * does not threaten that — the world is still derived entirely from where you are in
   * the campaign — it just stops the derivation being monotonic.
   *
   * What forced it: Helion drove its cavern at x −33 directly beneath its own crest
   * deck, and by the time the cavern opened there was nowhere left on the west wall to
   * put either. The charter revising its own work is the honest reading, and it is the
   * one `docs/colony.md` already argued was worth the cost.
   */
  decommissions?: string[];
  /** Optional cell count override per corp for this mission (e.g. capping Mission 1 outpost to 3 blocks). */
  colonyBudget?: Partial<Record<CorpId, number>>;
  /**
   * Corps whose work is stopped this mission — the cargo still arrives, and nothing is
   * built with it.
   *
   * A *different* lever from `colonyBudget`, which is an absolute override and therefore
   * cuts the player out of the result: growth is normally `cellBudget(missionsFlown,
   * pointsEarned)`, so pinning a number would pay a careless pilot the same as a careful
   * one for those missions. This instead drops the mission from that corp's own count,
   * which suspends the work without touching how the rest of the campaign is earned.
   *
   * It is permanent, and that is the point rather than an oversight. A contract suspended
   * under injunction never built anything, so the colony is a mission smaller for the rest
   * of the campaign — the legal fight leaves a dent in the canyon that is still visible at
   * mission 29.
   *
   * The cargo is still flown. Helion is a machine and does not stop shipping because a
   * tribunal said so; the pipeline arrives and lies on the deck, which is a more accurate
   * picture of what an injunction does to a corporation than cancelling the run would be.
   */
  colonyFrozen?: CorpId[];
}

/**
 * Which vehicle a client sends you out in: their own, always.
 *
 * Every charter's hardware follows the work it does. Kessler Deep dug every shaft in
 * this canyon, and a shaft is the one place the twin is unambiguously the better tool —
 * locked rotation and canted engines put the vehicle sideways on demand without ever
 * having to recover an attitude, which is what threading a 24-wide bore with rock on
 * both sides actually asks for. Helion's own targets sit to the side rather than below —
 * the crest deck, then the west end of the shared gallery it never dug — so their frame
 * translates rather than rotates too. Ixion is a science outpost landing on open pads,
 * and flies the frame every tolerance in the game was tuned against.
 *
 * One frame per charter is also what the panel needs to be true. The HUD is diegetic —
 * you are connecting to the vehicle's own instruments — so an airframe the client does
 * not operate would put the wrong company's console in front of the player.
 *
 * This used to hold the Helion frame back until mission 6, which left mission 5 — the
 * charter's own first contract — on the lander. That gate was a pacing patch from when
 * there were two vehicles rather than three, and it bought nothing: the two unfamiliar
 * frames still arrived back to back, at 6 and 7 instead of 5 and 6, and mission 5's
 * brief opens "You fly for us now" over a vehicle that is not theirs. Meeting the
 * sidewinder first is the better order regardless — decoupled translation has nothing
 * to recover, whereas the twin is the one frame whose control mapping needs explaining.
 *
 * Four Ixion contracts still open the campaign, so the tutorial teaches a single scheme
 * before any of this applies.
 */
/** One card of a brief as the mission table authors it: whose it is, not what it says. */
export interface BriefSlot {
  /**
   * Whose card this is, and so whose livery it wears: the charter speaking, or the client
   * whose paperwork it is — Helion's `CONDITIONS OF CARRIAGE`, an annex.
   *
   * An id rather than the sender's name. The name is copy and lives in the locale file; the
   * livery used to be looked up by it, which tied a card's colour to a string any rewording
   * or translation could change.
   */
  from: CorpId;
}

/** One epilogue card as the mission table authors it. */
export interface EpilogueSlot {
  /** Whose livery the card wears. Absent on the console's own card. */
  from?: CorpId;
  /**
   * Whose chrome the card wears. Omitted means a charter is speaking.
   *
   * `sys` is the console's own register — not a voice, and not painted in anyone's
   * livery. Only the epilogue uses it: the one card in the campaign that reports rather
   * than transmits.
   */
  register?: 'corp' | 'sys';
}

/** One transmission as shown, in the language asked for. `content` is markup, rendered as written. */
export interface BriefMessage {
  sender: string;
  content: string;
  /** See `EpilogueSlot.register`. */
  register?: 'corp' | 'sys';
}

/**
 * What the client says once the landing has resolved.
 *
 * The campaign already had this beat and delivered it a mission late: the opening card of
 * mission 3 is mission 2's debrief, carried by whoever happens to be the next client. That
 * works while Ixion flies the first five contracts in a row and stops the moment the
 * campaign rotates. Ten of twenty-eight handoffs are same-corp; nine hand off to Helion,
 * which has no second person to acknowledge anybody with; and the parties do not speak for
 * each other. So for most of the campaign the run you just flew was answered by nobody, and
 * the late missions gave up the convention entirely rather than fake it.
 *
 * Here the client who commissioned the run answers it, on the card that already reports the
 * landing — which is also the first position in the game that can read the rank. The old
 * form could not: *"you set the mast down tighter than the spec asked"* is authored before
 * the flight it praises and prints whatever the player actually did.
 *
 * Authored on the mission it answers rather than on the one after it, which is the whole
 * correction: a debrief belongs to the run it is about, not to whoever flies next. It is
 * nothing but words, so it lives entirely in the locale file under that mission's id — see
 * `resolveDebrief`.
 */
export interface Debrief {
  sender: string;
  /** The line for a landing that was simply a landing. */
  content: string;
  /**
   * Alternatives for the two ends of the scale — S/A, and C.
   *
   * Both optional, and a mission with neither says the same thing however you flew. That is
   * the honest default rather than a gap to fill in: authoring three variants everywhere
   * would make a canyon of closely-attentive employers out of two who are not, and the
   * registers are already fixed — Ixion is warm and specific, Kessler comparative, Helion
   * emits a figure. Only Ixion and Kessler have any reason to notice a difference.
   */
  strong?: string;
  weak?: string;
}

/**
 * A transmission that arrives mid-descent, on the glass, without stopping anything.
 *
 * The brief is the channel that carries instructions, so this one carries none: a call the
 * player misses while landing costs them texture and never information. That is what lets
 * it fire on **every attempt** rather than once per mission. A place that only speaks the
 * first time you visit it is a cutscene; a place that says the same thing every time you
 * fall through it is inhabited.
 *
 * Which fixes the register: these are **observations, not events**. *"Radar is up and on
 * your feed now"* is an event, and it is a lie on attempt seven. What belongs here is
 * whatever is true of the canyon during any descent.
 *
 * The mission table authors only this half — when a call fires and whose colour it wears.
 * The words are in the locale file; `RadioCall` is the two put together.
 */
export interface RadioTrigger {
  /** Whose livery the card wears. Defaults to the client — set it only for a cut-in. */
  corp?: CorpId;
  /**
   * Fires when the vehicle first falls past this altitude, or this many seconds after the
   * handover, whichever comes first.
   *
   * Two tests for the same reason `EpilogueFall` runs two: altitude alone lets a diving
   * pilot outrun both calls, and a clock alone lands them on top of each other for a
   * cautious one. The window is narrow. The reference pilot flies the campaign in 28
   * seconds median (18.0 to 33.3 across the twenty it can fly), of which the first 10.5
   * belong to the callsign sounding the mission number and the last ten to the flare —
   * leaving roughly one readable stretch, which is why two calls is the ceiling.
   */
  atAltitude: number;
  atSeconds: number;
}

/** A call as shown: its trigger from the mission table, its words in the language asked for. */
export interface RadioCall extends RadioTrigger {
  /**
   * Who is transmitting, shown as the card's header.
   *
   * **Omitted for Helion, and that is the character rather than an economy.** The rule was
   * always no second person and no first — never silence. A machine broadcasting an
   * unannounced field set assumes the receiver is the kind of thing that parses field sets,
   * so Helion addresses the carrier by *format* while never once saying `you`, and the
   * livery is the only routing header the transmission needs.
   *
   * A datagram, not a handshake. Nothing is acknowledged, nothing is negotiated and nothing
   * adapts — the moment Helion's protocol responds to the carrier, Helion has observed it,
   * and the campaign has a third party with opinions in it. It is the only client that gets
   * what the carrier is right, and it gets there by never asking.
   */
  sender?: string;
  content: string;
}

/** One page of a brief. `body` is the authored markup, unescaped and ready to render. */
export interface BriefCard {
  title: string;
  body: string;
  /** Whose livery the card wears — `BriefSlot.from`, whatever language `title` is in. */
  from: CorpId;
}

/** English's words for a mission — the fallback every other language resolves through. */
const englishFor = (missionId: number) => getMissionOverlay(missionId, 'en');

/**
 * The brief as the cards it is shown on.
 *
 * A pass-through now that every mission is authored as `messages` — every card is
 * somebody sending you something, so the sender is the card's own and not derived from
 * the client. That is what lets a card be a voice the mission is not addressed from.
 *
 * There is deliberately no synthesised "OBJECTIVE" card. An earlier version split the
 * brief at its `<b>OBJECTIVE</b>` marker and gave the tail its own page, which invented a
 * speaker — nobody on this canyon is called Objective. You take work from employers, and
 * the address is a line inside what the employer said, so it stays where it was written.
 *
 * The mission table decides how many cards there are and whose each one is; the words come
 * from the language asked for at that index, else from English. A card past the table's
 * count is ignored, and `CampaignLocale.test.ts` fails on it — and on a missing one —
 * before a player sees either.
 */
export function resolveBriefCards(mission: Mission, locale: string = i18n.currentLocale): BriefCard[] {
  const own = getMissionOverlay(mission.id, locale)?.messages;
  const english = englishFor(mission.id)?.messages;
  return mission.messages.map((slot, i) => ({
    title: own?.[i]?.sender ?? english?.[i]?.sender ?? '',
    body: (own?.[i]?.content ?? english?.[i]?.content ?? '').trim(),
    from: slot.from,
  }));
}

/**
 * The cargo's name as the HUD and the pause manifest print it.
 *
 * Display only: what hangs under the lander is `Payload.shape`, which no name decides.
 */
export function resolvePayloadName(mission: Mission, locale: string = i18n.currentLocale): string {
  return getMissionOverlay(mission.id, locale)?.payloadName ?? englishFor(mission.id)?.payloadName ?? '';
}

/**
 * The plain-text line naming what this run is for — "Deliver the reclaimer to the outpost
 * pad." — as a plain-data readout on the pause overlay, next to PAYLOAD and FUEL.
 *
 * Authored as `goal` in every language, and held to the brief by a test rather than derived
 * from it: every goal must appear word for word in its own language's brief. That is the
 * rule the derivation existed to keep — the sentence already exists inside an employer's
 * own words, and a readout that says something else is one more place for it to drift from
 * what the player read. Deriving it meant scanning for a marker, and the marker is copy:
 * `ZIEL`, `ЦІЛЬ`, and in English a word in a file edited by hand. Reword one and the readout
 * fell back to the generic line with nothing to say it had.
 *
 * Mission 1 has no goal to state: `messages` is empty by design (no link yet to receive a
 * brief on — see its own comment in `missions.yaml`), so it reads the language's default, a
 * line worded like its `target: null` already reads — any survivable touchdown completes it.
 */
export function missionGoal(mission: Mission, locale: string = i18n.currentLocale): string {
  return getMissionOverlay(mission.id, locale)?.goal ?? englishFor(mission.id)?.goal ?? getDefaultGoal(locale);
}

/**
 * Whether a call has come due, given where the vehicle is and how long it has been flying.
 *
 * A pure predicate rather than a branch inside the frame loop, because it is the one part
 * of this channel with a rule in it and the frame loop is the one place that cannot be
 * tested. `sinceHandover` is measured from `begin` in fixed 120 Hz steps, so a retry flown
 * the same way fires the same calls at the same points — see `Game.updateRadio`.
 */
export function radioDue(call: RadioTrigger, altitude: number, sinceHandover: number): boolean {
  return altitude <= call.atAltitude || sinceHandover >= call.atSeconds;
}

/**
 * The least time between two calls, in seconds.
 *
 * A card types itself in (~1s), holds 4.6, then fades over 0.7. Anything under about seven
 * seconds replaces a transmission the player is still reading, which is worse than not
 * sending it: they lose both.
 *
 * This exists because the authored triggers alone do not space anything. Measured against
 * the reference pilot the two anchors land 6–8 seconds apart — 620 at t≈11, 300 at t≈18 —
 * but that is one profile. A pilot who dives crosses both thresholds inside four seconds
 * and used to get the second call on top of the first; a pilot who never touches the
 * throttle crosses them in three. The triggers say *earliest*, and this says *readable*.
 */
export const RADIO_MIN_GAP = 7;

/**
 * The next call to put on the glass, or null.
 *
 * The whole selection rather than a predicate, because the rule that was missing is about
 * two calls rather than one, and a per-call test cannot express it. `lastAt` is when the
 * previous call went up, or null if none has.
 *
 * At most one per step: two calls coming due together is the exact case the gap exists for,
 * and firing both because the loop happened to visit them in the same frame would be the
 * bug with extra steps.
 */
export function nextRadioCall(
  calls: readonly RadioTrigger[],
  sent: ReadonlySet<number>,
  altitude: number,
  sinceHandover: number,
  lastAt: number | null,
): number | null {
  if (lastAt !== null && sinceHandover - lastAt < RADIO_MIN_GAP) return null;
  for (let i = 0; i < calls.length; i++) {
    if (sent.has(i)) continue;
    if (radioDue(calls[i], altitude, sinceHandover)) return i;
  }
  return null;
}

/**
 * A mission's debrief in the language asked for, or null when nobody answers the run.
 *
 * English decides whether there is one and which variants it carries; another language
 * supplies only the words, falling back to English's for any it lacks. See `debriefLine`
 * for why the variants are not a translation's to choose.
 */
export function resolveDebrief(mission: Mission, locale: string = i18n.currentLocale): Debrief | null {
  const english = englishFor(mission.id)?.debrief;
  if (!english?.sender || !english.content) return null;
  const own = getMissionOverlay(mission.id, locale)?.debrief;
  return {
    sender: own?.sender ?? english.sender,
    content: own?.content ?? english.content,
    ...(english.strong === undefined ? {} : { strong: own?.strong ?? english.strong }),
    ...(english.weak === undefined ? {} : { weak: own?.weak ?? english.weak }),
  };
}

/**
 * Which of a debrief's lines this landing earned, with its figures filled in.
 *
 * Two mechanisms, because the three clients answer a run in two different ways.
 *
 * **People pick a sentence.** B takes the default, because B is what the scale calls an
 * unremarkable landing and an unremarkable landing is what the default line is written for.
 * The two ends fall back to it when unauthored, so a variant is always additive and no rank
 * can print nothing.
 *
 * **A form reports a number.** `{CENTILE}` interpolates the run's own points — the same 0–100
 * figure `scoreLanding` computes and `Progress` banks — so Helion's answer moves continuously
 * with how the player actually flew, instead of landing in one of three authored buckets.
 * That is the more accurate machine as well as the less authored one: bucketing would mean
 * somebody had decided which landings deserved which sentence, and there is nobody over
 * there to decide it. It is also why no Helion debrief carries `strong` or `weak` — a form
 * has nothing to choose. Same reasoning as `RETURN EXPECTED: NO` carrying no emphasis.
 *
 * **Which line is English's decision; only its wording is the translation's.** A variant is
 * picked by whether English authors one, then read in the language asked for. Picking from
 * each language's own file let a translation that left out a `strong` answer an S-rank
 * landing with the standard line in that language alone — a scoring difference nobody would
 * read as one.
 */
export function debriefLine(
  mission: Mission,
  score: LandingScore,
  locale: string = i18n.currentLocale,
): string {
  const debrief = resolveDebrief(mission, locale);
  if (!debrief) return '';
  const line =
    (score.rank === 'S' || score.rank === 'A') && debrief.strong
      ? debrief.strong
      : score.rank === 'C' && debrief.weak
        ? debrief.weak
        : debrief.content;
  return line.replace('{CENTILE}', i18n.formatOrdinal(score.points, locale));
}

/** Who signs the debrief, in the active language. Empty for a mission that has none. */
export function resolveDebriefSender(mission: Mission, locale: string = i18n.currentLocale): string {
  return resolveDebrief(mission, locale)?.sender ?? '';
}

/**
 * One radio call: its trigger from the mission table, its words in the active language.
 *
 * Everything that decides *when* it fires — `atAltitude`, `atSeconds` — and whose colour it
 * wears comes from `missions.yaml` untouched, so a retry in German fires the same calls at
 * the same points as one in English. A language file can only reword it.
 *
 * `||` on the sender rather than `??`: the locale files write Helion's absent sender as an
 * empty string, and `Radio.show` tells no header from an empty one by `undefined` alone.
 * With `??` every Helion call went up with a blank header bar, in every language, English
 * included — see `RadioCall.sender` for why it has none.
 */
export function resolveRadioCall(
  mission: Mission,
  index: number,
  locale: string = i18n.currentLocale,
): RadioCall {
  const trigger = mission.radio?.[index];
  if (!trigger) {
    throw new Error(`Radio call index ${index} out of bounds for mission ${mission.id}`);
  }
  const own = getMissionOverlay(mission.id, locale)?.radio?.[index];
  const english = englishFor(mission.id)?.radio?.[index];
  const sender = own?.sender || english?.sender;
  return {
    ...trigger,
    ...(sender ? { sender } : {}),
    content: own?.content ?? english?.content ?? '',
  };
}

/** Every call a mission carries, in the language asked for. */
export function resolveRadioCalls(mission: Mission, locale: string = i18n.currentLocale): RadioCall[] {
  return (mission.radio ?? []).map((_, i) => resolveRadioCall(mission, i, locale));
}

/**
 * The epilogue's cards in the active language, by the same rule as a brief: the mission
 * table sets how many there are, whose livery each wears and in what register, and the words
 * come from the language asked for at that index, else from English.
 */
export function resolveEpilogueCards(
  locale: string = i18n.currentLocale,
): Array<BriefMessage & { from?: CorpId }> {
  const own = getEpilogueOverlay(locale);
  const english = getEpilogueOverlay('en');
  return EPILOGUE.map((slot, i) => ({
    ...slot,
    sender: own?.[i]?.sender ?? english?.[i]?.sender ?? '',
    content: own?.[i]?.content ?? english?.[i]?.content ?? '',
  }));
}

/**
 * Which theme a run plays: its client's, unless the mission says otherwise.
 *
 * Only mission 29 overrides it, and the brief is why. Ixion cuts into Kessler's final
 * contract with mission 1's opening line, word for word — "We are the only thing at the
 * bottom of this canyon, and we intend to stay that way" — from an outpost that went dark
 * two missions earlier. The campaign ends in the key it started in, under a charter that
 * is not there any more, while the vehicle and the payload stay Kessler's.
 *
 * That is the case for the field existing at all. Deriving the theme from the client was
 * right for twenty-eight missions and had no way to express the twenty-ninth, because the
 * thing being said is precisely that the music and the employer have come apart.
 */
export function musicTrackFor(mission: Mission): MusicTrack {
  return mission.musicTrack ?? mission.client;
}

export function airframeFor(mission: Mission): AirframeId {
  if (mission.airframe) return mission.airframe;
  if (mission.client === 'helion') return 'helion';
  if (mission.client === 'kessler') return 'hauler';
  return 'lander';
}

/**
 * You do not spawn hovering — you arrive. Missions begin far above the rim already
 * falling hard, so the first job of every run is killing the velocity you came in
 * with. Combined with the entry altitude this is roughly 88 u/s to shed before
 * touchdown, which is what LANDER.THRUST is sized against.
 */
export const ENTRY_VELOCITY = { vx: 0, vy: -55 };

/**
 * Every landing surface in the campaign is 20% narrower than it was authored.
 *
 * One knob rather than seven edited numbers, because pad width is the single strongest
 * difficulty lever in the game and it wants to be adjustable in one place. It bites
 * twice: there is literally less deck to hit, and `scoreLanding` measures centring as
 * `1 − offset/halfWidth`, so the same landing that used to rank S now has to be placed
 * proportionally more accurately to hold that rank.
 *
 * Rounded to whole units so the authored proportions survive — the widest pad stays the
 * widest — and so the numbers stay legible next to a 24-wide bore.
 */
const PAD_WIDTH_SCALE = 0.72;

function padWidth(authored: number): number {
  return Math.round(authored * PAD_WIDTH_SCALE);
}

/**
 * A pad standing on its own, with no platform under it.
 *
 * `attachToDig` — see the `pad` variant's doc comment in `Colony.ts`. Authored `x`/`y`
 * are still required even when set, as the pre-resolution placeholder `Game.loadMission`
 * overwrites once the named dig's real endpoint is known — kept close to where the
 * eventual real position will actually land, so a bug that left resolution un-wired
 * would still read as roughly-plausible rather than obviously broken.
 */
export function pad(
  corp: CorpId,
  id: string,
  x: number,
  width: number,
  y?: number,
  attachToDig?: string,
  xFromDig?: string,
  atCell?: { col: number; row: number },
  xFromWall?: 'east' | 'west',
): Prop {
  return {
    kind: 'pad',
    id,
    corp,
    // Authored x is intent, not a measurement — every pad in the ledger is a round number
    // somebody typed. Snapping it to the colony lattice costs at most half a cell of
    // drift and stops the pad's own keep-out straddling two columns; see `snapToColumn`.
    // A pad whose x comes from a dig is snapped at resolution instead (`TerrainDigs`), so
    // that it stays on the bore's axis rather than being moved off it here.
    x:
      attachToDig === undefined && xFromDig === undefined && xFromWall === undefined
        ? snapToColumn(x)
        : x,
    width: padWidth(width),
    ...(y === undefined ? {} : { y }),
    ...(attachToDig === undefined ? {} : { attachToDig }),
    ...(xFromDig === undefined ? {} : { xFromDig }),
    // Carried explicitly, like everything else here. This factory rebuilds a pad field by
    // field rather than spreading it, so anything it does not name is silently discarded
    // between the YAML and the canyon — which is how `atCell` first shipped doing nothing
    // at all while every test passed.
    ...(atCell === undefined ? {} : { atCell }),
    ...(xFromWall === undefined ? {} : { xFromWall }),
  };
}

/**
 * The campaign.
 *
 * Difficulty is not tuned in the abstract — it is the colony. Every mission adds
 * structures that stand for the rest of the game, so the corridor the player flies
 * narrows because of deliveries they themselves made. Helion holds the west
 * approach, Kessler the east; over thirty missions they build toward each other and
 * the airspace between them closes. Then the digging starts, and the game turns
 * downward: floor, then excavation, then the abyss that used to be the boundary.
 */
import { parse } from 'yaml';
import rawMissionsYaml from './missions.yaml?raw';

interface RawMissionSpec {
  missions: Mission[];
  epilogue: EpilogueSlot[];
}

const parsed = parse(rawMissionsYaml) as RawMissionSpec;

export const MISSIONS: Mission[] = parsed.missions.map((m) => {
  /**
   * A drawn excavation arrives from YAML as a block of text and has to become cells before
   * anything downstream sees it — `Excavation.cells` is typed as the parsed form, so this
   * is the only place the two representations meet.
   *
   * `halfWidth` and `depth` stay authored rather than being derived from the drawing, and
   * that is deliberate. They are the *bounding* description — `TerrainDigs` positions a
   * pad at `mouthY + direction * depth`, `Layout` checks the corridor against the same
   * endpoint — so deriving them would round every dig to a whole number of cells and move
   * pads that are currently where somebody put them. The drawing is the shape; these two
   * are the box around it, and `Missions.test.ts` asserts they agree.
   */
  for (const dig of m.adds?.digs ?? []) {
    const drawn = dig as { cells?: unknown };
    if (typeof drawn.cells === 'string') drawn.cells = parseCells(drawn.cells);
  }

  if (m.adds?.props) {
    m.adds.props = m.adds.props.map((p) => {
      if (p.kind === 'pad') {
        return pad(p.corp, p.id, p.x, p.width, p.y, p.attachToDig, p.xFromDig, p.atCell, p.xFromWall);
      }
      return p;
    });
  }
  return m;
});

export const MISSION_COUNT = MISSIONS.length;

/**
 * The epilogue's id, one past the last mission.
 *
 * It is not a mission and `getMission` deliberately does not know it — no client, no
 * payload, no score — but it *is* a flight, and the player can be sent on it the same way
 * they are sent on any other: `Game.loadMission(EPILOGUE_ID)` finds no mission and runs
 * the ending. Naming it stops that being an off-by-one nobody can read.
 */
export const EPILOGUE_ID = MISSION_COUNT + 1;

/**
 * How many flights the campaign holds: twenty-nine deliveries and the ending.
 *
 * The number the player is shown, everywhere they are shown one. `MISSION_COUNT` is the
 * number of runs that can be *ranked*, which is a different question and not one the
 * interface ever asks — the menu used to count to 29 and the victory card to 30, which is
 * the same campaign disagreeing with itself on two adjacent screens.
 */
export const CAMPAIGN_FLIGHTS = MISSION_COUNT + 1;

/** The sol the campaign ends on — the denominator for anything that varies across it,
 *  so the season and the light are read off the calendar rather than off mission ids. */
export const LAST_SOL = MISSIONS[MISSIONS.length - 1].sol;

/**
 * What arrives after the twenty-ninth delivery.
 *
 * The same shape as a brief and shown on the same cards, because the campaign opens with
 * a transmission and should close with one rather than with a results screen. It is not a
 * mission: no client, no payload, nothing to fly.
 */
export const EPILOGUE: EpilogueSlot[] = parsed.epilogue;

export function getMission(id: number): Mission | null {
  return MISSIONS.find((m) => m.id === id) ?? null;
}

/**
 * The world as it stands for a given mission: everything built up to and including
 * this one, plus the one structure the player sited themselves.
 *
 * The colony is a pure function of (campaign position, `mastX`), so retrying after a
 * crash rebuilds an identical canyon. `mastX` is written once when mission 1 is flown
 * and never revised, which is what keeps it a *parameter* of the world rather than
 * save state the world can drift with.
 *
 * Positions above are authored intent. `resolveLayout` is what makes them safe: it
 * leaves anything that already clears the landing rules exactly where it was written,
 * and relocates only the pieces that would otherwise stand on a pad or block the way
 * down to one. Running it here rather than at the call sites means the colony, its
 * colliders and the layout check can never disagree about where a structure is.
 */
/**
 * Strikes a pad from the ledger in place.
 *
 * Bare removal is enough now that pads carry no hand-authored platform under them —
 * the grown colony is whatever's standing at that x, and it answers to the mission
 * index and the corp's own maturity, not to this ledger. Helion's crest pad still
 * needs striking at mission 18: `cappedMouths` (Layout.ts) judges a mouth by x-overlap
 * alone, with no height exemption, so a pad left standing at the cavern's own x would
 * still read as capping it from above even with nothing but the grown colony behind it.
 */
function decommission(props: Prop[], padId: string): void {
  const i = props.findIndex((p) => p.kind === 'pad' && p.id === padId);
  if (i >= 0) props.splice(i, 1);
}

/**
 * The authored ledger up to mission `id` — pads, cave roofs, digs, decommissions,
 * the radar — nothing colony-grown. Deliberately pure: no `seed` or `ranks` parameter,
 * no terrain, no colony growth. Growth used to run in here (reading
 * `ranks` to derive density), before any terrain existed for the mission being loaded
 * (`Game.loadMission` calls `canyon.build` *after* this) — it now runs separately, from
 * `ColonyPlan.planColonies`, once real terrain does, and takes the points record
 * directly rather than through here. See `docs/plans/procedural_colony_growth.md`.
 *
 * `digs` can still contain unresolved `WallAnchoredDig` entries (`TerrainDigs.ts`) —
 * resolving those needs terrain too, so it also happens downstream, in
 * `Game.loadMission`, not here.
 */
export function worldAt(
  id: number,
  mastX: number | null = null,
  mastY: number | null = null,
  /**
   * Where the player's own uplink relay is standing, or null on a save that has not
   * flown the prologue — in which case the rim stays empty rather than being guessed at.
   *
   * Grouped into one argument rather than added as a fourth and fifth positional. The
   * mission-zero plan proposed converting this whole signature to an options object and
   * flagged the churn as its main cost; roughly twenty call sites in `Missions.test.ts`
   * pass `(id, mastX)` or `(id, mastX, mastY)` positionally, and none of them care about
   * a relay. One optional trailing object buys the same grouping for none of the churn.
   */
  relay: { x: number; y: number | null } | null = null,
): { props: Prop[]; digs: DigEntry[] } {
  const props: Prop[] = [];
  const digs: DigEntry[] = [];
  for (const mission of MISSIONS) {
    if (mission.id > id) break;
    if (mission.adds?.props) props.push(...mission.adds.props);
    if (mission.adds?.digs) digs.push(...mission.adds.digs);
    // Applied in mission order, so a pad can be built, used for a dozen runs and then
    // struck — and a world rebuilt for any earlier mission still has it standing.
    for (const id of mission.decommissions ?? []) decommission(props, id);
  }
  const resolved = resolveLayout(props);

  /**
   * The radar goes in after the resolver, deliberately — and from mission **3**.
   *
   * Mission 2 is the run that carries it: its payload is `Navigation Radar`, its debrief is
   * the mast standing for the first time, and `Game` writes `mastX` from that landing. So
   * `id >= 2` drew it on the floor while it was still strapped under the vehicle. Invisible
   * on a fresh save, because `mastX` is null until mission 2 lands — it only showed on a
   * **replay**, which is the same way its twin on the relay showed. `docs/lore.md` has said
   * "from mission 3, once the mast is standing" the whole time.
   *
   * It carries no collider — it is a landmark, and landmarks are never the thing that
   * kills you — so it has nothing to clear and nothing to be relocated for. Which also
   * means the player is free to plant it somewhere a later Helion tower will grow
   * through: they overlap, and neither one changes how the canyon flies.
   */
  if (id >= 3 && mastX !== null) {
    resolved.push({
      kind: 'radar',
      corp: 'outpost',
      x: mastX,
      ...(mastY !== null ? { y: mastY } : {}),
    });
  }

  /**
   * The relays go in after the resolver too, and for the same reason as the radar: they
   * carry no collider and occupy nothing, so there is nothing to clear and nothing to be
   * relocated for. See `hasCollider` in `Layout.ts`.
   *
   * The dead ones are unconditional. They predate every charter in this canyon — that is
   * the entire claim they make — so they are in the world at mission 1 exactly as they
   * are at mission 29, and a player who never flies the prologue simply reads them as
   * scenery, which is the correct outcome.
   *
   * The live one is gated at `id >= 2`, exactly as the radar is, and for exactly the same
   * reason: **it is what mission 1 delivers.** `UL-5 Relay` is the prologue's payload and
   * the prologue's debrief is the outpost hearing a voice on it for the first time, so it
   * cannot be standing on the rim during the run that puts it there.
   *
   * It had no gate, on the stated grounds that the relay "is standing on the rim before
   * mission 1 begins" — which is simply not what mission 1 is. On a fresh save that was
   * invisible, because `relayX` is null until the prologue lands and a null relay draws
   * nothing. It only showed on a **replay**: fly the prologue again on a save that has
   * already flown it and the antenna is standing on the pad you are aiming at.
   */
  for (const x of DEAD_RELAYS) resolved.push({ kind: 'relay', x, live: false });
  if (id >= 2 && relay !== null) {
    resolved.push({
      kind: 'relay',
      x: relay.x,
      ...(relay.y !== null ? { y: relay.y } : {}),
      live: true,
    });
  }

  return { props: resolved, digs };
}

/**
 * Four dead relays, on the floor and the lower slopes, half-buried.
 *
 * They are **Ixion's**. Kessler does not arrive until mission 6, and hardware that has
 * been here long enough to be buried cannot be his — an earlier draft had him claiming
 * four previous links, which welded his career to this canyon's history and put his
 * equipment in a shaft he had not dug yet. Ixion got here first, keeps records nobody
 * reads, and is broke enough to be flying equipment that was second-hand when it landed.
 * Four dead relays is what a long-running underfunded outpost accumulates.
 *
 * `-34` is the guaranteed sighting: `outpost-main` sits at x −14, and the player lands on
 * it eight times from mission 2. The other three are properly missable, which is what
 * makes finding one feel found rather than placed.
 *
 * They are never mentioned in any brief. One line from Ixion at mission 22 comes near it
 * and does not say *you will have seen them*.
 */
const DEAD_RELAYS = [-34, -68, 62, 96];

/**
 * Where a mission enters, once the canyon is known.
 *
 * Everything but the prologue enters at its authored `start.x`, which is an address in a
 * canyon whose interesting features are all authored too. The prologue is the one flight
 * with no address and no lateral control: `AIRFRAMES.relay` locks rotation and carries no
 * thruster, so the column it is dropped down is the only ground it will ever be offered,
 * and `resolveContact` refuses bare rock steeper than `MAX_GROUND_LANDING_SLOPE`.
 *
 * So it enters over the bench the generator grades into the east lip, and it enters over
 * it *because that is the same number* — `CanyonGenerator.rimSiteX`, not a constant tuned
 * to sit inside it. The previous arrangement was two authored numbers that were supposed
 * to agree, and the test that guarded them compared one constant to another and passed
 * while the prologue was unlandable on three seeds in ten. See `RIM_BENCH`.
 *
 * Structurally typed rather than importing the generator, so the mission table stays a
 * table and `Missions.ts` keeps having no dependency on the world.
 */
export function entryX(mission: Mission, canyon: { rimSiteX(): number }): number {
  return mission.id === PROLOGUE.id ? canyon.rimSiteX() : mission.start.x;
}

/**
 * The prologue, by name rather than by index.
 *
 * It **is** mission 1 and lives in `missions.yaml` with everything else — it is scored,
 * it has a grid cell, and `MISSION_COUNT` is still 29. An earlier build kept it outside
 * the table as `id: 0` on the argument that the numbered campaign is what a charter paid
 * for; that is an author's rule the player has no way to perceive. What they perceive is
 * that a vehicle went down, so it was a mission.
 *
 * Named here anyway, because several call sites need to say *which* mission plants the
 * relay rather than testing `target === null` — which mission 2 also satisfies, and which
 * would otherwise plant Ixion's navigation mast on the rim with the relay still on the
 * deck. See `Game.succeed`.
 */
export const PROLOGUE: Mission = MISSIONS[0];
