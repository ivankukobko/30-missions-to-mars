/**
 * One bar of wobble bass, drawn rather than oscillated.
 *
 * The obvious build for this is an `OscillatorNode` on a resonant filter's cutoff —
 * exactly what the pad already does at 0.06 Hz in `MusicComposer`. It stops working the
 * moment the sweep is fast enough to read as rhythm, for two reasons:
 *
 * - **An oscillator cannot be phase-reset.** The figure has to land on the bar line, and
 *   a free-running LFO arrives wherever it happens to be. Automating its frequency to
 *   change the division makes that worse rather than better: the phase at the next bar
 *   becomes a function of every rate change before it.
 * - **The rate has to change *within* a bar.** Frequency is the derivative of phase, so a
 *   ratchet is three lines if you are integrating phase yourself, and impossible to place
 *   exactly if a node is doing it for you.
 *
 * So a bar is a `Float32Array` handed to `setValueCurveAtTime`, scheduled at an absolute
 * time off the audio clock. Nothing free-runs and nothing drifts: the figure is a pure
 * function of the bar index, which is the same discipline `followClock` already applies
 * to the harmony.
 *
 * The curve drives `detune`, not `frequency`. Cutoff is perceived logarithmically, and a
 * linear ±Hz sweep — what the pad's filter LFO does — spends nearly all its time sounding
 * open and then slams shut at the bottom. In cents the movement is even end to end, which
 * is the difference between a rhythm and a lurch.
 */

/**
 * Points per bar in the scheduled curve. `setValueCurveAtTime` interpolates linearly
 * between them, so this sets how smooth the *fastest* sweep is: 1024 points across a
 * 2.1-second bar is 64 per cycle at 1/16, well past where the steps are audible.
 */
const CURVE_POINTS = 1024;

/**
 * Cutoff with the sweep fully closed. Below the bass fundamental, so the bottom of every
 * cycle is genuinely shut rather than merely dark — the silence between wubs is half of
 * what makes them wubs.
 */
const BASE_CUTOFF = 70;

/**
 * How far the sweep opens, in cents. 4200 is three and a half octaves: 70 Hz up to about
 * 790 Hz, which is where a 55 Hz saw keeps the harmonics worth hearing. Wider than this
 * and the top of each cycle is thin fizz; much narrower and it is a tremolo, not a wobble.
 */
const SWEEP_CENTS = 4200;

/**
 * Resonance per stage — and there are two stages, which is why this is 4.5 rather than
 * the 12 a single filter would need.
 *
 * A `BiquadFilterNode` lowpass is 12 dB/oct. Every synth that makes this sound is 24, and
 * the difference is not cosmetic: at 12 dB/oct the harmonics the sweep is supposed to be
 * travelling past are still plainly audible, so the ear hears a filter moving over a saw
 * instead of one voice changing shape. Cascading two doubles the slope and multiplies the
 * resonant peaks.
 */
const STAGE_Q = 4.5;

/**
 * Saturation before the filter, as a `tanh` drive.
 *
 * Order matters and this is the order: distort, then filter. A clean saw through a
 * resonant sweep is quiet and polite; clipping it first packs in the upper harmonics that
 * the resonant peak then picks out one at a time, which is the growl. Doing it the other
 * way round distorts the resonance itself and the sweep stops being audible as movement.
 */
const DRIVE = 3;

/**
 * Makeup after two resonant stages, before the compressor.
 *
 * Peak gain at resonance is roughly Q per stage, so ~20x through the pair. This undoes
 * most of that; the compressor catches what is left, which varies with where in the sweep
 * a harmonic happens to land and is not worth predicting.
 */
const MAKEUP = 0.07;

/** Detune of the two saws against each other, in cents. Slow beating, not a chorus. */
const SPREAD = 14;

/** Gate edges. Long enough not to click, short enough that the attack is still an attack. */
const GATE_ATTACK = 0.012;
const GATE_RELEASE = 0.03;

/**
 * Gap left at the end of each scheduled curve.
 *
 * `setValueCurveAtTime` throws if two curves overlap, and back-to-back bars share an
 * instant at the boundary. Ending 5 ms early makes an overlap arithmetically impossible
 * rather than a rounding error away, and costs nothing: the shape is already closed at
 * both ends, so the parameter holds the value it was going to hold anyway.
 */
