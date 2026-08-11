/**
 * Sound Synthesizer for 30 Missions to Mars using Web Audio API.
 *
 * Handles synthesis of UI sound effects, thruster engine sound loops,
 * canyon wind noise, lander explosions, and touchdown success chimes.
 */
export class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private destination: GainNode | null = null;

  // Engine sound state
  private mainEngineGain: GainNode | null = null;
  private mainEngineFilter: BiquadFilterNode | null = null;
  private mainSubOsc: OscillatorNode | null = null;
  private sideEngineGain: GainNode | null = null;
  private sideEngineFilter: BiquadFilterNode | null = null;

  // Wind sound state
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windLfo: OscillatorNode | null = null;

  public init(ctx: AudioContext, destination: GainNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.destination = destination;

    this.setupEngineSynth();
    this.setupWindSynth();
  }

  // ------------------------------------------------------------------------- UI SOUNDS

  /** Short UI click/beep chime. */
  public playUiBeep(freq = 800, type: OscillatorType = 'sine', duration = 0.04): void {
    if (!this.ctx || !this.destination) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + duration);

    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  /** Teletype text tick sound. */
  public playTeletype(): void {
    if (!this.ctx || !this.destination) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(1400 + Math.random() * 300, now);

    gain.gain.setValueAtTime(0.02, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

    osc.connect(gain);
    gain.connect(this.destination);

    osc.start(now);
    osc.stop(now + 0.015);
  }

  /** Mission Launch UI sound effect. */
  public playLaunch(): void {
    if (!this.ctx || !this.destination) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.destination);

    osc.start(now);
    osc.stop(now + 0.28);
  }

  // --------------------------------------------------------------------- GAMEPLAY SFX

  /** Lander Explosion sound effect. */
  public playExplosion(): void {
    if (!this.ctx || !this.destination) return;
    const now = this.ctx.currentTime;

    const bufferSize = this.ctx.sampleRate * 1.5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(40, now + 1.2);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.destination);

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(160, now);
    sub.frequency.exponentialRampToValueAtTime(25, now + 0.8);

    subGain.gain.setValueAtTime(0.5, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    sub.connect(subGain);
    subGain.connect(this.destination);

    noise.start(now);
    noise.stop(now + 1.3);
    sub.start(now);
    sub.stop(now + 0.85);
  }

  /** Touchdown Success chime. */
  public playSuccess(rank: 'S' | 'A' | 'B' | 'C'): void {
    if (!this.ctx || !this.destination) return;
    const now = this.ctx.currentTime;

    const notes = rank === 'S'
      ? [523.25, 659.25, 783.99, 1046.50]
      : rank === 'A'
      ? [440, 554.37, 659.25]
      : [349.23, 440, 523.25];

    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.destination) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const noteTime = now + idx * 0.09;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0, noteTime);
      gain.gain.linearRampToValueAtTime(0.18, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.6);

      osc.connect(gain);
      gain.connect(this.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.65);
    });
  }

  // ----------------------------------------------------------------- ENGINE SYNTHESIZER

  private setupEngineSynth(): void {
    if (!this.ctx || !this.destination) return;

    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    this.mainEngineFilter = this.ctx.createBiquadFilter();
    this.mainEngineFilter.type = 'lowpass';
    this.mainEngineFilter.frequency.value = 180;

    this.mainEngineGain = this.ctx.createGain();
    this.mainEngineGain.gain.value = 0;

    noise.connect(this.mainEngineFilter);
    this.mainEngineFilter.connect(this.mainEngineGain);
    this.mainEngineGain.connect(this.destination);
    noise.start();

    // Sub Rumble
    this.mainSubOsc = this.ctx.createOscillator();
    this.mainSubOsc.type = 'triangle';
    this.mainSubOsc.frequency.value = 55;
    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.5;
    this.mainSubOsc.connect(subGain);
    subGain.connect(this.mainEngineGain);
    this.mainSubOsc.start();

    // Side Thrusters (Softened high-frequency RCS burst)
    const sideNoise = this.ctx.createBufferSource();
    sideNoise.buffer = buffer;
    sideNoise.loop = true;

    this.sideEngineFilter = this.ctx.createBiquadFilter();
    this.sideEngineFilter.type = 'highpass';
    this.sideEngineFilter.frequency.value = 1600;

    this.sideEngineGain = this.ctx.createGain();
    this.sideEngineGain.gain.value = 0;

    sideNoise.connect(this.sideEngineFilter);
    this.sideEngineFilter.connect(this.sideEngineGain);
    this.sideEngineGain.connect(this.destination);
    sideNoise.start();
  }

  public updateEngineSound(mainThrust: number, sideThrust: number): void {
    if (!this.ctx || !this.mainEngineGain || !this.sideEngineGain) return;
    const now = this.ctx.currentTime;

    const targetMainGain = mainThrust > 0 ? 0.38 * mainThrust : 0;
    const targetSideGain = sideThrust > 0 ? 0.07 * Math.min(1, sideThrust) : 0;

    this.mainEngineGain.gain.setTargetAtTime(targetMainGain, now, 0.03);
    this.sideEngineGain.gain.setTargetAtTime(targetSideGain, now, 0.03);

    if (this.mainEngineFilter && mainThrust > 0) {
      this.mainEngineFilter.frequency.setTargetAtTime(180 + mainThrust * 280, now, 0.05);
    }
  }

  // ----------------------------------------------------------------- CANYON WIND SYNTH

  private setupWindSynth(): void {
    if (!this.ctx || !this.destination) return;

    const bufferSize = this.ctx.sampleRate * 3;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const windNoise = this.ctx.createBufferSource();
    windNoise.buffer = buffer;
    windNoise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 240;
    this.windFilter.Q.value = 2.5;

    // LFO for howling wind modulation
    this.windLfo = this.ctx.createOscillator();
    this.windLfo.frequency.value = 0.15;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 120;
    this.windLfo.connect(lfoGain);
    lfoGain.connect(this.windFilter.frequency);
    this.windLfo.start();

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.08;

    windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.destination);
    windNoise.start();
  }

  public updateWind(heightAboveGround: number, horizontalSpeed: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const now = this.ctx.currentTime;

    const normSpeed = Math.min(1, horizontalSpeed / 40);
    const normHeight = Math.min(1, Math.max(0, heightAboveGround / 500));

    const targetGain = 0.04 + normSpeed * 0.08 + normHeight * 0.05;
    const targetFreq = 200 + normSpeed * 300 + normHeight * 150;

    this.windGain.gain.setTargetAtTime(targetGain, now, 0.2);
    this.windFilter.frequency.setTargetAtTime(targetFreq, now, 0.2);
  }
}
