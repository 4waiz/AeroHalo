import { NextResponse } from "next/server";
import { boardFetch, currentToken, offlinePayload } from "../config";

export const dynamic = "force-dynamic";

/** The board rejects anything else; mirroring the list here fails fast. */
const ALLOWED = new Set([
  "hold",
  "clear_after_inspection",
  "lamp_test",
  "clear_events",
]);

/**
 * POST /api/unoq/command -> board POST /api/command
 *
 * The controller token is attached here, server side, so it never reaches the
 * browser bundle or a screenshot. A 2xx from the board means the command was
 * QUEUED; only the MCU can confirm it was acted on, and the board says so in
 * the `note` it returns.
 */
export async function POST(req: Request) {
  let command: unknown;
  try {
    ({ command } = (await req.json()) as { command?: unknown });
  } catch {
    return NextResponse.json(
      { detail: "Malformed JSON body" },
      { status: 400 },
    );
  }

  if (typeof command !== "string" || !ALLOWED.has(command)) {
    return NextResponse.json({ detail: "Unknown command" }, { status: 400 });
  }

  // Re-read per command: the board mints a new token on every restart.
  const token = currentToken();
  if (!token) {
    return NextResponse.json(
      {
        detail:
          "No controller token. Run `npm run unoq:token` to capture the " +
          "current one from the board.",
      },
      { status: 503 },
    );
  }

  try {
    const res = await boardFetch(
      "/api/command",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ command }),
      },
      4000,
    );
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    return NextResponse.json(offlinePayload(err), { status: 503 });
  }
}
