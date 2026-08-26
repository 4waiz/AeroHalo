import type { Severity } from "@/sim/types";

/** 14:26:37 - the header clock and every timeline row use this. */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function formatUtcFull(ms: number): string {
  return `${formatUtc(ms)} UTC`;
}

export const kmh = (mps: number) => `${(mps * 3.6).toFixed(0)} km/h`;

export const metres = (m: number) => `${m.toFixed(1)} m`;

export const seconds = (s: number) => `${s.toFixed(1)} s`;

/** 9.1 rather than 9.13 - matches the risk readout on the alert cards. */
export const risk10 = (r: number) => r.toFixed(1);

export interface SeverityTheme {
  label: string;
  text: string;
  border: string;
  bg: string;
  bar: string;
  dot: string;
  glow: string;
  /** Solid hex, for canvas/SVG/three. */
  hex: string;
}

export const SEVERITY: Record<Severity, SeverityTheme> = {
  critical: {
    label: "CRITICAL",
    text: "text-[#ff5a5a]",
    border: "border-[#93202a]",
    bg: "bg-[#25101a]",
    bar: "bg-[#ff4343]",
    dot: "bg-[#ff4343]",
    glow: "shadow-[0_0_0_1px_rgba(255,67,67,0.14),0_6px_18px_-10px_rgba(255,67,67,0.5)]",
    hex: "#ff4343",
  },
  high: {
    label: "HIGH",
    text: "text-[#ff9a3c]",
    border: "border-[#8a4a15]",
    bg: "bg-[#231607]",
    bar: "bg-[#ff8b1f]",
    dot: "bg-[#ff8b1f]",
    glow: "shadow-[0_0_0_1px_rgba(255,139,31,0.12),0_6px_18px_-10px_rgba(255,139,31,0.45)]",
    hex: "#ff8b1f",
  },
  medium: {
    label: "MEDIUM",
    text: "text-[#f5c04a]",
    border: "border-[#7a5c17]",
    bg: "bg-[#1f1a07]",
    bar: "bg-[#f5a623]",
    dot: "bg-[#f5a623]",
    glow: "shadow-[0_0_0_1px_rgba(245,166,35,0.1)]",
    hex: "#f5a623",
  },
  low: {
    label: "LOW",
    text: "text-[#57c7f5]",
    border: "border-[#1b4b66]",
    bg: "bg-[#081a26]",
    bar: "bg-[#19a7ff]",
    dot: "bg-[#19a7ff]",
    glow: "",
    hex: "#19a7ff",
  },
  info: {
    label: "INFO",
    text: "text-[#31d17c]",
    border: "border-[#17435d]",
    bg: "bg-[#061321]",
    bar: "bg-[#31d17c]",
    dot: "bg-[#31d17c]",
    glow: "",
    hex: "#31d17c",
  },
};

/** Colour ramp used by the risk gauge and the score readout. */
export function riskColor(score: number): string {
  if (score >= 78) return "#ff4343";
  if (score >= 60) return "#ff7a2f";
  if (score >= 38) return "#f5a623";
  if (score >= 18) return "#c9d13c";
  return "#31d17c";
}

export function statusColor(status: "SAFE" | "CAUTION" | "CRITICAL"): string {
  return status === "CRITICAL" ? "#ff4343" : status === "CAUTION" ? "#f5a623" : "#31d17c";
}

export function clearanceColor(c: "CLEAR" | "CAUTION" | "HOLD"): string {
  return c === "HOLD" ? "#ff4343" : c === "CAUTION" ? "#f5a623" : "#31d17c";
}

/** Heatmap colour ramp: green -> amber -> red. */
export function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.5) {
    const k = x / 0.5;
    const r = Math.round(49 + (245 - 49) * k);
    const g = Math.round(209 + (166 - 209) * k);
    const b = Math.round(124 + (35 - 124) * k);
    return `rgb(${r},${g},${b})`;
  }
  const k = (x - 0.5) / 0.5;
  const r = Math.round(245 + (255 - 245) * k);
  const g = Math.round(166 + (67 - 166) * k);
  const b = Math.round(35 + (67 - 35) * k);
  return `rgb(${r},${g},${b})`;
}
