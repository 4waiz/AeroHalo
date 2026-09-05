/**
 * Wire types for the Arduino UNO Q telemetry service.
 *
 * These mirror exactly what the App Lab Python application serves from
 * GET /api/state and GET /api/events. Do not add fields here that the board
 * does not actually send: everything in this file is meant to be a truthful
 * description of the hardware, and LIVE HARDWARE mode renders it directly.
 *
 * Source of truth: uno-q/app/python/main.py in this repository.
 */

/** Board-reported safety state. UNKNOWN means "we do not know", not "clear". */
export type UnoQStatus = "SAFE" | "CAUTION" | "HOLD" | "UNKNOWN";

export interface UnoQDetection {
  label: string;
  confidence: number;
  /** Only present when the installed detector actually reports boxes. */
  box_model_pixels?: [number, number, number, number];
}

export interface UnoQEvent {
  utc: string;
  severity: string;
  message: string;
}

/**
 * GET /api/state. Every measurement is nullable: null means the board could
 * not measure it, and the UI must render that as UNAVAILABLE rather than 0.
 */
export interface UnoQState {
  schema_version: number;
  source: string;

  /** True only while MCU telemetry is arriving and fresh. */
  connected: boolean;
  /** Filtered range in cm, or null when there is no valid echo. */
  distance_cm: number | null;
  /** Unfiltered single ping, useful for showing sensor noise honestly. */
  raw_distance_cm: number | null;
  /** Positive means closing on the boundary. */
  closing_cm_s: number | null;
  /** Predicted seconds until the critical boundary is crossed. */
  ttz_s: number | null;
  /** 0..100, derived deterministically from the measurements. */
  risk: number | null;
  status: UnoQStatus;
  hold: boolean;
  sensor_valid: boolean;

  servo_enabled: boolean;
  engine_on: boolean;

  vision_enabled: boolean;
  vision_latched: boolean;
  vision_seen: boolean;
  detections: UnoQDetection[];
  vision_last_event_age_s: number | null;

  /** Measured MCU sample rate. Null until a rate has actually been observed. */
  sample_rate_hz: number | null;
  alerts: string[];
  bridge_roundtrip_ms: number | null;
  updated_utc: string | null;
  sample_seq: number | null;
  last_command: string;
  storage: string;
  camera_scope: string;
  telemetry_line: string;
  /** Seconds since the last successful MCU exchange. */
  telemetry_age_s: number | null;
  events: UnoQEvent[];

  /* ---- optional camera block, present once the OV7670 path reports ---- */
  camera?: UnoQCameraState;
}

/**
 * OV7670 status. This is a parallel DVP module, not a UVC webcam, so it is
 * reported separately from the App Lab video bricks and starts as "absent".
 */
export interface UnoQCameraState {
  /** "absent" | "detected" | "streaming" | "error" */
  state: "absent" | "detected" | "streaming" | "error";
  /** SCCB identity read back from the module, e.g. "0x76/0x73". */
  sensor_id: string | null;
  width: number | null;
  height: number | null;
  /** Measured, not nominal. */
  fps: number | null;
  /** Seconds since the last frame actually arrived. */
  frame_age_s: number | null;
  detail: string;
}

/** How the browser sees the link, independent of what the board claims. */
export type LiveLinkState =
  | "connecting"
  | "online"
  | "stale"
  | "offline";

/** Result of one poll, including transport-level facts the board cannot know. */
export interface LivePollResult {
  state: UnoQState | null;
  link: LiveLinkState;
  /** Round trip measured in the browser, ms. */
  fetchMs: number | null;
  error: string | null;
  at: number;
}
