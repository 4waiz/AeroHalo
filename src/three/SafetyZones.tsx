"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vec2, ZoneId } from "@/sim/types";
import type { Airframe } from "@/sim/aircraftTypes";
import { buildZones } from "@/sim/constants";
import { getEngine } from "@/sim/store";

/**
 * Filled polygon lying flat on the apron, with the next zone in cut out of it.
 *
 * The three areas are concentric. Drawing them as nested filled shapes stacks
 * green over amber over red and turns the middle of the stand into mud, so each
 * band is cut back to just its own ring - which is also how the paint is
 * actually laid out on a real stand.
 */
function shapeGeometry(poly: Vec2[], holes: Vec2[][] = []) {
  const shape = new THREE.Shape();
  poly.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.z);
    else shape.lineTo(p.x, p.z);
  });
  shape.closePath();

  for (const h of holes) {
    if (h.length < 3) continue;
    const path = new THREE.Path();
    // Holes wind opposite to the outer contour.
    const pts = [...h].reverse();
    pts.forEach((p, i) => {
      if (i === 0) path.moveTo(p.x, p.z);
      else path.lineTo(p.x, p.z);
    });
    path.closePath();
    shape.holes.push(path);
  }

  const g = new THREE.ShapeGeometry(shape);
  // ShapeGeometry builds in XY; lay it into XZ.
  g.rotateX(Math.PI / 2);
  return g;
}

/** Closed dashed outline for the same polygon. */
function outlineGeometry(poly: Vec2[]) {
  const pts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    pts.push(a.x, 0, a.z, b.x, 0, b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const seg = new THREE.LineSegments(g);
  seg.computeLineDistances();
  g.setAttribute("lineDistance", seg.geometry.getAttribute("lineDistance"));
  return g;
}

interface Layer {
  id: ZoneId;
  color: string;
  y: number;
  fill: THREE.BufferGeometry[];
  outline: THREE.BufferGeometry[];
  baseOpacity: number;
}

/**
 * The painted CRITICAL / CAUTION / SAFE areas.
 *
 * These are real geometry generated from the airframe envelope, not decals:
 * the same polygons the ZoneManager tests points against, so what the operator
 * sees is exactly what the safety engine is using.
 */
export function SafetyZones({ af }: { af: Airframe }) {
  const engine = useMemo(() => getEngine(), []);

  const layers = useMemo<Layer[]>(() => {
    const zones = buildZones(af);
    // zones arrive outermost-first, so each band is cut back by the next one in.
    return zones.map((z, i) => {
      const inner = zones[i + 1]?.polys ?? [];
      return {
        id: z.id,
        color: z.color,
        y: z.y * af.worldScale + 0.012,
        fill:
          z.polys.length === 1
            ? [shapeGeometry(z.polys[0], inner)]
            : z.polys.map((poly) => shapeGeometry(poly)),
        outline: z.polys.map(outlineGeometry),
        baseOpacity: z.id === "critical" ? 0.14 : z.id === "caution" ? 0.1 : 0.075,
      };
    });
  }, [af]);

  const fillMats = useRef<Record<string, THREE.MeshBasicMaterial[]>>({});
  const lineMats = useRef<Record<string, THREE.LineDashedMaterial[]>>({});
  const sweepRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Which zones currently contain something the system cares about.
    const breached: Record<string, number> = { critical: 0, caution: 0, safe: 0 };
    for (const v of engine.registry.vehicles) {
      if (v.visible && v.zone) breached[v.zone] = (breached[v.zone] ?? 0) + 1;
    }
    for (const p of engine.registry.people) {
      if (p.visible && p.zone) breached[p.zone] = (breached[p.zone] ?? 0) + 1;
    }
    for (const f of engine.registry.fod) {
      if (f.detected && f.zone) breached[f.zone] = (breached[f.zone] ?? 0) + 1;
    }

    for (const layer of layers) {
      const isBreached = (breached[layer.id] ?? 0) > 0;
      // A breached zone breathes; a quiet one sits still.
      const pulse = isBreached ? 1 + Math.sin(t * 3.6) * 0.34 : 1;
      const target = layer.baseOpacity * pulse * (isBreached ? 1.35 : 1);

      for (const m of fillMats.current[layer.id] ?? []) {
        m.opacity += (target - m.opacity) * Math.min(1, delta * 8);
      }
      for (const m of lineMats.current[layer.id] ?? []) {
        m.opacity += ((isBreached ? 0.98 : 0.6) - m.opacity) * Math.min(1, delta * 8);
        // Slowly crawl the dashes so the boundary reads as live.
        m.dashSize = 0.85 * af.worldScale;
        m.gapSize = 0.55 * af.worldScale;
      }
    }

    // Radar sweep across the critical area.
    if (sweepRef.current) {
      sweepRef.current.rotation.y = -t * 0.42;
    }
  });

  const sweepGeo = useMemo(() => {
    const r = (af.envelope.halfSpan + 3.2 * af.worldScale) * 1.02;
    const g = new THREE.CircleGeometry(r, 40, 0, Math.PI * 0.16);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [af]);

  return (
    <group>
      {layers.map((layer) => (
        <group key={layer.id}>
          {layer.fill.map((g, i) => (
            <mesh key={`f${i}`} geometry={g} position={[0, layer.y, 0]} renderOrder={2}>
              <meshBasicMaterial
                ref={(m) => {
                  if (!m) return;
                  (fillMats.current[layer.id] ??= [])[i] = m;
                }}
                color={layer.color}
                transparent
                opacity={layer.baseOpacity}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
          {layer.outline.map((g, i) => (
            <lineSegments
              key={`o${i}`}
              geometry={g}
              position={[0, layer.y + 0.006, 0]}
              renderOrder={3}
            >
              <lineDashedMaterial
                ref={(m) => {
                  if (!m) return;
                  (lineMats.current[layer.id] ??= [])[i] = m;
                }}
                color={layer.color}
                transparent
                opacity={0.6}
                dashSize={1.1}
                gapSize={0.7}
                depthWrite={false}
              />
            </lineSegments>
          ))}
        </group>
      ))}

      {/* slow sweep over the aircraft, centred on the airframe */}
      <mesh
        ref={sweepRef}
        geometry={sweepGeo}
        position={[0, 0.11 * af.worldScale + 0.014, (af.envelope.noseZ + af.envelope.tailZ) / 2]}
        renderOrder={4}
      >
        <meshBasicMaterial
          color="#25d9e8"
          transparent
          opacity={0.055}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
