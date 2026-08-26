"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import type { SafetyEvent } from "@/sim/types";
import { MAX_VISIBLE_EVENTS } from "@/sim/constants";
import { useSim } from "@/sim/store";
import { Panel, PanelLabel } from "./ui";
import { SEVERITY, formatUtc } from "@/lib/format";

function Row({ ev, onFocus }: { ev: SafetyEvent; onFocus: (id: string) => void }) {
  const s = SEVERITY[ev.level];
  const isInfo = ev.level === "info" || ev.level === "low";
  const clickable = Boolean(ev.targetId);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 460, damping: 36 }}
      onClick={() => ev.targetId && onFocus(ev.targetId)}
      className={`tl-row row-hover flex items-center gap-3 border-b border-[#0f2b3f] px-3 py-[9px] ${
        clickable ? "cursor-pointer" : ""
      }`}
      title={clickable ? "Focus this object in the monitoring view" : undefined}
    >
      {isInfo ? (
        <CircleCheck size={15} strokeWidth={1.9} className="shrink-0 text-[#31d17c]" />
      ) : (
        <TriangleAlert
          size={15}
          strokeWidth={1.9}
          className="shrink-0"
          style={{ color: s.hex }}
        />
      )}

      <span className="tnum w-[58px] shrink-0 text-[12px] font-medium text-[#c4d8e5]">
        {formatUtc(ev.timestamp)}
      </span>

      <span
        className={`w-[62px] shrink-0 text-[10.5px] font-bold tracking-[0.06em] ${s.text}`}
      >
        {s.label}
      </span>

      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#dce8f1]">
        {ev.message}
      </span>

      <span className="hidden shrink-0 truncate text-[11.5px] text-[#7d97ab] lg:block lg:max-w-[190px]">
        {ev.location}
      </span>

      <ChevronRight size={15} className="shrink-0 text-[#345f7d]" />
    </motion.div>
  );
}

export function EventTimeline() {
  const events = useSim((s) => s.snap?.events ?? []);
  const focusTarget = useSim((s) => s.focusTarget);
  const setFullLogOpen = useSim((s) => s.setFullLogOpen);

  const visible = events.slice(0, MAX_VISIBLE_EVENTS);

  return (
    <Panel className="shrink-0 pt-3" style={{ height: "var(--tl-h)" }}>
      <PanelLabel className="px-3 pb-2.5">Safety Timeline / Event Log</PanelLabel>

      <div className="min-h-0 flex-1 overflow-hidden border-t border-[#0f2b3f]">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((ev) => (
            <Row key={ev.id} ev={ev} onFocus={focusTarget} />
          ))}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-end px-3 py-[7px]">
        <button
          type="button"
          onClick={() => setFullLogOpen(true)}
          className="flex items-center gap-1 text-[11.5px] font-medium text-[#19a7ff] transition-colors hover:text-[#5cc2ff]"
        >
          View Full Log
          <ChevronRight size={13} />
        </button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Full log overlay                                                    */
/* ------------------------------------------------------------------ */

export function FullLogOverlay() {
  const open = useSim((s) => s.fullLogOpen);
  const setOpen = useSim((s) => s.setFullLogOpen);
  const events = useSim((s) => s.snap?.events ?? []);
  const focusTarget = useSim((s) => s.focusTarget);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#020810]/78 p-8"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.97, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.98, y: 6 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="panel flex h-full max-h-[720px] w-full max-w-[1000px] flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#0f2b3f] px-4 py-3">
              <PanelLabel>Safety Timeline / Full Event Log</PanelLabel>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[11.5px] font-medium text-[#8fa7b8] transition-colors hover:text-[#f3f7fa]"
              >
                Close (Esc)
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {events.map((ev) => (
                <Row key={ev.id} ev={ev} onFocus={focusTarget} />
              ))}
              {events.length === 0 && (
                <div className="p-6 text-center text-[12px] text-[#5f7d94]">
                  No events recorded yet.
                </div>
              )}
            </div>
            <div className="border-t border-[#0f2b3f] px-4 py-2 text-[10.5px] text-[#5f7d94]">
              {events.length} entries · newest first
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
