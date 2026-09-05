"use client";

import {
  AlertTriangle,
  Bell,
  Cpu,
  Eraser,
  HardDrive,
  Info,
  Radio,
} from "lucide-react";
import { Panel, PanelLabel } from "./ui";
import { UNAVAILABLE, fmtNumber, useLive } from "@/live/liveStore";
import type { UnoQEvent } from "@/hardware/unoq/types";

/**
 * LIVE HARDWARE right column.
 *
 * Alerts and events come from the board's own log, so what is shown here is
 * what the hardware actually decided. The System Summary deliberately carries
 * no AI-accuracy figure: nothing in this build measures model accuracy, and
 * detection confidence is not the same quantity.
 */

const SEV_COLOUR: Record<string, string> = {
  HOLD: "#ff4343",
  CRITICAL: "#ff4343",
  ERROR: "#ff4343",
  HIGH: "#f5a623",
  CAUTION: "#f5a623",
  OPERATOR: "#7fd8ef",
  STARTUP: "#7fd8ef",
  CLEAR: "#31d17c",
  INFO: "#8fa7b8",
  UNKNOWN: "#8fa7b8",
};

function sevColour(s: string) {
  return SEV_COLOUR[s.toUpperCase()] ?? "#8fa7b8";
}

/* ------------------------------------------------------------------ */
/* Active alerts, straight from the board                              */
/* ------------------------------------------------------------------ */

/**
 * Shared empty array.
 *
 * A selector must never build a fresh object: zustand compares snapshots with
 * Object.is, so `s.state?.alerts ?? []` hands back a new array every render and
 * React spins until it throws "Maximum update depth exceeded".
 */
const NO_ALERTS: string[] = [];

