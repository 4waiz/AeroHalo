import type { Hazard, HeatCell, SafetyStatus, Severity, Vec2 } from "./types";
import type { Airframe } from "./aircraftTypes";
import { HEAT_COLS, HEAT_DECAY, HEAT_ROWS } from "./constants";
import { clamp, damp } from "./geometry";

/**
 * Turns the live hazard list into the single 0-100 number the dashboard leads
 * with, plus the overall safety status and the risk heatmap.
 *
 * The score is deliberately dominated by the worst single hazard - one vehicle
 * three seconds from a wing strike is an emergency regardless of how quiet the
 * rest of the apron is - with a bounded contribution from everything else so
 * that simultaneous minor hazards still push the number up.
 */
export class RiskEngine {
  /** Smoothed score so the gauge sweeps instead of snapping. */
  private smoothed = 0;
  private heat: Float32Array;
  private af: Airframe;

  constructor(af: Airframe) {
    this.af = af;
    this.heat = new Float32Array(HEAT_COLS * HEAT_ROWS);
  }

  setAirframe(af: Airframe) {
    this.af = af;
    this.heat.fill(0);
  }

  reset() {
    this.smoothed = 0;
    this.heat.fill(0);
  }

  /** Raw, unsmoothed aggregate of the current hazards. */
  static aggregate(hazards: Hazard[], ambient: number): number {
    if (hazards.length === 0) return clamp(ambient, 0, 100);

    const sorted = [...hazards].sort((a, b) => b.risk - a.risk);
    const peak = sorted[0].risk;

    // Everything after the worst hazard contributes with diminishing returns.
    let secondary = 0;
    for (let i = 1; i < sorted.length; i++) {
      secondary += sorted[i].risk * Math.pow(0.62, i - 1);
    }

    // Tuned so a 9.1 / 7.6 / 5.4 hazard set lands at ~72, matching the
    // operational banding the dashboard was specified against.
    const peakTerm = peak * 6.4;
    const secondaryTerm = Math.min(secondary * 1.05, 16);
    const countTerm = Math.min((sorted.length - 1) * 1.2, 5);

    return clamp(peakTerm + secondaryTerm + countTerm + ambient, 0, 100);
  }

  update(hazards: Hazard[], ambient: number, dt: number): number {
    const target = RiskEngine.aggregate(hazards, ambient);
    // Rise fast, fall slow - matches how an operator expects an alarm to behave.
    const lambda = target > this.smoothed ? 5.5 : 1.5;
    this.smoothed = damp(this.smoothed, target, lambda, dt);
    return this.smoothed;
  }

  get score() {
    return this.smoothed;
  }

  static statusFor(score: number, hazards: Hazard[]): SafetyStatus {
    // An imminent strike overrides the score outright - there is no useful
    // "moderate" reading two seconds before a wing is hit.
    const imminent = hazards.some(
      (h) => h.source === "collision" && h.ttc != null && h.ttc <= 2.2
    );
    if (imminent || score >= 80) return "CRITICAL";
    if (score >= 32 || hazards.some((h) => h.level === "high")) return "CAUTION";
    return "SAFE";
  }

  static labelFor(score: number): string {
    if (score >= 78) return "Severe Risk";
    if (score >= 60) return "High Risk";
    if (score >= 38) return "Elevated Risk";
    if (score >= 18) return "Moderate Risk";
    return "Low Risk";
  }

  static severityRank(s: Severity): number {
    switch (s) {
      case "critical":
        return 4;
      case "high":
        return 3;
      case "medium":
        return 2;
      case "low":
        return 1;
      default:
        return 0;
    }
  }

  /* ---------------- heatmap ---------------- */

  /** Footprint the heatmap covers, in world metres. */
  private extents() {
    const e = this.af.envelope;
    const pad = 7 * this.af.worldScale;
    return {
      minX: -(e.halfSpan + pad),
      maxX: e.halfSpan + pad,
      minZ: e.noseZ - pad,
      maxZ: e.tailZ + pad,
    };
  }

  worldToCell(p: Vec2) {
    const ex = this.extents();
    const u = (p.x - ex.minX) / (ex.maxX - ex.minX);
    const v = (p.z - ex.minZ) / (ex.maxZ - ex.minZ);
    return { u, v };
  }

  /** Deposits heat at a world position with a soft radial falloff. */
  deposit(p: Vec2, amount: number, radiusCells = 2.4) {
    const { u, v } = this.worldToCell(p);
    if (u < -0.2 || u > 1.2 || v < -0.2 || v > 1.2) return;
    const cx = u * (HEAT_COLS - 1);
    const cy = v * (HEAT_ROWS - 1);
    const r = Math.ceil(radiusCells);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(HEAT_ROWS - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(HEAT_COLS - 1, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > radiusCells) continue;
        const falloff = 1 - d / radiusCells;
        const i = y * HEAT_COLS + x;
        this.heat[i] = Math.min(1, this.heat[i] + amount * falloff * falloff);
      }
    }
  }

  decay(dt: number) {
    const k = Math.exp(-HEAT_DECAY * dt);
    for (let i = 0; i < this.heat.length; i++) this.heat[i] *= k;
  }

  /** Sparse snapshot for the heatmap card - only cells with visible heat. */
  heatCells(threshold = 0.035): HeatCell[] {
    const out: HeatCell[] = [];
    for (let y = 0; y < HEAT_ROWS; y++) {
      for (let x = 0; x < HEAT_COLS; x++) {
        const v = this.heat[y * HEAT_COLS + x];
        if (v > threshold) {
          out.push({ u: x / (HEAT_COLS - 1), v: y / (HEAT_ROWS - 1), intensity: v });
        }
      }
    }
    return out;
  }
}
