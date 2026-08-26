import type { Vec2 } from "./types";

/* ------------------------------------------------------------------ */
/* Scalars                                                             */
/* ------------------------------------------------------------------ */

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number) =>
  a === b ? 0 : clamp((v - a) / (b - a), 0, 1);

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const easeInOutCubic = (t: number) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Shortest signed angular difference, in radians. */
export function angleDelta(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number) {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/* ------------------------------------------------------------------ */
/* Vectors (XZ plane)                                                  */
/* ------------------------------------------------------------------ */

export const v2 = (x: number, z: number): Vec2 => ({ x, z });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
export const len = (a: Vec2) => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a: Vec2, b: Vec2) =>
  (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.z);
  return l < 1e-9 ? { x: 0, z: 0 } : { x: a.x / l, z: a.z / l };
}

export function rotate(a: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c + a.z * s, z: -a.x * s + a.z * c };
}

/**
 * Heading convention: 0 rad faces -Z (the aircraft nose direction).
 * Positive rotation turns toward +X.
 */
export const headingToVec = (rad: number): Vec2 => ({
  x: Math.sin(rad),
  z: -Math.cos(rad),
});

export const vecToHeading = (v: Vec2) => Math.atan2(v.x, -v.z);

/* ------------------------------------------------------------------ */
/* Segments + polygons                                                 */
/* ------------------------------------------------------------------ */

/** Closest point on segment ab to p, plus the parametric position t in [0,1]. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  if (l2 < 1e-9) return { point: a, t: 0 };
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2;
  t = clamp(t, 0, 1);
  return { point: { x: a.x + abx * t, z: a.z + abz * t }, t };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const { point } = closestPointOnSegment(p, a, b);
  return dist(p, point);
}

/** Ray-cast point-in-polygon. Polygon is a closed loop of XZ points. */
export function pointInPolygon(p: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect =
      zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export const pointInAnyPolygon = (p: Vec2, polys: Vec2[][]) =>
  polys.some((poly) => pointInPolygon(p, poly));

/** Axis-aligned rectangle as a polygon. */
export function rectPoly(
  cx: number,
  cz: number,
  halfX: number,
  halfZ: number
): Vec2[] {
  return [
    { x: cx - halfX, z: cz - halfZ },
    { x: cx + halfX, z: cz - halfZ },
    { x: cx + halfX, z: cz + halfZ },
    { x: cx - halfX, z: cz + halfZ },
  ];
}

/** Trapezoid running along Z, widening from zA to zB. */
export function trapezoidPoly(
  zA: number,
  halfA: number,
  zB: number,
  halfB: number,
  cx = 0
): Vec2[] {
  return [
    { x: cx - halfA, z: zA },
    { x: cx + halfA, z: zA },
    { x: cx + halfB, z: zB },
    { x: cx - halfB, z: zB },
  ];
}

/**
 * Octagon with cut corners - reads like a marked operational boundary
 * rather than a plain rectangle.
 */
export function octagonPoly(
  halfX: number,
  zFront: number,
  zBack: number,
  cut: number
): Vec2[] {
  return [
    { x: -halfX + cut, z: zFront },
    { x: halfX - cut, z: zFront },
    { x: halfX, z: zFront + cut },
    { x: halfX, z: zBack - cut },
    { x: halfX - cut, z: zBack },
    { x: -halfX + cut, z: zBack },
    { x: -halfX, z: zBack - cut },
    { x: -halfX, z: zFront + cut },
  ];
}

/** Circular sector used for engine intake / exhaust hazard areas. */
export function sectorPoly(
  origin: Vec2,
  headingRad: number,
  radius: number,
  halfAngleRad: number,
  segments = 16
): Vec2[] {
  const pts: Vec2[] = [{ x: origin.x, z: origin.z }];
  for (let i = 0; i <= segments; i++) {
    const a = headingRad - halfAngleRad + (2 * halfAngleRad * i) / segments;
    const d = headingToVec(a);
    pts.push({ x: origin.x + d.x * radius, z: origin.z + d.z * radius });
  }
  return pts;
}

/** Uniformly scale a polygon about the origin. */
export const scalePoly = (poly: Vec2[], s: number): Vec2[] =>
  poly.map((p) => ({ x: p.x * s, z: p.z * s }));

/** Total length of a polyline. */
export function polylineLength(pts: Vec2[]) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/* ------------------------------------------------------------------ */
/* Deterministic pseudo-random                                         */
/* ------------------------------------------------------------------ */

/**
 * Small xorshift PRNG. The simulation seeds it so a reload reproduces the
 * same ambient behaviour instead of jittering between refreshes.
 */
export function makeRng(seed = 0x9e3779b9) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

export const randRange = (rng: () => number, a: number, b: number) =>
  a + rng() * (b - a);

export const pick = <T,>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
