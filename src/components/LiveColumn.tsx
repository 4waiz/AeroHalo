"use client";

import {
  Activity,
  Bell,
  Camera,
  Gauge,
  Radio,
  Ruler,
  TriangleAlert,
} from "lucide-react";
import { MiniBar, Panel, PanelLabel } from "./ui";
import {
  UNAVAILABLE,
  cameraSummary,
  fmtAge,
  fmtNumber,
  fmtTtz,
  sensorSummary,
  useLive,
} from "@/live/liveStore";
import type { UnoQStatus } from "@/hardware/unoq/types";

/**
 * LIVE HARDWARE column.
 *
 * Every value on this screen comes from a measurement the Arduino UNO Q
 * actually reported. Where the board could not measure something the card
 * prints UNAVAILABLE rather than a plausible-looking number. That is the whole
 * point of the mode: the simulation column is free to invent, this one is not.
 */

const STATUS_COLOUR: Record<UnoQStatus, string> = {
  SAFE: "#31d17c",
  CAUTION: "#f5a623",
  HOLD: "#ff4343",
  UNKNOWN: "#8fa7b8",
};

const STATUS_COPY: Record<UnoQStatus, string> = {
  SAFE: "Measured range beyond the caution boundary",
  CAUTION: "Object inside the caution boundary",
  HOLD: "HOLD latched. Inspect the zone, then reset.",
  UNKNOWN: "No valid range measurement. Treat the zone as unverified.",
};

/* ------------------------------------------------------------------ */
/* Safety status                                                       */
/* ------------------------------------------------------------------ */

