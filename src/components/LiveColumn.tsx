"use client";

import { Lightbulb, Ruler, User, Waves } from "lucide-react";
import { Panel, PanelLabel } from "./ui";
import { UNAVAILABLE, fmtNumber, fmtTtz, useLive } from "@/live/liveStore";
import type { UnoQStatus } from "@/hardware/unoq/types";

/**
 * LIVE HARDWARE column: four dense panels.
 *
 * Every value comes from a measurement the Arduino UNO Q actually reported.
 * Where the board could not measure something the panel prints UNAVAILABLE
 * rather than a plausible-looking number.
 */

const COLOUR: Record<UnoQStatus, string> = {
  SAFE: "#31d17c",
  CAUTION: "#f5a623",
  HOLD: "#ff4343",
  UNKNOWN: "#8fa7b8",
};

/* ------------------------------------------------------------------ */
/* State + risk + why                                                  */
/* ------------------------------------------------------------------ */

const R = 54;
const CX = 100;
const CY = 72;
const ARC = Math.PI * R;

export function LiveStatusPanel() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);

  // A dead link is never SAFE.
  const status: UnoQStatus =
    link === "offline" || !state ? "UNKNOWN" : state.risk.state;
  const colour = COLOUR[status];

  const score = link === "offline" ? null : (state?.risk.score ?? null);
  const known = score !== null;
  const offset = ARC * (1 - Math.max(0, Math.min(100, score ?? 0)) / 100);
  const reasons = state?.risk.reasons ?? [];

  return (
    <Panel className="shrink-0 px-3.5 pb-3 pt-3">
      <PanelLabel>Safety State</PanelLabel>

      <div className="mt-1 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div
            className="font-bold leading-none tracking-[0.005em] transition-colors duration-300"
            style={{ color: colour, fontSize: "var(--t-status)" }}
          >
            {status}
          </div>
          <div className="mt-1.5 text-[11px] leading-[1.4] text-[#829bad]">
            {link === "offline"
              ? "UNO Q offline"
              : status === "HOLD"
                ? "Interlock latched. Inspect, then reset."
                : status === "UNKNOWN"
                  ? "Sensor data unavailable"
                  : `Risk ${score ?? "--"} / 100`}
          </div>
        </div>

        <svg viewBox="0 0 200 86" className="w-[112px] shrink-0 overflow-visible">
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
              strokeDasharray={ARC}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 200ms linear" }}
            />
          )}
          <text
            x={CX}
            y={CY - 8}
            textAnchor="middle"
            className="tnum"
            fill={known ? "#f3f7fa" : "#5d7688"}
            style={{ fontSize: known ? 34 : 15, fontWeight: 700 }}
          >
            {known ? Math.round(score) : "N/A"}
          </text>
        </svg>
      </div>

      {/* The dashboard has to be able to say WHY, not just what. */}
      <div className="mt-2 border-t border-[#12293c] pt-1.5">
        <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-[#6f8ba0]">
          Why
        </div>
        {reasons.length === 0 ? (
          <div className="text-[11px] text-[#5d7688]">No contributing conditions</div>
        ) : (
          <ul className="space-y-[3px]">
            {reasons.slice(0, 4).map((r, i) => (
              <li
                key={`${i}-${r}`}
                className="flex gap-1.5 text-[11px] leading-[1.4] text-[#c4d8e5]"
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
/* Three sensors                                                       */
/* ------------------------------------------------------------------ */

function Row({ label, value, colour }: { label: string; value: string; colour?: string }) {
  const missing = value === UNAVAILABLE;
  return (
    <div className="flex items-baseline justify-between gap-2 py-[1.5px]">
      <span className="text-[10px] uppercase tracking-[0.05em] text-[#6f8ba0]">
        {label}
      </span>
      <span
        className="tnum text-[12px] font-semibold"
        style={{ color: missing ? "#5d7688" : (colour ?? "#eef5fa") }}
      >
        {value}
      </span>
    </div>
  );
}

function Head({
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
      <span className="text-[10px] font-bold tracking-[0.05em]" style={{ color: colour }}>
        {status}
      </span>
    </div>
  );
}

export function LiveSensorsPanel() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);
  const offline = link === "offline" || !state;

  const rng = state?.range;
  const pir = state?.pir;
  const vib = state?.vibration;
  const valid = !!rng?.valid && link === "online";
  const closing = valid ? (rng?.closing_cm_s ?? null) : null;
  const ttz = valid ? (rng?.time_to_boundary_s ?? null) : null;

  const rangeS = offline
    ? { t: "OFFLINE", c: "#ff4343" }
    : link === "stale"
      ? { t: "STALE", c: "#f5a623" }
      : valid
        ? { t: "ONLINE", c: "#31d17c" }
        : { t: "NO ECHO", c: "#f5a623" };

  const pirS = offline
    ? { t: "OFFLINE", c: "#ff4343" }
    : pir?.warming_up
      ? { t: "WARMING UP", c: "#f5a623" }
      : pir?.suspect_stuck
        ? { t: "OUTPUT STUCK", c: "#f5a623" }
        : pir?.motion_detected
          ? { t: "MOTION", c: "#ff4343" }
          : { t: "CLEAR", c: "#31d17c" };

  const vibS = offline
    ? { t: "OFFLINE", c: "#ff4343" }
    : !vib?.online
      ? { t: "CALIBRATING", c: "#f5a623" }
      : vib.triggered
        ? { t: "IMPACT", c: "#ff4343" }
        : { t: "NORMAL", c: "#31d17c" };

  return (
    <Panel className="shrink-0 px-3.5 pb-3 pt-3">
      <PanelLabel
        right={
          <span className="tnum text-[10.5px] font-semibold text-[#c4d8e5]">
            {offline ? 0 : state.sensors_online} / 3
          </span>
        }
      >
        Sensor Fusion
      </PanelLabel>

      <div className="mt-2">
        <Head
          icon={<Ruler size={12} strokeWidth={2} />}
          name="HC-SR04"
          status={rangeS.t}
          colour={rangeS.c}
        />
        <div
          className="tnum mt-1 font-bold leading-none tracking-[-0.01em]"
          style={{ fontSize: "var(--t-stat)", color: valid ? "#f3f7fa" : "#5d7688" }}
        >
          {valid ? fmtNumber(rng?.distance_cm ?? null, 1, "cm") : UNAVAILABLE}
        </div>
        <div className="mt-1">
          <Row
            label="Approach"
            value={valid ? fmtNumber(closing, 1, "cm/s") : UNAVAILABLE}
            colour={closing !== null && closing > 0 ? "#f5a623" : undefined}
          />
          <Row
            label="Boundary ETA"
            value={fmtTtz(state ?? null)}
            colour={ttz !== null && ttz <= 2 ? "#ff4343" : ttz !== null ? "#f5a623" : undefined}
          />
          <Row
            label="Rate"
            value={offline ? UNAVAILABLE : fmtNumber(rng?.sample_rate_hz ?? null, 1, "Hz")}
          />
        </div>
      </div>

      <div className="mt-2 border-t border-[#12293c] pt-1.5">
        <Head
          icon={<User size={12} strokeWidth={2} />}
          name="HC-SR501"
          status={pirS.t}
          colour={pirS.c}
        />
        {pir?.suspect_stuck && (
          <div className="mt-0.5 text-[9.5px] leading-[1.35] text-[#f5a623]">
            Held high {Math.round((pir.high_for_ms ?? 0) / 1000)} s. Excluded
            from the score - turn the module delay pot down.
          </div>
        )}
      </div>

      <div className="mt-1.5 border-t border-[#12293c] pt-1.5">
        <Head
          icon={<Waves size={12} strokeWidth={2} />}
          name="SW-420"
          status={vibS.t}
          colour={vibS.c}
        />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Physical outputs + link                                             */
/* ------------------------------------------------------------------ */

function Lamp({ on, colour, label }: { on: boolean; colour: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="h-[17px] w-[17px] rounded-full border transition-all duration-150"
        style={{
          background: on ? colour : "#0d2536",
          borderColor: on ? colour : "#1b4462",
          boxShadow: on ? `0 0 10px ${colour}` : "none",
        }}
      />
      <span className="text-[8.5px] tracking-[0.05em] text-[#6f8ba0]">{label}</span>
    </div>
  );
}

export function LiveOutputsPanel() {
  const out = useLive((s) => s.state?.outputs);
  const link = useLive((s) => s.link);
  const rtt = useLive((s) => s.state?.bridge_roundtrip_ms ?? null);
  const send = useLive((s) => s.send);
  const pending = useLive((s) => s.commandPending);
  const offline = link === "offline" || !out;

  return (
    <Panel className="shrink-0 px-3.5 pb-2.5 pt-3">
      <PanelLabel
        right={
          <button
            type="button"
            disabled={offline || pending}
            onClick={() => void send("lamp_test")}
            className="flex items-center gap-1 rounded-[4px] border border-[#1c4a63] bg-[#0b2233] px-2 py-[3px] text-[9px] font-semibold tracking-[0.05em] text-[#7fd8ef] transition-colors hover:bg-[#102d42] disabled:opacity-40"
          >
            <Lightbulb size={10} strokeWidth={2} />
            TEST
          </button>
        }
      >
        Outputs &middot; D3 D4 D5
      </PanelLabel>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-4">
          <Lamp on={!offline && out.green_led} colour="#31d17c" label="GREEN" />
          <Lamp on={!offline && out.yellow_led} colour="#f5a623" label="YELLOW" />
          <Lamp on={!offline && out.red_led} colour="#ff4343" label="RED" />
        </div>
        <div className="text-right text-[9.5px] leading-[1.5] text-[#5d7688]">
          <div className="tnum">
            MCU {rtt === null || offline ? "--" : `${Math.round(rtt)} ms`}
          </div>
          <div>servo {offline ? "--" : out.servo_commanded_state}</div>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Operator                                                            */
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
            // Reset stands for a physical inspection, so it is confirmed rather
            // than fired from a single click.
            if (
              window.confirm(
                "Confirm the demonstration zone has been physically inspected and is clear.\n\n" +
                  "The MCU still refuses the release unless the range is valid and steady beyond 50 cm for 2 s, with no personnel motion and no active vibration."
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
      {note && (
        <div className="mt-1.5 text-[10px] leading-[1.4] text-[#6f8ba0]">{note}</div>
      )}
    </Panel>
  );
}
