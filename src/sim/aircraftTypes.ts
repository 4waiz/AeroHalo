import type { AircraftPart, Vec2 } from "./types";

/**
 * Switchable airframes.
 *
 * Every airframe declares the transform that maps its source GLB into AeroHalo
 * world space (nose down -Z, wheels on Y=0), plus the geometry the safety
 * engine needs: a collision hull of capsules, the engine intake/exhaust
 * origins, and an envelope the zone manager expands into exclusion areas.
 *
 * The F/A-18E figures were measured directly from the supplied GLB by
 * profiling its vertex cloud; the airliner figures come from the Blender
 * build spec. Both are in metres.
 */

export type AirframeId = "hornet" | "airliner";

export type EngineLayout = "embedded" | "podded";

export interface AirframeEnvelope {
  /** Z of the nose tip (negative). */
  noseZ: number;
  /** Z of the tail end (positive). */
  tailZ: number;
  /** Half wingspan. */
  halfSpan: number;
  /** Z range covered by the wings. */
  wingZ0: number;
  wingZ1: number;
  /** Half width of the fuselage. */
  fuseHalfW: number;
  /** Half span of the tailplane. */
  tailHalfSpan: number;
  /** Overall height, top of fin. */
  height: number;
}

export interface EnginePort {
  /** Air intake mouth. */
  intake: Vec2;
  /** Exhaust nozzle. */
  nozzle: Vec2;
  /** Height of the engine centreline above the apron. */
  y: number;
  /** Nacelle radius, used for the 3D hazard overlays. */
  radius: number;
}

export interface Airframe {
  id: AirframeId;
  /** Shown in the UI. */
  name: string;
  /** Short label for tight spaces. */
  shortName: string;
  category: string;
  registration: string;
  modelUrl: string;
  /** True once the GLB is present; a missing model falls back gracefully. */
  optional: boolean;

  /* --- GLB placement --- */
  scale: number;
  rotationY: number;
  /** Lift applied after scaling so the gear touches Y=0. */
  yOffset: number;

  /* --- dimensions --- */
  length: number;
  span: number;
  height: number;

  envelope: AirframeEnvelope;
  engineLayout: EngineLayout;
  engines: { left: EnginePort; right: EnginePort };
  /** Contact patches, used for chocks and the wheel-stop marking. */
  gear: Vec2[];
  /** Collision capsules. */
  hull: AircraftPart[];
  /** Silhouette used by the risk heatmap card. */
  planform: Vec2[];
  /**
   * Multiplier applied to zone sizes, apron markings, service routes and
   * camera distances so the stand stays proportional to the airframe.
   */
  worldScale: number;
  /** Jet blast length at full power, metres. */
  blastLength: number;
  /** Where the forward service door sits, for the belt loader and jet bridge. */
  forwardDoor: Vec2;
}

/* ------------------------------------------------------------------ */
/* F/A-18E Super Hornet - measured from public/models/aircraft.glb      */
/* ------------------------------------------------------------------ */

const HORNET_PLANFORM: Vec2[] = [
  { x: 0, z: -9.44 },
  { x: 0.35, z: -8.39 },
  { x: 0.58, z: -6.98 },
  { x: 0.84, z: -5.58 },
  { x: 1.07, z: -4.17 },
  { x: 1.25, z: -2.77 },
  { x: 1.59, z: -1.37 },
  { x: 2.26, z: 0.04 },
  { x: 3.29, z: 0.74 },
  { x: 6.86, z: 1.44 },
  { x: 6.86, z: 4.25 },
  { x: 2.2, z: 4.95 },
  { x: 2.2, z: 6.36 },
  { x: 3.92, z: 7.6 },
  { x: 3.92, z: 8.46 },
  { x: 0, z: 8.81 },
  { x: -3.92, z: 8.46 },
  { x: -3.92, z: 7.6 },
  { x: -2.2, z: 6.36 },
  { x: -2.2, z: 4.95 },
  { x: -6.86, z: 4.25 },
  { x: -6.86, z: 1.44 },
  { x: -3.29, z: 0.74 },
  { x: -2.26, z: 0.04 },
  { x: -1.59, z: -1.37 },
  { x: -1.25, z: -2.77 },
  { x: -1.07, z: -4.17 },
  { x: -0.84, z: -5.58 },
  { x: -0.58, z: -6.98 },
  { x: -0.35, z: -8.39 },
];

