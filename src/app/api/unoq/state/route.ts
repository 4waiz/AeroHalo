import { NextResponse } from "next/server";
import { boardFetch, offlinePayload } from "../config";

/** Never cache telemetry. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/unoq/state -> board GET /api/state
 *
 * Passes the board's payload through untouched. The dashboard is responsible
 * for interpreting nulls as UNAVAILABLE; this route must not invent defaults,
 * because a fabricated 0 cm here would show up as a real measurement upstream.
 */
export async function GET() {
  try {
    const res = await boardFetch("/api/state");
    if (!res.ok) {
      return NextResponse.json(
        { error: "unoq_error", detail: `${res.status} ${res.statusText}` },
        { status: 502 }
      );
    }
    const body = await res.json();
    return NextResponse.json(body, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(offlinePayload(err), { status: 503 });
  }
}
