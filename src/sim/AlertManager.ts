import type { Alert, Hazard, Severity } from "./types";
import { MAX_ALERTS } from "./constants";
import { RiskEngine } from "./RiskEngine";

/** How long a resolved alert lingers on the panel before it is removed. */
const RESOLVE_LINGER_MS = 4200;
/** A hazard must persist this long before it is promoted to an alert card. */
const PROMOTE_DELAY_MS = 260;

/**
 * Converts the continuously recomputed hazard list into stable alert cards.
 *
 * Hazards are recreated from scratch every tick; alerts are not. An alert is
 * keyed to its hazard so the card keeps its identity (and its entrance
 * animation) while its numbers update live, and it fades out rather than
 * vanishing when the hazard clears.
 */
export class AlertManager {
  private alerts = new Map<string, Alert>();
  private firstSeen = new Map<string, number>();
  private seq = 0;

  /** Fires when a new alert card appears, so audio and the log can react. */
  onRaise?: (alert: Alert) => void;
  /** Fires when a hazard clears. */
  onResolve?: (alert: Alert) => void;
  /** Fires when an existing alert escalates to a higher severity. */
  onEscalate?: (alert: Alert, from: Severity) => void;

  sync(hazards: Hazard[], clock: number) {
    const live = new Set(hazards.map((h) => h.id));

    for (const h of hazards) {
      const seen = this.firstSeen.get(h.id);
      if (seen === undefined) {
        this.firstSeen.set(h.id, clock);
        continue;
      }
      if (clock - seen < PROMOTE_DELAY_MS) continue;

      const existing = this.alerts.get(h.id);
      if (!existing) {
        const alert: Alert = {
          id: `AL-${++this.seq}`,
          hazardId: h.id,
          level: h.level,
          title: h.title,
          location: h.location,
          detail: h.detail,
          risk: h.risk,
          ttc: h.ttc,
          targetId: h.targetId,
          targetKind: h.targetKind,
          timestamp: clock,
          acknowledged: false,
          resolvedAt: null,
        };
        this.alerts.set(h.id, alert);
        this.onRaise?.(alert);
      } else {
        const prevLevel = existing.level;
        existing.title = h.title;
        existing.location = h.location;
        existing.detail = h.detail;
        existing.risk = h.risk;
        existing.ttc = h.ttc;
        existing.level = h.level;
        if (existing.resolvedAt !== null) {
          // Hazard came back before the card finished fading.
          existing.resolvedAt = null;
          existing.timestamp = clock;
        }
        if (RiskEngine.severityRank(h.level) > RiskEngine.severityRank(prevLevel)) {
          this.onEscalate?.(existing, prevLevel);
        }
      }
    }

    // Mark anything whose hazard disappeared, then drop it once it has faded.
    for (const [hazardId, alert] of this.alerts) {
      if (!live.has(hazardId)) {
        if (alert.resolvedAt === null) {
          alert.resolvedAt = clock;
          this.onResolve?.(alert);
        } else if (clock - alert.resolvedAt > RESOLVE_LINGER_MS) {
          this.alerts.delete(hazardId);
          this.firstSeen.delete(hazardId);
        }
      }
    }

    for (const id of this.firstSeen.keys()) {
      if (!live.has(id) && !this.alerts.has(id)) this.firstSeen.delete(id);
    }
  }

  /** Highest severity first, then highest risk, then newest. */
  list(): Alert[] {
    return [...this.alerts.values()]
      .sort((a, b) => {
        const sa = RiskEngine.severityRank(a.level);
        const sb = RiskEngine.severityRank(b.level);
        if (sa !== sb) return sb - sa;
        if (Math.abs(a.risk - b.risk) > 0.05) return b.risk - a.risk;
        return b.timestamp - a.timestamp;
      })
      .slice(0, MAX_ALERTS);
  }

  /** Cards that are still live (used for the notification badge). */
  activeCount(): number {
    let n = 0;
    for (const a of this.alerts.values()) if (a.resolvedAt === null) n++;
    return n;
  }

  highPriorityCount(): number {
    let n = 0;
    for (const a of this.alerts.values()) {
      if (a.resolvedAt === null && (a.level === "critical" || a.level === "high")) n++;
    }
    return n;
  }

  acknowledge(alertId: string) {
    for (const a of this.alerts.values()) {
      if (a.id === alertId) a.acknowledged = true;
    }
  }

  clear() {
    this.alerts.clear();
    this.firstSeen.clear();
  }
}
