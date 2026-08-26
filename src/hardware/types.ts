/**
 * Hardware abstraction layer.
 *
 * The browser demo runs entirely on SimulationProvider. ArduinoProvider
 * implements the same surface against a real Arduino UNO Q, so nothing above
 * this file knows or cares whether a reading came from a physical HC-SR04 or
 * from the simulation. Swapping providers is a one-line change in
 * hardware/index.ts.
 */

export type ProviderId = "simulation" | "arduino";

export type LinkState = "offline" | "connecting" | "online" | "error";

export interface DistanceReading {
  sensorId: string;
  /** Metres. Infinity when nothing is in range. */
  distance: number;
  /** 0..1 confidence in the reading. */
  quality: number;
  /** Provider clock, ms. */
  at: number;
}

export interface EnvironmentReading {
  temperatureC: number;
  humidityPct: number;
  pressureHpa: number;
  windKt: number;
  windDirDeg: number;
  /** Free-text summary shown in the header, e.g. "Overcast". */
  condition: string;
  at: number;
}

export type LedColour = "green" | "amber" | "red" | "off";

export interface LedCommand {
  colour: LedColour;
  /** 0 = solid, otherwise blinks at this many Hz. */
  blinkHz: number;
}

export type BuzzerPattern = "off" | "chirp" | "warning" | "critical" | "clear";

export interface CameraFrameInfo {
  cameraId: string;
  online: boolean;
  /** 0..100 */
  quality: number;
  /** End-to-end vision pipeline latency in milliseconds. */
  latencyMs: number;
  /** Objects the edge model reported in the last frame. */
  detections: number;
}

export interface EmergencyStopState {
  engaged: boolean;
  /** What triggered it, for the audit log. */
  reason: string;
  at: number;
}

/**
 * The full contract. Every method is async so a serial or WebSocket transport
 * can implement it without changing call sites.
 */
export interface HardwareProvider {
  readonly id: ProviderId;
  readonly label: string;

  /** Current link state; the dashboard surfaces this in System Summary. */
  getLinkState(): LinkState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Proximity ring around the stand. */
  readDistance(sensorId: string): Promise<DistanceReading>;
  readAllDistances(): Promise<DistanceReading[]>;

  /** Temperature / humidity / pressure / wind mast. */
  readEnvironment(): Promise<EnvironmentReading>;

  /** Tower warning beacon. */
  setWarningLed(cmd: LedCommand): Promise<void>;

  /** Audible alarm on the ramp. */
  setBuzzer(pattern: BuzzerPattern): Promise<void>;

  /** Latches the ramp emergency stop; this is what Auto Stop drives. */
  setEmergencyStop(engaged: boolean, reason: string): Promise<EmergencyStopState>;
  getEmergencyStop(): EmergencyStopState;

  /** Camera fleet health. */
  readCameraFeeds(): Promise<CameraFrameInfo[]>;
}
