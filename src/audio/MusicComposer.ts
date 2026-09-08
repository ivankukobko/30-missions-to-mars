import { CANYON, type CorpId } from '../world/CanyonSpec.ts';
import { LANDER } from '../entities/LanderBody.ts';
import { clamp01 } from '../world/Noise.ts';
import { WobbleBass } from './WobbleBass.ts';

/**
 * Which theme is playing.
 *
 * An alias rather than its own union, deliberately: the themes are per-charter and there
 * is no second name for them to drift from. It exists so that a mission overriding its
 * music says *what* it is overriding, and so a track that is not a charter — a finale
 * cue, a shutdown drone — can be added here without touching the mission schema.
 */
export type MusicTrack = CorpId | 'shutdown';

/** A triad as semitone offsets from the key's tonic. */
export type Chord = readonly [number, number, number];

/**
 * The chord vocabulary, as scale degrees over a tonic.
 *
 * Four triads used to be defined here as bare constants and named by an identity map,
 * which worked precisely as long as every chord in the game was one of those four objects.
 * A progression built in `synth.html` is a new array, so identity lookup returned nothing
 * and the editor could not name what it had just made. Naming by *value* costs a reverse
 * scan nobody runs in a hot path and stops the vocabulary being closed.
 *
 * The offsets are absolute from the tonic rather than inversions, because the voicing that
 * consumes them — `[a−12, a, b, c, a+12]` — takes the first tone as the one to double. So
 * `IV` is `[5, 9, 12]` and not `[0, 5, 9]`: the fourth is the root of the chord and has to
 * be the note the sub and the air are an octave from.
 *
 * The first four are the ones the campaign ships; the rest exist so a progression can be
 * written without editing this table first.
 */
export const DEGREES = {
  I: [0, 4, 7],
  iii: [4, 7, 11],
  IV: [5, 9, 12],
  iv: [5, 8, 12],

  i: [0, 3, 7],
  'bII': [1, 5, 8],
  ii: [2, 5, 9],
  'ii°': [2, 5, 8],
  'bIII': [3, 7, 10],
  V: [7, 11, 14],
  v: [7, 10, 14],
  vi: [9, 12, 16],
  VI: [9, 13, 16],
  'bVI': [8, 12, 15],
  'bVII': [10, 14, 17],
  'vii°': [11, 14, 17],
} as const satisfies Record<string, Chord>;

export type Degree = keyof typeof DEGREES;

/** Every degree, in the order the editor should offer them. */
export const DEGREE_NAMES = Object.keys(DEGREES) as Degree[];

/**
 * What to call a triad, by value.
 *
 * Returns the offsets themselves for anything outside the vocabulary rather than throwing
 * or inventing a name: a readout is not the place to decide that a chord is illegal, and a
 * literal `[0,4,8]` is more use to whoever typed it than `?` would be.
 */
export function degreeName(chord: Chord): string {
  const hit = DEGREE_NAMES.find(
    (d) => DEGREES[d][0] === chord[0] && DEGREES[d][1] === chord[1] && DEGREES[d][2] === chord[2],
  );
  return hit ?? `[${chord.join(',')}]`;
}

const I = DEGREES.I;
const ii = DEGREES.ii;
const iii = DEGREES.iii;
const IV = DEGREES.IV;
const iv = DEGREES.iv;
const V = DEGREES.V;
const vi = DEGREES.vi;

/** Pitch classes, sharps only — the roots in play are all named with sharps. */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * A key's tonic in Hz, from a pitch class and an octave.
 *
 * The shipped roots were written as bare frequencies with the note name in a trailing
 * comment — the only record that they were named notes at all. Naming them means a key can
 * be *chosen* rather than typed, and `MusicComposer.test.ts` pins all three against this so
 * the comment cannot come loose from the number again.
 */
