import * as THREE from 'three';
import { CANYON } from '../world/CanyonSpec.ts';
import type { PadInfo } from '../world/Colony.ts';
import type { CanyonGenerator } from '../world/CanyonGenerator.ts';
import { MISSION_COUNT } from '../campaign/Missions.ts';
import { checkLayout } from '../campaign/Layout.ts';
import { planColonies, missionWorlds } from '../campaign/ColonyPlan.ts';
/**
 * What the inspector needs from the game. Declared as an interface rather than
 * importing Game, because Game constructs the inspector — the dependency has to run
 * one way only.
 */
export interface InspectorHost {
  camera: THREE.PerspectiveCamera;
  /** Terrain height, for placing the focus point on the ground. */
  groundAt(x: number, z: number): number;
  pads(): PadInfo[];
  targetPad(): PadInfo | null;
  missionId(): number;
  seed(): number;
  /** Best landing points per mission so far — colonies grow larger the better a corp's
   *  missions have gone, and the debug readout should reflect the same world a real run
   *  does. Points rather than ranks, because that is what the budget is paid in. */
  scores(): Readonly<Record<string, number>>;
  /** Where the player planted the navigation radar, or null before mission 1 is flown. */
  mastX(): number | null;
  /** Its exact height. Paired with `mastX`; see `Progress.mastY`. */
  mastY(): number | null;
  /** The live canyon — colonies and dig resolution both need real terrain now, and the
   *  currently-loaded canyon already matches this mission's own digs. */
  terrain(): CanyonGenerator;
  loadMission(id: number): void;
  /** Rebuilds the world on a different seed, keeping the current mission. */
  useSeed(seed: number): void;
  /** Whether the growth gizmos are currently drawn — see `ColonyRender.buildColonyGizmos`. */
  gizmos(): boolean;
  /** Turns them on or off. Rebuilds the world, since they are built with it. */
  setGizmos(on: boolean): void;
  /** True while the inspector owns the camera and the simulation is held. */
  setInspecting(on: boolean): void;
}

interface View {
  label: string;
  /** Focus point, orbit angles and range. `focus` may be resolved at click time. */
  make(host: InspectorHost): { focus: THREE.Vector3; yaw: number; pitch: number; dist: number };
}

/**
 * Preset vantages. These are the questions you actually want to ask of a generator —
 * what does the canyon look like end to end, is the colony sitting on the ground, does
 * the far wall meet the upland — and each one is fiddly to reach by hand.
 */
const VIEWS: View[] = [
  {
    label: 'Colony',
    make: () => ({ focus: new THREE.Vector3(0, 30, -20), yaw: 0, pitch: -0.32, dist: 250 }),
  },
  {
    label: 'Down canyon',
    make: () => ({ focus: new THREE.Vector3(0, 60, -700), yaw: 0, pitch: -0.12, dist: 620 }),
  },
  {
    label: 'Cross-section',
    make: () => ({ focus: new THREE.Vector3(0, 110, 0), yaw: -Math.PI / 2, pitch: -0.1, dist: 430 }),
  },
  {
    label: 'Rim',
    make: () => ({ focus: new THREE.Vector3(0, CANYON.RIM_Y, -120), yaw: 0.5, pitch: -0.28, dist: 330 }),
  },
  {
    label: 'From above',
    make: () => ({ focus: new THREE.Vector3(0, 0, -260), yaw: 0, pitch: -1.35, dist: 700 }),
  },
  {
    label: 'Target pad',
    make: (host) => {
      const pad = host.targetPad();
      return {
        focus: new THREE.Vector3(pad?.x ?? 0, pad?.y ?? 0, 0),
        yaw: 0.35,
        pitch: -0.3,
        dist: 55,
      };
    },
  },
];

const PAN_SPEED = 60;
const BOOST = 4;

/**
 * Map editor and generator inspector, behind ?debug=1.
 *
 * The generators are the hard part of this game to reason about: the canyon comes out
 * of layered noise, the colony out of a thirty-mission ledger run through a layout
 * resolver, and until now the only way to see either was to fly a lander at it and
 * hope the camera pointed somewhere useful. This detaches the camera, holds the
 * simulation, and lets you drive a seed and a mission number directly.
 */
export class Inspector {
  private host: InspectorHost;
  private panel: HTMLElement;
  private stats: HTMLElement;

  private active = false;
  private focus = new THREE.Vector3(0, 30, -20);
  private yaw = 0;
  private pitch = -0.32;
  private dist = 250;

  private held = new Set<string>();
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(host: InspectorHost) {
    this.host = host;
    this.panel = document.createElement('div');
    this.panel.className = 'debug-panel';
    this.panel.innerHTML = this.markup();
    document.body.appendChild(this.panel);
    this.stats = this.panel.querySelector('#dbg-stats')!;

    this.wireControls();
    this.wireCamera();
    this.refresh();
  }

