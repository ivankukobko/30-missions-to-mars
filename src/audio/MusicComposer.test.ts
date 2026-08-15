import { describe, it, expect } from 'vitest';
import { wobbleBar } from './MusicComposer.ts';
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
