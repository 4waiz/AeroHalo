import type {
  Aircraft,
  CollisionPrediction,
  GroundVehicle,
  Route,
  Severity,
  Vec2,
} from "./types";
import {
  HULL_BUFFER,
  PREDICT_HORIZON,
  PREDICT_STEPS,
  TTC_CAUTION,
  TTC_CRITICAL,
  TTC_HIGH,
} from "./constants";
import {
  clamp,
  closestPointOnSegment,
  dist,
  headingToVec,
  vecToHeading,
} from "./geometry";

/**
 * Forward-integrates every ground vehicle and finds the first moment its
 * footprint would breach the aircraft hull.
 *
 * This is prediction, not detection: the vehicle is propagated along the route
 * it is actually steering (falling back to its current heading when it has no
 * route), and the hull is a set of capsules taken from the airframe definition,
 * so the answer names the part at risk - "Left Wing", "Right Engine" - rather
 * than just reporting a proximity number.
 */
export class CollisionPredictionEngine {
  /** Distance from a point to the aircraft hull, plus the nearest part. */
  static hullDistance(p: Vec2, aircraft: Aircraft) {
    let best = Infinity;
    let part = "Fuselage";
    let weight = 1;
    for (const c of aircraft.parts) {
      const { point } = closestPointOnSegment(p, c.a, c.b);
      const d = dist(p, point) - c.r;
      if (d < best) {
        best = d;
        part = c.name;
        weight = c.severityWeight;
      }
    }
    return { distance: best, part, weight };
  }

  /**
   * Samples the vehicle forward in time. When a route is supplied the vehicle
   * is walked along the remaining waypoints, which is what actually happens
   * next - a straight-line extrapolation would badly mispredict a turn.
   */
  static predictPath(
    v: GroundVehicle,
    route: Route | undefined,
    horizon = PREDICT_HORIZON,
    steps = PREDICT_STEPS
  ): { path: Vec2[]; times: number[] } {
    const path: Vec2[] = [];
    const times: number[] = [];
    const dt = horizon / steps;

    // Vehicles that are stopped still get a short stub so the UI has an anchor.
    const speed = v.speed;
    let pos: Vec2 = { x: v.position.x, z: v.position.z };
    let heading = v.headingRad;
    let wp = v.waypoint;

    for (let i = 0; i <= steps; i++) {
      path.push({ x: pos.x, z: pos.z });
      times.push(i * dt);
      if (speed < 0.05) continue;

      let remaining = speed * dt;
      // Walk along the route for this timestep.
      while (remaining > 0) {
        let target: Vec2;
        if (route && wp < route.points.length) {
          target = route.points[wp];
        } else {
          const dir = headingToVec(heading);
          target = { x: pos.x + dir.x * remaining, z: pos.z + dir.z * remaining };
        }
        const d = dist(pos, target);
        if (d <= remaining && route && wp < route.points.length) {
          pos = { x: target.x, z: target.z };
          remaining -= d;
          if (wp + 1 < route.points.length) {
            heading = vecToHeading({
              x: route.points[wp + 1].x - pos.x,
              z: route.points[wp + 1].z - pos.z,
            });
            wp += 1;
          } else if (route.loop) {
            wp = 0;
          } else {
            remaining = 0; // end of a one-shot route
          }
        } else {
          const t = d < 1e-6 ? 0 : remaining / d;
          pos = { x: pos.x + (target.x - pos.x) * t, z: pos.z + (target.z - pos.z) * t };
          remaining = 0;
        }
      }
    }
    return { path, times };
  }

  static levelForTtc(ttc: number | null, dcpa: number, radius: number): Severity {
    if (ttc !== null) {
      if (ttc <= TTC_CRITICAL) return "critical";
      if (ttc <= TTC_HIGH) return "high";
      if (ttc <= TTC_CAUTION) return "medium";
      return "low";
    }
    if (dcpa < radius + 2.5) return "medium";
    if (dcpa < radius + 7) return "low";
    return "info";
  }