export function LiveSafetyStatusCard() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);

  // A dead link is never CLEAR. Offline collapses to UNKNOWN on purpose.
  const status: UnoQStatus =
    link === "offline" || !state ? "UNKNOWN" : state.status;
  const colour = STATUS_COLOUR[status];

  return (
    <Panel className="shrink-0 px-3.5 pb-4 pt-3">
      <PanelLabel>Safety Status &middot; Live Hardware</PanelLabel>
      <div className="flex flex-1 flex-col items-center justify-center pt-3">
        <div className="flex items-center gap-2.5">
          <span
            className="font-bold leading-none tracking-[0.005em] transition-colors duration-500"
            style={{ color: colour, fontSize: "var(--t-status)" }}
          >
            {status}
          </span>
          <TriangleAlert
            size={30}
            strokeWidth={1.9}
            style={{ color: colour }}
            className={status === "HOLD" ? "crit-dot rounded-full" : ""}
          />
        </div>
        <p className="mt-3 max-w-[210px] text-center text-[11.5px] leading-[1.5] text-[#829bad]">
          {link === "offline"
            ? "UNO Q offline. No hardware telemetry."
            : STATUS_COPY[status]}
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Risk gauge, driven by the board's deterministic risk figure          */
/* ------------------------------------------------------------------ */

const R = 76;
const CX = 100;
const CY = 100;
const ARC_LEN = Math.PI * R;

function riskLabel(v: number) {
  if (v >= 80) return "Critical";
  if (v >= 60) return "High Risk";
  if (v >= 25) return "Elevated";
  return "Low";
}

export function LiveRiskGaugeCard() {
  const risk = useLive((s) => s.state?.risk ?? null);
  const link = useLive((s) => s.link);

  const known = link !== "offline" && risk !== null;
  const score = known ? risk : 0;
  const colour = known
    ? score >= 80
      ? "#ff4343"
      : score >= 60
        ? "#f5a623"
        : score >= 25
          ? "#c9d13c"
          : "#31d17c"
    : "#4a6478";

  const offset = ARC_LEN * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <Panel className="shrink-0 px-3.5 pb-3.5 pt-3">
      <PanelLabel>Risk Score &middot; Measured</PanelLabel>
      <div className="relative flex flex-1 items-end justify-center pt-1">
        <svg
          viewBox="0 0 200 118"
          className="overflow-visible"
          style={{ width: "var(--t-gauge)" }}
        >
          <path
            d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
            fill="none"
            stroke="#12293c"
            strokeWidth="13"
            strokeLinecap="round"
          />
          {known && (
            <path
              d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
              fill="none"
              stroke={colour}
              strokeWidth="13"
              strokeLinecap="round"
              strokeDasharray={ARC_LEN}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 250ms linear" }}
            />
          )}
          <text
            x={CX}
            y={CY - 12}
            textAnchor="middle"
            className="tnum"
            fill="#f3f7fa"
            style={{ fontSize: known ? 44 : 20, fontWeight: 700 }}
          >
            {known ? Math.round(score) : "N/A"}
          </text>
          {known && (
            <text
              x={CX}
              y={CY + 8}
              textAnchor="middle"
              fill="#6f8ba0"
              style={{ fontSize: 13 }}
            >
              /100
            </text>
          )}
        </svg>
      </div>
      <div
        className="pb-0.5 text-center text-[14px] font-semibold transition-colors duration-500"
        style={{ color: known ? colour : "#6f8ba0" }}
      >
        {known ? riskLabel(score) : "No measurement"}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Range sensor detail                                                 */
/* ------------------------------------------------------------------ */

function Row({
  label,
  value,
  colour,
}: {
  label: string;
  value: string;
  colour?: string;
}) {
  const missing = value === UNAVAILABLE;
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-[#6f8ba0]">
        {label}
      </span>
      <span
        className="tnum text-[13px] font-semibold"
        style={{ color: missing ? "#5d7688" : (colour ?? "#eef5fa") }}
      >
        {value}
      </span>
    </div>
  );
}

export function LiveRangePanel() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);
  const fetchMs = useLive((s) => s.fetchMs);

  const sensor = sensorSummary(state, link);
  const valid = !!state?.sensor_valid && link === "online";

  // Approach speed only means something while the sensor is actually valid.
  const closing = valid ? state?.closing_cm_s ?? null : null;
  const approaching = closing !== null && closing > 0;

  return (
    <Panel className="shrink-0 px-3.5 pb-3 pt-3">
      <PanelLabel>Range Sensor &middot; HC-SR04</PanelLabel>

      <div className="mt-2 flex items-center gap-1.5">
        <Ruler size={13} strokeWidth={2} className="text-[#7d97ab]" />
        <span
          className="text-[11px] font-semibold"
          style={{ color: sensor.ok ? "#31d17c" : "#f5a623" }}
        >
          {sensor.label}
        </span>
      </div>
      <div className="mt-0.5 text-[10.5px] leading-[1.4] text-[#6f8ba0]">
        {sensor.detail}
      </div>

      <div
        className="tnum mt-2.5 font-bold leading-none tracking-[-0.01em]"
        style={{
          fontSize: "var(--t-stat)",
          color: valid ? "#f3f7fa" : "#5d7688",
        }}
      >
        {valid ? fmtNumber(state?.distance_cm ?? null, 1, "cm") : UNAVAILABLE}
      </div>

      <div className="mt-2.5 border-t border-[#12293c] pt-1.5">
        <Row
          label="Approach speed"
          value={valid ? fmtNumber(closing, 1, "cm/s") : UNAVAILABLE}
          colour={approaching ? "#f5a623" : undefined}
        />
        <Row
          label="Predicted entry"
          value={fmtTtz(state)}
          colour={
            state?.ttz_s !== null && state?.ttz_s !== undefined && state.ttz_s <= 2
              ? "#ff4343"
              : state?.ttz_s !== null && state?.ttz_s !== undefined
                ? "#f5a623"
                : undefined
          }
        />
        <Row
          label="Raw ping"
          value={valid ? fmtNumber(state?.raw_distance_cm ?? null, 1, "cm") : UNAVAILABLE}
        />
        <Row label="Data age" value={fmtAge(state)} />
        <Row
          label="Sample rate"
          value={fmtNumber(state?.sample_rate_hz ?? null, 1, "Hz")}
        />
        <Row
          label="HTTP round trip"
          value={fetchMs === null ? UNAVAILABLE : `${fetchMs} ms`}
        />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Small stat cards, live variant                                      */
/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
  sub,
  subColor,
  bar,
  barColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  subColor: string;
  bar?: number;
  barColor?: string;
}) {
  return (
    <Panel className="justify-between px-3 pb-2.5 pt-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[#7d97ab]">{icon}</span>
        <span className="panel-label text-[9.5px] leading-[1.2]">{label}</span>
      </div>
      <div className="mt-1.5">
        <div
          className="tnum font-bold leading-none tracking-[-0.01em]"
          style={{
            fontSize: value === UNAVAILABLE ? "13px" : "var(--t-stat)",
            color: value === UNAVAILABLE ? "#5d7688" : "#f3f7fa",
          }}
        >
          {value}
        </div>
        <div
          className="mt-[5px] text-[11px] font-medium leading-none"
          style={{ color: subColor }}
        >
          {sub}
        </div>
      </div>
      {bar !== undefined ? (
        <MiniBar value={bar} color={barColor} className="mt-2.5" />
      ) : (
        <div className="mt-2.5 h-[3px]" />
      )}
    </Panel>
  );
}

