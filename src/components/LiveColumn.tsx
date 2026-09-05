"use client";

import {
  Activity,
  Gauge,
  Lightbulb,
  Radio,
  Ruler,
  TriangleAlert,
  User,
  Waves,
} from "lucide-react";
import { Panel, PanelLabel } from "./ui";
import { UNAVAILABLE, fmtNumber, fmtTtz, useLive } from "@/live/liveStore";
import type { UnoQStatus } from "@/hardware/unoq/types";

/**
 * LIVE HARDWARE column.
 *
 * Every value here comes from a measurement the Arduino UNO Q actually
 * reported. Where the board could not measure something the card prints
 * UNAVAILABLE rather than a plausible-looking number. The simulation column is
 * free to invent; this one is not.
 */

const STATUS_COLOUR: Record<UnoQStatus, string> = {
  SAFE: "#31d17c",
  CAUTION: "#f5a623",
  HOLD: "#ff4343",
  UNKNOWN: "#8fa7b8",
};

const STATUS_COPY: Record<UnoQStatus, string> = {
  SAFE: "All three sensors nominal",
  CAUTION: "Elevated risk on the monitored boundary",
  HOLD: "Safety interlock engaged. Inspect, then reset.",
  UNKNOWN: "Sensor data unavailable. Treat the zone as unverified.",
};

/* ------------------------------------------------------------------ */
/* Safety status                                                       */
/* ------------------------------------------------------------------ */

