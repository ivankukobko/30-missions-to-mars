import * as THREE from 'three';

/**
 * Anything standing between the camera and the vehicle thins out around it.
 *
 * The problem depth created: the canyon is a cross-section the camera looks across, and
 * everything in front of the play plane — the near canyon wall, the colony's foreground
 * layer — is geometry the player has to see *past* rather than see. Culling it is worse
 * than the disease (a hole where a wall should be reads as a bug), and making it uniformly
 * translucent throws away the reason it is there at all: a canyon you can see through
 * everywhere looks like a diagram rather than a place.
 *
 * So it stays solid, and a soft hole opens around the lander — the same thing a
 * third-person camera does when a wall comes between it and the player. Away from the
 * vehicle nothing is faded and the world looks deep.
 *
 * Two decisions worth keeping written down:
 *
 *   - **A shader patch, not a shader.** `onBeforeCompile` keeps three.js's own lighting,
 *     fog, vertex colours and flat shading, all of which this geometry still wants;
 *     reimplementing them to add one multiply on alpha would be a great deal of code to
 *     keep in step with a library that moves.
 *   - **Faded in world space, not screen space.** The camera looks very nearly down the z
 *     axis, so a screen-space hole would sit within a few pixels of this one and cost a
 *     projection per fragment to get there.
 */

/** How see-through a surface gets directly over the vehicle, and how far the hole reaches.
 *  The radius is roughly three cells, which is wide enough to clear the lander and its
 *  plume without opening a window you could fly a mission through. */
const FADE_OPACITY = 0.16;
const FADE_RADIUS = 34;

interface Patched {
  uniforms: {
    uFocus: { value: THREE.Vector2 };
    uFrontZ: { value: number };
  };
}

/** Every material currently taking part, so the focus can be moved without walking the
 *  scene graph each frame. */
const faded: THREE.Material[] = [];

/**
 * Makes one material fade near the lander.
 *
 * `frontZ` is the depth in front of which fading applies: a fragment at or behind it is
 * never touched. That gate is what lets a single mesh spanning the whole canyon — the
 * terrain is one heightfield across x and z — fade its near wall while its far wall stays
 * solid. For geometry that is wholly in front of the play plane, such as the colony's
 * foreground layer, any value below it does.
 *
 * The caller is responsible for `transparent: true`, which has to be set at construction:
 * three.js picks the render queue from it, and flipping it later forces a recompile
 * mid-flight.
 */
export function fadeNearLander(material: THREE.Material, frontZ = 0): void {
  material.onBeforeCompile = (shader) => {
    // Far above the canyon until the first frame sets it, so a mesh drawn before the
    // vehicle exists is fully opaque rather than fully clear.
    shader.uniforms.uFocus = { value: new THREE.Vector2(0, 1e6) };
    shader.uniforms.uFrontZ = { value: frontZ };
    shader.uniforms.uFadeNear = { value: FADE_OPACITY };
    shader.uniforms.uFadeRadius = { value: FADE_RADIUS };

    shader.vertexShader = `varying vec3 vFadeWorld;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = [
      'uniform vec2 uFocus;',
      'uniform float uFrontZ;',
      'uniform float uFadeNear;',
      'uniform float uFadeRadius;',
      'varying vec3 vFadeWorld;',
      shader.fragmentShader,
    ]
      .join('\n')
      // The last stage that touches the output colour, so nothing downstream undoes this.
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n' +
          '  if (vFadeWorld.z > uFrontZ) {\n' +
          '    float gap = length(vFadeWorld.xy - uFocus);\n' +
          '    gl_FragColor.a *= mix(uFadeNear, 1.0, smoothstep(0.0, uFadeRadius, gap));\n' +
          '  }',
      );
    material.userData.fade = shader;
  };
  faded.push(material);
}

/** Points every faded surface at the vehicle. Called once a frame. */
export function setLanderFocus(x: number, y: number): void {
  for (const material of faded) {
    const shader = material.userData.fade as Patched | undefined;
    shader?.uniforms.uFocus.value.set(x, y);
  }
}

/** Drops the previous mission's materials. The owners dispose them; this only forgets the
 *  references, and it must run once per rebuild rather than once per thing rebuilt. */
export function forgetFadedMaterials(): void {
  faded.length = 0;
}
