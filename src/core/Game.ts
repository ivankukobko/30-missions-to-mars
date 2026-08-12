import * as THREE from 'three';
import { InputManager } from './InputManager.ts';
import { CameraDirector } from './CameraDirector.ts';
import { Inspector } from './Inspector.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { maxSafeSpeed } from '../physics/Kinematics.ts';
import { CanyonGenerator } from '../world/CanyonGenerator.ts';
import { Colony, type PadInfo } from '../world/Colony.ts';
import { CANYON, CORPS, PALETTE } from '../world/CanyonSpec.ts';
import { Lander, LANDER } from '../entities/Lander.ts';
import { Effects } from '../entities/Effects.ts';
import { Interface } from '../ui/Interface.ts';
import { Progress, scoreLanding } from '../campaign/Progress.ts';
import {
  getMission,
  worldAt,
  airframeFor,
  MISSION_COUNT,
  ENTRY_VELOCITY,
  type Mission,
} from '../campaign/Missions.ts';
import { AIRFRAMES } from '../entities/Airframe.ts';
import { clamp01, damp, lerp } from '../world/Noise.ts';
import { audio } from '../audio/AudioManager.ts';
import { VolumetricFog } from '../world/VolumetricFog.ts';

/** Mars-like but tuned for a readable descent rather than realism. */
const GRAVITY = -6.0;
/** Fixed physics rate. Decoupled from render rate, so 60Hz and 144Hz play identically. */
const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8;
/** Above this the lander has left the mission envelope. Must clear entry altitude. */
const CEILING_Y = CANYON.RIM_Y + 1500;

type State = 'BRIEF' | 'PLAYING' | 'PAUSED' | 'SETTLING' | 'RESULT' | 'FAILED' | 'VICTORY';

interface Blast {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  age: number;
}

export class Game {
  private container: HTMLElement;
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private director: CameraDirector;
  private input = new InputManager();
  private physics = new PhysicsWorld(GRAVITY);
  private canyon: CanyonGenerator;
  private colony: Colony;
  private ui: Interface;
  private progress = new Progress();

  private fog: THREE.FogExp2;
  private volumetricFog: VolumetricFog;
  private sun: THREE.DirectionalLight;
  /** Display resolution divisor — see applyResolution(). 1 renders at full size. */
  private renderScale = 1;

  private state: State = 'BRIEF';
  private mission!: Mission;
  private lander: Lander | null = null;
  private targetPad: PadInfo | null = null;
  private accumulator = 0;
  private lastFrame = performance.now();
  private settleTimer = 0;
  private pendingScore: ReturnType<typeof scoreLanding> | null = null;
  private blasts: Blast[] = [];
  private effects!: Effects;
  /** Previous frame's engine state, for detecting ignition. */
  private wasThrusting = false;
  private inspector: Inspector | null = null;
  /** True while the inspector owns the camera and the simulation is held. */
  private inspecting = false;
  /** Latest height of the lander over whatever is beneath it. Drives camera phase. */
  private heightAboveGround = Infinity;
  /**
   * Seconds of simulation since this mission loaded, accumulated one fixed step at a
   * time. This is the clock every moving structure is posed from.
   *
   * Emphatically not `performance.now()` and not accumulated frame deltas. The campaign
   * rests on a mission being reproducible — retry after a crash and you fly the same run
   * — and a crane whose phase came from wall-clock time would break that silently, in
   * the one direction a player cannot argue with: you would fail, retry, and find the
   * hazard somewhere else. Counting fixed steps makes a pose a pure function of how far
   * into the mission you are, at any frame rate, on any machine.
   */
  private missionTime = 0;