export function LiveSafetyStatusCard() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);

  // A dead link is never SAFE. Offline collapses to UNKNOWN on purpose.
  const status: UnoQStatus =
    link === "offline" || !state ? "UNKNOWN" : state.risk.state;
  const colour = STATUS_COLOUR[status];

  return (
    <Panel className="shrink-0 px-3.5 pb-3.5 pt-3">
      <PanelLabel>Safety Status &middot; Live Hardware</PanelLabel>
      <div className="flex flex-1 flex-col items-center justify-center pt-2">
        <div className="flex items-center gap-2.5">
          <span
            className="font-bold leading-none tracking-[0.005em] transition-colors duration-300"
            style={{ color: colour, fontSize: "var(--t-status)" }}
          >
            {status}
          </span>
          <TriangleAlert
            size={28}
            strokeWidth={1.9}
            style={{ color: colour }}
            className={status === "HOLD" ? "crit-dot rounded-full" : ""}
          />
        </div>
        <p className="mt-2.5 max-w-[210px] text-center text-[11.5px] leading-[1.5] text-[#829bad]">
          {link === "offline"
            ? "UNO Q offline. No hardware telemetry."
            : STATUS_COPY[status]}
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Risk gauge + the WHY breakdown                                      */
/* ------------------------------------------------------------------ */

const R = 62;
const CX = 100;
const CY = 84;
const ARC_LEN = Math.PI * R;

function riskLabel(v: number) {
  if (v >= 70) return "Hold";
  if (v >= 30) return "Caution";
  return "Low";
}

export function LiveRiskGaugeCard() {
  const risk = useLive((s) => s.state?.risk ?? null);
  const link = useLive((s) => s.link);

  const known = link !== "offline" && risk?.score !== null && risk !== null;
  const score = known ? (risk!.score as number) : 0;
  const colour = known
    ? score >= 70
      ? "#ff4343"
      : score >= 30
        ? "#f5a623"
        : "#31d17c"
    : "#4a6478";

  const offset = ARC_LEN * (1 - Math.max(0, Math.min(100, score)) / 100);
  const reasons = risk?.reasons ?? [];

  return (
    <Panel className="shrink-0 px-3.5 pb-3 pt-3">
      <PanelLabel>Risk Score &middot; Measured</PanelLabel>
      <div className="relative flex items-end justify-center">
        <svg viewBox="0 0 200 100" className="w-[168px] overflow-visible">
          <path
            d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
            fill="none"
            stroke="#12293c"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {known && (
            <path
              d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
              fill="none"
              stroke={colour}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={ARC_LEN}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 200ms linear" }}
            />
          )}
          <text
            x={CX}
            y={CY - 10}
            textAnchor="middle"
            className="tnum"
            fill="#f3f7fa"
            style={{ fontSize: known ? 36 : 17, fontWeight: 700 }}
          >
            {known ? Math.round(score) : "N/A"}
          </text>
        </svg>
      </div>
      <div
        className="-mt-1 text-center text-[13px] font-semibold"
        style={{ color: known ? colour : "#6f8ba0" }}
      >
        {known ? riskLabel(score) : "No measurement"}
      </div>

      {/* The dashboard has to be able to say WHY it is in this state. */}
      <div className="mt-2 border-t border-[#12293c] pt-1.5">
        <div className="mb-1 text-[9.5px] uppercase tracking-[0.09em] text-[#6f8ba0]">
          Why
        </div>
        {reasons.length === 0 ? (
          <div className="text-[11px] leading-[1.5] text-[#5d7688]">
            No contributing conditions.
          </div>
        ) : (
          <ul className="space-y-[3px]">
            {reasons.map((r, i) => (
              <li
                key={`${i}-${r}`}
                className="flex gap-1.5 text-[11px] leading-[1.45] text-[#c4d8e5]"
              >
                <span className="mt-[6px] h-[3px] w-[3px] shrink-0 rounded-full bg-[#4f6d82]" />
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Sensor fusion panel                                                 */
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
    <div className="flex items-baseline justify-between gap-2 py-[2px]">
      <span className="text-[10px] uppercase tracking-[0.05em] text-[#6f8ba0]">
        {label}
      </span>
      <span
        className="tnum text-[12.5px] font-semibold"
        style={{ color: missing ? "#5d7688" : (colour ?? "#eef5fa") }}
      >
        {value}
      </span>
    </div>
  );
}

function SensorHead({
  icon,
  name,
  status,
  colour,
}: {
  icon: React.ReactNode;
  name: string;
  status: string;
  colour: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#c4d8e5]">
        <span className="text-[#7d97ab]">{icon}</span>
        {name}
      </span>
      <span
        className="text-[10px] font-bold tracking-[0.05em]"
        style={{ color: colour }}
      >
        {status}
      </span>
    </div>
  );
}

export function LiveRangePanel() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);
  const offline = link === "offline" || !state;

  const rng = state?.range;
  const pir = state?.pir;
  const vib = state?.vibration;

  const rangeValid = !!rng?.valid && link === "online";
  const closing = rangeValid ? (rng?.closing_cm_s ?? null) : null;
  const ttz = rangeValid ? (rng?.time_to_boundary_s ?? null) : null;

  const rangeStatus = offline
    ? { t: "OFFLINE", c: "#ff4343" }
    : link === "stale"
      ? { t: "STALE", c: "#f5a623" }
      : rangeValid
        ? { t: "ONLINE", c: "#31d17c" }
        : { t: "NO ECHO", c: "#f5a623" };

  const pirStatus = offline
    ? { t: "OFFLINE", c: "#ff4343" }
    : pir?.warming_up
      ? { t: "WARMING UP", c: "#f5a623" }
      : pir?.motion_detected
        ? { t: "MOTION DETECTED", c: "#ff4343" }
        : { t: "CLEAR", c: "#31d17c" };

  const vibStatus = offline
    ? { t: "OFFLINE", c: "#ff4343" }
    : !vib?.online
      ? { t: "CALIBRATING", c: "#f5a623" }
      : vib?.triggered
        ? { t: "IMPACT DETECTED", c: "#ff4343" }
        : { t: "NORMAL", c: "#31d17c" };

  return (
    <Panel className="shrink-0 px-3.5 pb-3 pt-3">
      <PanelLabel
        right={
          <span className="tnum text-[10.5px] font-semibold text-[#c4d8e5]">
            {offline ? "0" : (state?.sensors_online ?? 0)} / 3 online
          </span>
        }
      >
        Sensor Fusion
      </PanelLabel>

      {/* ---- HC-SR04 ---- */}
      <div className="mt-2">
        <SensorHead
          icon={<Ruler size={12} strokeWidth={2} />}
          name="HC-SR04 range"
          status={rangeStatus.t}
          colour={rangeStatus.c}
        />
        <div
          className="tnum mt-1 font-bold leading-none tracking-[-0.01em]"
          style={{
            fontSize: "var(--t-stat)",
            color: rangeValid ? "#f3f7fa" : "#5d7688",
          }}
        >
          {rangeValid ? fmtNumber(rng?.distance_cm ?? null, 1, "cm") : UNAVAILABLE}
        </div>
        <div className="mt-1">
          <Row
            label="Approach speed"
            value={rangeValid ? fmtNumber(closing, 1, "cm/s") : UNAVAILABLE}
            colour={closing !== null && closing > 0 ? "#f5a623" : undefined}
          />
          <Row
            label="Boundary ETA"
            value={fmtTtz(state ?? null)}
            colour={
              ttz !== null && ttz <= 2
                ? "#ff4343"
                : ttz !== null
                  ? "#f5a623"
                  : undefined
            }
          />
          <Row
            label="Raw ping"
            value={
              rangeValid ? fmtNumber(rng?.raw_distance_cm ?? null, 1, "cm") : UNAVAILABLE
            }
          />
          <Row
            label="Sample age"
            value={
              rng?.sample_age_ms === null || rng?.sample_age_ms === undefined || offline
                ? UNAVAILABLE
                : `${rng.sample_age_ms} ms`
            }
          />
          <Row
            label="Sample rate"
            value={offline ? UNAVAILABLE : fmtNumber(rng?.sample_rate_hz ?? null, 1, "Hz")}
          />
        </div>
      </div>

      {/* ---- HC-SR501 ---- */}
      <div className="mt-2.5 border-t border-[#12293c] pt-2">
        <SensorHead
          icon={<User size={12} strokeWidth={2} />}
          name="HC-SR501 personnel"
          status={pirStatus.t}
          colour={pirStatus.c}
        />
        <div className="mt-0.5 text-[10.5px] leading-[1.4] text-[#6f8ba0]">
          {offline ? "No telemetry" : (pir?.detail ?? "")}
          {pir?.warming_up
            ? " — no personnel alerts are raised during warm-up"
            : ""}
        </div>
      </div>

      {/* ---- SW-420 ---- */}
      <div className="mt-2.5 border-t border-[#12293c] pt-2">
        <SensorHead
          icon={<Waves size={12} strokeWidth={2} />}
          name="SW-420 vibration"
          status={vibStatus.t}
          colour={vibStatus.c}
        />
        <div className="mt-0.5 text-[10.5px] leading-[1.4] text-[#6f8ba0]">
          {offline
            ? "No telemetry"
            : `${vib?.detail ?? ""} · polarity ${vib?.polarity ?? "unverified"}`}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Physical outputs                                                    */
/* ------------------------------------------------------------------ */

function Lamp({ on, colour, label }: { on: boolean; colour: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="h-[18px] w-[18px] rounded-full border transition-all duration-150"
        style={{
          background: on ? colour : "#0d2536",
          borderColor: on ? colour : "#1b4462",
          boxShadow: on ? `0 0 10px ${colour}` : "none",
        }}
      />
      <span className="text-[9px] tracking-[0.05em] text-[#6f8ba0]">{label}</span>
    </div>
  );
}

export function LiveOutputsPanel() {
  const out = useLive((s) => s.state?.outputs);
  const link = useLive((s) => s.link);
  const offline = link === "offline" || !out;

  return (
    <Panel className="shrink-0 px-3.5 pb-2.5 pt-3">
      <PanelLabel>Physical Outputs</PanelLabel>
      <div className="mt-2 flex items-start justify-between">
        <div className="flex gap-3.5">
          <Lamp on={!offline && out.green_led} colour="#31d17c" label="GREEN" />
          <Lamp on={!offline && out.yellow_led} colour="#f5a623" label="YELLOW" />
          <Lamp on={!offline && out.red_led} colour="#ff4343" label="RED" />
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5 text-[10px] text-[#6f8ba0]">
            <Lightbulb size={11} strokeWidth={2} />
            {offline
              ? "no telemetry"
              : out.self_test_done
                ? "lamp test ran"
                : "lamp test pending"}
          </div>
          <div className="mt-1 text-[10px] text-[#5d7688]">
            Servo D9: {offline ? "unknown" : out.servo_commanded_state}
          </div>
        </div>
      </div>
      <div className="mt-1.5 border-t border-[#12293c] pt-1.5 text-[9.5px] leading-[1.4] text-[#5d7688]">
        LED states are read back from the MCU, so this mirrors the lights on the
        table rather than re-deriving them here.
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Operator controls                                                   */
/* ------------------------------------------------------------------ */

export function LiveOperatorPanel() {
  const send = useLive((s) => s.send);
  const pending = useLive((s) => s.commandPending);
  const note = useLive((s) => s.commandNote);
  const hold = useLive((s) => s.state?.hold.latched ?? false);
  const link = useLive((s) => s.link);
  const disabled = pending || link === "offline";

  return (
    <Panel className="shrink-0 px-3.5 pb-2.5 pt-3">
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
                  "The MCU will still refuse the release unless the range is valid, stable beyond the reset boundary for 2 s, with no personnel motion and no active vibration."
              )
            ) {
              void send("clear_after_inspection");
            }
          }}
          className="rounded-[5px] border border-[#1c4a63] bg-[#0b2233] px-2 py-1.5 text-[11px] font-semibold text-[#7fd8ef] transition-colors hover:bg-[#102d42] disabled:opacity-40"
        >
          Reset after inspection
        </button>
      </div>
      <div className="mt-1.5 min-h-[24px] text-[10px] leading-[1.4] text-[#6f8ba0]">
        {note || "Commands are queued on the board. Only the MCU confirms them."}
      </div>
      <div className="flex items-center gap-1.5 border-t border-[#12293c] pt-1.5 text-[9.5px] text-[#5d7688]">
        <Gauge size={10} strokeWidth={2} />
        Tabletop demonstrator. Not certified aviation equipment.
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Link summary                                                        */
/* ------------------------------------------------------------------ */

export function LiveStatusCardGrid() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);
  const fetchMs = useLive((s) => s.fetchMs);

  const linkCopy = {
    online: { v: "ONLINE", c: "#31d17c" },
    stale: { v: "STALE", c: "#f5a623" },
    connecting: { v: "LINKING", c: "#f5a623" },
    offline: { v: "OFFLINE", c: "#ff4343" },
  }[link];

  return (
    <Panel className="shrink-0 px-3.5 pb-2.5 pt-3">
      <PanelLabel>UNO Q Link</PanelLabel>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <div>
          <div
            className="text-[13px] font-bold leading-none"
            style={{ color: linkCopy.c }}
          >
            {linkCopy.v}
          </div>
          <div className="mt-1 text-[9px] tracking-[0.05em] text-[#6f8ba0]">
            TRANSPORT
          </div>
        </div>
        <div>
          <div className="tnum text-[13px] font-bold leading-none text-[#f3f7fa]">
            {state?.bridge_roundtrip_ms == null || link === "offline"
              ? "N/A"
              : Math.round(state.bridge_roundtrip_ms)}
          </div>
          <div className="mt-1 text-[9px] tracking-[0.05em] text-[#6f8ba0]">
            MCU RTT (ms)
          </div>
        </div>
        <div>
          <div className="tnum text-[13px] font-bold leading-none text-[#f3f7fa]">
            {fetchMs === null ? "N/A" : fetchMs}
          </div>
          <div className="mt-1 text-[9px] tracking-[0.05em] text-[#6f8ba0]">
            HTTP RTT (ms)
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 border-t border-[#12293c] pt-1.5 text-[9.5px] text-[#5d7688]">
        <Activity size={10} strokeWidth={2} />
        MCU link latency. Not a vision or AI latency.
      </div>
    </Panel>
  );
}
