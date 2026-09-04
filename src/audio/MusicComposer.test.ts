import { describe, it, expect } from 'vitest';
import { wobbleBar, identBit, IDENT_HIGH, IDENT_LOW } from './MusicComposer.ts';
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
 * The other encoding of the same number: the melody, which sounds every bit rather than
 * only the set ones. See `emitIdent`.
 */
describe('the ident melody', () => {
  it('reads the mission number most significant bit first', () => {
    const word = (id: number) => [0, 1, 2, 3, 4].map((i) => (identBit(id, i) ? 1 : 0)).join('');
    expect(word(1)).toBe('00001');
    expect(word(16)).toBe('10000');
    expect(word(21)).toBe('10101');
    expect(word(29)).toBe('11101');
  });

  it('separates the two bits by exactly an octave', () => {
    // The interval is the whole encoding. Anything inside an octave reads as melody, and a
    // reversed pair would sound like a perfectly plausible figure on every mission — there
    // are no rests left to notice it by now that a zero is sounded.
    expect(IDENT_HIGH - IDENT_LOW).toBe(12);
    expect(IDENT_HIGH).toBeGreaterThan(IDENT_LOW);
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