  constructor(container: HTMLElement, uiLayer: HTMLElement) {
    this.container = container;
    this.ui = new Interface(uiLayer);

    // Antialiasing is off deliberately. Measured on this scene, 4x MSAA costs about
    // half again the frame time — 1.76 ms to 2.64 ms at full resolution — because the
    // scene is fragment-bound rather than geometry-bound. It also fights the
    // nearest-neighbour upscale whenever renderScale is above 1, softening exactly
    // the pixel edges that look is built on.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    this.fog = new THREE.FogExp2(PALETTE.dust, 0.0016);
    this.scene.fog = this.fog;
    this.volumetricFog = new VolumetricFog(this.scene);

    // Must precede applyResolution — that sets the camera aspect via the director.
    this.director = new CameraDirector(window.innerWidth / window.innerHeight);

    const requested = Number(new URLSearchParams(window.location.search).get('scale'));
    if (Number.isFinite(requested) && requested >= 1) {
      this.renderScale = Math.min(6, Math.round(requested));
    }
    this.applyResolution();

    const initAudioOnUserGesture = () => {
      audio.init();
      window.removeEventListener('pointerdown', initAudioOnUserGesture);
      window.removeEventListener('keydown', initAudioOnUserGesture);
    };
    window.addEventListener('pointerdown', initAudioOnUserGesture);
    window.addEventListener('keydown', initAudioOnUserGesture);

    // Dim, cool fill. The canyon is meant to be a dark place lit by its tenants.
    this.scene.add(new THREE.AmbientLight(0xa8908a, 0.52));
    this.scene.add(new THREE.HemisphereLight(0xffcaa0, 0x2a1208, 0.7));

    // Sun on the horizon, far down the canyon and barely above it: ~9 degrees. It
    // rakes the rim and the upland and never reaches the floor, so below the rim the
    // only real light is the colony's.
    this.sun = new THREE.DirectionalLight(PALETTE.sun, 3.1);
    this.sun.position.set(-620, 150, -900);
    // No shadow map: with the sun on the horizon and the canyon shadow baked into
    // vertex colour, cast shadows were invisible and cost ~30% of the frame.
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.canyon = new CanyonGenerator(this.scene, this.physics, this.progress.seed);
    // The camera flies inside the canyon now, so it needs to know where the rock is.
    this.director.groundAt = (x, z) => this.canyon.heightAt(x, z);
    this.colony = new Colony(this.scene, this.physics);
    this.effects = new Effects(this.scene);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => this.onKey(e));

    // Mission first: the inspector reads the loaded mission to build its readout, so
    // constructing it earlier hands it an undefined mission.
    this.loadMission(Math.min(this.progress.highestUnlocked, MISSION_COUNT));
    this.setupDebug();

    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------- mission flow

