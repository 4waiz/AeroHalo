"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Bomb,
  CirclePlay,
  CircleStop,
  Eraser,
  Flame,
  MapPin,
  Plane,
  PersonStanding,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Truck,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { ScenarioId } from "@/sim/types";
import { AIRFRAME_ORDER, AIRFRAMES } from "@/sim/aircraftTypes";
import { useSim } from "@/sim/store";

interface Action {
  id: ScenarioId | "fodArm";
  label: string;
  icon: React.ReactNode;
  tone?: "danger" | "warn" | "ok";
  hint: string;
}

const ACTIONS: Action[] = [
  {
    id: "normal",
    label: "Normal Operations",
    icon: <ShieldCheck size={14} strokeWidth={1.9} />,
    tone: "ok",
    hint: "Return every vehicle to its assigned service track",
  },
  {
    id: "collision",
    label: "Vehicle Collision Scenario",
    icon: <Truck size={14} strokeWidth={1.9} />,
    tone: "danger",
    hint: "Divert a tractor onto a collision course with the left wing",
  },
  {
    id: "intrusion",
    label: "Personnel Intrusion",
    icon: <PersonStanding size={14} strokeWidth={1.9} />,
    tone: "warn",
    hint: "Walk a crew member into the engine hazard area",
  },
  {
    id: "fod",
    label: "Spawn FOD",
    icon: <MapPin size={14} strokeWidth={1.9} />,
    tone: "warn",
    hint: "Drop debris on the stand for the classifier to find",
  },
  {
    id: "multi",
    label: "Multiple Hazard Scenario",
    icon: <Bomb size={14} strokeWidth={1.9} />,
    tone: "danger",
    hint: "Collision, intrusion, debris and a camera dropout at once",
  },
  {
    id: "engineStart",
    label: "Engine Start / Stop",
    icon: <Flame size={14} strokeWidth={1.9} />,
    tone: "warn",
    hint: "Spool the engines and expand the intake and blast areas",
  },
  {
    id: "clear",
    label: "Clear Hazards",
    icon: <Eraser size={14} strokeWidth={1.9} />,
    tone: "ok",
    hint: "Withdraw crews, remove debris and stand the engines down",
  },
  {
    id: "reset",
    label: "Reset Simulation",
    icon: <RotateCcw size={14} strokeWidth={1.9} />,
    hint: "Rebuild the stand from scratch",
  },
];

const TONE: Record<string, string> = {
  danger: "border-[#5c1f28] bg-[#1a0a0f] text-[#ff8a8a] hover:border-[#93202a]",
  warn: "border-[#5c4113] bg-[#170f04] text-[#f5c04a] hover:border-[#8a4a15]",
  ok: "border-[#17452f] bg-[#05150f] text-[#5fdba0] hover:border-[#1f8a58]",
};
const TONE_DEFAULT =
  "border-[#14384f] bg-[#061524] text-[#a8c0d1] hover:border-[#1d5679]";

