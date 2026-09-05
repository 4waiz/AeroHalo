"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
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

/**
 * A simple standing figure, ~1.8 m tall, built from primitives.
 *
 * Deliberately procedural: no GLB to download, nothing to license, and it
 * silhouettes cleanly at the distance the apron camera views it from. The
 * emissive tint carries the zone colour so the figure reads at a glance -
 * green outside the boundaries, amber inside caution, red inside critical.
 */
function Figure({ colour, scale: s }: { colour: string; scale: number }) {
  // 1.8 m person against an aircraft whose half-span is metres: the apron
  // camera sits far enough back that finer detail would not survive anyway.
  const h = 1.8 * s;

  // One material shared by every limb. Declaring <meshStandardMaterial/> inside
  // each mesh would build eight separate materials per frame-tree and leak one
  // set per colour change; this disposes and rebuilds only when the zone
  // colour actually changes.
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: 0.85,
      roughness: 0.45,
      metalness: 0.05,
    });
    return m;
  }, [colour]);

  useEffect(() => () => mat.dispose(), [mat]);

  return (
    <group>
      {/* head */}
      <mesh position={[0, h * 0.92, 0]} material={mat} castShadow>
        <sphereGeometry args={[h * 0.075, 14, 12]} />
      </mesh>
      {/* neck */}
      <mesh position={[0, h * 0.845, 0]} material={mat}>
        <cylinderGeometry args={[h * 0.028, h * 0.032, h * 0.06, 8]} />
      </mesh>
      {/* torso, tapered toward the waist */}
      <mesh position={[0, h * 0.66, 0]} material={mat} castShadow>
        <cylinderGeometry args={[h * 0.085, h * 0.105, h * 0.32, 10]} />
      </mesh>
      {/* hips */}
      <mesh position={[0, h * 0.49, 0]} material={mat}>
        <cylinderGeometry args={[h * 0.085, h * 0.075, h * 0.1, 10]} />
      </mesh>
      {/* arms, held slightly away from the body so the silhouette reads */}
      {[-1, 1].map((side) => (
        <mesh
          key={`arm${side}`}
          position={[side * h * 0.115, h * 0.64, 0]}
          rotation={[0, 0, side * 0.13]}
          material={mat}
          castShadow
        >
          <capsuleGeometry args={[h * 0.032, h * 0.34, 4, 8]} />
        </mesh>
      ))}
      {/* legs */}
      {[-1, 1].map((side) => (
        <mesh
          key={`leg${side}`}
          position={[side * h * 0.05, h * 0.24, 0]}
          material={mat}
          castShadow
        >
          <capsuleGeometry args={[h * 0.042, h * 0.4, 4, 8]} />
        </mesh>
      ))}
    </group>
  );
}

export function RangeBeam3D({ af }: { af: Airframe }) {
  const s = af.worldScale;
  const state = useLive((v) => v.state);
  const link = useLive((v) => v.link);

  const valid = !!state?.range.valid && link === "online";
  const cm = valid ? (state?.range.distance_cm ?? null) : null;
  const status = link === "offline" || !state ? "UNKNOWN" : state.risk.state;

  // The figure is coloured by the band it is standing in, NOT by the fused
  // system state. Those differ on purpose: a HOLD latched by a vibration event
  // minutes ago should not paint a target sitting safely at 70 cm red. Where
  // the object is, and what the system has decided, are two different facts,
  // and the HUD carries the second one.
  const bandColour =
    cm === null
      ? COLOUR.UNKNOWN
      : cm <= CRITICAL_CM
        ? COLOUR.HOLD
        : cm <= CAUTION_CM
          ? COLOUR.CAUTION
          : COLOUR.SAFE;
  const colour = bandColour;

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
      <Billboard position={[0, 2.9 * s, geom.halfWidth]}>
        <Text
          fontSize={0.72 * s}
          color={c}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.045 * s}
          outlineColor="#04121f"
        >
          {label}
        </Text>
      </Billboard>
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
        <Billboard position={[0, 2.35 * s, 0]}>
          <Text
            fontSize={0.66 * s}
            color="#7fd8ef"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.045 * s}
            outlineColor="#04121f"
          >
            HC-SR04
          </Text>
        </Billboard>
      </group>

      {/* Live marker, only rendered when the sensor actually has a reading.
          Drawn as a figure because in this demonstration the thing approaching
          the stand is a person - but see the caption: the HC-SR04 detects an
          OBJECT at a distance, it does not classify what that object is. The
          figure is a representation of the measurement, not a claim about it. */}
      <group ref={marker} position={[xFar, 0, geom.laneZ]}>
        <Figure colour={colour} scale={s} />

        <mesh ref={ring} position={[0, 0.09 * s, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.85 * s, 1.25 * s, 40]} />
          <meshBasicMaterial color={colour} transparent opacity={0.85} depthWrite={false} />
        </mesh>

        <Billboard position={[0, 3.4 * s, 0]}>
          <Text
            fontSize={1.05 * s}
            color={colour}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.06 * s}
            outlineColor="#04121f"
          >
            {cm !== null ? `${cm.toFixed(1)} cm` : ""}
          </Text>
        </Billboard>
      </group>

      {/* honest caption, in the scene rather than only in a side panel */}
      <Billboard
        position={[
          (xFar + geom.boundaryX) / 2,
          1.2 * s,
          geom.laneZ + geom.halfWidth + 1.5 * s,
        ]}
      >
      <Text
        fontSize={0.62 * s}
        color="#8fb4cc"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.04 * s}
        outlineColor="#04121f"
      >
        {valid ? "" : link === "offline" ? "UNO Q OFFLINE" : "NO ECHO"}
      </Text>
      </Billboard>
    </group>
  );
}