  private markup(): string {
    return `
      <div class="debug-row">
        <span class="debug-title">MAP</span>
        <label>mission <input id="dbg-mission" type="number" min="1" max="${MISSION_COUNT}" value="1" /></label>
        <button id="dbg-prev" title="previous mission">&lt;</button>
        <button id="dbg-next" title="next mission">&gt;</button>
        <label>seed <input id="dbg-seed" type="number" /></label>
        <button id="dbg-apply">Apply</button>
        <button id="dbg-random" title="random seed">Roll</button>
        <span class="debug-sep"></span>
        <button id="dbg-free" class="debug-toggle">Free camera: off</button>
        <button id="dbg-gizmos" class="debug-toggle">Gizmos: off</button>
        <select id="dbg-view" title="preset vantage">
          ${VIEWS.map((v, i) => `<option value="${i}">${v.label}</option>`).join('')}
        </select>
        <button id="dbg-jump">Jump</button>
      </div>
      <div class="debug-row debug-foot">
        <div id="dbg-stats" class="debug-stats"></div>
        <div class="debug-help">
          drag orbit &middot; wheel zoom &middot; WASD pan &middot; QE height &middot; shift fast &middot; F2 toggle
        </div>
      </div>
    `;
  }

  private input(id: string): HTMLInputElement {
    return this.panel.querySelector(`#${id}`) as HTMLInputElement;
  }

  private wireControls(): void {
    const missionField = this.input('dbg-mission');
    const seedField = this.input('dbg-seed');
    missionField.value = String(this.host.missionId());
    seedField.value = String(this.host.seed());

    const go = (id: number) => {
      const clamped = Math.max(1, Math.min(MISSION_COUNT, id));
      missionField.value = String(clamped);
      this.host.loadMission(clamped);
      this.refresh();
    };

    this.panel.querySelector('#dbg-prev')!.addEventListener('click', () =>
      go(this.host.missionId() - 1),
    );
    this.panel.querySelector('#dbg-next')!.addEventListener('click', () =>
      go(this.host.missionId() + 1),
    );
    missionField.addEventListener('change', () => go(parseInt(missionField.value, 10) || 1));

    const applySeed = (seed: number) => {
      seedField.value = String(seed);
      this.host.useSeed(seed);
      this.refresh();
    };
    this.panel.querySelector('#dbg-apply')!.addEventListener('click', () => {
      const v = parseInt(seedField.value, 10);
      if (Number.isFinite(v)) applySeed(v);
    });
    this.panel.querySelector('#dbg-random')!.addEventListener('click', () =>
      applySeed((Math.random() * 0x7fffffff) | 0),
    );

    this.panel.querySelector('#dbg-free')!.addEventListener('click', () => this.toggle());

    // Reloads the mission, so the mission field can go stale if the host clamps the id —
    // it does not, but `refresh` is cheap and keeps the panel honest either way.
    this.panel.querySelector('#dbg-gizmos')!.addEventListener('click', () => {
      this.host.setGizmos(!this.host.gizmos());
      this.showGizmoState();
      this.refresh();
    });
    this.showGizmoState();

    // Picking a vantage does not move the camera; Jump does. Six buttons cost a row of
    // width apiece, and the list only grows.
    const viewField = this.panel.querySelector('#dbg-view') as HTMLSelectElement;
    this.panel.querySelector('#dbg-jump')!.addEventListener('click', () => {
      const view = VIEWS[Number(viewField.value)]?.make(this.host);
      if (!view) return;
      this.focus.copy(view.focus);
      this.yaw = view.yaw;
      this.pitch = view.pitch;
      this.dist = view.dist;
      if (!this.active) this.toggle();
      this.place();
    });
  }

