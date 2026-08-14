import type { Prop } from '../world/Colony.ts';
import type { CorpId } from '../world/CanyonSpec.ts';
import type { AirframeId } from '../entities/Airframe.ts';
import { resolveLayout } from './Layout.ts';
import { snapToColumn } from '../world/ColonyLattice.ts';
import type { DigEntry } from './TerrainDigs.ts';

/** What the cargo physically looks like strapped under the lander. */
export type CargoShape = 'crate' | 'drum' | 'sphere' | 'rig';

export interface Payload {
  name: string;
  /** Added to the 1.0 dry mass. Heavier cargo means sluggish thrust and rotation. */
  mass: number;
  /** Geometry of the pod on the lander. Inferred from the name when omitted. */
  shape?: CargoShape;
}

/**
 * Cargo you can recognise on sight. Mass already drives the pod's size; this gives
 * it a silhouette, so a run reads as "the heavy rig again" rather than "a bigger box".
 */
export function cargoShape(payload: Payload): CargoShape {
  if (payload.shape) return payload.shape;
  const n = payload.name.toLowerCase();
  if (/rig|drill|excavat|winch|bore|processor|reclaimer|scrubber/.test(n)) return 'rig';
  if (/cell|coolant|casing|liner|cable|pipeline|lighting|shell/.test(n)) return 'drum';
  if (/charge|beacon|core|array|pylon|anchor/.test(n)) return 'sphere';
  return 'crate';
}

export interface Mission {
  id: number;
  client: CorpId;
  payload: Payload;
  fuel: number;
  start: { x: number; y: number };
  /**
   * Pad id that counts as a delivery. Landing anywhere else is the wrong address.
   *
   * Null means the mission has no address: any survivable touchdown completes it, and
   * the scoring drops its pad-centring term. Only mission 1 does this, because mission
   * 1 is where the navigation system is still strapped under the lander.
   */
  target: string | null;
  /** Below this, the abyss takes you: SIGNAL LOST. Deepens as the colony digs. */
  failDepth: number;
  brief: string;
  /** Overrides the default entry velocity for this mission. */
  entry?: { vx?: number; vy?: number };
  /**
   * Overrides the vehicle this run flies. Left unset, it comes from the client — see
   * `airframeFor`, which is where the campaign's actual answer lives.
   */
  airframe?: AirframeId;
  /** Built at the start of this mission and standing for every mission after. */
  adds?: { props?: Prop[]; digs?: DigEntry[] };
  /**
   * Pads taken out of service at the start of this mission, by id, along with whatever
   * deck each one rests on.
   *
   * The ledger was append-only until this existed, on the grounds that a world which is
   * a pure function of the mission index is what makes a retry reproducible. Removal
   * does not threaten that — the world is still derived entirely from where you are in
   * the campaign — it just stops the derivation being monotonic.
   *
   * What forced it: Helion drove its cavern at x −33 directly beneath its own crest
   * deck, and by the time the cavern opened there was nowhere left on the west wall to
   * put either. The charter revising its own work is the honest reading, and it is the
   * one `docs/colony.md` already argued was worth the cost.
   */
  decommissions?: string[];
  /** Optional cell count override per corp for this mission (e.g. capping Mission 1 outpost to 3 blocks). */
  colonyBudget?: Partial<Record<CorpId, number>>;
}

/**
 * Which vehicle a client sends you out in.
 *
 * Kessler Deep dug every shaft in this canyon, and a shaft is the one place the twin
 * is unambiguously the better tool: locked rotation and canted engines put the vehicle
 * sideways on demand without ever having to recover an attitude, which is what
 * threading a 24-wide bore with rock on both sides actually asks for. Their hardware
 * follows the work they do.
 *
 * Ixion flies the standard lander because they are a science outpost landing on an open
 * pad, and Helion because their cavern approaches are a pitch-over-and-fly-in problem —
 * a vehicle that cannot rotate is the wrong tool for going in through a mouth in a wall.
 *
 * The split is deliberately not one frame per charter. There are three clients and two
 * vehicles, and the line that matters is who digs downward, not who signs the manifest.
 */
