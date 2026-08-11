import { describe, it, expect } from 'vitest';
import {
  MISSIONS,
  MISSION_COUNT,
  ENTRY_VELOCITY,
  airframeFor,
  cargoShape,
  getMission,
  worldAt,
} from './Missions.ts';
import { AIRFRAMES } from '../entities/Airframe.ts';
import { checkLayout } from './Layout.ts';
import { mergeDigs } from '../world/CanyonGenerator.ts';
import { CANYON } from '../world/CanyonSpec.ts';
import type { Prop } from '../world/Colony.ts';

/** Mission ids, for table-driven cases. */
const IDS = MISSIONS.map((m) => m.id);

/**
 * Radar positions worth checking.
 *
 * `mastX` is chosen by the player — wherever they set down on mission 1 — so it is an
 * input the campaign has to tolerate across its whole range, not a constant. These span
 * the canyon floor plus the null case before mission 1 is flown.
 */
const MAST_POSITIONS = [null, -60, -33, -14, -4, 0, 7, 21, 40, 66];

const pads = (props: Prop[]) => props.filter((p) => p.kind === 'pad');

describe('campaign table', () => {
  it('has thirty missions', () => {
    expect(MISSION_COUNT).toBe(30);
  });

  it('numbers them 1..30 with no gaps or duplicates', () => {
    expect(IDS).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('gives every mission a payload with a positive mass', () => {
    for (const m of MISSIONS) {
      expect(m.payload.name.length, `mission ${m.id}`).toBeGreaterThan(0);
      expect(m.payload.mass, `mission ${m.id}`).toBeGreaterThan(0);
    }
  });

  it('gives every mission fuel to fly on', () => {
    for (const m of MISSIONS) expect(m.fuel, `mission ${m.id}`).toBeGreaterThan(0);
  });

  it('writes a brief with an objective for every mission', () => {
    for (const m of MISSIONS) {
      expect(m.brief, `mission ${m.id}`).toContain('OBJECTIVE');
    }
  });

  it('names an address for every mission except the first', () => {
    // Mission 1 carries the navigation system itself, so there is nowhere to deliver to.
    expect(MISSIONS[0].target).toBeNull();
    for (const m of MISSIONS.slice(1)) {
      expect(m.target, `mission ${m.id}`).not.toBeNull();
    }
  });

  it('starts every mission above the rim and inside the flight envelope', () => {
    const ceiling = CANYON.RIM_Y + 1500;
    for (const m of MISSIONS) {
      expect(m.start.y, `mission ${m.id}`).toBeGreaterThan(CANYON.RIM_Y);
      expect(m.start.y, `mission ${m.id}`).toBeLessThan(ceiling);
    }
  });

  it('starts every mission within the playable width', () => {
    for (const m of MISSIONS) {
      expect(Math.abs(m.start.x), `mission ${m.id}`).toBeLessThan(CANYON.PLAY_HALF_X);
    }
  });

  it('only ever deepens the abyss', () => {
    // failDepth is the campaign's difficulty ratchet; it must never become shallower.
    for (let i = 1; i < MISSIONS.length; i++) {
      expect(MISSIONS[i].failDepth, `mission ${MISSIONS[i].id}`).toBeLessThanOrEqual(
        MISSIONS[i - 1].failDepth,
      );
    }
  });

  it('leaves room between the start and the fail depth on every mission', () => {
    for (const m of MISSIONS) {
      expect(m.start.y - m.failDepth, `mission ${m.id}`).toBeGreaterThan(CANYON.RIM_Y);
    }
  });

  it('enters falling on every mission', () => {
    for (const m of MISSIONS) {
      const vy = m.entry?.vy ?? ENTRY_VELOCITY.vy;
      expect(vy, `mission ${m.id}`).toBeLessThan(0);
    }
  });
});

describe('getMission', () => {
  it('finds every mission in the table', () => {
    for (const id of IDS) expect(getMission(id)?.id).toBe(id);
  });

  it('returns null past the end of the campaign, which is what triggers victory', () => {
    expect(getMission(31)).toBeNull();
    expect(getMission(0)).toBeNull();
    expect(getMission(-1)).toBeNull();
  });
});

describe('worldAt accumulation', () => {
  it('builds nothing but the ledger up to the given mission', () => {
    // Mission 1 adds nothing, so the world before any delivery is bare canyon.
    expect(worldAt(1).props).toEqual([]);
    expect(worldAt(1).digs).toEqual([]);
  });

  it('never loses a structure as the campaign advances', () => {
    // Props are only ever appended; the corridor closes because of what you delivered.
    let previous = 0;
    for (const id of IDS) {
      const count = worldAt(id, 0).props.length;
      expect(count, `mission ${id}`).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it('is a pure function of the campaign position and the mast', () => {
    // The invariant retrying after a crash depends on: same inputs, same canyon.
    for (const id of [1, 7, 16, 23, 30]) {
      expect(worldAt(id, 10)).toEqual(worldAt(id, 10));
    }
  });

  it('plants the radar from mission 2 once the mast is known', () => {
    expect(worldAt(2, null).props.some((p) => p.kind === 'radar')).toBe(false);
    expect(worldAt(1, 12).props.some((p) => p.kind === 'radar')).toBe(false);

    const radar = worldAt(2, 12).props.find((p) => p.kind === 'radar');
    expect(radar).toBeDefined();
    if (radar?.kind === 'radar') expect(radar.x).toBe(12);
  });

  it('plants the radar at exactly one position, even at x=0', () => {
    // A mast at x=0 is a legal landing, and must not read as "not yet planted".
    const radars = worldAt(30, 0).props.filter((p) => p.kind === 'radar');
    expect(radars).toHaveLength(1);
  });
});

describe('delivery addresses', () => {
  it.each(IDS)('mission %i targets a pad that exists by then', (id) => {
    const mission = getMission(id)!;
    if (mission.target === null) return;

    const available = pads(worldAt(id, 0).props).map((p) => p.id);
    expect(available).toContain(mission.target);
  });

  it('gives every pad a unique id', () => {
    const ids = pads(worldAt(30, 0).props).map((p) => p.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every pad a positive width', () => {
    for (const p of pads(worldAt(30, 0).props)) {
      expect(p.width, p.id).toBeGreaterThan(0);
    }
  });

  it('leaves a pad wider than the hull it has to catch', () => {
    // The lander is 1.24 across.
    for (const p of pads(worldAt(30, 0).props)) {
      expect(p.width, p.id).toBeGreaterThan(1.24 * 2);
    }
  });
});

/**
 * The check the campaign already runs, promoted from a DEV-only console warning to a
 * gate. This is the exact class of failure `Layout` was written for: thirty missions of
 * hand-typed coordinates that accumulate and are never removed, where a span authored in
 * mission 12 can end up hanging over a pad placed in mission 5, and nothing in the source
 * connects the two.
 */
describe('resolved layout is legal for the whole campaign', () => {
  it.each(IDS)('mission %i has a clean layout at every mast position', (id) => {
    for (const mastX of MAST_POSITIONS) {
      const world = worldAt(id, mastX);
      const violations = checkLayout(world.props, world.digs);

      expect(
        violations.map((v) => `${v.rule}: ${v.prop} -> ${v.pad}`),
        `mission ${id}, mastX ${mastX}`,
      ).toEqual([]);
    }
  });

  it('stays legal against the digs as the generator actually merges them', () => {
    // The heightfield, the terrain hole and the bore are all built from the merged list,
    // so the entry lanes have to be reserved against that and not the raw ledger.
    for (const id of IDS) {
      const world = worldAt(id, 0);
      const violations = checkLayout(world.props, mergeDigs(world.digs));

      expect(violations, `mission ${id}`).toEqual([]);
    }
  });
});

describe('airframe assignment', () => {
  it('gives every mission a frame that exists', () => {
    for (const m of MISSIONS) {
      expect(AIRFRAMES[airframeFor(m)]).toBeDefined();
    }
  });

  it('sends Kessler runs out on the twin and everyone else on the lander', () => {
    for (const m of MISSIONS) {
      expect(airframeFor(m)).toBe(m.client === 'kessler' ? 'hauler' : 'lander');
    }
  });

  it('opens the campaign on the lander, so the tutorial teaches one scheme', () => {
    // Five runs of rotate-and-thrust before the twin appears at 6.
    for (const id of [1, 2, 3, 4, 5]) {
      expect(airframeFor(getMission(id)!)).toBe('lander');
    }
    expect(airframeFor(getMission(6)!)).toBe('hauler');
  });

  it('does not meet the twin until the lander has been flown a while', () => {
    const first = MISSIONS.find((m) => airframeFor(m) === 'hauler')!;

    // Where the scheme changes matters; how it is explained is the brief panel's job,
    // and the manifest already names the vehicle and the control mapping.
    expect(first.id).toBe(6);
  });

  it('flies both frames often enough for each to be a skill', () => {
    const hauler = MISSIONS.filter((m) => airframeFor(m) === 'hauler').length;

    expect(hauler).toBeGreaterThanOrEqual(8);
    expect(MISSIONS.length - hauler).toBeGreaterThanOrEqual(8);
  });

  it('lets a mission override the frame its client would imply', () => {
    const kessler = MISSIONS.find((m) => m.client === 'kessler')!;

    expect(airframeFor({ ...kessler, airframe: 'lander' })).toBe('lander');
  });
});

describe('pad widths', () => {
  const pads = (): Extract<Prop, { kind: 'pad' }>[] =>
    worldAt(MISSION_COUNT, 0).props.filter(
      (p): p is Extract<Prop, { kind: 'pad' }> => p.kind === 'pad',
    );

  it('scales every pad down without collapsing any of them', () => {
    for (const p of pads()) {
      // Narrow enough to bite, wide enough to still be a target for a 1.24 hull.
      expect(p.width).toBeGreaterThanOrEqual(8);
      expect(p.width).toBeLessThanOrEqual(13);
    }
  });

  it('keeps the authored ordering, so the home pad is still the most forgiving', () => {
    const all = pads();
    const home = all.find((p) => p.id === 'outpost-main')!;

    for (const p of all) expect(home.width).toBeGreaterThanOrEqual(p.width);
  });

  it('leaves every shaft pad inside the bore it sits in', () => {
    const BORE = 24;
    for (const p of pads()) {
      if (!p.id.startsWith('kessler-') || p.y === undefined) continue;
      expect(p.width).toBeLessThan(BORE);
    }
  });

  it('keeps a platform wider than the pad resting on it', () => {
    const world = worldAt(MISSION_COUNT, 0);
    for (const p of pads()) {
      const deck = world.props.find(
        (o) => o.kind === 'platform' && Math.abs(o.x - p.x) < 0.001,
      );
      if (!deck || deck.kind !== 'platform') continue;
      // The apron is an absolute margin either side, so it must survive the scaling.
      expect(deck.width).toBeGreaterThan(p.width);
    }
  });
});

describe('excavations', () => {
  it('digs only downward and with real width', () => {
    for (const dig of worldAt(30, 0).digs) {
      expect(dig.depth).toBeGreaterThan(0);
      expect(dig.halfWidth).toBeGreaterThan(0);
    }
  });

  it('collapses the Kessler shaft records into one deepening bore', () => {
    // Mission 15 opens it 58 deep, mission 20 drives it to 172. Two records at the same
    // x, and a shaft built from both would lay a floor slab across the deep bore.
    const digs = worldAt(20, 0).digs.filter((d) => d.x === 10);
    expect(digs.length).toBeGreaterThan(1);

    const merged = mergeDigs(digs);
    expect(merged).toHaveLength(1);
    expect(merged[0].depth).toBe(172);
  });

  it('keeps distinct bores separate', () => {
    // Kessler at x=10 and the Helion cavern at x=-33 are far apart.
    const merged = mergeDigs(worldAt(30, 0).digs);
    expect(merged.length).toBeGreaterThan(1);
  });

  it('reaches every pad sunk into a dig', () => {
    // A pad below the natural floor has to be inside a bore that gets that deep, or it
    // is sealed under rock the mesh never removed.
    const world = worldAt(30, 0);
    const merged = mergeDigs(world.digs);

    for (const p of pads(world.props)) {
      if (p.y === undefined || p.y >= 0) continue;
      const bore = merged.find((d) => Math.abs(d.x - p.x) <= d.halfWidth);
      expect(bore, `pad ${p.id} at y=${p.y}`).toBeDefined();
      expect(bore!.depth, `pad ${p.id}`).toBeGreaterThan(Math.abs(p.y));
    }
  });

  it('keeps a pad inside a dig narrower than the bore it sits in', () => {
    const world = worldAt(30, 0);
    const merged = mergeDigs(world.digs);

    for (const p of pads(world.props)) {
      if (p.y === undefined || p.y >= 0) continue;
      const bore = merged.find((d) => Math.abs(d.x - p.x) <= d.halfWidth)!;
      expect(p.width / 2, `pad ${p.id}`).toBeLessThan(bore.halfWidth);
    }
  });
});

describe('mergeDigs', () => {
  it('takes the deeper of two records sharing a bore', () => {
    const merged = mergeDigs([
      { x: 10, halfWidth: 12, depth: 58 },
      { x: 10, halfWidth: 12, depth: 172 },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].depth).toBe(172);
  });

  it('takes the wider half-width as well', () => {
    const merged = mergeDigs([
      { x: 0, halfWidth: 8, depth: 20 },
      { x: 0, halfWidth: 14, depth: 10 },
    ]);

    expect(merged[0].halfWidth).toBe(14);
    expect(merged[0].depth).toBe(20);
  });

  it('leaves separate bores alone', () => {
    const digs = [
      { x: -33, halfWidth: 10, depth: 46 },
      { x: 10, halfWidth: 12, depth: 172 },
    ];

    expect(mergeDigs(digs)).toHaveLength(2);
  });

  it('does not mutate the records it was given', () => {
    const original = { x: 10, halfWidth: 12, depth: 58 };
    mergeDigs([original, { x: 10, halfWidth: 12, depth: 172 }]);

    expect(original.depth).toBe(58);
  });

  it('handles an empty ledger', () => {
    expect(mergeDigs([])).toEqual([]);
  });
});

describe('cargoShape', () => {
  it('honours an explicit shape over the name', () => {
    expect(cargoShape({ name: 'Drill Head', mass: 1, shape: 'sphere' })).toBe('sphere');
  });

  it.each([
    ['Lateral Bore Rig', 'rig'],
    ['Drill Head', 'rig'],
    ['Water Reclaimer', 'rig'],
    ['Atmosphere Scrubber', 'rig'],
    ['Ore Processor', 'rig'],
    ['Coolant Cells', 'drum'],
    // 'bore' is tested before 'casing', so this reads as machinery rather than a drum.
    // Rule order is the tie-breaker for any name that matches two categories.
    ['Bore Casing', 'rig'],
    ['Shaft Liner', 'drum'],
    ['Descent Cable', 'drum'],
    ['Cutting Charges', 'sphere'],
    ['Counterclaim Beacon', 'sphere'],
    ['Anchor Pylons', 'sphere'],
    ['Seismic Array', 'sphere'],
    ['Claim Filings', 'crate'],
    ['Core Archive', 'sphere'],
  ])('reads %s as a %s', (name, shape) => {
    expect(cargoShape({ name, mass: 1 })).toBe(shape);
  });

  it('falls back to a crate for anything unrecognised', () => {
    expect(cargoShape({ name: 'Legal Injunction', mass: 0.2 })).toBe('crate');
    expect(cargoShape({ name: '', mass: 1 })).toBe('crate');
  });

  it('classifies every payload in the campaign', () => {
    const allowed = ['crate', 'drum', 'sphere', 'rig'];
    for (const m of MISSIONS) {
      expect(allowed, `mission ${m.id}`).toContain(cargoShape(m.payload));
    }
  });
});
