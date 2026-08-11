import * as THREE from 'three';
import { PALETTE } from '../world/CanyonSpec.ts';

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
  }
}
