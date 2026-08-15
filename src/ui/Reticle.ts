/**
 * The augmented layer painted on the vehicle itself.
 *
 * This one is **yours**, not the airframe's. The console in the corner is whatever
 * hardware the charter bought — three eras, three colour schemes, changing hands as the
 * campaign does. The overlay is the AI doing the flying, so it looks the same on all
 * three frames and never takes a client's livery. That split is the point: as the panel
 * changes underneath you, the brackets and the vector arrow are the one thing on screen
 * that stays yours, and the player keeps a fixed reference through every handover.
 *
 * It also divides the labour with the panel rather than duplicating it. The overlay
 * answers *where am I going and how level am I* — direction and attitude, read at the
 * vehicle, where the eyes already are on final approach. The panel answers *will this
 * kill me* — magnitude against tolerance, per axis. So the arrow may carry a scalar
 * speed without reopening the argument against a scalar on the panel: the axes are still
 * split where the landing is actually decided.
 *
 * Brackets rather than a true silhouette outline, and the reason is frame time. This
 * scene is fragment-bound — CLAUDE.md records MSAA alone measuring about half again the
 * frame cost — and a post-process edge pass is the same class of expense. Corner
 * brackets sized from the projected hull radius cost nothing, track the camera's zoom
 * exactly, and read more like a targeting overlay than a glow would.
 */

import * as THREE from 'three';
import { LANDER } from '../entities/Lander.ts';
import { VELOCITY_SPAN } from './HudData.ts';
import { driftAngle, drifting, vectorReach } from './Instruments.ts';

export interface ReticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * Radians from upright, or `null` on a frame whose rotation is locked.
   *
   * Null rather than zero, for the same reason the tilt dial was removed rather than
   * pinned at zero: an indicator on screen asserts that the quantity it shows can kill
   * you. The two locked frames also carry a cosmetic `bank`, and it must never be fed
   * here — nothing in the simulation reads that lean, so drawing it would claim a
   * consequence it does not have.
   */
  tilt: number | null;
  /**
   * Whether the vehicle can measure how fast it is going.
   *
   * Mission one flies with the radar still in the hold, and the arrow and the numeral
   * fall on opposite sides of that. Direction is not ranging — which way you are sliding
   * is a thing your own eyes report, and the overlay drawing it takes nothing away. A
   * figure in u/s is ranging, and printing one on the hull would undo the lesson that
   * mission is built to teach, more thoroughly than the panel ever could: it would sit
   * exactly where the player is already looking.
   */
  ranging: boolean;
  /**
   * Whether the uplink has finished and the vehicle is yours.
   *
   * This used to key off the camera leaving its sky framing, on the reasoning that the
   * vehicle was a distant speck up there and the overlay would have nothing to say about
   * a few pixels of hull. That reasoning was simply wrong — the sky framing is a *close*
   * follow shot, 3.8 behind and 6.1 above, so the vehicle fills as much of the frame at
   * entry altitude as it does anywhere. Nothing was being protected.
   *
   * Keyed on the handshake instead, which is what the layer actually depicts: the overlay
   * is the AI's projection onto a vehicle it has connected to, so it appears at the
   * moment that connection completes and control is handed over. Position keeps updating
   * underneath while stowed, so it fades in already in the right place.
   */
  acquired: boolean;
}

/**
 * The vehicle's own silhouette, in model space, from `Lander.visualBounds`.
 *
 * Passed in rather than assumed, because it is per-mission: the cargo dominates the
 * outline and runs from 0.900 above the origin on mission 1 to 1.368 on mission 30.
 */
export interface HullBounds {
  halfWidth: number;
  halfHeight: number;
  /** Offset of the visual centre from the origin the physics tracks. About +0.38. */
  centreY: number;
}

/** How far outside the hull the brackets sit. */
const BRACKET_MARGIN = 1.3;

/** Smallest half-extent the overlay is allowed to draw, in px. */
const MIN_HALF = 11;

/** Arrow length at a standstill and at full scale, in px. */
const REACH_MIN = 14;
const REACH_MAX = 46;

