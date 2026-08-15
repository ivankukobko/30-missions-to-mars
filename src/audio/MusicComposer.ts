import type { CorpId } from '../world/CanyonSpec.ts';
import { WobbleBass } from './WobbleBass.ts';

/** A triad as semitone offsets from the key's tonic. */
type Chord = readonly [number, number, number];

const I: Chord = [0, 4, 7];
const iii: Chord = [4, 7, 11];
const IV: Chord = [5, 9, 12];
const iv: Chord = [5, 8, 12];

interface Theme {
  /** Tonic, in Hz. Low: these are pads, and the triad is voiced above it. */
  root: number;
  /** Four steps, held in turn. Deliberately mostly tonic — see below. */
  progression: readonly [Chord, Chord, Chord, Chord];
}

/**
 * A theme per client, and each is one chord plus a single step away from it.
 *
 * Four-chord progressions cycling every ten seconds are a *song*, and a song is the
 * wrong thing to put under a game where the interesting sound is your own engine and the
 * loudest event is silence before touchdown. Each of these sits on the tonic and makes
 * one move, so the harmony reads as weather rather than as music with opinions.
 *
 * The step is chosen to say something about who is talking:
 *
 * - **Ixion — I I iii I.** Two bars of not moving, then the mediant: a minor chord
 *   inside a major key, which lifts and saddens at once. They are not going anywhere
 *   and they know it.
 * - **Helion — I IV I IV.** Plagal, out and back, out and back. No tension and no
 *   arrival — the sound of lateral expansion that never has to resolve anywhere.
 * - **Kessler — I iv iv I.** The minor subdominant, borrowed from the parallel minor
 *   and held for two steps. It is the darkest move available without changing key, and
 *   it is the one that sounds like going down.
 */
const THEMES: Record<CorpId, Theme> = {
  outpost: { root: 55.0, progression: [I, I, iii, I] }, // A
  helion: { root: 61.74, progression: [I, IV, I, IV] }, // B
  kessler: { root: 46.25, progression: [I, iv, iv, I] }, // F#
};

/** Semitones above a root, in Hz. */
function step(root: number, semitones: number): number {
  return root * Math.pow(2, semitones / 12);
}

/**
 * How long one step is held, so a full cycle runs about forty seconds. Slow enough that
 * a change reads as an event rather than a beat, quick enough that a run which goes
 * badly is not spent entirely on one chord.
 */
const STEP_SECONDS = 10.5;

/**
 * Glide between steps, as a `setTargetAtTime` time constant — so the move is about
 * three times this before it has effectively arrived. At 0.7 that is roughly two
 * seconds against a ten-second step: quick enough to land as a change, slow enough that
 * it is still a slide rather than a cut. The earlier 1.9 took most of six seconds and
 * the chord spent more of its life arriving than being itself.
 */
const GLIDE = 0.7;

/**
 * Bits in a mission ident. Thirty missions need five, and `11110` is the last one.
 */
const IDENT_BITS = 5;
/** Time per bit. Quick — this is a machine transmitting, not a phrase being played. */
const IDENT_BIT = 0.26;

/**
 * One bar per ident bit, so the word fills exactly one chord step: 2.1 seconds, about
 * 114 BPM in four.
 *
 * A five-bar phrase against a four-step progression is deliberate. The two cycle together
 * only every twenty bars, so the groove never sits square against the harmony — which is
 * the difference between a machine transmitting on a schedule and a song with a chorus.
 */
const BAR_SECONDS = STEP_SECONDS / IDENT_BITS;

/**
 * Sweeps per bar for the nth consecutive set bit: 1/4, 1/8, 1/8 triplet, 1/16.
 *
 * The ident is one bit per bar, which is on or off and cannot by itself pick a rate. The
 * *run length* can, and it is already sitting there in the number. Each consecutive set
 * bit ratchets one division faster, so mission 30 — `11110` — is four bars accelerating
 * into a bar of silence, and mission 16 — `10000` — is one slow stroke and four bars of
 * nothing. The build and the drop come out of the mission number; nobody authored thirty
 * patterns and nobody can get them out of sync with the campaign.
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
 *  surface and has to stay the loudest thing the player is steering by. */