export function airframeFor(mission: Mission): AirframeId {
  if (mission.airframe) return mission.airframe;
  if (mission.id >= 6 && mission.client === 'helion') return 'helion';
  if (mission.client === 'kessler') return 'hauler';
  return 'lander';
}

/**
 * You do not spawn hovering — you arrive. Missions begin far above the rim already
 * falling hard, so the first job of every run is killing the velocity you came in
 * with. Combined with the entry altitude this is roughly 88 u/s to shed before
 * touchdown, which is what LANDER.THRUST is sized against.
 */
export const ENTRY_VELOCITY = { vx: 0, vy: -55 };

/**
 * Every landing surface in the campaign is 20% narrower than it was authored.
 *
 * One knob rather than seven edited numbers, because pad width is the single strongest
 * difficulty lever in the game and it wants to be adjustable in one place. It bites
 * twice: there is literally less deck to hit, and `scoreLanding` measures centring as
 * `1 − offset/halfWidth`, so the same landing that used to rank S now has to be placed
 * proportionally more accurately to hold that rank.
 *
 * Rounded to whole units so the authored proportions survive — the widest pad stays the
 * widest — and so the numbers stay legible next to a 24-wide bore.
 */
const PAD_WIDTH_SCALE = 0.72;

function padWidth(authored: number): number {
  return Math.round(authored * PAD_WIDTH_SCALE);
}

/**
 * A pad standing on its own, with no platform under it.
 *
 * `attachToDig` — see the `pad` variant's doc comment in `Colony.ts`. Authored `x`/`y`
 * are still required even when set, as the pre-resolution placeholder `Game.loadMission`
 * overwrites once the named dig's real endpoint is known — kept close to where the
 * eventual real position will actually land, so a bug that left resolution un-wired
 * would still read as roughly-plausible rather than obviously broken.
 */
export function pad(
  corp: CorpId,
  id: string,
  x: number,
  width: number,
  y?: number,
  attachToDig?: string,
  xFromDig?: string,
): Prop {
  return {
    kind: 'pad',
    id,
    corp,
    // Authored x is intent, not a measurement — every pad in the ledger is a round number
    // somebody typed. Snapping it to the colony lattice costs at most half a cell of
    // drift and stops the pad's own keep-out straddling two columns; see `snapToColumn`.
    // A pad whose x comes from a dig is snapped at resolution instead (`TerrainDigs`), so
    // that it stays on the bore's axis rather than being moved off it here.
    x: attachToDig === undefined && xFromDig === undefined ? snapToColumn(x) : x,
    width: padWidth(width),
    ...(y === undefined ? {} : { y }),
    ...(attachToDig === undefined ? {} : { attachToDig }),
    ...(xFromDig === undefined ? {} : { xFromDig }),
  };
}

/**
 * The campaign.
 *
 * Difficulty is not tuned in the abstract — it is the colony. Every mission adds
 * structures that stand for the rest of the game, so the corridor the player flies
 * narrows because of deliveries they themselves made. Helion holds the west
 * approach, Kessler the east; over thirty missions they build toward each other and
 * the airspace between them closes. Then the digging starts, and the game turns
 * downward: floor, then excavation, then the abyss that used to be the boundary.
 */
import { parse } from 'yaml';
import rawMissionsYaml from './missions.yaml?raw';

interface RawMissionSpec {
  missions: Mission[];
}

const parsed = parse(rawMissionsYaml) as RawMissionSpec;

export const MISSIONS: Mission[] = parsed.missions.map((m) => {
  if (m.adds?.props) {
    m.adds.props = m.adds.props.map((p) => {
      if (p.kind === 'pad') {
        return pad(p.corp, p.id, p.x, p.width, p.y, p.attachToDig, p.xFromDig);
      }
      return p;
    });
  }
  return m;
});

