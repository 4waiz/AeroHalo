import { NextResponse } from "next/server";
import { UNOQ_TOKEN, boardFetch, offlinePayload } from "../config";

export const dynamic = "force-dynamic";

/** The board rejects anything else; mirroring the list here fails fast. */
const ALLOWED = new Set(["hold", "clear_after_inspection"]);

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
    return NextResponse.json({ detail: "Malformed JSON body" }, { status: 400 });
  }

  if (typeof command !== "string" || !ALLOWED.has(command)) {
    return NextResponse.json({ detail: "Unknown command" }, { status: 400 });
  }

  if (!UNOQ_TOKEN) {
    return NextResponse.json(
      {
        detail:
          "AEROHALO_UNOQ_TOKEN is not set on the server. Read the controller " +
          "token from the board application log and put it in .env.local.",
      },
      { status: 503 }
    );
  }

  try {
    const res = await boardFetch(
      "/api/command",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${UNOQ_TOKEN}`,
        },
        body: JSON.stringify({ command }),
      },
      4000
    );
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    return NextResponse.json(offlinePayload(err), { status: 503 });
  }
}