export function keyHz(pitchClass: number, octave: number): number {
  const midi = (octave + 1) * 12 + pitchClass;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * A charter's timbre, as distinct from its harmony.
 *
 * Split out because the two answer different questions. Key and progression say what a
 * client is *doing*; drawbars and a drum kit say what they *sound like doing it*, and there
 * is no reason those should have to agree across three companies who share nothing else.
 * Every field is optional and falls back to `VOICING`, so a charter with nothing to say
 * about its own tone inherits the campaign's.
 */
export interface Voicing {
  /** Registration, one level per ratio in `DRAWBARS`. */
  drawbars: readonly number[];
  /** Kit level. */
  percussionLevel: number;
  /** 0 a bare tom, 1 about a snare. */
  percussionNoise: number;
  /** Where the tom sits after its kick, as a fraction of a count. 0.5 is the &. */
  tomOffset: number;
  /** Wobble-bass gate height. 0 removes the bass entirely. */
  wobbleLevel: number;
}

export interface Theme {
  /** Tonic, in Hz. Low: these are pads, and the triad is voiced above it. */
  root: number;
  /** Four steps, held in turn. */
  progression: readonly [Chord, Chord, Chord, Chord];
  /** This charter's tone. Anything unset comes from `VOICING`. */
  voice?: Partial<Voicing>;
}

/**
 * The campaign's tone, and what a `Theme` inherits when it says nothing.
 *
 * Composed on `synth.html` and pasted back. Ixion and Helion arrived with *identical*
 * timbre and only their harmony differing, so these live here rather than being written
 * twice into two charters — the `voice` override exists for the first charter that
 * actually wants something else, and until one does, duplicating it would only create two
 * places for it to drift.
 */
export const VOICING: Voicing = {
  drawbars: [0.4, 0.35, 0.2, 0.2, 0.5, 0.2],
  percussionLevel: 0.12,
  percussionNoise: 0.25,
  tomOffset: 0.5,
  wobbleLevel: 0.11,
};

/**
 * A theme per client: a key, four steps, and optionally a tone of its own.
 *
 * Each progression is chosen to say something about who is talking.
 *
 * - **Ixion — vi ii iii V in A.** F♯m, Bm, C♯m, E. Four chords, three of them minor, and
 *   **the tonic is never one of them**: A is the key and A never arrives. It closes on the
 *   dominant, the one chord whose whole job is to demand the tonic, and then goes back
 *   round to F♯m instead. A progression permanently about to come home. For the charter
 *   that has been at the bottom of this canyon for eleven years and goes dark two missions
 *   before the end, there is nothing better available.
 *
 *
 * - **Helion — iii iv ii vi in C.** Em, Fm, Dm, Am: four minor triads, and **every
 *   transition is exact parallel motion** — `+1 +1 +1`, then `−3 −3 −3`, `+7 +7 +7`,
 *   `−5 −5 −5`. The whole progression is one shape translated four times, with no
 *   independent voice leading anywhere in it. That is measurably why it sounds mechanical:
 *   planing is a machine moving a fixed object around rather than four voices each deciding
 *   where to go. For the charter that does category work correctly and expands sideways
 *   forever, a figure that only ever *translates* is the characterisation.
 *
 * - **Kessler — V ii IV I in D.** A, Em, G, D. An entirely ordinary rock progression, and
 *   the only one of the three that **reaches its own tonic** — on the last step, every
 *   cycle, without fail. Ixion and Helion never touch theirs.
 *
 * That last fact is the set's whole argument, and none of it was authored as a set — three
 * patches arrived separately and this fell out of them:
 *
 * - **Ixion never arrives.** It ends on the dominant, the chord whose only job is to demand
 *   the tonic, then goes back round to F♯m instead.
 * - **Helion never arrives and is not looking.** Four minor triads and nothing but parallel
 *   motion; there is no tonic in it because there is no gravity in it.
 * - **Kessler arrives.** Every cycle, on the beat, home.
 *
 * And the keys line up the same way. **A is exactly a fifth above D**, so Ixion's tonic is
 * Kessler's dominant — and Kessler's progression *opens on A major*. Kessler begins where
 * Ixion lives and resolves somewhere Ixion never gets to. For a campaign where the outpost
 * goes dark two missions from the end and the deep mine keeps running, that is the entire
 * relationship in four chords.
 *
 * It also sharpens mission 29, which is a Kessler contract scored in Ixion's key. That run
 * sits on the chord Kessler *starts* from, playing the progression that never comes home.
 *
 * Ixion and Helion replaced progressions that sat on the tonic and made a single move,
 * written when the harmony was meant to read as weather rather than as music with opinions.
 * These have opinions. What that costs is priced in `STEP_SECONDS`' note.
 */
export const THEMES: Record<MusicTrack, Theme> = {
  outpost: { root: 55.0, progression: [vi, ii, iii, V] }, // A1
  helion: { root: 32.7, progression: [iii, iv, ii, vi] }, // C1
  kessler: { root: 36.71, progression: [V, ii, IV, I] }, // D1

  /**
   * The epilogue. Not a charter, and the one track nobody is being paid by.
   *
   * **Everything with a pulse is gone**: no kit, no wobble bass, and the organ down to its
   * bottom three stops. What is left is the pad, walking a progression, and that is the
   * whole statement — the machine that kept time has stopped and the room it was in has
   * not. Twenty-nine missions of groove and then a held chord is a louder event than
   * either.
   *
   * Total silence was the alternative and it is one line away (`stopAmbient` in
   * `beginEpilogueFall` instead of this). Two things argue against it. The beacon is
   * detuned **twenty-two cents flat so that it sits outside the harmony** — that is the
   * documented reason it reads as a machine rather than a voice in the score, and with
   * nothing playing it has nothing to be outside of. And the epilogue is three transmission
   * cards before a three-and-a-half second fall; silence across all of it is long enough to
   * read as a fault rather than a choice.
   *
   * It stays in **Ixion's key and progression**, which is where mission 29 already put the
   * campaign by overriding its own client. A is the key and `vi ii iii V` never reaches it,
   * closing on the dominant and turning away — for an ending built entirely around a
   * question it refuses to answer, a progression that is permanently about to arrive is the
   * one already in the game.
   */
  shutdown: {
    root: 55.0, // A1, the same key mission 29 ends in
    progression: [vi, ii, iii, V],
    voice: {
      drawbars: [0.4, 0.2, 0.1, 0, 0, 0],
      percussionLevel: 0,
      wobbleLevel: 0,
    },
  },
};

/** Semitones above a root, in Hz. */
function semitone(root: number, semitones: number): number {
  return root * Math.pow(2, semitones / 12);
}

/**
 * The grid everything else is measured against.
 *
 * There was no tempo here before — only a 7-second chord step and a bar that fell out of
 * dividing it by five, which meant the score *had* a BPM (171.43) that nothing named and
 * nothing could be tuned against. A wobble is a rhythmic instrument and a callsign is a
 * transmission on a schedule; both were being placed in seconds, by hand, against a
 * number nobody had written down.
 *
 * So: one tempo, and every duration below derived from it.
 *
 * **140, and four bars to a chord.** 140 is the tempo the wobble is actually written in —
 * `RATCHET`'s 1/4 through 1/16 are dubstep divisions and they want dubstep's own grid,
 * which is 140 felt in half-time at 70. Four bars to a chord then puts the progression at
 * 16 bars, or **27.4 seconds**, which is the number that actually matters: the reference
 * pilot's median descent is 28.0, so a typical run still hears the harmony arrive exactly
 * once — out on the step it took off under, home by touchdown. That property was what the
 * old 7-second step was solving for, and it survives the move intact.
 *
 * The cost, and it is real: the five-bit word no longer fills exactly one chord. At five
 * bars against four the ident drifts through every position in the progression and only
 * comes back round every 80 bars, which no descent is long enough to hear. That is a
 * feature rather than a casualty — the callsign is a machine keeping its own schedule, and
 * a machine that happened to land on the downbeat every time was the one thing it should
 * never sound like.
 *
 * `synth.html` can move all three of these at runtime, which is how they were chosen.
 */
export interface Tempo {
  /**
   * Counts per minute, where a count is one drum hit — not "quarter notes per minute".
   *
   * The distinction only started mattering when the meter became adjustable. Calling it
   * quarter notes leaves 6/8 ambiguous (six eighths, or three quarters?); calling it counts
   * makes `beatsPerBar` mean exactly what it says, and a bar is always `beatsPerBar` of
   * them however the meter is written.
   */
  bpm: number;
  /** Counts to a bar. 4 is common time; 6 gets you 6/8 or 3/4 depending how you feel it. */
  beatsPerBar: number;
  /** Bars per chord step. Four of those to a progression. */
  barsPerChord: number;
}

export const TEMPO: Tempo = { bpm: 101, beatsPerBar: 4, barsPerChord: 2 };

/** One bar, however many counts that is. */
export function barSeconds(t: Tempo): number {
  return (60 / t.bpm) * t.beatsPerBar;
}

/** How long one chord is held. */
export function stepSeconds(t: Tempo): number {
  return barSeconds(t) * t.barsPerChord;
}

/** One turn of the four-chord progression — the figure to compare against a descent. */
export function cycleSeconds(t: Tempo): number {
  return stepSeconds(t) * 4;
}

/**
 * Glide between steps, as a `setTargetAtTime` time constant — so the move is about three
 * times this before it has effectively arrived. Quick enough to land as a change, slow
 * enough that it is still a slide rather than a cut.
 *
 * A fifteenth of the step, because the proportion is what was tuned and not the number:
 * three time constants is a fifth of the step spent arriving, which held at the old
 * 10.5-second step (0.7) and at the 7-second one after it (0.47). Deriving it means a
 * tempo change cannot leave the chord spending most of its life on the way somewhere.
 */
function glide(t: Tempo): number {
  return stepSeconds(t) / 15;
}

/**
 * Bits in a mission ident. Twenty-nine missions need five, and `11101` is the last one.
 */
export const IDENT_BITS = 5;
/**
 * Time per bit in the epilogue's beacon — an eighth note.
 *
 * The only surviving user of a *pitched* callsign. The score's own word is the kit now, so
 * this is no longer a second reading of anything: it is one machine, transmitting, and the
 * beacon keeping the grid is what stops it sounding like a fault.
 */
function identBitSeconds(t: Tempo): number {
  return barSeconds(t) / 8;
}

/**
 * The ident the epilogue's beacon transmits: mission 1, `00001`.
 *
 * Named rather than inlined because the number is the meaning. One stroke is both the
 * first delivery this campaign ever made and the first mission of whoever is flying now,
 * and picking any other value would answer a question the ending exists to leave open.
 */
const DISTANT_IDENT = 1;

/**
 * Sweeps per bar for the nth consecutive set bit: 1/4, 1/8, 1/8 triplet, 1/16.
 *
 * The ident is one bit per bar, which is on or off and cannot by itself pick a rate. The
 * *run length* can, and it is already sitting there in the number. Each consecutive set
 * bit ratchets one division faster, so mission 16 — `10000` — is one slow stroke and four
 * bars of nothing, while mission 29 — the campaign's own last delivery, `11101` — spends
 * three bars building, 1/4 to 1/8 to 1/8 triplet, drops to a bar of silence, and closes on
 * one more lone stroke before the word repeats. The build and the drop come out of the
 * mission number; nobody authored twenty-nine patterns and nobody can get them out of
 * sync with the campaign.
 *
 * A clear bit resets the run, so `10101` is three separate slow strokes rather than a
 * build. Whether a mission grooves or merely ticks is decided by its number.
 */
const RATCHET = [4, 8, 12, 16] as const;

/**
 * Peak narrowing per ratchet step. A fast division that is also sharper reads as harder
 * rather than merely busier, which is what makes four bars sound like a build instead of
 * four bars of the same thing at different speeds.
 */
const RATCHET_SKEW = [1.0, 1.3, 1.7, 2.2] as const;

/** Gate height for the wobble. Deliberately under the pad: the engine is a control
 *  surface and has to stay the loudest thing the player is steering by. Per-charter, so a
 *  track can drop the bass entirely — see `THEMES.shutdown`. */
const WOBBLE_LEVEL = VOICING.wobbleLevel;

/** How far ahead bars are scheduled. Comfortably over the 500 ms poll, comfortably under
 *  a bar, so a mission change is never more than one bar from taking effect. */
const LOOKAHEAD = 1.2;

/** What one bar of the ident does. `null` is a rest — the bar is simply not scheduled. */
export interface WobbleBar {
  /** Sweeps across the bar. */
  cycles: number;
  /** Peak narrowing. */
  skew: number;
  /** Semitones from the live chord's root: the subtonic on the way out of a run. */
  offset: number;
}

/**
 * What the mission number says this bar should do, MSB first.
 *
 * Pure and exported because the mapping is the composition — MSB ordering and run
 * counting are both easy to get subtly wrong, and wrong here is inaudible as a bug and
 * merely sounds like a different mission.
 */
export function wobbleBar(missionId: number, barIndex: number): WobbleBar | null {
  const bit = ((barIndex % IDENT_BITS) + IDENT_BITS) % IDENT_BITS;
  const isSet = (i: number) => i >= 0 && i < IDENT_BITS && ((missionId >> (IDENT_BITS - 1 - i)) & 1) === 1;
  if (!isSet(bit)) return null;

  // Runs count from the top of the word rather than wrapping around it. The word is the
  // number as written, and a run that straddles the boundary would make the figure depend
  // on which repetition you happened to be listening to.
  let run = 1;
  while (isSet(bit - run)) run++;

  const rung = Math.min(run, RATCHET.length) - 1;
  return {
    cycles: RATCHET[rung],
    skew: RATCHET_SKEW[rung],
    // The last set bit before a rest falls to the subtonic. Down rather than up: a bass
    // leaving a phrase drops out of it, and ♭7 under the pad's major third is the one
    // move that sounds like it is not coming back.
    offset: isSet(bit + 1) ? 0 : -2,
  };
}

/** One count. The percussion's grid, and what `bpm` counts. */
export function beatSeconds(t: Tempo): number {
  return 60 / t.bpm;
}

/**
 * Counts in a percussion word: three leading zeros, then the five callsign bits.
 *
 * **Eight, because eight is what common time can hold.** Six was the first attempt and it
 * never sat still: six against a four-count bar is a hemiola that only returns to the
 * downbeat every three bars, so the word started on two different beats and the ear got no
 * fixed place to count from. Eight is exactly two bars in four, or one in eight — the word
 * begins on a downbeat every time, and the same is true against the sixteen-bar
 * progression, which holds exactly eight of them.
 *
 * The extra counts go at the *front*, and they are zeros. A parity bit at the back was an
 * earlier idea and is the more interesting number — it varies between missions, where a
 * leading zero is the same hit every time — but it answers the wrong question. A percussion
 * part's problem is not that it carries too little information, it is that a listener has
 * to know where the word *starts* before any of it can be counted, and a beat that differs
 * per mission cannot mark that. Three kicks can: every word opens on the same figure, so
 * the downbeat is audible before you have learned anything else.
 *
 * It is also what a machine does. A run of zeros before the payload is how serial framing
 * has always worked, and for the same reason — the receiver needs the edge, not the data.
 *
 * The cost is that the word is now square with everything: the bar, the chord and the
 * progression. That is a deliberate move from *transmission* toward *groove*, and it is the
 * one property the earlier five- and six-count versions had that this does not.
 */
export const PERCUSSION_BEATS = 8;

/** Counts of lead-in before the word proper. Derived, so the two cannot disagree. */
export const PERCUSSION_LEAD = PERCUSSION_BEATS - IDENT_BITS;

/**
 * Which drum the callsign asks for on a given beat, MSB first and wrapping.
 *
 * The **same encoding as the melody**, on a different instrument: a one is the high drum
 * and a zero the low one — tom and kick. That is what makes it a percussion part rather
 * than a rhythm that happens to be derived from a number: five hits each high or low is a
 * word, and the player can count it. Rests were never an option here for the reason they
 * were dropped from the melody — a gap pattern is a groove, not a value, and a kit that
 * answers every beat is what lets the *pattern* carry the number instead of the spacing.
 *
 * One hit per count. An eight-count word is two bars of common time, so it opens on a
 * downbeat every time; `beatsPerBar` is where that can be undone, and eight against a
 * six-count bar takes four bars and three words to come back round.
 *
 * Pure and exported for the reason `wobbleBar` and `identBit` are: this mapping is the
 * composition, and MSB ordering is inaudible as a bug — it merely sounds like a different
 * mission.
 */
export function identStrike(missionId: number, beatIndex: number): 'tom' | 'kick' {
  const i = ((beatIndex % PERCUSSION_BEATS) + PERCUSSION_BEATS) % PERCUSSION_BEATS;
  // The lead-in is zeros and so always the bass drum; the rest is the word.
  const set = i >= PERCUSSION_LEAD && identBit(missionId, i - PERCUSSION_LEAD);
  return set ? 'tom' : 'kick';
}

/** Gate height for the kit, against the pad's ~0.10 and the wobble's ~0.045. */
const PERCUSSION_LEVEL = VOICING.percussionLevel;

/**
 * How far above the tonic the high drum sits: a twelfth, an octave and a fifth.
 *
 * The two drums are **one membrane at two pitches**, which is the same trick the melody
 * plays with its octave — the bit is the register, and using one synthesis path for both
 * means the pair cannot drift apart in character the way a kick and a sampled snare would.
 * A twelfth because it is the third harmonic: the widest unmistakable interval that is
 * still consonant with whatever the kick just played.
 */
const TOM_INTERVAL = 19;

/**
 * How much of the high drum is noise: 0 is a bare tom, 1 is about a snare.
 *
 * It was a snare first — bandpassed noise with a tone under it — and a snare is the wrong
 * instrument here twice over. It is unpitched, so it says nothing about the key while
 * every other voice in the score does; and its attack is a crack, which under a pad that
 * moves once every seven seconds reads as a different piece of music arriving. A tom is
 * pitched, sits in the harmony, and still marks a beat.
 *
 * Kept as a knob rather than a decision because it is a taste, and the range is a genuine
 * morph: noise level, noise decay, filter centre and the membrane's own decay all move
 * with it, since a snare is not a tom with hiss added — it is shorter as well as noisier.
 */
const PERCUSSION_NOISE = VOICING.percussionNoise;

/**
 * Where the tom lands, as a fraction of a count after the kick.
 *
 * 0.5 is the **and**: kick on the number, tom on the off — tu-dum. Small values give a
 * flam instead, and 0 puts the two on top of each other, which is the one setting that
 * sounds like a mistake rather than a choice.
 *
 * **The kick now sounds on every count and the tom is what the bit adds.** That is a real
 * change to the encoding and worth being honest about: it used to be *which* drum, one
 * membrane at two pitches, and it is now *whether there is a tom on the and*. Presence
 * encoding is what this score rejected the first time round, on the grounds that a gap
 * pattern is a groove rather than a value — and the reason it works here is precisely what
 * was missing then. The kick articulates every count, so the frame never disappears. It is
 * a clock line and a data line, which is what a machine would have anyway.
 */
const TOM_OFFSET = VOICING.tomOffset;

/**
 * Whether bit `index` of the mission's callsign is set, MSB first.
 *
 * Pure and exported for the same reason `wobbleBar` is: the mapping is the composition, and
 * MSB ordering is easy to get subtly wrong in a way that is inaudible as a bug and merely
 * sounds like a different mission. Now that a zero is sounded rather than skipped, a
 * reversed word is a *plausible* five-note figure every time, which is worse — there is no
 * gap pattern left to notice it by.
 */
export function identBit(missionId: number, index: number): boolean {
  return ((missionId >> (IDENT_BITS - 1 - index)) & 1) === 1;
}


/**
 * Where the vehicle is, in the only three terms the score cares about.
 *
 * All three are already computed every frame for other reasons — `altitude` and
 * `abyssProximity` for the HUD, `heightAboveGround` for the gear and the wind — so the
 * layering costs the simulation nothing. They are kept separate rather than reduced to one
 * number because they genuinely disagree, and the disagreement is the point: on a raised
 * deck you are high in the canyon and a few metres off the ground at the same time.
 */
export interface Sounding {
  /** Metres above the canyon floor. Entry is around 1020, the rim 240. */
  altitude: number;
  /** Metres to whatever is directly below. `Infinity` with nothing under you. */
  heightAboveGround: number;
  /** 0 at the floor, 1 at the mission's `failDepth` — how far down a shaft you are. */
  abyssProximity: number;
}

/** Gain per voice group, 0 to 1. */
export interface LayerMix {
  /** The tonic an octave down: a drone that belongs to the hole. */
  sub: number;
  /** The triad. The harmony itself, never absent. */
  body: number;
  /** The tonic an octave up: air, and it belongs to the sky. */
  air: number;
}

/** Air is gone at the floor, full at the rim and above. Not quite gone: the chord keeps a
 *  little top, or losing the sky reads as a filter closing rather than as a voice leaving. */
const AIR_FLOOR = 0.1;

/** The triad in open sky. It is the harmony, so it is never off — it only has somewhere
 *  left to go. */
const BODY_SKY = 0.5;

/**
 * Where the body starts swelling, in metres above whatever is below.
 *
 * About four seconds out: the reference pilot covers 1020 in 28 seconds, so it is moving
 * near 36 m/s on average and 140 is roughly the last four of them. Short enough to read as
 * arrival rather than as a long crescendo.
 *
 * The swell *finishes* at `GEAR_DEPLOY_HEIGHT` rather than at the ground, so the harmony
 * lands full at the moment the legs come out. Deriving that end from the gear means a
 * change to either cannot leave the two disagreeing about when a landing has begun.
 */
const BODY_REACH = 140;

/** How high above the floor the sub starts arriving, and how much of it is there by the
 *  time the floor does. The rest is the shaft's, below. */
const SUB_ONSET = 60;
const SUB_AT_FLOOR = 0.5;

/**
 * What each voice group is doing at a given position in the canyon.
 *
 * Pure and exported for the reason `wobbleBar` and `identBit` are: this mapping *is* the
 * arrangement, and an arrangement that can only be checked by flying to it is one nobody
 * checks. `synth.html` drives it from a slider and the tests assert its ends.
 *
 * The three curves read three different heights on purpose:
 *
 * - **Air answers `altitude`** — how high you are in the canyon, not how close the ground
 *   is. It is the sky, and the sky does not come back because you flew over a deck.
 * - **Body answers `heightAboveGround`** — the harmony swells at whatever you are actually
 *   about to touch, which on a raised pad is the deck and not the floor 200 metres under it.
 * - **Sub answers depth** — the floor, and then the shaft. It is the one voice that is
 *   simply absent for most of a flight, which is what makes arriving underground an event
 *   rather than a trend.
 */
export function layerMix(at: Sounding): LayerMix {
  const air = AIR_FLOOR + (1 - AIR_FLOOR) * clamp01(at.altitude / CANYON.RIM_Y);

  // `Infinity` over open sky, and `clamp01` of that is 1 — so an unmeasurable drop reads
  // as "nothing near", which is exactly the sky value.
  const closing = 1 - clamp01(
    (at.heightAboveGround - LANDER.GEAR_DEPLOY_HEIGHT) / (BODY_REACH - LANDER.GEAR_DEPLOY_HEIGHT),
  );
  const body = BODY_SKY + (1 - BODY_SKY) * closing;

  // Two stages end to end, not two candidates. `Math.max` of the pair was the first
  // attempt and it plateaus: the approach already reads `SUB_AT_FLOOR` when the floor
  // arrives, so the whole top half of a shaft added nothing and the sub simply sat still
  // through the part of the descent it exists to describe. The shaft picks up the
  // remaining travel instead, which is monotonic all the way down and exactly 1 at the
  // bottom.
  const approach = clamp01((SUB_ONSET - at.altitude) / SUB_ONSET) * SUB_AT_FLOOR;
  const sub = clamp01(approach + (1 - SUB_AT_FLOOR) * clamp01(at.abyssProximity));

  return { sub, body, air };
}

/** What the score does with no vehicle to follow — the menu, a brief. Open sky. */
export const SKY: Sounding = { altitude: Infinity, heightAboveGround: Infinity, abyssProximity: 0 };

/**
 * Drawbar ratios above each voice's own fundamental — a Hammond's registration, minus the
 * 8' the existing oscillator already provides.
 *
 * An organ is not "more notes", it is **more harmonics of the same note** at fixed ratios,
 * which is why adding voices to the triad would only have made a thicker pad. These are
 * the classic footages: 16′, 5⅓′, 4′, 2⅔′, 2′ and 1⅓′.
 *
 * They are added *per voice* and routed into that voice's own layer gain rather than mixed
 * globally, and that is not a detail. The air layer is the tonic an octave up, and a body
 * voice's 4′ partial is the same pitch — mix the partials anywhere but inside the group and
 * the drawbars quietly fill the air register with body, so `layerMix` keeps moving the
 * gains while the altitude stops being audible. Inside the group, a partial rises and falls
 * with the voice it belongs to and the layering survives untouched.
 */
export const DRAWBARS = [0.5, 1.5, 2, 3, 4, 6] as const;

/** Footages, for a panel that wants to look like an organ. */
export const DRAWBAR_LABELS = ['16′', '5⅓′', '4′', '2⅔′', '2′', '1⅓′'] as const;

/**
 * Registration the score ships with — all off.
 *
 * The pad's own character is a lowpassed saw-and-triangle bed, and sine partials on top of
 * it are a different instrument rather than a louder one. Shipping it silent means the
 * game sounds exactly as it did and the choice is made on `synth.html`, by ear, where the
 * headroom can be re-measured before anything changes.
 */
export const DRAWBARS_OFF: readonly number[] = DRAWBARS.map(() => 0);

/** What the score actually opens with. See `VOICING`. */
export const DRAWBARS_DEFAULT: readonly number[] = [0.4, 0.35, 0.2, 0.2, 0.5, 0.2];

/** Which group each of the five pad oscillators belongs to, in voicing order. */
const VOICE_GROUP: readonly (keyof LayerMix)[] = ['sub', 'body', 'body', 'body', 'air'];

/** How loud each pad voice sits: the sub carries, the triad fills, the air colours. */
function voiceWeight(voice: number): number {
  return voice === 0 ? 0.25 : voice === 1 ? 0.2 : 0.14;
}

/**
 * Smoothing on a layer move, as a `setTargetAtTime` time constant.
 *
 * Deliberately slower than the vehicle: a descent can cross the whole range in a couple of
 * seconds, and a mix that tracked it exactly would pump on every correction the player
 * makes rather than describe where they are. About a second to arrive.
 */
const LAYER_GLIDE = 0.35;

/**
 * The score: one five-voice pad, one theme per client, and the mission's own callsign.
 *
 * There was a procedural melody here once — a note every few seconds, pitch and timbre
 * picked at random. That was wrong in a specific way: a randomised line meant a mission
 * never sounded the same twice, in a campaign whose entire foundation is that a retry
 * gives you the identical run.
 *
 * What replaced it keeps the melodic interest and throws away the randomness. The figure
 * is the **mission number in binary**, most significant bit first, one chord tone per set
 * bit and silence per clear one. It is a callsign, which is what a machine would actually
 * transmit, and it makes every mission audibly itself — mission 16 is a single stroke and
 * nothing else, mission 29 — the last delivery the campaign has — spends three bars
 * building before it breaks. Because higher numbers carry more set bits, the ident
 * thickens as the canyon does, which nobody had to author.
 */
export class MusicComposer {
  private ctx: AudioContext | null = null;
  private destination: GainNode | null = null;
  private isMuted = false;

  private ambientGain: GainNode | null = null;
  private ambientOscs: OscillatorNode[] = [];
  private ambientFilter: BiquadFilterNode | null = null;
  private ambientLfo: OscillatorNode | null = null;
  private overtoneGain: GainNode | null = null;
  /**
   * One gain per voice group, between the oscillators and the filter.
   *
   * The pad is voiced `[a−12, a, b, c, a+12]` — a sub, the triad, and air — which was
   * already three groups doing three jobs with no way to move them independently. These
   * are what `setSounding` drives.
   */
  private layerGains: Record<keyof LayerMix, GainNode | null> = { sub: null, body: null, air: null };
  /**
   * Drawbar partials: one oscillator per voice per ratio, each on its own gain.
   *
   * Held flat rather than nested per voice because every use walks all of them — retuning
   * on a chord change, and re-levelling on a registration change — and a flat list with the
   * voice index on it says that more plainly than five arrays would.
   */
  private partials: { osc: OscillatorNode; gain: GainNode; voice: number; ratio: number }[] = [];
  private drawbars: readonly number[] = VOICING.drawbars;
  private isPlaying = false;

  private activeTrack: MusicTrack = 'outpost';
  /**
   * A theme that is not one of the charters', or `null` to use the track's own.
   *
   * The game never sets this — its themes are per-charter and mean something. It exists so
   * `synth.html` can be an instrument rather than a viewer: a key and a progression that no
   * mission plays still has to be auditionable, or harmony cannot be worked out anywhere
   * except by editing `THEMES` and reloading.
   */
  private customTheme: Theme | null = null;
  /** Read back only to sound the ident — the figure *is* this number. */
  private missionId = 1;
  private currentChordIdx = 0;
  private chordTimer: number | null = null;

  /**
   * The live grid. A copy rather than `TEMPO` itself, so `setTempo` cannot edit the
   * default out from under a second composer — `synth.html` runs one beside the game's.
   */
  private tempo: Tempo = { ...TEMPO };

  private wobble = new WobbleBass();
  /** Next bar index not yet handed to the wobble. Negative means "resync to the clock". */
  private nextBar = -1;
  /** Next count not yet struck. Same resync convention as `nextBar`. */
  private nextBeat = -1;

  /**
   * One buffer of white noise, reused by every snare.
   *
   * A `BufferSource` is single-use — it cannot be restarted — so each hit gets its own
   * node, but they can all read the same samples. Generating noise per strike would be
   * hundreds of allocations a minute for a sound nobody can tell apart from this one.
   */
  private noise: AudioBuffer | null = null;
  private percussionLevel = PERCUSSION_LEVEL;
  private percussionNoise = PERCUSSION_NOISE;
  private wobbleLevel = WOBBLE_LEVEL;
  private tomOffset = TOM_OFFSET;

  public get isActive(): boolean {
    return this.isPlaying;
  }

  /**
   * Moves the grid under a running score. The tuning surface `synth.html` drives.
   *
   * Everything downstream is derived from the audio clock rather than counted, so a tempo
   * change needs no transport work beyond dropping the bars already queued at the old
   * bar length — `setValueCurveAtTime` throws on an overlap, and the first bar scheduled
   * on the new grid would land inside one of them.
   */
  public setTempo(next: Partial<Tempo>): void {
    this.tempo = { ...this.tempo, ...next };
    this.dropWobble();
    this.applyCurrentChord();
  }

  public getTempo(): Tempo {
    return { ...this.tempo };
  }

  /**
   * Sets the drawbar registration, one level per ratio in `DRAWBARS`.
   *
   * Scaled by the voice's own weight so a registration does not change the pad's internal
   * balance — the sub is loudest, the triad quietest, and drawbars ride that rather than
   * flattening it.
   */
  public setDrawbars(levels: readonly number[]): void {
    this.drawbars = levels;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const p of this.partials) {
      const level = (levels[DRAWBARS.indexOf(p.ratio as (typeof DRAWBARS)[number])] ?? 0) * voiceWeight(p.voice);
      p.gain.gain.setTargetAtTime(level, now, 0.08);
    }
  }

  public getDrawbars(): readonly number[] {
    return this.drawbars;
  }

  /** Kit level, 0 to silence it. The bench's mix knob. */
  public setPercussionLevel(level: number): void {
    this.percussionLevel = Math.max(0, level);
  }

  /** How much noise is on the high drum: 0 a bare tom, 1 about a snare. */
  public setPercussionNoise(noise: number): void {
    this.percussionNoise = Math.min(1, Math.max(0, noise));
  }

  /** Wobble-bass gate height. 0 removes the bass entirely. */
  public setWobbleLevel(level: number): void {
    this.wobbleLevel = Math.max(0, level);
  }

  /** Where the tom sits after its kick, as a fraction of a count. 0.5 is the and. */
  public setTomOffset(offset: number): void {
    this.tomOffset = Math.min(0.9, Math.max(0, offset));
  }

  /** Applies a charter's tone over the campaign default. */
  public applyVoicing(voice: Partial<Voicing> | undefined): void {
    const v = { ...VOICING, ...voice };
    this.setDrawbars(v.drawbars);
    this.setPercussionLevel(v.percussionLevel);
    this.setPercussionNoise(v.percussionNoise);
    this.setTomOffset(v.tomOffset);
    this.setWobbleLevel(v.wobbleLevel);
  }

  /** Plays an arbitrary key and progression; `null` hands the score back to its track. */
  public setTheme(theme: Theme | null): void {
    this.customTheme = theme;
    this.applyCurrentChord();
  }

  /** The theme actually sounding. */
  public theme(): Theme {
    return this.customTheme ?? THEMES[this.activeTrack] ?? THEMES.outpost;
  }

  /**
   * Follows the vehicle down the canyon: air out of the sky, body onto the ground, sub
   * into the hole.
   *
   * Safe to call every frame — `setTargetAtTime` is a running target rather than a
   * scheduled event, so nothing accumulates on the timeline and there is no queue to
   * outrun. `LAYER_GLIDE` is the whole smoothing; the caller passes raw position.
   *
   * This is a *mix*, not a pose, so it does not owe `missionTime` anything: it is a
   * function of where the vehicle is, and a replay puts the vehicle in the same places.
   */
  public setSounding(at: Sounding): void {
    if (!this.ctx) return;
    const mix = layerMix(at);
    const now = this.ctx.currentTime;
    for (const group of ['sub', 'body', 'air'] as (keyof LayerMix)[]) {
      this.layerGains[group]?.gain.setTargetAtTime(mix[group], now, LAYER_GLIDE);
    }
  }

  public init(ctx: AudioContext, destination: GainNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.destination = destination;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0;

    this.ambientFilter = this.ctx.createBiquadFilter();
    this.ambientFilter.type = 'lowpass';
    this.ambientFilter.frequency.value = 550;
    this.ambientFilter.Q.value = 1.2;

    // Filter LFO (16-second cycle)
    this.ambientLfo = this.ctx.createOscillator();
    this.ambientLfo.frequency.value = 0.06;
    const filterLfoGain = this.ctx.createGain();
    filterLfoGain.gain.value = 250;
    this.ambientLfo.connect(filterLfoGain);
    filterLfoGain.connect(this.ambientFilter.frequency);
    this.ambientLfo.start();

    // High Overtone Gain Layer
    this.overtoneGain = this.ctx.createGain();
    this.overtoneGain.gain.value = 0.04;
    this.overtoneGain.connect(this.ambientFilter);

    // Opened at the sky mix rather than at 1, so a score that starts before anything is
    // flying starts where a descent starts instead of jumping on the first frame.
    const opening = layerMix(SKY);
    for (const group of ['sub', 'body', 'air'] as (keyof LayerMix)[]) {
      const gain = this.ctx.createGain();
      gain.gain.value = opening[group];
      gain.connect(this.ambientFilter);
      this.layerGains[group] = gain;
    }

    // 5-Voice Synth Pad Array. Index picks the group: the octave below is the sub, the
    // octave above is air, the triad between them is the body.
    for (let i = 0; i < 5; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = i < 2 ? 'triangle' : 'sawtooth';
      osc.frequency.value = 100;
      osc.detune.value = (Math.random() * 2 - 1) * 10;

      const oscGain = this.ctx.createGain();
      oscGain.gain.value = voiceWeight(i);

      osc.connect(oscGain);
      oscGain.connect(this.layerGains[VOICE_GROUP[i]]!);
      osc.start();
      this.ambientOscs.push(osc);

      // Sines, because a drawbar *is* a sine — the timbre is the sum of the ratios, not
      // the shape of any one of them. Running silently until a registration is set.
      for (const ratio of DRAWBARS) {
        const partial = this.ctx.createOscillator();
        partial.type = 'sine';
        partial.frequency.value = 100 * ratio;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        partial.connect(gain);
        gain.connect(this.layerGains[VOICE_GROUP[i]]!);
        partial.start();
        this.partials.push({ osc: partial, gain, voice: i, ratio });
      }
    }

    this.ambientFilter.connect(this.ambientGain);
    this.ambientGain.connect(this.destination);

    // Its own path to the bus, not through `ambientGain`. The pad's level is a slow fade
    // used for starting and stopping; the wobble needs its gate scheduled to the
    // millisecond and must not have a 0.4-second envelope in front of it.
    this.wobble.init(this.ctx, this.destination);

    const frames = Math.floor(this.ctx.sampleRate * 0.4);
    this.noise = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < frames; i++) samples[i] = Math.random() * 2 - 1;

    /**
     * Which step is live is *derived* from the audio clock rather than counted by the
     * timer, and the timer only exists to sample it. A counter driven by `setInterval`
     * drifts and — worse — is throttled in a background tab, so a player who alts away
     * for a minute comes back to a progression that has silently fallen behind. This
     * cannot: whatever the tab did, the chord is a pure function of elapsed audio time.
     */
    this.chordTimer = window.setInterval(() => this.followClock(), 500);
  }

  /** Snaps to whichever step the audio clock says should be sounding. */
  private followClock(): void {
    if (!this.ctx) return;
    this.scheduleWobble();
    this.schedulePercussion();
    const idx = Math.floor(this.ctx.currentTime / stepSeconds(this.tempo)) % 4;
    if (idx === this.currentChordIdx) return;
    this.currentChordIdx = idx;
    this.applyCurrentChord();
    // Once per cycle, at the top — 28 seconds apart, so it reads as a station identifying
    // itself rather than as a hook. Closer together than the old 42 and now sounding every
    // bit rather than only the set ones, which is the point: a callsign heard once a run is
    // atmosphere, and one heard at the top of every cycle is a number the player can learn.
  }

  /**
   * Hands the wobble every bar starting inside the lookahead.
   *
   * The cursor is checked against the clock rather than trusted, for the reason
   * `followClock` exists at all: a backgrounded tab throttles this timer, and a cursor
   * that merely counted would come back owing several bars and try to schedule them all
   * in the past. Falling behind resyncs instead — the pattern is a function of the bar
   * index, so skipping forward lands exactly where an uninterrupted tab would be.
   */
  /**
   * A kick, tuned to the key.
   *
   * A drop rather than a fixed pitch: the sine falls two octaves onto the tonic over 55 ms,
   * which is what makes a sine read as a struck drum instead of a low beep. Landing *on*
   * the tonic rather than near it keeps it inside the harmony — the pad's sub is the same
   * note an octave down, so the kick reinforces the key rather than fighting whatever chord
   * is live.
   */
  private kick(at: number, root: number, level: number): void {
    if (!this.ctx || !this.destination) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(root * 4, at);
    osc.frequency.exponentialRampToValueAtTime(root, at + 0.055);

    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0004, at + 0.22);

    osc.connect(gain);
    gain.connect(this.destination);
    osc.start(at);
    osc.stop(at + 0.24);
  }

  /**
   * A tom: a pitched membrane, with as much stick or wire on it as `noise` asks for.
   *
   * The same shape as the kick — a pitch drop onto a target, which is what makes a sine
   * read as a struck head rather than a beep — an octave and a fifth higher and ringing
   * longer, because a smaller head is brighter and a tom is *supposed* to ring. It stops
   * short of the next count all the same: a hit still sounding when the following one
   * lands smears the number, and the number is the point.
   */
  private tom(at: number, root: number, level: number, noise: number): void {
    if (!this.ctx || !this.destination || !this.noise) return;
    const target = semitone(root, TOM_INTERVAL);

    const head = this.ctx.createOscillator();
    const headGain = this.ctx.createGain();
    head.type = 'sine';
    head.frequency.setValueAtTime(target * 2, at);
    head.frequency.exponentialRampToValueAtTime(target, at + 0.045);
    // A snare is shorter as well as noisier, so the ring shortens as the knob comes up.
    const ring = 0.3 - 0.16 * noise;
    headGain.gain.setValueAtTime(0, at);
    headGain.gain.linearRampToValueAtTime(level, at + 0.003);
    headGain.gain.exponentialRampToValueAtTime(0.0004, at + ring);
    head.connect(headGain);
    headGain.connect(this.destination);
    head.start(at);
    head.stop(at + ring + 0.02);

    // At 0 this is the stick landing on the head — brief, and only there so the attack has
    // an edge to it. Wound all the way up it is the wires.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1500 + 500 * noise;
    band.Q.value = 0.9;
    const rattle = this.ctx.createGain();
    const decay = 0.02 + 0.12 * noise;
    rattle.gain.setValueAtTime(0, at);
    rattle.gain.linearRampToValueAtTime(level * (0.12 + 0.75 * noise), at + 0.002);
    rattle.gain.exponentialRampToValueAtTime(0.0004, at + decay);
    src.connect(band);
    band.connect(rattle);
    rattle.connect(this.destination);
    src.start(at);
    src.stop(at + decay + 0.02);
  }

  /**
   * Strikes every count inside the lookahead.
   *
   * Same discipline as `scheduleWobble` and for the same reason: the cursor is checked
   * against the clock rather than trusted, so a throttled tab resyncs forward instead of
   * trying to schedule a minute of drums in the past. The pattern is a pure function of the
   * count index, so skipping lands exactly where an uninterrupted tab would be.
   */
  private schedulePercussion(): void {
    if (!this.ctx || !this.isPlaying || this.isMuted || this.percussionLevel <= 0) return;
    const now = this.ctx.currentTime;
    const beat = beatSeconds(this.tempo);
    const current = Math.floor(now / beat);
    if (this.nextBeat < current) this.nextBeat = current + 1;

    const root = this.theme().root;
    while (this.nextBeat * beat < now + LOOKAHEAD) {
      const at = this.nextBeat * beat;
      // The kick is the clock and lands on every count, set bit or not.
      this.kick(at, root, this.percussionLevel);
      if (identStrike(this.missionId, this.nextBeat) === 'tom') {
        this.tom(at + beat * this.tomOffset, root, this.percussionLevel * 0.7, this.percussionNoise);
      }
      this.nextBeat++;
    }
  }

  private scheduleWobble(): void {
    if (!this.ctx || !this.isPlaying || this.isMuted || this.wobbleLevel <= 0) return;
    const now = this.ctx.currentTime;
    const bar = barSeconds(this.tempo);
    const step = stepSeconds(this.tempo);
    const current = Math.floor(now / bar);
    if (this.nextBar < current) this.nextBar = current + 1;

    const theme = this.theme();
    while (this.nextBar * bar < now + LOOKAHEAD) {
      const at = this.nextBar * bar;
      const slot = wobbleBar(this.missionId, this.nextBar);
      if (slot) {
        // The chord is read from the bar's own start time, not from `currentChordIdx`.
        // Scheduling runs ahead of the clock, so the step can turn over inside the
        // lookahead and the bass would otherwise spend a bar under the wrong harmony.
        const chord = theme.progression[Math.floor(at / step) % 4];
        const freq = semitone(theme.root, chord[0] + slot.offset);
        this.wobble.scheduleBar(at, bar, freq, slot.cycles, slot.skew, this.wobbleLevel);
      }
      this.nextBar++;
    }
  }

  /**
   * A weak, detuned mission-1 ident, caught on the way down in the epilogue.
   *
   * The score has been transmitting the mission number as a five-bit word all campaign,
   * and because the numbers grow, the figure has been thickening the whole way: mission 1
   * is `00001` — four rests and one stroke, the sparsest thing this system can say — and
   * mission 29, the last one, is `11101`. The player has heard the dense end of that for
   * ten missions when this arrives.
   *
   * What is transmitting is deliberately undecidable, and it is undecidable *because the
   * two candidates make the same sound*: the relay landed in mission 1, above the blast
   * and still running because nothing told it to stop, or the carrier falling past you on
   * its own first mission. No line of dialogue can collapse that, and none is offered —
   * see `SOURCE UNRESOLVED` on the status line.
   *
   * Detuned rather than merely quiet. On pitch it joins the chord and becomes part of the
   * score, which is the one thing it must not be: this is a machine transmitting into a
   * canyon with nothing left in it, not a voice in the music. Twenty-odd cents flat is
   * enough to sit outside the harmony without reading as a tuning fault.
   */
  public emitDistantIdent(repeats = 4): void {
    if (!this.ctx || !this.destination || this.isMuted || !this.isPlaying) return;

    const theme = this.theme();
    const chord = theme.progression[this.currentChordIdx];
    const start = this.ctx.currentTime + 0.3;
    const bit = identBitSeconds(this.tempo);
    const word = IDENT_BITS * bit;

    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < IDENT_BITS; i++) {
        // The ident of mission 1, not of the mission that was just flown.
        if (((DISTANT_IDENT >> (IDENT_BITS - 1 - i)) & 1) === 0) continue;

        const at = start + r * word + i * bit;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(semitone(theme.root, chord[i % 3] + 24), at);
        osc.detune.setValueAtTime(-22, at);

        // Fades across the repeats rather than holding level: the vehicle carrying the
        // receiver is falling, and a beacon it is falling away from does not stay put.
        const peak = 0.016 * (1 - r / (repeats + 1));
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(peak, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0003, at + 0.55);

        osc.connect(gain);
        gain.connect(this.destination);
        osc.start(at);
        osc.stop(at + 0.6);
      }
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.isPlaying && this.ambientGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : 0.38;
      this.ambientGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.2);
    }
    if (muted) this.dropWobble();
  }

  /**
   * Silences the wobble and forgets the cursor.
   *
   * Both halves are required. Dropping the gate leaves bars already on the timeline, and
   * the first curve scheduled after a restart would overlap one of them —
   * `setValueCurveAtTime` throws on that, which would take the whole score down rather
   * than glitch it.
   */
  private dropWobble(): void {
    if (this.ctx) this.wobble.silence(this.ctx.currentTime);
    this.nextBar = -1;
    // Drums already on the timeline play out — they are one-shot nodes and cannot be
    // recalled — but the cursor must not carry a stale grid across a tempo change.
    this.nextBeat = -1;
  }

  public setMissionContext(track: MusicTrack, missionId: number): void {
    this.activeTrack = track;
    // A charter's tone follows its harmony. Applied here rather than in `setTheme`, which
    // `synth.html` drives: on the bench the sliders are the authority, and a theme change
    // that snapped them back would make the thing uneditable.
    this.applyVoicing(THEMES[track]?.voice);
    this.missionId = missionId;
    this.currentChordIdx = 0;
    // Bars for the outgoing mission may already be queued a second ahead. Drop them, or
    // the new callsign arrives over the tail of the old one's groove.
    this.dropWobble();

    if (this.ctx && this.ambientFilter) {
      const progress = Math.min(1, Math.max(0, (missionId - 1) / 29));
      const targetFilterFreq = 450 + progress * 500;
      this.ambientFilter.frequency.setTargetAtTime(targetFilterFreq, this.ctx.currentTime, 1.0);

      if (this.overtoneGain) {
        this.overtoneGain.gain.setTargetAtTime(0.04 + progress * 0.12, this.ctx.currentTime, 1.0);
      }
    }

    this.applyCurrentChord();
  }

  /**
   * Voices the live step across the five oscillators: the triad, with the tonic doubled
   * an octave below as a sub and an octave above as air. Absolute frequencies are built
   * from the theme's root rather than tabulated, so a progression is written as degrees
   * — `V ii IV I` — and stays readable as the thing it actually is.
   */
  private applyCurrentChord(): void {
    if (!this.ctx || this.ambientOscs.length < 5) return;
    const theme = this.theme();
    const [a, b, c] = theme.progression[this.currentChordIdx];
    const voicing = [a - 12, a, b, c, a + 12];

    const now = this.ctx.currentTime;
    const glideTime = glide(this.tempo);
    voicing.forEach((semitones, idx) => {
      this.ambientOscs[idx]?.frequency.setTargetAtTime(
        semitone(theme.root, semitones),
        now,
        glideTime,
      );
    });
    // Partials follow their own voice, on the same glide — a drawbar that did not move
    // with the chord would be a drone sitting under a progression.
    for (const p of this.partials) {
      p.osc.frequency.setTargetAtTime(
        semitone(theme.root, voicing[p.voice]) * p.ratio,
        now,
        glideTime,
      );
    }
  }



  public start(): void {
    this.isPlaying = true;
    if (!this.ctx || !this.ambientGain || this.isMuted) return;
    // `stop` tears the timer down, and until the wobble arrived nothing put it back — the
    // progression simply stopped advancing after the first stop/start. Nothing called
    // `stopAmbient` yet, so it never showed; the wobble's scheduler rides the same timer
    // and would have inherited the same latent bug.
    if (this.chordTimer === null) {
      this.chordTimer = window.setInterval(() => this.followClock(), 500);
    }
    const now = this.ctx.currentTime;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
    this.ambientGain.gain.setTargetAtTime(0.38, now, 0.4);
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.chordTimer !== null) {
      window.clearInterval(this.chordTimer);
      this.chordTimer = null;
    }
    this.dropWobble();
    if (!this.ctx || !this.ambientGain) return;
    const now = this.ctx.currentTime;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
    this.ambientGain.gain.setTargetAtTime(0, now, 0.4);
  }
}
