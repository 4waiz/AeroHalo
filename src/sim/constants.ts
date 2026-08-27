import type {
  CameraPreset,
  CameraPresetId,
  EngineHazardZone,
  Route,
  SafetyZone,
  Sensor,
  Vec2,
} from "./types";
import type { Airframe } from "./aircraftTypes";
import { octagonPoly, rectPoly, sectorPoly, trapezoidPoly } from "./geometry";

export const STAND_ID = "A12";
export const APRON_NAME = "Stand A12";
export const FACILITY = "AeroHalo Airside";

/** Simulation update rate for the physics/risk core. */
export const SIM_HZ = 60;
/** Rate at which the React-facing snapshot is published. */
export const UI_HZ = 10;

/** Collision-prediction horizon, seconds. */
export const PREDICT_HORIZON = 14;
/** Sample resolution of the predicted trajectory. */
export const PREDICT_STEPS = 34;
/** Buffer added around the aircraft hull when testing for a predicted breach. */
export const HULL_BUFFER = 1.4;

/** TTC thresholds, seconds. */
export const TTC_CAUTION = 8;
export const TTC_HIGH = 5;
export const TTC_CRITICAL = 3;
/** The vehicle brakes at this TTC when Auto Stop is armed. */
export const TTC_AUTOSTOP = 3.4;

export const MAX_EVENTS = 220;
export const MAX_VISIBLE_EVENTS = 5;
export const MAX_ALERTS = 6;

/** Heatmap resolution across the aircraft footprint. */
export const HEAT_COLS = 26;
export const HEAT_ROWS = 18;
/** Per-second decay applied to every heat cell. */
export const HEAT_DECAY = 0.16;

/* ------------------------------------------------------------------ */
/* Apron footprint                                                     */
/* ------------------------------------------------------------------ */

export function apronBounds(s: number) {
  return {
    minX: -72 * s,
    maxX: 72 * s,
    minZ: -46 * s,
    maxZ: 62 * s,
    /** Facade line of the terminal / hangar block. */
    terminalZ: -40 * s,
  };
}

/* ------------------------------------------------------------------ */
/* Safety zones - derived from the selected airframe                   */
/* ------------------------------------------------------------------ */

/**
 * Builds CRITICAL / CAUTION / SAFE areas around the parked aircraft.
 *
 * CRITICAL is deliberately a set of overlapping polygons rather than one
 * outline - a fuselage corridor, a wing band, a nose fan and a tail band -
 * which is how painted apron exclusion areas actually read.
 */
export function buildZones(af: Airframe): SafetyZone[] {
  const e = af.envelope;
  const s = af.worldScale;
  const pad = 2.6 * s;

  const fw = e.fuseHalfW + pad * 0.9;        // half width of the fuselage corridor
  const wingX = e.halfSpan + pad;            // outer edge of the wing blocks
  const tailX = e.tailHalfSpan + pad * 0.85; // outer edge of the tail blocks
  const zNose = e.noseZ - pad;               // front of the corridor
  const zTail = e.tailZ + pad;               // back of the corridor
  const zWing0 = e.wingZ0 - pad;
  const zWing1 = e.wingZ1 + pad;

  // CRITICAL is built as a set of NON-OVERLAPPING blocks. Overlapping
  // translucent polygons compound their alpha and turn the stand into a solid
  // slab of colour, which hides the concrete and the markings underneath.
  const corridor = rectPoly(0, (zNose + zTail) / 2, fw, (zTail - zNose) / 2);

  const wingBlock = (sign: number): Vec2[] =>
    rectPoly(
      sign * (fw + (wingX - fw) / 2),
      (zWing0 + zWing1) / 2,
      (wingX - fw) / 2,
      (zWing1 - zWing0) / 2
    );

  // Aft of the wings, only the tailplane span is restricted.
  const tailBlock = (sign: number): Vec2[] =>
    rectPoly(
      sign * (fw + (tailX - fw) / 2),
      (zWing1 + zTail) / 2,
      (tailX - fw) / 2,
      (zTail - zWing1) / 2
    );

  const noseFan = trapezoidPoly(zNose, fw, e.noseZ - pad * 3.1, fw + pad * 1.0);

  const criticalPolys: Vec2[][] = [corridor, wingBlock(-1), wingBlock(1), noseFan];
  if (zTail - zWing1 > 0.4 * s) {
    criticalPolys.push(tailBlock(-1), tailBlock(1));
  }

  // The operational boundaries sit close to the airframe. Painting them out
  // across the whole apron would tint every pixel of the feed and lose the
  // concrete underneath, which is the opposite of how a real stand reads.
  const cautionHalfX = e.halfSpan + pad * 1.55;
  const caution = octagonPoly(
    cautionHalfX,
    e.noseZ - pad * 2.3,
    e.tailZ + pad * 1.9,
    pad * 1.3
  );

  const safeHalfX = e.halfSpan + pad * 2.9;
  const safe = octagonPoly(
    safeHalfX,
    e.noseZ - pad * 4.1,
    e.tailZ + pad * 3.5,
    pad * 2.2
  );

  return [
    {
      id: "safe",
      label: "SAFE ZONE",
      color: "#31d17c",
      polys: [safe],
      severity: 0.4,
      y: 0.02,
    },
    {
      id: "caution",
      label: "CAUTION ZONE",
      color: "#f5a623",
      polys: [caution],
      severity: 2.0,
      y: 0.05,
    },
    {
      id: "critical",
      label: "CRITICAL ZONE",
      color: "#ff4343",
      polys: criticalPolys,
      severity: 4.2,
      y: 0.08,
    },
  ];
}