  /**
   * Full prediction for one vehicle.
   * Returns null when the vehicle is far away and closing slowly, so the
   * dashboard is not flooded with meaningless tracks.
   */
  static predict(
    v: GroundVehicle,
    aircraft: Aircraft,
    route: Route | undefined
  ): CollisionPrediction | null {
    const radius = Math.max(v.size.l, v.size.w) * 0.5;
    const now = CollisionPredictionEngine.hullDistance(v.position, aircraft);
    const currentGap = now.distance - radius;

    // Below this speed the vehicle is parked, not closing: a stationary
    // service vehicle sitting at its working position must not read as an
    // imminent strike just because it is near the airframe.
    const closing = v.speed > 0.15;

    const { path, times } = CollisionPredictionEngine.predictPath(v, route);

    let dcpa = Infinity;
    let tcpa = 0;
    let part = now.part;
    let weight = now.weight;
    let ttc: number | null = null;

    for (let i = 0; i < path.length; i++) {
      const h = CollisionPredictionEngine.hullDistance(path[i], aircraft);
      const gap = h.distance - radius;
      if (gap < dcpa) {
        dcpa = gap;
        tcpa = times[i];
        part = h.part;
        weight = h.weight;
      }
      if (closing && ttc === null && gap <= HULL_BUFFER) {
        // Refine between the previous sample and this one.
        if (i === 0) ttc = 0;
        else {
          const prev = CollisionPredictionEngine.hullDistance(path[i - 1], aircraft).distance - radius;
          const span = prev - gap;
          const frac = span <= 1e-6 ? 0 : (prev - HULL_BUFFER) / span;
          ttc = times[i - 1] + (times[i] - times[i - 1]) * clamp(frac, 0, 1);
        }
      }
    }

    // Not a track worth reporting. Without a predicted breach the vehicle has
    // to be close before it earns a place on the operator's screen.
    if (ttc === null && dcpa > radius + 10) return null;

    const level = CollisionPredictionEngine.levelForTtc(ttc, dcpa, radius);
    const risk = CollisionPredictionEngine.riskFor({
      ttc,
      dcpa,
      distance: currentGap,
      speed: v.speed,
      weight,
      zoneSeverity: 0,
    });

    // Trim the drawn trajectory at the impact point so the dashed line stops
    // where the prediction says the vehicle would strike the airframe.
    let drawn = path;
    if (ttc !== null) {
      const cut = Math.max(2, Math.ceil((ttc / PREDICT_HORIZON) * PREDICT_STEPS) + 1);
      drawn = path.slice(0, Math.min(path.length, cut));
    } else {
      const cut = Math.max(2, Math.ceil((Math.min(tcpa + 1.5, PREDICT_HORIZON) / PREDICT_HORIZON) * PREDICT_STEPS));
      drawn = path.slice(0, Math.min(path.length, cut));
    }

    return {
      ttc,
      dcpa: Math.max(0, dcpa),
      tcpa,
      distance: Math.max(0, currentGap),
      part,
      path: drawn,
      risk,
      level,
    };
  }

  /**
   * 0..10 hazard rating for a single vehicle interaction.
   * Blends how soon (TTC), how close (DCPA + current gap), how fast, and how
   * badly the threatened part would be damaged.
   */
  static riskFor(o: {
    ttc: number | null;
    dcpa: number;
    distance: number;
    speed: number;
    weight: number;
    zoneSeverity: number;
  }): number {
    let r = 0;

    if (o.ttc !== null) {
      // 3 s -> ~6.4, 0 s -> 8.0, 14 s -> ~2.2
      r += clamp(8 - o.ttc * 0.52, 1.6, 8);
    } else {
      r += clamp(3.4 - o.dcpa * 0.16, 0, 3.4);
    }

    // Proximity term: full weight inside 4 m, fading out by 28 m.
    r += clamp((28 - o.distance) / 28, 0, 1) * 2.1;

    // Closing speed matters - a crawling tug is not the same threat.
    r += clamp(o.speed / 6, 0, 1) * 1.25;

    r += o.zoneSeverity * 0.32;

    // Hitting an engine or a wing is worse than brushing the fuselage.
    r *= 0.82 + o.weight * 0.18;

    return clamp(r, 0, 10);
  }
}
