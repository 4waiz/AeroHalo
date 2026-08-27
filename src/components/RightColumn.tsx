"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Cpu,
  Gauge,
  PersonStanding,
  Radio,
  Truck,
  Video,
  Cog,
  Flame,
} from "lucide-react";
import type { Alert } from "@/sim/types";
import { useSim } from "@/sim/store";
import { AIRFRAMES } from "@/sim/aircraftTypes";
import { Panel, PanelLabel, SegmentBar } from "./ui";
import { SEVERITY, formatUtc, heatColor, risk10 } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Live alerts                                                         */
/* ------------------------------------------------------------------ */

function AlertIcon({ alert }: { alert: Alert }) {
  const s = SEVERITY[alert.level];
  const Icon =
    alert.targetKind === "vehicle"
      ? Truck
      : alert.targetKind === "person"
        ? PersonStanding
        : alert.targetKind === "fod"
          ? Cog
          : Flame;
  return (
    <div
      className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border"
      style={{ borderColor: `${s.hex}55`, background: `${s.hex}12` }}
    >
      <Icon size={21} strokeWidth={1.8} style={{ color: s.hex }} />
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const focusTarget = useSim((st) => st.focusTarget);
  const s = SEVERITY[alert.level];
  const resolved = alert.resolvedAt !== null;

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: -10, scale: 0.985 }}
      animate={{ opacity: resolved ? 0.42 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.22 } }}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.7 }}
      onClick={() => focusTarget(alert.targetId)}
      title="Focus this hazard in the monitoring view"
      className={`group w-full shrink-0 overflow-hidden rounded-[5px] border text-left ${s.border} ${s.bg} ${s.glow} transition-colors hover:brightness-[1.14]`}
    >
      <div className="flex items-start gap-2.5 px-2.5 pb-2.5 pt-2.5">
        <AlertIcon alert={alert} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[11px] font-bold tracking-[0.07em] ${s.text}`}
            >
              {s.label}
            </span>
            <span className="tnum shrink-0 text-[10.5px] font-medium text-[#7d97ab]">
              {formatUtc(alert.timestamp)}
            </span>
          </div>

          <div className="mt-[5px] text-[14px] font-semibold leading-[1.25] text-[#f3f7fa]">
            {alert.title}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <span className="shrink-0 text-[10px] font-medium tracking-[0.03em] text-[#7d97ab]">
              Risk Level
            </span>
            <SegmentBar value={alert.risk} color={s.hex} className="flex-1" />
            <span className="tnum shrink-0 text-[12.5px] font-bold text-[#f3f7fa]">
              {risk10(alert.risk)}/10
            </span>
          </div>
        </div>

        <ChevronRight
          size={17}
          className="mt-3 shrink-0 text-[#4d7691] transition-colors group-hover:text-[#8fa7b8]"
        />
      </div>

      <div
        className="border-t px-2.5 py-[7px]"
        style={{ borderColor: `${s.hex}22`, background: "#00000026" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[10.5px] text-[#8fa7b8]">
            Location: {alert.location}
          </span>
          {alert.ttc != null && !resolved && (
            <span
              className="tnum shrink-0 text-[10.5px] font-bold"
              style={{ color: s.hex }}
            >
              TTC {alert.ttc.toFixed(1)}s
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

export function LiveAlertsPanel() {
  const alerts = useSim((s) => s.snap?.activeAlerts ?? []);
  const setFullLogOpen = useSim((s) => s.setFullLogOpen);
  const activeCount = alerts.filter((a) => a.resolvedAt === null).length;

  return (
    <Panel className="min-h-0 flex-1 px-2.5 pb-2 pt-2.5">
      <PanelLabel
        className="px-1"
        right={
          <button
            type="button"
            onClick={() => setFullLogOpen(true)}
            className="text-[11px] font-medium text-[#19a7ff] transition-colors hover:text-[#5cc2ff]"
          >
            View All
          </button>
        }
      >
        <span className="flex items-center gap-2">
          <Bell size={13} strokeWidth={2} className="text-[#7d97ab]" />
          Live Alerts
          {activeCount > 0 && (
            <span className="tnum flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#ff4343] px-1 text-[10px] font-bold leading-none text-white">
              {activeCount}
            </span>
          )}
        </span>
      </PanelLabel>

      <div className="scroll-thin mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
        <AnimatePresence initial={false} mode="popLayout">
          {alerts.map((a) => (
            <AlertCard key={a.id} alert={a} />
          ))}
        </AnimatePresence>

        {alerts.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <div className="flex h-[42px] w-[42px] items-center justify-center rounded-full border border-[#1c5c43] bg-[#061e17]">
              <Bell size={18} className="text-[#31d17c]" strokeWidth={1.8} />
            </div>
            <div className="text-[12.5px] font-semibold text-[#31d17c]">
              No active alerts
            </div>
            <div className="max-w-[190px] text-[10.5px] leading-relaxed text-[#5f7d94]">
              All safety zones clear. AeroHalo is tracking the stand.
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Risk heatmap                                                        */
/* ------------------------------------------------------------------ */

export function RiskHeatmapPanel() {
  const heat = useSim((s) => s.snap?.heat ?? []);
  const airframeId = useSim((s) => s.airframeId);
  const af = AIRFRAMES[airframeId];

  // The heatmap footprint mirrors RiskEngine.extents(): the airframe envelope
  // plus a 7 m pad, mapped into a 0..1 UV space.
  const pad = 7 * af.worldScale;
  const minX = -(af.envelope.halfSpan + pad);
  const maxX = af.envelope.halfSpan + pad;
  const minZ = af.envelope.noseZ - pad;
  const maxZ = af.envelope.tailZ + pad;

  const W = 250;
  const H = 104;

  const toSvg = (x: number, z: number) => ({
    sx: ((x - minX) / (maxX - minX)) * W,
    sy: ((z - minZ) / (maxZ - minZ)) * H,
  });

  const planform = af.planform
    .map((p) => {
      const { sx, sy } = toSvg(p.x, p.z);
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    })
    .join(" ");

  return (
    <Panel className="shrink-0 px-3.5 pb-3 pt-3">
      <PanelLabel>Risk Heatmap (Live)</PanelLabel>
      <div className="mt-2 flex items-stretch gap-2.5">
        <div className="relative flex-1 overflow-hidden rounded-[4px] border border-[#123147] bg-[#04101b]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
            <defs>
              <filter id="heatBlur" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="5.2" />
              </filter>
              <pattern id="hmGrid" width="16" height="16" patternUnits="userSpaceOnUse">
                <path d="M16 0H0V16" fill="none" stroke="#0c2132" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width={W} height={H} fill="url(#hmGrid)" />

            {/* accumulated heat */}
            <g filter="url(#heatBlur)" opacity="0.92">
              {heat.map((c, i) => (
                <circle
                  key={i}
                  cx={c.u * W}
                  cy={c.v * H}
                  r={5.5 + c.intensity * 5}
                  fill={heatColor(c.intensity)}
                  opacity={0.16 + c.intensity * 0.6}
                />
              ))}
            </g>

            {/* aircraft planform, drawn on top so the shape stays readable */}
            <polygon
              points={planform}
              fill="#0a2739"
              fillOpacity="0.5"
              stroke="#3ec8ef"
              strokeWidth="1"
              strokeLinejoin="round"
            />
            <line
              x1={toSvg(0, minZ).sx}
              y1={toSvg(0, af.envelope.noseZ).sy}
              x2={toSvg(0, 0).sx}
              y2={toSvg(0, af.envelope.tailZ).sy}
              stroke="#25d9e8"
              strokeWidth="0.6"
              opacity="0.45"
              strokeDasharray="3 3"
            />
          </svg>
        </div>

        {/* legend */}
        <div className="flex w-[34px] shrink-0 flex-col items-center justify-between py-0.5">
          <span className="text-[9px] font-semibold tracking-[0.06em] text-[#8fa7b8]">
            High
          </span>
          <div
            className="my-1 w-[9px] flex-1 rounded-[2px]"
            style={{
              background: "linear-gradient(to bottom, #ff4343, #f5a623, #c9d13c, #31d17c)",
            }}
          />
          <span className="text-[9px] font-semibold tracking-[0.06em] text-[#8fa7b8]">
            Low
          </span>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* System summary                                                      */
/* ------------------------------------------------------------------ */

function SummaryTile({
  icon,
  value,
  label,
  tone = "#3ec8ef",
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="panel-flat flex flex-col items-center px-1 pb-2.5 pt-2.5">
      <div
        className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] border"
        style={{ borderColor: `${tone}3a`, background: `${tone}12`, color: tone }}
      >
        {icon}
      </div>
      <div className="tnum mt-1.5 text-[16px] font-bold leading-none text-[#f3f7fa]">
        {value}
      </div>
      <div className="mt-1 text-center text-[9px] font-medium leading-[1.25] text-[#7d97ab]">
        {label}
      </div>
    </div>
  );
}

export function SystemSummaryPanel() {
  const snap = useSim((s) => s.snap);
  const sensors = snap?.sensorsOnline ?? 12;
  const cams = snap?.camerasOnline ?? 6;
  const acc = snap?.inferenceAccuracy ?? 98;
  const ms = snap?.responseMs ?? 256;

  return (
    <Panel className="shrink-0 px-3 pb-3 pt-3">
      <PanelLabel>System Summary</PanelLabel>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <SummaryTile
          icon={<Radio size={14} strokeWidth={2} />}
          value={String(sensors)}
          label="Sensors Online"
        />
        <SummaryTile
          icon={<Video size={14} strokeWidth={2} />}
          value={String(cams)}
          label="Cameras Active"
          tone="#25d9e8"
        />
        <SummaryTile
          icon={<Cpu size={14} strokeWidth={2} />}
          value={`${acc.toFixed(0)}%`}
          label="AI Inference Accuracy"
          tone="#31d17c"
        />
        <SummaryTile
          icon={<Gauge size={14} strokeWidth={2} />}
          value={`${Math.round(ms)} ms`}
          label="Avg. Response Time"
          tone="#f5a623"
        />
      </div>
    </Panel>
  );
}
