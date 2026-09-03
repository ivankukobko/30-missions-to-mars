import { describe, it, expect } from 'vitest';
import {
  MISSIONS,
  MISSION_COUNT,
  ENTRY_VELOCITY,
  airframeFor,
  musicTrackFor,
  cargoShape,
  getMission,
  worldAt,
  resolveBriefCards,
  missionGoal,
  EPILOGUE,
  PROLOGUE,
  entryX,
} from './Missions.ts';
import { AIRFRAMES } from '../entities/Airframe.ts';
import { CORPS } from '../world/CanyonSpec.ts';
import { checkLayout } from './Layout.ts';
import { mergeDigs, type Excavation } from '../world/CanyonGenerator.ts';
import {
  SHAFT_CELL,
  mouthRun,
  anchorCells,
  parseCells,
  shaftGrid,
  type Carved,
} from '../world/ShaftGrid.ts';
import { resolveTerrainAnchoredDigs, applyDigAttachments, type WallTerrain } from './TerrainDigs.ts';
import { CANYON } from '../world/CanyonSpec.ts';
import { snapToColumn } from '../world/ColonyLattice.ts';
import type { Prop } from '../world/Colony.ts';
import { freshCanyon } from '../testing/canyonFixture.ts';
import { MAX_GROUND_LANDING_SLOPE } from '../entities/LanderBody.ts';

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
 * The missions that are a delivery for a charter — every mission except the prologue.
 *
 * Mission 1 is in the table, is numbered and is scored, because the player has no way to
 * perceive "which of these did a company pay for" and a vehicle going down is a mission.
 * But it is the one run with no client on the other end: no payload mass, no address, no
 * brief, and a vehicle no charter operates. Every rule below about what a *contract* looks
 * like is asserted against this list rather than against `MISSIONS`, so that the
 * prologue's exemptions stay deliberate and visible instead of being special-cased one
 * `if` at a time inside each test.
 */
const DELIVERIES = MISSIONS.filter((m) => m.id !== PROLOGUE.id);

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

/**
 * PARKED: voice and continuity rules, while the campaign is being rewritten.
 *
 * These are not correctness tests. Each one pins a *decision* about who speaks, what they
 * call you, and where in the twenty-nine an interruption lands — and every one of them failed
 * today because the story moved, not because anything broke. During an authoring pass that
 * is pure friction: the test goes red, the prose is fine, and the fix is to retype the
 * assertion to match what was just written, which proves nothing.
 *
 * They are skipped rather than deleted because the rules cost real thought to arrive at —
 * Helion having no first or second person anywhere is the whole reason its silence reads
 * as a machine rather than as a terse person — and re-deriving them later would be worse
 * than repairing them.
 *
 * **Re-armed**, in one pass against the final text now that all twenty-nine briefs and the
 * epilogue are authored. Eleven of the twelve passed unchanged; the twelfth was failing on
 * a stale *assertion* rather than stale prose — `[3, 15, 19, 30]` from the numbering that
 * had the prologue at id 0 and the campaign running to 30, against the `[3, 14, 18, 29]`
 * the campaign has actually had since. That is the argument for turning them back on
 * rather than deleting them: the rules held across a full authoring pass, and the only
 * thing that had rotted was a hand-typed list of mission ids.
 *
 * Everything still running is one of two things: a layout constraint the UI actually
 * breaks on (the 240-character card cap, an objective that has to be on the last card
 * because that card carries the launch button), or a consistency invariant no reader can
 * check by eye (contract revisions only going forward, the mass allowance figures matching
 * the payload masses they are derived from).
 */

