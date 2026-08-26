"use client";

import type { ReactNode } from "react";

/** Standard bordered panel used by every dashboard card. */
export function Panel({
  children,
  className = "",
  onClick,
  title,
  style,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`panel flex flex-col overflow-hidden ${
        onClick ? "cursor-pointer transition-colors hover:border-[#1d5679]" : ""
      } ${className}`}
      onClick={onClick}
      title={title}
      style={style}
    >
      {children}
    </div>
  );
}

/** Uppercase telemetry label that sits at the top-left of a card. */
export function PanelLabel({
  children,
  right,
  className = "",
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <span className="panel-label">{children}</span>
      {right}
    </div>
  );
}

/** Thin progress rail used on the sensor and camera cards. */
export function MiniBar({
  value,
  color = "#25d9e8",
  className = "",
}: {
  value: number;
  color?: string;
  className?: string;
}) {
  return (
    <div className={`h-[3px] w-full overflow-hidden rounded-full bg-[#0d2536] ${className}`}>
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

/**
 * Segmented risk meter, the little block bar on each alert card.
 * Ten segments so a 9.1/10 reading maps directly onto the graphic.
 */
export function SegmentBar({
  value,
  color,
  segments = 10,
  className = "",
}: {
  value: number;
  color: string;
  segments?: number;
  className?: string;
}) {
  const filled = Math.round((Math.max(0, Math.min(10, value)) / 10) * segments);
  return (
    <div className={`flex items-center gap-[2px] ${className}`}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className="h-[7px] w-[7px] rounded-[1px] transition-colors duration-300"
          style={{ background: i < filled ? color : "#16344a" }}
        />
      ))}
    </div>
  );
}

/** Small pill used for toggles and status chips in the monitoring view. */
export function Chip({
  children,
  active = false,
  onClick,
  className = "",
  title,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded-[4px] border px-2.5 py-[6px] text-[11px] font-semibold tracking-[0.04em] transition-colors ${
        active
          ? "border-[#1d6b8f] bg-[#0b2c40] text-[#9fdcf2]"
          : "border-[#14384f] bg-[#071827]/85 text-[#8fa7b8] hover:border-[#1d5679] hover:text-[#c4d8e5]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Live green indicator with a soft pulse. */
export function LiveDot({ color = "#31d17c" }: { color?: string }) {
  return (
    <span
      className="live-dot inline-block h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

/** Row divider matching the timeline and alert panels. */
export function Hair() {
  return <div className="h-px w-full bg-[#0f2b3f]" />;
}