export function LiveStatusCardGrid() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);
  const alerts = state?.alerts ?? [];
  const cam = cameraSummary(state);
  const sensor = sensorSummary(state, link);

  const linkCopy: Record<typeof link, { v: string; s: string; c: string }> = {
    online: { v: "ONLINE", s: "Telemetry fresh", c: "#31d17c" },
    stale: { v: "STALE", s: "MCU gone quiet", c: "#f5a623" },
    connecting: { v: "LINKING", s: "Contacting board", c: "#f5a623" },
    offline: { v: "OFFLINE", s: "No telemetry service", c: "#ff4343" },
  };
  const l = linkCopy[link];

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2.5">
      <StatCard
        icon={<Bell size={13} strokeWidth={2} />}
        label="Active Alerts"
        value={String(alerts.length)}
        sub={alerts.length ? "From hardware" : "None active"}
        subColor={alerts.length ? "#f5a623" : "#31d17c"}
      />
      <StatCard
        icon={<Activity size={13} strokeWidth={2} />}
        label="UNO Q Link"
        value={l.v}
        sub={l.s}
        subColor={l.c}
      />
      <StatCard
        icon={<Radio size={13} strokeWidth={2} />}
        label="Range Sensors"
        // One physical HC-SR04 is connected. Never claim a fleet.
        value={state?.connected ? "1 / 1" : "0 / 1"}
        sub={sensor.ok ? "Online" : sensor.detail}
        subColor={sensor.ok ? "#31d17c" : "#f5a623"}
        bar={state?.connected ? 100 : 0}
        barColor={sensor.ok ? "#25d9e8" : "#f5a623"}
      />
      <StatCard
        icon={<Camera size={13} strokeWidth={2} />}
        label="Camera (OV7670)"
        value={cam.ok ? "ONLINE" : "OFFLINE"}
        sub={cam.detail}
        subColor={cam.ok ? "#31d17c" : "#f5a623"}
        bar={cam.ok ? 100 : 0}
        barColor={cam.ok ? "#25d9e8" : "#f5a623"}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Operator controls                                                   */
/* ------------------------------------------------------------------ */

export function LiveOperatorPanel() {
  const send = useLive((s) => s.send);
  const pending = useLive((s) => s.commandPending);
  const note = useLive((s) => s.commandNote);
  const hold = useLive((s) => s.state?.hold ?? false);
  const engine = useLive((s) => s.state?.engine_on ?? false);
  const link = useLive((s) => s.link);
  const disabled = pending || link === "offline";

  return (
    <Panel className="shrink-0 px-3.5 pb-3 pt-3">
      <PanelLabel>Operator</PanelLabel>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void send("hold")}
          className="rounded-[5px] border border-[#5c2020] bg-[#2a0f0f] px-2 py-1.5 text-[11px] font-semibold text-[#ff8a8a] transition-colors hover:bg-[#3a1414] disabled:opacity-40"
        >
          Manual HOLD
        </button>
        <button
          type="button"
          disabled={disabled || !hold}
          onClick={() => {
            // Reset represents a physical inspection, so it is confirmed here
            // rather than fired straight from a single click.
            if (
              window.confirm(
                "Confirm the demonstration zone has been physically inspected and is clear.\n\n" +
                  "The MCU will still refuse the release unless the measured range is stable and beyond the reset boundary."
              )
            ) {
              void send("clear_after_inspection");
            }
          }}
          className="rounded-[5px] border border-[#1c4a63] bg-[#0b2233] px-2 py-1.5 text-[11px] font-semibold text-[#7fd8ef] transition-colors hover:bg-[#102d42] disabled:opacity-40"
        >
          Reset after inspection
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void send(engine ? "engine_off" : "engine_on")}
          className="col-span-2 rounded-[5px] border border-[#2a4256] bg-[#0a1a26] px-2 py-1.5 text-[11px] font-medium text-[#a8c2d4] transition-colors hover:bg-[#0f2532] disabled:opacity-40"
        >
          Simulated engine state: {engine ? "ON" : "OFF"} &mdash; toggle
        </button>
      </div>
      <div className="mt-2 min-h-[26px] text-[10.5px] leading-[1.4] text-[#6f8ba0]">
        {note || "Commands are queued on the board. Only the MCU confirms them."}
      </div>
      <div className="flex items-center gap-1.5 border-t border-[#12293c] pt-1.5 text-[10px] text-[#5d7688]">
        <Gauge size={11} strokeWidth={2} />
        Tabletop demonstrator. Not certified aviation equipment.
      </div>
    </Panel>
  );
}
