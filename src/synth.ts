import {
  MusicComposer,
  wobbleBar,
  identBit,
  DEGREES,
  DEGREE_NAMES,
  degreeName,
  keyHz,
  NOTE_NAMES,
  THEMES,
  TEMPO,
  IDENT_BITS,
  barSeconds,
  beatSeconds,
  stepSeconds,
  cycleSeconds,
  identStrike,
  PERCUSSION_BEATS,
  PERCUSSION_LEAD,
  DRAWBARS,
  DRAWBAR_LABELS,
  DRAWBARS_DEFAULT,
  layerMix,
  type MusicTrack,
  type Tempo,
  type Sounding,
  type Theme,
  type Chord,
  type Degree,
} from './audio/MusicComposer.ts';
import { CANYON } from './world/CanyonSpec.ts';

/**
 * A bench for the score itself, with no canyon and no campaign under it.
 *
 * The same bargain `src/preview.ts` makes for geometry, made for sound: this drives the
 * game's own `MusicComposer` and reads its own exported constants, so it is a different
 * listening position and not a second implementation. Nothing here restates the
 * composition — the groove comes from `wobbleBar`, the word from `identBit`, the degrees
 * from `degreeName`. A readout typed out beside the score would agree with it right up
 * until the day it mattered.
 *
 * **It knows nothing about missions.** There are three tracks and a five-bit callsign, and
 * which mission happens to play which is a campaign question answered by `musicTrackFor`
 * — not a musical one. Keeping the campaign out is what makes this an instrument: a
 * callsign here is any of the 32 values the encoding can hold, including the ones no
 * mission number reaches, and that is the range the groove has to sound good across.
 */

/**
 * The reference pilot's median descent, in seconds.
 *
 * A *result* — `ReferencePilot.test.ts` flies the campaign and reports it — repeated here
 * rather than imported, because the score's job is to be judged against it and not to
 * depend on it. It is the one number that says whether a progression fits a descent, so
 * the cycle is printed beside it and coloured when it overruns.
 */
const MEDIAN_DESCENT = 28.0;

