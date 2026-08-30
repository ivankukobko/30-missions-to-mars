import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Lander } from './entities/Lander.ts';
import { AIRFRAMES, type AirframeId } from './entities/Airframe.ts';
import { buildColonyCells } from './world/ColonyRender.ts';
import { LINK, type PlacedCell } from './world/ColonyOrganism.ts';
import { COLONY_CELL_SIZE, COLONY_LAYER_SPACING, COLONY_LAYER_GAP } from './world/ColonyLattice.ts';

/**
 * A standalone look at one in-game object at a time — a vehicle or a colony cell run —
 * outside the mission/physics/campaign machinery a full game load drags in. Everything
 * it draws is built from the game's own exported classes and functions (`Lander`,
 * `buildColonyCells`), never a re-description of their geometry, so nothing shown here
 * can drift from what actually ships: this is a different *camera*, not a different
 * model.
 */

const app = document.getElementById('app');
const controlsEl = document.getElementById('controls');
if (!app || !controlsEl) throw new Error('Missing #app or #controls.');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x241209);
scene.fog = new THREE.FogExp2(0x241209, 0.015);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(2.2, 1.4, 3.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.3, 0);
orbit.enableDamping = true;

// Lighting roughly matched to the game's own tone (`Game.ts`'s sun/fill/sky), not copied
// exactly — this view has no mission and no sol to derive it from, so a fixed, readable
// three-point rig is the honest choice rather than faking a specific mission's light.
const sun = new THREE.DirectionalLight(0xffcf9a, 2.4);
sun.position.set(-3, 5, 2.5);
sun.castShadow = true;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xa8908a, 0.65));
scene.add(new THREE.HemisphereLight(0xffcaa0, 0x2a1208, 0.8));

const grid = new THREE.GridHelper(20, 20, 0x6b4a33, 0x3a2416);
scene.add(grid);

let current: THREE.Object3D[] = [];
function clear(): void {
  for (const obj of current) scene.remove(obj);
  current = [];
}

/** Re-poses the camera at a fixed elevation/bearing around `target`, `distance` away —
 *  needed because a vehicle (~1-2 units) and a colony run (up to 48, four cells of 12)
 *  are two wildly different scales, and a camera distance tuned for one clips inside or
 *  vanishes into the fog of the other. */
function frameCamera(target: THREE.Vector3, distance: number): void {
  orbit.target.copy(target);
  camera.position.set(target.x + distance * 0.6, target.y + distance * 0.4, target.z + distance * 0.85);
  camera.near = Math.max(0.02, distance / 200);
  camera.far = Math.max(200, distance * 20);
  camera.updateProjectionMatrix();
}

function showAirframe(id: AirframeId, relayFolded: boolean): void {
  clear();
  // The relay builds its own upper body regardless of payload (`buildRelayTower`) — see
  // `Lander.ts`. Every other airframe gets a plain mid-size placeholder. `relayFolded`
  // only matters for the relay — nothing else reads it — and defaults `true` in
  // `Lander`'s own constructor, matching what the live game always builds; this is the
  // one place `false` is ever passed, since nothing in play can reach that state yet.
  const lander = new Lander(scene, { name: 'PREVIEW', mass: 0.6 }, 300, AIRFRAMES[id], relayFolded);
  current = [lander.group];
  frameCamera(new THREE.Vector3(0, 0, 0), 3.5);
}

const REACH_OF: Record<'tank' | 'room' | 'mast', number> = { tank: 0, room: 1, mast: 2 };

function showColonyRun(massClass: 'tank' | 'room' | 'mast', span: number, vertical: boolean): void {
  clear();
  const reach = REACH_OF[massClass];
  const cells: PlacedCell[] = [];
  for (let i = 0; i < span; i++) {
    const ahead = i < span - 1 ? (vertical ? LINK.up : LINK.east) : 0;
    const behind = i > 0 ? (vertical ? LINK.down : LINK.west) : 0;
    const at = i * COLONY_CELL_SIZE;
    cells.push({
      x: vertical ? 0 : at,
      y: vertical ? at : 0,
      z: 0,
      links: ahead | behind,
      scaffold: false,
      traits: 0,
      reach,
    });
  }
  const depth = COLONY_LAYER_SPACING - COLONY_LAYER_GAP;
  current = buildColonyCells(scene, 'outpost', cells, COLONY_CELL_SIZE, 0, depth);
  const mid = cells[Math.floor(span / 2)];
  frameCamera(new THREE.Vector3(mid.x, mid.y, mid.z), Math.max(20, span * COLONY_CELL_SIZE * 1.15));
}

function showBareCell(): void {
  clear();
  const cells: PlacedCell[] = [
    { x: 0, y: 0, z: 0, links: 0, scaffold: true, traits: 0, reach: 0 },
  ];
  const depth = COLONY_LAYER_SPACING - COLONY_LAYER_GAP;
  current = buildColonyCells(scene, 'outpost', cells, COLONY_CELL_SIZE, 0, depth);
  frameCamera(new THREE.Vector3(0, 0, 0), 20);
}

