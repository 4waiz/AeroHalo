"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Airframe } from "@/sim/aircraftTypes";
import { AIRFRAMES } from "@/sim/aircraftTypes";
import { useOptionalGLTF } from "./useOptionalGLTF";

/**
 * Background airfield traffic.
 *
 * The monitored stand is only ever one stand on a working airfield. Without
 * movement behind it the scene reads as a diorama, so this runs parallel
 * taxiways across the far side of the apron with aircraft rolling along them.
 *
 * This layer is deliberately OUTSIDE the simulation: taxiing traffic is not on
 * the stand, is not tracked by the sensor ring, and must never raise an alert
 * or move the risk score. It exists purely to make the airfield look occupied,
 * so it lives in its own frame loop with no reference to the engine at all.
 */

/** Parallel taxiways behind the stand, in stand units (scaled by worldScale). */
const LANES = [
  { z: 36, dir: 1, speed: 8.4 },
  { z: 50, dir: -1, speed: 6.8 },
];

/** One entry per aircraft on the taxiways. */
const TRAFFIC: { lane: number; airframe: "airliner" | "hornet"; phase: number }[] = [
  { lane: 0, airframe: "airliner", phase: 0.0 },
  { lane: 0, airframe: "hornet", phase: 0.52 },
  { lane: 1, airframe: "airliner", phase: 0.28 },
  { lane: 1, airframe: "hornet", phase: 0.74 },
];

/** How far either side of centre a taxiway runs before wrapping. */
const SPAN = 135;

const BEACON_GEO = new THREE.SphereGeometry(0.42, 8, 6);
const NAV_GEO = new THREE.SphereGeometry(0.34, 8, 6);
const EDGE_LIGHT_GEO = new THREE.SphereGeometry(0.3, 6, 5);

interface Rig {
  group: THREE.Group | null;
  beacon: THREE.Mesh | null;
  /** Distance travelled along the lane, metres. */
  x: number;
  lane: number;
  speed: number;
  dir: number;
  span: number;
}

