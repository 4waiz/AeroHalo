"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Airframe } from "@/sim/aircraftTypes";
import type { VehicleModel } from "@/sim/types";
import { VEHICLE_SPECS } from "@/sim/ObjectRegistry";
import { angleDelta } from "@/sim/geometry";
import { getEngine } from "@/sim/store";
import { type LoadedModel, cloneNode, useOptionalGLTF } from "@/three/useOptionalGLTF";

/**
 * Ground support fleet.
 *
 * POOLING STRATEGY
 * ----------------
 * `engine.registry.vehicles` is mutated in place at 60 Hz, so it can never be
 * React state. Instead we mount a fixed pool of SLOTS groups. Each slot holds
 * all five body variants as children and shows exactly one of them, which means
 * a slot can change vehicle type without remounting any geometry. Registry
 * entry `i` drives slot `i`; unused slots are simply hidden.
 *
 * Everything below runs from a single `useFrame` that writes transforms and
 * material intensities directly onto the Three objects. There is no `setState`
 * anywhere in the loop.
 *
 * Vehicle bodies are authored in REAL metres (they are not multiplied by
 * `af.worldScale`) and face -Z in local space, matching the heading convention
 * where 0 rad points down -Z.
 */

const SLOTS = 8;

const MODEL_ORDER: VehicleModel[] = [
  "baggageTractor",
  "pushbackTug",
  "utilityVan",
  "beltLoader",
  "serviceTruck",
];

const MODEL_INDEX: Record<VehicleModel, number> = {
  baggageTractor: 0,
  pushbackTug: 1,
  utilityVan: 2,
  beltLoader: 3,
  serviceTruck: 4,
};

const GLB_NODE: Record<VehicleModel, string> = {
  baggageTractor: "GSE_BaggageTractor",
  pushbackTug: "GSE_PushbackTug",
  utilityVan: "GSE_UtilityVan",
  beltLoader: "GSE_BeltLoader",
  serviceTruck: "GSE_ServiceTruck",
};

/** Roof beacon anchor per model, in the vehicle's local frame. */
const BEACON_POS: Record<VehicleModel, [number, number, number]> = {
  baggageTractor: [0, 1.96, 0.15],
  pushbackTug: [0, 1.55, 1.1],
  utilityVan: [0, 1.78, 0.3],
  beltLoader: [0, 2.0, 1.3],
  serviceTruck: [0, 2.95, -2.1],
};

/** Rear brake lamp anchor per model: [halfSpacingX, y, z] with +Z = behind. */
const BRAKE_POS: Record<VehicleModel, [number, number, number]> = {
  baggageTractor: [0.52, 0.62, 1.47],
  pushbackTug: [0.92, 0.6, 2.53],
  utilityVan: [0.74, 0.86, 2.23],
  beltLoader: [0.82, 0.76, 2.42],
  serviceTruck: [1.02, 0.92, 3.17],
};

/** Metres the dolly train trails behind the tractor. */
const DOLLY_GAP = 3.2;

/* ------------------------------------------------------------------ */
/* Shared geometry + material bank                                     */
/* ------------------------------------------------------------------ */

const BOX = new THREE.BoxGeometry(1, 1, 1);
/** Unit cylinder pre-rotated so its axis runs along X - used for wheels. */
const WHEEL = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
  g.rotateZ(Math.PI / 2);
  return g;
})();
const POST = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
const DOME = new THREE.SphereGeometry(0.12, 10, 8);
const LAMP = new THREE.BoxGeometry(0.26, 0.15, 0.07);

