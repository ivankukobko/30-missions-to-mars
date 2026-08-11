import type { CorpId } from '../world/CanyonSpec.ts';

interface FactionChord {
  freqs: [number, number, number, number, number];
}

/**
 * Unique procedural chord progressions for each corporate faction:
 * - Ixion Outpost: Melancholic, open, scientific C minor -> Eb -> Ab -> Fm
 * - Helion Extraction: High-tech, expansive D Dorian / Dm9 -> G/D -> Bbmaj7 -> A7sus
 * - Kessler Deep: Heavy industrial, deep subterranean F# minor -> C#m -> Bm -> D/F#
 */
const FACTION_PROGRESSIONS: Record<CorpId, FactionChord[]> = {
  outpost: [
    { freqs: [32.70, 65.41, 98.00, 155.56, 196.00] }, // Cm
    { freqs: [38.89, 77.78, 116.54, 155.56, 233.08] }, // Eb
    { freqs: [51.91, 103.83, 155.56, 207.65, 261.63] }, // Ab
    { freqs: [43.65, 87.31, 130.81, 174.61, 261.63] }, // Fm
  ],
  helion: [
    { freqs: [36.71, 73.42, 110.00, 174.61, 261.63] }, // Dm9
    { freqs: [36.71, 73.42, 123.47, 146.83, 246.94] }, // G/D
    { freqs: [58.27, 116.54, 146.83, 220.00, 261.63] }, // Bbmaj7
    { freqs: [55.00, 110.00, 174.61, 220.00, 293.66] }, // A7sus
  ],
  kessler: [
    { freqs: [46.25, 92.50, 138.59, 185.00, 277.18] }, // F#m
    { freqs: [34.65, 69.30, 103.83, 164.81, 277.18] }, // C#m
    { freqs: [30.87, 61.74, 92.50, 146.83, 246.94] }, // Bm
    { freqs: [46.25, 92.50, 146.83, 220.00, 293.66] }, // D/F#
  ],
};

/**
 * Procedural Music Composer
 *
 * Generates faction-specific synth pad chord progressions, campaign overtone evolution,
 * and procedural sci-fi arpeggiated melodies.
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
  private missionId = 1;
  private currentChordIdx = 0;
  private chordTimer: number | null = null;
  private melodyTimer: number | null = null;

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

    // Start Chord Progression Timer (Cycles chord every 10 seconds)
    this.chordTimer = window.setInterval(() => {
      this.currentChordIdx = (this.currentChordIdx + 1) % 4;
      this.applyCurrentChord();
    }, 10000);

    // Start Procedural Sci-Fi Melody Loop
    this.scheduleMelodyLoop();
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
    this.scheduleMelodyLoop();
  }

  private applyCurrentChord(): void {
    if (!this.ctx || this.ambientOscs.length < 5) return;
    const progression = FACTION_PROGRESSIONS[this.activeCorp] || FACTION_PROGRESSIONS.outpost;
    const chord = progression[this.currentChordIdx];

    const now = this.ctx.currentTime;
    chord.freqs.forEach((freq, idx) => {
      if (this.ambientOscs[idx]) {
        this.ambientOscs[idx].frequency.setTargetAtTime(freq, now, 1.6);
      }
    });
  }

  private scheduleMelodyLoop(): void {
    if (this.melodyTimer !== null) window.clearInterval(this.melodyTimer);

    const progress = Math.min(1, Math.max(0, (this.missionId - 1) / 29));
    const intervalMs = Math.max(2200, 4500 - progress * 2300);

    this.melodyTimer = window.setInterval(() => {
      if (!this.isPlaying || this.isMuted || !this.ctx) return;
      this.triggerMelodyNote(progress);
    }, intervalMs);
  }

  private triggerMelodyNote(progress: number): void {
    if (!this.ctx || !this.destination) return;
    const now = this.ctx.currentTime;

    const progression = FACTION_PROGRESSIONS[this.activeCorp] || FACTION_PROGRESSIONS.outpost;
    const currentChord = progression[this.currentChordIdx];

    const baseFreq = currentChord.freqs[2 + Math.floor(Math.random() * 3)];
    const octaveMult = Math.random() > 0.4 ? 2 : 4;
    const freq = baseFreq * octaveMult;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = Math.random() > 0.3 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    const gainVal = 0.02 + progress * 0.05;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 1.8);

    osc.connect(gain);
    gain.connect(this.destination);

    osc.start(now);
    osc.stop(now + 1.85);
  }

  public start(): void {
    this.isPlaying = true;
    if (!this.ctx || !this.ambientGain || this.isMuted) return;
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
    if (this.melodyTimer !== null) {
      window.clearInterval(this.melodyTimer);
      this.melodyTimer = null;
    }
    if (!this.ctx || !this.ambientGain) return;
    const now = this.ctx.currentTime;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
    this.ambientGain.gain.setTargetAtTime(0, now, 0.4);
  }
}
