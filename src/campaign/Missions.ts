import type { Prop } from '../world/Colony.ts';
import type { Excavation } from '../world/CanyonGenerator.ts';
import type { CorpId } from '../world/CanyonSpec.ts';
import type { AirframeId } from '../entities/Airframe.ts';
import { checkLayout, resolveLayout } from './Layout.ts';

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
  adds?: { props?: Prop[]; digs?: Excavation[] };
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
  return mission.airframe ?? (mission.client === 'kessler' ? 'hauler' : 'lander');
}

/**
 * You do not spawn hovering — you arrive. Missions begin far above the rim already
 * falling hard, so the first job of every run is killing the velocity you came in
 * with. Combined with the entry altitude this is roughly 88 u/s to shed before
 * touchdown, which is what LANDER.THRUST is sized against.
 */
export const ENTRY_VELOCITY = { vx: 0, vy: -55 };

/**
 * A landing platform plus the pad resting on it.
 *
 * `apron` is how much wider the platform is than its pad. Generous by default: the
 * platform's flanks are lethal structure, so a narrow skirt turns every slightly-off
 * approach into a crash against the very thing you were aiming for.
 *
 * Decks *inside a shaft* want the opposite. There the bore is only 24 across, so a
 * default apron makes a 19-wide slab in a 24-wide hole — which is what made the descent
 * past it nearly unflyable, and left no width for the bore to meander into either.
 */
function deck(
  corp: CorpId,
  id: string,
  x: number,
  y: number,
  width: number,
  apron = 7,
): Prop[] {
  const w = padWidth(width);
  return [
    { kind: 'platform', corp, x, y, width: w + apron },
    { kind: 'pad', id, corp, x, y: y + 1, width: w },
  ];
}

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
const PAD_WIDTH_SCALE = 0.8;

function padWidth(authored: number): number {
  return Math.round(authored * PAD_WIDTH_SCALE);
}

