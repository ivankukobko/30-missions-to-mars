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

/**
 * Distance from camera to the play plane assumed before a frame has reported one.
 *
 * Mid-range of what `CameraDirector` actually flies (20 to 82), so a mesh drawn between a
 * rebuild and the first `setLanderFocus` is wrong by a factor rather than by an order.
 */
const ASSUMED_CAMERA_Z = 48;

interface Patched {
  uniforms: {
    uFocus: { value: THREE.Vector2 };
    uFrontZ: { value: number };
    uCameraZ: { value: number };
  };
}

/**
 * Aerial perspective for geometry that recedes from the play plane, applied per fragment.
 *
 * This lived in `ColonyRender` as a multiply on each material's `color`, one material per
 * layer — which is *why* the colony was batched one mesh per layer, and therefore why no
 * piece of geometry could span two layers. Moving it here removes that constraint at the
 * root rather than working around it.
 *
 * Two things it gains on the way, neither of which the material version could do:
 *
 *   - **It reaches emissive.** A vertex-colour version — the obvious alternative — would
 *     not: three.js multiplies vertex colour into the diffuse term only, so a lamp in the
 *     back layer would have kept full brightness while its housing dimmed, which is the
 *     exact cue whose absence flattened the three layers into one before.
 *   - **It is continuous in z.** A module is up to 19 deep and used to carry one flat tone
 *     over that whole run; now its far end is genuinely darker than its near end, which is
 *     what distance actually does and what a stepped per-layer value could only approximate.
 *
 * Applied after `#include <dithering_fragment>`, so it lands after lighting, fog and
 * everything else that writes the output colour.
 */
export interface DepthEffects {
  /**
   * Fade in front of this world z. `null` omits the fade entirely — the patch then only
   * dims, which is what opaque geometry behind the vehicle wants.
   */
  fadeInFrontOf?: number | null;
  /** How much to darken per `dimSpacing` of depth behind `dimFrom`. Zero omits the dim. */
  dimPerLayer?: number;
  /** The depth that counts as "not receding yet" — the play plane of whatever is being
   *  drawn, which is not necessarily z=0. */
  dimFrom?: number;
  dimSpacing?: number;
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
  patchDepth(material, { fadeInFrontOf: frontZ });
}

/**
 * Fades and/or dims one material by depth. Both effects share a single `onBeforeCompile`
 * and a single world-position varying, which is not a micro-optimisation: assigning
 * `onBeforeCompile` twice silently discards the first patch, so two independent helpers
 * would have quietly dropped whichever was applied first.
 */
export function patchDepth(material: THREE.Material, opts: DepthEffects): void {
  const frontZ = opts.fadeInFrontOf ?? null;
  const dim = opts.dimPerLayer ?? 0;
  if (frontZ === null && dim === 0) return;

  material.onBeforeCompile = (shader) => {
    const declarations = ['varying vec3 vFadeWorld;'];
    let body = '';

    if (frontZ !== null) {
      // Far above the canyon until the first frame sets it, so a mesh drawn before the
      // vehicle exists is fully opaque rather than fully clear.
      shader.uniforms.uFocus = { value: new THREE.Vector2(0, 1e6) };
      shader.uniforms.uFrontZ = { value: frontZ };
      shader.uniforms.uFadeNear = { value: FADE_OPACITY };
      shader.uniforms.uFadeRadius = { value: FADE_RADIUS };
      shader.uniforms.uCameraZ = { value: ASSUMED_CAMERA_Z };
      declarations.push(
        'uniform vec2 uFocus;',
        'uniform float uFrontZ;',
        'uniform float uFadeNear;',
        'uniform float uFadeRadius;',
        'uniform float uCameraZ;',
      );
      /**
       * A cone from the camera, not a cylinder down the z axis.
       *
       * `uFadeRadius` is a screen-size decision — wide enough to clear the vehicle and its
       * plume — and screen size is an angle, so holding it as a fixed *world* radius makes
       * the hole grow on screen the closer the occluder is to the camera. A circle of
       * radius R at distance D subtends the same angle as R·d/D at distance d, which is
       * all this line is: the vehicle sits on the play plane at z=0, so `uCameraZ` is D and
       * `uCameraZ - z` is d.
       *
       * Inside the canyon the difference is modest, which is why the cylinder survived so
       * long. On the rim it is not: the prologue's camera stands above the lip with upland
       * a few tens of units in front of it, where a 34-unit radius covered most of the
       * frame — a grey sheet with the canyon's own facets showing through, opening under a
       * vehicle it was not occluding in the first place.
       */
      body +=
        '  if (vFadeWorld.z > uFrontZ) {\n' +
        '    float gap = length(vFadeWorld.xy - uFocus);\n' +
        '    float reach = uFadeRadius * clamp((uCameraZ - vFadeWorld.z) / max(uCameraZ, 1.0), 0.0, 1.0);\n' +
        '    gl_FragColor.a *= mix(uFadeNear, 1.0, smoothstep(0.0, max(reach, 0.001), gap));\n' +
        '  }\n';
    }

    if (dim > 0) {
      shader.uniforms.uDim = { value: dim };
      shader.uniforms.uDimFrom = { value: opts.dimFrom ?? 0 };
      shader.uniforms.uDimSpacing = { value: opts.dimSpacing ?? 1 };
      declarations.push('uniform float uDim;', 'uniform float uDimFrom;', 'uniform float uDimSpacing;');
      // Clamped, so a colony deep enough to run out of layers goes black rather than
      // inverting — `max` alone would let a far enough fragment produce a negative factor.
      body +=
        '  float behind = max(0.0, uDimFrom - vFadeWorld.z) / uDimSpacing;\n' +
        '  gl_FragColor.rgb *= clamp(1.0 - uDim * behind, 0.0, 1.0);\n';
    }

    shader.vertexShader = `varying vec3 vFadeWorld;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = [...declarations, shader.fragmentShader]
      .join('\n')
      // The last stage that touches the output colour, so nothing downstream undoes this.
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${body}`);
    material.userData.fade = shader;
  };

  // Only fading materials carry `uFocus`, and `setLanderFocus` reaches straight into it —
  // registering a dim-only material here would fault on the first frame.
  if (frontZ !== null) faded.push(material);
}

/**
 * Points every faded surface at the vehicle, and tells it where the camera is. Once a
 * frame.
 *
 * The camera depth is not a detail: the hole is sized as an angle and resolved as a world
 * radius, so the conversion between the two is exactly this number. Omitting it leaves
 * `ASSUMED_CAMERA_Z` standing, which is the right order and the wrong value.
 */
export function setLanderFocus(x: number, y: number, cameraZ?: number): void {
  for (const material of faded) {
    const shader = material.userData.fade as Patched | undefined;
    if (!shader) continue;
    shader.uniforms.uFocus.value.set(x, y);
    if (cameraZ !== undefined) shader.uniforms.uCameraZ.value = cameraZ;
  }
}

/** Drops the previous mission's materials. The owners dispose them; this only forgets the
 *  references, and it must run once per rebuild rather than once per thing rebuilt. */
export function forgetFadedMaterials(): void {
  faded.length = 0;
}
