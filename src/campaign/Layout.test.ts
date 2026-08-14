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

const caveRoof = (x: number, halfWidth: number, y: number): Prop => ({
  kind: 'caveRoof',
  corp: 'helion',
  x,
  halfWidth,
  y,
});

const radar = (x: number): Prop => ({ kind: 'radar', corp: 'outpost', x });

/**
 * A fully occupied cols×rows colony whose lowest-left cell centre sits at `x`, row 0
 * centred on world y=0 — the same place production puts it, since `FLOOR_BASE` is -6 and
 * a cell is 12 tall, so row 0 spans -6..6 and rises from the floor through a deck plane
 * at y=0. Real cells, not a stub: the deck and corridor rules judge a colony cell by
 * cell (see `colonyCells`), so a fixture whose `footprintX` claims ground its cells
 * never reach would test nothing.
 */
const colony = (x: number, cols = 1, rows = 1): Prop => {
  const cells = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      // z=0 throughout: the play plane is the only layer `checkLayout` judges, so a
      // fixture built anywhere else would be invisible to every rule under test.
      cells.push({ x: x + c * 12, y: r * 12, z: 0, links: 0, scaffold: false });
    }
  }
  return {
    kind: 'colony',
    corp: 'kessler',
    cellSize: 12,
    cells,
    footprintX: [x - 6, x + (cols - 1) * 12 + 6],
    spanY: [-6, -6 + rows * 12],
  };
};

describe('checkLayout', () => {
  it('passes a world where nothing conflicts', () => {
    const props = [pad('a', 0), colony(40, 2, 3)];

    expect(checkLayout(props)).toEqual([]);
  });

  it('flags a colony with a column standing through a pad deck', () => {
    // Two columns anchored at -20 put the second at -8; its 12-wide cell plus margin
    // reaches over the pad slab (-8..8 for a 16-wide pad), and a ground colony always
    // rises from the floor through the deck plane.
    const violations = checkLayout([pad('a', 0), colony(-20, 2, 1)]);

    expect(violations.some((v) => v.rule === 'deck' && v.prop.startsWith('colony'))).toBe(true);
  });

  it('flags a colony whose column reaches into a pad approach corridor', () => {
    // Pad width 8 (footprint -4..4, core -5..5) with a column at -10 (spans -16..-4)
    // reaching into the core.
    const violations = checkLayout([pad('a', 0, 8), colony(-10, 1, 1)]);

    expect(violations.some((v) => v.rule === 'corridor' && v.prop.startsWith('colony'))).toBe(
      true,
    );
  });

  it('clears a colony whose columns all stay outside every pad corridor', () => {
    // Columns at 20 and 32 — the nearest edge sits at 12.8 with margin, comfortably
    // clear of pad "a"'s core (-5..5).
    expect(checkLayout([pad('a', 0), colony(20, 2, 3)])).toEqual([]);
  });

  /**
   * A pad at the bottom of a dig is roofed on purpose. Its vertical corridor stops at
   * the ceiling, and the way in is around the lip instead — this just confirms a
   * properly-ceilinged pad and its own roof never flag each other.
   */
  it('stops the corridor rule at a cave roof', () => {
    const props = [pad('cavern', -33, 12, -46), caveRoof(-33, 9, -12)];

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
    // Pad width 8 (footprint -37..-29) with a column at -45: clear of the footprint
    // (deck rule silent) but reaching into the core -38..-28 with margin (corridor
    // rule catches it) — the same offset the corridor-only test above uses.
    const props = [pad('cavern', -33, 8), caveRoof(-33, 9, -12), colony(-43, 1, 1)];

    const violations = checkLayout(props);

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('corridor');
  });

  it('allows pads stacked down one shaft', () => {
    // kessler-shaft, -ledge and -deep are deliberately one above another.
    const props = [pad('shaft', 10, 12), pad('ledge', 10, 11, -45), pad('deep', 10, 11, -141)];

    expect(checkLayout(props)).toEqual([]);
  });

  it('names the mission that introduced an offending prop when told', () => {
    const offender = colony(-20, 2, 1);
    const owner = new Map<Prop, number>([[offender, 17]]);

    const violations = checkLayout([pad('a', 0), offender], [], owner);

    expect(violations[0].mission).toBe(17);
  });

  it('never blames the radar, which carries no collider', () => {
    expect(checkLayout([pad('a', 0), radar(0)])).toEqual([]);
  });

  /**
   * Regression: the radar against a pad *below* the canyon floor.
   *
   * A zero-width span was relied on to exempt the radar, and it does not — `overlaps`
   * counts a point strictly inside an interval as overlapping. Against a pad at y=0 the
   * rule missed it anyway, because the radar's modelled top (-6) is under the deck; it
   * only fired once the campaign put pads down a shaft. So the exact shape that broke is
   * a radar position near a sunken pad's centreline, which is `kessler-ledge` from
   * mission 21 with the player's radar planted near x=10.
   */
  it('never blames the radar for a pad sunk down a shaft either', () => {
    expect(checkLayout([pad('kessler-ledge', 10, 11, -45), radar(7)])).toEqual([]);
  });

  it('never blames the radar wherever the player planted it', () => {
    const sunken = pad('deep', 10, 11, -141);

    for (let x = -60; x <= 60; x += 0.5) {
      expect(checkLayout([sunken, radar(x)]), `radar at x=${x}`).toEqual([]);
    }
  });
});

