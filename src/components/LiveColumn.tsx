"use client";

import { Lightbulb, Ruler, User, Volume2, VolumeX, Waves } from "lucide-react";
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
  const cleared = state?.hold.hazard_cleared ?? false;
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
              : status === "HOLD" && cleared
                ? "All sensors SAFE. Held open pending inspection."
                : status === "HOLD"
                  ? "Interlock latched. Inspect, then reset."
                  : status === "UNKNOWN"
                    ? "Sensor data unavailable"
                    : `Risk ${score ?? "--"} / 100`}
          </div>
        </div>

        <svg
          viewBox="0 0 200 86"
          className="w-[112px] shrink-0 overflow-visible"
        >
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
            y={CY - 10}
            textAnchor="middle"
            className="tnum"
            fill={known ? "#f3f7fa" : "#5d7688"}
            style={{ fontSize: known ? 32 : 15, fontWeight: 700 }}
          >
            {known ? Math.round(score) : "N/A"}
            {known && (
              <tspan style={{ fontSize: 15, fontWeight: 600 }} fill="#8fa7b8">
                %
              </tspan>
            )}
          </text>
          {known && (
            <text
              x={CX}
              y={CY + 6}
              textAnchor="middle"
              fill="#6f8ba0"
              style={{ fontSize: 9.5, letterSpacing: "0.12em" }}
            >
              RISK
            </text>
          )}
        </svg>
      </div>

      {/* The dashboard has to be able to say WHY, not just what. */}
      <div className="mt-2 border-t border-[#12293c] pt-1.5">
        <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-[#6f8ba0]">
          Why
        </div>
        {reasons.length === 0 ? (
          <div className="text-[11px] text-[#5d7688]">
            No contributing conditions
          </div>
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

/**
 * One sensor row: name, its own SAFE / CAUTION / HOLD chip, and the detail.
 *
 * The chip comes from the board, not from logic re-derived here. Each sensor
 * carries its own severity on the same vocabulary as the fused state, so an
 * operator can see WHICH input is driving the system rather than only the
 * verdict.
 */
function Head({
  icon,
  name,
  state,
  detail,
}: {
  icon: React.ReactNode;
  name: string;
  state: UnoQStatus;
  detail?: string;
}) {
  const c = COLOUR[state];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#c4d8e5]">
          <span className="text-[#7d97ab]">{icon}</span>
          {name}
        </span>
        <span
          className="rounded-[3px] px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.07em]"
          style={{ color: c, background: `${c}1f`, border: `1px solid ${c}55` }}
        >
          {state}
        </span>
      </div>
      {detail && (
        <div className="mt-0.5 text-[9.5px] leading-[1.35] text-[#6f8ba0]">
          {detail}
        </div>
      )}
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

  const st = (v: UnoQStatus | undefined): UnoQStatus =>
    offline ? "UNKNOWN" : (v ?? "UNKNOWN");

  return (
    /* This is the left column's growing panel, mirroring LiveAlertsPanel on the
       right: it absorbs the slack so the stack ends flush with the bottom of
       the grid row instead of floating above it. Everything else stays
       shrink-0 at its natural height. */
    <Panel className="min-h-0 flex-1 px-3.5 pb-3 pt-3">
      <PanelLabel
        right={
          <span className="tnum text-[10.5px] font-semibold text-[#c4d8e5]">
            {offline ? 0 : state.sensors_online} / 3
          </span>
        }
      >
        Sensor Fusion
      </PanelLabel>

      {/* Scrolls internally rather than pushing the column, so a short viewport
          shrinks this one panel and leaves the operator controls reachable. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mt-2">
          <Head
            icon={<Ruler size={12} strokeWidth={2} />}
            name="HC-SR04 proximity"
            state={st(rng?.state)}
            detail={offline ? "No telemetry" : rng?.detail}
          />
          <div
            className="tnum mt-1 font-bold leading-none tracking-[-0.01em]"
            style={{
              fontSize: "var(--t-stat)",
              color: valid ? "#f3f7fa" : "#5d7688",
            }}
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
              colour={
                ttz !== null && ttz <= 2
                  ? "#ff4343"
                  : ttz !== null
                    ? "#f5a623"
                    : undefined
              }
            />
            <Row
              label="Rate"
              value={
                offline
                  ? UNAVAILABLE
                  : fmtNumber(rng?.sample_rate_hz ?? null, 1, "Hz")
              }
            />
          </div>
        </div>

        <div className="mt-2 border-t border-[#12293c] pt-1.5">
          <Head
            icon={<User size={12} strokeWidth={2} />}
            name="HC-SR501 personnel"
            state={st(pir?.state)}
            detail={offline ? "No telemetry" : pir?.detail}
          />
        </div>

        <div className="mt-1.5 border-t border-[#12293c] pt-1.5">
          <Head
            icon={<Waves size={12} strokeWidth={2} />}
            name="SW-420 vibration"
            state={st(vib?.state)}
            detail={offline ? "No telemetry" : vib?.detail}
          />
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Physical outputs + link                                             */
/* ------------------------------------------------------------------ */

function Lamp({
  on,
  colour,
  label,
}: {
  on: boolean;
  colour: string;
  label: string;
}) {
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
      <span className="text-[8.5px] tracking-[0.05em] text-[#6f8ba0]">
        {label}
      </span>
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
            title="Walks the three LEDs, and sweeps the buzzer: steady drive on green, silence on yellow, 2.7 kHz on red. Whichever half you hear names the part."
            className="flex items-center gap-1 rounded-[4px] border border-[#1c4a63] bg-[#0b2233] px-2 py-[3px] text-[9px] font-semibold tracking-[0.05em] text-[#7fd8ef] transition-colors hover:bg-[#102d42] disabled:opacity-40"
          >
            <Lightbulb size={10} strokeWidth={2} />
            TEST
          </button>
        }
      >
        Outputs &middot; D3 D4 D5 &middot; D11
      </PanelLabel>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-4">
          <Lamp on={!offline && out.green_led} colour="#31d17c" label="GREEN" />
          <Lamp
            on={!offline && out.yellow_led}
            colour="#f5a623"
            label="YELLOW"
          />
          <Lamp on={!offline && out.red_led} colour="#ff4343" label="RED" />
          {/* Chirp rate, not volume: an active buzzer has one tone, so urgency
              is carried by how often it fires. */}
          <div className="flex flex-col items-center gap-1">
            <span
              className="flex h-[17px] w-[17px] items-center justify-center rounded-full border transition-all duration-100"
              style={{
                background: !offline && out.buzzer_on ? "#7fd8ef" : "#0d2536",
                borderColor: !offline && out.buzzer_on ? "#7fd8ef" : "#1b4462",
                boxShadow:
                  !offline && out.buzzer_on ? "0 0 10px #7fd8ef" : "none",
                color: !offline && out.buzzer_on ? "#04121f" : "#4f6d82",
              }}
            >
              {!offline && (out.buzzer_gap_ms ?? 0) > 0 ? (
                <Volume2 size={10} strokeWidth={2.4} />
              ) : (
                <VolumeX size={10} strokeWidth={2.4} />
              )}
            </span>
            <span className="text-[8.5px] tracking-[0.05em] text-[#6f8ba0]">
              BUZZER
            </span>
          </div>
        </div>
        <div className="text-right text-[9.5px] leading-[1.5] text-[#5d7688]">
          <div className="tnum">
            MCU {rtt === null || offline ? "--" : `${Math.round(rtt)} ms`}
          </div>
          <div className="tnum">
            {offline || !out.buzzer_gap_ms
              ? "buzzer silent"
              : `chirp ${out.buzzer_gap_ms} ms`}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Operator                                                            */
/* ------------------------------------------------------------------ */

export function LiveOperatorPanel() {
  const cleared = useLive((s) => s.state?.hold.hazard_cleared ?? false);
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
                  "The MCU still refuses the release unless the range is valid and steady beyond 50 cm for 2 s, with no active vibration.",
              )
            ) {
              void send("clear_after_inspection");
            }
          }}
          className={`rounded-[5px] border px-2 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
            cleared
              ? "border-[#31d17c] bg-[#0d2a1e] text-[#7ff0c0] hover:bg-[#123a2a]"
              : "border-[#1c4a63] bg-[#0b2233] text-[#7fd8ef] hover:bg-[#102d42]"
          }`}
        >
          Reset after inspection
        </button>
      </div>
      {note && (
        <div className="mt-1.5 text-[10px] leading-[1.4] text-[#6f8ba0]">
          {note}
        </div>
      )}
    </Panel>
  );
}
