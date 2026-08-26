"use client";

import { Activity, Cloud } from "lucide-react";
import { useSim } from "@/sim/store";
import { formatUtc } from "@/lib/format";

/** AeroHalo mark: a radar halo sweeping around a nose-on aircraft. */
function Logo() {
  return (
    <svg
      width="46"
      height="46"
      viewBox="0 0 48 48"
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      <circle cx="24" cy="24" r="22.5" fill="#04121f" stroke="#1b4e6b" strokeWidth="1" />
      <circle cx="24" cy="24" r="18" stroke="#123a52" strokeWidth="1" />
      <circle cx="24" cy="24" r="12.5" stroke="#17587a" strokeWidth="1" opacity="0.8" />
      {/* halo arcs */}
      <path
        d="M6.5 24a17.5 17.5 0 0 1 8-14.7"
        stroke="#25d9e8"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M41.5 24a17.5 17.5 0 0 1-8 14.7"
        stroke="#25d9e8"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* aircraft glyph, nose up */}
      <path
        d="M24 14.2c.85 0 1.5 1.15 1.62 2.72l.1 3.03 6.9 4.06v1.86l-6.86-2.05-.06 4.06 2.5 1.9v1.5L24 30.3l-4.2.98v-1.5l2.5-1.9-.06-4.06-6.86 2.05v-1.86l6.9-4.06.1-3.03c.12-1.57.77-2.72 1.62-2.72Z"
        fill="#7fd8ef"
      />
      <circle cx="24" cy="24" r="22.5" stroke="#25d9e8" strokeWidth="1" opacity="0.35" />
    </svg>
  );
}

function Divider() {
  return <span className="mx-3 h-4 w-px bg-[#1b4462]" />;
}

export function Header() {
  const clock = useSim((s) => s.snap?.clock ?? 0);
  const sensorsOnline = useSim((s) => s.snap?.sensorsOnline ?? 0);
  const sensorsTotal = useSim((s) => s.snap?.sensorsTotal ?? 12);

  const online = sensorsOnline > 0;

  return (
    <header
      className="relative flex shrink-0 items-center justify-between border-b border-[#123147] bg-gradient-to-b from-[#07182a] to-[#04101c] px-4"
      style={{ height: "var(--hdr-h)" }}
    >
      {/* left: mark + wordmark */}
      <div className="flex items-center gap-3">
        <Logo />
        <div className="leading-none">
          <h1
            className="font-semibold leading-none tracking-[-0.015em]"
            style={{ fontSize: "var(--t-title)" }}
          >
            <span className="text-[#3ec8ef]">AeroHalo</span>{" "}
            <span className="font-medium text-[#eef5fa]">
              Predictive Airside Safety Dashboard
            </span>
          </h1>
          <div
            className="mt-[6px] flex items-center font-medium tracking-[0.02em] text-[#7d97ab]"
            style={{ fontSize: "var(--t-sub)" }}
          >
            <span>Smart Aviation Systems</span>
            <span className="mx-2 text-[#2b526d]">|</span>
            <span>Edge AI</span>
            <span className="mx-2 text-[#2b526d]">|</span>
            <span>Arduino UNO Q</span>
          </div>
        </div>
      </div>

      {/* right: environment + clock + link state */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center rounded-[5px] border border-[#123c56] bg-[#06182a] px-3.5 py-[9px]">
          <Cloud size={15} className="mr-2 text-[#8fa7b8]" strokeWidth={1.7} />
          <span className="tnum text-[13.5px] font-medium text-[#dce8f1]">24°C</span>
          <Divider />
          <span className="tnum text-[13.5px] font-medium tracking-[0.01em] text-[#dce8f1]">
            {formatUtc(clock)} UTC
          </span>
        </div>

        <div
          className={`flex items-center gap-2 rounded-[5px] border px-3.5 py-[9px] ${
            online
              ? "border-[#1c5c43] bg-[#061e17]"
              : "border-[#7a2028] bg-[#1c0c0f]"
          }`}
          title={`${sensorsOnline}/${sensorsTotal} sensors reporting`}
        >
          <Activity
            size={15}
            className={online ? "text-[#31d17c]" : "text-[#ff4343]"}
            strokeWidth={2}
          />
          <span
            className={`text-[12.5px] font-semibold tracking-[0.06em] ${
              online ? "text-[#31d17c]" : "text-[#ff5a5a]"
            }`}
          >
            {online ? "SYSTEM ONLINE" : "SYSTEM FAULT"}
          </span>
        </div>
      </div>
    </header>
  );
}
