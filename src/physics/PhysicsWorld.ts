/**
 * The collision world plus a swept-circle query.
 *
 * The game uses an instant-death contact model, so there is no impulse resolution
 * to get wrong — what matters is that the *first* contact along a frame's motion is
 * detected exactly. A naive "test the position after integrating" misses contacts
 * whenever the step exceeds the hull radius, which silently turns a crash into a
 * fall through the world. Everything here exists to make that impossible.
 *
 * The world has two tiers, and the split is about how each is indexed rather than
 * about what either one is:
 *
 *   - **Static** geometry — terrain, shaft linings, and every structure bolted to the
 *     rock — is bucketed on x once at insertion. There are hundreds to thousands of
 *     these and they never move, so an index earns its keep.
 *   - **Moving** geometry — cranes, travelling gantries, flying decks — is held in a
 *     flat list and scanned in full. There are only ever a handful, and a linear scan
 *     of twenty beats a hash lookup plus the cost of reindexing them every step. The
 *     bucket key is derived from x, so anything moving horizontally would invalidate
 *     its own index on every frame.
 *
 * Moving segments are treated as stationary *within* a substep — see `Kinematics.ts`
 * for the speed bound that makes that sound, and for the clock that keeps their motion
 * a pure function of mission time.
 */

export type SurfaceKind = 'rock' | 'pad' | 'structure';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: SurfaceKind;
  /** Set on pad segments so a mission can require a specific delivery target. */
  padId?: string;
}

export interface Hit {
  segment: Segment;
  /** Contact point on the segment. */
  px: number;
  py: number;
  /** Unit surface normal pointing away from the segment toward the body. */
  nx: number;
  ny: number;
  /** Position the body had reached when contact occurred. */
  bodyX: number;
  bodyY: number;
}

const BUCKET_SIZE = 8;

export class PhysicsWorld {
  gravity: number;
  private buckets = new Map<number, Segment[]>();
  private moving: Segment[] = [];

  constructor(gravity: number) {
    this.gravity = gravity;
  }

  clear(): void {
    this.buckets.clear();
    this.moving.length = 0;
  }

  /** Static geometry. Bucketed on x at insertion, so it must never move afterwards. */
  add(segment: Segment): void {
    const lo = Math.floor(Math.min(segment.x1, segment.x2) / BUCKET_SIZE);
    const hi = Math.floor(Math.max(segment.x1, segment.x2) / BUCKET_SIZE);
    for (let k = lo; k <= hi; k++) {
      let list = this.buckets.get(k);
      if (!list) {
        list = [];
        this.buckets.set(k, list);
      }
      list.push(segment);
    }
  }

  /**
   * Geometry that moves. Returns the stored segment so its owner can rewrite the
   * endpoints in place each step — there is no index to keep in sync.
   */
  addMoving(segment: Segment): Segment {
    this.moving.push(segment);
    return segment;
  }

  /** How many moving segments are live. The pass-through bound is checked against this. */
  get movingCount(): number {
    return this.moving.length;
  }

  /** Adds a connected run of points as a chain of segments. */
  addPolyline(points: { x: number; y: number }[], kind: SurfaceKind): void {
    for (let i = 0; i < points.length - 1; i++) {
      this.add({
        x1: points[i].x,
        y1: points[i].y,
        x2: points[i + 1].x,
        y2: points[i + 1].y,
        kind,
      });
    }
  }

  /** Adds the outline of an axis-aligned box (left, right, top, bottom). */
  addBox(cx: number, cy: number, halfW: number, halfH: number, kind: SurfaceKind): void {
    const l = cx - halfW;
    const r = cx + halfW;
    const b = cy - halfH;
    const t = cy + halfH;
    this.add({ x1: l, y1: b, x2: l, y2: t, kind });
    this.add({ x1: r, y1: b, x2: r, y2: t, kind });
    this.add({ x1: l, y1: t, x2: r, y2: t, kind });
    this.add({ x1: l, y1: b, x2: r, y2: b, kind });
  }

  /**
   * Visits every segment that could be within `radius` of x: the buckets spanning that
   * range, then all moving geometry.
   *
   * Walked in place rather than gathered into an array. The old version returned the
   * bucket's own array by reference whenever a query fell inside one bucket, which is a
   * mutation hazard waiting for its first caller, and allocated a fresh array otherwise.
   * A segment spanning two queried buckets is still visited twice; that is harmless
   * — both visits compute the same distance — and cheaper than deduplicating.
   */
  private forEachNear(minX: number, maxX: number, visit: (s: Segment) => void): void {
    const lo = Math.floor(minX / BUCKET_SIZE);
    const hi = Math.floor(maxX / BUCKET_SIZE);
    for (let k = lo; k <= hi; k++) {
      const list = this.buckets.get(k);
      if (list) for (const s of list) visit(s);
    }
    for (const s of this.moving) visit(s);
  }

  /** Circle-vs-segment test at one position, against static and moving geometry alike. */
  private probe(x: number, y: number, radius: number): Hit | null {
    let best: Hit | null = null;
    let bestDist = radius;

    this.forEachNear(x - radius, x + radius, (s) => {
      const ex = s.x2 - s.x1;
      const ey = s.y2 - s.y1;
      const len2 = ex * ex + ey * ey;

      let t = 0;
      if (len2 > 0) {
        t = ((x - s.x1) * ex + (y - s.y1) * ey) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
      }

      const px = s.x1 + t * ex;
      const py = s.y1 + t * ey;
      const dx = x - px;
      const dy = y - py;
      const dist = Math.hypot(dx, dy);

      if (dist < bestDist) {
        const inv = dist > 1e-6 ? 1 / dist : 0;
        bestDist = dist;
        best = {
          segment: s,
          px,
          py,
          nx: dx * inv,
          ny: dy * inv,
          bodyX: x,
          bodyY: y,
        };
      }
    });

    return best;
  }

  /**
   * Walks the motion from (x0,y0) to (x1,y1) in steps no larger than 40% of the
   * hull radius and returns the first contact. Bounded work: the step count scales
   * with distance travelled, and the fixed timestep bounds that.
   */
  sweep(x0: number, y0: number, x1: number, y1: number, radius: number): Hit | null {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.4)));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const hit = this.probe(x0 + dx * t, y0 + dy * t, radius);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Ground height directly below a point, for placement and HUD readouts.
   *
   * Moving geometry counts. A deck passing underneath really is the nearest surface,
   * and the gear deploying for it is the honest reading rather than a glitch.
   */
  groundBelow(x: number, fromY: number): number | null {
    let best: number | null = null;
    this.forEachNear(x - 0.1, x + 0.1, (s) => {
      const lo = Math.min(s.x1, s.x2);
      const hi = Math.max(s.x1, s.x2);
      if (x < lo || x > hi) return;
      const span = s.x2 - s.x1;
      const t = Math.abs(span) < 1e-6 ? 0 : (x - s.x1) / span;
      const y = s.y1 + t * (s.y2 - s.y1);
      if (y <= fromY && (best === null || y > best)) best = y;
    });
    return best;
  }
}
