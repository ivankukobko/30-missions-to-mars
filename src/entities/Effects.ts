import * as THREE from 'three';
import { PALETTE } from '../world/CanyonSpec.ts';

interface Streak {
  x: number;
  y: number;
  z: number;
  /** Unit direction of travel; the streak is drawn back along it. */
  dx: number;
  dy: number;
  len: number;
  age: number;
  life: number;
  /** 0..1, how white-hot the head is. */
  heat: number;
}

interface Puff {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  scale: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
}

const DUST_COUNT = 260;
/** Box around the lander that dust is kept inside; it wraps at the edges. */
const DUST_BOX = { x: 90, y: 70, z: 90 };
const PUFF_POOL = 90;

/** Streaks in flight at once during entry. */
const TRAIL_POOL = 96;

/**
 * Particulate: airborne dust that reads as motion, and low-poly smoke for the engine
 * and for what the engine kicks off the ground.
 *
 * Everything is pooled and allocated once. A lander game spawns puffs continuously
 * while thrusting, and per-puff geometry allocation would hitch exactly when the
 * player is doing the thing that matters most.
 */
export class Effects {
  private scene: THREE.Scene;

  private dust: THREE.Points;
  private dustPos: Float32Array;
  private dustSeed: Float32Array;

  private puffs: Puff[] = [];
  private free: Puff[] = [];

  private groundEmit = 0;