  private loadMission(id: number): void {
    const mission = getMission(id);
    if (!mission) {
      this.state = 'VICTORY';
      this.ui.setHudVisible(false);
      this.ui.showVictory(() => {
        this.progress.newCanyon();
        window.location.reload();
      });
      return;
    }

    this.mission = mission;
    this.state = 'BRIEF';
    this.wasThrusting = false;
    this.heightAboveGround = Infinity;
    // Back to zero, so every attempt at a mission sees the colony in the same pose at
    // the same point in the descent.
    this.missionTime = 0;
    this.pendingScore = null;
    // Cleared for the same reason as the score. `resolveSettle` reads the failure
    // first, so a crash that was never consumed — a mission loaded from the inspector
    // or a reseed while the wreck was still settling — would surface on top of the
    // *next* mission's landing and report a success as the previous run's death.
    this.pendingFailure = null;
    this.clearBlasts();

    // The world is derived entirely from the mission index and the frozen radar
    // position, so a retry rebuilds an identical canyon and the colony ledger can
    // never drift out of sync.
    const world = worldAt(id, this.progress.mastX, this.progress.mastY);
    this.physics.clear();

    // Pads without an explicit height rest on the ground, so the terrain needs a
    // level bench under each before the colony asks it how high the ground is.
    const padSites = world.props.flatMap((p) =>
      p.kind === 'pad' && p.y === undefined ? [p.x] : [],
    );

    this.canyon.build(world.digs, padSites);
    this.colony.build(world.props, this.canyon);

    // A structure fast enough to cross the hull inside one substep can be passed clean
    // through, and the symptom is nothing happening — which looks exactly like nothing
    // being there. Reported rather than clamped: slowing a structure quietly would be a
    // level-design change made behind the author's back.
    const unsafe = this.colony.kinematics.unsafeAt(LANDER.RADIUS, FIXED_DT);
    if (unsafe.length > 0) {
      console.warn(
        `Mission ${id}: ${unsafe.length} moving structure(s) exceed ` +
          `${maxSafeSpeed(LANDER.RADIUS, FIXED_DT).toFixed(0)} u/s and may be flown through`,
      );
    }

    this.targetPad = mission.target
      ? (this.colony.pads.find((p) => p.id === mission.target) ?? null)
      : null;
    this.colony.setTarget(mission.target);
    if (mission.target && !this.targetPad) {
      console.warn(`Mission ${id} targets unknown pad "${mission.target}"`);
    }

    this.lander?.dispose();
    this.lander = new Lander(
      this.scene,
      mission.payload,
      mission.fuel,
      AIRFRAMES[airframeFor(mission)],
    );
    this.lander.invertThrusters = this.progress.invertThrusters;
    // One audio voice per nozzle, placed across the stereo field by where that nozzle
    // physically sits. The vehicle changes with the client, so this follows the load.
    audio.setEngineLayout(this.lander.airframe.engines.map((e) => e.x));
    // A mission with no address is one where bare rock is a legitimate place to stop.
    this.lander.allowGround = mission.target === null;
    this.lander.x = mission.start.x;
    this.lander.y = mission.start.y;
    this.lander.vx = mission.entry?.vx ?? ENTRY_VELOCITY.vx;
    this.lander.vy = mission.entry?.vy ?? ENTRY_VELOCITY.vy;
    this.lander.group.position.set(mission.start.x, mission.start.y, 0);

    this.director.snapTo(mission.start.x, mission.start.y);
    this.sun.target.position.set(mission.start.x, CANYON.FLOOR_Y, 0);

    this.ui.setHudVisible(false);
    // Ranging comes off the radar, and on mission 1 the radar is still in the hold.
    this.ui.setInstruments(id > 1);
    this.ui.setTiltInstrument(this.lander.airframe.scheme === 'attitude');
    this.ui.setMission(mission, this.targetPad);
    this.ui.showBrief(
      mission,
      this.progress.rankFor(id),
      {
        airframe: this.lander.airframe,
        fuel: this.lander.fuelCapacity,
        invertThrusters: this.progress.invertThrusters,
        // Applied to the loaded vehicle as well as saved, so flipping it in the brief
        // takes effect on the run you are about to fly rather than the one after.
        onInvert: (on) => {
          this.progress.setInvertThrusters(on);
          if (this.lander) this.lander.invertThrusters = on;
        },
      },
      () => this.begin(),
    );

    audio.setMissionContext(mission.client, mission.id);
    audio.startAmbient();

    // Readout follows whatever is actually loaded, including retries and next-mission
    // transitions the inspector did not initiate.
    this.inspector?.refresh();
  }

  private begin(): void {
    audio.init();
    audio.startAmbient();
    this.ui.hidePanel();
    this.ui.setHudVisible(true);
    this.state = 'PLAYING';
    this.accumulator = 0;
    this.lastFrame = performance.now();
  }

  private succeed(speed: number, offset: number): void {
    if (!this.lander) return;

    // `this.lander.y` here is the settled touchdown height — `resolveContact` has
    // already run — so this is ground truth, not a terrain estimate. See `Saved.mastY`.
    if (this.mission.target === null) {
      this.progress.setMastPosition(this.lander.x, this.lander.y);
    }

    const halfWidth = this.targetPad ? this.targetPad.width / 2 : null;
    this.pendingScore = scoreLanding(
      this.lander.fuel,
      this.lander.fuelCapacity,
      speed,
      offset,
      halfWidth,
    );
    audio.playSuccess(this.pendingScore.rank);
    audio.updateEngineSound([]);
    this.state = 'SETTLING';
    this.settleTimer = 1.15;
  }

  private fail(title: string, detail: string): void {
    if (this.state === 'FAILED') return;
    audio.updateEngineSound([]);
    this.state = 'FAILED';
    this.lander?.freeze();
    this.ui.setHudVisible(false);
    this.ui.showFailure(title, detail, () => this.loadMission(this.mission.id));
  }