// ------------------------------------------------------------------------- controls

type Mode = 'airframe' | 'colony' | 'bare';

function build(): void {
  const params = new URLSearchParams(location.search);
  const mode = (params.get('mode') as Mode) ?? 'airframe';
  if (mode === 'airframe') {
    const id = (params.get('airframe') as AirframeId) ?? 'relay';
    const relayFolded = params.get('folded') !== 'false';
    showAirframe(id, relayFolded);
  } else if (mode === 'colony') {
    const massClass = (params.get('class') as 'tank' | 'room' | 'mast') ?? 'room';
    const span = Number(params.get('span') ?? '1');
    const axis = params.get('axis') === 'x' ? 'x' : 'y';
    showColonyRun(massClass, Math.max(1, Math.min(4, span)), axis === 'y');
  } else {
    showBareCell();
  }
}

function setParam(key: string, value: string): void {
  const params = new URLSearchParams(location.search);
  params.set(key, value);
  history.replaceState(null, '', `?${params.toString()}`);
  build();
}

const params = new URLSearchParams(location.search);
const mode = (params.get('mode') as Mode) ?? 'airframe';

controlsEl.innerHTML = `
  <label>MODE
    <select id="mode">
      <option value="airframe">airframe</option>
      <option value="colony">colony run</option>
      <option value="bare">bare cell</option>
    </select>
  </label>
  <label id="row-airframe">AIRFRAME
    <select id="airframe">
      <option value="relay">relay</option>
      <option value="lander">lander</option>
      <option value="hauler">hauler</option>
      <option value="helion">helion</option>
    </select>
  </label>
  <label id="row-folded">RELAY ANTENNA
    <select id="folded">
      <option value="true">folded</option>
      <option value="false">unfolded</option>
    </select>
  </label>
  <label id="row-class">CLASS
    <select id="class">
      <option value="tank">tank</option>
      <option value="room">room</option>
      <option value="mast">mast</option>
    </select>
  </label>
  <label id="row-axis">AXIS
    <select id="axis">
      <option value="y">vertical</option>
      <option value="x">horizontal</option>
    </select>
  </label>
  <label id="row-span">SPAN
    <input id="span" type="number" min="1" max="4" value="1" style="width: 40px" />
  </label>
  <div>drag to orbit · wheel to zoom</div>
`;

const modeSel = controlsEl.querySelector<HTMLSelectElement>('#mode')!;
const airframeSel = controlsEl.querySelector<HTMLSelectElement>('#airframe')!;
const foldedSel = controlsEl.querySelector<HTMLSelectElement>('#folded')!;
const classSel = controlsEl.querySelector<HTMLSelectElement>('#class')!;
const axisSel = controlsEl.querySelector<HTMLSelectElement>('#axis')!;
const spanInput = controlsEl.querySelector<HTMLInputElement>('#span')!;

modeSel.value = mode;
airframeSel.value = params.get('airframe') ?? 'relay';
foldedSel.value = params.get('folded') ?? 'true';
classSel.value = params.get('class') ?? 'room';
axisSel.value = params.get('axis') ?? 'y';
spanInput.value = params.get('span') ?? '1';

function syncRowVisibility(): void {
  const m = modeSel.value;
  controlsEl!.querySelector<HTMLElement>('#row-airframe')!.style.display = m === 'airframe' ? 'flex' : 'none';
  // Folded/unfolded only means anything for the relay — showing it for every airframe
  // would be a control that does nothing three times out of four.
  controlsEl!.querySelector<HTMLElement>('#row-folded')!.style.display =
    m === 'airframe' && airframeSel.value === 'relay' ? 'flex' : 'none';
  const colonyRows = ['#row-class', '#row-axis', '#row-span'];
  for (const sel of colonyRows) {
    controlsEl!.querySelector<HTMLElement>(sel)!.style.display = m === 'colony' ? 'flex' : 'none';
  }
}
syncRowVisibility();

modeSel.addEventListener('change', () => {
  syncRowVisibility();
  setParam('mode', modeSel.value);
});
airframeSel.addEventListener('change', () => {
  syncRowVisibility();
  setParam('airframe', airframeSel.value);
});
foldedSel.addEventListener('change', () => setParam('folded', foldedSel.value));
classSel.addEventListener('change', () => setParam('class', classSel.value));
axisSel.addEventListener('change', () => setParam('axis', axisSel.value));
spanInput.addEventListener('change', () => setParam('span', spanInput.value));

build();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function frame(): void {
  requestAnimationFrame(frame);
  orbit.update();
  renderer.render(scene, camera);
}
frame();

// For scripted inspection from outside the page (screenshots, measurements) — the same
// escape hatch `?debug=1` gives the real game via `window.__mtm`.
(window as unknown as { __preview: unknown }).__preview = { scene, camera, renderer, orbit, showAirframe, showColonyRun, showBareCell };