const M_WHITE = new THREE.MeshStandardMaterial({ color: "#d5d8d6", roughness: 0.62, metalness: 0.08 });
const M_ORANGE = new THREE.MeshStandardMaterial({ color: "#e2762a", roughness: 0.58, metalness: 0.1 });
const M_YELLOW = new THREE.MeshStandardMaterial({ color: "#d9b23c", roughness: 0.6, metalness: 0.1 });
const M_GLASS = new THREE.MeshStandardMaterial({
  color: "#10171d",
  roughness: 0.18,
  metalness: 0.45,
});
const M_TYRE = new THREE.MeshStandardMaterial({ color: "#14181b", roughness: 0.95, metalness: 0 });
const M_CHASSIS = new THREE.MeshStandardMaterial({ color: "#2a3238", roughness: 0.8, metalness: 0.25 });
const M_METAL = new THREE.MeshStandardMaterial({ color: "#7d858b", roughness: 0.45, metalness: 0.6 });
const M_CANVAS = new THREE.MeshStandardMaterial({ color: "#39434b", roughness: 0.9, metalness: 0 });
const M_BAG = new THREE.MeshStandardMaterial({ color: "#4a3f38", roughness: 0.9, metalness: 0 });

/* ------------------------------------------------------------------ */
/* Procedural bodies - all built facing -Z, sized from VEHICLE_SPECS    */
/* ------------------------------------------------------------------ */

function Wheel({ x, z, r, w }: { x: number; z: number; r: number; w: number }) {
  return <mesh geometry={WHEEL} material={M_TYRE} position={[x, r, z]} scale={[w, r, r]} />;
}

/** Baggage tractor - 2.9 x 1.5 x 1.9 m, open cab under a canopy. */
function TractorBody() {
  return (
    <group>
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.5, 0]} scale={[1.5, 0.42, 2.9]} />
      <mesh geometry={BOX} material={M_YELLOW} position={[0, 0.88, -0.92]} scale={[1.3, 0.46, 0.94]} />
      <mesh geometry={BOX} material={M_YELLOW} position={[0, 0.96, 0.62]} scale={[1.24, 0.62, 0.16]} />
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.78, 0.18]} scale={[1.16, 0.14, 0.9]} />
      <mesh geometry={BOX} material={M_GLASS} position={[0, 1.42, -0.46]} scale={[1.18, 0.58, 0.06]} />
      <mesh geometry={BOX} material={M_YELLOW} position={[0, 1.84, 0.1]} scale={[1.36, 0.1, 1.5]} />
      {[
        [-0.6, -0.5],
        [0.6, -0.5],
        [-0.6, 0.78],
        [0.6, 0.78],
      ].map(([px, pz], i) => (
        <mesh
          key={i}
          geometry={POST}
          material={M_METAL}
          position={[px, 1.34, pz]}
          scale={[0.045, 0.92, 0.045]}
        />
      ))}
      <Wheel x={-0.66} z={-0.95} r={0.33} w={0.22} />
      <Wheel x={0.66} z={-0.95} r={0.33} w={0.22} />
      <Wheel x={-0.66} z={0.95} r={0.33} w={0.22} />
      <Wheel x={0.66} z={0.95} r={0.33} w={0.22} />
    </group>
  );
}

/** Pushback tug - 5.0 x 2.5 x 1.6 m, low slab with a raised cab aft. */
function PushbackTugBody() {
  return (
    <group>
      <mesh geometry={BOX} material={M_ORANGE} position={[0, 0.46, 0]} scale={[2.5, 0.62, 5.0]} />
      <mesh
        geometry={BOX}
        material={M_ORANGE}
        position={[0, 0.86, -1.7]}
        rotation={[-0.16, 0, 0]}
        scale={[2.32, 0.34, 1.5]}
      />
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.5, -2.62]} scale={[0.62, 0.26, 0.7]} />
      <mesh geometry={BOX} material={M_ORANGE} position={[0, 1.15, 1.12]} scale={[1.72, 0.76, 1.5]} />
      <mesh geometry={BOX} material={M_GLASS} position={[0, 1.32, 1.08]} scale={[1.76, 0.44, 1.56]} />
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 1.56, 1.12]} scale={[1.8, 0.1, 1.58]} />
      <mesh geometry={BOX} material={M_METAL} position={[0, 0.82, 2.1]} scale={[2.3, 0.14, 0.5]} />
      <Wheel x={-1.02} z={-1.6} r={0.44} w={0.36} />
      <Wheel x={1.02} z={-1.6} r={0.44} w={0.36} />
      <Wheel x={-1.02} z={1.66} r={0.44} w={0.36} />
      <Wheel x={1.02} z={1.66} r={0.44} w={0.36} />
    </group>
  );
}