  private crash(x: number, y: number, title: string, detail: string): void {
    audio.playExplosion();
    audio.updateEngineSound([]);
    this.spawnBlast(x, y);
    this.effects.burst(x, y);
    this.director.shake(2.4);
    if (this.lander) {
      this.lander.group.visible = false;
      this.lander.extinguish();
    }
    this.state = 'SETTLING';
    this.settleTimer = 1.3;
    this.pendingScore = null;
    this.lander?.freeze();
    this.pendingFailure = { title, detail };
  }

  private pendingFailure: { title: string; detail: string } | null = null;

  // -------------------------------------------------------------------- loop

  private frame(now: number): void {
    requestAnimationFrame(this.frame);

    const elapsed = Math.min((now - this.lastFrame) / 1000, 0.25);
    this.lastFrame = now;

    if (this.inspecting) {
      this.inspector?.update(elapsed);
    } else if (this.state === 'PLAYING') {
      this.stepSimulation(elapsed);
    } else if (this.state === 'SETTLING') {
      this.settleTimer -= elapsed;
      if (this.settleTimer <= 0) this.resolveSettle();
    }

    if (this.lander && this.state !== 'BRIEF' && !this.inspecting) {
      // Velocity is only reported while the simulation is advancing. Paused, the
      // lander holds position but keeps its last velocity, and the camera's lag
      // compensation would keep leading a target that is no longer moving —
      // sliding the framing off the vehicle the longer you stay paused.
      const moving = this.state === 'PLAYING';
      this.director.update(
        elapsed,
        this.lander.x,
        this.lander.y,
        moving ? this.lander.vx : 0,
        moving ? this.lander.vy : 0,
        this.heightAboveGround,
      );
    }
    this.colony.update(elapsed, this.director.camera);
    if (this.lander) {
      this.effects.update(elapsed, this.lander.x, this.lander.y, this.lander.vx, this.lander.vy);
    }
    this.updateAtmosphere(elapsed);
    this.updateBlasts(elapsed);
    this.director.applyShake(elapsed);

    this.renderer.render(this.scene, this.director.camera);
  }

  private stepSimulation(elapsed: number): void {
    const lander = this.lander;
    if (!lander) return;

    this.accumulator += elapsed;
    let steps = 0;
    const input = this.input.getState();

    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.accumulator -= FIXED_DT;
      steps++;

      // Moving structures are posed before the lander is integrated, and once per
      // substep rather than once per frame. Advanced per frame, a machine taking eight
      // substeps at once would hold a crane still for seven of them and then jump it
      // — the exact tunnelling the fixed timestep exists to prevent.
      this.missionTime += FIXED_DT;
      this.colony.kinematics.update(this.missionTime);

      const contact = lander.step(FIXED_DT, input, this.physics);

      if (contact.type === 'landed') {
        const wanted = this.mission.target;
        // No address means anywhere intact will do — the case mission 1 is built on.
        if (wanted === null || contact.padId === wanted) {
          this.succeed(contact.speed, contact.offset);
        } else {
          const corp = this.colony.pads.find((p) => p.id === contact.padId);
          const name = corp ? CORPS[corp.corp].name : 'ANOTHER OPERATOR';
          this.fail(
            'WRONG ADDRESS',
            `Clean landing — on the wrong pad. This deck belongs to ${name}. The manifest was routed to <b>${wanted.replace(/-/g, ' ').toUpperCase()}</b>.`,
          );
        }
        return;
      }

      if (contact.type === 'crashed') {
        this.describeCrash(contact.hit.segment.kind, lander);
        return;
      }

      if (lander.y < this.mission.failDepth && this.heightAboveGround > 40) {
        this.fail(
          'SIGNAL LOST',
          'You passed the last depth the relay can reach. Nothing comes back up from there.',
        );
        return;
      }

      if (lander.y > CEILING_Y) {
        this.fail(
          'ENVELOPE EXCEEDED',
          'You climbed out of the canyon and kept going. The mission is down there, not up here.',
        );
        return;
      }
    }

