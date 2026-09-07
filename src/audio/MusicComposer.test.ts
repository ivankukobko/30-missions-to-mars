import { describe, it, expect } from 'vitest';
import {
  wobbleBar, identBit, layerMix, SKY,
  THEMES, DEGREES, DEGREE_NAMES, degreeName, keyHz,
  identStrike, PERCUSSION_BEATS, PERCUSSION_LEAD, IDENT_BITS, barSeconds, beatSeconds, TEMPO,
  type Sounding, type Chord,
} from './MusicComposer.ts';
import { CANYON } from '../world/CanyonSpec.ts';
import { LANDER } from '../entities/LanderBody.ts';
import { MISSION_COUNT } from '../campaign/Missions.ts';

/** The five bars of one mission's figure, `null` for a rest. */
function phrase(missionId: number) {
  return [0, 1, 2, 3, 4].map((bar) => wobbleBar(missionId, bar));
}

/** Just the divisions, rests as 0 — the shape of the groove at a glance. */
function cycles(missionId: number): number[] {
  return phrase(missionId).map((bar) => bar?.cycles ?? 0);
}

describe('wobbleBar', () => {
  it('reads the mission number most significant bit first', () => {
    // 16 is 10000: the stroke lands on the downbeat, not on the last bar.
    expect(cycles(16)).toEqual([4, 0, 0, 0, 0]);
    // 1 is 00001: the mirror image.
    expect(cycles(1)).toEqual([0, 0, 0, 0, 4]);
  });

  it('ratchets one division faster per consecutive set bit', () => {
    // 30 is 11110 — the build, then the drop.
    expect(cycles(30)).toEqual([4, 8, 12, 16, 0]);
  });

  it('restarts the ratchet after a rest, so a gapped number ticks instead of building', () => {
    // 21 is 10101: three separate strokes, none of them a build.
    expect(cycles(21)).toEqual([4, 0, 4, 0, 4]);
  });

  it('does not carry a run across the end of the word', () => {
    // 25 is 11001. The trailing bit must not join the leading pair to make a run of three
    // on the repeat — the figure has to sound the same every time round.
    expect(cycles(25)).toEqual([4, 8, 0, 0, 4]);
  });

  it('repeats every five bars', () => {
    for (let mission = 1; mission <= MISSION_COUNT; mission++) {
      for (let bar = 0; bar < 5; bar++) {
        expect(wobbleBar(mission, bar + 5)).toEqual(wobbleBar(mission, bar));
        expect(wobbleBar(mission, bar + 40)).toEqual(wobbleBar(mission, bar));
      }
    }
  });

  it('drops to the subtonic only on the last set bit of a run', () => {
    // 30 is 11110: three bars held on the root, then the fall out of the phrase.
    expect(phrase(30).map((bar) => bar?.offset ?? null)).toEqual([0, 0, 0, -2, null]);
  });

  it('gives every campaign mission at least one stroke', () => {
    // A mission whose word is all zeroes would play no bass at all. Mission ids start at
    // 1, so this holds — but it is the assumption the whole figure rests on.
    for (let mission = 1; mission <= MISSION_COUNT; mission++) {
      expect(phrase(mission).some((bar) => bar !== null)).toBe(true);
    }
  });

  it('never asks for a division the ratchet table does not have', () => {
    for (let mission = 1; mission <= MISSION_COUNT; mission++) {
      for (const bar of phrase(mission)) {
        if (!bar) continue;
        expect([4, 8, 12, 16]).toContain(bar.cycles);
        // Whole sweeps per bar, or consecutive bars stop meeting at zero and the curve
        // steps at the bar line.
        expect(Number.isInteger(bar.cycles)).toBe(true);
      }
    }
  });
});

/**
 * The word itself, independent of which instrument reads it. `identStrike` builds the kit
 * pattern on top of this, and the epilogue's beacon still sounds it pitched.
 */
describe('the callsign word', () => {
  it('reads the mission number most significant bit first', () => {
    const word = (id: number) => [0, 1, 2, 3, 4].map((i) => (identBit(id, i) ? 1 : 0)).join('');
    expect(word(1)).toBe('00001');
    expect(word(16)).toBe('10000');
    expect(word(21)).toBe('10101');
    expect(word(29)).toBe('11101');
  });

  it('spells every campaign mission exactly, and fits in five bits', () => {
    // Round-trip rather than spot checks: the five positions the melody sounds have to
    // reconstruct the mission number and nothing else, which is what pins both the MSB
    // ordering and the word length. A sixth mission past 31 would silently alias onto a
    // lower one, and the melody would sound like a run the player had already flown.
    for (let mission = 1; mission <= MISSION_COUNT; mission++) {
      let back = 0;
      for (let i = 0; i < 5; i++) back = (back << 1) | (identBit(mission, i) ? 1 : 0);
      expect(back, `mission ${mission}`).toBe(mission);
    }
    expect(MISSION_COUNT).toBeLessThan(32);
  });
});

/** A position in the canyon, defaulting to open sky. */
function at(over: Partial<Sounding> = {}): Sounding {
  return { ...SKY, ...over };
}

