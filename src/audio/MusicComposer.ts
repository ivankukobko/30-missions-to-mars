import type { CorpId } from '../world/CanyonSpec.ts';

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
    const idx = Math.floor(this.ctx.currentTime / STEP_SECONDS) % 4;
    if (idx === this.currentChordIdx) return;
    this.currentChordIdx = idx;
    this.applyCurrentChord();
    // Once per cycle, at the top. Roughly forty seconds apart, so it reads as a station
    // identifying itself rather than as a hook.
    if (idx === 0) this.emitIdent();
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
  }

  public setMissionContext(corp: CorpId, missionId: number): void {
    this.activeCorp = corp;
    this.missionId = missionId;
    this.currentChordIdx = 0;

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
    if (!this.ctx || !this.ambientGain) return;
    const now = this.ctx.currentTime;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
    this.ambientGain.gain.setTargetAtTime(0, now, 0.4);
  }
}