export function LiveAlertsPanel() {
  const alerts = useLive((s) => s.state?.risk.reasons ?? NO_ALERTS);
  const link = useLive((s) => s.link);
  const hold = useLive((s) => s.state?.hold.latched ?? false);

  return (
    <Panel className="min-h-0 flex-1 overflow-hidden px-3.5 pb-3 pt-3">
      <PanelLabel
        right={
          <span className="tnum rounded-full bg-[#12293c] px-2 py-[1px] text-[10.5px] font-semibold text-[#c4d8e5]">
            {alerts.length}
          </span>
        }
      >
        Live Alerts &middot; Hardware
      </PanelLabel>

      <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {link === "offline" && (
          <div className="rounded-[5px] border border-[#7a2028] bg-[#1c0c0f] px-2.5 py-2 text-[11.5px] leading-[1.5] text-[#ff8a8a]">
            UNO Q offline. No hardware alerts are being received.
          </div>
        )}

        {alerts.map((a, i) => (
          <div
            key={`${i}-${a}`}
            className="rounded-[5px] border border-[#14384f] bg-[#06182a] px-2.5 py-2"
            style={{
              borderLeftWidth: 3,
              borderLeftColor: hold ? "#ff4343" : "#f5a623",
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={13}
                strokeWidth={2}
                className="mt-[2px] shrink-0"
                style={{ color: hold ? "#ff4343" : "#f5a623" }}
              />
              <span className="text-[11.5px] leading-[1.5] text-[#dce8f1]">
                {a}
              </span>
            </div>
          </div>
        ))}

        {link !== "offline" && alerts.length === 0 && (
          <div className="flex items-center gap-2 rounded-[5px] border border-[#14384f] bg-[#06182a] px-2.5 py-2 text-[11.5px] text-[#8fa7b8]">
            <Bell size={13} strokeWidth={2} className="text-[#31d17c]" />
            No active hardware alerts.
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Event log, mirrored from the board                                  */
/* ------------------------------------------------------------------ */

function shortTime(utc: string) {
  // The board stamps ISO UTC; show just the wall time to keep rows narrow.
  const t = utc.slice(11, 19);
  return t || utc;
}

export function LiveEventTimeline() {
  const events = useLive((s) => s.events);
  const link = useLive((s) => s.link);
  const send = useLive((s) => s.send);
  const pending = useLive((s) => s.commandPending);
  const offline = link === "offline";

  return (
    <Panel
      className="min-h-0 shrink-0 overflow-hidden px-3.5 pb-3 pt-3"
      style={{ height: "32%" }}
    >
      <PanelLabel
        right={
          /* Clears the on-screen log so a demo run starts from a clean slate.
             The board keeps writing every event to events.jsonl regardless -
             a safety log an operator can erase would not be a safety log, so
             this empties the view and records that it happened. */
          <button
            type="button"
            disabled={offline || pending || events.length === 0}
            onClick={() => void send("clear_events")}
            title="Clear the on-screen log. The board's events.jsonl record is kept."
            className="flex items-center gap-1 rounded-[4px] border border-[#1c4a63] bg-[#0b2233] px-2 py-[3px] text-[9px] font-semibold tracking-[0.05em] text-[#7fd8ef] transition-colors hover:bg-[#102d42] disabled:opacity-40"
          >
            <Eraser size={10} strokeWidth={2} />
            CLEAR
          </button>
        }
      >
        Safety Timeline &middot; Board Event Log
      </PanelLabel>
      <div className="mt-2 min-h-0 flex-1 space-y-[3px] overflow-y-auto pr-0.5">
        {events.length === 0 && (
          <div className="px-1 py-2 text-[11px] text-[#5d7688]">
            No events received yet.
          </div>
        )}
        {events.map((e: UnoQEvent, i) => (
          <div
            key={`${e.utc}-${i}`}
            className="flex items-start gap-2 rounded-[4px] px-1.5 py-[5px] hover:bg-[#0a1d2c]"
          >
            <span className="tnum mt-[1px] shrink-0 text-[10.5px] text-[#4f6d82]">
              {shortTime(e.utc)}
            </span>
            <span
              className="mt-[1px] shrink-0 text-[9.5px] font-bold tracking-[0.06em]"
              style={{ color: sevColour(e.severity), minWidth: 58 }}
            >
              {e.severity.toUpperCase()}
            </span>
            <span className="text-[11px] leading-[1.45] text-[#b7cbd9]">
              {e.message}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* System summary, measured only                                       */
/* ------------------------------------------------------------------ */

function Tile({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  const missing = value === UNAVAILABLE;
  return (
    <div className="flex flex-col items-center justify-center rounded-[5px] border border-[#14384f] bg-[#06182a] px-1.5 py-2.5">
      <span className="mb-1.5 text-[#7d97ab]">{icon}</span>
      <span
        className="tnum font-bold leading-none"
        style={{
          fontSize: missing ? 11 : 17,
          color: missing ? "#5d7688" : "#f3f7fa",
        }}
      >
        {missing ? "N/A" : value}
      </span>
      <span className="mt-1.5 text-center text-[9px] leading-[1.3] tracking-[0.04em] text-[#6f8ba0]">
        {label}
      </span>
    </div>
  );
}

export function LiveSystemSummaryPanel() {
  const state = useLive((s) => s.state);
  const link = useLive((s) => s.link);
  const fetchMs = useLive((s) => s.fetchMs);
  const connected = !!state?.hardware_connected && link !== "offline";

  return (
    <Panel className="shrink-0 px-3.5 pb-3 pt-3">
      <PanelLabel>System Summary &middot; Measured</PanelLabel>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <Tile
          icon={<Radio size={14} strokeWidth={2} />}
          value={
            connected
              ? `${state!.sensors_online} / ${state!.sensors_total}`
              : "0 / 3"
          }
          label="SENSORS ONLINE"
        />
        <Tile
          icon={<Cpu size={14} strokeWidth={2} />}
          value={
            connected
              ? fmtNumber(state?.range.sample_rate_hz ?? null, 1, "Hz").replace(
                  " Hz",
                  "",
                )
              : UNAVAILABLE
          }
          label="MCU SAMPLE RATE (Hz)"
        />
        <Tile
          icon={<Info size={14} strokeWidth={2} />}
          value={
            state?.bridge_roundtrip_ms === null ||
            state?.bridge_roundtrip_ms === undefined
              ? UNAVAILABLE
              : `${Math.round(state.bridge_roundtrip_ms)}`
          }
          label="BRIDGE ROUND TRIP (ms)"
        />
        <Tile
          icon={<HardDrive size={14} strokeWidth={2} />}
          value={fetchMs === null ? UNAVAILABLE : `${fetchMs}`}
          label="HTTP ROUND TRIP (ms)"
        />
      </div>
    </Panel>
  );
}
