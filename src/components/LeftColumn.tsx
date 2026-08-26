"use client";

import { Bell, Camera, Radio, ShieldCheck, TriangleAlert } from "lucide-react";
import { useSim } from "@/sim/store";
import { MiniBar, Panel, PanelLabel } from "./ui";
import { RiskEngine } from "@/sim/RiskEngine";
import { riskColor, statusColor } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Safety status                                                       */
/* ------------------------------------------------------------------ */

const STATUS_COPY: Record<string, string> = {
  SAFE: "All airside operations within safe parameters",
  CAUTION: "Airside operations require heightened awareness",
  CRITICAL: "Immediate hazard on stand – suspend ground movement",
};

export function SafetyStatusCard() {
  const status = useSim((s) => s.snap?.safetyStatus ?? "SAFE");
  const colour = statusColor(status);

  return (
    <Panel className="shrink-0 px-3.5 pb-4 pt-3">
      <PanelLabel>Safety Status</PanelLabel>
      <div className="flex flex-1 flex-col items-center justify-center pt-3">
        <div className="flex items-center gap-2.5">
          <span
            className="font-bold leading-none tracking-[0.005em] transition-colors duration-500"
            style={{ color: colour, fontSize: "var(--t-status)" }}
          >
            {status}
          </span>
          <TriangleAlert
            size={30}
            strokeWidth={1.9}
            style={{ color: colour }}
            className={status === "CRITICAL" ? "crit-dot rounded-full" : ""}
          />
        </div>
        <p className="mt-3 max-w-[210px] text-center text-[11.5px] leading-[1.5] text-[#829bad]">
          {STATUS_COPY[status]}
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Risk gauge                                                          */
/* ------------------------------------------------------------------ */

const R = 76;
const CX = 100;
const CY = 100;
const ARC_LEN = Math.PI * R;

export function RiskGaugeCard() {
  const score = useSim((s) => s.snap?.riskScore ?? 0);
  const rounded = Math.round(score);
  const colour = riskColor(score);
  const label = RiskEngine.labelFor(score);

  const offset = ARC_LEN * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <Panel className="shrink-0 px-3.5 pb-3.5 pt-3">
      <PanelLabel>Risk Score</PanelLabel>
      <div className="relative flex flex-1 items-end justify-center pt-1">
        <svg
          viewBox="0 0 200 118"
          className="overflow-visible"
          style={{ width: "var(--t-gauge)" }}
        >
          <defs>
            <linearGradient id="riskGrad" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#c9d13c" />
              <stop offset="45%" stopColor="#f5a623" />
              <stop offset="100%" stopColor="#ff5f2e" />
            </linearGradient>
          </defs>

          {/* track */}
          <path
            d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
            fill="none"
            stroke="#0f2839"
            strokeWidth="11"
            strokeLinecap="round"
          />
          {/* value */}
          <path
            d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
            fill="none"
            stroke="url(#riskGrad)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={ARC_LEN}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 420ms cubic-bezier(0.22,1,0.36,1)" }}
          />

          <text
            x={CX}
            y={86}
            textAnchor="middle"
            className="tnum"
            style={{ fontSize: 42, fontWeight: 700, fill: "#f3f7fa", letterSpacing: "-0.02em" }}
          >
            {rounded}
          </text>
          <text
            x={CX}
            y={106}
            textAnchor="middle"
            className="tnum"
            style={{ fontSize: 12.5, fontWeight: 500, fill: "#7d97ab" }}
          >
            /100
          </text>
        </svg>
      </div>
      <div
        className="pb-0.5 text-center text-[14px] font-semibold transition-colors duration-500"
        style={{ color: colour }}
      >
        {label}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Four small telemetry cards                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
  sub,
  subColor,
  bar,
  barColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  subColor: string;
  bar?: number;
  barColor?: string;
}) {
  return (
    <Panel className="justify-between px-3 pb-2.5 pt-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[#7d97ab]">{icon}</span>
        <span className="panel-label text-[9.5px] leading-[1.2]">{label}</span>
      </div>
      <div className="mt-1.5">
        <div
          className="tnum font-bold leading-none tracking-[-0.01em] text-[#f3f7fa]"
          style={{ fontSize: "var(--t-stat)" }}
        >
          {value}
        </div>
        <div
          className="mt-[5px] text-[11px] font-medium leading-none"
          style={{ color: subColor }}
        >
          {sub}
        </div>
      </div>
      {bar !== undefined ? (
        <MiniBar value={bar} color={barColor} className="mt-2.5" />
      ) : (
        <div className="mt-2.5 h-[3px]" />
      )}
    </Panel>
  );
}

export function StatusCardGrid() {
  const snap = useSim((s) => s.snap);
  const alerts = snap?.activeAlerts.filter((a) => a.resolvedAt === null) ?? [];
  const highPriority = alerts.filter(
    (a) => a.level === "critical" || a.level === "high"
  ).length;

  const integrity = snap?.zoneIntegrity ?? 100;
  const integrityLabel =
    integrity >= 95 ? "Secure" : integrity >= 85 ? "Good" : integrity >= 70 ? "Degraded" : "Breached";
  const integrityColor =
    integrity >= 95 ? "#31d17c" : integrity >= 85 ? "#31d17c" : integrity >= 70 ? "#f5a623" : "#ff4343";

  const sOn = snap?.sensorsOnline ?? 12;
  const sTot = snap?.sensorsTotal ?? 12;
  const camHealth = Math.round(snap?.cameraHealth ?? 100);
  const camsOnline = snap?.camerasOnline ?? 6;
  const camsTotal = snap?.camerasTotal ?? 6;

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2.5">
      <StatCard
        icon={<Bell size={13} strokeWidth={2} />}
        label="Active Alerts"
        value={String(alerts.length)}
        sub={highPriority > 0 ? "High Priority" : alerts.length ? "Monitoring" : "None Active"}
        subColor={highPriority > 0 ? "#f5a623" : alerts.length ? "#8fa7b8" : "#31d17c"}
      />
      <StatCard
        icon={<ShieldCheck size={13} strokeWidth={2} />}
        label="Zone Integrity"
        value={`${integrity}%`}
        sub={integrityLabel}
        subColor={integrityColor}
      />
      <StatCard
        icon={<Radio size={13} strokeWidth={2} />}
        label="Sensor Status"
        value={`${sOn} / ${sTot}`}
        sub={sOn === sTot ? "Online" : "Degraded"}
        subColor={sOn === sTot ? "#31d17c" : "#f5a623"}
        bar={(sOn / Math.max(1, sTot)) * 100}
        barColor={sOn === sTot ? "#25d9e8" : "#f5a623"}
      />
      <StatCard
        icon={<Camera size={13} strokeWidth={2} />}
        label="Camera Feed Health"
        value={`${camHealth}%`}
        sub={camsOnline === camsTotal ? "All Clear" : `${camsOnline}/${camsTotal} Online`}
        subColor={camsOnline === camsTotal ? "#31d17c" : "#f5a623"}
        bar={camHealth}
        barColor={camsOnline === camsTotal ? "#25d9e8" : "#f5a623"}
      />
    </div>
  );
}