function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}.`);
  return el;
}

const transportEl = need('transport');
const tracksEl = need('tracks');
const readoutEl = need('readout');

const composer = new MusicComposer();
let ctx: AudioContext | null = null;
/** The bus the composer mixes into. Exposed so a script can hang an analyser on it — the
 *  only way to prove from outside the page that a voice is actually sounding. */
let master: GainNode | null = null;

let track: MusicTrack = 'outpost';
/** The key, as a pitch class and an octave rather than a frequency. */
let keyPc = 9;
let keyOctave = 1;
/** The four steps, as degrees. Chords are resolved from these, never stored beside them. */
let progression: Degree[] = ['I', 'I', 'iii', 'I'];
/** The five-bit word being sounded. Any of the 32, not only the 29 a campaign uses. */
let callsign = 29;
/** The grid being edited. Starts at whatever the game currently ships. */
let tempo: Tempo = { ...TEMPO };
/** Where the imaginary vehicle is. Entry altitude, so the bench opens in open sky. */
let altitude = 1020;
/** Kit level. Its own control rather than part of `Tempo`: a mix, not a grid. */
let kit = 9;
/** How much noise is on the high drum: 0 a bare tom, 100 about a snare. */
let tomNoise = 25;
/** Where the tom lands after its kick, as a percent of a count. 50 is the and. */
let flam = 50;
/** Drawbar registration, one per ratio in `DRAWBARS`. */
let drawbars: number[] = [...DRAWBARS_DEFAULT];

// ------------------------------------------------------------------------- audio

function arm(): void {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.5; // `AudioManager.LEVEL` — the level the game actually mixes at.
  master.connect(ctx.destination);
  composer.init(ctx, master);
  composer.setSounding(sounding());
  composer.start();
  sound();
  armBtn.textContent = 'STOP';
}

function toggle(): void {
  if (!ctx) return arm();
  if (composer.isActive) {
    composer.stop();
    armBtn.textContent = 'PLAY';
  } else {
    composer.start();
    armBtn.textContent = 'STOP';
  }
}

/**
 * Pushes track and callsign into the composer, through the same door the game uses.
 *
 * `setMissionContext` sounds the word immediately rather than waiting for the top of a
 * cycle, which is exactly what an audition wants — every change is audible on the spot.
 */
function sound(): void {
  if (ctx && composer.isActive) {
    composer.setMissionContext(track, callsign);
    // `setMissionContext` resets the chord index and re-sounds the word, but the theme is
    // the editor's and has to survive it.
    composer.setTheme(theme());
  }
  writeHash();
  paintTracks();
  renderPattern();
  render();
}

// ------------------------------------------------------------------------- readout

/** Nearest note name for a frequency, derived rather than tabulated beside the roots. */
function noteName(hz: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** How `RATCHET`'s sweep counts read on a page. 12 is a triplet division, not 12 sweeps. */
const DIVISION: Record<number, string> = { 4: '1/4', 8: '1/8', 12: '1/8T', 16: '1/16' };

function row(key: string, val: string): string {
  return `<div class="row"><span class="key">${key}</span><span class="val">${val}</span></div>`;
}

/** Which chord step the audio clock says is live, by the same arithmetic `followClock` uses. */
function liveStep(): number | null {
  if (!ctx || !composer.isActive) return null;
  return Math.floor(ctx.currentTime / stepSeconds(tempo)) % 4;
}

function render(): void {
  // Read back from the composer rather than rebuilt here: whatever is sounding is the
  // thing to describe, and after `setTheme` that is no longer any entry in `THEMES`.
  const live = composer.theme();
  const step = liveStep();

  // The playing step lights up in the editor, not only in the readout — the slot you are
  // about to change is the one worth pointing at.
  chordsEl.querySelectorAll<HTMLElement>('.slot').forEach((slot) => {
    slot.classList.toggle('playing', Number(slot.dataset.slot) === step);
  });

  const degrees = live.progression
    .map((chord, i) => {
      const name = degreeName(chord);
      return i === step ? `<span class="live">${name}</span>` : name;
    })
    .join(' ');

  // The word, drawn on two lines so the page shows what the ear is asked to hear: the
  // octave *is* the bit, and a row of ones and zeroes would be a different encoding.
  const bits = Array.from({ length: IDENT_BITS }, (_, i) => identBit(callsign, i));
  const high = bits.map((b) => (b ? ' ▄ ' : '   ')).join('');
  const low = bits.map((b) => (b ? '   ' : ' ▄ ')).join('');
  const word = bits.map((b) => (b ? ' 1 ' : ' 0 ')).join('');

  // The groove, straight out of the function the composer schedules from. A rest is drawn
  // as a gap rather than as the word "rest": five bars of pattern is a shape, and the
  // build-and-drop of a number like 29 is only visible as one.
  const bars = Array.from({ length: IDENT_BITS }, (_, i) => wobbleBar(callsign, i));
  const groove = bars.map((b) => (b ? DIVISION[b.cycles] ?? String(b.cycles) : '·').padEnd(5)).join('');
  const flat7 = bars.map((b) => (b && b.offset !== 0 ? '♭7   ' : '     ')).join('');

  readoutEl.innerHTML =
    '<h2>WHAT YOU SHOULD BE HEARING</h2>' +
    row('TRACK', matchingTrack() ?? 'custom') +
    row('KEY', `${noteName(live.root)} · ${live.root.toFixed(2)} Hz`) +
    row('PROGRESSION', `${degrees}   ${stepSeconds(tempo).toFixed(2)}s a step, ${cycleSeconds(tempo).toFixed(1)}s round`) +
    row('CALLSIGN', `${callsign}`) +
    row('WORD', `${high}\n${word}\n${low}`) +
    row('GROOVE', `${groove}\n${flat7}`) +
    row('BAR', `${barSeconds(tempo).toFixed(3)}s at ${tempo.bpm} BPM · word is ${IDENT_BITS} bars against ${tempo.barsPerChord}`);
}

// ------------------------------------------------------------------------- controls

const armBtn = transportEl.querySelector<HTMLButtonElement>('#arm')!;
const beaconBtn = transportEl.querySelector<HTMLButtonElement>('#beacon')!;

/**
 * The theme being edited, built from the key and the four degrees.
 *
 * Rebuilt on every read rather than kept as state beside them, so the degrees are the only
 * copy of the progression. Two representations of one progression is exactly the drift the
 * old identity-keyed chord names were vulnerable to.
 */
function theme(): Theme {
  const chords = progression.map((d) => DEGREES[d] as Chord);
  return {
    root: keyHz(keyPc, keyOctave),
    progression: [chords[0], chords[1], chords[2], chords[3]],
  };
}

const keyNoteSel = need('harmony-panel').querySelector<HTMLSelectElement>('#key-note')!;
const keyOctSel = need('harmony-panel').querySelector<HTMLSelectElement>('#key-octave')!;
const chordsEl = need('chords');

keyNoteSel.innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
// Roots are pad fundamentals, so the useful range is the bottom of the piano. Above 2 the
// sub voice — a further octave down — stops being a sub and starts being part of the chord.
keyOctSel.innerHTML = [0, 1, 2].map((o) => `<option value="${o}">oct ${o}</option>`).join('');

chordsEl.innerHTML = [0, 1, 2, 3]
  .map(
    (i) =>
      `<div class="slot" data-slot="${i}"><span class="step">${i + 1}</span>` +
      `<select data-slot="${i}">` +
      DEGREE_NAMES.map((d) => `<option value="${d}">${d}</option>`).join('') +
      '</select></div>',
  )
  .join('');

function applyHarmony(): void {
  composer.setTheme(theme());
  keyNoteSel.value = String(keyPc);
  keyOctSel.value = String(keyOctave);
  need('key-hz').textContent = `${theme().root.toFixed(2)} Hz`;
  chordsEl.querySelectorAll<HTMLSelectElement>('select[data-slot]').forEach((sel) => {
    sel.value = progression[Number(sel.dataset.slot)];
  });
  need('harmony-note').innerHTML =
    `<strong>${NOTE_NAMES[keyPc]}${keyOctave}</strong> · ${progression.join(' ')} — ` +
    'degrees over the tonic, not inversions: the first tone of a chord is the one the sub ' +
    'and the air are an octave from, so <code>IV</code> is [5,9,12] rather than [0,5,9].';
  writeHash();
  paintTracks();
  render();
}

keyNoteSel.addEventListener('change', () => {
  keyPc = Number(keyNoteSel.value);
  arm();
  applyHarmony();
});
keyOctSel.addEventListener('change', () => {
  keyOctave = Number(keyOctSel.value);
  arm();
  applyHarmony();
});
chordsEl.addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  if (!sel.dataset.slot) return;
  progression[Number(sel.dataset.slot)] = sel.value as Degree;
  arm();
  applyHarmony();
});

tracksEl.innerHTML = (Object.keys(THEMES) as MusicTrack[])
  .map((t) => `<button class="c-${t}" data-track="${t}">${t}</button>`)
  .join('');

need('track-note').innerHTML =
  'Loads that charter\'s key and progression into the editor above, as a starting point. ' +
  'Ixion is A and Kessler is D, a fifth below — so Ixion\'s tonic is Kessler\'s dominant, ' +
  'and Kessler\'s progression opens on it. Kessler is also the only one of the three that ' +
  'ever reaches its own tonic: Ixion ends on the dominant and turns away, and Helion has ' +
  'no gravity in it at all.';

/**
 * Which shipped track the editor currently matches, if any.
 *
 * Compared by *sound* rather than by which button was last pressed — editing a chord after
 * loading Kessler leaves you somewhere that is no longer Kessler, and a button still lit
 * would be claiming otherwise.
 */
function matchingTrack(): MusicTrack | null {
  const mine = theme();
  return (
    (Object.keys(THEMES) as MusicTrack[]).find((t) => {
      const it = THEMES[t];
      return (
        Math.abs(it.root - mine.root) < 0.01 &&
        it.progression.every((c, i) => degreeName(c) === degreeName(mine.progression[i]))
      );
    }) ?? null
  );
}

function paintTracks(): void {
  const live = matchingTrack();
  tracksEl.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.track === live));
  });
}

/** Pulls a shipped theme back into the editor's own terms — key as a note, chords as degrees. */
function loadTrack(t: MusicTrack): void {
  track = t;
  const it = THEMES[t];
  // The roots are named notes; recovering the pitch class from the frequency means the
  // editor cannot disagree with `THEMES` about what key a charter is in.
  const midi = Math.round(69 + 12 * Math.log2(it.root / 440));
  keyPc = ((midi % 12) + 12) % 12;
  keyOctave = Math.floor(midi / 12) - 1;
  progression = it.progression.map((c) => degreeName(c) as Degree);
  applyHarmony();
}

tracksEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-track]');
  if (!btn) return;
  arm();
  loadTrack(btn.dataset.track as MusicTrack);
});

const callsignIn = need('callsign-panel').querySelector<HTMLInputElement>('#callsign')!;
callsignIn.addEventListener('input', () => {
  callsign = Number(callsignIn.value);
  need('callsign-v').textContent = String(callsign);
  arm();
  sound();
});

beaconBtn.addEventListener('click', () => {
  arm();
  composer.emitDistantIdent();
});

armBtn.addEventListener('click', toggle);

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    toggle();
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    callsign = (callsign + (e.key === 'ArrowRight' ? 1 : 31)) % 32;
    callsignIn.value = String(callsign);
    need('callsign-v').textContent = String(callsign);
    arm();
    sound();
  }
});

// ------------------------------------------------------------------------- altitude

/**
 * The deepest shaft in the campaign, and the bottom of this slider.
 *
 * `failDepth` runs −60 to −320 across the missions; −320 is the floor of the deepest one,
 * so the slider covers every position any flight can reach.
 */
const DEEPEST = -320;

/**
 * One slider standing in for a whole descent.
 *
 * The game feeds `setSounding` three independent numbers, and they disagree on purpose —
 * over a raised deck you are high in the canyon and metres off the ground at once. A bench
 * with one control cannot reproduce that, so it models the simple case honestly and says
 * so: **a descent to open floor, then straight down a shaft.** Ground is the canyon floor,
 * so `heightAboveGround` is the altitude until the floor arrives; below it, the abyss
 * fraction takes over. The disagreeing case is what `layerMix`'s tests cover.
 */
function sounding(): Sounding {
  return {
    altitude,
    heightAboveGround: Math.max(0, altitude),
    abyssProximity: altitude >= 0 ? 0 : Math.min(1, altitude / DEEPEST),
  };
}

const altitudeIn = need('altitude-panel').querySelector<HTMLInputElement>('#altitude')!;
const layersEl = need('layers');

function zone(): string {
  if (altitude < 0) return 'in the shaft';
  if (altitude < 60) return 'on the floor';
  if (altitude < CANYON.RIM_Y) return 'inside the canyon';
  return 'above the rim';
}

function renderLayers(): void {
  const mix = layerMix(sounding());
  layersEl.innerHTML = (['air', 'body', 'sub'] as const)
    .map((k) => {
      const pct = Math.round(mix[k] * 100);
      return (
        `<div class="meter"><span class="lbl">${k}</span>` +
        `<span class="bar"><span class="fill" style="width:${pct}%"></span></span>` +
        `<span class="pct">${pct}%</span></div>`
      );
    })
    .join('');

  need('altitude-v').textContent = String(altitude);
  need('altitude-note').innerHTML =
    `<span class="zone">${zone()}</span> — rim at ${CANYON.RIM_Y}, floor at ${CANYON.FLOOR_Y}, ` +
    `deepest shaft ${DEEPEST}. A descent to open floor and then straight down a hole; ` +
    'the game feeds three heights that can disagree, and this models the case where they do not.';
}

function applyAltitude(y: number): void {
  altitude = y;
  composer.setSounding(sounding());
  renderLayers();
  writeHash();
}

altitudeIn.addEventListener('input', () => applyAltitude(Number(altitudeIn.value)));

// ------------------------------------------------------------------------- the grid

const gridEl = need('grid-controls');
const bpmIn = gridEl.querySelector<HTMLInputElement>('#bpm')!;
const bpbIn = gridEl.querySelector<HTMLInputElement>('#bpb')!;
const bpcIn = gridEl.querySelector<HTMLInputElement>('#bpc')!;
const kitIn = gridEl.querySelector<HTMLInputElement>('#kit')!;
const noiseIn = gridEl.querySelector<HTMLInputElement>('#noise')!;
const flamIn = gridEl.querySelector<HTMLInputElement>('#flam')!;
const derivedEl = need('derived');

/**
 * Greatest common divisor, for the phrase relationship below.
 *
 * How often the five-bar word comes back round to the same place in the progression is
 * `lcm(5, barsPerChord * 4)` bars, and that number is the whole argument for one setting
 * over another: at four bars to a chord it is 80 bars, far longer than any descent, so the
 * callsign never lands twice in the same place. At five it is 20 — once a cycle, every
 * cycle, which is a chorus.
 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function applyTempo(next: Partial<Tempo>): void {
  tempo = { ...tempo, ...next };
  composer.setTempo(tempo);
  writeHash();
  renderDerived();
  renderPattern();
  render();
}

function renderDerived(): void {
  const cycle = cycleSeconds(tempo);
  const progressionBars = tempo.barsPerChord * 4;
  const realign = (IDENT_BITS * progressionBars) / gcd(IDENT_BITS, progressionBars);
  const over = cycle > MEDIAN_DESCENT;

  bpmIn.value = String(tempo.bpm);
  bpbIn.value = String(tempo.beatsPerBar);
  bpcIn.value = String(tempo.barsPerChord);
  kitIn.value = String(kit);
  noiseIn.value = String(tomNoise);
  need('noise-v').textContent = tomNoise === 0 ? 'tom' : tomNoise === 100 ? 'snare' : `${tomNoise}%`;
  flamIn.value = String(flam);
  need('flam-v').textContent =
    flam === 0 ? 'together' : flam === 50 ? 'the &' : flam <= 15 ? `flam ${flam}%` : `${flam}%`;
  need('bpm-v').textContent = String(tempo.bpm);
  need('bpb-v').textContent = String(tempo.beatsPerBar);
  need('bpc-v').textContent = String(tempo.barsPerChord);
  need('kit-v').textContent = kit === 0 ? 'off' : String(kit);

  derivedEl.innerHTML =
    `Bar ${barSeconds(tempo).toFixed(3)}s · chord ${stepSeconds(tempo).toFixed(2)}s · ` +
    `cycle <strong class="${over ? 'warn' : ''}">${cycle.toFixed(1)}s</strong> ` +
    `against a ${MEDIAN_DESCENT.toFixed(1)}s median descent` +
    (over
      ? ' — <span class="warn">longer than the run</span>, so the progression never completes in play.'
      : ', so a typical run hears the harmony arrive once.') +
    `<br/>Word realigns with the progression every ${realign} bars ` +
    `(${(realign * barSeconds(tempo)).toFixed(0)}s).`;
}

bpmIn.addEventListener('input', () => applyTempo({ bpm: Number(bpmIn.value) }));
bpbIn.addEventListener('input', () => applyTempo({ beatsPerBar: Number(bpbIn.value) }));
flamIn.addEventListener('input', () => {
  flam = Number(flamIn.value);
  composer.setTomOffset(flam / 100);
  arm();
  renderDerived();
  renderPattern();
  writeHash();
});
noiseIn.addEventListener('input', () => {
  tomNoise = Number(noiseIn.value);
  composer.setPercussionNoise(tomNoise / 100);
  arm();
  renderDerived();
  writeHash();
});
kitIn.addEventListener('input', () => {
  kit = Number(kitIn.value);
  composer.setPercussionLevel(kit / 100);
  composer.setPercussionNoise(tomNoise / 100);
  composer.setTomOffset(flam / 100);
  composer.setDrawbars(drawbars);
  arm();
  renderDerived();
  renderPattern();
  writeHash();
});
bpcIn.addEventListener('input', () => applyTempo({ barsPerChord: Number(bpcIn.value) }));

// ------------------------------------------------------------------------- drawbars

const drawbarsEl = need('drawbars');
drawbarsEl.innerHTML = DRAWBARS.map(
  (_, i) =>
    `<div class="bar-stop"><span class="lv" data-lv="${i}"></span>` +
    `<input type="range" min="0" max="100" step="5" data-bar="${i}" />` +
    `<span class="ft">${DRAWBAR_LABELS[i]}</span></div>`,
).join('');

function renderDrawbars(): void {
  drawbarsEl.querySelectorAll<HTMLInputElement>('input[data-bar]').forEach((el) => {
    const i = Number(el.dataset.bar);
    el.value = String(Math.round(drawbars[i] * 100));
  });
  drawbarsEl.querySelectorAll<HTMLElement>('[data-lv]').forEach((el) => {
    el.textContent = String(Math.round(drawbars[Number(el.dataset.lv)] * 100));
  });
  const anyOn = drawbars.some((d) => d > 0);
  need('drawbar-note').innerHTML = anyOn
    ? 'Sine partials of each pad voice, at organ footages. They ride <em>inside</em> the ' +
      'voice they belong to, so the altitude layering still works — a 4′ partial of a body ' +
      'voice is the same pitch as the air voice, and mixing it anywhere else would fill the ' +
      'air register with body and quietly flatten the descent.'
    : 'All off — the score sounds exactly as it ships. An organ is not more <em>notes</em>, ' +
      'it is more <em>harmonics of the same note</em>: adding voices to the triad would only ' +
      'have made a thicker pad. Pull these up to hear the difference.';
}

drawbarsEl.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (!el.dataset.bar) return;
  drawbars[Number(el.dataset.bar)] = Number(el.value) / 100;
  composer.setDrawbars(drawbars);
  arm();
  renderDrawbars();
  writeHash();
});

// ------------------------------------------------------------------------- the pattern

const patternEl = need('pattern');

function renderPattern(): void {
  patternEl.innerHTML = Array.from({ length: PERCUSSION_BEATS }, (_, i) => {
    const hit = identStrike(callsign, i);
    const lead = i < PERCUSSION_LEAD;
    return (
      `<div class="hit ${hit} ${lead ? 'parity' : ''} ${hit === 'tom' ? 'flammed' : ''}">BD` +
      (hit === 'tom' ? `<span class="and">+TOM</span>` : '') +
      `<span class="n">${lead ? '·' : i - PERCUSSION_LEAD + 1}</span></div>`
    );
  }).join('');

  const bar = tempo.beatsPerBar;
  const realign = (PERCUSSION_BEATS * bar) / gcd(PERCUSSION_BEATS, bar);
  // Square means the word is a whole number of bars, not that it is one bar — at eight
  // counts against four it spans two, and saying "one word to the bar" there was simply
  // wrong on the page.
  const square = PERCUSSION_BEATS % bar === 0;
  const barsPerWord = PERCUSSION_BEATS / bar;
  const plural = (n: number) => (n === 1 ? '' : 's');

  need('pattern-note').innerHTML =
    `Callsign ${callsign} as a kit: the bass drum is the clock and lands on every count; a ` +
    'one <strong>adds a tom</strong> after it. Presence encoding rather than register — ' +
    'which works only because the kick articulates every count, so the frame never goes ' +
    `away. The first ${PERCUSSION_LEAD} counts are <strong>leading zeros</strong>, so ` +
    'every word opens on the same figure and the downbeat is audible before you have ' +
    'learned anything about the number — which is what a run of zeros before the payload ' +
    'is for: the receiver needs the edge, not the data.<br/>' +
    `${PERCUSSION_BEATS} counts against a ${bar}-count bar: ` +
    (square
      ? `<strong>square</strong> — the word is exactly ${barsPerWord} bar${plural(barsPerWord)}, ` +
        'so it opens on a downbeat every time.'
      : `the word returns to the downbeat every <strong>${realign / bar} bars</strong>, ` +
        `starting on ${realign / PERCUSSION_BEATS} different beats of the bar before it repeats.`) +
    ` One count is ${beatSeconds(tempo).toFixed(3)}s.` +
    (flam === 0
      ? ' <br/>Tom <strong>on top of</strong> its kick — the one setting that reads as a ' +
        'mistake rather than a choice.'
      : flam === 50
        ? ' <br/>Tom on the <strong>&</strong>: kick on the number, tom on the off. Tu-dum.'
        : ` <br/>Tom <strong>${flam}%</strong> of a count after its kick — ` +
          `${(beatSeconds(tempo) * flam / 100 * 1000).toFixed(0)} ms.`);
}

// ------------------------------------------------------------------------- the patch

const patchEl = need('patch');

/**
 * Names a patch without being able to restore one.
 *
 * A digest is one-way, so it cannot *be* the export — the fields above it are. What it is
 * good for is talking about a tuning: two people looking at `a3f21c88` are looking at the
 * same grid, and a patch that was meant to be the shipped one either matches `TEMPO` or
 * does not.
 */
async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
}

function literal(): string {
  const t = theme();
  return (
    `export const TEMPO: Tempo = { bpm: ${tempo.bpm}, beatsPerBar: ${tempo.beatsPerBar}, ` +
    `barsPerChord: ${tempo.barsPerChord} };\n` +
    `const PERCUSSION_LEVEL = ${(kit / 100).toFixed(2)};\n` +
    `const PERCUSSION_NOISE = ${(tomNoise / 100).toFixed(2)};\n` +
    `const TOM_OFFSET = ${(flam / 100).toFixed(2)};\n` +
    `export const DRAWBARS_DEFAULT = [${drawbars.map((d) => d.toFixed(2)).join(', ')}];\n` +
    `// ${NOTE_NAMES[keyPc]}${keyOctave}\n` +
    `{ root: ${t.root.toFixed(2)}, progression: [${progression.join(', ')}] }`
  );
}

