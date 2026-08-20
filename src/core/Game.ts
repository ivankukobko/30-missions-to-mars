import * as THREE from 'three';
import { InputManager, type InputState } from './InputManager.ts';
import { CameraDirector } from './CameraDirector.ts';
import { Inspector } from './Inspector.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { maxSafeSpeed } from '../physics/Kinematics.ts';
import { CanyonGenerator } from '../world/CanyonGenerator.ts';
import { Colony, type PadInfo } from '../world/Colony.ts';
import { forgetFadedMaterials } from '../world/LanderFade.ts';
import { CANYON, CORPS, PALETTE } from '../world/CanyonSpec.ts';
import { Lander, LANDER } from '../entities/Lander.ts';
import { Effects } from '../entities/Effects.ts';
import { Interface, type GameSettings } from '../ui/Interface.ts';
import type { HudCommon, HudData } from '../ui/HudData.ts';
import { Progress, scoreLanding } from '../campaign/Progress.ts';
import {
  getMission,
  airframeFor,
  musicTrackFor,
  MISSION_COUNT,
  ENTRY_VELOCITY,
  type Mission,
} from '../campaign/Missions.ts';
import { AIRFRAMES } from '../entities/Airframe.ts';
import { clamp01, damp, lerp } from '../world/Noise.ts';
import { audio } from '../audio/AudioManager.ts';
import { VolumetricFog } from '../world/VolumetricFog.ts';
import { checkLayout } from '../campaign/Layout.ts';
import { planColonies, missionWorlds, campaignPadSites } from '../campaign/ColonyPlan.ts';

/** Mars-like but tuned for a readable descent rather than realism. */
const GRAVITY = -6.0;
/** Fixed physics rate. Decoupled from render rate, so 60Hz and 144Hz play identically. */
const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8;
/** Above this the lander has left the mission envelope. Must clear entry altitude. */
const CEILING_Y = CANYON.RIM_Y + 1500;

type State =
  | 'MENU'
  | 'UPLINK'
  | 'BRIEF'
  | 'PLAYING'
  | 'PAUSED'
  | 'SETTLING'
  | 'RESULT'
  | 'FAILED'
  | 'VICTORY';

/**
 * How long you watch before the vehicle is yours.
 *
 * Three seconds is short enough that a retry does not grind — this is a landing game and
 * missions get re-flown a great deal — and long enough to read as a handshake rather than
 * a stutter. Nothing of the vehicle's is drawn for the whole of it: no console, no
 * augmented layer, only the status line. You are not connected to the airframe yet, so
 * none of the airframe's instruments have any business being on screen.
 *
 * Costs no altitude budget in practice. Missions enter at y≈1250 doing 55 u/s and the
 * thrust is sized to shed roughly 88 before touchdown; three seconds of free fall is
 * about 190 units and leaves the vehicle at 73. That is what already happened, because
 * burning at twelve hundred units up only buys a longer fight with gravity — the uplink
 * takes away a thing nobody was doing.
 */
const UPLINK_SECONDS = 3;

/** Controls during the uplink: none of them. */
const IDLE_INPUT: InputState = { left: false, right: false, main: false };

/**
 * Aerodynamic buffet — the vehicle coming in through the top of the atmosphere.
 *
 * Driven by speed rather than scripted to the entry sequence, which costs nothing and is
 * more honest: it eases off by itself as the descent is braked, and it comes back if a
 * player builds the speed up again lower down. In practice nothing in the canyon sustains
 * this kind of speed anyway — the entry is the only part of a mission that does.
 *
 * The floor is 60 because that is where the streaks start reading as entry heating rather
 * than as sparse debris. Below it they are too short and too far apart to join up into
 * one trail, and a threshold is a cleaner answer than trying to make three stubby lines
 * look good. The shake shares the number so the two arrive together.
 *
 * A mission enters at 55 and gravity carries it to about 73 across the three-second
 * handshake, so the trail is not there at the first frame — it comes in around a second
 * down and builds. That is the right shape for compression heating, which is a thing that
 * arrives as you descend rather than a thing you begin with.
 *
 * Deliberately far below the 2.4 an impact uses. That one is a hit; this is a texture,
 * and it is applied every frame rather than once, so it sustains instead of decaying.
 */
