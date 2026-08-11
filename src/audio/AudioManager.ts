import type { CorpId } from '../world/CanyonSpec.ts';
import { MusicComposer } from './MusicComposer.ts';
import { SoundSynthesizer } from './SoundSynthesizer.ts';

/**
 * Main Procedural Audio Manager / Facade for 30 Missions to Mars.
 *
 * Coordinates AudioContext lifecycle, master volume gain, and muting,
 * while delegating sound effects to SoundSynthesizer and music to MusicComposer.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted = false;

  private composer = new MusicComposer();
  private sfx = new SoundSynthesizer();

  public get isAmbientActive(): boolean {
    return this.composer.isActive;
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
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);

      this.sfx.init(this.ctx, this.masterGain);
      this.composer.init(this.ctx, this.masterGain);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    if (this.composer.isActive) {
      this.composer.start();
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
    this.composer.setMuted(this.isMuted);
    return this.isMuted;
  }

  // ------------------------------------------------------------------------- MUSIC DELEGATION

  public setMissionContext(corp: CorpId, missionId: number): void {
    this.composer.setMissionContext(corp, missionId);
  }

  public startAmbient(): void {
    this.init();
    this.composer.start();
  }

  public stopAmbient(): void {
    this.composer.stop();
  }

  // ------------------------------------------------------------------------- SFX DELEGATION

  public playUiBeep(freq = 800, type: OscillatorType = 'sine', duration = 0.04): void {
    if (this.isMuted) return;
    this.init();
    this.sfx.playUiBeep(freq, type, duration);
  }

  public playTeletype(): void {
    if (this.isMuted) return;
    this.sfx.playTeletype();
  }

  public playLaunch(): void {
    if (this.isMuted) return;
    this.sfx.playLaunch();
  }

  public playExplosion(): void {
    if (this.isMuted) return;
    this.init();
    this.sfx.playExplosion();
  }

  public playSuccess(rank: 'S' | 'A' | 'B' | 'C'): void {
    if (this.isMuted) return;
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
    if (this.isMuted) return;
    this.sfx.updateEngineSound(lit, side);
  }

  public updateWind(heightAboveGround: number, horizontalSpeed: number): void {
    if (this.isMuted) return;
    this.sfx.updateWind(heightAboveGround, horizontalSpeed);
  }
}

export const audio = new AudioManager();
