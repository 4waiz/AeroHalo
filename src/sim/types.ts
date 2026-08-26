/**
 * AeroHalo - core domain model.
 *
 * World space is the Three.js frame, in METRES:
 *   +X = stand right (the right wing side)
 *   +Y = up
 *   -Z = aircraft nose direction / toward the terminal
 * The parked aircraft sits at the world origin with its nose pointing down -Z,
 * which matches the Blender export contract (nose = +Y in Blender -> -Z in glTF).
 */

export type Vec2 = { x: number; z: number };

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type SafetyStatus = "SAFE" | "CAUTION" | "CRITICAL";

export type ClearanceStatus = "CLEAR" | "CAUTION" | "HOLD";

export type ZoneId = "safe" | "caution" | "critical" | "engine";

export type EngineState = "OFF" | "STARTING" | "RUNNING" | "SPOOLDOWN";

export type TrackedKind = "vehicle" | "person" | "fod" | "aircraft";

/** Classes the (simulated) vision model can emit. */
export type DetectionClass =
  | "Baggage Cart"
  | "Baggage Tractor"
  | "Pushback Tug"
  | "Service Vehicle"
  | "Utility Vehicle"
  | "Belt Loader"
  | "Person"
  | "FOD"
  | "Aircraft";

/* ------------------------------------------------------------------ */
/* Aircraft                                                            */
/* ------------------------------------------------------------------ */

export interface AircraftPart {
  /** Human label used in alerts, e.g. "Left Wing". */
  name: string;
  /** Capsule segment start (world XZ). */
  a: Vec2;
  /** Capsule segment end (world XZ). */
  b: Vec2;
  /** Capsule radius in metres. */
  r: number;
  /** Weighting used by the risk engine - engines and wings are worse to hit. */
  severityWeight: number;
}

export interface Aircraft {
  id: string;
  type: string;
  registration: string;
  stand: string;
  /** Signed metres; the parked aircraft stays at the origin. */
  position: Vec2;
  headingRad: number;
  engines: {
    left: EngineState;
    right: EngineState;
    /** 0..1 spool factor driving fan rotation + hazard zone size. */
    spool: number;
  };
  beacon: boolean;
  /** Collision hull, refreshed whenever the aircraft moves. */
  parts: AircraftPart[];
}

/* ------------------------------------------------------------------ */
/* Ground vehicles                                                     */
/* ------------------------------------------------------------------ */

export type VehicleModel =
  | "baggageTractor"
  | "pushbackTug"
  | "utilityVan"
  | "beltLoader"
  | "serviceTruck";

export type VehicleState =
  | "IDLE"
  | "MOVING"
  | "BRAKING"
  | "STOPPED"
  | "AUTO_STOPPED"
  | "HOLDING";

export interface Route {
  id: string;
  name: string;
  points: Vec2[];
  /** Loop back to the first point when the last one is reached. */
  loop: boolean;
  /** Metres per second the vehicle aims for on this route. */
  cruise: number;
}

export interface GroundVehicle {
  id: string;
  callsign: string;
  model: VehicleModel;
  detectionClass: DetectionClass;
  position: Vec2;
  /** Radians. 0 = facing -Z, the same convention as the aircraft. */
  headingRad: number;
  /** Metres per second. */
  speed: number;
  targetSpeed: number;
  accel: number;
  brakeAccel: number;
  state: VehicleState;
  routeId: string | null;
  /** Index of the waypoint currently being driven toward. */
  waypoint: number;
  /** Whether the vehicle tows a baggage dolly train. */
  towsDolly: boolean;
  /** Extents used for the AI bounding box and the hull tests. */
  size: { l: number; w: number; h: number };
  /** Written by the collision engine every tick. */
  prediction: CollisionPrediction | null;
  /** Zone the vehicle currently occupies. */
  zone: ZoneId | null;
  /** Auto-stop latch so the intervention only fires once. */
  autoStopped: boolean;
  /** Seconds remaining before the vehicle may resume after an auto stop. */
  holdTimer: number;
  /** Roof beacon flashing. */
  beacon: boolean;
  visible: boolean;
}

/* ------------------------------------------------------------------ */
/* Personnel                                                           */
/* ------------------------------------------------------------------ */

export type PersonState = "IDLE" | "MOVING" | "WORKING" | "EVACUATING";

export interface Person {
  id: string;
  role: string;
  position: Vec2;
  headingRad: number;
  speed: number;
  targetSpeed: number;
  state: PersonState;
  path: Vec2[];
  waypoint: number;
  /** Seconds to linger at the current waypoint. */
  dwell: number;
  /** Animation phase for the procedural walk cycle. */
  gait: number;
  zone: ZoneId | null;
  /** True while inside an active engine hazard area. */
  inEngineHazard: boolean;
  vestColor: string;
  visible: boolean;
}

/* ------------------------------------------------------------------ */
/* FOD                                                                 */
/* ------------------------------------------------------------------ */

export type FodMaterial = "Plastic" | "Metal" | "Tool" | "Baggage" | "Composite";

export interface FodObject {
  id: string;
  material: FodMaterial;
  /** Longest dimension in centimetres, as the vision model would report it. */
  sizeCm: number;
  position: Vec2;
  rotation: number;
  /** Seconds until the classifier reports it - models real inference latency. */
  detectLatency: number;
  detected: boolean;
  /** Confidence 0..1 emitted by the classifier. */
  confidence: number;
  /** True when the debris sits inside the aircraft movement area. */
  inMovementArea: boolean;
  zone: ZoneId | null;
  spawnedAt: number;
}

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

