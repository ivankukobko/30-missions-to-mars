import { describe, it, expect } from 'vitest';
import { checkLayout, resolveLayout } from './Layout.ts';
import type { Prop } from '../world/Colony.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';

const pad = (id: string, x: number, width = 16, y?: number): Prop => ({
  kind: 'pad',
  id,
  corp: 'outpost',
  x,
  width,
  ...(y === undefined ? {} : { y }),
});

const mast = (x: number, topY = 60, corp: Prop['corp'] = 'outpost'): Prop => ({
  kind: 'mast',
  corp,
  x,
  topY,
});

const tower = (x: number, width = 11, topY = 90): Prop => ({
  kind: 'tower',
  corp: 'helion',
  x,
  width,
  topY,
});

const gantry = (x1: number, x2: number, y: number): Prop => ({
  kind: 'gantry',
  corp: 'helion',
  x1,
  x2,
  y,
});

/**
 * A fully occupied cols×rows colony anchored at `x`, growing toward +x. The grid is
 * real, not a stub — the deck/corridor rules judge a colony by its occupied columns
 * (see `colonyColumns`), so a fixture whose `footprintX` claims ground its cells never
 * reach would test nothing.
 */
const colony = (x: number, cols = 1, rows = 1): Prop => ({
  kind: 'colony',
  corp: 'kessler',
  x,
  cellSize: 12,
  direction: 1,
  grid: {
    cols,
    rows,
    anchorCol: 0,
    cells: Array.from({ length: rows }, () => Array(cols).fill('room' as const)),
    tubes: [],
  },
  footprintX: [x - 6, x + (cols - 1) * 12 + 6],
  height: rows * 12,
});

const xOf = (p: Prop): number => ('x' in p ? p.x : (p.x1 + p.x2) / 2);

