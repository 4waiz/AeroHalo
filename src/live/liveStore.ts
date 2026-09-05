"use client";

import { create } from "zustand";
import {
  pollState,
  sendCommand,
  type UnoQCommand,
} from "@/hardware/unoq/client";
import type {
  LiveLinkState,
  UnoQEvent,
  UnoQState,
} from "@/hardware/unoq/types";

/**
 * LIVE HARDWARE state.
 *
 * Deliberately separate from the simulation store. The simulation may invent
 * vehicles, personnel and FOD because that is its job; this store must only
 * ever contain values the Arduino UNO Q actually measured. Anything the board
 * could not measure stays null here and is rendered as UNAVAILABLE.
 *
 * Nothing in this file writes into the simulation snapshot, so switching modes
 * cannot leak synthetic numbers into LIVE or real numbers into SIM.
 */

export type AeroMode = "simulation" | "live";

/** 10 Hz, matching the MCU sample rate. */
const POLL_MS = 100;
/**
 * Backoff while the board is unreachable. Hammering a disconnected device ten
 * times a second buys nothing and buries the real errors in console noise;
 * once a second still reconnects fast enough to look instant on stage.
 */
const OFFLINE_POLL_MS = 1000;
/** Consecutive failures before backing off. */
const BACKOFF_AFTER = 5;
/** Keep a bounded local mirror of the board's event log. */
const MAX_EVENTS = 200;

interface LiveState {
  mode: AeroMode;
  /** Set once the user has actually opened LIVE, so we do not poll in SIM. */
  polling: boolean;

  state: UnoQState | null;
  link: LiveLinkState;
  /** Browser-measured HTTP round trip. Not an AI latency figure. */
  fetchMs: number | null;
  error: string | null;
  /** Wall clock of the last completed poll, 0 before the first one. */
  lastPollAt: number;
  /** Consecutive failed polls, for the reconnect banner. */
  failures: number;

  events: UnoQEvent[];
  /** Last command result note, shown next to the operator buttons. */
  commandNote: string;
  commandPending: boolean;

