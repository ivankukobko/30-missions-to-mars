import * as THREE from 'three';

/**
 * A blob shadow under the vehicle, because the real ones are not affordable here.
 *
 * The scene has one shadow-casting light and a shadow map sized for the vehicle, which is
 * enough for the lander to shade itself and nothing like enough to put a legible mark on
 * terrain a hundred metres wide. What a player actually needs from a shadow on final is
 * one thing — *how close am I to that surface* — and a drawn circle answers it better than
 * a correct shadow would at this resolution, because it is unambiguous at any sun angle.
 *
 * **It reads the ground sample the gear already used.** `update` takes the height and the
 * surface rather than looking them up, so the shadow, the legs and the exhaust dust are
 * all responding to one `groundBelow` call and cannot disagree about where the ground is.
 * A shadow sitting on a deck the gear had not noticed would be worse than no shadow.
 */

/**
 * How much wider the blob is at full reach than at touchdown.
 *
 * A real contact shadow tightens and darkens as the caster arrives, and that is the half of
 * the effect doing the work: the size change is legible in peripheral vision while the
 * player is looking at the horizon bar, where a brightness change alone is not.
 */
const SPREAD = 2.2;

/**
 * Clearance above the surface it is drawn on.
 *
 * Small, but it cannot be zero: the blob and the terrain are coplanar at zero and z-fight
 * across the whole disc. Well under the gear's own compression travel, so it cannot make a
 * touchdown look like a hover.
 */
const LIFT = 0.06;

/** Opacity at touchdown. */
const DEPTH = 0.55;

export class ContactShadow {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private texture: THREE.Texture;
  private radius: number;
  private reach: number;

  /**
   * @param radius Blob radius at touchdown, in world units.
   * @param reach  Drop beyond which nothing is drawn. See `Game`'s call for what sets it.
   */
  constructor(scene: THREE.Scene, radius: number, reach: number) {
    this.radius = radius;
    this.reach = reach;

    this.texture = ContactShadow.blobTexture();
    this.material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      // The falloff is *alpha*, not colour. Multiply blending was the first attempt and it
      // showed the quad: multiply needs its rim to be pure white to be the identity, and
      // the renderer's ACES tone mapping pulls white below 1 before the blend happens, so
      // every corner of the plane tinted the ground and the disc read as a lit square.
      // A black surface with a radial alpha map cannot do that — the rim is alpha 0, which
      // is identity no matter what the tone curve does to it.
      alphaMap: this.texture,
      transparent: true,
      depthWrite: false,
      // Nothing to tone map on a pure black fragment, and leaving it on lifts the shadow
      // towards grey at exactly the moment it is darkest.
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    // Flat on the ground plane. The camera runs about 15° above horizontal in cruise and
    // near 58° on final, so the disc is at its most readable exactly when it matters.
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Places the blob under a vehicle at `x`, given the surface below it and the drop to it.
   *
   * `ground` is `null` where nothing is underneath — over a shaft mouth, off the end of a
   * deck — and the blob simply goes away, which is the honest answer and also a usable
   * one: losing your shadow on approach means there is nothing there to land on.
   */
  update(x: number, ground: number | null, above: number): void {
    if (ground === null || above > this.reach || above < 0) {
      this.mesh.visible = false;
      return;
    }

    const t = above / this.reach; // 0 at touchdown, 1 at the edge of reach
    const scale = this.radius * 2 * (1 + (SPREAD - 1) * t);

    this.mesh.visible = true;
    this.mesh.position.set(x, ground + LIFT, 0);
    this.mesh.scale.set(scale, scale, 1);
    // Fades out rather than popping at the reach boundary: at `t = 1` this is exactly 0,
    // so the blob arrives and leaves the same way the gear does, without a visible edge to
    // the effect's own range.
    this.material.opacity = DEPTH * (1 - t);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  /**
   * The alpha falloff: opaque in the middle, transparent at the rim.
   *
   * Read as an alpha map, so white is "fully there" and black is "not there at all" —
   * which is what makes the plane's corners invisible without an alpha cutout.
   */
  private static blobTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context for the contact shadow.');

    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, '#ffffff');
    // Most of the falloff happens in the outer half, which is what gives a soft edge
    // rather than a hard disc with a feathered rim.
    grad.addColorStop(0.45, '#b4b4b4');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    // Linear, not sRGB: this is a mask rather than a colour, and decoding it as sRGB
    // bends the falloff curve into something much tighter than the gradient drawn here.
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  }
}