describe('checkLayout', () => {
  it('passes a world where nothing conflicts', () => {
    const props = [pad('a', 0), mast(40), tower(-50)];

    expect(checkLayout(props)).toEqual([]);
  });

  it('flags a mast planted through a pad deck', () => {
    const violations = checkLayout([pad('a', 0, 16), mast(2)]);

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('deck');
    expect(violations[0].pad).toBe('a');
  });

  it('flags a gantry hanging in a pad approach corridor', () => {
    const violations = checkLayout([pad('a', 0), gantry(-10, 10, 40)]);

    expect(violations.some((v) => v.rule === 'corridor')).toBe(true);
  });

  it('allows a span that clears the corridor to either side', () => {
    // CORE_HALF is 5 and MARGIN 1.2, so a span starting at 7 is clear.
    expect(checkLayout([pad('a', 0), gantry(7, 30, 40)])).toEqual([]);
  });

  it('allows a span far enough above to read as scenery', () => {
    // CORRIDOR_HEIGHT is 130.
    expect(checkLayout([pad('a', 0), gantry(-10, 10, 200)])).toEqual([]);
  });

  it('flags a colony with a column standing through a pad deck', () => {
    // Two columns anchored at -20 put the second at -8; its 12-wide cell plus margin
    // reaches over the pad slab (-8..8 for a 16-wide pad), and a ground colony always
    // rises from the floor through the deck plane — the same rule a mast planted
    // through the deck trips.
    const violations = checkLayout([pad('a', 0), colony(-20, 2, 1)]);

    expect(violations.some((v) => v.rule === 'deck' && v.prop.startsWith('colony'))).toBe(true);
  });

  it('flags a colony whose column reaches into a pad approach corridor', () => {
    // An 8-wide pad's slab spans -4..4 while its core spans -5..5 (CORE_HALF). A
    // single column at -12 ends at -4.8 with margin: clear of the slab, inside the
    // core — the corridor rule alone has to catch it.
    const violations = checkLayout([pad('a', 0, 8), colony(-12, 1, 1)]);

    expect(violations.some((v) => v.rule === 'corridor' && v.prop.startsWith('colony'))).toBe(true);
  });

  it('clears a colony whose columns all stay outside every pad corridor', () => {
    // Columns at 20 and 32 — the nearest edge sits at 12.8 with margin, comfortably
    // clear of pad "a"'s core (-5..5).
    expect(checkLayout([pad('a', 0), colony(20, 2, 3)])).toEqual([]);
  });

  it('exempts a pad from its own deck', () => {
    const props: Prop[] = [
      { kind: 'platform', corp: 'helion', x: 20, y: 40, width: 21 },
      pad('deck', 20, 14, 41),
    ];

    expect(checkLayout(props)).toEqual([]);
  });

  /**
   * A pad at the bottom of a dig is roofed on purpose. Its vertical corridor stops at
   * the ceiling, and the way in is around the lip instead.
   */
  it('stops the corridor rule at a cave roof', () => {
    const props: Prop[] = [
      pad('cavern', -33, 12, -46),
      { kind: 'caveRoof', corp: 'helion', x: -33, halfWidth: 9, y: -12 },
      gantry(-40, -26, 60),
    ];

    expect(checkLayout(props)).toEqual([]);
  });

  /**
   * Documents a real limit of the model rather than asserting it is right.
   *
   * `spanY` reads a pad without an explicit `y` as sitting at 0, because the terrain
   * height it actually rests on is a function of the seed and unknown here. So a pad at
   * the bottom of an excavation is modelled 46 units above where it really is, and a
   * cave roof over it registers as *below* the deck — which means the exemption above
   * cannot fire for a ground pad, and its corridor is enforced through the roof.
   *
   * Harmless while nothing is authored into that corridor (see the campaign test, which
   * is clean), but it is why the exemption looks untested from the campaign side.
   */
  it('does not see a cave roof over a pad that rests on dug ground', () => {
    const props: Prop[] = [
      pad('cavern', -33, 12),
      { kind: 'caveRoof', corp: 'helion', x: -33, halfWidth: 9, y: -12 },
      gantry(-40, -26, 60),
    ];

    const violations = checkLayout(props);

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('corridor');
  });

  it('allows pads stacked down one shaft', () => {
    // kessler-shaft, -ledge and -deep are deliberately one above another.
    const props = [pad('shaft', 10, 12), pad('ledge', 10, 11, -45), pad('deep', 10, 11, -141)];

    expect(checkLayout(props)).toEqual([]);
  });

  it('flags a mast standing in an excavation mouth', () => {
    const digs: Excavation[] = [{ x: 10, halfWidth: 12, depth: 58 }];
    // The west lip is at -2; LANE_WIDTH 5 and LANE_OUTSIDE 2 reserve -4..3.
    const violations = checkLayout([mast(0)], digs);

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('mouth');
  });

  it('lets a gantry pass over an excavation mouth', () => {
    const digs: Excavation[] = [{ x: 10, halfWidth: 12, depth: 58 }];

    expect(checkLayout([gantry(-4, 3, 40)], digs)).toEqual([]);
  });

  it('names the mission that introduced an offending prop when told', () => {
    const offender = mast(2);
    const owner = new Map<Prop, number>([[offender, 17]]);

    const violations = checkLayout([pad('a', 0), offender], [], owner);

    expect(violations[0].mission).toBe(17);
  });

  it('never blames the radar, which carries no collider', () => {
    const props: Prop[] = [pad('a', 0), { kind: 'radar', corp: 'outpost', x: 0 }];

    expect(checkLayout(props)).toEqual([]);
  });

  /**
   * Regression: the radar against a pad *below* the canyon floor.
   *
   * A zero-width span was relied on to exempt the radar, and it does not — `overlaps`
   * counts a point strictly inside an interval as overlapping. Against a pad at y=0 the
   * rule missed it anyway, because the radar's modelled top (-6) is under the deck; it
   * only fired once the campaign put pads down a shaft. So the exact shape that broke is
   * a mast position near a sunken pad's centreline, which is `kessler-ledge` from
   * mission 21 with the player's radar planted near x=10.
   */
  it('never blames the radar for a pad sunk down a shaft either', () => {
    const props: Prop[] = [
      pad('kessler-ledge', 10, 11, -45),
      { kind: 'radar', corp: 'outpost', x: 7 },
    ];

    expect(checkLayout(props)).toEqual([]);
  });

  it('never blames the radar wherever the player planted it', () => {
    const sunken = pad('deep', 10, 11, -141);

    for (let x = -60; x <= 60; x += 0.5) {
      const props: Prop[] = [sunken, { kind: 'radar', corp: 'outpost', x }];
      expect(checkLayout(props), `radar at x=${x}`).toEqual([]);
    }
  });
});

/**
 * Moving structures are judged by the airspace they sweep, not by where they rest.
 *
 * This is the trap that makes animated hardware dangerous to add: a gantry authored well
 * clear of a pad, whose stroke carries it straight through that pad's approach corridor,
 * is invisible to every static reading — and the mission becomes unflyable in a way
 * nothing in the source connects to the line that caused it.
 */