async function renderPatch(): Promise<void> {
  const lit = literal();
  const id = await digest(lit);
  const shipped = tempo.bpm === TEMPO.bpm
    && tempo.barsPerChord === TEMPO.barsPerChord
;
  patchEl.textContent =
    `patch ${id}${shipped ? '  (this is what ships)' : '  (edited)'}\n\n${lit}\n\n${location.href}`;
}

need('copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(literal());
});

// ------------------------------------------------------------------------- deep links

/**
 * State lives in the hash rather than the query string, so stepping through the campaign
 * does not touch history and a particular audition stays a link you can send.
 */
function writeHash(): void {
  const parts = [
    `key=${NOTE_NAMES[keyPc]}${keyOctave}`,
    `prog=${progression.join('-')}`,
    `cs=${callsign}`,
    `y=${altitude}`,
  ];
  // The grid rides the hash so a tuning is a link, not a screenshot of three sliders.
  if (tempo.bpm !== TEMPO.bpm) parts.push(`bpm=${tempo.bpm}`);
  if (tempo.beatsPerBar !== TEMPO.beatsPerBar) parts.push(`beats=${tempo.beatsPerBar}`);
  if (tempo.barsPerChord !== TEMPO.barsPerChord) parts.push(`bars=${tempo.barsPerChord}`);
  parts.push(`kit=${kit}`, `tom=${tomNoise}`, `flam=${flam}`);
  if (drawbars.some((d) => d > 0)) parts.push(`bars9=${drawbars.map((d) => Math.round(d * 100)).join('.')}`);
  history.replaceState(null, '', `#${parts.join('&')}`);
  void renderPatch();
}