const BUFFET_FROM = 60;
// Entry tops out near 73 across the handshake, so the ramp is sized to reach most of its
// range inside the speeds a mission actually reaches rather than saturating off-screen.
const BUFFET_FULL = 78;
const BUFFET_MAX = 0.2;

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

    // Before any mission loads, so a save that muted the music does not get one bar
    // of it on startup while the preference is still being read.
    audio.applyPreferences(this.progress.audioPrefs);

    this.canyon = new CanyonGenerator(this.scene, this.physics, this.progress.seed);
    // The camera flies inside the canyon now, so it needs to know where the rock is.
    this.director.groundAt = (x, z) => this.canyon.heightAt(x, z);
    this.colony = new Colony(this.scene, this.physics);
    this.effects = new Effects(this.scene);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => this.onKey(e));

    // Mission first: the inspector reads the loaded mission to build its readout, so
    // constructing it earlier hands it an undefined mission. Loaded without its brief —
    // the world is what the menu stands on, and the menu goes over the top.
    this.loadMission(Math.min(this.progress.highestUnlocked, MISSION_COUNT), false);
    this.openMenu();
    this.setupDebug();

    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------- mission flow

  /**
   * Builds a mission's world and, unless told otherwise, presents its brief.
   *
   * `present: false` is what the main menu boots on. The menu wants the player's actual
   * canyon behind it rather than a black page, and the canyon is only assembled here —
   * so the menu loads a mission for its world and then puts its own panel over the top.
   * Loading and presenting stay one function because every route into a mission has to
   * go through the same one, or a second entry path drifts from this one.
   */
  /**
   * The mission whose brief was last shown, so a re-entry can open on its final card.
   *
   * Session state on purpose, not saved: a player returning tomorrow should get the
   * transmission in full, and one returning from a crash thirty seconds ago should not.
   */
  private lastBriefed: number | null = null;

  private loadMission(id: number, present = true): void {
    const mission = getMission(id);
    if (!mission) {
      this.state = 'VICTORY';
      this.ui.setHudVisible(false);
      // In place rather than through a page reload, now that there is a menu to land in.
      this.ui.showVictory(() => this.newCanyon());
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

    // The world is derived entirely from the mission index, the frozen radar
    // position, the best rank earned so far and the campaign seed, so a retry rebuilds
    // an identical canyon and the colony ledger can never drift out of sync.
    //
    // `worldAt` only assembles the authored ledger now — pads, digs (some possibly
    // still wall-*anchored* rather than positioned), decommissions, the radar. Colony
    // growth and any terrain-anchored dig used to happen inside it, before any terrain
    // existed for this mission; both now happen here instead, in the order the design
    // actually needs: real terrain first, then fit a grid to it, then grow on what's
    // available. See docs/plans/procedural_colony_growth.md and `TerrainDigs.ts`.
    // Every mission's resolved world, memoised — this mission's for the terrain build
    // below, and every earlier mission's for the campaign walk `planColonies` makes.
    const worlds = missionWorlds(this.progress.mastX, this.progress.mastY, this.canyon);
    this.physics.clear();

    // Resolved *before* `canyon.build()` — a wall-anchored dig's real x/direction come
    // from terrain queries that are safe to call pre-build (see `WallTerrain`'s doc
    // comment in `TerrainDigs.ts`), and `canyon.build()` needs the resolved digs to
    // carve the right hole in the first place, not the unresolved placeholder.
    const current = worlds(id);

    // Pads without an explicit height rest on the ground, so the terrain needs a
    // level bench under each before the colony asks it how high the ground is.
    // Every pad the campaign will ever set on the ground, not just this mission's — see
    // `campaignPadSites`. Grading the site once is what keeps the ground a colony was
    // grown on from moving underneath it as later pads arrive.
    // Before the terrain, because the terrain registers the first faded material of the
    // rebuild. Clearing this inside either builder would be wrong — the canyon and the
    // colony both contribute, and whichever ran second would forget the other's.
    forgetFadedMaterials();
    this.canyon.build(current.digs, campaignPadSites(worlds));

    // Growth runs here, after `canyon.build()`, because the whole design depends on the
    // order: generate the landscape, fit a lattice to it, reserve every live pad's
    // flight route, then grow on what is left. See docs/plans/mycelial_colony_growth.md.
    const plan = planColonies(id, worlds, this.progress.points, this.progress.seed, this.canyon);
    const allProps = [...current.props, ...plan.colonies];

    // The resolver only moves what it can move — a platform is bolted to its tower and
    // stays put. If one of those ever ends up over a pad, nothing downstream will notice
    // and the mission just quietly becomes harder to land, so say so during development.
    // Colonies are included here too — they're generated safe-by-construction rather than
    // resolved, but this is still the same belt-and-suspenders net every other prop gets.
    // Runs here rather than inside `worldAt` now that colonies (and a resolved wall
    // mouth's real position) both need the real `this.canyon` this check can now pass
    // along — see `checkLayout`'s own doc comment on what that unlocks.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      for (const v of checkLayout(allProps, current.digs, undefined, this.canyon, plan.network.channels)) {
        console.warn(`[layout] mission ${id}: ${v.prop} ${v.detail} (pad ${v.pad})`);
      }
    }

    /**
     * `?colonies` strips everything but the grown structures and the pads they must
     * keep clear of — narrower than it used to be now that hand-authored structures
     * are gone from the real ledger (see the `Prop` doc comment in Colony.ts); today
     * this only drops `caveRoof` and `radar`. Pads stay: they are the anchors the
     * whole growth model is built around, and a colony floating in an empty canyon
     * says nothing about whether it respects them. Debug-only by nature — the dropped
     * props take their colliders with them, so a run flown in this view is not the
     * real mission.
     */
    const coloniesOnly = new URLSearchParams(window.location.search).has('colonies');
    const shown = coloniesOnly
      ? allProps.filter((p) => p.kind === 'colony' || p.kind === 'pad')
      : allProps;
    this.colony.build(shown, this.canyon, plan);

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
    // Collapse the render interpolation onto the entry pose, or the first frame smears
    // the hull from wherever the previous mission left it.
    this.lander.pin();

    this.director.snapTo(mission.start.x, mission.start.y);
    this.sun.target.position.set(mission.start.x, CANYON.FLOOR_Y, 0);

    this.ui.setHudVisible(false);
    // Ranging comes off the radar, and on mission 1 the radar is still in the hold.
    this.ui.setInstruments(id > 1);
    // The panel belongs to the vehicle; the colours belong to whoever chartered it.
    this.ui.setAirframe(this.lander.airframe.scheme, CORPS[mission.client].color);
    this.ui.setMission(mission, this.targetPad);
    if (present) this.beginUplink();

    audio.setMissionContext(musicTrackFor(mission), mission.id);
    audio.startAmbient();

    // Readout follows whatever is actually loaded, including retries and next-mission
    // transitions the inspector did not initiate.
    this.inspector?.refresh();
  }

  /**
   * The fall before the vehicle is yours.
   *
   * The vehicle was released from orbit before you were connected to it, so a mission
   * does not begin with a briefing over a frozen world — it begins already falling, with
   * the console coming up and nothing responding. That is what the state is for.
   *
   * Nothing of the vehicle's is on screen yet — no console, no augmented layer, only the
   * handshake's own status line. The console belongs to the airframe, and you are not
   * connected to the airframe: drawing its instruments while the link is still being
   * established says the opposite of what the sequence exists to say.
   *
   * This is also what finally puts the panel's boot sweep somewhere useful. It runs off
   * `consoleTime` rather than `missionTime` now, so it plays when the console actually
   * appears instead of during a stretch where nothing of it is drawn.
   */
  private beginUplink(): void {
    this.state = 'UPLINK';
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.ui.hidePanel();
    this.ui.setHudVisible(false);
    this.ui.setUplink(0);
  }

  /**
   * `missionTime` at the moment the console came up, so the boot sweep can be posed from
   * when the player can actually see it.
   *
   * A separate mark rather than a second accumulating clock: `missionTime` counts fixed
   * steps and is the one thing in the game guaranteed to replay identically, so anything
   * that wants a different origin should subtract, not count again.
   */
  private consoleUpAt = 0;

  /** Hands the vehicle over: the uplink is up, and here is what it was sent to do. */
  private presentBrief(): void {
    const mission = this.mission;
    this.state = 'BRIEF';
    this.ui.setUplink(null);
    this.ui.setHudVisible(false);
    this.ui.showBrief(
      mission,
      this.progress.rankFor(mission.id),
      {
        airframe: this.lander!.airframe,
        fuel: this.lander!.fuelCapacity,
        invertThrusters: this.progress.invertThrusters,
        // Applied to the loaded vehicle as well as saved, so flipping it in the brief
        // takes effect on the run you are about to fly rather than the one after.
        onInvert: (on) => {
          this.progress.setInvertThrusters(on);
          if (this.lander) this.lander.invertThrusters = on;
        },
      },
      () => this.begin(),
      this.lastBriefed === mission.id,
    );
    this.lastBriefed = mission.id;
  }

  private begin(): void {
    audio.init();
    audio.startAmbient();
    this.ui.hidePanel();
    this.ui.setHudVisible(true);
    // The console comes up here, so this is where its boot sweep starts. Set on `begin`
    // rather than when the uplink completes because the brief sits between the two, and
    // the panel is behind it — a sweep started at the handshake would be over before the
    // player finished reading.
    this.consoleUpAt = this.missionTime;
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
    this.ui.showFailure(
      title,
      detail,
      () => this.loadMission(this.mission.id),
      () => this.openMenu(),
    );
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
    /**
     * Everything the vehicle was telling you goes with the vehicle.
     *
     * The hull is hidden on this line and the wreck then settles for 1.3 seconds before
     * the failure card arrives — and the console and the augmented layer used to stay up
     * for all of it, brackets tracking a hull that is no longer drawn and a fuel gauge
     * reporting on a vehicle that has stopped existing. `fail` already did this; the
     * crash path is the one that reaches the same place a beat earlier and never did.
     *
     * `setHudVisible` takes the overlay down with it, which is the point — the brackets
     * are the part that reads worst, painted over an explosion.
     */
    this.ui.setHudVisible(false);
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

    /**
     * Clamped at both ends, and the lower end is not paranoia.
     *
     * `begin`, `beginUplink` and `resume` all reset `lastFrame` from `performance.now()`,
     * and they run from a click handler rather than from inside the frame callback — so
     * the next rAF timestamp, which is the moment that frame *started*, can predate the
     * reset. That makes `elapsed` negative, and a negative delta drives the accumulator
     * below zero, where it stays until several frames of real time have paid it back.
     * The simulation stalls for that whole stretch and the vehicle is drawn at the last
     * completed step throughout: a hitch immediately after the player takes control,
     * which is the worst possible moment for one. Measured at −0.08 s, about five frames.
     */
    const elapsed = Math.max(0, Math.min((now - this.lastFrame) / 1000, 0.25));
    this.lastFrame = now;

    if (this.inspecting) {
      this.inspector?.update(elapsed);
    } else if (this.state === 'PLAYING') {
      this.stepSimulation(elapsed);
    } else if (this.state === 'UPLINK') {
      // Same stepper, dead controls — see `stepSimulation`. Progress is read from
      // `missionTime`, which counts fixed steps, so the sequence takes exactly as long on
      // any machine and a retry replays it identically.
      this.stepSimulation(elapsed);
      this.ui.setUplink(clamp01(this.missionTime / UPLINK_SECONDS));
      if (this.missionTime >= UPLINK_SECONDS) this.presentBrief();
    } else if (this.state === 'SETTLING') {
      this.settleTimer -= elapsed;
      if (this.settleTimer <= 0) this.resolveSettle();
    }

    // Not in MENU either. The camera follows the vehicle, and in the menu the vehicle is
    // parked at entry altitude a thousand units up — so letting this run would haul the
    // shot off the canyon and back into empty sky, one frame after `frameCanyon` aimed it.
    if (this.lander && this.state !== 'BRIEF' && this.state !== 'MENU' && !this.inspecting) {
      // Velocity is only reported while the simulation is advancing. Paused, the
      // lander holds position but keeps its last velocity, and the camera's lag
      // compensation would keep leading a target that is no longer moving —
      // sliding the framing off the vehicle the longer you stay paused.
      // The uplink is a real descent, so the camera leads it like any other.
      const moving = this.state === 'PLAYING' || this.state === 'UPLINK';
      this.director.update(
        elapsed,
        // The drawn position, not the stepped one. Chasing the stepped position while
        // the hull renders at the interpolated one would just move the jitter into the
        // background instead of removing it.
        this.lander.renderX,
        this.lander.renderY,
        moving ? this.lander.vx : 0,
        moving ? this.lander.vy : 0,
        this.heightAboveGround,
      );
    }
    this.colony.update(elapsed, this.director.camera, this.lander ?? undefined);
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
    /**
     * Nothing responds during the uplink. The vehicle was released before you were
     * connected to it, so the fall is already happening and the controls are not yours
     * yet — which is the whole point of the sequence, and is why this substitutes a dead
     * input rather than skipping the step. The world has to keep moving.
     */
    const input = this.state === 'UPLINK' ? IDLE_INPUT : this.input.getState();

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

    // Draw the leftover. Whatever time is still in the accumulator has not been simulated
    // yet, and rendering the last completed step instead of interpolating through it is
    // what made the vehicle stutter — see `LanderBody.prevX`.
    lander.present(this.accumulator / FIXED_DT);

    // Re-fed every frame rather than triggered once: `shake` keeps the larger of what it
    // holds and what it is given, and decays, so a steady value reads as buffet where a
    // single call would read as a bump.
    // One ramp drives both, so the shake and the trail arrive and fade together instead
    // of reading as two unrelated effects that happen to overlap.
    const entry = clamp01((lander.speed - BUFFET_FROM) / (BUFFET_FULL - BUFFET_FROM));
    if (entry > 0) {
      this.director.shake(entry * BUFFET_MAX);
      this.effects.entryTrail(
        elapsed,
        lander.renderX,
        lander.renderY,
        lander.vx,
        lander.vy,
        entry,
      );
    }

    // Always on, whatever the speed. Two short streaks off the hull corners say which way
    // the vehicle is going and roughly how fast before the panel's numbers do.
    this.effects.wakeTrail(
      elapsed,
      lander.renderX,
      lander.renderY,
      lander.vx,
      lander.vy,
      lander.visualBounds.halfWidth,
    );

    this.updateProximity(elapsed, lander);
    this.updateHud(lander, elapsed);
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
      this.progress.complete(this.mission.id, score.rank, score.points);
      this.state = 'RESULT';
      this.ui.setHudVisible(false);
      this.ui.showResult(
        this.mission,
        score,
        () => this.loadMission(this.mission.id + 1),
        // The rank is already banked — `Progress.complete` keeps the best of each
        // measure — so re-flying can only improve it.
        () => this.loadMission(this.mission.id),
      );
    }
  }

  private updateHud(lander: Lander, dt: number): void {
    const depthRange = CANYON.FLOOR_Y - this.mission.failDepth;
    const abyssProximity =
      depthRange > 0 ? clamp01((CANYON.FLOOR_Y - lander.y) / depthRange) : 0;

    const common = {
      fuel: lander.fuel,
      fuelCapacity: lander.fuelCapacity,
      altitude: lander.y - CANYON.FLOOR_Y,
      verticalSpeed: lander.vy,
      // Signed. The panels that draw a drift direction cannot recover it downstream.
      horizontalSpeed: lander.vx,
      abyssProximity,
      consoleTime: this.missionTime - this.consoleUpAt,
    };

    this.ui.updateHud(this.telemetry(lander, common), dt);
    this.ui.updateMarker(this.director.camera, lander.renderX, lander.renderY);
    this.ui.updateReticle(this.director.camera, {
      // Drawn position, so the brackets sit on the hull rather than a step behind it.
      x: lander.renderX,
      y: lander.renderY,
      vx: lander.vx,
      vy: lander.vy,
      // Only the frame that has an attitude gets an attitude indicator. The other two
      // carry a cosmetic `bank` that nothing in the simulation reads, and feeding it
      // here would draw a lean as though it could end the mission.
      tilt: lander.airframe.scheme === 'attitude' ? lander.tilt : null,
      // Not until the handshake is done. The overlay is the thing that says you have the
      // vehicle, so it arrives when you actually do.
      acquired: this.state !== 'UPLINK',
    }, lander.visualBounds);
  }

  /**
   * The per-scheme half of the telemetry.
   *
   * Split out because the union is what keeps a panel from reading a quantity its
   * vehicle does not have, and that guarantee is only worth anything if the branch
   * producing it is somewhere it can be read in one piece.
   */
  private telemetry(lander: Lander, common: HudCommon): HudData {
    const frame = lander.airframe;

    if (frame.scheme === 'differential') {
      const engines = lander.firing.engines;
      /**
       * Which way the lit engines are actually pushing, from the same `-sin(cant)` the
       * physics integrates rather than from which key is down.
       *
       * Reading the input instead would be wrong on exactly the vehicle this gauge is
       * for: the hauler's nozzles splay outward, so its port engine drives the hull to
       * starboard, and the invert-controls setting moves which engine a key lights
       * without moving which way the vehicle goes. An arrow derived from the keypress
       * would point the wrong way for half the players and be right for the other half.
       */
      let push = 0;
      let scale = 0;
      for (let i = 0; i < frame.engines.length; i++) {
        const s = Math.sin(frame.engines[i].cant);
        scale += Math.abs(s);
        if (engines[i]) push -= s;
      }

      return {
        ...common,
        scheme: 'differential',
        engines,
        bias: scale > 0 ? push / scale : 0,
        clearance: this.canyon.clearanceAt(lander.x, lander.y),
      };
    }

    if (frame.scheme === 'translation') {
      return {
        ...common,
        scheme: 'translation',
        rcsLeft: lander.firing.rcsLeft,
        rcsRight: lander.firing.rcsRight,
        bank: lander.bank,
      };
    }

    return { ...common, scheme: 'attitude', tilt: lander.tilt };
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

  /**
   * Escape steps back one screen; P is pause only.
   *
   * A stack rather than a toggle, now that there is somewhere behind the pause menu. The
   * old code flipped PLAYING and PAUSED on either key, which with a menu underneath
   * would have made Escape mean "back" in one place and "forward" in another.
   */
  private onKey(e: KeyboardEvent): void {
    if (e.code === 'KeyP' && this.state === 'PLAYING') return this.pause();
    if (e.code !== 'Escape') return;

    if (this.state === 'PLAYING') this.pause();
    else if (this.state === 'PAUSED') this.resume();
    // Out of a submenu back to the root, and no further: the root menu is the floor.
    else if (this.state === 'MENU' && this.menuDepth > 0) this.openMenu();
  }

  // -------------------------------------------------------------------- menu

  /**
   * The main menu, over the player's own canyon.
   *
   * The world behind it is real: `openMenu` is entered after a `loadMission(id, false)`,
   * so what the menu sits on is this save's seed, this save's colony, grown to whatever
   * mission the player has reached. A menu over a black page would have been less work
   * and would have thrown away the one thing this game generates that is theirs.
   *
   * The vehicle is hidden. It is parked at entry altitude a thousand units up, so it
   * contributes nothing but a speck, and a lander frozen mid-sky behind a menu reads as
   * a stuck game.
   */
  private openMenu(): void {
    this.state = 'MENU';
    this.menuDepth = 0;
    this.ui.setHudVisible(false);
    if (this.lander) this.lander.group.visible = false;
    this.frameCanyon();

    const next = Math.min(this.progress.highestUnlocked, MISSION_COUNT);
    this.ui.showMenu([
      {
        label: 'CONTINUE',
        detail: `MISSION ${String(next).padStart(2, '0')}`,
        onSelect: () => this.enterMission(next),
      },
      { label: 'MISSIONS', detail: `${this.flownCount()} / ${MISSION_COUNT}`, onSelect: () => this.openMissions() },
      { label: 'SETTINGS', onSelect: () => this.openSettings() },
      { label: 'NEW CANYON', danger: true, onSelect: () => this.confirmNewCanyon() },
    ]);
  }

  private flownCount(): number {
    return Object.keys(this.progress.ranks).length;
  }

  /** Depth into the menu, so Escape can step back one screen rather than toggling. */
  private menuDepth = 0;

  private openMissions(): void {
    this.menuDepth = 1;
    this.ui.showMissions(
      Math.min(this.progress.highestUnlocked, MISSION_COUNT),
      (id) => this.progress.rankFor(id),
      MISSION_COUNT,
      (id) => this.enterMission(id),
      () => this.openMenu(),
    );
  }

  private openSettings(): void {
    this.menuDepth = 1;
    this.ui.showSettings(this.settings(), () => this.openMenu());
  }

  private confirmNewCanyon(): void {
    this.menuDepth = 1;
    this.ui.showConfirm(
      'NEW CANYON',
      'Rolls a new seed and starts the campaign at mission one. Every rank on this save is discarded, and the canyon you have been building in is gone.<br/><br/>Your sound and control settings are kept.',
      'ROLL A NEW CANYON',
      () => this.newCanyon(),
      () => this.openMenu(),
    );
  }

  /**
   * Rolls a new campaign without reloading the page.
   *
   * The old route was `progress.newCanyon()` followed by `window.location.reload()`,
   * which was a page reload standing in for a state transition because there was nowhere
   * to transition *to*. `useSeed` already had the in-place rebuild — dispose the
   * generator, repoint the director's ground probe, reload — and this is the same path.
   */
  private newCanyon(): void {
    this.progress.newCanyon();
    this.canyon.dispose();
    this.canyon = new CanyonGenerator(this.scene, this.physics, this.progress.seed);
    this.director.groundAt = (x, z) => this.canyon.heightAt(x, z);
    this.loadMission(1, false);
    this.openMenu();
  }

  /** Into a mission from anywhere in the menu: always via the brief. */
  private enterMission(id: number): void {
    if (this.lander) this.lander.group.visible = true;
    this.loadMission(id);
  }

  /**
   * Parks the camera on the canyon for the menu backdrop.
   *
   * Just above the rim over the canyon centre, which is where the chasm is most legible
   * as a chasm — the walls converge and the floor runs away into fog. Measured against
   * the alternatives rather than picked: the mission's own start point is entry altitude
   * a thousand units up, where the canyon is a crack in the haze; anything below the rim
   * fills the frame with one wall.
   *
   * This is the player's own seed, so the shot is different for everyone and changes as
   * their colony grows — which is the reason to put a real world behind the menu at all
   * rather than a flat backdrop.
   */
  private frameCanyon(): void {
    this.director.snapTo(0, CANYON.RIM_Y * 1.25);
  }

  private pause(): void {
    this.state = 'PAUSED';
    /**
     * The engine note and the wind are driven from `stepSimulation`, which stops running
     * the moment the state leaves PLAYING — so without this they hold whatever they were
     * at and drone under the pause menu for as long as it is open. Nobody noticed while
     * pausing drew nothing on screen; a menu that sits there humming makes it obvious.
     *
     * Music is deliberately left running. The engines and the wind belong to a vehicle
     * that is currently not moving; the score is atmosphere, and cutting it makes pausing
     * feel like the game has crashed.
     */
    audio.updateEngineSound([]);
    audio.updateWind(Infinity, 0);

    // The console belongs to the flight. Paused, the numbers are frozen and the augmented
    // layer is painted over a vehicle nobody is flying — both read as stale rather than
    // informative, and they clutter the one screen that is meant to be legible at a
    // glance. `setHudVisible` takes the overlay down with it.
    this.ui.setHudVisible(false);
    this.ui.showPause(
      this.settings(),
      () => this.resume(),
      // Straight back to the uplink, through the same path every other entry uses.
      () => this.loadMission(this.mission.id),
      // Nothing is scored until a landing resolves, so abandoning a run in progress
      // costs only the attempt — no confirmation needed, unlike NEW CANYON.
      () => this.openMenu(),
    );
  }

  private resume(): void {
    this.state = 'PLAYING';
    // The clock has been running while the menu was open. Without this the first frame
    // back would be handed however many seconds the player spent reading, and the
    // accumulator would try to catch up on all of it at once.
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.ui.hidePanel();
    this.ui.setHudVisible(true);
  }

  /**
   * The settings block's view of the world, built fresh each time it is opened so it
   * always reflects what is actually stored rather than a snapshot from startup.
   */
  private settings(): GameSettings {
    const frame = this.lander?.airframe;
    return {
      mutedSfx: this.progress.audioPrefs.sfx,
      mutedMusic: this.progress.audioPrefs.music,
      onMuteSfx: (muted) => {
        audio.setSfxMuted(muted);
        this.progress.setMutedSfx(muted);
      },
      onMuteMusic: (muted) => {
        audio.setMusicMuted(muted);
        this.progress.setMutedMusic(muted);
      },
      // Only where there are two engines to tell apart — the same condition the brief
      // uses. On the other frames the row would be a control that does nothing.
      invert:
        frame?.scheme === 'differential'
          ? {
              inverted: this.progress.invertThrusters,
              onChange: (on) => {
                this.progress.setInvertThrusters(on);
                if (this.lander) this.lander.invertThrusters = on;
              },
            }
          : null,
    };
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
      scores: () => this.progress.points,
      mastX: () => this.progress.mastX,
      mastY: () => this.progress.mastY,
      terrain: () => this.canyon,
      loadMission: (id) => this.loadMission(id),
      useSeed: (seed) => this.useSeed(seed),
      gizmos: () => this.colony.gizmos,
      // Gizmos are built inside `Colony.build`, so the flag alone changes nothing until
      // the world is rebuilt. Reloading the current mission is the honest way to do that
      // — it is the same path the mission stepper uses, so there is no second rebuild
      // route that could drift from it.
      setGizmos: (on) => {
        this.colony.gizmos = on;
        this.loadMission(this.mission?.id ?? 1);
      },
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
        this.lander.pin();
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