  private trail: THREE.LineSegments;
  private trailPos: Float32Array;
  private trailCol: Float32Array;
  private streaks: Streak[] = [];
  private trailFree: Streak[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // ------------------------------------------------------------- speed dust
    // Motes suspended in the canyon air. They do not move on their own — the lander
    // moves past them, and they wrap around it, so their apparent drift is exactly
    // the lander's velocity. That makes them a direction and speed readout rather
    // than decoration.
    this.dustPos = new Float32Array(DUST_COUNT * 3);
    this.dustSeed = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      this.dustPos[i * 3] = (Math.random() - 0.5) * DUST_BOX.x * 2;
      this.dustPos[i * 3 + 1] = (Math.random() - 0.5) * DUST_BOX.y * 2;
      this.dustPos[i * 3 + 2] = (Math.random() - 0.5) * DUST_BOX.z * 2;
      this.dustSeed[i] = Math.random();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xe8bb92,
        size: 0.55,
        sizeAttenuation: true,
        transparent: false,
        opacity: 1.0,
        depthWrite: true,
        fog: true,
      }),
    );
    this.dust.frustumCulled = false;
    scene.add(this.dust);

    // ------------------------------------------------------------------ puffs
    const geo = new THREE.IcosahedronGeometry(1, 0); // 20 faces: low-poly by design
    for (let i = 0; i < PUFF_POOL; i++) {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: PALETTE.dust,
          roughness: 1,
          metalness: 0,
          flatShading: true,
          transparent: false,
          opacity: 1.0,
        }),
      );
      mesh.visible = false;
      scene.add(mesh);
      const puff: Puff = { mesh, age: 0, life: 1, scale: 1, vx: 0, vy: 0, vz: 0, spin: 0 };
      this.puffs.push(puff);
      this.free.push(puff);
    }

    // ----------------------------------------------------------- entry streaks
    this.trailPos = new Float32Array(TRAIL_POOL * 2 * 3);
    this.trailCol = new Float32Array(TRAIL_POOL * 2 * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trail = new THREE.LineSegments(
      trailGeo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        // Additive so overlapping streaks build brightness the way glowing air does,
        // and so a colour faded to black is simply gone — there is no alpha to animate.
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // Fog would pull these toward the dust colour and kill the heat, and they are
        // only ever a few units from the lens anyway.
        fog: false,
      }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    for (let i = 0; i < TRAIL_POOL; i++) {
      const s: Streak = { x: 0, y: 0, z: 0, dx: 0, dy: -1, len: 0, age: 0, life: 0, heat: 0 };
      this.streaks.push(s);
      this.trailFree.push(s);
    }
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    scale: number,
    life: number,
    vx: number,
    vy: number,
    color: number,
  ): void {
    const puff = this.free.pop();
    if (!puff) return; // pool exhausted; dropping a puff is invisible, a stall is not
    puff.age = 0;
    puff.life = life;
    puff.scale = scale;
    puff.vx = vx;
    puff.vy = vy;
    puff.vz = (Math.random() - 0.5) * 2.5;
    puff.spin = (Math.random() - 0.5) * 2.5;
    puff.mesh.position.set(x, y, z);
    puff.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    puff.mesh.scale.setScalar(scale * 0.35);
    puff.mesh.visible = true;
    (puff.mesh.material as THREE.MeshStandardMaterial).color.setHex(color);
  }

  /** A burst at engine ignition — the moment the exhaust first bites. */
  ignite(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      this.spawn(
        x + (Math.random() - 0.5) * 1.5,
        y - 2.2 - Math.random() * 0.8,
        (Math.random() - 0.5) * 2,
        1.2 + Math.random() * 0.8,
        0.28 + Math.random() * 0.15, // Fast 0.3s lifespan
        (Math.random() - 0.5) * 14,
        -8 - Math.random() * 6, // Shoot downward away from lander
        0xc9d6e2,
      );
    }
  }

  /**
   * Dust kicked off a surface by the exhaust. Emitted only while the engine is
   * running and the ground is close enough for the plume to reach it.
   */
  groundDust(dt: number, x: number, groundY: number, proximity: number): void {
    this.groundEmit += dt * (10 + proximity * 25);
    while (this.groundEmit >= 1) {
      this.groundEmit -= 1;
      const spread = 2.5 + proximity * 7;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.spawn(
        x + side * (1.2 + Math.random() * spread),
        groundY + 0.2 + Math.random() * 0.4, // Keep strictly down at ground level
        (Math.random() - 0.5) * 6,
        1.0 + Math.random() * 1.6,
        0.30 + Math.random() * 0.18, // Fast 0.35s lifespan
        side * (8 + Math.random() * 16), // Shoot fast sideways away from lander
        -0.5 + Math.random() * 1.5,
        PALETTE.dust,
      );
    }
  }


  /**
   * Entry trail — compression heating on the way in through the top of the atmosphere.
   *
   * Streaks rather than smoke. The first attempt reused the puff pool, and it read as
   * flying boulders: the entry camera sits 3.8 units behind the vehicle against 82 in
   * flight, so a puff sized for the flight shot fills the lens up here. Shrinking it far
   * enough to work made it a spray of pebbles instead. A line is what the eye reads as
   * something moving too fast to resolve, which is exactly the claim being made.
   *
   * Each streak is fixed in world space and simply fades. It is heated *air*, not
   * ejecta — the vehicle leaves it behind by moving, and nothing about it should chase
   * the hull.
   *
   * Additive, fading to black. Additive blending has no alpha to fade, so darkening the
   * vertex colour toward zero is the fade — and it also means the streaks pile up into
   * something brighter where they overlap, which is the right behaviour for glowing air.
   *
   * `intensity` is 0..1 from the same speed ramp that drives the camera buffet, so the
   * trail and the shake arrive and fade together rather than as two unrelated effects.
   */
  entryTrail(dt: number, x: number, y: number, vx: number, vy: number, intensity: number): void {
    if (intensity <= 0) return;
    // Scaled from zero rather than off a base rate, so the trail fades in with speed
    // instead of appearing all at once the instant the threshold is crossed.
    this.trailEmit += dt * intensity * 150;

    const speed = Math.hypot(vx, vy) || 1;
    const dx = vx / speed;
    const dy = vy / speed;

    while (this.trailEmit >= 1) {
      this.trailEmit -= 1;
      const seg = this.trailFree.pop();
      if (!seg) return; // Pool exhausted. A missing streak is invisible; a stall is not.

      // Across the direction of travel, so the plume has width rather than being a line
      // drawn on top of itself.
      const spread = (Math.random() - 0.5) * 3.4;
      // Born a little ahead of the hull, where the air is actually being compressed. The
      // trail behind then forms on its own as the vehicle overtakes them.
      seg.x = x + dx * 1.8 - dy * spread;
      seg.y = y + dy * 1.8 + dx * spread;
      seg.z = (Math.random() - 0.5) * 2.4;
      seg.dx = dx;
      seg.dy = dy;
      // Length rides the ramp too. The stubby end of the range only ever exists during
      // the fade-in, where there is almost nothing on screen to compare it against.
      seg.len = 1.5 + Math.random() * 9 * intensity;
      seg.age = 0;
      seg.life = 0.22 + Math.random() * 0.3;
      seg.heat = 0.5 + Math.random() * 0.5 * intensity;
    }
  }

  private trailEmit = 0;

  /** Impact plume. */
  burst(x: number, y: number): void {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(
        x, y - 0.5, (Math.random() - 0.5) * 3,
        1.5 + Math.random() * 1.8,
        0.35 + Math.random() * 0.2, // Fast lifespan
        Math.cos(a) * (10 + Math.random() * 18),
        Math.sin(a) * (4 + Math.random() * 12),
        i % 3 === 0 ? 0xffb066 : PALETTE.dust,
      );
    }
  }

  update(dt: number, landerX: number, landerY: number, vx: number, vy: number): void {
    // Dust wraps around the lander, so it is always present without ever being
    // regenerated — the wrap is what turns a static field into apparent motion.
    this.dust.position.set(landerX, landerY, 0);
    const p = this.dustPos;
    for (let i = 0; i < DUST_COUNT; i++) {
      const j = i * 3;
      // A little self-drift so the air is never completely dead when hovering.
      const swirl = this.dustSeed[i] * 6.28;
      p[j] -= (vx + Math.sin(swirl) * 1.5) * dt;
      p[j + 1] -= (vy + Math.cos(swirl) * 1.2) * dt;

      if (p[j] > DUST_BOX.x) p[j] -= DUST_BOX.x * 2;
      else if (p[j] < -DUST_BOX.x) p[j] += DUST_BOX.x * 2;
      if (p[j + 1] > DUST_BOX.y) p[j + 1] -= DUST_BOX.y * 2;
      else if (p[j + 1] < -DUST_BOX.y) p[j + 1] += DUST_BOX.y * 2;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;

    for (const puff of this.puffs) {
      if (!puff.mesh.visible) continue;
      puff.age += dt;
      const t = puff.age / puff.life;
      if (t >= 1) {
        puff.mesh.visible = false;
        this.free.push(puff);
        continue;
      }
      puff.mesh.position.x += puff.vx * dt;
      puff.mesh.position.y += puff.vy * dt;
      puff.mesh.position.z += puff.vz * dt;
      puff.vx *= 1 - 3.5 * dt; // Fast friction deceleration
      puff.vy *= 1 - 3.5 * dt;
      puff.mesh.rotation.z += puff.spin * 3.0 * dt; // Snappy cartoon spin

      // Snappy Cartoon Pop Animation:
      // Punchy expansion in first 35% of life, then fast shrink pop out
      const sizeFactor = t < 0.35
        ? (0.2 + (t / 0.35) * 1.1)
        : (1.3 * Math.pow((1.0 - t) / 0.65, 1.8));
      puff.mesh.scale.setScalar(Math.max(0.001, puff.scale * sizeFactor));
    }

    this.updateTrail(dt);
  }

  /**
   * Ages the entry streaks and rewrites the whole buffer.
   *
   * Every slot is written every frame, live or not — a retired streak has both ends
   * collapsed onto one point and its colour zeroed, which under additive blending is
   * nothing at all. Cheaper and simpler than maintaining a draw range, and it means a
   * slot can never keep drawing because a return path missed it.
   */
  private updateTrail(dt: number): void {
    const pos = this.trailPos;
    const col = this.trailCol;

    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      const j = i * 6;

      if (s.life > 0) {
        s.age += dt;
        if (s.age >= s.life) {
          s.life = 0;
          this.trailFree.push(s);
        }
      }

      if (s.life <= 0) {
        pos[j] = pos[j + 1] = pos[j + 2] = 0;
        pos[j + 3] = pos[j + 4] = pos[j + 5] = 0;
        col[j] = col[j + 1] = col[j + 2] = 0;
        col[j + 3] = col[j + 4] = col[j + 5] = 0;
        continue;
      }

      const t = s.age / s.life;
      // Fades away rather than out: additive blending has no alpha to animate, so the
      // colour itself is driven to black.
      const fade = (1 - t) * (1 - t);

      // Head, at the leading edge.
      pos[j] = s.x;
      pos[j + 1] = s.y;
      pos[j + 2] = s.z;
      // Tail, back along the direction of travel.
      pos[j + 3] = s.x - s.dx * s.len;
      pos[j + 4] = s.y - s.dy * s.len;
      pos[j + 5] = s.z;

      // White-hot at the head, cooling to orange down the length — the same gradient a
      // real streak has, and the thing that keeps it from reading as a drawn line.
      col[j] = fade;
      col[j + 1] = fade * (0.72 + 0.28 * s.heat);
      col[j + 2] = fade * (0.42 + 0.5 * s.heat);
      col[j + 3] = fade * 0.65;
      col[j + 4] = fade * 0.24;
      col[j + 5] = fade * 0.06;
    }

    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.dust);
    this.dust.geometry.dispose();
    (this.dust.material as THREE.Material).dispose();
    for (const puff of this.puffs) {
      this.scene.remove(puff.mesh);
      (puff.mesh.material as THREE.Material).dispose();
    }
    this.puffs[0]?.mesh.geometry.dispose();
    this.puffs = [];
    this.free = [];

    this.scene.remove(this.trail);
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
    this.streaks = [];
    this.trailFree = [];
  }
}