/** Utility van - 4.4 x 1.9 x 1.9 m. */
function UtilityVanBody() {
  return (
    <group>
      <mesh geometry={BOX} material={M_WHITE} position={[0, 1.0, 0.1]} scale={[1.9, 1.14, 4.2]} />
      <mesh geometry={BOX} material={M_WHITE} position={[0, 1.62, 0.35]} scale={[1.72, 0.18, 3.3]} />
      <mesh geometry={BOX} material={M_GLASS} position={[0, 1.4, -2.02]} scale={[1.74, 0.6, 0.1]} />
      <mesh geometry={BOX} material={M_GLASS} position={[-0.96, 1.38, -0.9]} scale={[0.06, 0.5, 1.3]} />
      <mesh geometry={BOX} material={M_GLASS} position={[0.96, 1.38, -0.9]} scale={[0.06, 0.5, 1.3]} />
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.46, -2.14]} scale={[1.88, 0.24, 0.24]} />
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.5, 2.16]} scale={[1.88, 0.26, 0.2]} />
      <mesh geometry={BOX} material={M_ORANGE} position={[0, 0.62, 0.1]} scale={[1.94, 0.16, 4.22]} />
      <Wheel x={-0.86} z={-1.42} r={0.36} w={0.24} />
      <Wheel x={0.86} z={-1.42} r={0.36} w={0.24} />
      <Wheel x={-0.86} z={1.44} r={0.36} w={0.24} />
      <Wheel x={0.86} z={1.44} r={0.36} w={0.24} />
    </group>
  );
}

/** Belt loader - 5.2 x 2.1 x 3.4 m, boom rising toward the -Z (aircraft) end. */
function BeltLoaderBody() {
  return (
    <group>
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.6, 0.4]} scale={[2.1, 0.5, 4.0]} />
      <mesh geometry={BOX} material={M_WHITE} position={[0, 1.4, 1.34]} scale={[1.12, 1.06, 1.24]} />
      <mesh geometry={BOX} material={M_GLASS} position={[0, 1.66, 1.3]} scale={[1.16, 0.5, 1.3]} />
      <mesh geometry={BOX} material={M_METAL} position={[0, 0.94, 0.62]} scale={[0.16, 1.3, 0.16]} />
      {/* Positive rotation about X lifts the -Z end, which is the aircraft side. */}
      <group position={[0, 2.05, -0.35]} rotation={[0.44, 0, 0]}>
        <mesh geometry={BOX} material={M_ORANGE} position={[0, 0, 0]} scale={[1.42, 0.14, 4.8]} />
        <mesh geometry={BOX} material={M_METAL} position={[-0.74, 0.16, 0]} scale={[0.1, 0.32, 4.8]} />
        <mesh geometry={BOX} material={M_METAL} position={[0.74, 0.16, 0]} scale={[0.1, 0.32, 4.8]} />
        <mesh geometry={BOX} material={M_WHITE} position={[0, 0.22, -2.32]} scale={[1.5, 0.34, 0.3]} />
      </group>
      <Wheel x={-0.92} z={-1.35} r={0.4} w={0.26} />
      <Wheel x={0.92} z={-1.35} r={0.4} w={0.26} />
      <Wheel x={-0.92} z={1.62} r={0.4} w={0.26} />
      <Wheel x={0.92} z={1.62} r={0.4} w={0.26} />
    </group>
  );
}

