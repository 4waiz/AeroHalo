"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Airframe } from "@/sim/aircraftTypes";
import { SEVERITY } from "@/lib/format";
import { getEngine } from "@/sim/store";

const SLOTS = 8;
/** Vertex budget per trajectory: PREDICT_STEPS segments, two vertices each. */
const MAX_SEG = 48;

const tmpColor = new THREE.Color();

/**
 * Predicted vehicle trajectories.
 *
 * Each line is the actual sampled output of the collision prediction engine,
 * redrawn every frame, ending at the point where the hull would be breached.
 * A travelling arrow shows the direction of travel and a pulsing ring marks the
 * predicted contact point.
 */
export function Trajectory({ af }: { af: Airframe }) {
  const engine = useMemo(() => getEngine(), []);

  const lineRefs = useRef<(THREE.LineSegments | null)[]>([]);
  const arrowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const impactRefs = useRef<(THREE.Mesh | null)[]>([]);

  // Preallocate the buffers once; per-frame we only rewrite their contents.
  const geoms = useMemo(
    () =>
      Array.from({ length: SLOTS }, () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(MAX_SEG * 2 * 3), 3)
        );
        g.setAttribute(
          "lineDistance",
          new THREE.BufferAttribute(new Float32Array(MAX_SEG * 2), 1)
        );
        g.setDrawRange(0, 0);
        return g;
      }),
    []
  );

  const arrowGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.42, 1.2, 4);
    // Point the cone along -Z so it can use the same heading convention.
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  const impactGeo = useMemo(() => {
    const g = new THREE.RingGeometry(0.72, 1, 28);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const vehicles = engine.registry.vehicles;
    const y = 0.16 * af.worldScale;

    for (let i = 0; i < SLOTS; i++) {
      const line = lineRefs.current[i];
      const arrow = arrowRefs.current[i];
      const impact = impactRefs.current[i];
      const v = vehicles[i];
      const pred = v?.visible ? v.prediction : null;

      // Only draw tracks that actually mean something.
      const show = Boolean(pred && (pred.ttc != null || pred.risk >= 3.2) && v.speed > 0.06);

      if (line) line.visible = show;
      if (arrow) arrow.visible = show;
      if (impact) impact.visible = Boolean(show && pred?.ttc != null);

      if (!show || !pred) continue;

      const path = pred.path;
      const segCount = Math.min(MAX_SEG, Math.max(0, path.length - 1));
      const geo = geoms[i];
      const pos = geo.getAttribute("position") as THREE.BufferAttribute;
      const ldist = geo.getAttribute("lineDistance") as THREE.BufferAttribute;

      let run = 0;
      for (let s = 0; s < segCount; s++) {
        const a = path[s];
        const b = path[s + 1];
        const o = s * 6;
        pos.array[o] = a.x;
        pos.array[o + 1] = y;
        pos.array[o + 2] = a.z;
        pos.array[o + 3] = b.x;
        pos.array[o + 4] = y;
        pos.array[o + 5] = b.z;

        ldist.array[s * 2] = run;
        run += Math.hypot(b.x - a.x, b.z - a.z);
        ldist.array[s * 2 + 1] = run;
      }
      pos.needsUpdate = true;
      ldist.needsUpdate = true;
      geo.setDrawRange(0, segCount * 2);

      const theme = SEVERITY[pred.level];
      if (line) {
        const mat = line.material as THREE.LineDashedMaterial;
        tmpColor.set(theme.hex);
        mat.color.lerp(tmpColor, 0.2);
        mat.opacity = 0.62 + Math.sin(t * 4) * 0.16;
        mat.dashSize = 0.9 * af.worldScale;
        mat.gapSize = 0.6 * af.worldScale;
      }

      // Arrow slides along the predicted path, restarting each cycle.
      if (arrow && segCount > 1) {
        const phase = (t * 0.55) % 1;
        const idx = Math.min(path.length - 2, Math.floor(phase * (path.length - 1)));
        const frac = phase * (path.length - 1) - idx;
        const a = path[idx];
        const b = path[idx + 1];
        arrow.position.set(a.x + (b.x - a.x) * frac, y + 0.05, a.z + (b.z - a.z) * frac);
        arrow.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        arrow.scale.setScalar(af.worldScale * (0.9 + Math.sin(t * 6) * 0.08));
        const m = arrow.material as THREE.MeshBasicMaterial;
        m.color.set(theme.hex);
        m.opacity = 0.85;
      }

      // Contact marker at the end of the predicted track.
      if (impact && pred.ttc != null) {
        const end = path[path.length - 1];
        const pulse = (t * 1.5) % 1;
        const r = af.worldScale * (1 + pulse * 1.8);
        impact.position.set(end.x, y + 0.02, end.z);
        impact.scale.set(r, 1, r);
        const m = impact.material as THREE.MeshBasicMaterial;
        m.color.set(theme.hex);
        m.opacity = (1 - pulse) * 0.75;
      }
    }
  });

  return (
    <group>
      {Array.from({ length: SLOTS }, (_, i) => (
        <group key={i}>
          <lineSegments
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            geometry={geoms[i]}
            renderOrder={8}
            visible={false}
          >
            <lineDashedMaterial
              color="#ff4343"
              transparent
              opacity={0.7}
              dashSize={0.9}
              gapSize={0.6}
              depthWrite={false}
            />
          </lineSegments>

          <mesh
            ref={(el) => {
              arrowRefs.current[i] = el;
            }}
            geometry={arrowGeo}
            renderOrder={9}
            visible={false}
          >
            <meshBasicMaterial color="#ff4343" transparent opacity={0.85} depthWrite={false} />
          </mesh>

          <mesh
            ref={(el) => {
              impactRefs.current[i] = el;
            }}
            geometry={impactGeo}
            renderOrder={9}
            visible={false}
          >
            <meshBasicMaterial
              color="#ff4343"
              transparent
              opacity={0}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