describe('swept extents', () => {
  const travelling = (x1: number, x2: number, y: number, motion: Prop extends never ? never : { dx?: number; dy?: number; period: number }): Prop => ({
    kind: 'gantry',
    corp: 'helion',
    x1,
    x2,
    y,
    motion,
  });

  it('passes a moving span whose whole stroke stays clear', () => {
    // Rests at 20..40 and travels 8 either way, so it never comes within the corridor.
    expect(checkLayout([pad('a', 0), travelling(20, 40, 50, { dx: 8, period: 12 })])).toEqual([]);
  });

  it('catches a span that rests clear but travels through the corridor', () => {
    // Same span, now with a stroke long enough to reach over the pad.
    const violations = checkLayout([pad('a', 0), travelling(20, 40, 50, { dx: 20, period: 12 })]);

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('corridor');
  });

  it('catches a deck that rises into a corridor it does not rest in', () => {
    // Vertical travel matters too: CORRIDOR_HEIGHT is 130, so a span resting at 200 is
    // scenery until it descends.
    expect(checkLayout([pad('a', 0), travelling(-10, 10, 200, { dy: 10, period: 9 })])).toEqual([]);

    const violations = checkLayout([pad('a', 0), travelling(-10, 10, 200, { dy: 90, period: 9 })]);
    expect(violations.some((v) => v.rule === 'corridor')).toBe(true);
  });

  it('catches a moving deck that sweeps across a pad footprint', () => {
    const deck: Prop = {
      kind: 'platform',
      corp: 'helion',
      x: 30,
      y: 1,
      width: 10,
      motion: { dx: 25, period: 10 },
    };

    const violations = checkLayout([pad('a', 0, 16), deck]);

    expect(violations.some((v) => v.rule === 'deck')).toBe(true);
  });

  it('treats a prop with no motion exactly as before', () => {
    const still: Prop = { kind: 'gantry', corp: 'helion', x1: 20, x2: 40, y: 50 };
    const zero: Prop = { kind: 'gantry', corp: 'helion', x1: 20, x2: 40, y: 50, motion: { period: 10 } };

    expect(checkLayout([pad('a', 0), still])).toEqual(checkLayout([pad('a', 0), zero]));
  });

  it('leaves a moving structure alone when its whole stroke is clear', () => {
    // The resolver's contract: anything that already clears the rules stays exactly
    // where it was authored. That has to hold for the swept extent too, or adding motion
    // to a prop would start relocating it for no reason.
    const sweeper = travelling(-30, -10, 40, { dx: 2, period: 12 });
    const resolved = resolveLayout([pad('a', 0), sweeper]);

    expect(resolved).toEqual([pad('a', 0), sweeper]);
    expect(checkLayout(resolved)).toEqual([]);
  });

  /**
   * A travelling gantry's span is the stroke of a machine on a rail. Trimming it
   * shortens the run and sliding it moves the rail, so the resolver reports it instead
   * — the same treatment towers and platforms get, and for the same reason.
   */
  it('reports rather than reshapes a travelling span that intrudes', () => {
    const sweeper = travelling(-30, -10, 40, { dx: 25, period: 12 });
    const resolved = resolveLayout([pad('a', 0), sweeper]);

    expect(resolved).toContain(sweeper);
    expect(checkLayout(resolved).some((v) => v.rule === 'corridor')).toBe(true);
  });

  it('still trims a fixed span in the same position', () => {
    const fixed: Prop = { kind: 'gantry', corp: 'helion', x1: -30, x2: 8, y: 40 };
    const resolved = resolveLayout([pad('a', 0), fixed]);

    expect(resolved).not.toContain(fixed);
    expect(checkLayout(resolved)).toEqual([]);
  });
});

