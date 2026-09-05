"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import type { Airframe } from "@/sim/aircraftTypes";
import { useLive } from "@/live/liveStore";

/**
 * The physical HC-SR04, drawn into the apron.
 *
 * This is the one place real hardware appears in the 3D scene, and it is drawn
 * as a CORRIDOR rather than as an object sitting somewhere on the stand. An
 * ultrasonic sensor measures one distance along one axis; it has no idea where
 * the target is laterally. Placing a marker at an (x, z) the sensor never
 * measured would be a fabrication, so the beam owns a lane of its own and the
 * marker only ever moves along it.
 *
 * Mapping: the 20 cm critical boundary sits at the edge of the aircraft's
 * protected envelope, and the corridor runs outboard from there. So a target
 * closing on the sensor visibly closes on the aircraft, which is the point of
 * the demonstration.
 */

/** Demonstration boundaries, mirroring the board's config.py. */
const CRITICAL_CM = 20;
const CAUTION_CM = 50;
const FAR_CM = 120;

const COLOUR = {
  SAFE: "#31d17c",
  CAUTION: "#f5a623",
  HOLD: "#ff4343",
  UNKNOWN: "#7d97ab",
} as const;

export function RangeBeam3D({ af }: { af: Airframe }) {
  const s = af.worldScale;
  const state = useLive((v) => v.state);
  const link = useLive((v) => v.link);

  const valid = !!state?.range.valid && link === "online";
  const cm = valid ? (state?.range.distance_cm ?? null) : null;
  const status = link === "offline" || !state ? "UNKNOWN" : state.risk.state;
  const colour = COLOUR[status];

  /** Geometry of the lane, in world metres. */
  const geom = useMemo(() => {
    // Outboard of the left wingtip, clear of the aircraft body.
    const boundaryX = -(af.envelope.halfSpan + 3.2 * s);
    // 100 cm of sensor range maps onto this much apron.
    const span = 22 * s;
    const laneZ = af.envelope.noseZ * 0.15;
    const halfWidth = 1.5 * s;
    return { boundaryX, span, laneZ, halfWidth };
  }, [af, s]);

  /** cm along the beam -> world X. Clamped so a wild reading cannot fly off. */
  const xFor = (v: number) => {
    const clamped = Math.max(0, Math.min(FAR_CM, v));
    return (
      geom.boundaryX -
      ((clamped - CRITICAL_CM) / (FAR_CM - CRITICAL_CM)) * geom.span
    );
  };

  const xCrit = xFor(CRITICAL_CM);
  const xCaut = xFor(CAUTION_CM);
  const xFar = xFor(FAR_CM);

  const marker = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const target = useRef(xFar);

  useFrame((_, dt) => {
    if (!marker.current) return;
    if (cm !== null) {
      target.current = xFor(cm);
      // Ease toward the reading rather than snapping: at 10 Hz a hard cut
      // reads as stutter. This is display smoothing only - the number in the
      // panel is the raw filtered measurement.
      marker.current.position.x = THREE.MathUtils.damp(
        marker.current.position.x,
        target.current,
        14,
        dt
      );
      marker.current.visible = true;
    } else {
      marker.current.visible = false;
    }
    if (ring.current) {
      const t = performance.now() / 1000;
      const k = status === "HOLD" ? 3.4 : status === "CAUTION" ? 2.0 : 1.1;
      const pulse = 1 + Math.sin(t * k) * 0.16;
      ring.current.scale.setScalar(pulse);
    }
  });

  const band = (from: number, to: number, c: string, opacity: number) => (
    <mesh
      position={[(from + to) / 2, 0.05 * s, geom.laneZ]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[Math.abs(to - from), geom.halfWidth * 2]} />
      <meshBasicMaterial
        color={c}
        transparent
        opacity={opacity}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );

  const boundaryPost = (x: number, c: string, label: string) => (
    <group position={[x, 0, geom.laneZ]}>
      <mesh position={[0, 0.055 * s, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.16 * s, geom.halfWidth * 2]} />
        <meshBasicMaterial color={c} transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.1 * s, geom.halfWidth]}>
        <boxGeometry args={[0.1 * s, 2.2 * s, 0.1 * s]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.5} />
      </mesh>
      <Text
        position={[0, 2.9 * s, geom.halfWidth]}
        fontSize={0.72 * s}
        color={c}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.045 * s}
        outlineColor="#04121f"
      >
        {label}
      </Text>
    </group>
  );

  return (
    <group>
      {/* lane bands: safe outboard, then caution, then critical at the boundary */}
      {band(xFar, xCaut, COLOUR.SAFE, 0.16)}
      {band(xCaut, xCrit, COLOUR.CAUTION, 0.3)}
      {band(xCrit, geom.boundaryX + 1.6 * s, COLOUR.HOLD, 0.4)}

      {/* lane edges, so the corridor reads as a defined lane and not a smear */}
      {[-geom.halfWidth, geom.halfWidth].map((z) => (
        <mesh
          key={z}
          position={[(xFar + geom.boundaryX) / 2, 0.06 * s, geom.laneZ + z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[Math.abs(geom.boundaryX - xFar) + 1.6 * s, 0.07 * s]} />
          <meshBasicMaterial color="#7fd8ef" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}

      {boundaryPost(xCrit, COLOUR.HOLD, `${CRITICAL_CM} cm`)}
      {boundaryPost(xCaut, COLOUR.CAUTION, `${CAUTION_CM} cm`)}

      {/* the physical sensor, at the outboard end of its own beam */}
      <group position={[xFar - 1.1 * s, 0, geom.laneZ]}>
        <mesh position={[0, 0.75 * s, 0]} castShadow>
          <boxGeometry args={[0.5 * s, 1.5 * s, 1.5 * s]} />
          <meshStandardMaterial color="#123c56" metalness={0.3} roughness={0.6} />
        </mesh>
        <Text
          position={[0, 2.35 * s, 0]}
          fontSize={0.66 * s}
          color="#7fd8ef"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.045 * s}
          outlineColor="#04121f"
        >
          HC-SR04
        </Text>
      </group>

      {/* live marker: only rendered when the sensor actually has a reading */}
      <group ref={marker} position={[xFar, 0, geom.laneZ]}>
        <mesh position={[0, 1.5 * s, 0]}>
          <cylinderGeometry args={[0.17 * s, 0.17 * s, 3 * s, 12]} />
          <meshStandardMaterial
            color={colour}
            emissive={colour}
            emissiveIntensity={1.5}
            transparent
            opacity={0.9}
          />
        </mesh>
        <mesh ref={ring} position={[0, 0.09 * s, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.85 * s, 1.25 * s, 40]} />
          <meshBasicMaterial color={colour} transparent opacity={0.85} depthWrite={false} />
        </mesh>
        <Text
          position={[0, 3.9 * s, 0]}
          fontSize={1.05 * s}
          color={colour}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.06 * s}
          outlineColor="#04121f"
        >
          {cm !== null ? `${cm.toFixed(1)} cm` : ""}
        </Text>
      </group>

      {/* honest caption, in the scene rather than only in a side panel */}
      <Text
        position={[(xFar + geom.boundaryX) / 2, 0.09 * s, geom.laneZ + geom.halfWidth + 1.5 * s]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.62 * s}
        color="#8fb4cc"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.04 * s}
        outlineColor="#04121f"
      >
        {valid
          ? "RANGE SENSOR BEAM - 1-D measurement, lateral position not sensed"
          : link === "offline"
            ? "UNO Q OFFLINE"
            : "NO VALID ECHO - RANGE UNKNOWN"}
      </Text>
    </group>
  );
}
