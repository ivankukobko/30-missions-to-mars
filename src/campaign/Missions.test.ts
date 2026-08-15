import { describe, it, expect } from 'vitest';
import {
  MISSIONS,
  MISSION_COUNT,
  ENTRY_VELOCITY,
  airframeFor,
  cargoShape,
  getMission,
  worldAt,
  resolveBriefCards,
} from './Missions.ts';
import { AIRFRAMES } from '../entities/Airframe.ts';
import { CORPS } from '../world/CanyonSpec.ts';
import { checkLayout } from './Layout.ts';
import { mergeDigs, type Excavation } from '../world/CanyonGenerator.ts';
import { resolveTerrainAnchoredDigs, applyDigAttachments, type WallTerrain } from './TerrainDigs.ts';
import { CANYON } from '../world/CanyonSpec.ts';
import type { Prop } from '../world/Colony.ts';

/**
 * Everything the player is shown for a mission, one string.
 *
 * Voice is asserted against this rather than against `brief`, because a mission authored
 * as `messages` has no `brief` to read and the rules about who says what to whom are
 * about what arrives on screen, not about which field it was authored in.
 */
const transmission = (m: (typeof MISSIONS)[number]): string =>
  resolveBriefCards(m)
    .map((c) => c.body)
    .join(' ');

const CORP_NAMES = new Set(Object.values(CORPS).map((c) => c.name));

/**
 * The cards the mission's own client sent.
 *
 * A brief can carry a card from somebody else — the outpost cutting into a charter's
 * contract at 15, 19 and 30 — and a rule about how Kessler talks must be neither failed
 * nor satisfied by something Ixion said inside one of his briefs.
 *
 * A sender that is not a charter at all (Helion's `CONDITIONS OF CARRIAGE`, its annex) is
 * that client's own paperwork, not a second voice.
 */
const ownCards = (m: (typeof MISSIONS)[number]) =>
  resolveBriefCards(m).filter(
    (c) => c.title === CORPS[m.client].name || !CORP_NAMES.has(c.title),
  );

/** What the client itself said, cut-ins excluded. */
const clientVoice = (m: (typeof MISSIONS)[number]): string =>
  ownCards(m)
    .map((c) => c.body)
    .join(' ');

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

/**
 * A deliberately simple stand-in terrain for tests that need `WallAnchoredDig`s
 * resolved but don't care about a real canyon — flat floor out to ±60, then a real
 * (if too-regular to ever ship) rising wall, so `resolveTerrainAnchoredDigs`'s slope
 * sampling has something genuine to read rather than degenerating into the fallback
 * angle. Real per-seed terrain is what `ColonyAvailability.test.ts` and
 * `CampaignPipeline.integration.test.ts` exist for.
 */
const FAKE_WALL_TERRAIN: WallTerrain = {
  floorEdgeAt: (_z, side) => side * 78,
  heightAt: (x) => Math.max(0, Math.abs(x) - 60) * 2.2,
};

/** `worldAt`'s digs, fully resolved and with `attachToDig` props repositioned, the way
 *  `Game.loadMission` does it — for tests that care about real dig geometry rather than
 *  the raw authored ledger. */