/** Service truck - 6.5 x 2.4 x 3.0 m, cab forward with a tall box body. */
function ServiceTruckBody() {
  return (
    <group>
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.62, 0.2]} scale={[2.16, 0.4, 6.4]} />
      <mesh geometry={BOX} material={M_WHITE} position={[0, 1.12, -2.14]} scale={[2.3, 1.5, 2.0]} />
      <mesh geometry={BOX} material={M_GLASS} position={[0, 1.5, -3.06]} scale={[2.1, 0.72, 0.12]} />
      <mesh geometry={BOX} material={M_GLASS} position={[-1.17, 1.44, -2.5]} scale={[0.08, 0.56, 0.92]} />
      <mesh geometry={BOX} material={M_GLASS} position={[1.17, 1.44, -2.5]} scale={[0.08, 0.56, 0.92]} />
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.5, -3.16]} scale={[2.26, 0.3, 0.24]} />
      <mesh geometry={BOX} material={M_WHITE} position={[0, 1.86, 1.05]} scale={[2.4, 2.0, 4.2]} />
      <mesh geometry={BOX} material={M_ORANGE} position={[0, 1.28, 1.05]} scale={[2.44, 0.24, 4.24]} />
      <mesh geometry={BOX} material={M_METAL} position={[0, 2.9, 1.05]} scale={[2.44, 0.12, 4.26]} />
      <Wheel x={-1.08} z={-1.95} r={0.5} w={0.3} />
      <Wheel x={1.08} z={-1.95} r={0.5} w={0.3} />
      <Wheel x={-1.08} z={1.3} r={0.5} w={0.3} />
      <Wheel x={1.08} z={1.3} r={0.5} w={0.3} />
      <Wheel x={-1.08} z={2.36} r={0.5} w={0.3} />
      <Wheel x={1.08} z={2.36} r={0.5} w={0.3} />
    </group>
  );
}

function ProceduralBody({ model }: { model: VehicleModel }) {
  switch (model) {
    case "baggageTractor":
      return <TractorBody />;
    case "pushbackTug":
      return <PushbackTugBody />;
    case "utilityVan":
      return <UtilityVanBody />;
    case "beltLoader":
      return <BeltLoaderBody />;
    case "serviceTruck":
      return <ServiceTruckBody />;
  }
}

/** Towed baggage dolly, ~2.4 m long. */
function DollyBody({ gse }: { gse: LoadedModel | null }) {
  const node = gse?.nodes.GSE_BaggageDolly;
  const obj = useMemo(() => (node ? cloneNode(node) : null), [node]);
  if (obj) return <primitive object={obj} />;

  return (
    <group>
      <mesh geometry={BOX} material={M_CHASSIS} position={[0, 0.54, 0]} scale={[1.5, 0.14, 2.4]} />
      <mesh geometry={BOX} material={M_METAL} position={[0, 0.4, 0]} scale={[1.2, 0.14, 2.0]} />
      <mesh geometry={BOX} material={M_METAL} position={[0, 0.42, -1.62]} scale={[0.12, 0.1, 0.96]} />
      <mesh geometry={BOX} material={M_METAL} position={[-0.72, 0.82, 0]} scale={[0.07, 0.44, 2.3]} />
      <mesh geometry={BOX} material={M_METAL} position={[0.72, 0.82, 0]} scale={[0.07, 0.44, 2.3]} />
      {[
        [-0.68, -1.06],
        [0.68, -1.06],
        [-0.68, 1.06],
        [0.68, 1.06],
      ].map(([px, pz], i) => (
        <mesh
          key={i}
          geometry={POST}
          material={M_METAL}
          position={[px, 1.06, pz]}
          scale={[0.045, 0.9, 0.045]}
        />
      ))}
      <mesh geometry={BOX} material={M_CANVAS} position={[0, 1.54, 0]} scale={[1.58, 0.1, 2.48]} />
      <mesh geometry={BOX} material={M_BAG} position={[-0.3, 0.79, -0.5]} scale={[0.62, 0.36, 0.44]} />
      <mesh geometry={BOX} material={M_BAG} position={[0.32, 0.75, 0.24]} scale={[0.54, 0.28, 0.5]} />
      <mesh geometry={BOX} material={M_BAG} position={[-0.1, 0.82, 0.78]} scale={[0.7, 0.42, 0.38]} />
      <Wheel x={-0.6} z={-0.82} r={0.22} w={0.14} />
      <Wheel x={0.6} z={-0.82} r={0.22} w={0.14} />
      <Wheel x={-0.6} z={0.82} r={0.22} w={0.14} />
      <Wheel x={0.6} z={0.82} r={0.22} w={0.14} />
    </group>
  );
}

