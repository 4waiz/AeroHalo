"use client";

import { Panel } from "./ui";
import { AirsideScene } from "@/three/Scene";
import { useLive } from "@/live/liveStore";

/**
 * LIVE HARDWARE centre view.
 *
 * The same 3D apron the simulation uses, with every simulated entity removed
 * and the real HC-SR04 beam added. The apron, the aircraft and the painted
 * zones are scenery; the only thing that moves is the marker on the range
 * corridor, and it moves because a physical sensor measured it.
 */

const DOT = {
  ok: "#31d17c",
  warn: "#f5a623",
  bad: "#ff4343",
} as const;

function Chip({
  label,
  value,
  colour,
}: {
  label: string;
  value: string;
  colour: string;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-[4px] border border-[#14384f] bg-[#040f19]/88 px-2.5 py-[6px] text-[10.5px] font-semibold tracking-[0.04em] backdrop-blur-[2px]">
      <span
        className="h-[7px] w-[7px] rounded-full"
        style={{ background: colour, boxShadow: `0 0 6px ${colour}` }}
      />
      <span className="text-[#6f8ba0]">{label}</span>
      <span style={{ color: colour }}>{value}</span>
    </span>
  );
}

export function LiveMonitoringView() {
  const link = useLive((s) => s.link);
  const pir = useLive((s) => s.state?.pir);
  const vib = useLive((s) => s.state?.vibration);
  const rng = useLive((s) => s.state?.range);
  const risk = useLive((s) => s.state?.risk.state);
  const offline = link === "offline";

  const linkChip = offline
    ? { v: "OFFLINE", c: DOT.bad }
    : link === "stale"
      ? { v: "STALE", c: DOT.warn }
      : { v: "ONLINE", c: DOT.ok };

  const rangeChip = offline
    ? { v: "OFFLINE", c: DOT.bad }
    : rng?.valid
      ? { v: `${rng.distance_cm?.toFixed(1)} cm`, c: DOT.ok }
      : { v: "NO ECHO", c: DOT.warn };

  const pirChip = offline
    ? { v: "OFFLINE", c: DOT.bad }
    : pir?.warming_up
      ? { v: "WARMING UP", c: DOT.warn }
      : pir?.suspect_stuck
        ? { v: "OUTPUT HELD", c: DOT.warn }
        : pir?.motion_detected
          ? { v: "MOTION", c: DOT.bad }
          : { v: "CLEAR", c: DOT.ok };

  const vibChip = offline
    ? { v: "OFFLINE", c: DOT.bad }
    : !vib?.online
      ? { v: "CALIBRATING", c: DOT.warn }
      : vib.triggered
        ? { v: "IMPACT", c: DOT.bad }
        : { v: "NORMAL", c: DOT.ok };

  const stateColour =
    offline || !risk
      ? "#7d97ab"
      : risk === "SAFE"
        ? DOT.ok
        : risk === "CAUTION"
          ? DOT.warn
          : risk === "HOLD"
            ? DOT.bad
            : "#7d97ab";

  return (
    <Panel className="relative min-h-0 flex-1 overflow-hidden p-0">
      <AirsideScene live />

      {/* top-left: what the hardware is doing */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <Chip label="UNO Q" value={linkChip.v} colour={linkChip.c} />
        <Chip label="RANGE" value={rangeChip.v} colour={rangeChip.c} />
        <Chip label="PIR" value={pirChip.v} colour={pirChip.c} />
        <Chip label="VIBRATION" value={vibChip.v} colour={vibChip.c} />
      </div>

      {/* top-right: the fused verdict, readable across a room */}
      <div className="pointer-events-none absolute right-3 top-3 z-10">
        <div
          className="rounded-[5px] border bg-[#040f19]/88 px-3.5 py-2 text-center backdrop-blur-[2px]"
          style={{ borderColor: `${stateColour}55` }}
        >
          <div className="text-[9px] tracking-[0.12em] text-[#6f8ba0]">
            FUSED STATE
          </div>
          <div
            className="text-[19px] font-bold leading-tight tracking-[0.02em]"
            style={{ color: stateColour }}
          >
            {offline ? "UNKNOWN" : (risk ?? "UNKNOWN")}
          </div>
        </div>
      </div>

      {/* the one claim this view must not overstate */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-[4px] border border-[#14384f] bg-[#040f19]/88 px-2.5 py-[6px] text-[9.5px] leading-[1.4] text-[#6f8ba0] backdrop-blur-[2px]">
        Apron and aircraft are scenery. Only the range marker is measured.
      </div>
    </Panel>
  );
}
