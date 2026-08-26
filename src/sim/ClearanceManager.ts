import type { ClearanceStatus, Hazard } from "./types";

/**
 * Decides whether the aircraft is cleared to operate.
 *
 * HOLD is latched with a short dwell: once a critical hazard forces a hold the
 * state will not flick straight back to CLEAR the instant the hazard clears,
 * because a controller would not release a stand that fast either.
 */
export class ClearanceManager {
  status: ClearanceStatus = "CLEAR";
  reason = "All safety zones clear";
  /** Sim clock at which the current status was entered. */
  changedAt = 0;

  private holdUntil = 0;

  /** Minimum time a HOLD is kept, ms. */
  private static HOLD_DWELL = 3200;

  evaluate(hazards: Hazard[], clock: number): { changed: boolean; from: ClearanceStatus } {
    const from = this.status;

    const critical = hazards.filter((h) => h.level === "critical");
    const high = hazards.filter((h) => h.level === "high");
    const medium = hazards.filter((h) => h.level === "medium");

    let next: ClearanceStatus;
    let reason: string;

    if (critical.length > 0) {
      next = "HOLD";
      reason = ClearanceManager.reasonFor(critical[0]);
      this.holdUntil = clock + ClearanceManager.HOLD_DWELL;
    } else if (high.length > 0) {
      // A high-severity hazard inside the movement area also stops the aircraft.
      const blocking = high.find(
        (h) => h.source === "fod" || h.source === "intrusion" || h.risk >= 7.4
      );
      if (blocking) {
        next = "HOLD";
        reason = ClearanceManager.reasonFor(blocking);
        this.holdUntil = clock + ClearanceManager.HOLD_DWELL;
      } else {
        next = "CAUTION";
        reason = ClearanceManager.reasonFor(high[0]);
      }
    } else if (medium.length > 0) {
      next = "CAUTION";
      reason = ClearanceManager.reasonFor(medium[0]);
    } else {
      next = "CLEAR";
      reason = "All safety zones clear";
    }

    // Honour the latch.
    if (next !== "HOLD" && clock < this.holdUntil) {
      next = "HOLD";
      reason = this.reason;
    }

    if (next !== this.status) {
      this.status = next;
      this.reason = reason;
      this.changedAt = clock;
      return { changed: true, from };
    }
    this.reason = reason;
    return { changed: false, from };
  }

  private static reasonFor(h: Hazard): string {
    switch (h.source) {
      case "collision":
        return `Predicted conflict – ${h.title}`;
      case "fod":
        return "Debris inside aircraft movement area";
      case "intrusion":
        return "Personnel inside restricted area";
      case "engine":
        return "Engine hazard area breached";
      default:
        return h.title;
    }
  }

  /** Label used on the clearance chip in the monitoring view. */
  get chipLabel(): string {
    switch (this.status) {
      case "CLEAR":
        return "AIRCRAFT CLEAR";
      case "CAUTION":
        return "PUSHBACK CAUTION";
      case "HOLD":
        return "PUSHBACK HOLD";
    }
  }

  reset(clock: number) {
    this.status = "CLEAR";
    this.reason = "All safety zones clear";
    this.changedAt = clock;
    this.holdUntil = 0;
  }
}