/**
 * One body variant plus the two animated lamps. The beacon and brake lights
 * live here (not inside each body) so a single per-slot material drives them
 * whichever variant is showing.
 */
function VehicleBody({
  model,
  gse,
  beaconMat,
  brakeMat,
}: {
  model: VehicleModel;
  gse: LoadedModel | null;
  beaconMat: THREE.Material;
  brakeMat: THREE.Material;
}) {
  const node = gse?.nodes[GLB_NODE[model]];
  const obj = useMemo(() => (node ? cloneNode(node) : null), [node]);
  const [bx, by, bz] = BEACON_POS[model];
  const [kx, ky, kz] = BRAKE_POS[model];

  return (
    <group>
      {obj ? <primitive object={obj} /> : <ProceduralBody model={model} />}
      <mesh geometry={DOME} material={beaconMat} position={[bx, by, bz]} scale={[1, 0.85, 1]} />
      <mesh geometry={LAMP} material={brakeMat} position={[kx, ky, kz]} />
      <mesh geometry={LAMP} material={brakeMat} position={[-kx, ky, kz]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Fleet                                                               */
/* ------------------------------------------------------------------ */

export function GroundFleet({ af }: { af: Airframe }) {
  const gse = useOptionalGLTF("/models/gse.glb");
  const engineRef = useRef<ReturnType<typeof getEngine> | null>(null);

  const slots = useRef<(THREE.Group | null)[]>([]);
  const variants = useRef<(THREE.Group | null)[][]>([]);
  const dollies = useRef<(THREE.Group | null)[]>([]);
  if (variants.current.length === 0) {
    variants.current = Array.from({ length: SLOTS }, () =>
      new Array<THREE.Group | null>(MODEL_ORDER.length).fill(null)
    );
  }

  /** Per-slot heading of the trailer, damped behind the tractor's. */
  const dollyAngle = useRef<number[]>(new Array(SLOTS).fill(0));
  const dollySynced = useRef<boolean[]>(new Array(SLOTS).fill(false));

  /* Beacon and brake lamps animate per vehicle, so each slot owns its own
     emissive material instance. Bodies share the module-level bank. */
  const beaconMats = useMemo(
    () =>
      Array.from(
        { length: SLOTS },
        () =>
          new THREE.MeshStandardMaterial({
            color: "#ffb020",
            emissive: "#ff9a1f",
            emissiveIntensity: 0,
            roughness: 0.4,
            metalness: 0,
            toneMapped: false,
          })
      ),
    []
  );
  const brakeMats = useMemo(
    () =>
      Array.from(
        { length: SLOTS },
        () =>
          new THREE.MeshStandardMaterial({
            color: "#3a0d0d",
            emissive: "#ff2a1c",
            emissiveIntensity: 0.22,
            roughness: 0.5,
            metalness: 0,
            toneMapped: false,
          })
      ),
    []
  );

  useEffect(() => {
    return () => {
      for (const m of beaconMats) m.dispose();
      for (const m of brakeMats) m.dispose();
    };
  }, [beaconMats, brakeMats]);

  /* Switching airframe rebuilds the registry and teleports the fleet, so the
     trailers must snap to their tractor instead of swinging in from the old
     heading. Vehicle bodies are real-world sized and never rescale with the
     airframe, so nothing else here depends on `af`. */
  useEffect(() => {
    dollySynced.current.fill(false);
  }, [af]);

  /* Vehicles and their trailers cast; the apron receives. Applied by traversal
     so the body markup stays free of per-mesh shadow flags. */
  useLayoutEffect(() => {
    const mark = (g: THREE.Group | null) => {
      if (!g) return;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
        }
      });
    };
    for (const g of slots.current) mark(g);
    for (const g of dollies.current) mark(g);
  }, [gse]);

  useFrame((state, delta) => {
    const engine = engineRef.current ?? (engineRef.current = getEngine());
    // The array itself is swapped on airframe rebuild, so re-read it each frame.
    const list = engine.registry.vehicles;
    const t = state.clock.elapsedTime;

    for (let i = 0; i < SLOTS; i++) {
      const root = slots.current[i];
      const dolly = dollies.current[i];
      const v = i < list.length ? list[i] : undefined;

      if (!root) continue;
      if (!v || !v.visible) {
        root.visible = false;
        if (dolly) dolly.visible = false;
        dollySynced.current[i] = false;
        continue;
      }

      root.visible = true;
      root.position.set(v.position.x, 0, v.position.z);
      root.rotation.y = -v.headingRad;

      // Swap the visible body variant without touching the React tree.
      const want = MODEL_INDEX[v.model];
      const bodies = variants.current[i];
      for (let k = 0; k < bodies.length; k++) {
        const b = bodies[k];
        if (b && b.visible !== (k === want)) b.visible = k === want;
      }

      /* Beacon: amber pulse while rolling, steady glow when parked with the
         beacon on, dark housing when the beacon is off. The per-slot phase
         offset stops the fleet from blinking in unison. */
      const beacon = beaconMats[i];
      if (!v.beacon) beacon.emissiveIntensity = 0.04;
      else if (v.speed > 0.1) {
        beacon.emissiveIntensity = 0.3 + 2.4 * Math.max(0, Math.sin(t * 8 + i * 1.7));
      } else beacon.emissiveIntensity = 0.5;

      const braking = v.state === "BRAKING" || v.state === "AUTO_STOPPED";
      brakeMats[i].emissiveIntensity = braking ? 2.6 : 0.22;

      /* Dolly train: sits a fixed distance behind the tractor along the
         tractor's own -Z axis (so it never jitters with the trailer's own
         heading), while its heading eases toward the tractor's. The
         exponential factor is frame-rate independent and cannot overshoot. */
      if (!dolly) continue;
      if (!v.towsDolly) {
        dolly.visible = false;
        dollySynced.current[i] = false;
        continue;
      }

      const behindX = -Math.sin(v.headingRad);
      const behindZ = Math.cos(v.headingRad);
      const gap = DOLLY_GAP + VEHICLE_SPECS[v.model].l * 0.25;
      dolly.visible = true;
      dolly.position.set(v.position.x + behindX * gap, 0, v.position.z + behindZ * gap);

      if (!dollySynced.current[i]) {
        dollyAngle.current[i] = v.headingRad;
        dollySynced.current[i] = true;
      } else {
        const k = 1 - Math.exp(-5.5 * delta);
        dollyAngle.current[i] += angleDelta(dollyAngle.current[i], v.headingRad) * k;
      }
      dolly.rotation.y = -dollyAngle.current[i];
    }
  });

  return (
    <group>
      {Array.from({ length: SLOTS }, (_, i) => (
        <group
          key={`veh-${i}`}
          visible={false}
          ref={(el) => {
            slots.current[i] = el;
          }}
        >
          {MODEL_ORDER.map((m, k) => (
            <group
              key={m}
              visible={k === 0}
              ref={(el) => {
                variants.current[i][k] = el;
              }}
            >
              <VehicleBody model={m} gse={gse} beaconMat={beaconMats[i]} brakeMat={brakeMats[i]} />
            </group>
          ))}
        </group>
      ))}

      {Array.from({ length: SLOTS }, (_, i) => (
        <group
          key={`dolly-${i}`}
          visible={false}
          ref={(el) => {
            dollies.current[i] = el;
          }}
        >
          <DollyBody gse={gse} />
        </group>
      ))}
    </group>
  );
}