export interface SafetyZone {
  id: ZoneId;
  label: string;
  color: string;
  /** One or more simple polygons in world XZ. */
  polys: Vec2[][];
  /** Base severity contribution used by the risk engine. */
  severity: number;
  /** Render height so overlapping zones stack predictably. */
  y: number;
}

export interface EngineHazardZone {
  side: "left" | "right";
  origin: Vec2;
  /** Intake suction radius in metres. */
  intakeRadius: number;
  /** Exhaust blast length in metres. */
  exhaustLength: number;
  exhaustHalfAngleRad: number;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* Collision prediction                                                */
/* ------------------------------------------------------------------ */

export interface CollisionPrediction {
  /** Seconds until the predicted hull breach, or null if no breach predicted. */
  ttc: number | null;
  /** Distance at the closest point of approach, in metres. */
  dcpa: number;
  /** Seconds until the closest point of approach. */
  tcpa: number;
  /** Current shortest distance to the aircraft hull, in metres. */
  distance: number;
  /** Which aircraft part is threatened, e.g. "Left Wing". */
  part: string;
  /** Sampled future positions used for the dashed trajectory ribbon. */
  path: Vec2[];
  /** 0..10 hazard rating for this single interaction. */
  risk: number;
  level: Severity;
}

/* ------------------------------------------------------------------ */
/* Hazards - the normalised feed into the risk engine                  */
/* ------------------------------------------------------------------ */

export type HazardSource = "collision" | "fod" | "intrusion" | "engine" | "zone";

export interface Hazard {
  id: string;
  source: HazardSource;
  /** Entity the hazard belongs to, so alerts can focus the camera on it. */
  targetId: string;
  targetKind: TrackedKind;
  /** 0..10 */
  risk: number;
  level: Severity;
  title: string;
  location: string;
  /** Optional live metric line, e.g. "TTC 2.1 s | 6.4 m". */
  detail?: string;
  ttc?: number | null;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Alerts + events                                                     */
/* ------------------------------------------------------------------ */

export interface Alert {
  id: string;
  hazardId: string;
  level: Severity;
  title: string;
  location: string;
  detail?: string;
  /** 0..10, shown as "9.1/10". */
  risk: number;
  ttc?: number | null;
  targetId: string;
  targetKind: TrackedKind;
  /** Simulation clock, ms. */
  timestamp: number;
  acknowledged: boolean;
  /** Set when the underlying hazard clears; the card then fades out. */
  resolvedAt: number | null;
}

export interface SafetyEvent {
  id: string;
  timestamp: number;
  level: Severity;
  message: string;
  location: string;
  targetId?: string;
  targetKind?: TrackedKind;
}

/* ------------------------------------------------------------------ */
/* Sensors, cameras                                                    */
/* ------------------------------------------------------------------ */

export type SensorKind = "lidar" | "radar" | "ultrasonic" | "thermal" | "env";

export interface Sensor {
  id: string;
  kind: SensorKind;
  label: string;
  online: boolean;
  /** Last reading; units depend on kind. */
  value: number;
  /** 0..100 */
  health: number;
  position: Vec2;
}

export interface CameraFeed {
  id: string;
  label: string;
  online: boolean;
  /** 0..100 */
  quality: number;
  /** Latency of the vision pipeline in ms. */
  latencyMs: number;
}

export type CameraPresetId = "CAM 01" | "CAM 02" | "CAM 03" | "CAM 04";

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

export interface HeatCell {
  /** Normalised 0..1 across the heatmap footprint. */
  u: number;
  v: number;
  /** 0..1 accumulated intensity; decays over time. */
  intensity: number;
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export type ScenarioId =
  | "normal"
  | "collision"
  | "intrusion"
  | "fod"
  | "multi"
  | "engineStart"
  | "clear"
  | "reset";

/* ------------------------------------------------------------------ */
/* UI snapshot - what React actually subscribes to                     */
/* ------------------------------------------------------------------ */

export interface TrackedOverlay {
  id: string;
  kind: TrackedKind;
  cls: DetectionClass;
  label: string;
  /** e.g. "8 km/h", "Moving", "6 cm" */
  line1: string;
  line2?: string;
  level: Severity;
  confidence: number;
  /** World-space anchor plus an approximate box size for projection. */
  x: number;
  y: number;
  z: number;
  boxW: number;
  boxH: number;
}

export interface InterventionBanner {
  id: string;
  title: string;
  lines: string[];
  at: number;
}

export interface SimSnapshot {
  /** Simulation wall clock in ms. */
  clock: number;
  running: boolean;
  riskScore: number;
  safetyStatus: SafetyStatus;
  clearance: ClearanceStatus;
  clearanceReason: string;
  activeAlerts: Alert[];
  events: SafetyEvent[];
  hazards: Hazard[];
  zoneIntegrity: number;
  sensorsOnline: number;
  sensorsTotal: number;
  camerasOnline: number;
  camerasTotal: number;
  cameraHealth: number;
  inferenceAccuracy: number;
  responseMs: number;
  engineState: EngineState;
  engineSpool: number;
  heat: HeatCell[];
  overlays: TrackedOverlay[];
  intervention: InterventionBanner | null;
  autoStop: boolean;
  autoTracking: boolean;
  muted: boolean;
  vehicleCount: number;
  personCount: number;
  fodCount: number;
  peakHazardId: string | null;
  demoActive: boolean;
  demoElapsed: number;
  demoCaption: string;
}