  setMode: (m: AeroMode) => void;
  start: () => void;
  stop: () => void;
  send: (c: UnoQCommand) => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

/** Stable identity for an event so repeated polls do not duplicate the log. */
function eventKey(e: UnoQEvent) {
  return `${e.utc}|${e.severity}|${e.message}`;
}

export const useLive = create<LiveState>((set, get) => ({
  mode: "simulation",
  polling: false,

  state: null,
  link: "offline",
  fetchMs: null,
  error: null,
  lastPollAt: 0,
  failures: 0,

  events: [],
  commandNote: "",
  commandPending: false,

  setMode(m) {
    if (get().mode === m) return;
    set({ mode: m });
    if (m === "live") get().start();
    else get().stop();
  },

  start() {
    if (get().polling) return;
    set({ polling: true, link: "connecting" });

    const tick = async () => {
      if (!get().polling) return;
      // Skip rather than queue: a slow board must not build a backlog of
      // requests that then all land at once and look like a burst of samples.
      if (!inFlight) {
        inFlight = true;
        try {
          const r = await pollState();
          const prev = get();
          if (!prev.polling) return;

          if (r.state) {
            // Merge new board events into the local mirror, newest first,
            // skipping any we already hold.
            let events = prev.events;
            if (r.state.events?.length) {
              const seen = new Set(prev.events.map(eventKey));
              const fresh = r.state.events.filter((e) => !seen.has(eventKey(e)));
              if (fresh.length) {
                events = [...fresh, ...prev.events].slice(0, MAX_EVENTS);
              }
            }
            set({
              state: r.state,
              link: r.link,
              fetchMs: r.fetchMs,
              error: null,
              lastPollAt: r.at,
              failures: 0,
              events,
            });
          } else {
            // Keep the last known state visible but mark the link dead, so the
            // operator sees stale numbers labelled as stale instead of a
            // reassuring blank panel.
            set({
              link: "offline",
              fetchMs: null,
              error: r.error,
              lastPollAt: r.at,
              failures: prev.failures + 1,
            });
          }
        } finally {
          inFlight = false;
        }
      }
      const delay =
        get().failures >= BACKOFF_AFTER ? OFFLINE_POLL_MS : POLL_MS;
      timer = setTimeout(tick, delay);
    };
    void tick();
  },

  stop() {
    set({ polling: false, link: "offline" });
    if (timer) clearTimeout(timer);
    timer = null;
  },

  async send(c) {
    set({ commandPending: true });
    const r = await sendCommand(c);
    set({
      commandPending: false,
      commandNote: r.ok ? r.note : `Rejected: ${r.note}`,
    });
  },
}));

/* ------------------------------------------------------------------ */
/* Truthful formatting helpers                                         */
/* ------------------------------------------------------------------ */

/** The single place that turns "no measurement" into visible text. */
export const UNAVAILABLE = "UNAVAILABLE";

export function fmtNumber(
  v: number | null | undefined,
  digits: number,
  unit: string
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return UNAVAILABLE;
  return `${v.toFixed(digits)} ${unit}`;
}

/**
 * Time-to-boundary. Null is a legitimate answer that means "not approaching",
 * which is different from "unknown", so the two read differently.
 */
export function fmtTtz(s: UnoQState | null): string {
  if (!s || !s.connected) return UNAVAILABLE;
  if (!s.sensor_valid) return UNAVAILABLE;
  if (s.ttz_s === null) return "Not approaching";
  return `${s.ttz_s.toFixed(1)} s`;
}

export function fmtAge(s: UnoQState | null): string {
  if (!s || s.telemetry_age_s === null) return UNAVAILABLE;
  return `${Math.round(s.telemetry_age_s * 1000)} ms`;
}

/** What to print for the range sensor itself, never a fabricated count. */
export function sensorSummary(
  s: UnoQState | null,
  link: LiveLinkState
): { label: string; detail: string; ok: boolean } {
  if (link === "offline" || !s) {
    return { label: "UNO Q OFFLINE", detail: "No telemetry service", ok: false };
  }
  if (!s.connected) {
    return {
      label: "0 / 1 Range Sensor Online",
      detail: "Microcontroller not reporting",
      ok: false,
    };
  }
  if (link === "stale") {
    return {
      label: "RANGE SENSOR STALE",
      detail: "Telemetry older than 1.5 s",
      ok: false,
    };
  }
  if (!s.sensor_valid) {
    return {
      label: "1 / 1 Range Sensor Online",
      detail: "No echo: range unknown",
      ok: false,
    };
  }
  return {
    label: "1 / 1 Range Sensor Online",
    detail: "HC-SR04 on D6 / D7",
    ok: true,
  };
}

/** OV7670 status text. Absent is the honest default until SCCB replies. */
export function cameraSummary(s: UnoQState | null): {
  label: string;
  detail: string;
  ok: boolean;
} {
  const cam = s?.camera;
  if (!cam || cam.state === "absent") {
    return {
      label: "OV7670 OFFLINE",
      detail: "No valid camera frames received",
      ok: false,
    };
  }
  if (cam.state === "error") {
    return { label: "OV7670 ERROR", detail: cam.detail, ok: false };
  }
  if (cam.state === "detected") {
    return {
      label: "OV7670 DETECTED",
      detail: cam.sensor_id
        ? `SCCB id ${cam.sensor_id}, no frames yet`
        : "SCCB responding, no frames yet",
      ok: false,
    };
  }
  const res = cam.width && cam.height ? `${cam.width}x${cam.height}` : UNAVAILABLE;
  const fps = cam.fps === null ? UNAVAILABLE : `${cam.fps.toFixed(1)} fps`;
  return { label: "OV7670 ONLINE", detail: `${res} at ${fps}`, ok: true };
}
