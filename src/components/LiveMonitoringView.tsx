"use client";

import { useState } from "react";
import { CameraOff, Radar, Video } from "lucide-react";
import { Panel } from "./ui";
import { cameraSummary, useLive } from "@/live/liveStore";

/**
 * LIVE HARDWARE centre view.
 *
 * Two tabs:
 *   RANGE BEAM  a truthful picture of what an HC-SR04 actually knows, which is
 *               one distance along one axis. It is drawn as a corridor with the
 *               configured boundaries, not as an object placed somewhere on a
 *               3D apron, because the sensor cannot tell us where the target is
 *               laterally and pretending otherwise would be a fabrication.
 *   OV7670      the parallel camera module. Shows a real error state until the
 *               board reports frames; it never freezes the last image and calls
 *               it live.
 */

/* Demonstration boundaries. These mirror python/config.py on the board. */
const CRITICAL_CM = 20;
const CAUTION_CM = 50;
/* Drawing range for the corridor. */
const MAX_CM = 120;

const W = 900;
const H = 300;
const PAD_L = 70;
const PAD_R = 40;
const TRACK_Y = 168;
const TRACK_H = 74;

function xFor(cm: number) {
  const span = W - PAD_L - PAD_R;
  const clamped = Math.max(0, Math.min(MAX_CM, cm));
  return PAD_L + (clamped / MAX_CM) * span;
}

function RangeBeam() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);

  const valid = !!state?.sensor_valid && link === "online";
  const cm = valid ? state?.distance_cm ?? null : null;
  const ttz = valid ? state?.ttz_s ?? null : null;

  const xCrit = xFor(CRITICAL_CM);
  const xCaut = xFor(CAUTION_CM);
  const xEnd = xFor(MAX_CM);
  const xTarget = cm === null ? null : xFor(cm);

  const band =
    cm === null
      ? "#5d7688"
      : cm <= CRITICAL_CM
        ? "#ff4343"
        : cm <= CAUTION_CM
          ? "#f5a623"
          : "#31d17c";

  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="critBand" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff4343" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#ff4343" stopOpacity="0.16" />
          </linearGradient>
          <linearGradient id="cautBand" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f5a623" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#f5a623" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="safeBand" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#31d17c" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#31d17c" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* zone bands */}
        <rect x={PAD_L} y={TRACK_Y - TRACK_H / 2} width={xCrit - PAD_L} height={TRACK_H} fill="url(#critBand)" />
        <rect x={xCrit} y={TRACK_Y - TRACK_H / 2} width={xCaut - xCrit} height={TRACK_H} fill="url(#cautBand)" />
        <rect x={xCaut} y={TRACK_Y - TRACK_H / 2} width={xEnd - xCaut} height={TRACK_H} fill="url(#safeBand)" />

        {/* corridor outline */}
        <rect
          x={PAD_L}
          y={TRACK_Y - TRACK_H / 2}
          width={xEnd - PAD_L}
          height={TRACK_H}
          fill="none"
          stroke="#14384f"
          strokeWidth="1"
        />

        {/* sensor head at origin */}
        <g>
          <rect x={PAD_L - 30} y={TRACK_Y - 22} width={26} height={44} rx="3" fill="#0b2233" stroke="#1d5679" />
          <circle cx={PAD_L - 22} cy={TRACK_Y - 8} r="5.5" fill="#123c56" stroke="#2b6f96" />
          <circle cx={PAD_L - 22} cy={TRACK_Y + 8} r="5.5" fill="#123c56" stroke="#2b6f96" />
          <text x={PAD_L - 17} y={TRACK_Y + 40} textAnchor="middle" fill="#6f8ba0" style={{ fontSize: 11 }}>
            HC-SR04
          </text>
        </g>

        {/* boundary markers */}
        {[
          { x: xCrit, cm: CRITICAL_CM, c: "#ff4343", label: "CRITICAL" },
          { x: xCaut, cm: CAUTION_CM, c: "#f5a623", label: "CAUTION" },
        ].map((b) => (
          <g key={b.label}>
            <line
              x1={b.x}
              y1={TRACK_Y - TRACK_H / 2 - 14}
              x2={b.x}
              y2={TRACK_Y + TRACK_H / 2 + 14}
              stroke={b.c}
              strokeWidth="1.6"
              strokeDasharray="5 4"
            />
            <text x={b.x} y={TRACK_Y - TRACK_H / 2 - 22} textAnchor="middle" fill={b.c} style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em" }}>
              {b.label} {b.cm} cm
            </text>
          </g>
        ))}

        {/* scale ticks */}
        {[0, 20, 40, 60, 80, 100, 120].map((t) => (
          <g key={t}>
            <line x1={xFor(t)} y1={TRACK_Y + TRACK_H / 2} x2={xFor(t)} y2={TRACK_Y + TRACK_H / 2 + 7} stroke="#2b526d" strokeWidth="1" />
            <text x={xFor(t)} y={TRACK_Y + TRACK_H / 2 + 22} textAnchor="middle" fill="#4f6d82" style={{ fontSize: 10.5 }}>
              {t}
            </text>
          </g>
        ))}

        {/* measured target */}
        {xTarget !== null ? (
          <g style={{ transition: "transform 120ms linear" }} transform={`translate(${xTarget},0)`}>
            <line y1={TRACK_Y - TRACK_H / 2} y2={TRACK_Y + TRACK_H / 2} stroke={band} strokeWidth="2.5" />
            <circle cy={TRACK_Y} r="13" fill={band} fillOpacity="0.22" stroke={band} strokeWidth="2" />
            <circle cy={TRACK_Y} r="4.5" fill={band} />
            <text y={TRACK_Y - TRACK_H / 2 - 40} textAnchor="middle" fill={band} className="tnum" style={{ fontSize: 21, fontWeight: 700 }}>
              {cm!.toFixed(1)} cm
            </text>
          </g>
        ) : (
          <text x={(PAD_L + xEnd) / 2} y={TRACK_Y + 6} textAnchor="middle" fill="#5d7688" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "0.08em" }}>
            {link === "offline" ? "UNO Q OFFLINE" : "NO VALID ECHO — RANGE UNKNOWN"}
          </text>
        )}

        {/* predicted entry marker */}
        {ttz !== null && cm !== null && (
          <text x={xTarget!} y={TRACK_Y + TRACK_H / 2 + 46} textAnchor="middle" fill={ttz <= 2 ? "#ff4343" : "#f5a623"} style={{ fontSize: 12.5, fontWeight: 600 }}>
            Predicted boundary entry in {ttz.toFixed(1)} s
          </text>
        )}

        <text x={PAD_L} y={34} fill="#c4d8e5" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.07em" }}>
          RANGE SENSOR BEAM
        </text>
        <text x={PAD_L} y={52} fill="#5d7688" style={{ fontSize: 11 }}>
          One-dimensional distance along the sensor axis. Lateral position is not measured.
        </text>
      </svg>
    </div>
  );
}