const HORNET_HULL: AircraftPart[] = [
  { name: "Nose", a: { x: 0, z: -9.4 }, b: { x: 0, z: -4.6 }, r: 0.85, severityWeight: 1.05 },
  { name: "Forward Fuselage", a: { x: 0, z: -4.6 }, b: { x: 0, z: -0.6 }, r: 1.35, severityWeight: 1.0 },
  { name: "Centre Fuselage", a: { x: 0, z: -0.6 }, b: { x: 0, z: 4.6 }, r: 2.0, severityWeight: 1.0 },
  { name: "Left Wing", a: { x: -2.4, z: 1.9 }, b: { x: -6.8, z: 2.9 }, r: 1.15, severityWeight: 1.25 },
  { name: "Right Wing", a: { x: 2.4, z: 1.9 }, b: { x: 6.8, z: 2.9 }, r: 1.15, severityWeight: 1.25 },
  { name: "Left Engine", a: { x: -0.95, z: 0.8 }, b: { x: -0.8, z: 8.2 }, r: 1.0, severityWeight: 1.5 },
  { name: "Right Engine", a: { x: 0.95, z: 0.8 }, b: { x: 0.8, z: 8.2 }, r: 1.0, severityWeight: 1.5 },
  { name: "Left Stabilator", a: { x: -1.4, z: 7.5 }, b: { x: -3.9, z: 8.4 }, r: 0.62, severityWeight: 1.1 },
  { name: "Right Stabilator", a: { x: 1.4, z: 7.5 }, b: { x: 3.9, z: 8.4 }, r: 0.62, severityWeight: 1.1 },
  { name: "Left Fin", a: { x: -1.7, z: 4.9 }, b: { x: -2.2, z: 6.9 }, r: 0.55, severityWeight: 1.15 },
  { name: "Right Fin", a: { x: 1.7, z: 4.9 }, b: { x: 2.2, z: 6.9 }, r: 0.55, severityWeight: 1.15 },
];

export const HORNET: Airframe = {
  id: "hornet",
  name: "F/A-18E Super Hornet",
  shortName: "F/A-18E",
  category: "Multirole Fighter",
  registration: "NAV-166",
  modelUrl: "/models/aircraft.glb",
  optional: false,

  scale: 0.0985,
  rotationY: Math.PI / 2,
  yOffset: 1.9723,

  length: 18.25,
  span: 13.72,
  height: 5.03,

  envelope: {
    noseZ: -9.44,
    tailZ: 8.81,
    halfSpan: 6.86,
    wingZ0: 1.0,
    wingZ1: 4.5,
    fuseHalfW: 2.3,
    tailHalfSpan: 3.92,
    height: 5.03,
  },
  engineLayout: "embedded",
  engines: {
    left: { intake: { x: -1.15, z: 0.6 }, nozzle: { x: -0.78, z: 8.5 }, y: 1.15, radius: 0.62 },
    right: { intake: { x: 1.15, z: 0.6 }, nozzle: { x: 0.78, z: 8.5 }, y: 1.15, radius: 0.62 },
  },
  gear: [
    { x: 0.26, z: -3.32 },
    { x: 1.74, z: 2.11 },
    { x: -1.59, z: 2.11 },
  ],
  hull: HORNET_HULL,
  planform: HORNET_PLANFORM,
  worldScale: 1,
  blastLength: 26,
  forwardDoor: { x: 1.9, z: -1.4 },
};

/* ------------------------------------------------------------------ */
/* Generic narrow-body airliner - built in Blender (public/models)      */
/* ------------------------------------------------------------------ */

const AIRLINER_PLANFORM: Vec2[] = [
  { x: 0, z: -21 },
  { x: 1.1, z: -19.2 },
  { x: 1.8, z: -16.5 },
  { x: 1.98, z: -12 },
  { x: 1.98, z: -4 },
  { x: 3.2, z: -1.2 },
  { x: 17.9, z: 6.4 },
  { x: 17.9, z: 7.8 },
  { x: 4.4, z: 4.6 },
  { x: 1.98, z: 4.2 },
  { x: 1.98, z: 11.4 },
  { x: 6.3, z: 13.1 },
  { x: 6.3, z: 15 },
  { x: 1.4, z: 14.2 },
  { x: 0.7, z: 16.5 },
  { x: -0.7, z: 16.5 },
  { x: -1.4, z: 14.2 },
  { x: -6.3, z: 15 },
  { x: -6.3, z: 13.1 },
  { x: -1.98, z: 11.4 },
  { x: -1.98, z: 4.2 },
  { x: -4.4, z: 4.6 },
  { x: -17.9, z: 7.8 },
  { x: -17.9, z: 6.4 },
  { x: -3.2, z: -1.2 },
  { x: -1.98, z: -4 },
  { x: -1.98, z: -12 },
  { x: -1.8, z: -16.5 },
  { x: -1.1, z: -19.2 },
];

