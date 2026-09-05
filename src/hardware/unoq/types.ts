/**
 * Wire types for the Arduino UNO Q telemetry service (schema_version 3).
 *
 * These mirror exactly what the App Lab Python application serves from
 * GET /api/state. Do not add fields the board does not actually send:
 * everything here is meant to be a truthful description of the hardware, and
 * LIVE HARDWARE mode renders it directly.
 *
 * Source of truth: hardware/uno-q/app/python/main.py in this repository.
 */

/** Fused safety state. UNKNOWN means "we do not know", not "clear". */
export type UnoQStatus = "SAFE" | "CAUTION" | "HOLD" | "UNKNOWN";

/** HC-SR04. Every measurement is nullable; null means UNAVAILABLE, never 0. */
export interface UnoQRange {
  online: boolean;
  valid: boolean;
  distance_cm: number | null;
  /** Unfiltered single ping, so sensor noise stays visible. */
  raw_distance_cm: number | null;
  /** Positive means closing on the boundary. */
  closing_cm_s: number | null;
  /** Predicted seconds to the CONFIGURED boundary, not to a collision. */
  time_to_boundary_s: number | null;
  sample_age_ms: number | null;
  sample_sequence: number | null;
  /** Measured, not nominal. Null until a rate has actually been observed. */
  sample_rate_hz: number | null;
  detail: string;
}

/** HC-SR501. Presence only — this sensor cannot identify anyone. */
export interface UnoQPir {
  online: boolean;
  /** True during the post-power-on settle window; readings are ignored. */
  warming_up: boolean;
  motion_detected: boolean;
  last_trigger_ms: number | null;
  detail: string;
}

/** SW-420. Polarity is learned at boot, never assumed. */
export interface UnoQVibration {
  online: boolean;
  triggered: boolean;
  last_trigger_ms: number | null;
  /** "unverified" until the idle level has been learned. */
  polarity: "unverified" | "active-high" | "active-low";
  detail: string;
}

/** What the MCU is actually driving, so the screen matches the table. */
export interface UnoQOutputs {
  green_led: boolean;
  yellow_led: boolean;
  red_led: boolean;
  /** Power-on lamp test completed. */
  self_test_done: boolean;
  servo_enabled: boolean;
  servo_commanded_state: string;
}

export interface UnoQRisk {
  /** 0..100, or null when there is nothing measured to score. */
  score: number | null;
  state: UnoQStatus;
  /** Why the state is what it is. Rendered verbatim. */
  reasons: string[];
}

export interface UnoQHold {
  latched: boolean;
  reason: string;
  since: string | null;
}

export interface UnoQEvent {
  utc: string;
  severity: string;
  message: string;
}

export interface UnoQState {
  schema_version: number;
  source: string;

  /** True only while MCU telemetry is arriving and fresh. */
  hardware_connected: boolean;

  range: UnoQRange;
  pir: UnoQPir;
  vibration: UnoQVibration;
  outputs: UnoQOutputs;
  risk: UnoQRisk;
  hold: UnoQHold;

  /** Count of sensors actually reporting, out of three. Never inflated. */
  sensors_online: number;
  sensors_total: number;

  /** MCU link latency. Not an AI or vision latency. */
  bridge_roundtrip_ms: number | null;
  /** Seconds since the last successful MCU exchange. */
  telemetry_age_s: number | null;
  last_command: string;
  storage: string;
  updated_at: string | null;
  events: UnoQEvent[];
}

/** How the browser sees the link, independent of what the board claims. */
export type LiveLinkState = "connecting" | "online" | "stale" | "offline";

/** Result of one poll, including transport facts the board cannot know. */
export interface LivePollResult {
  state: UnoQState | null;
  link: LiveLinkState;
  /** Round trip measured in the browser, ms. */
  fetchMs: number | null;
  error: string | null;
  at: number;
}
