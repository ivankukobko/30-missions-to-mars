import { MusicComposer, type MusicTrack } from './MusicComposer.ts';
import { SoundSynthesizer } from './SoundSynthesizer.ts';

/** Master level when not muted. */
const LEVEL = 0.5;

/** Seconds for a mute to take effect. Long enough not to click, short enough to feel
 *  like a switch rather than a fade. */
const MUTE_RAMP = 0.05;

/**
 * Main Procedural Audio Manager / Facade for 30 Missions to Mars.
 *
 * Coordinates AudioContext lifecycle, master volume gain, and muting,
 * while delegating sound effects to SoundSynthesizer and music to MusicComposer.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /**
   * Music and effects hang off separate gains rather than sharing the master.
   *
   * They are muted for different reasons and the difference matters. Effects are how the
   * vehicle tells you what it is doing — the engine note is a control surface, and a
   * player who turns it off is usually turning off *everything* because they are in a
   * quiet room. Procedural music is a taste, and someone who dislikes this particular
   * generated score should be able to say so without also giving up the one cue that
   * says an engine is lit.
   *
   * One master over two children, rather than two independent chains, so a future global
   * volume has a single place to live.
   */
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private mutedSfx = false;
  private mutedMusic = false;

  private composer = new MusicComposer();
  private sfx = new SoundSynthesizer();

  public get isAmbientActive(): boolean {
    return this.composer.isActive;
  }

  public get sfxMuted(): boolean {
    return this.mutedSfx;
  }

  public get musicMuted(): boolean {
    return this.mutedMusic;
  }

  /**
   * Lazily initialize or resume AudioContext on user interaction.
   */
  public init(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = LEVEL;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      // Applied rather than defaulted to 1: preferences are restored from the save
      // before the context exists, so whatever was chosen last session has to survive
      // the node being built now.
      this.musicGain.gain.value = this.mutedMusic ? 0 : 1;
      this.sfxGain.gain.value = this.mutedSfx ? 0 : 1;
      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);

      this.sfx.init(this.ctx, this.sfxGain);
      this.composer.init(this.ctx, this.musicGain);
      this.composer.setMuted(this.mutedMusic);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    if (this.composer.isActive) {
      this.composer.start();
    }
  }

  private ramp(node: GainNode | null, on: boolean): void {
    if (node && this.ctx) {
      node.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, MUTE_RAMP);
    }
  }

  /**
   * Restores what the player chose last time, before any audio node exists.
   *
   * Called from the save on startup, so it has to be safe with no context: `init` reads
   * these flags back when it builds the gains.
   */
  public applyPreferences(prefs: { sfx: boolean; music: boolean }): void {
    this.mutedSfx = prefs.sfx;
    this.mutedMusic = prefs.music;
    this.ramp(this.sfxGain, !this.mutedSfx);
    this.ramp(this.musicGain, !this.mutedMusic);
    this.composer.setMuted(this.mutedMusic);
  }

  public setSfxMuted(muted: boolean): void {
    this.mutedSfx = muted;
    this.ramp(this.sfxGain, !muted);
  }

  /**
   * Muted music is also *stopped*, not merely silenced.
   *
   * The composer schedules ahead on its own timers, and a silenced-but-running score
   * keeps that work going for a player who has said they do not want it. `setMuted` is
   * what tells it to stand down; the gain is belt and braces for anything already in
   * flight when the switch is thrown.
   */
  public setMusicMuted(muted: boolean): void {
    this.mutedMusic = muted;
    this.ramp(this.musicGain, !muted);
    this.composer.setMuted(muted);
    if (!muted && this.ctx) this.composer.start();
  }

  // ------------------------------------------------------------------------- MUSIC DELEGATION

  public setMissionContext(track: MusicTrack, missionId: number): void {
    this.composer.setMissionContext(track, missionId);
  }

  /** No-op with music muted: a mission load must not restart a score the player turned
   *  off, and every mission load calls this. */
  public startAmbient(): void {
    if (this.mutedMusic) return;
    this.init();
    this.composer.start();
  }

  public stopAmbient(): void {
    this.composer.stop();
  }

  // ------------------------------------------------------------------------- SFX DELEGATION

  public playUiBeep(freq = 800, type: OscillatorType = 'sine', duration = 0.04): void {
    if (this.mutedSfx) return;
    this.init();
    this.sfx.playUiBeep(freq, type, duration);
  }

  public playTeletype(): void {
    if (this.mutedSfx) return;
    this.sfx.playTeletype();
  }

  public playLaunch(): void {
    if (this.mutedSfx) return;
    this.sfx.playLaunch();
  }

  public playExplosion(): void {
    if (this.mutedSfx) return;
    this.init();
    this.sfx.playExplosion();
  }

  public playSuccess(rank: 'S' | 'A' | 'B' | 'C'): void {
    if (this.mutedSfx) return;
    this.init();
    this.sfx.playSuccess(rank);
  }

  /** Positions one voice per engine. Call when the vehicle changes, not per frame. */
  public setEngineLayout(offsets: number[]): void {
    this.init();
    this.sfx.setEngineLayout(offsets);
  }

  /** `lit` is one flag per engine; `side` is −1, 0 or +1 for the attitude jets. */
  public updateEngineSound(lit: boolean[], side = 0): void {
    if (this.mutedSfx) return;
    this.sfx.updateEngineSound(lit, side);
  }

  public updateWind(heightAboveGround: number, horizontalSpeed: number): void {
    if (this.mutedSfx) return;
    this.sfx.updateWind(heightAboveGround, horizontalSpeed);
  }
}

export const audio = new AudioManager();
