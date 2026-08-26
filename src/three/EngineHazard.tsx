"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Airframe } from "@/sim/aircraftTypes";
import { getEngine } from "@/sim/store";

/**
 * Builds a unit-radius ground sector.
 * CircleGeometry lives in XY; after rotateX(-90) an angle t maps to the
 * direction (cos t, 0, -sin t), so t = +PI/2 points forward (-Z) and
 * t = -PI/2 points aft (+Z).
 */
function sector(halfAngle: number, centre: number, segments: number) {
  const g = new THREE.CircleGeometry(1, segments, centre - halfAngle, halfAngle * 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

const INTAKE_HALF = (55 * Math.PI) / 180;
const EXHAUST_HALF = (19 * Math.PI) / 180;

/**
 * Intake suction and jet-blast danger areas.
 *
 * Both are dormant with the engines off and expand as the engines spool, which
 * is the whole point: the restricted footprint around a running engine is much
 * larger than the aircraft itself, and personnel walking into it is an alert.
 */
export function EngineHazard({ af }: { af: Airframe }) {
  const engine = useMemo(() => getEngine(), []);

  const intakeGeo = useMemo(() => sector(INTAKE_HALF, Math.PI / 2, 26), []);
  const blastGeo = useMemo(() => sector(EXHAUST_HALF, -Math.PI / 2, 18), []);
  const ringGeo = useMemo(() => {
    const g = new THREE.RingGeometry(0.92, 1, 40);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  const intakeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const blastRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const zones = engine.zones.engineZones;

    // Is anyone standing in a live hazard area right now?
    const breach = engine.registry.people.some((p) => p.visible && p.inEngineHazard);
    const flash = breach ? 0.55 + Math.abs(Math.sin(t * 5.2)) * 0.45 : 1;

    zones.forEach((z, i) => {
      const intake = intakeRefs.current[i];
      const blast = blastRefs.current[i];
      const ring = ringRefs.current[i];

      if (intake) {
        intake.visible = z.active;
        if (z.active) {
          intake.scale.set(z.intakeRadius, 1, z.intakeRadius);
          const m = intake.material as THREE.MeshBasicMaterial;
          m.opacity = (0.1 + 0.16 * Math.min(1, z.intakeRadius / 6)) * flash;
        }
      }
      if (blast) {
        blast.visible = z.active;
        if (z.active) {
          blast.scale.set(z.exhaustLength, 1, z.exhaustLength);
          const m = blast.material as THREE.MeshBasicMaterial;
          // The plume shimmers along its length.
          m.opacity = (0.09 + 0.14 * Math.min(1, z.exhaustLength / 30)) *
            (0.86 + Math.sin(t * 6 + i) * 0.14) * flash;
        }
      }
      if (ring) {
        ring.visible = z.active;
        if (z.active) {
          // Expanding pulse ring at the intake mouth.
          const phase = (t * 0.55 + i * 0.5) % 1;
          const r = z.intakeRadius * (0.25 + phase * 0.75);
          ring.scale.set(r, 1, r);
          (ring.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.34 * flash;
        }
      }
    });
  });

  return (
    <group>
      {(["left", "right"] as const).map((side, i) => {
        const port = af.engines[side];
        return (
          <group key={side}>
            <group position={[port.intake.x, 0.1 * af.worldScale + 0.015, port.intake.z]}>
              <mesh
                ref={(el) => {
                  intakeRefs.current[i] = el;
                }}
                geometry={intakeGeo}
                renderOrder={5}
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
              <mesh
                ref={(el) => {
                  ringRefs.current[i] = el;
                }}
                geometry={ringGeo}
                renderOrder={6}
                visible={false}
              >
                <meshBasicMaterial
                  color="#ff7a5a"
                  transparent
                  opacity={0}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>

            <group position={[port.nozzle.x, 0.1 * af.worldScale + 0.014, port.nozzle.z]}>
              <mesh
                ref={(el) => {
                  blastRefs.current[i] = el;
                }}
                geometry={blastGeo}
                renderOrder={5}
                visible={false}
              >
                <meshBasicMaterial
                  color="#ff8b1f"
                  transparent
                  opacity={0}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}
