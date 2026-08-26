"use client";

import { useState } from "react";
import { useSim } from "@/sim/store";
import { AIRFRAMES } from "@/sim/aircraftTypes";
import { Panel, PanelLabel } from "./ui";

/** Stands drawn along the terminal frontage. A12 is the monitored one. */
const STANDS = [
  { id: "A09", x: 74, y: 84 },
  { id: "A10", x: 100, y: 84 },
  { id: "A11", x: 126, y: 84 },
  { id: "A12", x: 152, y: 84 },
  { id: "A13", x: 178, y: 84 },
  { id: "A14", x: 204, y: 84 },
  { id: "B03", x: 236, y: 108 },
  { id: "B04", x: 236, y: 128 },
];

/**
 * Stylised airfield schematic. Only stand A12 has a live sensor package in this
 * deployment, so selecting another stand reports standby rather than pretending
 * to switch feeds.
 */
export function AirfieldOverview() {
  const [selected, setSelected] = useState("A12");
  const airframeId = useSim((s) => s.airframeId);
  const status = useSim((s) => s.snap?.safetyStatus ?? "SAFE");

  const live = selected === "A12";
  const af = AIRFRAMES[airframeId];

  const accent =
    status === "CRITICAL" ? "#ff4343" : status === "CAUTION" ? "#f5a623" : "#25d9e8";

  return (
    <Panel className="min-h-0 flex-1 px-3.5 pb-2.5 pt-3">
      <PanelLabel>Airfield Overview</PanelLabel>

      <div className="relative mt-2 min-h-0 flex-1">
        <svg
          viewBox="0 0 300 190"
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
        >
          {/* faint grid */}
          <defs>
            <pattern id="afGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M20 0H0V20" fill="none" stroke="#0d2233" strokeWidth="0.5" />
            </pattern>
            <filter id="standGlow" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="2.6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect width="300" height="190" fill="url(#afGrid)" opacity="0.55" />

          {/* main runway 09/27 */}
          <rect
            x="14"
            y="156"
            width="272"
            height="11"
            fill="#08192a"
            stroke="#1d4a68"
            strokeWidth="0.9"
          />
          <line
            x1="26"
            y1="161.5"
            x2="274"
            y2="161.5"
            stroke="#2c6386"
            strokeWidth="0.8"
            strokeDasharray="9 7"
          />

          {/* crosswind runway 14/32 */}
          <g transform="rotate(-32 150 120)">
            <rect
              x="52"
              y="115"
              width="200"
              height="9"
              fill="#08192a"
              stroke="#1a4058"
              strokeWidth="0.8"
              opacity="0.8"
            />
            <line
              x1="62"
              y1="119.5"
              x2="242"
              y2="119.5"
              stroke="#255a7a"
              strokeWidth="0.7"
              strokeDasharray="8 8"
              opacity="0.75"
            />
          </g>

          {/* taxiways */}
          <path
            d="M40 156 L40 132 L262 132 L262 156"
            fill="none"
            stroke="#1a4159"
            strokeWidth="1.5"
          />
          <path
            d="M92 132 L92 104 M152 132 L152 104 M212 132 L212 104"
            fill="none"
            stroke="#173a51"
            strokeWidth="1.2"
          />
          <path d="M62 104 L246 104" fill="none" stroke="#1a4159" strokeWidth="1.5" />

          {/* terminal block */}
          <path
            d="M62 44 L214 44 L226 56 L226 74 L62 74 Z"
            fill="#0a1e2e"
            stroke="#215a7c"
            strokeWidth="1"
          />
          <path
            d="M70 50 L206 50"
            stroke="#17435d"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          <text
            x="144"
            y="66"
            textAnchor="middle"
            fill="#4d7691"
            style={{ fontSize: 8, letterSpacing: "0.14em", fontWeight: 600 }}
          >
            TERMINAL 1
          </text>

          {/* apron outline */}
          <rect
            x="58"
            y="74"
            width="172"
            height="26"
            fill="#061523"
            stroke="#123c53"
            strokeWidth="0.8"
          />

          {/* stands */}
          {STANDS.map((s) => {
            const isSel = s.id === selected;
            const isLive = s.id === "A12";
            return (
              <g
                key={s.id}
                onClick={() => setSelected(s.id)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={s.x - 11}
                  y={s.y - 7}
                  width="22"
                  height="15"
                  rx="1.5"
                  fill={isSel ? "#0d3d4a" : "#08202f"}
                  stroke={isSel ? accent : isLive ? "#1d6b8f" : "#16394f"}
                  strokeWidth={isSel ? 1.4 : 0.9}
                  filter={isSel ? "url(#standGlow)" : undefined}
                  style={{ transition: "fill 200ms, stroke 200ms" }}
                />
                <text
                  x={s.x}
                  y={s.y + 3.6}
                  textAnchor="middle"
                  fill={isSel ? accent : "#4d7691"}
                  style={{ fontSize: 7.4, fontWeight: 700, letterSpacing: "0.04em" }}
                >
                  {s.id}
                </text>
                {isLive && (
                  <circle cx={s.x + 8.4} cy={s.y - 4.2} r="1.7" fill="#31d17c">
                    <animate
                      attributeName="opacity"
                      values="1;0.25;1"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
              </g>
            );
          })}

          {/* sector callout on the monitored stand */}
          {live && (
            <g>
              <line
                x1="152"
                y1="92"
                x2="152"
                y2="104"
                stroke={accent}
                strokeWidth="0.9"
                strokeDasharray="2 2"
              />
              <circle cx="152" cy="104" r="2.2" fill={accent} opacity="0.85" />
            </g>
          )}
        </svg>
      </div>

      <div className="mt-1.5 flex items-center justify-between border-t border-[#0f2b3f] pt-2">
        <span className="text-[10.5px] font-semibold tracking-[0.07em] text-[#9fb6c6]">
          STAND {selected}
        </span>
        {live ? (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.05em] text-[#31d17c]">
            <span className="live-dot inline-block h-[5px] w-[5px] rounded-full bg-[#31d17c]" />
            LIVE · {af.shortName}
          </span>
        ) : (
          <span className="text-[10px] font-semibold tracking-[0.05em] text-[#5f7d94]">
            STANDBY · NO SENSOR PKG
          </span>
        )}
      </div>
    </Panel>
  );
}
