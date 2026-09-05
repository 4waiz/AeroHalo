/**
 * Browser-side client for the UNO Q telemetry service.
 *
 * The browser never talks to the board directly. It calls same-origin
 * /api/unoq/* routes, which proxy to AEROHALO_UNOQ_URL on the server. That
 * keeps the controller token out of the client bundle and avoids CORS
 * entirely, which matters because the board is reached over an adb port
 * forward rather than a routable address.
 */

import type { LivePollResult, UnoQEvent, UnoQState } from "./types";

/** Anything older than this is reported as stale rather than current. */
export const STALE_AFTER_MS = 1500;
/** Past this we stop claiming a link at all. */
export const OFFLINE_AFTER_MS = 4000;

async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One telemetry poll.
 *
 * Never throws: a failed poll is a result with link "offline" and an error
 * string, because a dashboard that crashes on a unplugged cable is worse than
 * one that says the cable is unplugged.
 */
export async function pollState(timeoutMs = 2000): Promise<LivePollResult> {
  const started = performance.now();
  try {
    const state = await getJson<UnoQState>("/api/unoq/state", timeoutMs);
    const fetchMs = Math.round(performance.now() - started);

    // The board's own age measurement decides freshness. `connected` alone is
    // not enough: the service can be up while the MCU has gone quiet.
    const ageMs =
      state.telemetry_age_s === null ? Infinity : state.telemetry_age_s * 1000;

    let link: LivePollResult["link"];
    if (!state.hardware_connected || ageMs >= OFFLINE_AFTER_MS)
      link = "offline";
    else if (ageMs >= STALE_AFTER_MS) link = "stale";
    else link = "online";

    return { state, link, fetchMs, error: null, at: Date.now() };
  } catch (err) {
    return {
      state: null,
      link: "offline",
      fetchMs: null,
      error: err instanceof Error ? err.message : String(err),
      at: Date.now(),
    };
  }
}

export async function fetchEvents(
  timeoutMs = 3000,
): Promise<{ events: UnoQEvent[]; storage: string } | null> {
  try {
    return await getJson<{ events: UnoQEvent[]; storage: string }>(
      "/api/unoq/events",
      timeoutMs,
    );
  } catch {
    return null;
  }
}

export type UnoQCommand =
  "hold" | "clear_after_inspection" | "lamp_test" | "clear_events";

export interface CommandResult {
  ok: boolean;
  /** Board wording, e.g. "Queued, not yet confirmed by hardware". */
  note: string;
}

/**
 * Sends an operator command. The board queues commands and only the MCU can
 * confirm them, so a successful POST means "accepted", never "done".
 */
export async function sendCommand(
  command: UnoQCommand,
  timeoutMs = 4000,
): Promise<CommandResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("/api/unoq/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command }),
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => ({}))) as {
      note?: string;
      detail?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        note: body.detail ?? `${res.status} ${res.statusText}`,
      };
    }
    return { ok: true, note: body.note ?? "Queued on the board" };
  } catch (err) {
    return {
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