function el(className: string, html?: string): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export class Reticle {
  readonly root = el('ar hidden');

  private box = el('ar-box');
  private vector = el('ar-vector');
  private vectorStem = el('ar-vector-stem');
  private speed = el('ar-speed');
  private tilt = el('ar-tilt');
  private tiltIndex = el('ar-tilt-index');

  private centre = new THREE.Vector3();
  private edge = new THREE.Vector3();

  constructor() {
    for (const corner of ['tl', 'tr', 'bl', 'br']) this.box.append(el(`ar-bracket ar-${corner}`));

    // The speed rides on the arrow rather than at a fixed spot under the vehicle, where
    // it collided with the arrow on the commonest heading of all — straight down.
    this.vectorStem.append(this.speed);
    this.vector.append(this.vectorStem);
    this.tilt.append(this.tiltIndex);

    this.root.append(this.box, this.tilt, this.vector);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  /**
   * Follows the vehicle, sized to how big it currently looks.
   *
   * Both the scale and the centre are derived rather than assumed. The camera pulls back
   * through a descent, so a frame at a fixed pixel size would swallow the vehicle at
   * altitude and sit inside it on the pad; and the point the physics tracks is not the
   * middle of the silhouette, because the load stands on the deck and the gear hangs
   * below it. Projecting the origin and a point one `LANDER.RADIUS` along +x gives
   * pixels-per-world-unit for one extra projection, and everything else falls out of the
   * measured bounds.
   */
  update(camera: THREE.Camera, s: ReticleState, hull: HullBounds): void {
    if (this.root.classList.contains('hidden')) return;
    this.root.classList.toggle('stowed', !s.acquired);

    const w = window.innerWidth;
    const h = window.innerHeight;

    this.centre.set(s.x, s.y, 0).project(camera);
    // Behind the lens the projection folds through the origin and every reading below
    // would be mirrored. There is nothing to draw on the vehicle you cannot see.
    if (this.centre.z > 1) {
      this.root.classList.add('off');
      return;
    }
    this.edge.set(s.x + LANDER.RADIUS, s.y, 0).project(camera);

    const ox = (this.centre.x * 0.5 + 0.5) * w;
    const oy = (this.centre.y * -0.5 + 0.5) * h;
    const scale = Math.abs((this.edge.x * 0.5 + 0.5) * w - ox) / LANDER.RADIUS;

    // The frame hangs on the middle of the vehicle, not on the collider origin. Screen
    // +y runs down, so a centre above the origin is a subtraction.
    const cx = ox;
    const cy = oy - hull.centreY * scale;

    const margin = 90;
    const onScreen = cx > -margin && cx < w + margin && cy > -margin && cy < h + margin;
    this.root.classList.toggle('off', !onScreen);
    if (!onScreen) return;

    const halfW = Math.max(MIN_HALF, hull.halfWidth * scale * BRACKET_MARGIN);
    const halfH = Math.max(MIN_HALF, hull.halfHeight * scale * BRACKET_MARGIN);

    this.root.style.left = `${cx}px`;
    this.root.style.top = `${cy}px`;
    this.root.style.setProperty('--ar-w', `${halfW}px`);
    this.root.style.setProperty('--ar-h', `${halfH}px`);
    // What the arrow and the attitude arc stand off by: the corner of the frame, so
    // neither ever crosses the vehicle whatever shape the cargo is.
    this.root.style.setProperty('--ar-r', `${Math.hypot(halfW, halfH)}px`);

    // ------------------------------------------------------------ attitude
    const hasTilt = s.tilt !== null;
    this.tilt.classList.toggle('hidden', !hasTilt);
    if (s.tilt !== null) {
      this.tiltIndex.style.transform = `rotate(${(-s.tilt * 180) / Math.PI}deg)`;
      this.tilt.classList.toggle('danger', Math.abs(s.tilt) > LANDER.MAX_LANDING_TILT);
    }

    // -------------------------------------------------------------- vector
    const speed = Math.hypot(s.vx, s.vy);
    const moving = drifting(s.vx, s.vy);
    this.vector.classList.toggle('hidden', !moving);
    this.speed.classList.toggle('hidden', !moving || !s.ranging);
    if (!moving) return;

    const heading = driftAngle(s.vx, s.vy);
    this.vector.style.transform = `rotate(${heading}deg)`;
    this.vectorStem.style.width = `${vectorReach(speed, VELOCITY_SPAN, REACH_MIN, REACH_MAX)}px`;
    // The label rides the arrow, so it has to be turned back the other way or the digits
    // read sideways — and upside down on the half of the compass that matters most.
    this.speed.style.transform = `translate(-50%, -50%) rotate(${-heading}deg)`;

    // The overlay's own warning threshold is the landing tolerance, so the arrow turns
    // at the moment the approach stops being survivable rather than at a figure chosen
    // to look tense.
    // The arrow still reddens without a radar. Knowing you are coming in too hot is not
    // a ranging readout — it is the thing the vehicle's own gear screams about — and
    // withholding it would make mission one unfair rather than merely bare.
    const fast = speed > LANDER.MAX_LANDING_SPEED;
    this.vector.classList.toggle('danger', fast);
    this.speed.classList.toggle('danger', fast);
    if (s.ranging) this.speed.innerText = speed.toFixed(1);
  }
}
