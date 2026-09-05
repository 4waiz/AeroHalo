"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Panel } from "./ui";
import { AirsideScene } from "@/three/Scene";
import { useLive } from "@/live/liveStore";

/**
 * LIVE HARDWARE centre view.
 *
 * The same 3D apron the simulation uses, with every simulated entity removed
 * and the real HC-SR04 beam added. The apron, the aircraft and the painted
 * zones are scenery; the only thing that moves is the marker on the range
 * corridor, and it moves because a physical sensor measured it.
 */

const DOT = {
  ok: "#31d17c",
  warn: "#f5a623",
  bad: "#ff4343",
} as const;

function Chip({
  label,
  value,
  colour,
}: {
  label: string;
  value: string;
  colour: string;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-[4px] border border-[#14384f] bg-[#040f19]/88 px-2.5 py-[6px] text-[10.5px] font-semibold tracking-[0.04em] backdrop-blur-[2px]">
      <span
        className="h-[7px] w-[7px] rounded-full"
        style={{ background: colour, boxShadow: `0 0 6px ${colour}` }}
      />
      <span className="text-[#6f8ba0]">{label}</span>
      <span style={{ color: colour }}>{value}</span>
    </span>
  );
}

export function LiveMonitoringView() {
  const shell = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);

  // Real Fullscreen API rather than a CSS fake, so the 3D canvas gets the whole
  // display and the browser chrome gets out of the way for the demonstration.
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // F toggles, Escape is handled by the browser itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "f" || e.key === "F") toggleFull();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFull]);

  const link = useLive((s) => s.link);
  const pir = useLive((s) => s.state?.pir);
  const vib = useLive((s) => s.state?.vibration);
  const rng = useLive((s) => s.state?.range);
  const risk = useLive((s) => s.state?.risk.state);
  const cleared = useLive((s) => s.state?.hold.hazard_cleared ?? false);
  const offline = link === "offline";

  const linkChip = offline
    ? { v: "OFFLINE", c: DOT.bad }
    : link === "stale"
      ? { v: "STALE", c: DOT.warn }
      : { v: "ONLINE", c: DOT.ok };

  const rangeChip = offline
    ? { v: "OFFLINE", c: DOT.bad }
    : rng?.valid
      ? {
          v: `${rng.distance_cm?.toFixed(1)} cm`,
          c:
            rng.state === "HOLD"
              ? DOT.bad
              : rng.state === "CAUTION"
                ? DOT.warn
                : DOT.ok,
        }
      : { v: rng?.state === "SAFE" ? "CLEAR" : "NO ECHO", c: rng?.state === "SAFE" ? DOT.ok : DOT.warn };

  // Same SAFE / CAUTION / HOLD vocabulary as the fused state, straight from
  // the board, so the chips and the verdict can never disagree.
  const chipFor = (st: string | undefined) =>
    offline || !st
      ? { v: "OFFLINE", c: DOT.bad }
      : st === "SAFE"
        ? { v: "SAFE", c: DOT.ok }
        : st === "CAUTION"
          ? { v: "CAUTION", c: DOT.warn }
          : st === "HOLD"
            ? { v: "HOLD", c: DOT.bad }
            : { v: "UNKNOWN", c: DOT.warn };

  const pirChip = chipFor(pir?.state);
  const vibChip = chipFor(vib?.state);

  const stateColour =
    offline || !risk
      ? "#7d97ab"
      : risk === "SAFE"
        ? DOT.ok
        : risk === "CAUTION"
          ? DOT.warn
          : risk === "HOLD"
            ? DOT.bad
            : "#7d97ab";

  return (
    <Panel className="relative min-h-0 flex-1 overflow-hidden p-0">
      <div ref={shell} className="absolute inset-0 bg-[#030b14]">
        <AirsideScene live />

        <button
          type="button"
          onClick={toggleFull}
          title={full ? "Exit fullscreen (F)" : "Fullscreen (F)"}
          className="absolute right-3 bottom-3 z-20 flex items-center gap-1.5 rounded-[4px] border border-[#14384f] bg-[#040f19]/88 px-2.5 py-[7px] text-[10.5px] font-semibold tracking-[0.05em] text-[#7fd8ef] backdrop-blur-[2px] transition-colors hover:border-[#1d5679] hover:bg-[#0b2233]"
        >
          {full ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
          {full ? "EXIT" : "FULLSCREEN"}
        </button>

      {/* top-left: what the hardware is doing */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <Chip label="UNO Q" value={linkChip.v} colour={linkChip.c} />
        <Chip label="RANGE" value={rangeChip.v} colour={rangeChip.c} />
        <Chip label="PIR" value={pirChip.v} colour={pirChip.c} />
        <Chip label="VIBRATION" value={vibChip.v} colour={vibChip.c} />
      </div>

      {/* top-right: the fused verdict, readable across a room */}
      <div className="pointer-events-none absolute right-3 top-3 z-10">
        <div
          className="rounded-[5px] border bg-[#040f19]/88 px-3.5 py-2 text-center backdrop-blur-[2px]"
          style={{ borderColor: `${stateColour}55` }}
        >
          <div className="text-[9px] tracking-[0.12em] text-[#6f8ba0]">
            FUSED STATE
          </div>
          <div
            className="text-[19px] font-bold leading-tight tracking-[0.02em]"
            style={{ color: stateColour }}
          >
            {offline ? "UNKNOWN" : (risk ?? "UNKNOWN")}
          </div>
          {cleared && !offline && (
            // All sensors read SAFE and the interlock is still set. Saying so
            // stops a row of green chips beside a red verdict looking like a
            // bug rather than a latch waiting on a person.
            <div className="mt-0.5 text-[8.5px] leading-[1.3] tracking-[0.08em] text-[#f5a623]">
              LATCHED · HAZARD CLEARED
              <br />
              AWAITING RESET
            </div>
          )}
        </div>
      </div>

      </div>
    </Panel>
  );
}