export function TaxiTraffic({ af }: { af: Airframe }) {
  const s = af.worldScale;
  const airliner = useOptionalGLTF(AIRFRAMES.airliner.modelUrl);
  const hornet = useOptionalGLTF(AIRFRAMES.hornet.modelUrl);

  /**
   * Prepared bodies: each source GLB is cloned and given its own airframe's
   * placement transform, so a traffic aircraft sits on its gear and points
   * down -Z exactly like the parked one. The travel heading is then applied by
   * the parent group.
   */
  const bodies = useMemo(() => {
    const sources: Record<string, THREE.Object3D | undefined> = {
      airliner: airliner?.scene,
      hornet: hornet?.scene,
    };
    if (!sources.airliner && !sources.hornet) return null;

    return TRAFFIC.map((entry) => {
      // Fall back to whichever model actually loaded.
      const key = sources[entry.airframe] ? entry.airframe : sources.airliner ? "airliner" : "hornet";
      const src = sources[key];
      if (!src) return null;
      const spec = AIRFRAMES[key as "airliner" | "hornet"];

      const holder = new THREE.Group();
      const body = src.clone(true);
      body.scale.setScalar(spec.scale);
      body.rotation.set(0, spec.rotationY, 0);
      body.position.set(0, spec.yOffset, 0);
      body.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          // Traffic sits outside the shadow camera's extent anyway, and these
          // are the heaviest meshes in the scene.
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      holder.add(body);
      return { holder, spec };
    });
  }, [airliner, hornet]);

  const rigs = useRef<Rig[]>([]);
  if (rigs.current.length === 0) {
    rigs.current = TRAFFIC.map((entry) => {
      const lane = LANES[entry.lane];
      const span = SPAN * s;
      return {
        group: null,
        beacon: null,
        // Stagger the starting positions so they never travel in lockstep.
        x: -span + entry.phase * span * 2,
        lane: entry.lane,
        speed: lane.speed,
        dir: lane.dir,
        span,
      };
    });
  }

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < rigs.current.length; i++) {
      const rig = rigs.current[i];
      const group = rig.group;
      if (!group) continue;

      rig.x += rig.speed * rig.dir * dt;
      // Wrap round the far end and re-enter from the other side.
      if (rig.dir > 0 && rig.x > rig.span) rig.x = -rig.span;
      if (rig.dir < 0 && rig.x < -rig.span) rig.x = rig.span;

      const lane = LANES[rig.lane];
      group.position.set(rig.x, 0, lane.z * s);
      // Heading convention: a body whose forward is -Z needs yaw -PI/2 to face
      // +X and +PI/2 to face -X.
      group.rotation.y = rig.dir > 0 ? -Math.PI / 2 : Math.PI / 2;

      if (rig.beacon) {
        const mat = rig.beacon.material as THREE.MeshBasicMaterial;
        // Anti-collision beacons flash roughly once a second, out of phase.
        mat.opacity = 0.15 + 0.85 * Math.pow(Math.max(0, Math.sin(t * 3.1 + i * 1.9)), 8);
      }
    }
  });

  /* ---- taxiway surface, centreline, shoulder dashes, edge lights ---- */
  const taxiway = useMemo(() => {
    const width = 24 * s;
    const length = SPAN * 2.4 * s;
    const dash = 9 * s;
    const gap = 7 * s;

    // Shoulder dashes and edge lights are the same two meshes repeated a
    // hundred-odd times, so they go into instanced meshes rather than becoming
    // a hundred-odd draw calls.
    const dashMatrices: THREE.Matrix4[] = [];
    const lightMatrices: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const flat = new THREE.Vector3(1, 1, 1);

    for (const lane of LANES) {
      const lz = lane.z * s;
      for (let x = -length / 2; x < length / 2; x += dash + gap) {
        for (const side of [-1, 1]) {
          m.compose(
            new THREE.Vector3(x + dash / 2, 0.013, lz + (side * width) / 2 - side * 1.2 * s),
            q,
            new THREE.Vector3(dash, 0.3 * s, 1)
          );
          dashMatrices.push(m.clone());
        }
      }
      for (let x = -length / 2; x < length / 2; x += 26 * s) {
        for (const side of [-1, 1]) {
          m.compose(
            new THREE.Vector3(x, 0.3 * s, lz + (side * (width + 2.4 * s)) / 2),
            new THREE.Quaternion(),
            flat.clone().multiplyScalar(s)
          );
          lightMatrices.push(m.clone());
        }
      }
    }
    return { width, length, dashMatrices, lightMatrices };
  }, [s]);

  const dashRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const write = (mesh: THREE.InstancedMesh | null, mats: THREE.Matrix4[]) => {
      if (!mesh) return;
      mats.forEach((mat, i) => mesh.setMatrixAt(i, mat));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = mats.length;
    };
    write(dashRef.current, taxiway.dashMatrices);
    write(lightRef.current, taxiway.lightMatrices);
  }, [taxiway]);

  return (
    <group>
      {/* taxiway pavement + centreline */}
      {LANES.map((lane, li) => (
        <group key={`lane-${li}`} position={[0, 0, lane.z * s]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
            <planeGeometry args={[taxiway.length, taxiway.width]} />
            <meshStandardMaterial color="#5c646b" roughness={0.95} metalness={0} />
          </mesh>

          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]}>
            <planeGeometry args={[taxiway.length, 0.5 * s]} />
            <meshStandardMaterial
              color="#d8b13a"
              roughness={0.7}
              metalness={0}
              transparent
              opacity={0.9}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
            />
          </mesh>
        </group>
      ))}

      {/* shoulder dashes, both lanes, one draw call */}
      <instancedMesh
        ref={dashRef}
        args={[undefined, undefined, Math.max(1, taxiway.dashMatrices.length)]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial
          color="#c8ccc9"
          roughness={0.75}
          metalness={0}
          transparent
          opacity={0.7}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
        />
      </instancedMesh>

      {/* blue taxiway edge lights - the detail that reads as "airfield" */}
      <instancedMesh
        ref={lightRef}
        args={[EDGE_LIGHT_GEO, undefined, Math.max(1, taxiway.lightMatrices.length)]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#4fb8ff" toneMapped={false} />
      </instancedMesh>

      {/* the aircraft themselves */}
      {TRAFFIC.map((_entry, i) => (
        <group
          key={i}
          ref={(el) => {
            rigs.current[i].group = el;
          }}
        >
          {bodies?.[i] ? <primitive object={bodies[i]!.holder} /> : null}

          {bodies?.[i] && (
            <>
              {/* red anti-collision beacon on the spine */}
              <mesh
                ref={(el) => {
                  rigs.current[i].beacon = el;
                }}
                geometry={BEACON_GEO}
                position={[0, bodies[i]!.spec.height * 0.55, bodies[i]!.spec.envelope.tailZ * 0.3]}
                scale={s}
              >
                <meshBasicMaterial
                  color="#ff2d2d"
                  transparent
                  opacity={0}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
              {/* wingtip navigation lights */}
              <mesh
                geometry={NAV_GEO}
                position={[
                  -bodies[i]!.spec.envelope.halfSpan + 0.3,
                  bodies[i]!.spec.height * 0.2,
                  (bodies[i]!.spec.envelope.wingZ0 + bodies[i]!.spec.envelope.wingZ1) / 2,
                ]}
                scale={s}
              >
                <meshBasicMaterial color="#ff3b3b" toneMapped={false} />
              </mesh>
              <mesh
                geometry={NAV_GEO}
                position={[
                  bodies[i]!.spec.envelope.halfSpan - 0.3,
                  bodies[i]!.spec.height * 0.2,
                  (bodies[i]!.spec.envelope.wingZ0 + bodies[i]!.spec.envelope.wingZ1) / 2,
                ]}
                scale={s}
              >
                <meshBasicMaterial color="#3bff7a" toneMapped={false} />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
}
