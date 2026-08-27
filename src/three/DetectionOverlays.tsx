"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { TrackedOverlay } from "@/sim/types";
import type { Airframe } from "@/sim/aircraftTypes";
import { getEngine, useSim } from "@/sim/store";
import { SEVERITY } from "@/lib/format";
import { getOverlayNode, registerOverlay } from "./overlayBus";

/* ------------------------------------------------------------------ */
/* In-canvas projector                                                 */
/* ------------------------------------------------------------------ */

const base = new THREE.Vector3();
const top = new THREE.Vector3();

/** Fallback footprint, used only until a card has been measured. */
const LABEL_W = 150;
const LABEL_H = 46;
/** Offsets tried in order when a label needs to move clear of another. */
const LABEL_SLOTS = [0, -48, -96, 48, -144, 96, -192];

/**
 * Projects each tracked object's live world position to screen space and writes
 * the result straight onto the overlay DOM nodes.
 *
 * Runs inside the canvas so it shares the render loop and the same camera
 * matrices the frame was drawn with - the boxes can never lag a frame behind
 * the objects they are tracking.
 */
export function OverlayProjector({ af }: { af: Airframe }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const engine = useMemo(() => getEngine(), []);

  /** Labels placed this frame, used to keep them from stacking on top of each other. */
  const placed = useRef<{ x0: number; x1: number; sy: number; dy: number }[]>([]);

  useFrame(() => {
    const reg = engine.registry;
    const w = size.width;
    const h = size.height;
    placed.current.length = 0;

    const place = (
      id: string,
      x: number,
      z: number,
      worldH: number,
      worldW: number
    ) => {
      const node = getOverlayNode(id);
      if (!node) return;

      base.set(x, 0, z).project(camera);
      top.set(x, worldH, z).project(camera);

      // Behind the camera, or off the near/far range.
      if (base.z > 1) {
        node.root.style.opacity = "0";
        return;
      }

      const sx = (base.x * 0.5 + 0.5) * w;
      const sy = (-base.y * 0.5 + 0.5) * h;
      const ty = (-top.y * 0.5 + 0.5) * h;

      // Pixel height straight from the projected extent, so the box shrinks
      // with distance exactly like the object does.
      const px = Math.max(16, Math.abs(sy - ty));
      const pw = Math.max(18, px * (worldW / Math.max(0.35, worldH)) * 0.85);

      // Fade out anything drifting off the edge of the feed.
      const margin = 26;
      const visible = sx > -margin && sx < w + margin && sy > -margin && sy < h + margin;
      node.root.style.opacity = visible ? "1" : "0";
      node.root.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
      node.root.style.setProperty("--w", `${pw.toFixed(1)}px`);
      node.root.style.setProperty("--h", `${px.toFixed(1)}px`);

      // Flip the label to the inside of the frame near the right edge.
      const flip = sx > w * 0.6;
      node.root.classList.toggle("det-flip", flip);

      /* Two objects standing close together would otherwise print their labels
         on top of each other. Work out the card's real horizontal span (which
         depends on the flip) and search upward, then downward, for the first
         slot that clears everything already placed this frame. The box stays
         locked to the object; only the label card moves. */
      /* Measure the card once rather than guessing: a "Baggage Cart" label and
         a "Person" label are very different widths, and a guess that is too
         small lets them overlap anyway. Cached, so this is not a per-frame
         layout read. */
      if (!node.w && node.panel) {
        node.w = node.panel.offsetWidth || LABEL_W;
        node.h = node.panel.offsetHeight || LABEL_H;
      }
      const lw = node.w || LABEL_W;
      const lh = node.h || LABEL_H;

      const gap = pw / 2 + 14;
      const x0 = flip ? sx - gap - lw : sx + gap;
      const x1 = x0 + lw;
      const labelY = sy - px;

      let dy = 0;
      const clashes = (candidate: number) =>
        placed.current.some(
          (o) =>
            x0 < o.x1 &&
            o.x0 < x1 &&
            Math.abs(o.sy + o.dy - (labelY + candidate)) < lh + 4
        );
      for (const step of LABEL_SLOTS) {
        if (!clashes(step)) {
          dy = step;
          break;
        }
      }
      placed.current.push({ x0, x1, sy: labelY, dy });
      node.root.style.setProperty("--dy", `${dy}px`);
    };

    for (const v of reg.vehicles) {
      if (!v.visible) continue;
      place(v.id, v.position.x, v.position.z, v.size.h, Math.max(v.size.l, v.size.w));
    }
    for (const p of reg.people) {
      if (!p.visible) continue;
      place(p.id, p.position.x, p.position.z, 1.8, 0.85);
    }
    for (const f of reg.fod) {
      // Debris is tiny; give the box a floor so it stays clickable-sized.
      const s = Math.max(0.5, f.sizeCm / 100) * af.worldScale;
      place(f.id, f.position.x, f.position.z, s, s);
    }
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* HTML layer                                                          */
/* ------------------------------------------------------------------ */

function boxColor(o: TrackedOverlay) {
  // Debris keeps the "object acquired" green frame from the reference feed,
  // while its severity is carried by the badge.
  if (o.kind === "fod") return "#31d17c";
  return SEVERITY[o.level].hex;
}

function OverlayCard({ o }: { o: TrackedOverlay }) {
  const theme = SEVERITY[o.level];
  const frame = boxColor(o);
  const focusTarget = useSim((s) => s.focusTarget);
  const alarm = o.level === "critical" || o.level === "high";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const register = () => registerOverlay(o.id, rootRef.current, panelRef.current);

  return (
    <div
      className="det-root"
      style={{ opacity: 0 }}
      ref={(el) => {
        rootRef.current = el;
        register();
      }}
    >
      {/* tracking frame */}
      <div className="det-frame det-box" style={{ color: frame }}>
        <div
          className="absolute inset-0 rounded-[1px] border"
          style={{
            borderColor: `${frame}88`,
            background: `${frame}0d`,
          }}
        />
        <span className="det-corner tl" />
        <span className="det-corner tr" />
        <span className="det-corner bl" />
        <span className="det-corner br" />
      </div>

      {/* leader line */}
      <span className="det-lead" style={{ background: `${frame}99` }} />

      {/* label card */}
      <div
        className="det-panel"
        ref={(el) => {
          panelRef.current = el;
          register();
        }}
      >
        <button
          type="button"
          onClick={() => focusTarget(o.id)}
          className="pointer-events-auto flex min-w-[112px] flex-col items-start gap-[1px] rounded-[3px] border bg-[#040f19]/92 px-2 py-1.5 text-left backdrop-blur-[2px] transition-colors hover:bg-[#08202f]/95"
          style={{ borderColor: `${frame}66` }}
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="text-[11px] font-bold leading-none tracking-[0.01em] text-[#f3f7fa]">
              {o.label}
            </span>
            <span
              className={`flex h-[13px] w-[13px] items-center justify-center rounded-full text-[9px] font-bold leading-none text-[#04101b] ${
                alarm ? "crit-dot" : ""
              }`}
              style={{ background: theme.hex }}
            >
              !
            </span>
          </span>
          <span className="tnum text-[9.5px] leading-[1.35] text-[#a8c0d1]">{o.line1}</span>
          {o.line2 && (
            <span className="tnum text-[9.5px] leading-[1.35] text-[#a8c0d1]">{o.line2}</span>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * The HTML detection layer. It re-renders only when the SET of tracked objects
 * changes (10 Hz at most); positions are driven entirely by OverlayProjector.
 */
export function DetectionOverlayLayer() {
  const overlays = useSim((s) => s.snap?.overlays ?? []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {overlays.map((o) => (
        <OverlayCard key={o.id} o={o} />
      ))}
    </div>
  );
}