export const MISSION_COUNT = MISSIONS.length;

export function getMission(id: number): Mission | null {
  return MISSIONS.find((m) => m.id === id) ?? null;
}

/**
 * The world as it stands for a given mission: everything built up to and including
 * this one, plus the one structure the player sited themselves.
 *
 * The colony is a pure function of (campaign position, `mastX`), so retrying after a
 * crash rebuilds an identical canyon. `mastX` is written once when mission 1 is flown
 * and never revised, which is what keeps it a *parameter* of the world rather than
 * save state the world can drift with.
 *
 * Positions above are authored intent. `resolveLayout` is what makes them safe: it
 * leaves anything that already clears the landing rules exactly where it was written,
 * and relocates only the pieces that would otherwise stand on a pad or block the way
 * down to one. Running it here rather than at the call sites means the colony, its
 * colliders and the layout check can never disagree about where a structure is.
 */
/**
 * Strikes a pad from the ledger in place.
 *
 * Bare removal is enough now that pads carry no hand-authored platform under them —
 * the grown colony is whatever's standing at that x, and it answers to the mission
 * index and the corp's own maturity, not to this ledger. Helion's crest pad still
 * needs striking at mission 19: `cappedMouths` (Layout.ts) judges a mouth by x-overlap
 * alone, with no height exemption, so a pad left standing at the cavern's own x would
 * still read as capping it from above even with nothing but the grown colony behind it.
 */
function decommission(props: Prop[], padId: string): void {
  const i = props.findIndex((p) => p.kind === 'pad' && p.id === padId);
  if (i >= 0) props.splice(i, 1);
}

/**
 * The authored ledger up to mission `id` — pads, cave roofs, digs, decommissions,
 * the radar — nothing colony-grown. Deliberately pure: no `seed` or `ranks` parameter,
 * no terrain, no `synthesizeColonies` call. Colony growth used to run in here (reading
 * `ranks` to derive density), before any terrain existed for the mission being loaded
 * (`Game.loadMission` calls `canyon.build` *after* this) — it now runs separately, from
 * `ColonyGeneration.synthesizeColonies`, once real terrain does, and takes `ranks`
 * directly rather than through here. See `docs/plans/procedural_colony_growth.md`.
 *
 * `digs` can still contain unresolved `WallAnchoredDig` entries (`TerrainDigs.ts`) —
 * resolving those needs terrain too, so it also happens downstream, in
 * `Game.loadMission`, not here.
 */
export function worldAt(
  id: number,
  mastX: number | null = null,
  mastY: number | null = null,
): { props: Prop[]; digs: DigEntry[] } {
  const props: Prop[] = [];
  const digs: DigEntry[] = [];
  for (const mission of MISSIONS) {
    if (mission.id > id) break;
    if (mission.adds?.props) props.push(...mission.adds.props);
    if (mission.adds?.digs) digs.push(...mission.adds.digs);
    // Applied in mission order, so a pad can be built, used for a dozen runs and then
    // struck — and a world rebuilt for any earlier mission still has it standing.
    for (const id of mission.decommissions ?? []) decommission(props, id);
  }
  const resolved = resolveLayout(props);

  /**
   * The radar goes in after the resolver, deliberately.
   *
   * It carries no collider — it is a landmark, and landmarks are never the thing that
   * kills you — so it has nothing to clear and nothing to be relocated for. Which also
   * means the player is free to plant it somewhere a later Helion tower will grow
   * through: they overlap, and neither one changes how the canyon flies.
   */
  if (id >= 2 && mastX !== null) {
    resolved.push({
      kind: 'radar',
      corp: 'outpost',
      x: mastX,
      ...(mastY !== null ? { y: mastY } : {}),
    });
  }

  return { props: resolved, digs };
}