/**
 * Intake suction and jet-blast areas. Both grow with engine spool so that a
 * running engine visibly claims more of the apron.
 */
export function buildEngineZones(
  af: Airframe,
  spool: number,
  running: boolean
): EngineHazardZone[] {
  const idle = running ? 0.35 : 0;
  const f = Math.max(idle, spool);
  return (["left", "right"] as const).map((side) => {
    const port = af.engines[side];
    return {
      side,
      origin: port.intake,
      intakeRadius: (1.5 + 4.2 * f) * af.worldScale,
      exhaustLength: (2 + af.blastLength * f) * 1,
      exhaustHalfAngleRad: (14 + 10 * f) * (Math.PI / 180),
      active: f > 0.02,
    };
  });
}

/** Polygon for an intake suction area. */
export const intakeSectorPoly = (af: Airframe, side: "left" | "right", radius: number) =>
  sectorPoly(af.engines[side].intake, Math.PI, radius, Math.PI * 0.62, 18);

/** Polygon for a jet-blast area, projected aft of the nozzle. */
export const exhaustSectorPoly = (
  af: Airframe,
  side: "left" | "right",
  length: number,
  halfAngle: number
) => sectorPoly(af.engines[side].nozzle, 0, length, halfAngle, 16);

/* ------------------------------------------------------------------ */
/* Service routes                                                      */
/* ------------------------------------------------------------------ */

const R = (pts: [number, number][], s: number): Vec2[] =>
  pts.map(([x, z]) => ({ x: x * s, z: z * s }));