const WOBBLE_LEVEL = 0.11;

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
 * nothing else, mission 30 is four and a rest. Because higher numbers carry more set bits,
 * the ident thickens as the canyon does, which nobody had to author.
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
  private isPlaying = false;

  private activeCorp: CorpId = 'outpost';
  /** Read back only to sound the ident — the figure *is* this number. */
  private missionId = 1;
  private currentChordIdx = 0;
  private chordTimer: number | null = null;

  private wobble = new WobbleBass();
  /** Next bar index not yet handed to the wobble. Negative means "resync to the clock". */
  private nextBar = -1;

  public get isActive(): boolean {
    return this.isPlaying;
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

    // 5-Voice Synth Pad Array
    for (let i = 0; i < 5; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = i < 2 ? 'triangle' : 'sawtooth';
      osc.frequency.value = 100;
      osc.detune.value = (Math.random() * 2 - 1) * 10;

      const oscGain = this.ctx.createGain();
      oscGain.gain.value = i === 0 ? 0.25 : i === 1 ? 0.20 : 0.14;

      osc.connect(oscGain);
      oscGain.connect(this.ambientFilter);
      osc.start();
      this.ambientOscs.push(osc);
    }

    this.ambientFilter.connect(this.ambientGain);
    this.ambientGain.connect(this.destination);

    // Its own path to the bus, not through `ambientGain`. The pad's level is a slow fade
    // used for starting and stopping; the wobble needs its gate scheduled to the
    // millisecond and must not have a 0.4-second envelope in front of it.
    this.wobble.init(this.ctx, this.destination);

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
    const idx = Math.floor(this.ctx.currentTime / STEP_SECONDS) % 4;
    if (idx === this.currentChordIdx) return;
    this.currentChordIdx = idx;
    this.applyCurrentChord();
    // Once per cycle, at the top. Roughly forty seconds apart, so it reads as a station
    // identifying itself rather than as a hook.
    if (idx === 0) this.emitIdent();
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
  private scheduleWobble(): void {
    if (!this.ctx || !this.isPlaying || this.isMuted) return;
    const now = this.ctx.currentTime;
    const current = Math.floor(now / BAR_SECONDS);
    if (this.nextBar < current) this.nextBar = current + 1;

    const theme = THEMES[this.activeCorp] ?? THEMES.outpost;
    while (this.nextBar * BAR_SECONDS < now + LOOKAHEAD) {
      const at = this.nextBar * BAR_SECONDS;
      const bar = wobbleBar(this.missionId, this.nextBar);
      if (bar) {
        // The chord is read from the bar's own start time, not from `currentChordIdx`.
        // Scheduling runs ahead of the clock, so the step can turn over inside the
        // lookahead and the bass would otherwise spend a bar under the wrong harmony.
        const chord = theme.progression[Math.floor(at / STEP_SECONDS) % 4];
        const freq = step(theme.root, chord[0] + bar.offset);
        this.wobble.scheduleBar(at, BAR_SECONDS, freq, bar.cycles, bar.skew, WOBBLE_LEVEL);
      }
      this.nextBar++;
    }
  }

  /**
   * Sounds the mission number, most significant bit first: a chord tone for a set bit,
   * silence for a clear one.
   *
   * Pitches come from the live chord, so the figure is consonant whatever step it lands
   * on and never has to know what key it is in. It climbs an octave halfway through so
   * five even strokes do not read as a flat line, and every note is scheduled at an
   * absolute time off the audio clock — no timers, nothing to drift.
   */
  private emitIdent(): void {
    if (!this.ctx || !this.destination || this.isMuted || !this.isPlaying) return;

    const theme = THEMES[this.activeCorp] ?? THEMES.outpost;
    const chord = theme.progression[this.currentChordIdx];
    const start = this.ctx.currentTime + 0.4;

    for (let i = 0; i < IDENT_BITS; i++) {
      // MSB first, so the figure reads left to right the way the number is written.
      const bit = (this.missionId >> (IDENT_BITS - 1 - i)) & 1;
      if (!bit) continue;

      const at = start + i * IDENT_BIT;
      const semitones = chord[i % 3] + 24 + (i >= 3 ? 12 : 0);

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(step(theme.root, semitones), at);

      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.045, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0004, at + 0.42);

      osc.connect(gain);
      gain.connect(this.destination);
      osc.start(at);
      osc.stop(at + 0.45);
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
  }

  public setMissionContext(corp: CorpId, missionId: number): void {
    this.activeCorp = corp;
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
    // Sound the new callsign immediately rather than waiting out a cycle — this is the
    // moment the mission identifies itself.
    this.emitIdent();
  }

  /**
   * Voices the live step across the five oscillators: the triad, with the tonic doubled
   * an octave below as a sub and an octave above as air. Absolute frequencies are built
   * from the theme's root rather than tabulated, so a progression is written as degrees
   * — `I iv iv I` — and stays readable as the thing it actually is.
   */
  private applyCurrentChord(): void {
    if (!this.ctx || this.ambientOscs.length < 5) return;
    const theme = THEMES[this.activeCorp] ?? THEMES.outpost;
    const [a, b, c] = theme.progression[this.currentChordIdx];
    const voicing = [a - 12, a, b, c, a + 12];

    const now = this.ctx.currentTime;
    voicing.forEach((semitones, idx) => {
      this.ambientOscs[idx]?.frequency.setTargetAtTime(
        step(theme.root, semitones),
        now,
        GLIDE,
      );
    });
  }



  public start(): void {
    // Edge-triggered, so the callsign lands once as the mission opens rather than again
    // on every resume. It matters on a cold load: the context does not exist until the
    // player's first gesture, so `setMissionContext` has nothing to sound through and
    // this is the first moment the ident can actually be heard.
    const wasSilent = !this.isPlaying;
    this.isPlaying = true;
    if (!this.ctx || !this.ambientGain || this.isMuted) return;
    // `stop` tears the timer down, and until the wobble arrived nothing put it back — the
    // progression simply stopped advancing after the first stop/start. Nothing called
    // `stopAmbient` yet, so it never showed; the wobble's scheduler rides the same timer
    // and would have inherited the same latent bug.
    if (this.chordTimer === null) {
      this.chordTimer = window.setInterval(() => this.followClock(), 500);
    }
    if (wasSilent) this.emitIdent();
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