const CURVE_GAP = 0.005;

export class WobbleBass {
  private ctx: AudioContext | null = null;
  private oscs: OscillatorNode[] = [];
  private sweep: ConstantSourceNode | null = null;
  private gate: GainNode | null = null;

  public init(ctx: AudioContext, destination: GainNode): void {
    if (this.ctx) return;
    this.ctx = ctx;

    const mix = ctx.createGain();
    mix.gain.value = 0.5;

    // Two saws for the body, a square under them for the odd harmonics. All on the same
    // note — the spread is detune, not voicing, so the bass stays one pitch.
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'sawtooth' : 'square';
      osc.frequency.value = 55;
      osc.detune.value = i === 0 ? -SPREAD : i === 1 ? SPREAD : 0;
      osc.connect(mix);
      osc.start();
      this.oscs.push(osc);
    }

    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve();
    shaper.oversample = '4x';

    // One `ConstantSourceNode` feeding both filters, rather than scheduling the same curve
    // on each: two copies of one automation is two things that can disagree.
    this.sweep = ctx.createConstantSource();
    this.sweep.offset.value = 0;
    this.sweep.start();

    let node: AudioNode = mix;
    node.connect(shaper);
    node = shaper;
    for (let i = 0; i < 2; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = BASE_CUTOFF;
      filter.Q.value = STAGE_Q;
      filter.detune.value = 0;
      this.sweep.connect(filter.detune);
      node.connect(filter);
      node = filter;
    }

    const makeup = ctx.createGain();
    makeup.gain.value = MAKEUP;

    // On the wobble alone, not the music bus. Ducking the pad against its own bass would
    // pump the harmony, and the pad is the part that is supposed to sound like weather.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 6;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.12;

    this.gate = ctx.createGain();
    this.gate.gain.value = 0;

    node.connect(makeup);
    makeup.connect(comp);
    comp.connect(this.gate);
    this.gate.connect(destination);
  }

  /**
   * Schedules one bar at an absolute time.
   *
   * `cycles` is whole sweeps across the bar — 4 is 1/4, 16 is 1/16 — and `skew` narrows
   * each peak, so a faster division can also be a harder one. `level` is the gate height,
   * which is where a rest bar is expressed: rests are simply not scheduled.
   */
  public scheduleBar(
    at: number,
    duration: number,
    freq: number,
    cycles: number,
    skew: number,
    level: number,
  ): void {
    if (!this.ctx || !this.sweep || !this.gate) return;

    for (const osc of this.oscs) osc.frequency.setValueAtTime(freq, at);

    // Phase accumulated by hand, which is the whole point: `cycles` could vary across the
    // bar and the arithmetic would not change. It does not yet — the ratchet steps at bar
    // boundaries — but the shape of the code is what makes that a one-line change.
    const curve = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const phase = (i / (CURVE_POINTS - 1)) * cycles;
      // Raised cosine, so the curve starts and ends shut for any whole number of cycles
      // and consecutive bars meet at zero without a step.
      const open = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
      curve[i] = Math.pow(open, skew) * SWEEP_CENTS;
    }
    this.sweep.offset.setValueCurveAtTime(curve, at, duration - CURVE_GAP);

    const g = this.gate.gain;
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(level, at + GATE_ATTACK);
    g.setValueAtTime(level, at + duration - GATE_RELEASE);
    g.linearRampToValueAtTime(0, at + duration);
  }

  /**
   * Drops the voice and discards anything queued behind it.
   *
   * The gate is what actually silences it. Cancelling the sweep matters for a different
   * reason: bars already scheduled ahead would otherwise still be on the timeline when the
   * score restarts, and the first new curve would overlap one of them and throw.
   */
  public silence(at: number): void {
    if (!this.gate || !this.sweep) return;
    this.gate.gain.cancelScheduledValues(at);
    this.gate.gain.setTargetAtTime(0, at, GATE_RELEASE);
    this.sweep.offset.cancelScheduledValues(at);
  }
}

/** `tanh` normalised so full-scale in is full-scale out; the drive is in the knee. */
function driveCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(DRIVE);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * DRIVE) / norm;
  }
  return curve;
}