describe('campaign table', () => {
  it('has twenty-nine missions', () => {
    expect(MISSION_COUNT).toBe(29);
  });

  it('numbers them 1..29 with no gaps or duplicates', () => {
    expect(IDS).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it('gives every mission a payload with a positive mass', () => {
    for (const m of DELIVERIES) {
      expect(m.payload.name.length, `mission ${m.id}`).toBeGreaterThan(0);
      expect(m.payload.mass, `mission ${m.id}`).toBeGreaterThan(0);
    }
  });

  it('gives every mission fuel to fly on', () => {
    for (const m of MISSIONS) expect(m.fuel, `mission ${m.id}`).toBeGreaterThan(0);
  });

  it('writes a brief with an objective for every mission', () => {
    for (const m of DELIVERIES) {
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
    for (const m of DELIVERIES) {
      const cards = resolveBriefCards(m);
      const carrying = cards.filter((c) => c.body.includes('<b>OBJECTIVE</b>'));
      expect(carrying.length, `mission ${m.id}`).toBe(1);

      const last = cards.length - 1;
      const annexed = cards[last].title.startsWith('ANNEX');
      expect(cards.indexOf(carrying[0]), `mission ${m.id}`).toBe(annexed ? last - 1 : last);
    }
  });

  it("reads the pause overlay's goal line straight off the brief's own OBJECTIVE", () => {
    for (const m of DELIVERIES) {
      const card = resolveBriefCards(m).find((c) => c.body.includes('<b>OBJECTIVE</b>'))!;
      const expected = card.body.split('<b>OBJECTIVE</b>')[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      expect(missionGoal(m), `mission ${m.id}`).toBe(expected);
      // Plain text for a plain-data readout — no leftover markup from the brief's own HTML.
      expect(missionGoal(m), `mission ${m.id}`).not.toMatch(/[<>]/);
    }
  });

  it('gives the silent prologue a goal line anyway, matching its own null address', () => {
    expect(PROLOGUE.messages).toEqual([]);
    expect(missionGoal(PROLOGUE)).toBe('Land intact — anywhere survivable.');
  });

  it('names an address for every mission except the two that plant landmarks', () => {
    // The only two runs with nowhere to deliver to, and they are the two that leave
    // something standing: mission 1 sets down the uplink relay on the rim, mission 2 is
    // still carrying the navigation mast that every later address is measured from.
    expect(MISSIONS[0].target).toBeNull();
    expect(MISSIONS[1].target).toBeNull();
    for (const m of MISSIONS.slice(2)) {
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
    for (const m of DELIVERIES) {
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
    // `ColonyPlan.ts` — nothing else fills the gap: `worldAt` no longer bakes in
    // Ixion's colony (or any corp's) at all. See docs/plans/procedural_colony_growth.md.
    //
    // The dead relays are excluded rather than counted. They are not ledger: nothing
    // delivered them and no mission adds them, which is the whole claim they make — they
    // were lying in this canyon before any charter arrived. See `DEAD_RELAYS`.
    const world = worldAt(1);
    expect(world.props.filter((p) => p.kind !== 'relay')).toEqual([]);
    expect(world.digs).toEqual([]);
  });

  it('only ever grows, except for a mission that explicitly struck something', () => {
    // The corridor closes because of what you delivered, so the ledger grows — with one
    // exception. A mission may decommission a pad it authored, and then the count is
    // allowed to fall by exactly that pad. Colonies are no longer part of this count at
    // all — `worldAt` doesn't produce them any more — so the fluctuation a grown
    // colony's own territory contention can cause isn't this test's concern any more
    // either; that's `ColonyPlan.test.ts` now.
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
    const ixion = briefs.filter((b) => b.client === 'outpost' && b.id !== PROLOGUE.id);
    const first = ixion[0];

    // Mission 2 is the run that plants the radar — mission 1 is the prologue, which
    // Ixion has no way to transmit on. The name is a consequence of that landing, so it
    // cannot appear in the brief that sends you out to make it.
    expect(first.id).toBe(2);
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
    for (const id of [20, 24, 26]) {
      expect(briefs.find((b) => b.id === id)!.text).not.toMatch(/tin can/i);
    }
  });

  it('gives the last word in the campaign to the name Ixion gave you', () => {
    const last = briefs[briefs.length - 1];

    expect(last.id).toBe(29);
    expect(last.client).toBe('kessler');
    // The single deviation in ten runs, two missions after Ixion goes off the air.
    expect(last.text).toMatch(/navigator/i);
    expect(last.text).not.toMatch(/tin can/i);
    const others = briefs.filter((b) => b.client === 'kessler' && b.id !== 29);
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
    for (const m of DELIVERIES) {
      const expected =
        m.client === 'helion' ? 'helion' : m.client === 'kessler' ? 'hauler' : 'lander';
      expect(airframeFor(m)).toBe(expected);
    }
  });

  it('opens the campaign on the lander, so the tutorial teaches one scheme', () => {
    // The prologue flies the relay, which is nobody's charter and teaches one control.
    expect(airframeFor(getMission(1)!)).toBe('relay');
    // Then four Ixion contracts of rotate-and-thrust before another frame appears at all.
    for (const id of [2, 3, 4, 5]) {
      expect(airframeFor(getMission(id)!)).toBe('lander');
    }
    // The order the unfamiliar frames arrive in is deliberate: translation first, which
    // has nothing to recover, then the twin, which needs its control mapping explained.
    expect(airframeFor(getMission(6)!)).toBe('helion');
    expect(airframeFor(getMission(7)!)).toBe('hauler');
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
    expect(first.id).toBe(7);
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

describe('music track', () => {
  it('follows the client unless the mission says otherwise', () => {
    for (const m of MISSIONS) {
      if (m.musicTrack) continue;
      expect(musicTrackFor(m)).toBe(m.client);
    }
  });

  it('ends the campaign in the key it opened in', () => {
    // Ixion's theme under Kessler's final contract. The outpost has gone dark by mission
    // 29 and cuts in anyway, quoting mission 1's opening line verbatim — the music is
    // what makes that land as a return rather than as a stray transmission.
    expect(musicTrackFor(getMission(29)!)).toBe(musicTrackFor(getMission(1)!));
    expect(musicTrackFor(getMission(29)!)).toBe('outpost');
  });

  it('leaves the twenty-ninth run Kessler in every respect except the music', () => {
    // The override is a comment on the contract, not a change to it. If this ever starts
    // failing, the mission was rewritten and the callback no longer means what it meant.
    const last = getMission(29)!;
    expect(last.client).toBe('kessler');
    expect(airframeFor(last)).toBe('hauler');
    expect(last.target).toBe('shaft-deep');
  });

  it('overrides nothing else in the campaign', () => {
    // Deliberately exact. A second override is a design decision, not a tuning tweak, and
    // should have to be argued for here before it ships.
    const overridden = MISSIONS.filter((m) => m.musicTrack).map((m) => m.id);
    expect(overridden).toEqual([29]);
  });

  it('names a track that actually has a theme', () => {
    for (const m of MISSIONS) {
      expect(CORPS[musicTrackFor(m)]).toBeDefined();
    }
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

  it('collapses every stage of the complex into one excavation', () => {
    /**
     * Five records now, not three: Ixion's original working at 24, the charters widening
     * it at 58, Helion taking the gallery, then 172 and 303. All share an x — anchored to
     * the same real wall by the same formula — and a canyon built from more than one of
     * them would lay a floor slab across the deep bore at the height of an earlier deck.
     */
    const digs = resolvedWorldAt(30, 0).digs;
    const sharedX = digs[0].x;
    expect(digs.every((d) => Math.abs(d.x - sharedX) < 1)).toBe(true);
    expect(digs.map((d) => d.depth)).toEqual([24, 58, 58, 172, 303]);

    const merged = mergeDigs(digs);
    expect(merged).toHaveLength(1);
    expect(merged[0].depth).toBe(303);
    // And it carries the *last* drawing, not the first — see `mergeDigs`.
    expect(Math.max(...merged[0].cells!.map((c) => c.row))).toBe(24);
  });

  it('digs exactly one hole in the whole campaign', () => {
    // This replaced `keeps distinct bores separate`, which asserted the opposite and was
    // right until Helion's wall bore was removed. Everybody uses Ixion's mouth now, and
    // that being *one* hole is the thing worth pinning: a second excavation appearing is
    // either a mistake or a design change big enough to want this test's attention.
    expect(mergeDigs(resolvedWorldAt(30, 0).digs)).toHaveLength(1);
  });

  it('sets every sub-floor deck down in a cell that was actually carved', () => {
    /**
     * What "the pad is inside the bore" has to mean once the bore is a drawing.
     *
     * The old test asked whether the deck fell within `x ± halfWidth` and above `depth` —
     * exact for a tube, and wrong for a complex: those two numbers describe a box centred
     * on the mouth, while Helion's gallery runs five columns west of it. Under that test a
     * deck correctly placed in the gallery reads as sealed in rock.
     *
     * So this asks the drawing instead, which is the thing the canyon is actually carved
     * from — and it is a stronger check, not a weaker one: a deck can now be verified in
     * the cell it was drawn in rather than merely somewhere inside a bounding box.
     */
    const world = resolvedWorldAt(30, 0);
    const merged = mergeDigs(world.digs);
    const dig = merged[0];
    expect(dig.cells, 'the campaign should be drawing its excavation').toBeDefined();

    const mouthY = FAKE_WALL_TERRAIN.heightAt(dig.x, 0, false);
    const grid = shaftGrid(mouthY);
    const anchored = anchorCells(dig.cells!, grid.colAt(snapToColumn(dig.x)));
    const carved = new Set(anchored.map((c) => `${c.col}|${c.row}`));

    const sunk = pads(world.props).filter((p) => p.y !== undefined && p.y < 0);
    expect(sunk.length, 'expected decks below the floor').toBeGreaterThan(0);

    for (const p of sunk) {
      const col = grid.colAt(p.x);
      const row = grid.rowAt(p.y!);
      expect(carved.has(`${col}|${row}`), `deck ${p.id} at (${col}, ${row}) is in solid rock`).toBe(true);
      // And the deck has to fit the corridor it is in, across the cells it spans.
      const half = Math.ceil(p.width / 2 / SHAFT_CELL) - 1;
      for (let d = -half; d <= half; d++) {
        expect(carved.has(`${col + d}|${row}`), `deck ${p.id} overhangs into rock`).toBe(true);
      }
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
    for (const m of DELIVERIES) {
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

  it('interrupts a contract four times, and never lets the interruption end it', () => {
    // 3 is Helion noticing the outpost exist, 15 is Kessler opening the floor, 19 is
    // Helion abandoning the surface, and 30 is the one nobody can be sending.
    //
    // They are rationed. The card system supports a second sender on every brief, and
    // using it on every brief would make an interruption ordinary — the silence between
    // these is what makes one land.
    const outsiders = (m: (typeof MISSIONS)[number]) =>
      resolveBriefCards(m).filter(
        (c) => CORP_NAMES.has(c.title) && c.title !== CORPS[m.client].name,
      );

    const cutIn = MISSIONS.filter((m) => outsiders(m).length > 0);
    expect(cutIn.map((m) => m.id)).toEqual([3, 14, 18, 29]);

    for (const m of cutIn) {
      // Never the last word: the client resumes, and the address is still theirs to give.
      // On 19 they resume in their own paperwork rather than in their name, which is why
      // this compares against the client's last card and not against the corp name.
      const cards = resolveBriefCards(m);
      const own = ownCards(m);
      expect(cards[cards.length - 1], `mission ${m.id}`).toStrictEqual(own[own.length - 1]);
    }
  });

  it('interrupts the outpost once, at the start, and lets them do it three times at the end', () => {
    // The campaign's shape in one assertion. Mission 3 is the only time Ixion is cut into
    // — a machine that has heard their assay and is not addressing them about it — and
    // every interruption after it is Ixion doing the cutting.
    //
    // So the canyon's first victim is its last voice, and mission 3 and mission 29 are
    // the same brief structure twenty-six missions apart: someone talking, someone arriving
    // on a channel they were not invited to, and the first party carrying on regardless.
    const interruptedIxion = MISSIONS.filter(
      (m) =>
        m.client === 'outpost' &&
        resolveBriefCards(m).some((c) => CORP_NAMES.has(c.title) && c.title !== 'IXION OUTPOST'),
    );
    expect(interruptedIxion.map((m) => m.id)).toEqual([3]);

    const ixionCutting = MISSIONS.filter(
      (m) =>
        m.client !== 'outpost' && resolveBriefCards(m).some((c) => c.title === 'IXION OUTPOST'),
    );
    expect(ixionCutting.map((m) => m.id)).toEqual([14, 18, 29]);
  });

  it('gives mission 1 the last word, in mission 29, unchanged', () => {
    // The first sentence the player ever read, returning as the last — verbatim, because
    // a paraphrase is a reference and the same string is a recurrence. It carries no
    // name, which is what keeps Kessler's "navigator" three cards later his own choice
    // rather than something he picked up off the channel.
    const LINE =
      'We are the only thing at the bottom of this canyon, and we intend to stay that way.';

    // Mission 2, not 1: the prologue is silent, so the first sentence the player ever
    // reads is the first thing Ixion says once the link they just landed is up.
    const carrying = MISSIONS.filter((m) => transmission(m).includes(LINE));
    expect(carrying.map((m) => m.id)).toEqual([2, 29]);

    const card = resolveBriefCards(MISSIONS[28]).find((c) => c.body.includes(LINE))!;
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
    for (const m of DELIVERIES) {
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
    for (const m of DELIVERIES) {
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
    expect(helion.length).toBe(9);
    for (const m of helion) {
      expect(`M${m.id}: ${clientVoice(m)}`).not.toMatch(
        /\b(you|your|yours|we|us|our|ours)\b/i,
      );
    }
  });

  it('files every contract under one number, revised and date-stamped', () => {
    /**
     * A conversation does not have revisions. Nine contracts sharing 4471-C says the seam
     * claim is one long document nobody has reopened, only amended.
     *
     * The sol rides in the file reference rather than as a field of its own, which is the
     * only place Helion is allowed to keep time: they carry a machine stamp nobody reads,
     * while Ixion counts sols and Kessler counts work. Give this form a legible date line
     * and three registers become one.
     */
    for (const m of helion) {
      expect(clientVoice(m), `mission ${m.id}`).toMatch(
        new RegExp(`CONTRACT 4471-C/${m.sol} · REV \\d+ · AUTO`),
      );
    }
    // The number is the constant; the stamp is what moves.
    const stamps = helion.map((m) => /4471-C\/(\d+)/.exec(clientVoice(m))![1]);
    expect(new Set(stamps).size).toBe(helion.length);
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
    // exists, at 21 — and it is the *last* card, so from there on the descent begins
    // from a page of boilerplate that has nothing to do with flying.
    const pages = new Map(helion.map((m) => [m.id, ownCards(m)]));
    for (const [id, cards] of pages) {
      expect(cards.length, `mission ${id}`).toBe(id >= 21 ? 3 : 2);
      if (id >= 21) expect(cards[cards.length - 1].title).toBe('ANNEX A — ARBITRATION');
    }
  });

  it('budgets for not getting the airframe back, from the first contract onward', () => {
    for (const m of helion) {
      expect(clientVoice(m), `mission ${m.id}`).toContain('RETURN EXPECTED: NO');
    }
  });
});

/**
 * The epilogue is the one card sequence with no mission behind it, so every rule the
 * suite holds over the campaign stops applying to it by default. That makes it exactly
 * where the voices drift — and it is the last thing the player reads.
 */
describe('the epilogue', () => {
  const body = (sender: string) =>
    EPILOGUE.filter((m) => m.sender === sender)
      .map((m) => m.content)
      .join(' ');

  it('closes with the console and the two charters still able to speak', () => {
    // Ixion is not on it. They went dark at 28 and stayed dark; the mast quoting mission
    // 1 during the brief is the last thing they do.
    expect(EPILOGUE.map((m) => m.sender)).toEqual([
      'KESSLER DEEP',
      'UPLINK',
      'HELION EXTRACTION',
    ]);
    expect(EPILOGUE.map((m) => m.register ?? 'corp')).toEqual(['corp', 'sys', 'corp']);
  });

  it('confirms the delivery before anything else happens', () => {
    // Otherwise the sequence reads as a crash on the one run the player got right.
    expect(EPILOGUE[0].content).toMatch(/seated|delivered|confirmed/i);
  });

  it('cuts Kessler off, and lets nothing resume', () => {
    // He is interrupted twice in two briefs. In mission 29 the carrier cuts in and he
    // picks the sentence back up; here there is no third card of his.
    expect(EPILOGUE[0].content.trim()).toMatch(/—$/);
    expect(EPILOGUE.filter((m) => m.sender === 'KESSLER DEEP')).toHaveLength(1);
  });

  it('holds Helion to its own rules to the last line', () => {
    const helion = body('HELION EXTRACTION');
    expect(helion).not.toMatch(/\b(you|your|yours|we|us|our|ours)\b/i);
    expect(helion).not.toContain('<b>');
    expect(helion).toMatch(/CONTRACT 4471-C · REV \d+ · AUTO/);
  });

  it('revises past the last contract rather than reusing its number', () => {
    const last = MISSIONS.filter((m) => m.client === 'helion').pop()!;
    const prev = Number(/REV (\d+)/.exec(clientVoice(last))![1]);
    expect(Number(/REV (\d+)/.exec(body('HELION EXTRACTION'))![1])).toBeGreaterThan(prev);
  });

  it('never crams a card here either', () => {
    for (const m of EPILOGUE) {
      const visible = m.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      expect(visible.length, m.sender).toBeLessThan(240);
    }
  });
});

describe('the prologue', () => {
  it('is mission 1 of twenty-nine, not a thirtieth mission bolted on', () => {
    // It is numbered, scored and in the table, because "which of these did a company pay
    // for" is an author's distinction the player has no way to perceive: a vehicle went
    // down, so it was a mission. What pays for it is the one thing the campaign never
    // shows, so numbering it costs nothing and leaving it out cost a whole flight.
    expect(PROLOGUE.id).toBe(1);
    expect(MISSIONS[0]).toBe(PROLOGUE);
    expect(MISSION_COUNT).toBe(29);
    expect(IDS).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it('has nobody to talk to it', () => {
    // The link is what you are delivering, so there is no brief, no sender and no card.
    // `Game` reads exactly this to skip the brief and hand the vehicle straight over.
    expect(PROLOGUE.messages).toEqual([]);
    expect(resolveBriefCards(PROLOGUE)).toEqual([]);
  });

  it('is the only mission nobody can transmit on', () => {
    // A guard on the rule rather than on the prologue: if a second silent mission ever
    // appears, the brief-skipping path in `Game` starts applying somewhere it was never
    // designed for, and it does so without a single test going red.
    const silent = MISSIONS.filter((m) => m.messages.length === 0);
    expect(silent.map((m) => m.id)).toEqual([PROLOGUE.id]);
  });

  it('has no address, because there is nobody to have given it one', () => {
    expect(PROLOGUE.target).toBeNull();
  });

  it('flies the relay rather than the nominal client\'s airframe', () => {
    // Without the explicit override `airframeFor` would hand this run Ixion's TD-4, off
    // a `client` that only exists because the field is not optional.
    expect(airframeFor(PROLOGUE)).toBe('relay');
    expect(MISSIONS.filter((m) => airframeFor(m) === 'relay')).toHaveLength(1);
  });

  it('enters straight down, because a drifting entry cannot land', () => {
    // Regression guard on a real dead end. `resolveContact` tests total speed, not
    // vertical speed, and this vehicle has no way to null a sideways velocity — so any
    // non-zero `vx` arrives above `MAX_LANDING_SPEED` however well it is flown, and the
    // prologue becomes unwinnable with nothing on screen to say why.
    expect(PROLOGUE.entry?.vx ?? 0).toBe(0);
  });

  /**
   * The claim this makes is about rock, and the one it replaced was about constants.
   *
   * The old test read `expect(start.x).toBeGreaterThanOrEqual(min(RIM_SITES) - 9)` — two
   * authored numbers compared to each other, which passed for as long as they were typed
   * consistently and said nothing at all about whether the ground was there. It was, and
   * the prologue was unlandable on three seeds in ten. See `RIM_BENCH`.
   */
  it('has landable rock under the prologue on every seed, measured', { timeout: 120000 }, () => {
    for (const seed of [0, 1, 7, 12345, 631729407, 1696448283, 42, 999, 2024, 555111]) {
      const { canyon } = freshCanyon(seed);
      canyon.build([], []);
      const x = entryX(PROLOGUE, canyon);

      // The chord the collider actually offers, sampled the way `colliderProfile` does:
      // one point per `CANYON.CELL`, so contact is with a 6-unit span, not a tangent.
      const x0 = Math.floor(x / CANYON.CELL) * CANYON.CELL;
      const slope = (canyon.heightAt(x0 + CANYON.CELL, 0) - canyon.heightAt(x0, 0)) / CANYON.CELL;
      const ny = 1 / Math.hypot(1, slope);

      expect(ny, `seed ${seed} at x=${x.toFixed(1)}`).toBeGreaterThanOrEqual(
        MAX_GROUND_LANDING_SLOPE,
      );
    }
  });

  /**
   * And a bench wide enough to be a place rather than a point.
   *
   * The entry is straight down, so one landable chord would technically do — but the
   * relay stands here for the rest of the campaign and is looked at from the canyon
   * floor, and a landmark on a one-cell ledge reads as an accident.
   */
  it('grades a bench either side of the entry, not just the column itself', { timeout: 120000 }, () => {
    for (const seed of [0, 7, 42, 631729407]) {
      const { canyon } = freshCanyon(seed);
      canyon.build([], []);
      const x = entryX(PROLOGUE, canyon);
      const level = canyon.heightAt(x, 0);

      // Across the flat the bench claims, nothing may depart from its level by more than
      // the terracing would put back if the bench were not being applied last.
      for (let d = -24; d <= 24; d += CANYON.CELL) {
        expect(Math.abs(canyon.heightAt(x + d, 0) - level), `seed ${seed} at +${d}`)
          .toBeLessThan(1);
      }
    }
  });
});

describe('the relays', () => {
  const relays = (id: number, relay: { x: number; y: number | null } | null = null) =>
    worldAt(id, 0, null, relay).props.filter((p) => p.kind === 'relay');

  it('seeds four dead ones, in the canyon from the first mission to the last', () => {
    // They predate every charter — that is the entire claim — so they cannot arrive with
    // one, and they cannot be cleared away by one either.
    expect(relays(1)).toHaveLength(4);
    expect(relays(30)).toHaveLength(4);
    expect(relays(30).every((p) => p.kind === 'relay' && !p.live)).toBe(true);
  });

  it('leaves the rim empty on a save that has not flown the prologue', () => {
    // Same discipline as `mastY`: no position is invented for a save that never recorded
    // one. Four corpses and no live link is a legible state; a relay standing at a
    // guessed x is not.
    expect(relays(1).filter((p) => p.kind === 'relay' && p.live)).toHaveLength(0);
  });

  it('stands the live one wherever the prologue put it, from mission 1 on', () => {
    // No `id >=` gate, unlike the radar's `id >= 2`. The mast is cargo mission 1 is still
    // carrying; the relay is already on the rim before mission 1 begins.
    const live = relays(1, { x: 148, y: 239 }).filter((p) => p.kind === 'relay' && p.live);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ x: 148, y: 239, live: true });
  });

  it('is the one prop in the game that belongs to nobody', () => {
    // Every other variant in the `Prop` union carries a `corp`. If one is ever added
    // here, the `--sys` livery in `buildRelay` has quietly become a lie.
    for (const p of relays(30, { x: 148, y: 239 })) {
      expect(p).not.toHaveProperty('corp');
    }
  });

  it('guarantees one sighting near the pad the player lands on most', () => {
    // `outpost-main` is at x −14 and is the target eight times from mission 2. The other
    // three are properly missable, which is what makes finding one feel found.
    const xs = relays(2).map((p) => p.x);
    expect(xs.some((x) => Math.abs(x - -14) < 30)).toBe(true);
  });
});

describe("Helion's mass allowance", () => {
  const FIGURE = /ALLOWANCE: ([\d.]+) \/ 11\.0 T/;
  const CEILING = 11.0;

  const helion = MISSIONS.filter((m) => m.client === 'helion');
  const carrying = helion.filter((m) => resolveBriefCards(m).some((c) => FIGURE.test(c.body)));

  /** Contract lift consigned up to and including each Helion mission. */
  const consignedBy = new Map<number, number>();
  {
    let running = 0;
    for (const m of helion) {
      running += m.payload.mass;
      consignedBy.set(m.id, running);
    }
  }

  it('only prints the figure once it is small enough to explain itself', () => {
    /**
     * The rule that makes this readable at all, and it was learned the hard way: the
     * figure was on all nine contracts, starting at 9.8, and it meant nothing. A large
     * number with no denominator in view is just a number that gets smaller, and nine
     * appearances spread over twenty-three missions is not a sequence anybody holds in
     * their head between sightings.
     *
     * Under three tonnes it reads on its own — a small number approaching zero is
     * self-explanatory in a way that 9.8 is not — and the four sightings are close enough
     * together to land as one movement.
     */
    expect(carrying.map((m) => m.id)).toEqual([18, 21, 25, 28]);
    for (const m of helion) {
      const shown = resolveBriefCards(m).some((c) => FIGURE.test(c.body));
      expect(shown, `mission ${m.id}`).toBe(CEILING - consignedBy.get(m.id)! < 3);
    }
  });

  it('actually equals the ceiling minus everything consigned so far', () => {
    /**
     * The one thing about this that can rot silently. The figures are authored text, not
     * computed at runtime, so changing any Helion payload mass leaves them describing a
     * contract that no longer exists — and nothing on screen would look wrong, because a
     * falling number still falls.
     */
    for (const m of carrying) {
      const card = resolveBriefCards(m).find((c) => FIGURE.test(c.body))!;
      const printed = Number(FIGURE.exec(card.body)![1]);
      expect(printed, `mission ${m.id}`).toBeCloseTo(CEILING - consignedBy.get(m.id)!, 5);
    }
  });

  it('belongs to the contract, not to the sender', () => {
    // The notice on mission 3 is from Helion and is not a contract, so it carries none:
    // the number is a property of contract 4471-C, not of the sender.
    const anywhere = MISSIONS.filter((m) => resolveBriefCards(m).some((c) => FIGURE.test(c.body)));
    expect(anywhere.every((m) => m.client === 'helion')).toBe(true);
  });

  it('ends with the writ, and says why in words rather than in arithmetic', () => {
    /**
     * The payoff, and the only part of it a player is guaranteed to get. Helion's last
     * consignment is the lightest thing they ship — 0.3 t of paper — and the reason is
     * that after the seam charges there is 0.7 t of contract left. Nobody should have to
     * do that subtraction, so the last contract states the consequence outright.
     */
    const last = helion[helion.length - 1];
    const penultimate = helion[helion.length - 2];
    expect(last.id).toBe(28);
    expect(last.payload.mass).toBeLessThan(penultimate.payload.mass);
    expect(last.payload.mass).toBeLessThanOrEqual(CEILING - consignedBy.get(penultimate.id)!);

    expect(transmission(last)).toContain('NO FURTHER CONSIGNMENT CAN BE SCHEDULED');
    // Once, at the end. Said earlier it would be a threat the contract cannot yet make.
    const saying = MISSIONS.filter((m) => transmission(m).includes('NO FURTHER CONSIGNMENT'));
    expect(saying.map((m) => m.id)).toEqual([28]);
  });
});

describe('drawn excavations', () => {
  /** Every dig the campaign draws rather than describes, with the mission that drew it. */
  const drawn = MISSIONS.flatMap((m) =>
    (m.adds?.digs ?? [])
      .filter((d): d is Excavation & { cells: Carved[] } => Array.isArray((d as Excavation).cells))
      .map((d) => ({ id: m.id, dig: d })),
  );

  it('parses every drawing in the campaign into cells', () => {
    // A guard on the wiring rather than on any drawing: `cells` arrives from YAML as text
    // and is replaced in place, so a mission whose block never got converted would reach
    // `carveFromDig` as a string and carve nothing at all, silently.
    expect(drawn.length).toBeGreaterThan(0);
    for (const { id, dig } of drawn) {
      expect(dig.cells.length, `mission ${id}`).toBeGreaterThan(0);
      for (const c of dig.cells) {
        expect(Number.isInteger(c.col) && Number.isInteger(c.row), `mission ${id}`).toBe(true);
      }
    }
  });

  it('opens through exactly one mouth', () => {
    // `mouthRun` throws on a solid top row or two separate runs, which are the two ways a
    // drawing can have no well-defined anchor. Calling it here means a malformed drawing
    // fails in a test rather than at canyon build time.
    for (const { id, dig } of drawn) {
      const run = mouthRun(dig.cells);
      expect(run.hi, `mission ${id}`).toBeGreaterThanOrEqual(run.lo);
    }
  });

  it('never authors a sealed pocket', () => {
    /**
     * Every carved cell reachable from the mouth through carved cells, four-connected.
     *
     * A pocket is not a rendering fault — `AntFarm` would draw it perfectly — it is a room
     * with no way in, and if a pad ever lands in one the mission is unwinnable with nothing
     * on screen to say why. Authored cells make this exhaustive; a generator could only
     * ever be sampled.
     */
    for (const { id, dig } of drawn) {
      const key = (c: Carved) => `${c.col}|${c.row}`;
      const open = new Set(dig.cells.map(key));
      const run = mouthRun(dig.cells);

      const seen = new Set<string>();
      const queue: Carved[] = [{ col: run.lo, row: 0 }];
      while (queue.length > 0) {
        const cell = queue.pop()!;
        const k = key(cell);
        if (seen.has(k) || !open.has(k)) continue;
        seen.add(k);
        queue.push(
          { col: cell.col + 1, row: cell.row },
          { col: cell.col - 1, row: cell.row },
          { col: cell.col, row: cell.row + 1 },
          { col: cell.col, row: cell.row - 1 },
        );
      }
      expect(seen.size, `mission ${id}: cells unreachable from the mouth`).toBe(open.size);
    }
  });

  it('agrees with the bounding box the rest of the campaign reasons in', () => {
    /**
     * `halfWidth` and `depth` stay authored — `TerrainDigs` puts a pad at
     * `mouthY + direction * depth` and `Layout` checks the corridor against the same
     * endpoint — so the drawing and the box are two descriptions of one hole and can drift
     * apart without anything looking wrong. One cell of tolerance, because the box is a
     * round number somebody typed and the drawing is quantised to the grid.
     */
    for (const { id, dig } of drawn) {
      const run = mouthRun(dig.cells);
      const widthCells = run.hi - run.lo + 1;
      const rows = Math.max(...dig.cells.map((c) => c.row)) + 1;

      expect(Math.abs(widthCells * SHAFT_CELL - dig.halfWidth * 2), `mission ${id} width`)
        .toBeLessThanOrEqual(SHAFT_CELL);
      expect(Math.abs(rows * SHAFT_CELL - dig.depth), `mission ${id} depth`)
        .toBeLessThanOrEqual(SHAFT_CELL);
    }
  });

  /**
   * Two tests lived here and were deleted deliberately, not lost.
   *
   * `anchors the mouth exactly where the rasteriser used to put it` and `carves exactly
   * what the tube it replaced carved` both pinned the port: while every drawing was a
   * redrawn tube they proved the change was invisible, which is the only thing that made
   * the port safe to do. Their own comment said what to do when that stopped being true —
   * *delete the case rather than the invariant* — and Ixion's working is what stopped it.
   * A one-column mouth widening to two is not a shape any `halfWidth` and `depth` can
   * describe, so a test comparing the two descriptions has nothing left to compare.
   */
  it('rejects a drawing with no mouth, or with two', () => {
    expect(() => mouthRun(parseCells('xxxx\n0000'))).toThrow(/no mouth/);
    expect(() => mouthRun(parseCells('0xx0\n0000'))).toThrow(/two mouths/);
    expect(() => parseCells('x?x')).toThrow(/unexpected/);
  });

  it('does not care about whitespace, and does about columns', () => {
    // Rock is spelled rather than implied precisely so that an indented block scalar
    // cannot shift a row east without anyone noticing.
    expect(parseCells('  xx00xx  \n xx00xx ')).toEqual(parseCells('xx00xx\nxx00xx'));
  });
});

describe('the terrain grid and the shaft grid', () => {
  it('puts every shaft boundary on a terrain vertex', () => {
    /**
     * The one relationship that has to hold for an excavation to meet the landscape
     * exactly rather than nearly.
     *
     * Terrain vertices fall at multiples of `CANYON.CELL`; a mouth's boundary falls at
     * `col · SHAFT_CELL ± SHAFT_CELL/2`. Unless half a shaft cell is a whole number of
     * terrain cells the two sets are disjoint, the hole gets cut along whichever terrain
     * column is nearest, and the shaft meets the ground up to half a terrain cell off.
     *
     * It was 4 against 12 for a long time — 6 is not a multiple of 4 — which made an exact
     * join arithmetically impossible and every seam at a mouth inevitable. Both numbers
     * read as arbitrary, so nothing about either one says they are related.
     */
    expect(SHAFT_CELL % (2 * CANYON.CELL)).toBe(0);
  });

  it('keeps the terrain coarse enough to read as plates', () => {
    // The look constraint the pitch was originally chosen for: the shortest wavelength in
    // the floor and upland relief is about 11 units, and the surface has to resolve as
    // angular facets rather than as a smooth sheet. Four samples per feature is the point
    // past which it stops doing that.
    expect(11 / CANYON.CELL).toBeLessThan(4);
  });
});

describe('decks in an excavation', () => {
  /** The drawing in force at a mission — the last one authored at or before it. */
  const drawingAt = (id: number): Carved[] | null => {
    let latest: Carved[] | null = null;
    for (const m of MISSIONS) {
      if (m.id > id) break;
      for (const d of m.adds?.digs ?? []) {
        const cells = (d as { cells?: unknown }).cells;
        if (Array.isArray(cells)) latest = cells as Carved[];
      }
    }
    return latest;
  };

  it('stands every deck on rock, never over open shaft', () => {
    /**
     * **No mid-air decks.** A deck inside an excavation rests on the floor of the cell it
     * was drawn in, so the cell below it has to be solid — and "below" changes as the
     * campaign digs. Kessler sinks the same bore three times, and each deepening turns the
     * rock under an existing deck into open shaft.
     *
     * The campaign handles it by striking the deck in the same mission that deepens past
     * it (`decommissions`), which is correct and entirely un-asserted: get the ordering
     * wrong by one mission and a landing pad hangs over a two-hundred-metre drop, looking
     * exactly like a landing pad.
     */
    for (const id of IDS) {
      const cells = drawingAt(id);
      if (!cells) continue;
      const carved = new Set(cells.map((c) => `${c.col}|${c.row}`));

      for (const p of worldAt(id, 0).props) {
        if (p.kind !== 'pad' || !p.atCell) continue;
        const { col, row } = p.atCell;
        expect(carved.has(`${col}|${row}`), `mission ${id}: deck ${p.id} is in solid rock`).toBe(true);
        expect(
          carved.has(`${col}|${row + 1}`),
          `mission ${id}: deck ${p.id} hangs over open shaft — the cell below it is carved`,
        ).toBe(false);
      }
    }
  });

  it('strikes a deck in the same mission the bore passes it', () => {
    // The mechanism the test above depends on, named so a failure says which of the two
    // broke. A deck may outlive its floor by exactly zero missions.
    for (const m of MISSIONS) {
      const deepened = (m.adds?.digs ?? []).some((d) => Array.isArray((d as { cells?: unknown }).cells));
      if (!deepened) continue;
      const cells = drawingAt(m.id)!;
      const carved = new Set(cells.map((c) => `${c.col}|${c.row}`));

      for (const p of worldAt(m.id - 1, 0).props) {
        if (p.kind !== 'pad' || !p.atCell) continue;
        const undermined = carved.has(`${p.atCell.col}|${p.atCell.row + 1}`);
        if (!undermined) continue;
        expect(
          (m.decommissions ?? []).includes(p.id),
          `mission ${m.id} digs out from under deck ${p.id} without striking it`,
        ).toBe(true);
      }
    }
  });
});

describe('the final charge', () => {
  const last = MISSIONS[MISSIONS.length - 1];

  it('weighs three times what the man sending it says it does', () => {
    /**
     * The last mission's whole reveal, and it is a *discrepancy* rather than a line.
     *
     * Kessler names six hundred kilos and the manifest says 1.8 tonnes — the second
     * heaviest thing in the campaign. After twenty-nine deliveries the player knows what a
     * light load feels like, so the discovery happens in their hands on the way down and
     * the brief only supplies a number to disagree with.
     *
     * Both halves are pinned because either alone is meaningless: change the payload to
     * 0.6 and the flight is ordinary, change the line and the flight is unexplained.
     */
    expect(last.payload.mass).toBe(1.8);
    expect(transmission(last)).toContain('Seven hundred kilos');
  });

  it('quotes a mass the player has genuinely flown before', () => {
    // "Same as the cutting charges" has to be true of the cutting charges, or the tell is
    // a mistake rather than a lie: the claim is checkable against the manifest, and being
    // checkable is what makes it worth checking.
    const cutting = MISSIONS.find((m) => m.payload.name === 'Cutting Charges')!;
    expect(cutting.payload.mass).toBeLessThan(1);
    expect(last.payload.mass / cutting.payload.mass).toBeGreaterThan(2);
  });

  it('is never reconciled anywhere in the campaign', () => {
    // Nobody notices, nobody corrects it, and no brief says who loaded it. Ixion, Kessler
    // and Helion's `AUTO` system are all supported by what is written, which is the point.
    const everything = [...MISSIONS.map(transmission), ...EPILOGUE.map((m) => m.content)].join(' ');
    expect(everything).not.toMatch(/heavier than|wrong charge|not six hundred|mislabel/i);
  });
});

describe('the calendar', () => {
  it('only ever moves forward', () => {
    for (let i = 1; i < MISSIONS.length; i++) {
      expect(MISSIONS[i].sol, `mission ${MISSIONS[i].id}`).toBeGreaterThan(MISSIONS[i - 1].sol);
    }
    expect(MISSIONS[0].sol).toBe(0);
  });

  it('fits inside one transfer window, with room after it', () => {
    /**
     * The constraint the whole timeline exists to satisfy. An Earth–Mars window opens about
     * every 759 sols, and the campaign has to fit inside one with a margin — mission 29
     * lands roughly a hundred sols before the next, which is what makes "something is
     * already on its way" true without anybody saying it.
     *
     * Run past 759 and the charters would have had a second window to resupply on, and
     * Helion's contract allowance counting down to nothing stops meaning anything.
     */
    const WINDOW = 759;
    const last = MISSIONS[MISSIONS.length - 1].sol;
    expect(last).toBeLessThan(WINDOW);
    expect(WINDOW - last).toBeGreaterThan(80);
  });

  it('makes the nine days literally nine', () => {
    // Ixion says "nine days of no drill running anywhere in this canyon". The order is
    // served on mission 8 and overturned on 11, and the arithmetic between them is the
    // line — not a figure of speech that happens to sound right.
    const served = getMission(8)!;
    const overturned = getMission(11)!;
    expect(transmission(overturned)).toContain('Nine days');
    expect(overturned.sol - served.sol).toBe(9);
  });

  it('runs at an uneven cadence, because the gaps are the story', () => {
    // A flat 22 sols would be a number that changes rather than a campaign that has a
    // shape: tight while the charters race, tighter still while they are stockpiling
    // under an order they cannot build through, and long once the arbitration starts
    // eating windows.
    const gaps = MISSIONS.slice(1).map((m, i) => m.sol - MISSIONS[i].sol);
    expect(Math.min(...gaps)).toBeLessThan(5);
    expect(Math.max(...gaps)).toBeGreaterThan(28);
  });

  it('gives each party its own clock, and only one of them a calendar', () => {
    /**
     * Three registers, and they must not collapse into one.
     *
     * Ixion counts sols — and from *their own landing*, eleven years back, not from your
     * first delivery. That distinction is what lets the numbers appear at all: 7347 and
     * 7905 state nothing about the campaign on their own, and their difference is the only
     * place its length exists. A count from mission 1 would have printed the answer.
     *
     * Kessler measures in felt time — a season, going on a year — never a job count.
     * Helion carries the sol in a file reference nobody reads, which is a machine
     * stamping a document rather than anybody keeping time.
     */
    const ixion = MISSIONS.filter((m) => m.client === 'outpost').map(transmission).join(' ');
    const stamps = [...ixion.matchAll(/Sol (\d{4})/g)].map((x) => Number(x[1]));
    expect(stamps.length).toBeGreaterThanOrEqual(2);
    // Eleven years of sols before the campaign starts, so no single figure is the answer.
    for (const stamp of stamps) expect(stamp).toBeGreaterThan(7000);
    expect(Math.max(...stamps) - Math.min(...stamps)).toBe(558);

    const helion = MISSIONS.filter((m) => m.client === 'helion');
    for (const m of helion) {
      expect(transmission(m), `mission ${m.id}`).toContain(`4471-C/${m.sol}`);
    }
  });

  it('lets nobody count your deliveries', () => {
    /**
     * The thing that makes the campaign read as time passing rather than a checklist
     * being worked through. Nobody keeps a running tally of your runs — not the console
     * between missions, not Ixion's sols (which count from *their own* landing, eleven
     * years back, not from yours), and not Kessler, who measures the mouth in felt time
     * ("going on a year down this mouth") rather than in a job number. A charter stating
     * a total, or its own run count, would be a narrator's slip: none of these three know
     * how long the story is, or that it is about to end — see `sol`'s own comment in
     * Missions.ts. The epilogue is the first thing in the campaign that finds either out,
     * and even it names no number.
     */
    const NO_TALLY =
      /thirtieth|twenty-ninth|your (thirtieth|last) run|that is (thirty|twenty-nine)|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+run\b/i;
    const spoken = MISSIONS.map(transmission).join(' ');
    expect(spoken).not.toMatch(NO_TALLY);
    const epilogueSpoken = EPILOGUE.map((m) => m.content).join(' ');
    expect(epilogueSpoken).not.toMatch(NO_TALLY);
  });

  it('never says how long any of it took', () => {
    /**
     * The rule that makes the sol counts worth carrying. The campaign's length exists only
     * as the difference between two briefs; state it and the player is told a fact instead
     * of finding one, and every sol count downgrades to set dressing.
     */
    const everything = [...MISSIONS.map(transmission), ...EPILOGUE.map((m) => m.content)].join(' ');
    expect(everything).not.toMatch(/six hundred (and )?twenty|628|a mars year|two years/i);
  });
});
