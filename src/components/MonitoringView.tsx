"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Crosshair,
  Focus,
  Maximize2,
  Minimize2,
  Plane,
  ShieldAlert,
  Video,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { CameraPresetId } from "@/sim/types";
import { AIRFRAME_ORDER, AIRFRAMES } from "@/sim/aircraftTypes";
import { CAMERA_IDS, buildCameraPresets } from "@/sim/constants";
import { useSim } from "@/sim/store";
import { AirsideScene, DetectionOverlayLayer } from "@/three/Scene";
import { clearanceColor } from "@/lib/format";
import { useFullscreen } from "@/lib/useFullscreen";

/* ------------------------------------------------------------------ */
/* Zone legend                                                         */
/* ------------------------------------------------------------------ */

const LEGEND = [
  { c: "#ff4343", label: "CRITICAL ZONE" },
  { c: "#f5a623", label: "CAUTION ZONE" },
  { c: "#31d17c", label: "SAFE ZONE" },
];

function ZoneLegend() {
  return (
    <div className="pointer-events-none absolute right-3 top-3 rounded-[5px] border border-[#14384f] bg-[#040f19]/86 px-3 py-2 backdrop-blur-[2px]">
      {LEGEND.map((l) => (
        <div key={l.label} className="flex items-center gap-2 py-[2.5px]">
          <span
            className="h-[9px] w-[9px] shrink-0 rounded-full"
            style={{ background: l.c, boxShadow: `0 0 6px ${l.c}66` }}
          />
          <span className="text-[10.5px] font-semibold tracking-[0.05em] text-[#c4d8e5]">
            {l.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Camera selector                                                     */
/* ------------------------------------------------------------------ */

function CameraSelect() {
  const cameraId = useSim((s) => s.cameraId);
  const setCamera = useSim((s) => s.setCamera);
  const airframeId = useSim((s) => s.airframeId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const presets = buildCameraPresets(AIRFRAMES[airframeId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-[4px] border border-[#14384f] bg-[#061524]/92 whitespace-nowrap px-2.5 py-[7px] text-[11.5px] font-semibold tracking-[0.04em] text-[#c4d8e5] transition-colors hover:border-[#1d5679]"
      >
        <Video size={14} strokeWidth={1.9} className="text-[#7d97ab]" />
        {cameraId}
        <ChevronDown
          size={13}
          className={`text-[#7d97ab] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute bottom-[calc(100%+6px)] left-0 z-20 w-[186px] overflow-hidden rounded-[5px] border border-[#14384f] bg-[#04101b]/97 backdrop-blur-sm"
          >
            {CAMERA_IDS.map((id: CameraPresetId) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setCamera(id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-[#0d2739] ${
                  id === cameraId ? "bg-[#0b2c40]" : ""
                }`}
              >
                <span
                  className={`text-[11.5px] font-semibold tracking-[0.03em] ${
                    id === cameraId ? "text-[#9fdcf2]" : "text-[#c4d8e5]"
                  }`}
                >
                  {id}
                </span>
                <span className="text-[10px] text-[#7d97ab]">
                  {presets[id].label}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Airframe selector                                                   */
/* ------------------------------------------------------------------ */

/**
 * Switches the monitored aircraft. Lives on the control bar rather than buried
 * in the simulation drawer, because changing the airframe rebuilds the stand -
 * the zones, routes, sensor ring and camera distances all scale with it - and
 * that is an operator action, not a developer one.
 */
function AirframeSelect() {
  const airframeId = useSim((s) => s.airframeId);
  const setAirframe = useSim((s) => s.setAirframe);
  const airlinerAvailable = useSim((s) => s.airlinerAvailable);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = AIRFRAMES[airframeId];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change the monitored airframe"
        className="flex items-center gap-2 rounded-[4px] border border-[#14384f] bg-[#061524]/92 whitespace-nowrap px-2.5 py-[7px] text-[11.5px] font-semibold tracking-[0.04em] text-[#c4d8e5] transition-colors hover:border-[#1d5679]"
      >
        <Plane size={14} strokeWidth={1.9} className="text-[#7d97ab]" />
        {current.shortName}
        <ChevronDown
          size={13}
          className={`text-[#7d97ab] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute bottom-[calc(100%+6px)] left-0 z-20 w-[236px] overflow-hidden rounded-[5px] border border-[#14384f] bg-[#04101b]/97 backdrop-blur-sm"
          >
            {AIRFRAME_ORDER.map((id) => {
              const af = AIRFRAMES[id];
              const disabled = af.optional && !airlinerAvailable;
              const active = id === airframeId;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setAirframe(id);
                    setOpen(false);
                  }}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                    active
                      ? "bg-[#0b2c40]"
                      : disabled
                        ? "cursor-not-allowed opacity-45"
                        : "hover:bg-[#0d2739]"
                  }`}
                >
                  <span
                    className={`text-[11.5px] font-semibold ${
                      active ? "text-[#9fdcf2]" : "text-[#c4d8e5]"
                    }`}
                  >
                    {af.name}
                  </span>
                  <span className="tnum text-[9.5px] text-[#7d97ab]">
                    {disabled
                      ? "model not loaded"
                      : `${af.category} · ${af.length} m × ${af.span} m`}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Control bar                                                         */
/* ------------------------------------------------------------------ */

function ControlBar({
  full,
  toggleFull,
}: {
  full: boolean;
  toggleFull: () => void;
}) {
  const zoom = useSim((s) => s.zoom);
  const resetView = useSim((s) => s.resetView);
  const autoTracking = useSim((s) => s.autoTracking);
  const toggleTracking = useSim((s) => s.toggleTracking);

  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-nowrap items-center gap-1.5">
      <CameraSelect />
      <AirframeSelect />

      <div className="flex items-center gap-1 rounded-[4px] border border-[#14384f] bg-[#061524]/92 px-1.5 py-[5px]">
        <button
          type="button"
          onClick={() => zoom(1)}
          title="Zoom in"
          className="rounded-[3px] p-1.5 text-[#8fa7b8] transition-colors hover:bg-[#0d2739] hover:text-[#c4d8e5]"
        >
          <ZoomIn size={15} strokeWidth={1.9} />
        </button>
        {/* Recentre the camera. It used to wear the Maximize2 icon, which read
            as "fullscreen" and did something else entirely - the button below
            is the one that icon was promising. */}
        <button
          type="button"
          onClick={resetView}
          title="Reset view"
          className="rounded-[3px] p-1.5 text-[#8fa7b8] transition-colors hover:bg-[#0d2739] hover:text-[#c4d8e5]"
        >
          <Focus size={15} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={toggleFull}
          title={full ? "Exit fullscreen (F)" : "Fullscreen (F)"}
          className="rounded-[3px] p-1.5 text-[#8fa7b8] transition-colors hover:bg-[#0d2739] hover:text-[#c4d8e5]"
        >
          {full ? (
            <Minimize2 size={15} strokeWidth={1.9} />
          ) : (
            <Maximize2 size={15} strokeWidth={1.9} />
          )}
        </button>
        <button
          type="button"
          onClick={() => zoom(-1)}
          title="Zoom out"
          className="rounded-[3px] p-1.5 text-[#8fa7b8] transition-colors hover:bg-[#0d2739] hover:text-[#c4d8e5]"
        >
          <ZoomOut size={15} strokeWidth={1.9} />
        </button>
      </div>

      <button
        type="button"
        onClick={toggleTracking}
        className="flex items-center gap-2.5 rounded-[4px] border border-[#14384f] bg-[#061524]/92 py-[6px] pl-2.5 pr-2 transition-colors hover:border-[#1d5679]"
        title="Bias the camera toward the highest-risk incident"
      >
        <Crosshair
          size={14}
          strokeWidth={1.9}
          className={autoTracking ? "text-[#31d17c]" : "text-[#7d97ab]"}
        />
        <span className="whitespace-nowrap text-[11.5px] font-medium text-[#c4d8e5]">
          Auto Tracking
        </span>
        <span
          className={`flex h-[19px] w-[38px] items-center rounded-full px-[2px] transition-colors ${
            autoTracking ? "bg-[#1f8a58]" : "bg-[#16344a]"
          }`}
        >
          <span
            className={`flex h-[15px] items-center justify-center rounded-full bg-white text-[8px] font-bold text-[#0a1a12] transition-transform duration-200 ${
              autoTracking
                ? "w-[15px] translate-x-[19px]"
                : "w-[15px] translate-x-0"
            }`}
          />
        </span>
        <span
          className={`w-[24px] text-[10px] font-bold tracking-[0.05em] ${
            autoTracking ? "text-[#31d17c]" : "text-[#5f7d94]"
          }`}
        >
          {autoTracking ? "ON" : "OFF"}
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Intervention banner                                                 */
/* ------------------------------------------------------------------ */

function InterventionBanner() {
  const iv = useSim((s) => s.snap?.intervention ?? null);
  const prevented = iv?.title === "COLLISION PREVENTED";

  return (
    <AnimatePresence>
      {iv && (
        <motion.div
          key={iv.id}
          initial={{ opacity: 0, scale: 0.94, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -6 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
          className="pointer-events-none absolute left-1/2 top-[62px] z-10 -translate-x-1/2"
        >
          <div
            className="flex items-center gap-3 rounded-[6px] border px-5 py-3 backdrop-blur-[3px]"
            style={{
              borderColor: prevented ? "#1f8a5899" : "#ff434399",
              background: prevented ? "rgba(4,26,18,0.9)" : "rgba(32,8,10,0.9)",
              boxShadow: prevented
                ? "0 0 0 1px rgba(49,209,124,0.15), 0 18px 40px -22px rgba(49,209,124,0.55)"
                : "0 0 0 1px rgba(255,67,67,0.16), 0 18px 40px -22px rgba(255,67,67,0.6)",
            }}
          >
            <ShieldAlert
              size={26}
              strokeWidth={1.8}
              style={{ color: prevented ? "#31d17c" : "#ff4343" }}
              className={prevented ? "" : "crit-dot rounded-full"}
            />
            <div>
              <div
                className="text-[15px] font-bold tracking-[0.07em]"
                style={{ color: prevented ? "#31d17c" : "#ff5a5a" }}
              >
                {iv.title}
              </div>
              {iv.lines.map((l, i) => (
                <div
                  key={i}
                  className="text-[11.5px] leading-[1.45] text-[#c4d8e5]"
                >
                  {l}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Monitoring panel                                                    */
/* ------------------------------------------------------------------ */

export function MonitoringView() {
  const status = useSim((s) => s.snap?.safetyStatus ?? "SAFE");
  const clearance = useSim((s) => s.snap?.clearance ?? "CLEAR");
  const clearanceReason = useSim((s) => s.snap?.clearanceReason ?? "");
  const demoActive = useSim((s) => s.snap?.demoActive ?? false);
  const demoCaption = useSim((s) => s.snap?.demoCaption ?? "");
  const demoElapsed = useSim((s) => s.snap?.demoElapsed ?? 0);
  const fodPlacement = useSim((s) => s.fodPlacement);
  const debug = useSim((s) => s.debug);
  const fps = useSim((s) => s.fps);
  const engineState = useSim((s) => s.snap?.engineState ?? "OFF");

  const critical = status === "CRITICAL";
  const cc = clearanceColor(clearance);

  /* The element handed to the Fullscreen API is this whole panel, not the
     canvas, so the chips and the control bar come with it. A bare canvas
     fullscreens as a picture you cannot drive. */
  const {
    ref: shell,
    full,
    toggle: toggleFull,
    overlayStyle,
  } = useFullscreen<HTMLDivElement>();

  return (
    <div
      ref={shell}
      className="panel relative min-h-0 flex-1 overflow-hidden bg-[#030b14]"
      style={overlayStyle}
    >
      {/* 3D feed */}
      <AirsideScene />

      {/* scanline shimmer, keeps the feed feeling live */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="feed-scan absolute inset-x-0 h-[38%] bg-gradient-to-b from-transparent via-[#25d9e8]/[0.028] to-transparent" />
      </div>

      {/* vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_46%,rgba(2,8,16,0.55)_100%)]" />

      {/* AI detection boxes */}
      <DetectionOverlayLayer />

      {/* critical alarm edge */}
      {critical && (
        <div className="alarm-edge pointer-events-none absolute inset-0 rounded-[5px] shadow-[inset_0_0_0_2px_rgba(255,67,67,0.5),inset_0_0_46px_rgba(255,67,67,0.14)]" />
      )}

      {/* top-left chips */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-[5px] border border-[#14384f] bg-[#040f19]/86 px-3 py-[7px] backdrop-blur-[2px]">
          <span className="live-dot inline-block h-[7px] w-[7px] rounded-full bg-[#31d17c]" />
          <span className="text-[11.5px] font-semibold tracking-[0.07em] text-[#dce8f1]">
            LIVE AIRSIDE MONITORING
          </span>
        </div>

        <div
          className="flex items-center gap-2 rounded-[5px] border bg-[#040f19]/86 px-3 py-[7px] backdrop-blur-[2px] transition-colors duration-500"
          style={{ borderColor: `${cc}55` }}
          title={clearanceReason}
        >
          <span
            className={`inline-block h-[7px] w-[7px] rounded-full ${
              clearance === "HOLD" ? "crit-dot" : ""
            }`}
            style={{ background: cc }}
          />
          <span
            className="text-[11.5px] font-bold tracking-[0.07em] transition-colors duration-500"
            style={{ color: cc }}
          >
            {clearance === "HOLD"
              ? "PUSHBACK HOLD"
              : clearance === "CAUTION"
                ? "PUSHBACK CAUTION"
                : "AIRCRAFT CLEAR"}
          </span>
        </div>

        {engineState !== "OFF" && (
          <div className="flex items-center gap-2 rounded-[5px] border border-[#8a4a15] bg-[#231607]/88 px-3 py-[7px] backdrop-blur-[2px]">
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-[#ff8b1f]" />
            <span className="text-[11.5px] font-bold tracking-[0.07em] text-[#ff9a3c]">
              ENGINES {engineState}
            </span>
          </div>
        )}
      </div>

      <ZoneLegend />
      <InterventionBanner />

      {/* demo caption */}
      <AnimatePresence>
        {demoActive && demoCaption && (
          <motion.div
            key={demoCaption}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.32 }}
            className="pointer-events-none absolute bottom-[62px] left-1/2 -translate-x-1/2"
          >
            <div className="flex items-center gap-2.5 rounded-[5px] border border-[#1d5679] bg-[#04101b]/92 px-4 py-2 backdrop-blur-[2px]">
              <span className="tnum text-[10.5px] font-bold text-[#3ec8ef]">
                T+{String(Math.floor(demoElapsed)).padStart(2, "0")}s
              </span>
              <span className="text-[12px] font-medium tracking-[0.02em] text-[#dce8f1]">
                {demoCaption}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FOD placement hint */}
      {fodPlacement && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-[4px] border border-[#7a5c17] bg-[#1f1a07]/92 px-3 py-1.5">
          <span className="text-[11px] font-semibold tracking-[0.04em] text-[#f5c04a]">
            FOD DROP ARMED — click the apron to place debris
          </span>
        </div>
      )}

      {/* debug HUD */}
      {debug && <DebugHud fps={fps} />}

      <ControlBar full={full} toggleFull={toggleFull} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Debug HUD                                                           */
/* ------------------------------------------------------------------ */

function DebugHud({ fps }: { fps: number }) {
  const snap = useSim((s) => s.snap);
  const airframeId = useSim((s) => s.airframeId);
  const af = AIRFRAMES[airframeId];

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 max-w-[330px] rounded-[4px] border border-[#14384f] bg-[#04101b]/94 px-3 py-2 font-mono text-[10px] leading-[1.55] text-[#8fa7b8]">
      <div className="mb-1 font-bold tracking-[0.08em] text-[#3ec8ef]">
        DEBUG · D TO HIDE
      </div>
      <div>
        FPS {fps} · airframe {af.shortName} · scale {af.worldScale}
      </div>
      <div>
        risk {snap?.riskScore.toFixed(1)} · status {snap?.safetyStatus} ·
        clearance {snap?.clearance}
      </div>
      <div>
        tracks V{snap?.vehicleCount} P{snap?.personCount} F{snap?.fodCount} ·
        zone {snap?.zoneIntegrity}%
      </div>
      <div className="mt-1 border-t border-[#123147] pt-1">
        {snap?.hazards.slice(0, 5).map((h) => (
          <div key={h.id} className="truncate">
            {h.targetId} r{h.risk.toFixed(1)}{" "}
            {h.ttc != null ? `ttc ${h.ttc.toFixed(2)}s` : "—"} {h.source}
          </div>
        ))}
        {!snap?.hazards.length && <div>no active hazards</div>}
      </div>
    </div>
  );
}
