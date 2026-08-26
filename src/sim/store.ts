"use client";

import { create } from "zustand";
import type { CameraPresetId, ScenarioId, SimSnapshot, Vec2 } from "./types";
import type { AirframeId } from "./aircraftTypes";
import { DEFAULT_AIRFRAME } from "./aircraftTypes";
import { SimulationEngine } from "./SimulationEngine";

/**
 * One engine instance per browser session.
 *
 * The engine is deliberately NOT stored in Zustand - putting a mutating object
 * graph in React state would either fight the reconciler or force a re-render
 * every frame. Components read the 10 Hz `snapshot` from the store and the 3D
 * layer reads live transforms straight off `engine.registry`.
 */
let engineSingleton: SimulationEngine | null = null;

export function getEngine(): SimulationEngine {
  if (!engineSingleton) engineSingleton = new SimulationEngine(DEFAULT_AIRFRAME);
  return engineSingleton;
}

export interface FocusTarget {
  id: string;
  at: number;
  /** Cached world position so the camera can start easing immediately. */
  point: Vec2 | null;
}

interface UiState {
  /* ---- published simulation snapshot ---- */
  snap: SimSnapshot | null;

  /* ---- view state ---- */
  cameraId: CameraPresetId;
  autoTracking: boolean;
  autoStop: boolean;
  muted: boolean;
  airframeId: AirframeId;
  /** True when the airliner GLB is present on disk. */
  airlinerAvailable: boolean;

  presentation: boolean;
  debug: boolean;
  controlsOpen: boolean;
  fullLogOpen: boolean;
  /** Clicking the apron drops debris while this is armed. */
  fodPlacement: boolean;

  focus: FocusTarget | null;
  /** Set by the 3D layer so the HUD can show live FPS in debug mode. */
  fps: number;

  /* ---- actions ---- */
  publish: (s: SimSnapshot) => void;
  setCamera: (id: CameraPresetId) => void;
  toggleTracking: () => void;
  toggleAutoStop: () => void;
  toggleMute: () => void;
  setAirframe: (id: AirframeId) => void;
  setAirlinerAvailable: (v: boolean) => void;
  togglePresentation: () => void;
  toggleDebug: () => void;
  setControlsOpen: (v: boolean) => void;
  setFullLogOpen: (v: boolean) => void;
  toggleFodPlacement: () => void;
  focusTarget: (id: string) => void;
  clearFocus: () => void;
  setFps: (n: number) => void;
  runScenario: (id: ScenarioId) => void;
  startDemo: () => void;
  stopDemo: () => void;
  zoom: (delta: number) => void;
  resetView: () => void;
  /** Bumped whenever the camera should snap back to the active preset. */
  viewNonce: number;
  zoomNonce: number;
  zoomDelta: number;
}

export const useSim = create<UiState>((set, get) => ({
  snap: null,

  cameraId: "CAM 01",
  autoTracking: true,
  autoStop: true,
  muted: true,
  airframeId: DEFAULT_AIRFRAME,
  airlinerAvailable: false,

  presentation: false,
  debug: false,
  controlsOpen: false,
  fullLogOpen: false,
  fodPlacement: false,

  focus: null,
  fps: 60,
  viewNonce: 0,
  zoomNonce: 0,
  zoomDelta: 0,

  publish: (s) => set({ snap: s }),

  setCamera: (id) => set({ cameraId: id, viewNonce: get().viewNonce + 1 }),

  toggleTracking: () => {
    const next = !get().autoTracking;
    getEngine().setAutoTracking(next);
    set({ autoTracking: next });
  },

  toggleAutoStop: () => {
    const next = !get().autoStop;
    getEngine().setAutoStop(next);
    set({ autoStop: next });
  },

  toggleMute: () => {
    const next = !get().muted;
    getEngine().setMuted(next);
    set({ muted: next });
  },

  setAirframe: (id) => {
    getEngine().setAirframe(id);
    set({ airframeId: id, viewNonce: get().viewNonce + 1, focus: null });
  },

  setAirlinerAvailable: (v) => set({ airlinerAvailable: v }),

  togglePresentation: () =>
    set({ presentation: !get().presentation, controlsOpen: false, debug: false }),

  toggleDebug: () => set({ debug: !get().debug }),

  setControlsOpen: (v) => set({ controlsOpen: v }),
  setFullLogOpen: (v) => set({ fullLogOpen: v }),

  toggleFodPlacement: () => set({ fodPlacement: !get().fodPlacement }),

  focusTarget: (id) => {
    const e = getEngine();
    e.focus(id);
    set({
      focus: { id, at: e.clock, point: e.registry.locate(id) },
      cameraId: get().cameraId,
    });
  },

  clearFocus: () => set({ focus: null }),

  setFps: (n) => set({ fps: n }),

  runScenario: (id) => {
    const e = getEngine();
    if (id === "reset") {
      e.stopDemo();
      e.reset();
      set({ focus: null, viewNonce: get().viewNonce + 1 });
    } else {
      e.scenario(id);
    }
  },

  startDemo: () => {
    getEngine().startDemo();
    set({ focus: null, cameraId: "CAM 01", viewNonce: get().viewNonce + 1 });
  },

  stopDemo: () => getEngine().stopDemo(),

  zoom: (delta) => set({ zoomDelta: delta, zoomNonce: get().zoomNonce + 1 }),

  resetView: () => set({ viewNonce: get().viewNonce + 1, focus: null }),
}));

/* ------------------------------------------------------------------ */
/* Selectors - keep component re-renders narrow                        */
/* ------------------------------------------------------------------ */

export const selectSnap = (s: UiState) => s.snap;
export const selectRisk = (s: UiState) => s.snap?.riskScore ?? 0;
export const selectStatus = (s: UiState) => s.snap?.safetyStatus ?? "SAFE";
export const selectAlerts = (s: UiState) => s.snap?.activeAlerts ?? [];
export const selectEvents = (s: UiState) => s.snap?.events ?? [];
