import type { SafetyEvent, Severity, TrackedKind } from "./types";
import { MAX_EVENTS } from "./constants";

/**
 * Append-only safety log. Everything the operator sees in the timeline comes
 * from here, newest first, and every entry carries the object it refers to so
 * clicking a row can focus the 3D scene on it.
 */
export class EventLogger {
  private events: SafetyEvent[] = [];
  private seq = 0;
  /** Suppresses duplicate spam: key -> sim time it was last logged. */
  private lastLogged = new Map<string, number>();

  log(
    clock: number,
    level: Severity,
    message: string,
    location: string,
    target?: { id: string; kind: TrackedKind },
    /** Same dedupe key within this many ms is dropped. */
    dedupeKey?: string,
    dedupeMs = 6000
  ): SafetyEvent | null {
    if (dedupeKey) {
      const last = this.lastLogged.get(dedupeKey);
      if (last !== undefined && clock - last < dedupeMs) return null;
      this.lastLogged.set(dedupeKey, clock);
    }

    const ev: SafetyEvent = {
      id: `EV-${++this.seq}`,
      timestamp: clock,
      level,
      message,
      location,
      targetId: target?.id,
      targetKind: target?.kind,
    };
    this.events.unshift(ev);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
    return ev;
  }

  list(limit?: number): SafetyEvent[] {
    return limit ? this.events.slice(0, limit) : this.events;
  }

  get count() {
    return this.events.length;
  }

  clear() {
    this.events = [];
    this.lastLogged.clear();
  }
}
