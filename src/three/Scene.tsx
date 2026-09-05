"use client";

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { AIRFRAMES } from "@/sim/aircraftTypes";
import { apronBounds } from "@/sim/constants";
import { getEngine, useSim } from "@/sim/store";
import { AircraftModel } from "./AircraftModel";
import { Apron } from "./Apron";
import { CameraFeed } from "./CameraFeed";
import { CameraRig } from "./CameraRig";
import { DetectionOverlayLayer, OverlayProjector } from "./DetectionOverlays";
import { EngineHazard } from "./EngineHazard";
import { FodObjects } from "./FodObjects";
import { GroundFleet } from "./GroundFleet";
import { Personnel } from "./Personnel";
import { SafetyZones } from "./SafetyZones";
import { TaxiTraffic } from "./TaxiTraffic";
import { CloudShadows, SkyDome } from "./Sky";
import { Trajectory } from "./Trajectory";
import { RangeBeam3D } from "./RangeBeam3D";

/* ------------------------------------------------------------------ */
/* Lighting                                                            */
/* ------------------------------------------------------------------ */

function ApronLighting({ scale }: { scale: number }) {
  const dir = useRef<THREE.DirectionalLight>(null);
  const extent = 46 * scale;

  return (
    <>
      <ambientLight intensity={0.34} color="#cfe0ef" />
      {/* sky bounce: blue from above, warm concrete bounce from below */}
      <hemisphereLight args={["#a9cbe8", "#5b5348", 1.15]} />

      {/* sun */}
      <directionalLight
        ref={dir}
        position={[34 * scale, 46 * scale, 16 * scale]}
        intensity={2.85}
        color="#fff3e0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={140 * scale}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-bias={-0.0009}
        shadow-normalBias={0.022}
      />

      {/* sky fill from the camera side so the nose is not a silhouette */}
      <directionalLight
        position={[-16 * scale, 20 * scale, -38 * scale]}
        intensity={0.62}
        color="#bcd6ee"
      />

      {/* warm sodium bounce off the concrete */}
      {/* warm bounce off the concrete under the airframe */}
      <pointLight
        position={[0, 3.5 * scale, 2 * scale]}
        intensity={2.2 * scale * scale}
        distance={22 * scale}
        decay={2}
        color="#ffe0bd"
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Apron click target for manual FOD placement                         */
/* ------------------------------------------------------------------ */

function GroundPicker({ scale }: { scale: number }) {
  const armed = useSim((s) => s.fodPlacement);
  const engine = useMemo(() => getEngine(), []);
  const b = apronBounds(scale);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!armed) return;
    e.stopPropagation();
    engine.spawnFodAt({ x: e.point.x, z: e.point.z });
  };

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.002, (b.minZ + b.maxZ) / 2]}
      onClick={onClick}
      visible={false}
    >
      <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
      <meshBasicMaterial />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Frame-rate probe (debug HUD)                                        */
/* ------------------------------------------------------------------ */

function PerfProbe() {
  const frames = useRef(0);
  const acc = useRef(0);
  useFrame((_, delta) => {
    frames.current++;
    acc.current += delta;
    if (acc.current >= 0.5) {
      useSim.getState().setFps(Math.round(frames.current / acc.current));
      frames.current = 0;
      acc.current = 0;
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Dev handle                                                          */
/* ------------------------------------------------------------------ */

/** Exposes the renderer internals for QA. Stripped from production builds. */
function DevHandle() {
  const { scene, camera, gl } = useThree();
  useMemo(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    const w = window as unknown as { __aeroHalo?: Record<string, unknown> };
    w.__aeroHalo = { ...(w.__aeroHalo ?? {}), scene, camera, gl };
  }, [scene, camera, gl]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Fog tuned to the stand size                                         */
/* ------------------------------------------------------------------ */

function SceneFog({ scale }: { scale: number }) {
  const scene = useThree((s) => s.scene);
  useMemo(() => {
    // Fog colour matches the sky horizon so distant apron fades into weather
    // rather than into a hard band.
    // Aerial haze, matched to the sky horizon so the apron fades into daylight.
    scene.fog = new THREE.Fog("#c9dbe8", 55 * scale, 175 * scale);
    scene.background = new THREE.Color("#d2e3f0");
  }, [scene, scale]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Scene root                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param live  LIVE HARDWARE mode. The apron, the aircraft and the painted
 *              safety zones stay - they are scenery, not measurements - but
 *              every simulated entity is removed and the real HC-SR04 beam is
 *              added. Nothing that moves in LIVE was invented by the
 *              simulation.
 */
export function AirsideScene({ live = false }: { live?: boolean } = {}) {
  const airframeId = useSim((s) => s.airframeId);
  const af = AIRFRAMES[airframeId];
  const s = af.worldScale;

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.98,
      }}
      camera={{ fov: 34, near: 0.4, far: 400 * s, position: [0, 17 * s, -32 * s] }}
      className="absolute inset-0"
    >
      <SceneFog scale={s} />
      <SkyDome scale={s} />
      <ApronLighting scale={s} />

      <Suspense fallback={null}>
        <Apron af={af} />
        <AircraftModel af={af} />
        {!live && (
          <>
            <GroundFleet af={af} />
            <Personnel af={af} />
            <FodObjects af={af} />
            <TaxiTraffic af={af} />
          </>
        )}
      </Suspense>

      <CloudShadows
        scale={s}
        width={(apronBounds(s).maxX - apronBounds(s).minX) * 1.3}
        depth={(apronBounds(s).maxZ - apronBounds(s).minZ) * 1.3}
        centreZ={(apronBounds(s).minZ + apronBounds(s).maxZ) / 2}
      />

      <SafetyZones af={af} />
      {live ? (
        <RangeBeam3D af={af} />
      ) : (
        <>
          <EngineHazard af={af} />
          <Trajectory af={af} />
        </>
      )}

      {!live && <GroundPicker scale={s} />}
      <CameraRig af={af} />
      {!live && <OverlayProjector af={af} />}
      <PerfProbe />
      <DevHandle />

      {!live && <CameraFeed />}
    </Canvas>
  );
}

export { DetectionOverlayLayer };