function resolvedWorldAt(id: number, mastX: number | null = null): { props: Prop[]; digs: Excavation[] } {
  const world = worldAt(id, mastX);
  const resolved = resolveTerrainAnchoredDigs(world.digs, FAKE_WALL_TERRAIN);
  return { props: applyDigAttachments(world.props, resolved.endpoints), digs: resolved.digs };
}

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
      expect(transmission(m), `mission ${m.id}`).toContain('OBJECTIVE');
    }
  });

  it('puts the address on one card, and last unless paperwork follows it', () => {
    // The objective is a line inside what the employer said rather than a card of its
    // own, and normally it is the last thing said, because that card carries the button.
    //
    // The exception is a Helion contract that has grown an arbitration annex. There the
    // boilerplate deliberately comes after the instruction, so the descent begins from a
    // page with nothing about flying on it. That is the whole point of the annex, so it
    // is asserted rather than tidied away.
    for (const m of MISSIONS) {
      const cards = resolveBriefCards(m);
      const carrying = cards.filter((c) => c.body.includes('<b>OBJECTIVE</b>'));
      expect(carrying.length, `mission ${m.id}`).toBe(1);

      const last = cards.length - 1;
      const annexed = cards[last].title.startsWith('ANNEX');
      expect(cards.indexOf(carrying[0]), `mission ${m.id}`).toBe(annexed ? last - 1 : last);
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
    // Mission 1's own `adds` are empty, and — unlike before colony generation moved to
    // `ColonyGeneration.ts` — nothing else fills the gap: `worldAt` no longer bakes in
    // Ixion's colony (or any corp's) at all. See docs/plans/procedural_colony_growth.md.
    const world = worldAt(1);
    expect(world.props).toEqual([]);
    expect(world.digs).toEqual([]);
  });

  it('only ever grows, except for a mission that explicitly struck something', () => {
    // The corridor closes because of what you delivered, so the ledger grows — with one
    // exception. A mission may decommission a pad it authored, and then the count is
    // allowed to fall by exactly that pad. Colonies are no longer part of this count at
    // all — `worldAt` doesn't produce them any more — so the fluctuation a grown
    // colony's own territory contention can cause isn't this test's concern any more
    // either; that's `ColonyGeneration.test.ts` now.
    let previous = 0;
    for (const id of IDS) {
      const count = worldAt(id, 0).props.length;
      const struck = getMission(id)?.decommissions?.length ?? 0;
      if (struck === 0) {
        expect(count, `mission ${id}`).toBeGreaterThanOrEqual(previous);
      } else {
        expect(previous - count, `mission ${id}`).toBeLessThanOrEqual(struck);
      }
      previous = count;
    }
  });

  it('keeps a decommissioned pad standing for every mission that still lands on it', () => {
    for (const m of MISSIONS) {
      for (const id of m.decommissions ?? []) {
        const before = worldAt(m.id - 1, 0).props;
        const after = worldAt(m.id, 0).props;
        expect(before.some((p) => p.kind === 'pad' && p.id === id), `${id} before`).toBe(true);
        expect(after.some((p) => p.kind === 'pad' && p.id === id), `${id} after`).toBe(false);

        // Nothing may be sent to an address that no longer exists.
        for (const later of MISSIONS.filter((x) => x.id >= m.id)) {
          expect(later.target, `mission ${later.id} targets struck pad`).not.toBe(id);
        }
      }
    }
  });

  it('leaves a way into every hand-authored excavation blocker', () => {
    // The rule that was missing when Helion capped its own cavern with its crest deck.
    // Colony-caused capping (the only kind live in the current campaign, now that
    // Helion's cavern mouth is measured against real terrain) is covered with real
    // terrain in `CampaignPipeline.integration.test.ts` instead — this pure version
    // only ever had non-colony blockers (a cave roof) to catch anyway.
    for (const id of IDS) {
      const w = resolvedWorldAt(id, 0);
      const capped = checkLayout(w.props, w.digs).filter((v) => v.rule === 'mouth');
      expect(capped, `mission ${id}`).toEqual([]);
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

  it('carries the exact touchdown height when it is known', () => {
    const radar = worldAt(2, 12, -3.4).props.find((p) => p.kind === 'radar');
    if (radar?.kind === 'radar') expect(radar.y).toBe(-3.4);
    else throw new Error('radar missing');
  });

  it('omits y for a save from before the height was tracked, not a guess', () => {
    // Distinct from y=0, which is a real height: `buildRadar` tells the two apart by
    // whether the field exists at all, not by its value.
    const radar = worldAt(2, 12).props.find((p) => p.kind === 'radar');
    if (radar?.kind === 'radar') expect(radar.y).toBeUndefined();
    else throw new Error('radar missing');
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
      const world = resolvedWorldAt(id, mastX);
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
      const world = resolvedWorldAt(id, 0);
      const violations = checkLayout(world.props, mergeDigs(world.digs));

      expect(violations, `mission ${id}`).toEqual([]);
    }
  });
});

describe('who the briefs are talking to', () => {
  const briefs = MISSIONS.map((m) => ({ id: m.id, client: m.client, text: clientVoice(m) }));

  /**
   * You are an autonomous guidance package, not a person in a seat. Briefs are prose and
   * prose drifts, so the vocabulary that would quietly reintroduce a human pilot is
   * asserted against rather than left to whoever writes the next mission.
   */
  it('never addresses a human pilot', () => {
    const human = /\b(pilots?|stick|cockpit|panel|by hand|your (eyes|hands|gut))\b/i;
    for (const b of briefs) {
      expect(`M${b.id}: ${b.text}`).not.toMatch(human);
    }
  });

  it('lets Ixion name you, and only after you have earned it', () => {
    const ixion = briefs.filter((b) => b.client === 'outpost');
    const first = ixion[0];

    // Mission 1 is the run that plants the radar. The name is a consequence of it, so
    // it cannot appear in the brief that sends you out to do it.
    expect(first.id).toBe(1);
    expect(first.text).not.toMatch(/navigator/i);
    for (const b of ixion.slice(1)) expect(b.text).toMatch(/navigator/i);
  });

  it('has Kessler use the same name throughout, and drop it when it matters', () => {
    const kessler = briefs.filter((b) => b.client === 'kessler');
    const named = kessler.filter((b) => /tin can/i.test(b.text));

    // One name, not a rotating thesaurus: repetition is what gives the last one weight.
    expect(named.length).toBeGreaterThanOrEqual(5);
    expect(named.length).toBeLessThan(kessler.length);
    // Absent on the runs that can actually kill you — the tell is the omission.
    for (const id of [21, 25, 27]) {
      expect(briefs.find((b) => b.id === id)!.text).not.toMatch(/tin can/i);
    }
  });

  it('gives the last word in the campaign to the name Ixion gave you', () => {
    const last = briefs[briefs.length - 1];

    expect(last.id).toBe(30);
    expect(last.client).toBe('kessler');
    // The single deviation in twelve runs, two missions after Ixion goes off the air.
    expect(last.text).toMatch(/navigator/i);
    expect(last.text).not.toMatch(/tin can/i);
    const others = briefs.filter((b) => b.client === 'kessler' && b.id !== 30);
    for (const b of others) expect(b.text).not.toMatch(/navigator/i);
  });
});

describe('airframe assignment', () => {
  it('gives every mission a frame that exists', () => {
    for (const m of MISSIONS) {
      expect(AIRFRAMES[airframeFor(m)]).toBeDefined();
    }
  });

  it('sends every client out on its own airframe, with no exceptions', () => {
    for (const m of MISSIONS) {
      const expected =
        m.client === 'helion' ? 'helion' : m.client === 'kessler' ? 'hauler' : 'lander';
      expect(airframeFor(m)).toBe(expected);
    }
  });

  it('opens the campaign on the lander, so the tutorial teaches one scheme', () => {
    // Four Ixion contracts of rotate-and-thrust before another frame appears at all.
    for (const id of [1, 2, 3, 4]) {
      expect(airframeFor(getMission(id)!)).toBe('lander');
    }
    // The order the unfamiliar frames arrive in is deliberate: translation first, which
    // has nothing to recover, then the twin, which needs its control mapping explained.
    expect(airframeFor(getMission(5)!)).toBe('helion');
    expect(airframeFor(getMission(6)!)).toBe('hauler');
  });

  it("hands over a frame on the client's own first contract, not a mission later", () => {
    // Mission 5's brief opens "You fly for us now". It has to be true when it is read.
    for (const client of ['helion', 'kessler'] as const) {
      const first = MISSIONS.find((m) => m.client === client)!;
      expect(airframeFor(first)).toBe(airframeFor(MISSIONS.filter((m) => m.client === client)[1]!));
    }
  });

  it('does not meet the twin until the lander has been flown a while', () => {
    const first = MISSIONS.find((m) => airframeFor(m) === 'hauler')!;

    // Where the scheme changes matters; how it is explained is the brief panel's job,
    // and the manifest already names the vehicle and the control mapping.
    expect(first.id).toBe(6);
  });

  it('flies all frames often enough for each to be a skill', () => {
    const hauler = MISSIONS.filter((m) => airframeFor(m) === 'hauler').length;
    const helion = MISSIONS.filter((m) => airframeFor(m) === 'helion').length;
    const lander = MISSIONS.filter((m) => airframeFor(m) === 'lander').length;

    expect(hauler).toBeGreaterThanOrEqual(6);
    expect(helion).toBeGreaterThanOrEqual(5);
    expect(lander).toBeGreaterThanOrEqual(6);
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

});

describe('excavations', () => {
  it('digs only downward and with real width', () => {
    // `depth`/`halfWidth` exist identically on both an ordinary dig and a still-
    // unresolved `WallAnchoredDig`, so this one reads the raw ledger directly rather
    // than resolving it — every other test in this block cares about a dig's real `x`,
    // which a `WallAnchoredDig` doesn't have until `resolveTerrainAnchoredDigs` runs.
    for (const dig of worldAt(30, 0).digs) {
      expect(dig.depth).toBeGreaterThan(0);
      expect(dig.halfWidth).toBeGreaterThan(0);
    }
  });

  it('collapses the Kessler shaft records into one deepening bore', () => {
    // Mission 15 opens it 58 deep, mission 20 drives it to 172. Two records sharing an
    // x — both anchored to the same real wall via the same formula, not a hand-typed
    // constant any more (see `TerrainDigs.ts`'s `mount: 'floor'`) — and a shaft built
    // from both would lay a floor slab across the deep bore.
    const digs = resolvedWorldAt(20, 0).digs;
    const kesslerX = digs.find((d, i) => digs.some((o, j) => j !== i && Math.abs(o.x - d.x) < 1))?.x;
    expect(kesslerX, 'expected two dig records sharing an x').toBeDefined();
    const same = digs.filter((d) => Math.abs(d.x - kesslerX!) < 1);
    expect(same.length).toBeGreaterThan(1);

    const merged = mergeDigs(same);
    expect(merged).toHaveLength(1);
    expect(merged[0].depth).toBe(172);
  });

  it('keeps distinct bores separate', () => {
    // Kessler's shaft and the Helion cavern are far apart.
    const merged = mergeDigs(resolvedWorldAt(30, 0).digs);
    expect(merged.length).toBeGreaterThan(1);
  });

  it('reaches every pad sunk into a dig', () => {
    // A pad below the natural floor has to be inside a bore that gets that deep, or it
    // is sealed under rock the mesh never removed.
    const world = resolvedWorldAt(30, 0);
    const merged = mergeDigs(world.digs);

    for (const p of pads(world.props)) {
      if (p.y === undefined || p.y >= 0) continue;
      const bore = merged.find((d) => Math.abs(d.x - p.x) <= d.halfWidth);
      expect(bore, `pad ${p.id} at y=${p.y}`).toBeDefined();
      // Greater-or-equal, not strictly greater: a pad attached to its dig's own real
      // endpoint (`attachToDig`) computes its `y` from the exact same formula the dig's
      // own `depth` does, so the two can land exactly equal — that is the pad sitting
      // precisely at the bore's floor, not sealed under rock past it.
      expect(bore!.depth, `pad ${p.id}`).toBeGreaterThanOrEqual(Math.abs(p.y));
    }
  });

  it('keeps a pad inside a dig narrower than the bore it sits in', () => {
    const world = resolvedWorldAt(30, 0);
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

describe('brief cards', () => {
  it('gives every mission a transmission', () => {
    for (const m of MISSIONS) {
      expect(resolveBriefCards(m).length, `mission ${m.id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('names a sender on every card, and never repeats it into the body', () => {
    for (const m of MISSIONS) {
      for (const c of resolveBriefCards(m)) {
        expect(c.title.trim(), `mission ${m.id}`).not.toBe('');
        expect(c.body.trim(), `mission ${m.id}`).not.toBe('');
        // The card paints the sender itself; leaving it in the prose shows it twice.
        expect(c.body.startsWith('<b>' + c.title), `mission ${m.id}`).toBe(false);
      }
    }
  });

  it('lets the outpost cut into somebody else\'s contract, and only there', () => {
    // The three interruptions in the campaign. 15 is Kessler opening the floor, 19 is
    // Helion abandoning the surface, and 30 is the one nobody can be sending.
    const cutIn = MISSIONS.filter((m) =>
      resolveBriefCards(m).some((c) => CORP_NAMES.has(c.title) && c.title !== CORPS[m.client].name),
    );
    expect(cutIn.map((m) => m.id)).toEqual([15, 19, 30]);
    for (const m of cutIn) {
      const outsiders = resolveBriefCards(m).filter(
        (c) => CORP_NAMES.has(c.title) && c.title !== CORPS[m.client].name,
      );
      // Never the last word: the client resumes, and the address is still theirs to give.
      // On 19 they resume in their own paperwork rather than in their name, which is why
      // this compares against the client's last card and not against the corp name.
      const cards = resolveBriefCards(m);
      const own = ownCards(m);
      expect(cards[cards.length - 1], `mission ${m.id}`).toStrictEqual(own[own.length - 1]);
      for (const c of outsiders) expect(c.title, `mission ${m.id}`).toBe('IXION OUTPOST');
    }
  });

  it('gives mission 1 the last word, in mission 30, unchanged', () => {
    // The first sentence the player ever read, returning as the last — verbatim, because
    // a paraphrase is a reference and the same string is a recurrence. It carries no
    // name, which is what keeps Kessler's "navigator" three cards later his own choice
    // rather than something he picked up off the channel.
    const LINE =
      'We are the only thing at the bottom of this canyon, and we intend to stay that way.';

    const carrying = MISSIONS.filter((m) => transmission(m).includes(LINE));
    expect(carrying.map((m) => m.id)).toEqual([1, 30]);

    const card = resolveBriefCards(MISSIONS[29]).find((c) => c.body.includes(LINE))!;
    expect(card.title).toBe('IXION OUTPOST');
    expect(card.body).toBe(LINE);
    expect(card.body).not.toMatch(/navigator/i);
  });

  it('repeats a person across their cards, and lets a document change heading', () => {
    // A charter with somebody behind it is the same somebody on card three, so the
    // eyebrow repeats. That is also what will make a *changed* sender legible on the day
    // a rival cuts in mid-brief: the name is on every card, so a different one is a
    // visible event rather than a detail only the first card ever carried.
    //
    // Helion is not a person but a form, and a form's pages are headed by their section,
    // so its headings move instead.
    for (const m of MISSIONS) {
      const titles = ownCards(m).map((c) => c.title);
      if (m.client === 'helion') {
        expect(new Set(titles).size, `mission ${m.id}`).toBe(titles.length);
      } else {
        expect([...new Set(titles)], `mission ${m.id}`).toEqual([CORPS[m.client].name]);
      }
    }
  });

  it('never crams a card, anywhere in the campaign', () => {
    // A page turn is a beat. This is the cap that stops one being spent on a wall of
    // text, and it holds for prose as well as for Helion's form — the longest card in
    // the campaign is 228.
    for (const m of MISSIONS) {
      for (const card of resolveBriefCards(m)) {
        const visible = card.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        expect(visible.length, `mission ${m.id}, card "${card.title}"`).toBeLessThan(240);
      }
    }
  });

  it('prefers authored messages, with whatever senders they name', () => {
    // The form new missions should be written in: any number of cards, and a sender that
    // need not be the client — a rival cutting in is expressible here and was not in the
    // single-string brief.
    const authored = {
      ...MISSIONS[0],
      messages: [
        { sender: 'KESSLER DEEP', content: '<b>Hello</b> traveller.' },
        { sender: 'IXION OUTPOST', content: 'Ignore them.' },
      ],
    };
    const cards = resolveBriefCards(authored);

    expect(cards.map((c) => c.title)).toEqual(['KESSLER DEEP', 'IXION OUTPOST']);
    expect(cards[0].body).toBe('<b>Hello</b> traveller.');
  });
});

/**
 * Ixion and Kessler are people, and a person can be characterised by what they say.
 * Helion is nobody — auto-generated contract text with the fields filled in — so the
 * characterisation has to live in the *shape* of the document instead. These hold the
 * shape, because a sentence with a human rhythm would read as a Helion employee and
 * there is not supposed to be one.
 */
describe('the Helion contract form', () => {
  const helion = MISSIONS.filter((m) => m.client === 'helion');

  it('never speaks to anyone', () => {
    // The other two charters address you; that is the whole point of what they call you.
    // Helion's absence of a second person is the same device with nothing behind it, and
    // one stray "you" is all it takes to put a person on the other end of the link.
    expect(helion.length).toBe(10);
    for (const m of helion) {
      expect(`M${m.id}: ${clientVoice(m)}`).not.toMatch(
        /\b(you|your|yours|we|us|our|ours)\b/i,
      );
    }
  });

  it('files every contract under one number, revised', () => {
    // A conversation does not have revisions. Ten contracts sharing 4471-C says the seam
    // claim is one long document that nobody has reopened, only amended.
    for (const m of helion) {
      expect(clientVoice(m), `mission ${m.id}`).toMatch(/CONTRACT 4471-C · REV \d+ · AUTO/);
    }
  });

  it('only ever revises forward', () => {
    // Monotonic, and deliberately not contiguous: rev 10 was generated and never sent.
    const revs = helion.map((m) => Number(/REV (\d+)/.exec(clientVoice(m))![1]));
    for (let i = 1; i < revs.length; i++) {
      expect(revs[i], `mission ${helion[i].id}`).toBeGreaterThan(revs[i - 1]);
    }
  });

  it('gives no word more weight than any other', () => {
    // Everything sits at one weight, including the line about whether the airframe is
    // expected back. Emphasis would mean somebody chose what mattered.
    for (const m of helion) {
      const body = clientVoice(m).replace('<b>OBJECTIVE</b>', '');
      expect(body, `mission ${m.id}`).not.toContain('<b>');
    }
  });

  /**
   * A page turn is a beat, and these are the two rules that stop it being spent on
   * nothing. The form was authored as one card first and it read as a wall: seven fields
   * and a three-sentence route note arriving together, which is exactly the shape the
   * card sequence exists to break up.
   */
  it('never crams a card', () => {
    for (const m of helion) {
      for (const card of resolveBriefCards(m)) {
        const visible = card.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        expect(visible.length, `mission ${m.id}, card "${card.title}"`).toBeLessThan(240);
      }
    }
  });

  it('grows a page when the paperwork does', () => {
    // Helion has no arc because Helion has no character, so the drift has to be visible
    // in the document itself. The arbitration annex earns its own card the moment it
    // exists, at 22 — and it is the *last* card, so from there on the descent begins
    // from a page of boilerplate that has nothing to do with flying.
    const pages = new Map(helion.map((m) => [m.id, ownCards(m)]));
    for (const [id, cards] of pages) {
      expect(cards.length, `mission ${id}`).toBe(id >= 22 ? 3 : 2);
      if (id >= 22) expect(cards[cards.length - 1].title).toBe('ANNEX A — ARBITRATION');
    }
  });

  it('budgets for not getting the airframe back, from the first contract onward', () => {
    for (const m of helion) {
      expect(clientVoice(m), `mission ${m.id}`).toContain('RETURN EXPECTED: NO');
    }
  });
});
