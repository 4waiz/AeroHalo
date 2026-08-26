"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Airframe } from "@/sim/aircraftTypes";
import { getEngine } from "@/sim/store";
import { useOptionalGLTF } from "./useOptionalGLTF";

/**
 * The monitored airframe.
 *
 * The GLB is placed with the transform declared on the Airframe record
 * (scale / rotationY / yOffset), which is what makes the world contract hold:
 * nose down -Z, wheels on y = 0. Engine spool drives the exhaust glow and the
 * anti-collision beacon so the aircraft visibly reacts to the simulation.
 */
export function AircraftModel({ af }: { af: Airframe }) {
  const model = useOptionalGLTF(af.modelUrl);
  const engine = useMemo(() => getEngine(), []);

  const beaconRef = useRef<THREE.Mesh>(null);
  const navLRef = useRef<THREE.Mesh>(null);
  const navRRef = useRef<THREE.Mesh>(null);
  const exhaustRefs = useRef<(THREE.Mesh | null)[]>([]);
  const heatRefs = useRef<(THREE.Mesh | null)[]>([]);

  // Tone the source materials for a night apron: the Sketchfab export is lit
  // for a bright studio, which reads as washed out under floodlights.
  useEffect(() => {
    if (!model) return;
    model.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const s = mat as THREE.MeshStandardMaterial;
        if (s.isMeshStandardMaterial) {
          s.envMapIntensity = 0.55;
          s.roughness = Math.min(1, (s.roughness ?? 0.8) * 0.92);
          s.needsUpdate = true;
        }
      }
    });
  }, [model]);

  const exhaustGeo = useMemo(() => new THREE.ConeGeometry(1, 1, 18, 1, true), []);
  const glowGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const ac = engine.registry.aircraft;
    const spool = ac.engines.spool;

    // Rotating red anti-collision beacon.
    if (beaconRef.current) {
      const on = ac.beacon;
      const mat = beaconRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = on ? 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(t * 3.4)), 6) : 0;
      beaconRef.current.visible = on;
    }

    // Steady navigation lights, only with power on.
    const navOn = ac.beacon || spool > 0.02;
    for (const r of [navLRef.current, navRRef.current]) {
      if (r) (r.material as THREE.MeshBasicMaterial).opacity = navOn ? 0.9 : 0.16;
    }

    // Exhaust plume grows and flickers with spool.
    exhaustRefs.current.forEach((m) => {
      if (!m) return;
      m.visible = spool > 0.03;
      if (!m.visible) return;
      const flicker = 0.92 + Math.sin(t * 31) * 0.05 + Math.sin(t * 17.3) * 0.03;
      const len = (1.4 + spool * 5.2) * flicker;
      m.scale.set(af.engines.left.radius * (0.7 + spool * 0.3), len, af.engines.left.radius * (0.7 + spool * 0.3));
      // Cone points along +Z (aft); its origin sits at the nozzle.
      m.position.z = len * 0.5;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.1 + spool * 0.42;
    });

    heatRefs.current.forEach((m) => {
      if (!m) return;
      m.visible = spool > 0.05;
      if (!m.visible) return;
      const s = af.engines.left.radius * (0.9 + spool * 0.7) * (1 + Math.sin(t * 24) * 0.06);
      m.scale.setScalar(s);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.12 + spool * 0.5;
    });
  });

  const wingTipX = af.envelope.halfSpan;
  const wingTipZ = (af.envelope.wingZ0 + af.envelope.wingZ1) / 2;

  return (
    <group>
      {model ? (
        <primitive
          object={model.scene}
          scale={af.scale}
          rotation={[0, af.rotationY, 0]}
          position={[0, af.yOffset, 0]}
        />
      ) : (
        // Loading placeholder: a low-key footprint marker rather than an empty
        // stand, so the view never looks broken while the GLB streams in.
        <mesh position={[0, 0.03, (af.envelope.noseZ + af.envelope.tailZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[af.span * 0.5, af.length * 0.5]} />
          <meshBasicMaterial color="#14405c" transparent opacity={0.25} />
        </mesh>
      )}

      {/* anti-collision beacon on the spine */}
      <mesh ref={beaconRef} position={[0, af.height * 0.52, af.envelope.tailZ * 0.34]}>
        <sphereGeometry args={[0.16 * af.worldScale, 10, 8]} />
        <meshBasicMaterial color="#ff2d2d" transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* navigation lights */}
      <mesh ref={navLRef} position={[-wingTipX + 0.15, af.height * 0.19, wingTipZ]}>
        <sphereGeometry args={[0.13 * af.worldScale, 8, 6]} />
        <meshBasicMaterial color="#ff3b3b" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <mesh ref={navRRef} position={[wingTipX - 0.15, af.height * 0.19, wingTipZ]}>
        <sphereGeometry args={[0.13 * af.worldScale, 8, 6]} />
        <meshBasicMaterial color="#3bff7a" transparent opacity={0.2} depthWrite={false} />
      </mesh>

      {/* engine exhaust */}
      {(["left", "right"] as const).map((side, i) => {
        const port = af.engines[side];
        return (
          <group key={side} position={[port.nozzle.x, port.y, port.nozzle.z]}>
            <mesh
              ref={(el) => {
                heatRefs.current[i] = el;
              }}
              geometry={glowGeo}
              visible={false}
            >
              <meshBasicMaterial
                color="#ff8a3d"
                transparent
                opacity={0}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
            <mesh
              ref={(el) => {
                exhaustRefs.current[i] = el;
              }}
              geometry={exhaustGeo}
              rotation={[Math.PI / 2, 0, 0]}
              visible={false}
            >
              <meshBasicMaterial
                color="#5fb9ff"
                transparent
                opacity={0}
                depthWrite={false}
                side={THREE.DoubleSide}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