describe('layerMix', () => {
  it('gives the sky its air and withholds the hole its sub', () => {
    const sky = layerMix(SKY);
    expect(sky.air).toBe(1);
    expect(sky.sub).toBe(0);
    // The triad is the harmony and is never off, only quieter.
    expect(sky.body).toBeGreaterThan(0);
    expect(sky.body).toBeLessThan(1);
  });

  it('takes the air away as the canyon closes over you', () => {
    const rim = layerMix(at({ altitude: CANYON.RIM_Y }));
    const half = layerMix(at({ altitude: CANYON.RIM_Y / 2 }));
    const floor = layerMix(at({ altitude: CANYON.FLOOR_Y }));
    expect(rim.air).toBe(1);
    expect(half.air).toBeLessThan(rim.air);
    expect(floor.air).toBeLessThan(half.air);
    // Not to nothing: a voice that leaves entirely reads as a filter shutting.
    expect(floor.air).toBeGreaterThan(0);
  });

  it('swells the body against the ground below, not against the floor', () => {
    // A raised deck: high in the canyon, and about to touch something all the same. The
    // whole reason these are two numbers rather than one.
    const onDeck = layerMix(at({ altitude: 200, heightAboveGround: 5 }));
    const sameHeightOverNothing = layerMix(at({ altitude: 200 }));
    expect(onDeck.body).toBeGreaterThan(sameHeightOverNothing.body);
    expect(onDeck.body).toBe(1);
    // And the deck is still high enough to keep its sky.
    expect(onDeck.air).toBeGreaterThan(0.5);
  });

  it('is full body by the time the legs come out', () => {
    expect(layerMix(at({ heightAboveGround: LANDER.GEAR_DEPLOY_HEIGHT })).body).toBe(1);
  });

  it('brings the sub in at the floor and fills it in the shaft', () => {
    const above = layerMix(at({ altitude: 300 }));
    const floor = layerMix(at({ altitude: 0 }));
    const shaft = layerMix(at({ altitude: -160, abyssProximity: 0.5 }));
    const bottom = layerMix(at({ altitude: -320, abyssProximity: 1 }));
    expect(above.sub).toBe(0);
    expect(floor.sub).toBeGreaterThan(0);
    expect(shaft.sub).toBeGreaterThan(floor.sub);
    expect(bottom.sub).toBe(1);
  });

  it('never sends a gain outside the range a GainNode should see', () => {
    for (let altitude = -400; altitude <= 1100; altitude += 10) {
      for (const hag of [0, 5, 20, 140, 400, Infinity]) {
        const abyss = altitude < 0 ? Math.min(1, -altitude / 320) : 0;
        const mix = layerMix({ altitude, heightAboveGround: hag, abyssProximity: abyss });
        for (const v of [mix.sub, mix.body, mix.air]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('the chord vocabulary', () => {
  it('names every degree it defines, by value rather than by identity', () => {
    for (const d of DEGREE_NAMES) {
      // A fresh array, which is what `synth.html` builds — identity lookup returned
      // nothing for these and the editor could not name what it had just made.
      expect(degreeName([...DEGREES[d]] as unknown as Chord)).toBe(d);
    }
  });

  it('reports an unknown triad as its offsets rather than inventing a name', () => {
    expect(degreeName([0, 4, 8])).toBe('[0,4,8]');
  });

  it('spells every degree as absolute offsets from the tonic, not as an inversion', () => {
    // The voicing doubles the *first* tone an octave down and up, so a chord whose first
    // tone was not its own root would put the sub and the air on the wrong note.
    for (const d of DEGREE_NAMES) {
      const [a, b, c] = DEGREES[d];
      expect(b - a).toBeGreaterThan(0);
      expect(c - b).toBeGreaterThan(0);
      // A triad, so the outer interval is a fifth-ish: never wider than an octave.
      expect(c - a).toBeLessThanOrEqual(12);
    }
  });

  it('names the shipped roots, which were only ever a trailing comment', () => {
    // A1, C1, D1 — the three keys `docs/sound.md` claims. Pinned so the comment and the
    // frequency cannot come apart.
    expect(THEMES.outpost.root).toBeCloseTo(keyHz(9, 1), 2);
    expect(THEMES.helion.root).toBeCloseTo(keyHz(0, 1), 2);
    expect(THEMES.kessler.root).toBeCloseTo(keyHz(2, 1), 2);
  });

  it("makes Ixion's tonic Kessler's dominant — a fifth apart", () => {
    // A is the V of D, and Kessler's progression opens on A major: it begins where Ixion
    // lives. This replaced a claim that Kessler was the relative minor of Ixion, which was
    // true of the old F#1 root and is not true of this one.
    expect(12 * Math.log2(THEMES.outpost.root / THEMES.kessler.root)).toBeCloseTo(7, 2);
    expect(THEMES.kessler.progression[0][0] % 12).toBe(7);
  });

  it('lets only Kessler reach its own tonic, and only on the last step', () => {
    // The set's whole argument, and it fell out of three patches written separately rather
    // than being designed as a set — so it is worth a test that would notice it going away.
    const reaches = (t: keyof typeof THEMES) =>
      THEMES[t].progression.map((c) => c[0] % 12 === 0);
    expect(reaches('outpost')).toEqual([false, false, false, false]);
    expect(reaches('helion')).toEqual([false, false, false, false]);
    expect(reaches('kessler')).toEqual([false, false, false, true]);
  });

  it('moves every Helion chord in exact parallel — which is why it sounds mechanical', () => {
    const prog = THEMES.helion.progression;
    for (let i = 0; i < 4; i++) {
      const a = prog[i];
      const b = prog[(i + 1) % 4];
      const deltas = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      expect(new Set(deltas).size).toBe(1);
    }
    // And all four are the same shape, a minor triad, which is what is being translated.
    for (const c of prog) expect([c[1] - c[0], c[2] - c[1]]).toEqual([3, 4]);
  });

  it('still spells the shipped progressions the way the design record writes them', () => {
    const spell = (t: keyof typeof THEMES) => THEMES[t].progression.map(degreeName).join(' ');
    expect(spell('outpost')).toBe('vi ii iii V');
    expect(spell('helion')).toBe('iii iv ii vi');
    expect(spell('kessler')).toBe('V ii IV I');
  });
});

/** The kit pattern for one callsign, as a readable string. */
function kit(missionId: number): string {
  return Array.from({ length: PERCUSSION_BEATS }, (_, i) =>
    identStrike(missionId, i) === 'tom' ? 'T' : 'B',
  ).join('');
}

describe('identStrike', () => {
  it('opens every word on the same run of bass drums, whatever the callsign', () => {
    // The lead-in is the whole point of the extra counts: the downbeat is audible before
    // the listener has learned anything about the number.
    for (let m = 0; m < 32; m++) {
      for (let i = 0; i < PERCUSSION_LEAD; i++) expect(identStrike(m, i)).toBe('kick');
    }
  });

  it('reads the callsign most significant bit first, a tom for a one', () => {
    // 16 is 10000, so 000 10000: three lead kicks, a tom, then nothing but kicks.
    expect(kit(16)).toBe('BBBTBBBB');
    // 1 is 00001, so 000 00001: the tom lands on the last count of the word.
    expect(kit(1)).toBe('BBBBBBBT');
    // 29 is 11101, so 000 11101.
    expect(kit(29)).toBe('BBBTTTBT');
  });

  it('is exactly the melody encoding on a different instrument, offset by the lead', () => {
    // The whole claim of the percussion part: same word, same registers, so a player who
    // can count one can count the other.
    for (let m = 0; m < 32; m++) {
      for (let i = 0; i < IDENT_BITS; i++) {
        expect(identStrike(m, i + PERCUSSION_LEAD) === 'tom').toBe(identBit(m, i));
      }
    }
  });

  it('repeats every eight counts and never wraps a run across the word', () => {
    for (let m = 0; m < 32; m++) {
      for (let i = 0; i < PERCUSSION_BEATS * 3; i++) {
        expect(identStrike(m, i)).toBe(identStrike(m, i + PERCUSSION_BEATS));
      }
      // Negative indices are reachable when the clock resyncs backwards.
      expect(identStrike(m, -1)).toBe(identStrike(m, PERCUSSION_BEATS - 1));
    }
  });

  it('never gives two missions the same kit pattern', () => {
    // Parity is derived, so it cannot collide two words that were already distinct — but
    // a bug that dropped a bit would, silently, and only for some pairs.
    const seen = new Set<string>();
    for (let m = 0; m < 32; m++) seen.add(kit(m));
    expect(seen.size).toBe(32);
  });
});

describe('the meter', () => {
  it('measures a bar in counts, so 6/8 is six of them', () => {
    const six = { ...TEMPO, beatsPerBar: 6 };
    expect(beatSeconds(six)).toBeCloseTo(60 / TEMPO.bpm, 6);
    expect(barSeconds(six)).toBeCloseTo(beatSeconds(six) * 6, 6);
  });

  it('makes the eight-count word square against common time — two bars to a word', () => {
    const bar = (n: number) => barSeconds({ ...TEMPO, beatsPerBar: n }) / beatSeconds(TEMPO);
    expect(PERCUSSION_BEATS % bar(4)).toBe(0);
    expect(PERCUSSION_BEATS / bar(4)).toBe(2);
    expect(PERCUSSION_BEATS % bar(8)).toBe(0);
    // Six is where it stops being square, which is what that slider is for.
    expect(PERCUSSION_BEATS % bar(6)).not.toBe(0);
  });

  it('fits the progression a whole number of times', () => {
    // Sixteen bars of four is sixty-four counts, which is eight words exactly — so the
    // word starts in the same place on every turn of the harmony.
    const countsPerCycle = TEMPO.beatsPerBar * TEMPO.barsPerChord * 4;
    expect(countsPerCycle % PERCUSSION_BEATS).toBe(0);
  });
});