  private wireCamera(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F2') {
        this.toggle();
        e.preventDefault();
        return;
      }
      if (!this.active) return;
      // Swallowed so panning does not also fly the lander.
      if (/^Key[WASDQE]$/.test(e.code) || e.code === 'ShiftLeft') {
        this.held.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    const canvas = () => document.querySelector('canvas');
    window.addEventListener('pointerdown', (e) => {
      if (!this.active || e.target !== canvas()) return;
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lastPointer.x) * 0.005;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - (e.clientY - this.lastPointer.y) * 0.005,
        -1.5,
        1.5,
      );
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.place();
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || e.target !== canvas()) return;
        this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.001), 4, 2600);
        this.place();
        e.preventDefault();
      },
      { passive: false },
    );
  }

  private toggle(): void {
    this.active = !this.active;
    this.held.clear();
    const button = this.panel.querySelector('#dbg-free')!;
    button.textContent = `Free camera: ${this.active ? 'ON' : 'off'}`;
    button.classList.toggle('on', this.active);
    this.host.setInspecting(this.active);
    if (this.active) this.place();
  }

  /** The gizmo button reads its state from the host rather than from a field here, so
   *  `?gizmos` in the URL shows as ON without the panel having to know about the flag. */
  private showGizmoState(): void {
    const on = this.host.gizmos();
    const button = this.panel.querySelector('#dbg-gizmos')!;
    button.textContent = `Gizmos: ${on ? 'ON' : 'off'}`;
    button.classList.toggle('on', on);
  }

  /** Orbit position from the current focus, angles and range. */
  private place(): void {
    const cam = this.host.camera;
    const cp = Math.cos(this.pitch);
    cam.position.set(
      this.focus.x + Math.sin(this.yaw) * cp * this.dist,
      this.focus.y - Math.sin(this.pitch) * this.dist,
      this.focus.z + Math.cos(this.yaw) * cp * this.dist,
    );
    cam.lookAt(this.focus);
    if (Math.abs(cam.fov - 55) > 0.01) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
  }

  /** Called every frame. Only does anything while the inspector holds the camera. */
  update(dt: number): void {
    if (!this.active) return;
    const speed = PAN_SPEED * dt * (this.held.has('ShiftLeft') ? BOOST : 1) * (this.dist / 200 + 0.4);
    // Pan in the camera's own horizontal frame, so W always goes into the screen.
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let moved = false;
    const step = (dx: number, dz: number, dy: number) => {
      this.focus.x += dx;
      this.focus.z += dz;
      this.focus.y += dy;
      moved = true;
    };
    if (this.held.has('KeyW')) step(-fx * speed, -fz * speed, 0);
    if (this.held.has('KeyS')) step(fx * speed, fz * speed, 0);
    if (this.held.has('KeyA')) step(-fz * speed, fx * speed, 0);
    if (this.held.has('KeyD')) step(fz * speed, -fx * speed, 0);
    if (this.held.has('KeyQ')) step(0, 0, -speed);
    if (this.held.has('KeyE')) step(0, 0, speed);
    if (moved) this.place();
  }

  get inspecting(): boolean {
    return this.active;
  }

  /** Height the fog should key off while inspecting: the camera, not the lander. */
  get cameraHeight(): number {
    return this.host.camera.position.y;
  }

  /**
   * Generator readout for the current mission. The layout check is the same one the
   * campaign runs, so this panel reports exactly what the game enforces rather than a
   * second opinion that could drift from it.
   */
  refresh(): void {
    const id = this.host.missionId();
    this.input('dbg-mission').value = String(id);
    this.input('dbg-seed').value = String(this.host.seed());

    // Same arguments the game builds with. Called without `mastY` this quietly falls
    // back to the pre-fix terrain estimate, and a readout whose whole claim is that it
    // reports what the campaign enforces cannot be building a different radar than the
    // campaign actually placed.
    //
    // `worldAt` only gives the authored ledger now — colonies and any terrain-anchored
    // dig are resolved here too, the same way `Game.loadMission` does it, off the live
    // canyon (`this.host.terrain()`), or this readout would silently stop showing
    // colonies and stop catching colony-layout violations. See `Game.loadMission`.
    const terrain = this.host.terrain();
    const worlds = missionWorlds(this.host.mastX(), this.host.mastY(), terrain);
    const current = worlds(id);
    // The same growth pass `Game.loadMission` runs, off the same live canyon — a
    // readout whose whole claim is that it reports what the campaign enforces cannot be
    // growing a different colony than the campaign actually built.
    const plan = planColonies(id, worlds, this.host.scores(), this.host.seed(), terrain);
    const allProps = [...current.props, ...plan.colonies];

    const counts = new Map<string, number>();
    for (const p of allProps) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    const issues = checkLayout(allProps, current.digs, undefined, terrain, plan.network.channels);

    const pads = this.host.pads();
    const target = this.host.targetPad();
    const floor = this.host.groundAt(0, 0);

    // Seed and mission are omitted: both are sitting in their own fields a row above,
    // and a readout that repeats its own inputs is just noise to scan past.
    this.stats.innerHTML = `
      <span>floor@0 <b>${floor.toFixed(1)}</b></span>
      <span>${[...counts].map(([k, n]) => `${k} <b>${n}</b>`).join(' &middot; ')}</span>
      <span>digs <b>${current.digs.length}</b></span>
      <span>pads <b>${pads.length}</b></span>
      <span>target <b>${target ? `${target.id} (${target.x}, ${target.y.toFixed(1)})` : 'none'}</b></span>
      <span class="${issues.length ? 'bad' : 'good'}">layout ${
        issues.length ? `${issues.length} issue(s)` : 'clean'
      }</span>
      ${issues.map((v) => `<span class="bad">${v.rule}: ${v.prop} &rarr; ${v.pad}</span>`).join('')}
    `;
  }
}