export function buildRoutes(af: Airframe): Route[] {
  const s = af.worldScale;
  return [
    {
      id: "svc-loop",
      name: "Perimeter service road",
      loop: true,
      cruise: 5.6,
      points: R(
        [
          [-30, -16],
          [-31, 12],
          [-24, 28],
          [-4, 35],
          [20, 33],
          [31, 21],
          [32, -4],
          [22, -20],
          [2, -26],
          [-18, -24],
        ],
        s
      ),
    },
    {
      id: "bag-run",
      name: "Baggage staging shuttle",
      loop: true,
      cruise: 2.6,
      points: R(
        [
          [29, 19],
          [20, 15],
          [13, 8],
          [9, 1],
          [8.5, -5],
          [13, 3],
          [19, 11],
          [28, 15],
        ],
        s
      ),
    },
    {
      id: "truck-run",
      name: "Utility circuit",
      loop: true,
      cruise: 4.1,
      points: R(
        [
          [-36, 25],
          [-24, 20],
          [-19, 11],
          [-19, -7],
          [-26, -16],
          [-37, -10],
          [-40, 9],
        ],
        s
      ),
    },
    {
      id: "tug-stage",
      name: "Pushback staging",
      loop: false,
      cruise: 2.4,
      points: R(
        [
          [-25, -25],
          [-16, -21],
          [-7, -16],
          [-1.2, -13.5],
        ],
        s
      ),
    },
    {
      id: "conflict-lwing",
      name: "Left wing conflict track",
      loop: false,
      cruise: 2.9,
      points: R(
        [
          [-40, 7.5],
          [-27, 5.2],
          [-16, 3.6],
          [-7.4, 2.8],
        ],
        s
      ),
    },
    {
      id: "conflict-nose",
      name: "Nose conflict track",
      loop: false,
      cruise: 3.2,
      points: R(
        [
          [24, -26],
          [12, -20],
          [3, -14],
          [0.4, -9.2],
        ],
        s
      ),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Personnel patrol paths                                              */
/* ------------------------------------------------------------------ */

export function buildPersonPaths(af: Airframe): Vec2[][] {
  const s = af.worldScale;
  return [
    R(
      [
        [-12, -19.5],
        [10, -21],
        [11, -27],
        [-11, -26],
      ],
      s
    ),
    R(
      [
        [8.5, -3],
        [11.5, 3],
        [15, 8],
        [10, 9],
      ],
      s
    ),
    R(
      [
        [-11, 7.5],
        [-16, 12],
        [-9, 15],
        [-8.5, 10],
      ],
      s
    ),
    R(
      [
        [18, 16],
        [24, 10],
        [22, 2],
        [16, 7],
      ],
      s
    ),
  ];
}

/** Where the intrusion scenario sends a walker. */
export const intrusionTarget = (af: Airframe): Vec2 => ({
  x: af.engines.right.intake.x + 0.4,
  z: af.engines.right.intake.z - 1.4 * af.worldScale,
});

/** Fallback FOD drop points used when nothing better is specified. */
export function fodSpots(af: Airframe): Vec2[] {
  const s = af.worldScale;
  const e = af.envelope;
  return [
    { x: -1.4 * s, z: e.noseZ - 3.2 * s },
    { x: 2.6 * s, z: e.noseZ - 1.6 * s },
    { x: -4.5 * s, z: 3.4 * s },
    { x: 5.2 * s, z: 2.2 * s },
    { x: 0.8 * s, z: e.tailZ + 2.6 * s },
    { x: -7.5 * s, z: -3 * s },
  ];
}

/* ------------------------------------------------------------------ */
/* Camera presets                                                      */
/* ------------------------------------------------------------------ */

export function buildCameraPresets(af: Airframe): Record<CameraPresetId, CameraPreset> {
  const s = af.worldScale;
  // Every mast sits FORWARD of the aircraft looking back down the stand, so the
  // feed shows the nose and both engine intakes - the view an apron camera
  // mounted on the terminal face actually has.
  return {
    "CAM 01": {
      id: "CAM 01",
      label: "Top apron view",
      position: [0, 14 * s, -30 * s],
      target: [0, 3 * s, 6 * s],
      fov: 34,
    },
    "CAM 02": {
      id: "CAM 02",
      label: "Left wing view",
      position: [-22 * s, 10 * s, -16.5 * s],
      target: [-6 * s, 1.6 * s, 2.2 * s],
      fov: 36,
    },
    "CAM 03": {
      id: "CAM 03",
      label: "Engine zone",
      position: [14 * s, 8.4 * s, -9 * s],
      target: [0.6 * s, 1.4 * s, 3.4 * s],
      fov: 38,
    },
    "CAM 04": {
      id: "CAM 04",
      label: "Ground level",
      position: [4.6 * s, 2.4 * s, -26 * s],
      target: [0, 2.6 * s, -2 * s],
      fov: 44,
    },
  };
}

export const CAMERA_IDS: CameraPresetId[] = ["CAM 01", "CAM 02", "CAM 03", "CAM 04"];

/* ------------------------------------------------------------------ */
/* Sensor + camera fleet                                               */
/* ------------------------------------------------------------------ */

export function buildSensors(af: Airframe): Sensor[] {
  const s = af.worldScale;
  const ring: [number, number, Sensor["kind"], string][] = [
    [-14, -12, "lidar", "LIDAR NW"],
    [14, -12, "lidar", "LIDAR NE"],
    [-14, 14, "lidar", "LIDAR SW"],
    [14, 14, "lidar", "LIDAR SE"],
    [-20, 0, "radar", "RADAR W"],
    [20, 0, "radar", "RADAR E"],
    [0, -18, "radar", "RADAR N"],
    [0, 20, "radar", "RADAR S"],
    [-8, 4, "ultrasonic", "PROX L-WING"],
    [8, 4, "ultrasonic", "PROX R-WING"],
    [0, 9, "thermal", "THERMAL AFT"],
    [-2, -16, "env", "ENV MAST"],
  ];
  return ring.map(([x, z, kind, label], i) => ({
    id: `SEN-${String(i + 1).padStart(2, "0")}`,
    kind,
    label,
    online: true,
    value: 0,
    health: 96 + (i % 4),
    position: { x: x * s, z: z * s },
  }));
}

export const CAMERA_FLEET = [
  { id: "CAM-01", label: "Apron Mast N" },
  { id: "CAM-02", label: "Apron Mast S" },
  { id: "CAM-03", label: "Left Wing" },
  { id: "CAM-04", label: "Right Wing" },
  { id: "CAM-05", label: "Nose Bay" },
  { id: "CAM-06", label: "Tail / Blast" },
];

/* ------------------------------------------------------------------ */
/* Location naming                                                     */
/* ------------------------------------------------------------------ */

/** Maps a world point to a human location string used in alerts and the log. */
export function describeLocation(p: Vec2, af: Airframe): string {
  const e = af.envelope;
  const s = af.worldScale;
  const base = `${APRON_NAME} – `;
  if (p.z < e.noseZ - 1.5 * s) return base + "Nose Zone";
  if (p.z > e.tailZ - 1.0 * s) return base + "Tail / Blast Zone";
  if (p.z > e.wingZ0 - 1.5 * s && p.z < e.wingZ1 + 2.5 * s) {
    if (p.x < -1.8 * s) return base + "Left Wing Zone";
    if (p.x > 1.8 * s) return base + "Right Wing Zone";
    return base + "Centre Fuselage";
  }
  if (p.x < -1.8 * s) return base + "Left Service Lane";
  if (p.x > 1.8 * s) return base + "Right Service Lane";
  return base + "Forward Fuselage";
}

/** Short version used on the alert cards. */
export function shortLocation(p: Vec2, af: Airframe): string {
  return describeLocation(p, af);
}