function Toggle({
  label,
  on,
  onClick,
  onLabel = "ON",
  offLabel = "OFF",
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-[4px] border border-[#14384f] bg-[#061524] px-2.5 py-[7px] transition-colors hover:border-[#1d5679]"
    >
      <span className="text-[11px] font-medium text-[#a8c0d1]">{label}</span>
      <span className="flex items-center gap-1.5">
        <span
          className={`flex h-[16px] w-[30px] items-center rounded-full px-[2px] transition-colors ${
            on ? "bg-[#1f8a58]" : "bg-[#16344a]"
          }`}
        >
          <span
            className={`h-[12px] w-[12px] rounded-full bg-white transition-transform duration-200 ${
              on ? "translate-x-[14px]" : "translate-x-0"
            }`}
          />
        </span>
        <span
          className={`w-[26px] text-[9.5px] font-bold tracking-[0.05em] ${
            on ? "text-[#31d17c]" : "text-[#5f7d94]"
          }`}
        >
          {on ? onLabel : offLabel}
        </span>
      </span>
    </button>
  );
}

/**
 * Operator console for the demonstration.
 *
 * Deliberately a floating drawer rather than a dashboard card: it is a
 * presenter tool, and pressing P hides it completely so judges only see the
 * production dashboard.
 */
export function SimulationControls() {
  const open = useSim((s) => s.controlsOpen);
  const setOpen = useSim((s) => s.setControlsOpen);
  const presentation = useSim((s) => s.presentation);

  const runScenario = useSim((s) => s.runScenario);
  const autoStop = useSim((s) => s.autoStop);
  const toggleAutoStop = useSim((s) => s.toggleAutoStop);
  const autoTracking = useSim((s) => s.autoTracking);
  const toggleTracking = useSim((s) => s.toggleTracking);
  const muted = useSim((s) => s.muted);
  const toggleMute = useSim((s) => s.toggleMute);
  const fodPlacement = useSim((s) => s.fodPlacement);
  const toggleFodPlacement = useSim((s) => s.toggleFodPlacement);

  const airframeId = useSim((s) => s.airframeId);
  const setAirframe = useSim((s) => s.setAirframe);
  const airlinerAvailable = useSim((s) => s.airlinerAvailable);

  const demoActive = useSim((s) => s.snap?.demoActive ?? false);
  const startDemo = useSim((s) => s.startDemo);
  const stopDemo = useSim((s) => s.stopDemo);

  if (presentation) return null;

  return (
    <>
      {/* trigger */}
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            onClick={() => setOpen(true)}
            title="Simulation controls (C)"
            className="sim-trigger flex items-center gap-1.5 rounded-t-[4px] border border-b-0 border-[#14384f] bg-[#061524]/95 px-2.5 text-[10px] font-semibold tracking-[0.06em] text-[#7d97ab] backdrop-blur-sm transition-colors hover:border-[#1d5679] hover:text-[#c4d8e5]"
          >
            <Settings2 size={12} strokeWidth={2} />
            SIM CONTROLS
          </motion.button>
        )}
      </AnimatePresence>

      {/* drawer */}
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="panel fixed bottom-[calc(var(--ftr-h)+6px)] right-2.5 z-40 max-h-[calc(100dvh-var(--hdr-h)-var(--ftr-h)-20px)] w-[264px] overflow-y-auto p-2.5 backdrop-blur-sm scroll-thin"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="panel-label">Simulation Controls</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[3px] p-0.5 text-[#5f7d94] transition-colors hover:text-[#c4d8e5]"
              >
                <X size={14} />
              </button>
            </div>

            {/* airframe */}
            <div className="mb-2">
              <div className="mb-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-[#5f7d94]">
                MONITORED AIRFRAME
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {AIRFRAME_ORDER.map((id) => {
                  const af = AIRFRAMES[id];
                  const disabled = af.optional && !airlinerAvailable;
                  const active = id === airframeId;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setAirframe(id)}
                      title={
                        disabled
                          ? "Model not present in public/models"
                          : `${af.name} · ${af.length} m × ${af.span} m`
                      }
                      className={`flex flex-col items-start gap-0.5 rounded-[4px] border px-2 py-1.5 text-left transition-colors ${
                        active
                          ? "border-[#1d6b8f] bg-[#0b2c40] text-[#9fdcf2]"
                          : disabled
                            ? "cursor-not-allowed border-[#0f2b3f] bg-[#050f1a] text-[#3b556a]"
                            : "border-[#14384f] bg-[#061524] text-[#a8c0d1] hover:border-[#1d5679]"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.03em]">
                        <Plane size={11} strokeWidth={2} />
                        {af.shortName}
                      </span>
                      <span className="text-[8.5px] leading-tight opacity-70">
                        {disabled ? "not loaded" : af.category}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* scenarios */}
            <div className="mb-2 flex flex-col gap-1.5">
              {ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.hint}
                  onClick={() => runScenario(a.id as ScenarioId)}
                  className={`flex items-center gap-2 rounded-[4px] border px-2.5 py-[7px] text-[11px] font-medium transition-colors ${
                    a.tone ? TONE[a.tone] : TONE_DEFAULT
                  }`}
                >
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </div>

            {/* toggles */}
            <div className="flex flex-col gap-1.5 border-t border-[#0f2b3f] pt-2">
              <Toggle label="Auto Stop" on={autoStop} onClick={toggleAutoStop} />
              <Toggle label="AI Tracking" on={autoTracking} onClick={toggleTracking} />
              <Toggle
                label="Click apron to drop FOD"
                on={fodPlacement}
                onClick={toggleFodPlacement}
                onLabel="ARMED"
                offLabel="OFF"
              />

              <div className="mt-0.5 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={demoActive ? stopDemo : startDemo}
                  className={`flex items-center justify-center gap-1.5 rounded-[4px] border px-2 py-[7px] text-[10.5px] font-bold tracking-[0.04em] transition-colors ${
                    demoActive
                      ? "border-[#93202a] bg-[#1a0a0f] text-[#ff8a8a]"
                      : "border-[#1d6b8f] bg-[#0b2c40] text-[#9fdcf2] hover:border-[#25a0cf]"
                  }`}
                >
                  {demoActive ? <CircleStop size={13} /> : <CirclePlay size={13} />}
                  {demoActive ? "STOP DEMO" : "RUN DEMO"}
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  className="flex items-center justify-center gap-1.5 rounded-[4px] border border-[#14384f] bg-[#061524] px-2 py-[7px] text-[10.5px] font-bold tracking-[0.04em] text-[#a8c0d1] transition-colors hover:border-[#1d5679]"
                >
                  {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  {muted ? "MUTED" : "AUDIO"}
                </button>
              </div>
            </div>

            <div className="mt-2 border-t border-[#0f2b3f] pt-1.5 text-[9px] leading-[1.6] text-[#4d7691]">
              P presentation · D debug · C controls · M mute · 1-4 cameras
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
