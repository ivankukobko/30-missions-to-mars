import * as THREE from 'three';
import { CANYON } from './CanyonSpec.ts';

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

/** How see-through a surface gets directly over the vehicle. */
const FADE_OPACITY = 0.16;

/**
 * How far the hole reaches, in world units at the vehicle.
 *
 * Large against the vehicle it uncovers — `LANDER.RADIUS` is 0.62, so this is fifty-five
 * times the hull's half-width — and that is not the mistake it looks like. What the hole has
 * to clear is not the hull but the *colony member in front of it*: the foreground layer is
 * built from lattice cells and gantry runs metres across, and a hole sized to the lander
 * shows it down a keyhole between two struts. Measured in the shaft at mission 20, 34 opens
 * the clean circle the feature wants and 12 leaves the vehicle behind a bar.
 *
 * It was briefly 12, on the theory that the radius was what dissolved the upland out from
 * under a lander on the rim. It was not: freezing the same frame at both values showed
 * almost no difference, because the real fault was that the effect was running above the
 * mouth at all. `FADE_GATE_BAND` is that fix, and with it in place this number goes back to
 * being tuned for the only case left — the one it was always tuned for.
 *
 * The note that used to sit here said "roughly three cells", which is 18. That was wrong
 * about its own constant for as long as it stood.
 */
const FADE_RADIUS = 34;

/**
 * Over the canyon mouth the hole closes entirely, across this band.
 *
 * **Above the rim the feature has no work to do.** What it exists for is the near canyon
 * wall and the colony's foreground layer — geometry the player has to see *past* rather
 * than see. Both stop at the mouth. Above it there is open upland in front of the camera
 * and nothing that can stand between it and the vehicle, so every fragment the fade touches
 * up there is ground it had no business dissolving: measured, the lip is 239–240 on every
 * seed and the upland just outside it 245–268, which is exactly the range the vehicle is
 * flying over when the surface goes to sky underneath it.
 *
 * A band rather than a cut, and the band sits *inside* the canyon — full strength at 200,
 * gone by `RIM_Y` — so the hole is already shut by the time the vehicle crosses the lip and
 * nothing pops on the way through.
 *
 * This is the second half of the fix, and the necessary one. Pointing the cone down the real
 * camera-to-vehicle ray was correct and did not settle it; neither did sizing the hole to
 * the vehicle. Both were true faults. Neither was *this* one, which is that the effect was
 * running at all in the one place it can only do harm.
 */
const FADE_GATE_BAND = 40;

interface Patched {
  uniforms: {
    uFocus: { value: THREE.Vector2 };
    uFrontZ: { value: number };
    uGate: { value: number };
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
      shader.uniforms.uGate = { value: 1 };
      shader.uniforms.uFadeNear = { value: FADE_OPACITY };
      shader.uniforms.uFadeRadius = { value: FADE_RADIUS };
      declarations.push(
        'uniform vec2 uFocus;',
        'uniform float uFrontZ;',
        'uniform float uGate;',
        'uniform float uFadeNear;',
        'uniform float uFadeRadius;',
      );
      /**
       * A cone along the **camera-to-vehicle ray**, and only the part of it in front of the
       * vehicle.
       *
       * Two bugs lived here, and the second is why the first was hard to see.
       *
       * **The hole was a cone around the wrong axis.** `gap` measured world xy distance to
       * the vehicle, which is a cone around the line *parallel to z* through it. That is the
       * camera-to-vehicle ray only while the camera is looking straight down the z axis, and
       * the header's claim that it "looks very nearly down the z axis" is true inside the
       * canyon and false everywhere else — `CameraDirector` pitches hard on the high entry
       * shots and over the rim. Off-axis, a z-parallel column projects to a *slanted* line on
       * screen, so the hole opened somewhere along that line with the vehicle nowhere near
       * it: a grey wedge on a slope, metres from the lander, occluding nothing.
       *
       * **And it had no idea where the vehicle was along the ray.** Every fragment in front of
       * `uFrontZ` was a candidate however far past the vehicle it sat, so geometry *behind*
       * the thing it was supposed to reveal faded too.
       *
       * Both go away by asking the question the feature is actually about: is this fragment
       * between the camera and the vehicle, and close to the line joining them? `along` is
       * the distance down that ray, `gap` the perpendicular offset from it, and the fade only
       * applies while `0 < along < len` — strictly in front of the vehicle, which is what
       * "until it covers the aircraft" means.
       *
       * The cone is kept and is now exact rather than approximated. `uFadeRadius` is a screen
       * size, screen size is an angle, and a circle of radius R at the vehicle subtends the
       * same angle as R·along/len partway there. The old `(uCameraZ - z) / uCameraZ` was that
       * same ratio measured along z instead of along the ray, which is the on-axis special
       * case of this line.
       *
       * `cameraPosition` is three.js's own fragment uniform, so this needs no plumbing —
       * which is also why `uCameraZ` and the `cameraZ` argument that fed it are gone. The
       * shader can see the whole camera, not one component of it.
       */
      body +=
        '  if (vFadeWorld.z > uFrontZ) {\n' +
        '    vec3 toFocus = vec3(uFocus, 0.0) - cameraPosition;\n' +
        '    float len = max(length(toFocus), 1e-4);\n' +
        '    vec3 dir = toFocus / len;\n' +
        '    vec3 rel = vFadeWorld - cameraPosition;\n' +
        '    float along = dot(rel, dir);\n' +
        '    if (along > 0.0 && along < len) {\n' +
        '      float gap = length(rel - dir * along);\n' +
        '      float reach = uFadeRadius * (along / len);\n' +
        '      float near = mix(1.0, uFadeNear, uGate);\n' +
        '      gl_FragColor.a *= mix(near, 1.0, smoothstep(0.0, max(reach, 0.001), gap));\n' +
        '    }\n' +
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
 * Points every faded surface at the vehicle. Once a frame.
 *
 * It used to carry the camera's z as well, to convert the hole's screen size into a world
 * radius. The shader reads three.js's own `cameraPosition` now and works from the whole
 * camera rather than one component of it, which is what let the cone follow the actual
 * view ray instead of the z axis.
 */
export function setLanderFocus(x: number, y: number): void {
  // Closed over the mouth. Computed once here rather than per fragment — it is the same
  // number for every surface in the frame. See `FADE_GATE_BAND`.
  const gate = Math.min(1, Math.max(0, (CANYON.RIM_Y - y) / FADE_GATE_BAND));
  for (const material of faded) {
    const shader = material.userData.fade as Patched | undefined;
    if (!shader) continue;
    shader.uniforms.uFocus.value.set(x, y);
    shader.uniforms.uGate.value = gate;
  }
}

/** Drops the previous mission's materials. The owners dispose them; this only forgets the
 *  references, and it must run once per rebuild rather than once per thing rebuilt. */
export function forgetFadedMaterials(): void {
  faded.length = 0;
}