describe('resolveLayout', () => {
  it('leaves a legal ledger exactly as authored', () => {
    const props = [pad('a', 0), mast(40), tower(-50), gantry(30, 50, 80)];

    expect(resolveLayout(props)).toEqual(props);
  });

  it('produces a world the checker passes', () => {
    const props = [pad('a', 0), mast(2), mast(-3), gantry(-12, 12, 40)];

    expect(checkLayout(resolveLayout(props))).toEqual([]);
  });

  /**
   * Idempotence is what makes the resolver safe to run wherever it is needed. Game and
   * Inspector both call `worldAt`, and if a second pass moved anything, the readout
   * would describe a different colony from the one being flown.
   */
  it('is idempotent', () => {
    const props = [pad('a', 0), pad('b', 30, 12), mast(1), mast(28), gantry(-14, 14, 50)];

    const once = resolveLayout(props);
    const twice = resolveLayout(once);

    expect(twice).toEqual(once);
  });

  it('is deterministic across runs', () => {
    const props = [pad('a', 0), mast(2), mast(-1), mast(4)];

    expect(resolveLayout(props)).toEqual(resolveLayout(props));
  });

  it('does not mutate the ledger it was given', () => {
    const offender = mast(2);
    const props = [pad('a', 0), offender];
    const before = { ...offender };

    resolveLayout(props);

    expect(offender).toEqual(before);
    expect(props).toHaveLength(2);
  });

  it('moves an intruding mast as little as the rules allow', () => {
    const resolved = resolveLayout([pad('a', 0, 16), mast(2)]);
    const moved = resolved.find((p) => p.kind === 'mast')!;

    expect(xOf(moved)).not.toBe(2);
    // Clear of the pad, but nowhere near the far side of the canyon.
    expect(Math.abs(xOf(moved))).toBeLessThan(26);
    expect(checkLayout(resolved)).toEqual([]);
  });

  it('sends a corp mast to its own side of the canyon', () => {
    const helion = resolveLayout([pad('a', 0, 16), mast(0, 60, 'helion')]);
    const kessler = resolveLayout([pad('a', 0, 16), mast(0, 60, 'kessler')]);

    expect(xOf(helion.find((p) => p.kind === 'mast')!)).toBeLessThan(0);
    expect(xOf(kessler.find((p) => p.kind === 'mast')!)).toBeGreaterThan(0);
  });

  it('does not stack two relocated masts on the same spot', () => {
    const resolved = resolveLayout([pad('a', 0, 16), mast(1), mast(-1), mast(2)]);
    const xs = resolved.filter((p) => p.kind === 'mast').map(xOf);

    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        expect(Math.abs(xs[i] - xs[j]), `masts at ${xs[i]} and ${xs[j]}`).toBeGreaterThan(1.5);
      }
    }
  });

  it('does not place a relocated mast through a tower', () => {
    // The tower intrudes and is left where it is; the mast must still avoid it.
    const resolved = resolveLayout([pad('a', 0, 16), tower(9, 11), mast(1)]);
    const moved = xOf(resolved.find((p) => p.kind === 'mast')!);

    expect(Math.abs(moved - 9)).toBeGreaterThan(11 / 2);
  });

  it('trims a gantry back to the corridor edge rather than sliding it', () => {
    const resolved = resolveLayout([pad('a', 0), gantry(-40, 8, 40)]);
    const trimmed = resolved.find((p) => p.kind === 'gantry')!;

    expect(trimmed.kind).toBe('gantry');
    if (trimmed.kind !== 'gantry') return;
    // Kept the long western part, retreated from the corridor at x >= -6.2.
    expect(Math.min(trimmed.x1, trimmed.x2)).toBe(-40);
    expect(Math.max(trimmed.x1, trimmed.x2)).toBeLessThanOrEqual(-5 - 1.2);
    expect(checkLayout(resolved)).toEqual([]);
  });

  it('slides a gantry that cannot survive trimming, keeping its length', () => {
    // Centred on the corridor with nothing worth keeping either side.
    const original = gantry(-5, 5, 40);
    const resolved = resolveLayout([pad('a', 0), original]);
    const moved = resolved.find((p) => p.kind === 'gantry')!;

    if (moved.kind !== 'gantry') throw new Error('expected a gantry');
    expect(Math.abs(moved.x2 - moved.x1)).toBeCloseTo(10, 6);
    expect(checkLayout(resolved)).toEqual([]);
  });

  it('reports rather than moves load-bearing structures', () => {
    // A platform is bolted to its tower: sliding it silently tears the deck off its
    // support, so the resolver leaves it and the check complains instead.
    const platform: Prop = { kind: 'platform', corp: 'helion', x: 0, y: 40, width: 20 };
    const resolved = resolveLayout([pad('a', 0, 16, 40), platform]);

    expect(resolved).toContain(platform);
  });

  it('reports rather than moves an intruding colony — there is no cheap way to slide a grown structure', () => {
    // Not a scenario `Missions.synthesizeColonies` should ever produce (colonies are
    // generated safe-by-construction against exactly this test), but the resolver's
    // own contract still has to hold for whatever a colony prop happens to be: it
    // falls into the same "report, don't move" bucket as a tower or a platform.
    const c = colony(-20, 2, 1);
    const resolved = resolveLayout([pad('a', 0), c]);

    expect(resolved).toContain(c);
  });

  it('keeps masts out of excavation mouths', () => {
    const digs: Excavation[] = [{ x: 10, halfWidth: 12, depth: 58 }];
    const resolved = resolveLayout([pad('a', -30), mast(0)], digs);

    expect(checkLayout(resolved, digs)).toEqual([]);
  });

  it('preserves the count and kinds of everything in the ledger', () => {
    const props = [pad('a', 0), mast(1), mast(-2), tower(-50), gantry(-6, 6, 50)];
    const resolved = resolveLayout(props);

    expect(resolved).toHaveLength(props.length);
    const kinds = (list: Prop[]) => list.map((p) => p.kind).sort();
    expect(kinds(resolved)).toEqual(kinds(props));
  });

  it('handles an empty ledger', () => {
    expect(resolveLayout([])).toEqual([]);
    expect(checkLayout([])).toEqual([]);
  });
});
