import type { EngineHazardZone, SafetyZone, Vec2, ZoneId } from "./types";
import type { Airframe } from "./aircraftTypes";
import {
  buildEngineZones,
  buildZones,
  exhaustSectorPoly,
  intakeSectorPoly,
} from "./constants";
import { dist, pointInAnyPolygon, pointInPolygon } from "./geometry";

/**
 * Owns the painted safety areas around the aircraft and answers
 * "what zone is this point in?" for every tracked object each tick.
 */
export class ZoneManager {
  zones: SafetyZone[] = [];
  engineZones: EngineHazardZone[] = [];
  /** Cached polygons for the live engine hazard areas. */
  intakePolys: Record<"left" | "right", Vec2[]> = { left: [], right: [] };
  exhaustPolys: Record<"left" | "right", Vec2[]> = { left: [], right: [] };

  private af!: Airframe;

  constructor(af: Airframe) {
    this.setAirframe(af);
  }

  setAirframe(af: Airframe) {
    this.af = af;
    this.zones = buildZones(af);
    this.updateEngines(0, false);
  }

  get airframe() {
    return this.af;
  }

  /** Recomputes the engine hazard geometry for the current spool factor. */
  updateEngines(spool: number, running: boolean) {
    this.engineZones = buildEngineZones(this.af, spool, running);
    for (const z of this.engineZones) {
      this.intakePolys[z.side] = intakeSectorPoly(this.af, z.side, z.intakeRadius);
      this.exhaustPolys[z.side] = exhaustSectorPoly(
        this.af,
        z.side,
        z.exhaustLength,
        z.exhaustHalfAngleRad
      );
    }
  }

  zoneOf(p: Vec2): ZoneId | null {
    const critical = this.zones.find((z) => z.id === "critical");
    if (critical && pointInAnyPolygon(p, critical.polys)) return "critical";
    const caution = this.zones.find((z) => z.id === "caution");
    if (caution && pointInPolygon(p, caution.polys[0])) return "caution";
    const safe = this.zones.find((z) => z.id === "safe");
    if (safe && pointInPolygon(p, safe.polys[0])) return "safe";
    return null;
  }

  severityOf(zone: ZoneId | null): number {
    if (!zone) return 0;
    if (zone === "engine") return 5.2;
    return this.zones.find((z) => z.id === zone)?.severity ?? 0;
  }

  /** True when the point sits inside a live intake or blast area. */
  inEngineHazard(p: Vec2): { hit: boolean; side: "left" | "right" | null; kind: "intake" | "blast" | null } {
    for (const z of this.engineZones) {
      if (!z.active) continue;
      if (dist(p, z.origin) <= z.intakeRadius && pointInPolygon(p, this.intakePolys[z.side])) {
        return { hit: true, side: z.side, kind: "intake" };
      }
      if (pointInPolygon(p, this.exhaustPolys[z.side])) {
        return { hit: true, side: z.side, kind: "blast" };
      }
    }
    return { hit: false, side: null, kind: null };
  }

  /** The aircraft movement area - debris here blocks the clearance. */
  inMovementArea(p: Vec2) {
    const critical = this.zones.find((z) => z.id === "critical");
    return critical ? pointInAnyPolygon(p, critical.polys) : false;
  }

  /**
   * Fraction of the painted boundary that is currently unbreached, shown on
   * the dashboard as "Zone Integrity".
   */
  integrity(breaches: { zone: ZoneId | null; weight: number }[]): number {
    let penalty = 0;
    for (const b of breaches) {
      if (b.zone === "critical") penalty += 7.5 * b.weight;
      else if (b.zone === "engine") penalty += 9 * b.weight;
      else if (b.zone === "caution") penalty += 2.2 * b.weight;
    }
    return Math.max(38, Math.round(100 - penalty));
  }
}