describe('excavation mouths', () => {
  it('caps an excavation whose whole opening is built over', () => {
    // Half-width 9 inside a dig of 10 leaves a one-unit slot for a 1.24-wide hull —
    // the exact shape of the real incident this rule exists to catch (Helion's own
    // hand-authored crest deck over its cavern, before this rule existed).
    const digs: Excavation[] = [{ x: -48, halfWidth: 10, depth: 46 }];
    const props = [pad('cavern', -48, 12, -40), caveRoof(-48, 9, -30)];

    const violations = checkLayout(props, digs);

    expect(violations.some((v) => v.rule === 'mouth')).toBe(true);
  });

  it('leaves an uncapped excavation alone', () => {
    const digs: Excavation[] = [{ x: -48, halfWidth: 10, depth: 46 }];
    const props = [pad('cavern', -48, 12, -40)];

    expect(checkLayout(props, digs)).toEqual([]);
  });
});

describe('resolveLayout', () => {
  /**
   * `resolveLayout` used to relocate a hand-authored `tower`/`mast`/`gantry` that
   * drifted into a pad's rules. Those prop kinds are gone — `colony` is generated
   * safe-by-construction, and `pad`/`caveRoof`/`radar` were never relocated even when
   * this function had somewhere to send them — so it is a pass-through now, and these
   * tests assert exactly that rather than the relocation behaviour they used to.
   */
  it('leaves every prop exactly as authored, values equal', () => {
    const props = [pad('a', 0), colony(40, 2, 3), caveRoof(-33, 9, -12), radar(0)];

    expect(resolveLayout(props)).toEqual(props);
  });

  it('does not mutate the ledger it was given', () => {
    const offender = colony(-20, 2, 1);
    const props = [pad('a', 0), offender];
    const before = { ...offender };

    resolveLayout(props);

    expect(offender).toEqual(before);
    expect(props).toHaveLength(2);
  });

  it('is idempotent', () => {
    const props = [pad('a', 0), pad('b', 30, 12), colony(-40, 2, 2)];

    const once = resolveLayout(props);
    const twice = resolveLayout(once);

    expect(twice).toEqual(once);
  });

  it('is deterministic across runs', () => {
    const props = [pad('a', 0), colony(20, 1, 1)];

    expect(resolveLayout(props)).toEqual(resolveLayout(props));
  });

  it('reports rather than moves an intruding colony — there is no cheap way to slide a grown structure', () => {
    // Not a scenario `Missions.synthesizeColonies` should ever produce (colonies are
    // generated safe-by-construction against exactly this test), but the contract
    // still has to hold for whatever a colony prop happens to be: nothing moves it.
    const c = colony(-20, 2, 1);
    const resolved = resolveLayout([pad('a', 0), c]);

    expect(resolved).toContain(c);
  });

  it('preserves the count and kinds of everything in the ledger', () => {
    const props = [pad('a', 0), colony(40, 2, 2), caveRoof(-33, 9, -12), radar(0)];
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