function readHash(): void {
  const hash = new URLSearchParams(location.hash.slice(1));
  const t = hash.get('track');
  if (t && t in THEMES) track = t as MusicTrack;

  const key = hash.get('key');
  const parsedKey = key?.match(/^([A-G]#?)(\d)$/);
  if (parsedKey) {
    const pc = NOTE_NAMES.indexOf(parsedKey[1] as (typeof NOTE_NAMES)[number]);
    if (pc >= 0) {
      keyPc = pc;
      keyOctave = Number(parsedKey[2]);
    }
  }
  const prog = hash.get('prog')?.split('-');
  if (prog?.length === 4 && prog.every((d) => d in DEGREES)) progression = prog as Degree[];
  const cs = Number(hash.get('cs'));
  if (Number.isInteger(cs) && cs >= 0 && cs < 32) callsign = cs;
  callsignIn.value = String(callsign);
  need('callsign-v').textContent = String(callsign);
  const y = Number(hash.get('y'));
  if (Number.isFinite(y) && y >= DEEPEST && y <= 1020) altitude = y;
  altitudeIn.value = String(altitude);
  tempo = {
    bpm: Number(hash.get('bpm')) || TEMPO.bpm,
    beatsPerBar: Number(hash.get('beats')) || TEMPO.beatsPerBar,
    barsPerChord: Number(hash.get('bars')) || TEMPO.barsPerChord,
  };
  const k = Number(hash.get('kit'));
  if (Number.isFinite(k) && k >= 0 && k <= 20) kit = k;
  const tn = Number(hash.get('tom'));
  if (Number.isFinite(tn) && tn >= 0 && tn <= 100) tomNoise = tn;
  const fl = Number(hash.get('flam'));
  if (Number.isFinite(fl) && fl >= 0 && fl <= 90) flam = fl;
  const db = hash.get('bars9')?.split('.').map(Number);
  if (db?.length === DRAWBARS.length && db.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
    drawbars = db.map((n) => n / 100);
  }
  composer.setTempo(tempo);
  composer.setPercussionLevel(kit / 100);
  composer.setPercussionNoise(tomNoise / 100);
  composer.setTomOffset(flam / 100);
  composer.setDrawbars(drawbars);
}

// Editing the hash in the address bar is a same-document navigation: nothing reloads, so
// without this the link only works on a cold load and silently does nothing afterwards.
window.addEventListener('hashchange', () => {
  readHash();
  if (ctx && composer.isActive) composer.setMissionContext(track, callsign);
  paintTracks();
  render();
});

readHash();
// Seeds the editor from the track only when the link did not carry a harmony of its own.
if (!location.hash.includes('key=')) loadTrack(track);
applyHarmony();
renderDerived();
renderDrawbars();
renderPattern();
renderLayers();
render();
void renderPatch();
// The progression moves on the audio clock and nothing tells the page when. Four times a
// second is well inside a 7-second step and cheap enough not to matter.
setInterval(render, 250);

// The same escape hatch `preview.ts` and `?debug=1` give: scripted auditioning from
// outside the page.
(window as unknown as { __synth: unknown }).__synth = {
  composer,
  sound,
  arm,
  toggle,
  ctx: () => ctx,
  master: () => master,
  applyTempo,
  tempo: () => tempo,
  applyAltitude,
  sounding,
  setDrawbars: (d: number[]) => {
    drawbars = d;
    composer.setDrawbars(drawbars);
    renderDrawbars();
  },
  applyHarmony,
  theme,
  setKey: (pc: number, oct: number) => {
    keyPc = pc;
    keyOctave = oct;
    applyHarmony();
  },
  setProgression: (p: Degree[]) => {
    progression = p;
    applyHarmony();
  },
  loadTrack,
};