    // If the tab was throttled, drop the backlog rather than fast-forwarding through
    // terrain the player never saw.
    if (steps >= MAX_SUBSTEPS) this.accumulator = 0;

    this.updateProximity(elapsed, lander);
    this.updateHud(lander);
  }

  /**
   * Everything that depends on how close the ground is: the gear, and the dust the
   * exhaust throws off a surface. `groundBelow` is a bucketed lookup over the collider
   * set, so this is cheap enough to run every frame and needs no raycast.
   */
  private updateProximity(dt: number, lander: Lander): void {
    const ground = this.physics.groundBelow(lander.x, lander.y);
    const above = ground === null ? Infinity : lander.y - ground;
    this.heightAboveGround = above;
    lander.updateGear(dt, above);

    const thrusting = lander.thrusting;
    if (thrusting && !this.wasThrusting) this.effects.ignite(lander.x, lander.y);
    this.wasThrusting = thrusting;

    if (this.state === 'PLAYING') {
      // Per engine, in airframe order, so a twin running one nozzle sounds like a
      // twin running one nozzle. `rcsLeft` fires to rotate left, and the jet that does
      // that sits to starboard — hence the sign, which matches the visible plume.
      const jets = lander.firing;
      const side = jets.rcsLeft ? 1 : jets.rcsRight ? -1 : 0;
      audio.updateEngineSound(lander.firing.engines, side);
      audio.updateWind(this.heightAboveGround, Math.abs(lander.vx));
    }

    // The plume only reaches the surface from close range, and hits harder the
    // nearer you get — which makes the dust itself an altitude cue on final.
    if (thrusting && ground !== null && above < LANDER.GEAR_DEPLOY_HEIGHT) {
      const proximity = 1 - above / LANDER.GEAR_DEPLOY_HEIGHT;
      this.effects.groundDust(dt, lander.x, ground, proximity);
    }
  }

  private describeCrash(kind: string, lander: Lander): void {
    const speed = lander.speed;
    const tilt = Math.abs(lander.tilt);

    let title = 'LANDER DESTROYED';
    let detail = 'Contact with terrain at speed. There is no such thing as a gentle rock here.';

    if (kind === 'structure') {
      title = 'STRUCTURAL COLLISION';
      detail =
        'You hit colony hardware. Every beam in this canyon was flown down here by a pilot doing your job.';
    } else if (kind === 'pad' && tilt > LANDER.MAX_LANDING_TILT) {
      title = 'TIPPED ON TOUCHDOWN';
      detail = `You reached the pad at ${((tilt * 180) / Math.PI).toFixed(0)}° of tilt. The tolerance is ${((LANDER.MAX_LANDING_TILT * 180) / Math.PI).toFixed(0)}°.`;
    } else if (kind === 'pad') {
      title = 'HARD LANDING';
      detail = `Touchdown at ${speed.toFixed(1)} u/s. The gear takes ${LANDER.MAX_LANDING_SPEED.toFixed(1)} u/s and not a fraction more.`;
    } else if (speed > 8) {
      title = 'IMPACT';
      detail = `Ground contact at ${speed.toFixed(1)} u/s. Start braking higher.`;
    }

    this.crash(lander.x, lander.y, title, detail);
  }

  private resolveSettle(): void {
    if (this.pendingFailure) {
      const { title, detail } = this.pendingFailure;
      this.pendingFailure = null;
      this.state = 'PLAYING'; // allow fail() to take over cleanly
      this.fail(title, detail);
      return;
    }

    if (this.pendingScore) {
      const score = this.pendingScore;
      this.progress.complete(this.mission.id, score.rank);
      this.state = 'RESULT';
      this.ui.setHudVisible(false);
      this.ui.showResult(this.mission, score, () => this.loadMission(this.mission.id + 1));
    }
  }

  private updateHud(lander: Lander): void {
    const depthRange = CANYON.FLOOR_Y - this.mission.failDepth;
    const abyssProximity =
      depthRange > 0 ? clamp01((CANYON.FLOOR_Y - lander.y) / depthRange) : 0;

    this.ui.updateHud({
      fuel: lander.fuel,
      fuelCapacity: lander.fuelCapacity,
      altitude: lander.y - CANYON.FLOOR_Y,
      verticalSpeed: lander.vy,
      horizontalSpeed: Math.abs(lander.vx),
      tilt: lander.tilt,
      abyssProximity,
    });

    this.ui.updateMarker(this.director.camera, lander.x, lander.y);
  }

  /**
   * Fog thickens and darkens with depth. Above the rim the air is thin and dusty;
   * on the floor it is heavy; below the floor, in the excavations and the chasm, it
   * goes to near black — which is what makes the abyss read as a place you should
   * not be rather than just more canyon.
   *
   * The in-canyon figure is doing more work than atmosphere. The colony is echoed in
   * six rows packed within 140 units, and fog is the only thing that separates them:
   * at the old 0.0026 the nearest row came out 4% fogged and the farthest 25%, a
   * gradient too shallow to read, so the rows looked like flat cutouts at different
   * scales. At 0.0052 the same rows land at 16% and 73% and the block acquires depth.
   *
   * The cost is the long view down-canyon, which closes up to a few hundred units once
   * you are below the rim. That is the right trade: from the floor the walls hide the
   * distance anyway, and above the rim the density stays thin so the horizon survives.
   */
  private updateAtmosphere(dt: number): void {
    // While inspecting, key the fog off the camera. Otherwise flying down into the
    // colony shows it in the thin air of wherever the parked lander happens to be.
    const y = this.inspecting
      ? this.director.camera.position.y
      : (this.lander?.y ?? CANYON.FLOOR_Y);
    // Below the rim the air is in shadow; below the floor, in the shaft, it is black.
    const belowRim = clamp01((CANYON.RIM_Y - y) / CANYON.RIM_Y);
    const inShaft = clamp01((CANYON.FLOOR_Y - y) / 180);

    const targetDensity = lerp(lerp(0.0011, 0.0052, belowRim), 0.014, inShaft);
    this.fog.density = damp(this.fog.density, targetDensity, 2.2, dt);

    const dust = new THREE.Color(PALETTE.dust);
    dust.lerp(new THREE.Color(0x2e1409), belowRim * 0.82);
    dust.lerp(new THREE.Color(0x090503), inShaft * 0.92);
    this.fog.color.lerp(dust, 1 - Math.exp(-2.2 * dt));
    // Clear colour, fog and sky dome all read from the same value, so distant terrain
    // fades into a horizon that is the same colour it is fading towards.
    this.renderer.setClearColor(this.fog.color);
    this.canyon.tintSky(this.fog.color);
    this.volumetricFog.update(dt, this.fog.color);

    if (this.lander) {
      this.sun.position.set(this.lander.x - 620, 150, -900);
      this.sun.target.position.set(this.lander.x, CANYON.RIM_Y, 0);
      this.sun.target.updateMatrixWorld();
    }
  }

  // ----------------------------------------------------------------- effects

  private spawnBlast(x: number, y: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 1 }),
    );
    mesh.position.set(x, y, 0);
    this.scene.add(mesh);

    const light = new THREE.PointLight(0xffa860, 140, 90, 2);
    light.position.set(x, y, 4);
    this.scene.add(light);

    this.blasts.push({ mesh, light, age: 0 });
  }

  private updateBlasts(dt: number): void {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const blast = this.blasts[i];
      blast.age += dt;
      const t = blast.age / 1.1;
      if (t >= 1) {
        this.removeBlast(i);
        continue;
      }
      const scale = 1 + t * 13;
      blast.mesh.scale.setScalar(scale);
      (blast.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) ** 1.6;
      blast.light.intensity = 140 * (1 - t) ** 2;
    }
  }

  private removeBlast(index: number): void {
    const blast = this.blasts[index];
    this.scene.remove(blast.mesh);
    this.scene.remove(blast.light);
    blast.mesh.geometry.dispose();
    (blast.mesh.material as THREE.Material).dispose();
    this.blasts.splice(index, 1);
  }

  private clearBlasts(): void {
    for (let i = this.blasts.length - 1; i >= 0; i--) this.removeBlast(i);
  }

  // ------------------------------------------------------------------ chrome

  private onResize(): void {
    this.applyResolution();
  }

  /**
   * Renders at 1/N of the display resolution and lets CSS scale the canvas back up
   * with nearest-neighbour filtering — chunky pixels rather than a blurry upscale.
   *
   * The divisor is an integer and the buffer is floored, so every source pixel maps
   * to the same number of screen pixels. A fractional scale leaves some pixels two
   * screen-pixels wide and others three, and the grid crawls as the camera moves.
   *
   * This is also the single largest performance lever in the renderer: the scene is
   * fragment-bound, so cost falls with the square of the divisor — N=3 is a ninth of
   * the pixels. `setSize`'s third argument is false so the canvas keeps its CSS size.
   */
  private applyResolution(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const n = this.renderScale;

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.max(1, Math.floor(w / n)), Math.max(1, Math.floor(h / n)), false);
    this.director.resize(w, h);

    const style = this.renderer.domElement.style;
    style.imageRendering = n > 1 ? 'pixelated' : 'auto';
    style.width = '100%';
    style.height = '100%';
  }

  /** Display resolution divisor. 1 = native, 3 = chunky. */
  setRenderScale(n: number): void {
    this.renderScale = Math.max(1, Math.round(n));
    this.applyResolution();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code !== 'KeyP' && e.code !== 'Escape') return;
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.lastFrame = performance.now();
      this.accumulator = 0;
    }
  }

  /**
   * Rebuilds the world on a different seed without touching campaign progress.
   *
   * The canyon generator holds its noise fields, so a new seed means a new generator —
   * the old one is disposed and the director's ground probe repointed at the
   * replacement, or it would keep sampling terrain that is no longer in the scene.
   */
  private useSeed(seed: number): void {
    this.progress.useSeed(seed);
    this.canyon.dispose();
    this.canyon = new CanyonGenerator(this.scene, this.physics, seed);
    this.director.groundAt = (x, z) => this.canyon.heightAt(x, z);
    this.loadMission(this.mission.id);
  }

  /** Map editor, generator readout and detached camera. ?debug=1 */
  private setupDebug(): void {
    if (!new URLSearchParams(window.location.search).has('debug')) return;

    this.inspector = new Inspector({
      camera: this.director.camera,
      groundAt: (x, z) => this.canyon.heightAt(x, z),
      pads: () => this.colony.pads,
      targetPad: () => this.targetPad,
      missionId: () => this.mission?.id ?? 1,
      seed: () => this.progress.seed,
      mastX: () => this.progress.mastX,
      mastY: () => this.progress.mastY,
      loadMission: (id) => this.loadMission(id),
      useSeed: (seed) => this.useSeed(seed),
      setInspecting: (on) => {
        this.inspecting = on;
        // Held rather than paused: PAUSED is a player-facing state with its own overlay,
        // and the inspector wants the world standing still without that.
        if (!on) {
          this.lastFrame = performance.now();
          this.accumulator = 0;
        }
      },
    });

    // Handle for poking at a running mission from the console.
    (window as unknown as Record<string, unknown>).__mtm = {
      game: this,
      lander: () => this.lander,
      /** Drop the lander at a position with zero velocity. */
      place: (x: number, y: number) => {
        if (!this.lander) return;
        this.lander.x = x;
        this.lander.y = y;
        this.lander.vx = 0;
        this.lander.vy = 0;
        this.lander.rotation = 0;
        this.lander.angularVelocity = 0;
        this.lander.group.position.set(x, y, 0);
        this.director.snapTo(x, y);
      },
      /** Change the pixelation divisor live: 1 native, 2-4 chunky. */
      scale: (n: number) => this.setRenderScale(n),
      /** Position over the current delivery target. */
      overTarget: (height = 40) => {
        if (!this.targetPad || !this.lander) return;
        (window as unknown as { __mtm: { place: (x: number, y: number) => void } }).__mtm.place(
          this.targetPad.x,
          this.targetPad.y + height,
        );
      },
    };
  }
}
