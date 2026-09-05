/**
 * Server-side configuration for reaching the Arduino UNO Q.
 *
 * Nothing here is exposed to the browser. The board URL and the controller
 * token stay on the Next.js server, and the browser only ever sees the
 * same-origin /api/unoq/* routes.
 *
 * AEROHALO_UNOQ_URL   base URL of the App Lab web_ui service on the board.
 *                     Default assumes the adb port forward set up by
 *                     `scripts/unoq-link.mjs` (adb forward tcp:7000 tcp:7000),
 *                     which is the transport that actually works: the campus
 *                     Wi-Fi isolates clients, so the board's own LAN address
 *                     is not reachable from this laptop.
 *
 * AEROHALO_UNOQ_TOKEN controller token printed by the board application on
 *                     every start. Required only for POST /api/command.
 *                     It rotates on each app restart, so it is read from the
 *                     environment and never committed.
 */

export const UNOQ_URL = (
  process.env.AEROHALO_UNOQ_URL ?? "http://127.0.0.1:7000"
).replace(/\/+$/, "");

export const UNOQ_TOKEN = process.env.AEROHALO_UNOQ_TOKEN ?? "";

/** Upstream timeout. Kept short so a dead board fails fast and visibly. */
export const UPSTREAM_TIMEOUT_MS = 2500;

export async function boardFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = UPSTREAM_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${UNOQ_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Uniform shape for "the board is not reachable", so the UI can say so. */
export function offlinePayload(err: unknown) {
  return {
    error: "unoq_unreachable",
    detail: err instanceof Error ? err.message : String(err),
    url: UNOQ_URL,
  };
}
