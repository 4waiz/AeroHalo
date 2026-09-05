import { NextResponse } from "next/server";
import { boardFetch, offlinePayload } from "../config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/unoq/events -> board GET /api/events (full retained event log). */
export async function GET() {
  try {
    const res = await boardFetch("/api/events", {}, 4000);
    if (!res.ok) {
      return NextResponse.json(
        { error: "unoq_error", detail: `${res.status} ${res.statusText}` },
        { status: 502 }
      );
    }
    return NextResponse.json(await res.json(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(offlinePayload(err), { status: 503 });
  }
}