function CameraPane() {
  const state = useLive((s) => s.state);
  const cam = cameraSummary(state);

  if (!cam.ok) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <CameraOff size={44} strokeWidth={1.4} className="text-[#3f5a6e]" />
        <div className="text-[15px] font-semibold tracking-[0.08em] text-[#ff5a5a]">
          {cam.label}
        </div>
        <div className="max-w-[420px] text-center text-[11.5px] leading-[1.6] text-[#6f8ba0]">
          {cam.detail}
        </div>
        <div className="mt-1 max-w-[460px] rounded-[5px] border border-[#14384f] bg-[#06182a] px-3 py-2 text-center text-[10.5px] leading-[1.6] text-[#5d7688]">
          The OV7670 is a parallel DVP module, not a USB webcam. It is brought up
          over SCCB first; no frame is shown until the board reports one.
        </div>
      </div>
    );
  }

  const c = state!.camera!;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      {/* Frames are served by the board; the age readout keeps it honest. */}
      <img
        src="/api/unoq/frame"
        alt="OV7670 live frame"
        className="max-h-[78%] rounded-[4px] border border-[#14384f]"
      />
      <div className="tnum text-[11px] text-[#6f8ba0]">
        {c.width}x{c.height} &middot; {c.fps?.toFixed(1) ?? "--"} fps &middot; frame age{" "}
        {c.frame_age_s === null ? "unknown" : `${Math.round(c.frame_age_s * 1000)} ms`}
      </div>
    </div>
  );
}

export function LiveMonitoringView() {
  const [tab, setTab] = useState<"beam" | "cam">("beam");
  const link = useLive((s) => s.link);

  const tabCls = (on: boolean) =>
    `flex items-center gap-2 rounded-[4px] border px-2.5 py-[7px] text-[11.5px] font-semibold tracking-[0.04em] transition-colors ${
      on
        ? "border-[#1d5679] bg-[#0d3247] text-[#c4d8e5]"
        : "border-[#14384f] bg-[#061524]/92 text-[#6f8ba0] hover:border-[#1d5679]"
    }`;

  return (
    <Panel className="relative min-h-0 flex-1 overflow-hidden p-0">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <span className="flex items-center gap-2 rounded-[4px] border border-[#0d4a3a] bg-[#061e17]/92 px-2.5 py-[7px] text-[11.5px] font-semibold tracking-[0.04em] text-[#7ff0c0]">
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{
              background: link === "online" ? "#31d17c" : "#ff4343",
              boxShadow: `0 0 6px ${link === "online" ? "#31d17c" : "#ff4343"}`,
            }}
          />
          LIVE HARDWARE
        </span>
      </div>

      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
        <button type="button" className={tabCls(tab === "beam")} onClick={() => setTab("beam")}>
          <Radar size={14} strokeWidth={1.9} />
          RANGE BEAM
        </button>
        <button type="button" className={tabCls(tab === "cam")} onClick={() => setTab("cam")}>
          <Video size={14} strokeWidth={1.9} />
          OV7670
        </button>
      </div>

      <div className="h-full w-full px-2 pb-14 pt-2">
        {tab === "beam" ? <RangeBeam /> : <CameraPane />}
      </div>
    </Panel>
  );
}