const AIRLINER_HULL: AircraftPart[] = [
  { name: "Nose", a: { x: 0, z: -21 }, b: { x: 0, z: -16 }, r: 1.5, severityWeight: 1.05 },
  { name: "Forward Fuselage", a: { x: 0, z: -16 }, b: { x: 0, z: -2 }, r: 2.1, severityWeight: 1.0 },
  { name: "Aft Fuselage", a: { x: 0, z: -2 }, b: { x: 0, z: 12.5 }, r: 2.1, severityWeight: 1.0 },
  { name: "Tail Cone", a: { x: 0, z: 12.5 }, b: { x: 0, z: 16.5 }, r: 1.3, severityWeight: 1.0 },
  { name: "Left Wing", a: { x: -2.4, z: -0.4 }, b: { x: -17.9, z: 7.1 }, r: 1.5, severityWeight: 1.25 },
  { name: "Right Wing", a: { x: 2.4, z: -0.4 }, b: { x: 17.9, z: 7.1 }, r: 1.5, severityWeight: 1.25 },
  { name: "Left Engine", a: { x: -5.7, z: -0.3 }, b: { x: -5.7, z: 4.12 }, r: 1.45, severityWeight: 1.6 },
  { name: "Right Engine", a: { x: 5.7, z: -0.3 }, b: { x: 5.7, z: 4.12 }, r: 1.45, severityWeight: 1.6 },
  { name: "Left Tailplane", a: { x: -1.4, z: 12.6 }, b: { x: -6.3, z: 14.8 }, r: 0.9, severityWeight: 1.1 },
  { name: "Right Tailplane", a: { x: 1.4, z: 12.6 }, b: { x: 6.3, z: 14.8 }, r: 0.9, severityWeight: 1.1 },
  { name: "Vertical Fin", a: { x: 0, z: 10.5 }, b: { x: 0, z: 15.5 }, r: 1.0, severityWeight: 1.15 },
];

export const AIRLINER: Airframe = {
  id: "airliner",
  name: "A320-Class Narrow-Body",
  shortName: "NARROW-BODY",
  category: "Commercial Narrow-Body",
  registration: "G-AHLO",
  modelUrl: "/models/airliner.glb",
  optional: true,

  scale: 1,
  rotationY: 0,
  yOffset: 0,

  length: 37.5,
  span: 35.8,
  height: 11.8,

  envelope: {
    noseZ: -21,
    tailZ: 16.66,
    halfSpan: 17.92,
    wingZ0: -1.5,
    wingZ1: 8,
    fuseHalfW: 2.4,
    tailHalfSpan: 6.3,
    height: 11.8,
  },
  engineLayout: "podded",
  engines: {
    left: { intake: { x: -5.7, z: -0.3 }, nozzle: { x: -5.7, z: 4.12 }, y: 1.98, radius: 1.2 },
    right: { intake: { x: 5.7, z: -0.3 }, nozzle: { x: 5.7, z: 4.12 }, y: 1.98, radius: 1.2 },
  },
  gear: [
    { x: 0, z: -14 },
    { x: 3.8, z: 1.5 },
    { x: -3.8, z: 1.5 },
  ],
  hull: AIRLINER_HULL,
  planform: AIRLINER_PLANFORM,
  worldScale: 1.95,
  blastLength: 48,
  forwardDoor: { x: 2.3, z: -13 },
};

export const AIRFRAMES: Record<AirframeId, Airframe> = {
  hornet: HORNET,
  airliner: AIRLINER,
};

export const AIRFRAME_ORDER: AirframeId[] = ["hornet", "airliner"];

export const DEFAULT_AIRFRAME: AirframeId = "hornet";

export const getAirframe = (id: AirframeId): Airframe =>
  AIRFRAMES[id] ?? AIRFRAMES[DEFAULT_AIRFRAME];
