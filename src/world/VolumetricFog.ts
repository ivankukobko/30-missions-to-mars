import * as THREE from 'three';
import { CANYON } from './CanyonSpec.ts';

/**
 * Volumetric Floor & Shaft Fog Shader
 *
 * Renders a soft, noise-animated volumetric mist layer at the canyon floor (y <= 15)
 * and deep subterranean mining bores, smoothly fading out at box edges to prevent
 * any hard geometric lines against the solid sky background.
 */
export class VolumetricFog {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    // Cover playable canyon length and shaft depths
    const geo = new THREE.BoxGeometry(360, 320, CANYON.LENGTH + 400);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: new THREE.Color(0x1e0e07) },
        uFloorY: { value: CANYON.FLOOR_Y },
        uCanyonLength: { value: CANYON.LENGTH },
      },
      vertexShader: `
        varying vec3 vWorldPosition;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uFogColor;
        uniform float uFloorY;
        uniform float uCanyonLength;

        varying vec3 vWorldPosition;

        // Simple 3D noise approximation for drifting volumetric mist
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);

          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }

        void main() {
          float y = vWorldPosition.y;
          float z = vWorldPosition.z;

          // Mist exists strictly near/below floor (y <= FLOOR_Y + 15) and down shafts
          float floorMist = clamp((uFloorY + 15.0 - y) / 35.0, 0.0, 1.0);
          float shaftFactor = clamp((uFloorY - y) / 180.0, 0.0, 1.0);

          // Smooth edge fading near canyon ends (Z) to eliminate hard geometry cutoffs
          float zFadeOut = clamp((-z) / 150.0, 0.0, 1.0) * clamp((uCanyonLength + z + 100.0) / 200.0, 0.0, 1.0);

          // Animated drifting noise
          vec3 noiseCoord = vec3(vWorldPosition.x * 0.035, y * 0.04 - uTime * 0.08, z * 0.025);
          float n = noise(noiseCoord) * 0.5 + 0.5;

          // Combine floor mist with subterranean shaft factor and Z edge fade
          float alpha = (floorMist * 0.35 * (0.65 + 0.35 * n) + shaftFactor * 0.40) * zFadeOut;
          alpha = clamp(alpha, 0.0, 0.75);

          // Darken subterranean shaft fog
          vec3 finalColor = mix(uFogColor, vec3(0.02, 0.01, 0.005), shaftFactor * 0.85);

          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    // Position volume under the floor line
    this.mesh.position.set(0, CANYON.FLOOR_Y - 100, -CANYON.LENGTH / 2);
    scene.add(this.mesh);
  }

  public update(dt: number, fogColor: THREE.Color): void {
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uFogColor.value.copy(fogColor);
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
