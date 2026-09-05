import { NextResponse } from "next/server";
import { boardFetch, offlinePayload } from "../config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/unoq/frame -> board GET /api/frame
 *
 * Streams the latest OV7670 still through to the browser. Used only by the
 * camera tab, and only once the board reports `camera.state === "streaming"`,
 * so a 404 here while the camera is still being brought up is expected and is
 * not an error the operator needs to see.
 *
 * The image is passed through as bytes with no caching, so the browser cannot
 * show a stale frame as if it were current. Frame freshness itself is judged
 * from `camera.frame_age_s` in /api/state, not from this response.
 */
export async function GET() {
  try {
    const res = await boardFetch("/api/frame", {}, 4000);
    if (!res.ok) {
      return NextResponse.json(
        { error: "no_frame", detail: `${res.status} ${res.statusText}` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "image/jpeg",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(offlinePayload(err), { status: 503 });
  }
}
