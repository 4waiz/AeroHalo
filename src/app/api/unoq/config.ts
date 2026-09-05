import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-side configuration for reaching the Arduino UNO Q.
 *
 * Nothing here is exposed to the browser. The board URL and the controller
 * token stay on the Next.js server, and the browser only ever sees the
 * same-origin /api/unoq/* routes.
 *
 * AEROHALO_UNOQ_URL   base URL of the App Lab web_ui service on the board.
 *                     Defaults to the adb port forward set up by
 *                     `npm run unoq:link`, which is the transport that actually
 *                     works: the venue Wi-Fi isolates clients, so the board's
 *                     own LAN address is unreachable from this laptop.
 */

export const UNOQ_URL = (
  process.env.AEROHALO_UNOQ_URL ?? "http://127.0.0.1:7000"
).replace(/\/+$/, "");

/** Upstream timeout. Kept short so a dead board fails fast and visibly. */
export const UPSTREAM_TIMEOUT_MS = 2500;

/**
 * The controller token, re-read on every command.
 *
 * The board mints a NEW token every time its application starts, and it
 * restarts whenever the board reboots or the firmware is reflashed. Next.js
 * reads process.env once at startup, so a token captured then goes stale the
 * first time the board restarts and every operator command 401s until the dev
 * server is restarted too - which is a miserable thing to discover mid-demo.
 *
 * Reading .env.local per command costs nothing at this rate and means
 * `npm run unoq:token` is enough to recover, with no restart.
 */
export function currentToken(): string {
  // Environment wins when it is set explicitly, e.g. in production.
  const fromEnv = process.env.AEROHALO_UNOQ_TOKEN;
  if (fromEnv) return fromEnv;

  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const line = raw
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith("AEROHALO_UNOQ_TOKEN="));
    return line ? line.slice(line.indexOf("=") + 1).trim() : "";
  } catch {
    return "";
  }
}

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