/** A pad standing on its own, with no platform under it. */
function pad(corp: CorpId, id: string, x: number, width: number, y?: number): Prop {
  return { kind: 'pad', id, corp, x, width: padWidth(width), ...(y === undefined ? {} : { y }) };
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
export const MISSIONS: Mission[] = [
  // ---------------------------------------------------- I. The Descent (1-4)
  {
    id: 1,
    client: 'outpost',
    payload: { name: 'Navigation Radar', mass: 0.5, shape: 'sphere' },
    fuel: 405,
    start: { x: 0, y: 1290 },
    // No address. The thing that tells a lander where addresses *are* is the cargo.
    target: null,
    failDepth: -60,
    brief:
      '<b>UPLINK</b> · established<br/><b>IXION OUTPOST</b><br/>Welcome to Coprates Chasma, pilot. We are the only thing at the bottom of this canyon, and we intend to stay that way.<br/><br/>You are carrying our navigation radar. Until it is standing on the floor of this chasm you have no altimeter, no ranging and no target guidance — so put it down somewhere, anywhere, in one piece. Where you land is where it stays.<br/><br/><b>OBJECTIVE</b> Descend past the rim. Land intact on open ground.',
  },
  {
    id: 2,
    client: 'outpost',
    payload: { name: 'Core Samples', mass: 0.4 },
    fuel: 380,
    start: { x: -4, y: 1250 },
    target: 'outpost-main',
    failDepth: -60,
    brief:
      '<b>IXION OUTPOST</b><br/>Radar is up and slaved to your panel — altitude, range and target bearing, all of it off the mast you planted yesterday. Our pad is in as well, so from here on you are flying to an address.<br/><br/>Second run. Watch your descent rate: the canyon floor is not forgiving, and neither is the west wall.<br/><br/><b>OBJECTIVE</b> Deliver core samples to the outpost pad.',
    adds: {
      props: [
        pad('outpost', 'outpost-main', -14, 16),
        { kind: 'mast', corp: 'outpost', x: -8, topY: 42 },
      ],
    },
  },
  {
    id: 3,
    client: 'outpost',
    payload: { name: 'Water Reclaimer', mass: 0.8 },
    fuel: 370,
    start: { x: 4, y: 1230 },
    target: 'outpost-main',
    failDepth: -60,
    brief:
      '<b>IXION OUTPOST</b><br/>Heavier load today. Mass makes the lander slow to answer the stick — start your corrections earlier than feels right.<br/><br/><b>OBJECTIVE</b> Deliver the reclaimer to the outpost pad.',
    adds: { props: [{ kind: 'mast', corp: 'outpost', x: 7, topY: 48 }] },
  },
  {
    id: 4,
    client: 'outpost',
    payload: { name: 'Claim Filings', mass: 0.2 },
    fuel: 350,
    start: { x: -5, y: 1250 },
    target: 'outpost-main',
    failDepth: -60,
    brief:
      '<b>IXION OUTPOST</b><br/>Two extraction charters just cleared orbit. Helion to our west, Kessler to our east. We filed first. It will not matter.<br/><br/><b>OBJECTIVE</b> Deliver the filings before the corporate survey lands.',
    adds: {
      props: [{ kind: 'tower', corp: 'helion', x: -52, width: 11, topY: 88 }],
    },
  },

  // ------------------------------------------------ II. The Corporations (5-9)
  {
    id: 5,
    client: 'helion',
    payload: { name: 'Drill Head', mass: 1.2 },
    fuel: 380,
    start: { x: -7, y: 1250 },
    target: 'helion-crest',
    failDepth: -60,
    brief:
      '<b>HELION EXTRACTION</b><br/>You fly for us now. Our crest platform is live on the west approach — bring the drill head in on the platform, not the outpost slab. We pay for addresses, not effort.<br/><br/><b>OBJECTIVE</b> Deliver to HELION CREST.',
    adds: { props: deck('helion', 'helion-crest', -33, 66, 14) },
  },
  {
    id: 6,
    client: 'kessler',
    payload: { name: 'Seismic Array', mass: 0.9 },
    fuel: 385,
    start: { x: 7, y: 1250 },
    target: 'kessler-crest',
    failDepth: -60,
    brief:
      '<b>KESSLER DEEP</b><br/>Helion drills sideways. We drill down. Our east tower is up and our deck is waiting.<br/><br/>You will be flying one of ours. Nothing that goes down a bore has any business turning, so it does not.<br/><br/><b>OBJECTIVE</b> Deliver the array to KESSLER CREST.',
    adds: {
      props: [
        { kind: 'tower', corp: 'kessler', x: 52, width: 12, topY: 96 },
        ...deck('kessler', 'kessler-crest', 34, 72, 14),
      ],
    },
  },
  {
    id: 7,
    client: 'helion',
    payload: { name: 'Coolant Cells', mass: 1.1 },
    fuel: 365,
    start: { x: 3, y: 1210 },
    target: 'helion-crest',
    failDepth: -60,
    brief:
      '<b>HELION EXTRACTION</b><br/>Kessler has started building toward the centre line. So have we. Mind the new mast on your approach.<br/><br/><b>OBJECTIVE</b> Deliver coolant to HELION CREST.',
    adds: { props: [{ kind: 'mast', corp: 'helion', x: -15, topY: 104 }] },
  },
  {
    id: 8,
    client: 'kessler',
    payload: { name: 'Bore Casing', mass: 1.5 },
    fuel: 400,
    start: { x: -11, y: 1230 },
    target: 'kessler-crest',
    failDepth: -60,
    brief:
      '<b>KESSLER DEEP</b><br/>Casing is heavy and you are starting on the wrong side of the canyon. Cross high or cross low, but cross deliberately.<br/><br/><b>OBJECTIVE</b> Carry the casing east to KESSLER CREST.',
    adds: { props: [{ kind: 'mast', corp: 'kessler', x: 14, topY: 110 }] },
  },
  {
    id: 9,
    client: 'outpost',
    payload: { name: 'Legal Injunction', mass: 0.2 },
    fuel: 340,
    start: { x: 0, y: 1190 },
    target: 'outpost-main',
    failDepth: -60,
    brief:
      '<b>IXION OUTPOST</b><br/>They are building on our sightlines. This injunction will be ignored, but it will be <i>filed</i>.<br/><br/><b>OBJECTIVE</b> Return to the outpost pad.',
    adds: {
      props: [{ kind: 'tower', corp: 'helion', x: -64, width: 11, topY: 132 }],
    },
  },

  // ------------------------------------------------ III. The Corridor (10-14)
  {
    id: 10,
    client: 'helion',
    payload: { name: 'Pipeline Segment', mass: 1.6 },
    fuel: 405,
    start: { x: -13, y: 1230 },
    target: 'helion-crest',
    failDepth: -60,
    brief:
      '<b>HELION EXTRACTION</b><br/>We are spanning the west approach. Once this goes up, the gap under it is your only clean line in.<br/><br/><b>OBJECTIVE</b> Deliver the segment to HELION CREST.',
    adds: {
      props: [{ kind: 'gantry', corp: 'helion', x1: -64, x2: -52, y: 118 }],
    },
  },
  {
    id: 11,
    client: 'kessler',
    payload: { name: 'Winch Assembly', mass: 1.3 },
    fuel: 390,
    start: { x: 13, y: 1210 },
    target: 'kessler-crest',
    failDepth: -60,
    brief:
      '<b>KESSLER DEEP</b><br/>Our own span goes up today. Helion will call it provocation. It is a winch.<br/><br/><b>OBJECTIVE</b> Deliver the winch to KESSLER CREST.',
    adds: {
      props: [
        { kind: 'tower', corp: 'kessler', x: 65, width: 12, topY: 124 },
        { kind: 'gantry', corp: 'kessler', x1: 52, x2: 65, y: 106 },
      ],
    },
  },
  {
    id: 12,
    client: 'outpost',
    payload: { name: 'Atmosphere Scrubber', mass: 1.4 },
    fuel: 385,
    start: { x: -8, y: 1170 },
    target: 'outpost-main',
    failDepth: -60,
    brief:
      '<b>IXION OUTPOST</b><br/>Both charters now have structures inside a hundred metres of us. The sky above this pad is the only thing still open.<br/><br/><b>OBJECTIVE</b> Bring the scrubber home.',
    adds: { props: [{ kind: 'mast', corp: 'outpost', x: -4, topY: 60 }] },
  },
  {
    id: 13,
    client: 'helion',
    payload: { name: 'Cutting Charges', mass: 0.7 },
    fuel: 360,
    start: { x: 11, y: 1170 },
    target: 'helion-crest',
    failDepth: -60,
    brief:
      '<b>HELION EXTRACTION</b><br/>Charges are light but you are crossing the whole canyon under two spans to get here. Fuel is not generous.<br/><br/><b>OBJECTIVE</b> Deliver charges to HELION CREST.',
    adds: {
      props: [{ kind: 'gantry', corp: 'helion', x1: -52, x2: -33, y: 92, thickness: 2 }],
    },
  },
  {
    id: 14,
    client: 'kessler',
    payload: { name: 'Shaft Liner', mass: 1.7 },
    fuel: 405,
    start: { x: 0, y: 1170 },
    target: 'kessler-crest',
    failDepth: -60,
    brief:
      '<b>KESSLER DEEP</b><br/>Last surface delivery. Tomorrow we open the floor.<br/><br/><b>OBJECTIVE</b> Deliver the liner to KESSLER CREST.',
    adds: {
      props: [{ kind: 'gantry', corp: 'kessler', x1: 34, x2: 52, y: 94, thickness: 2 }],
    },
  },

  // -------------------------------------------------- IV. The Digging (15-19)
  {
    id: 15,
    client: 'kessler',
    payload: { name: 'Excavator Core', mass: 1.5 },
    fuel: 405,
    start: { x: 5, y: 1150 },
    target: 'kessler-crest',
    failDepth: -95,
    brief:
      '<b>KESSLER DEEP</b><br/>The shaft is open. Do not go down it yet — there is nothing down there to land on and the walls are unlined.<br/><br/><b>OBJECTIVE</b> Deliver the core to KESSLER CREST.',
    adds: {
      digs: [{ x: 10, halfWidth: 12, depth: 58 }],
      props: [{ kind: 'mast', corp: 'kessler', x: 18, topY: 78 }],
    },
  },
  {
    id: 16,
    client: 'kessler',
    payload: { name: 'Shaft Lighting', mass: 0.6 },
    fuel: 390,
    start: { x: 0, y: 1130 },
    target: 'kessler-shaft',
    failDepth: -95,
    brief:
      '<b>KESSLER DEEP</b><br/>Pad is in at the shaft floor. Fifty-eight metres below the canyon, walls close on both sides. Come down slow and come down straight.<br/><br/><b>OBJECTIVE</b> Descend the shaft. Deliver to KESSLER SHAFT.',
    adds: {
      props: [pad('kessler', 'kessler-shaft', 10, 12)],
    },
  },
  {
    id: 17,
    client: 'helion',
    payload: { name: 'Lateral Bore Rig', mass: 1.8 },
    fuel: 420,
    start: { x: -14, y: 1150 },
    target: 'helion-crest',
    failDepth: -95,
    brief:
      '<b>HELION EXTRACTION</b><br/>Kessler dug a hole. We are digging a room. Heaviest rig you have carried — respect the inertia.<br/><br/><b>OBJECTIVE</b> Deliver the rig to HELION CREST.',
    adds: {
      digs: [{ x: -33, halfWidth: 10, depth: 46 }],
    },
  },
  {
    id: 18,
    client: 'helion',
    payload: { name: 'Roof Bracing', mass: 1.2 },
    fuel: 405,
    start: { x: -2, y: 1130 },
    target: 'helion-crest',
    failDepth: -95,
    brief:
      '<b>HELION EXTRACTION</b><br/>Bracing goes over the west excavation. After today that pit has a ceiling, and getting under it is a flying problem.<br/><br/><b>OBJECTIVE</b> Deliver bracing to HELION CREST.',
    adds: {
      props: [{ kind: 'caveRoof', corp: 'helion', x: -33, halfWidth: 9, y: -12 }],
    },
  },
  {
    id: 19,
    client: 'helion',
    payload: { name: 'Ore Processor', mass: 1.6 },
    fuel: 430,
    start: { x: 4, y: 1130 },
    target: 'helion-cavern',
    failDepth: -95,
    brief:
      '<b>HELION EXTRACTION</b><br/>The cavern pad is lit. You will have to fly beneath the bracing and level off inside — no vertical approach, the roof is in the way.<br/><br/><b>OBJECTIVE</b> Enter the west cavern. Deliver to HELION CAVERN.',
    adds: {
      props: [pad('helion', 'helion-cavern', -33, 12)],
    },
  },

  // --------------------------------------------------- V. The Abyss (20-24)
  {
    id: 20,
    client: 'kessler',
    payload: { name: 'Anchor Pylons', mass: 1.5 },
    fuel: 420,
    start: { x: 0, y: 1130 },
    target: 'kessler-shaft',
    failDepth: -95,
    brief:
      '<b>KESSLER DEEP</b><br/>We are sinking the main shaft. The hole you have spent five missions landing beside goes down another hundred and thirty metres tonight.<br/><br/><b>OBJECTIVE</b> Deliver pylons to KESSLER SHAFT.',
    adds: {
      // Headframe over the shaft, and the shaft itself driven far deeper. Later digs
      // at the same X win inside their half-width, so this simply extends it down.
      digs: [{ x: 10, halfWidth: 12, depth: 172 }],
      props: [
        { kind: 'mast', corp: 'kessler', x: 21, topY: 96 },
        { kind: 'gantry', corp: 'kessler', x1: 3, x2: 21, y: 40, thickness: 2.6 },
      ],
    },
  },
  {
    id: 21,
    client: 'kessler',
    payload: { name: 'Descent Cable', mass: 1.0 },
    fuel: 430,
    start: { x: -4, y: 1130 },
    target: 'kessler-ledge',
    failDepth: -190,
    brief:
      '<b>KESSLER DEEP</b><br/>First platform is bolted into the shaft wall, forty-six metres down. Line up over the mouth and descend straight — the shaft is barely wider than your gear, and there is no room to correct once you are in it.<br/><br/><b>OBJECTIVE</b> Deliver to KESSLER LEDGE.',
    // Held against the east wall rather than centred in the shaft. Centred, its 19-unit
    // apron left two 7.5-unit slots either side of it — both passable, neither obviously
    // the way through, and every descent to the pads below became a guess. Against the
    // wall it leaves one unambiguous 13-unit chute down the west side, which is also
    // what the brief has always claimed: bolted into the shaft wall.
    /**
     * A bare pad on the bore's centreline, not a deck against its wall.
     *
     * Two corrections in one. No apron, because a platform's skirt made a slab filling
     * most of a 24-wide bore — unflyable, and the thing forcing the bore to stay a
     * straight rectangle. And centred, because the bore now narrows and wanders: the band
     * guaranteed clear at every depth is only `x +/- (half - wander)`, about 18 wide, so a
     * pad held against the wall had its outer edge inside rock and lost 17% of its
     * approach. Centred, an 11-wide pad fits that band with room either side.
     */
    adds: { props: [pad('kessler', 'kessler-ledge', 10, 11, -45)] },
  },
  {
    id: 22,
    client: 'helion',
    payload: { name: 'Counterclaim Beacon', mass: 0.8 },
    fuel: 420,
    start: { x: 16, y: 1110 },
    target: 'helion-cavern',
    failDepth: -190,
    brief:
      '<b>HELION EXTRACTION</b><br/>Kessler is down the shaft. We are contesting it. Take this beacon to our cavern and then, for your own sake, stay out of the arbitration.<br/><br/><b>OBJECTIVE</b> Cross the canyon. Deliver to HELION CAVERN.',
    adds: {
      props: [{ kind: 'gantry', corp: 'helion', x1: -18, x2: -7, y: 96, thickness: 2.4 }],
    },
  },
  {
    id: 23,
    client: 'kessler',
    payload: { name: 'Pressure Rig', mass: 1.7 },
    fuel: 445,
    start: { x: 0, y: 1110 },
    target: 'kessler-ledge',
    failDepth: -190,
    brief:
      '<b>KESSLER DEEP</b><br/>Heavy rig, and the ledge is narrow. This is the run that separates pilots from cargo.<br/><br/><b>OBJECTIVE</b> Deliver the rig to KESSLER LEDGE.',
    adds: {
      props: [{ kind: 'tower', corp: 'kessler', x: 78, width: 12, topY: 150 }],
    },
  },
  {
    id: 24,
    client: 'outpost',
    payload: { name: 'Evacuation Order', mass: 0.2 },
    fuel: 365,
    start: { x: -16, y: 1110 },
    target: 'outpost-main',
    failDepth: -190,
    brief:
      '<b>IXION OUTPOST</b><br/>Both charters have hit the same seam from opposite sides. We have recommended evacuation. Nobody has acknowledged it.<br/><br/><b>OBJECTIVE</b> Bring the order to the outpost pad.',
    adds: {
      props: [{ kind: 'gantry', corp: 'helion', x1: -54, x2: -43, y: 88, thickness: 2.4 }],
    },
  },

  // ------------------------------------------------- VI. The Gauntlet (25-30)
  {
    id: 25,
    client: 'kessler',
    payload: { name: 'Deep Lighting Rig', mass: 1.1 },
    fuel: 430,
    start: { x: 5, y: 1110 },
    target: 'kessler-deep',
    failDepth: -320,
    brief:
      '<b>KESSLER DEEP</b><br/>Second platform, a hundred and forty-two metres down. Below the ledge the shaft squeezes and the fog goes black. Trust the altimeter, not your eyes.<br/><br/><b>OBJECTIVE</b> Deliver to KESSLER DEEP.',
    // Bare pad on the centreline, for the same reasons as kessler-ledge.
    adds: { props: [pad('kessler', 'kessler-deep', 10, 11, -141)] },
  },
  {
    id: 26,
    client: 'helion',
    payload: { name: 'Seam Charges', mass: 1.4 },
    fuel: 420,
    start: { x: 19, y: 1090 },
    target: 'helion-cavern',
    failDepth: -320,
    brief:
      '<b>HELION EXTRACTION</b><br/>Full crossing, west cavern, under the bracing. You have done every piece of this before. Not all on one tank.<br/><br/><b>OBJECTIVE</b> Deliver charges to HELION CAVERN.',
    adds: {
      props: [{ kind: 'gantry', corp: 'kessler', x1: 31, x2: 43, y: 52, thickness: 2.2 }],
    },
  },
  {
    id: 27,
    client: 'kessler',
    payload: { name: 'Containment Shell', mass: 1.9 },
    fuel: 460,
    start: { x: -11, y: 1090 },
    target: 'kessler-deep',
    failDepth: -320,
    brief:
      '<b>KESSLER DEEP</b><br/>Heaviest object anyone has flown in this canyon. West wall to the bottom of the shaft, through everything both charters have built.<br/><br/><b>OBJECTIVE</b> Deliver the shell to KESSLER DEEP.',
    adds: {
      props: [{ kind: 'mast', corp: 'helion', x: -29, topY: 148 }],
    },
  },
  {
    id: 28,
    client: 'outpost',
    payload: { name: 'Core Archive', mass: 1.0 },
    fuel: 390,
    start: { x: 20, y: 1070 },
    target: 'outpost-main',
    failDepth: -320,
    brief:
      '<b>IXION OUTPOST</b><br/>We are shutting down. Everything the outpost learned about this canyon is in that archive. Fly it home one last time.<br/><br/><b>OBJECTIVE</b> Return the archive to the outpost pad.',
    adds: {
      props: [{ kind: 'gantry', corp: 'kessler', x1: 7, x2: 18, y: 126, thickness: 2.2 }],
    },
  },
  {
    id: 29,
    client: 'helion',
    payload: { name: 'Arbitration Writ', mass: 0.3 },
    fuel: 350,
    start: { x: 0, y: 1070 },
    target: 'helion-cavern',
    failDepth: -320,
    brief:
      '<b>HELION EXTRACTION</b><br/>The outpost is dark. The seam is ours and Kessler disputes it. Light cargo, thin margins, and a canyon that no longer has an easy line through it.<br/><br/><b>OBJECTIVE</b> Deliver the writ to HELION CAVERN.',
    adds: {
      props: [{ kind: 'gantry', corp: 'helion', x1: -7, x2: 5, y: 140, thickness: 2.4 }],
    },
  },
  {
    id: 30,
    client: 'kessler',
    payload: { name: 'Final Charge', mass: 1.8 },
    fuel: 445,
    start: { x: -18, y: 1070 },
    target: 'kessler-deep',
    failDepth: -320,
    brief:
      '<b>KESSLER DEEP</b><br/>Thirtieth run. West wall to the floor of the shaft, and every structure in between was put there by you.<br/><br/><b>OBJECTIVE</b> Deliver the charge to KESSLER DEEP.',
    adds: {
      props: [{ kind: 'mast', corp: 'kessler', x: 36, topY: 158 }],
    },
  },
];

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
export function worldAt(
  id: number,
  mastX: number | null = null,
): { props: Prop[]; digs: Excavation[] } {
  const props: Prop[] = [];
  const digs: Excavation[] = [];
  for (const mission of MISSIONS) {
    if (mission.id > id) break;
    if (mission.adds?.props) props.push(...mission.adds.props);
    if (mission.adds?.digs) digs.push(...mission.adds.digs);
  }
  const resolved = resolveLayout(props, digs);

  // The resolver only moves what it can move — a platform is bolted to its tower and
  // stays put. If one of those ever ends up over a pad, nothing downstream will notice
  // and the mission just quietly becomes harder to land, so say so during development.
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    for (const v of checkLayout(resolved, digs)) {
      console.warn(`[layout] mission ${id}: ${v.prop} ${v.detail} (pad ${v.pad})`);
    }
  }

  /**
   * The radar goes in after the resolver, deliberately.
   *
   * It carries no collider — it is a landmark, and landmarks are never the thing that
   * kills you — so it has nothing to clear and nothing to be relocated for. Which also
   * means the player is free to plant it somewhere a later Helion tower will grow
   * through: they overlap, and neither one changes how the canyon flies.
   */
  if (id >= 2 && mastX !== null) {
    resolved.push({ kind: 'radar', corp: 'outpost', x: mastX });
  }

  return { props: resolved, digs };
}
