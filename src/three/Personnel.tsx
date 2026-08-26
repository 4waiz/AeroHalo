"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Airframe } from "@/sim/aircraftTypes";
import { getEngine } from "@/sim/store";
import { useOptionalGLTF } from "./useOptionalGLTF";

/**
 * Ramp personnel.
 *
 * POOLING STRATEGY
 * ----------------
 * Identical to the fleet: a fixed pool of SLOTS humanoid rigs, registry entry
 * `i` driving slot `i`, extras hidden. `engine.registry.people` mutates in
 * place, so no part of it ever reaches React state and the walk cycle is
 * written straight onto the rig objects from one `useFrame`.
 *
 * Every figure is built facing -Z at a real-world 1.75 m; personnel are never
 * scaled by `af.worldScale`.
 */

const SLOTS = 8;

/** Speed at which the walk cycle reaches full amplitude, m/s. */
const FULL_STRIDE = 1.35;

/* ------------------------------------------------------------------ */
/* Shared geometry + material bank                                     */
/* ------------------------------------------------------------------ */

const LEG_GEO = new THREE.CapsuleGeometry(0.09, 0.64, 3, 8);
const ARM_GEO = new THREE.CapsuleGeometry(0.068, 0.44, 3, 8);
const BOOT_GEO = new THREE.BoxGeometry(0.17, 0.11, 0.3);
const TORSO_GEO = new THREE.BoxGeometry(0.38, 0.56, 0.24);
const VEST_GEO = new THREE.BoxGeometry(0.46, 0.5, 0.33);
const NECK_GEO = new THREE.CylinderGeometry(0.055, 0.055, 0.12, 8);
const HEAD_GEO = new THREE.SphereGeometry(0.108, 12, 10);
const HAND_GEO = new THREE.SphereGeometry(0.06, 8, 6);
/** Hard-hat cap: the top slice of a sphere. */
const HELMET_GEO = new THREE.SphereGeometry(0.126, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
/** Soft contact patch, pre-rotated flat. */
const CONTACT_GEO = (() => {
  const g = new THREE.CircleGeometry(0.44, 16);
  g.rotateX(-Math.PI / 2);
  return g;
})();

const M_SKIN = new THREE.MeshStandardMaterial({ color: "#b08063", roughness: 0.82, metalness: 0 });
const M_TROUSER = new THREE.MeshStandardMaterial({ color: "#222e38", roughness: 0.88, metalness: 0 });
const M_SLEEVE = new THREE.MeshStandardMaterial({ color: "#2b3945", roughness: 0.85, metalness: 0 });
const M_BOOT = new THREE.MeshStandardMaterial({ color: "#14181b", roughness: 0.95, metalness: 0 });
const M_HELMET = new THREE.MeshStandardMaterial({ color: "#dfe3e6", roughness: 0.5, metalness: 0.05 });
const M_CONTACT = new THREE.MeshStandardMaterial({
  color: "#04090e",
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  roughness: 1,
  metalness: 0,
  polygonOffset: true,
  polygonOffsetFactor: -6,
  polygonOffsetUnits: -6,
});

/* ------------------------------------------------------------------ */
/* Rig                                                                 */
/* ------------------------------------------------------------------ */

interface Rig {
  root: THREE.Group | null;
  bob: THREE.Group | null;
  /** Scanned stand-in body, used instead of the procedural rig when present. */
  scan: THREE.Group | null;
  upper: THREE.Group | null;
  legL: THREE.Group | null;
  legR: THREE.Group | null;
  armL: THREE.Group | null;
  armR: THREE.Group | null;
}

const emptyRig = (): Rig => ({
  root: null,
  bob: null,
  scan: null,
  upper: null,
  legL: null,
  legR: null,
  armL: null,
  armR: null,
});


/* ------------------------------------------------------------------ */
/* Scanned crew                                                        */
/* ------------------------------------------------------------------ */

/** Target standing height for every figure on the ramp, metres. */
const CREW_HEIGHT = 1.8;

/**
 * Photogrammetry scans arrive centred on their own origin, at whatever scale
 * the capture happened to be, and with metallic = 1 (which renders them
 * black under real lighting). This normalises one into the app's contract:
 * 1.8 m tall, feet on y = 0, centred in plan, facing -Z, matte.
 */
function normaliseCrew(src: THREE.Object3D): THREE.Group {
  const holder = new THREE.Group();
  const body = src.clone(true);

  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // Scans carry ~300k triangles each; keeping them out of the shadow pass
    // halves their vertex cost. The contact patch already grounds them.
    m.castShadow = false;
    m.receiveShadow = false;
    const fix = (mat: THREE.Material): THREE.Material => {
      const c = (mat as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
      // Scans export at metalness 1, which renders as a black silhouette
      // without an environment map. Clothing is dielectric and matte.
      c.metalness = 0;
      c.roughness = 0.78;
      c.envMapIntensity = 0.6;
      c.side = THREE.FrontSide;
      c.needsUpdate = true;
      return c;
    };
    m.material = Array.isArray(m.material)
      ? m.material.map(fix)
      : fix(m.material);
  });

  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  const k = size.y > 0.001 ? CREW_HEIGHT / size.y : 1;
  body.scale.multiplyScalar(k);
  // Feet on the deck, centred in plan.
  body.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);

  holder.add(body);
  // The scans face +Z out of the box; the app's forward is -Z.
  holder.rotation.y = Math.PI;
  return holder;
}

/** Hip and shoulder pivots, in metres above the apron. */
const HIP_Y = 0.86;
const SHOULDER_Y = 1.4;

function Limb({ geo, material }: { geo: THREE.BufferGeometry; material: THREE.Material }) {
  return <mesh geometry={geo} material={material} position={[0, -0.41, 0]} />;
}

export function Personnel({ af }: { af: Airframe }) {
  const engineRef = useRef<ReturnType<typeof getEngine> | null>(null);
  const rigs = useRef<Rig[]>([]);

  // Optional scanned crew. Absent files fall back to the procedural rig, so
  // the ramp is never empty.
  const scanBlue = useOptionalGLTF("/models/worker_blue.glb");
  const scanHivis = useOptionalGLTF("/models/worker_hivis.glb");

  const crew = useMemo(() => {
    const sources = [scanHivis?.scene, scanBlue?.scene].filter(Boolean) as THREE.Object3D[];
    if (!sources.length) return null;
    // Alternate the two scans across the pool so the crew is not all clones of
    // one person. Cloning shares geometry, so this costs draw calls, not memory.
    return Array.from({ length: SLOTS }, (_, i) =>
      normaliseCrew(sources[i % sources.length])
    );
  }, [scanBlue, scanHivis]);
  if (rigs.current.length === 0) {
    rigs.current = Array.from({ length: SLOTS }, emptyRig);
  }

  /** Damped per-slot animation blends, so a stop settles instead of snapping. */
  const strideAmp = useRef<number[]>(new Array(SLOTS).fill(0));
  const workBlend = useRef<number[]>(new Array(SLOTS).fill(0));

  /* Vest colour is per person and can change when the stand is rebuilt, so each
     slot owns a material and the last applied hex is cached to avoid churning
     the colour every frame. */
  const vestMats = useMemo(
    () =>
      Array.from(
        { length: SLOTS },
        () =>
          new THREE.MeshStandardMaterial({
            color: "#f2c53d",
            emissive: "#f2c53d",
            emissiveIntensity: 0.32,
            roughness: 0.6,
            metalness: 0,
          })
      ),
    []
  );
  const vestHex = useRef<string[]>(new Array(SLOTS).fill(""));

  useEffect(() => {
    return () => {
      for (const m of vestMats) m.dispose();
    };
  }, [vestMats]);

  /* People cast onto the apron; the contact patch itself must not. */
  useLayoutEffect(() => {
    for (const rig of rigs.current) {
      rig.root?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = m.material !== M_CONTACT;
        m.receiveShadow = false;
      });
    }
  }, []);

  /* An airframe swap reseeds the crew; drop the blends so nobody walks in
     mid-stride at their new position. */
  useEffect(() => {
    strideAmp.current.fill(0);
    workBlend.current.fill(0);
    vestHex.current.fill("");
  }, [af]);

  useFrame((_, delta) => {
    const engine = engineRef.current ?? (engineRef.current = getEngine());
    const list = engine.registry.people;
    // Frame-rate independent blend factor, bounded to [0, 1) so it can never
    // overshoot after a long frame.
    const k = 1 - Math.exp(-8 * delta);

    for (let i = 0; i < SLOTS; i++) {
      const rig = rigs.current[i];
      const root = rig.root;
      if (!root) continue;

      const p = i < list.length ? list[i] : undefined;
      if (!p || !p.visible) {
        root.visible = false;
        continue;
      }

      root.visible = true;
      root.position.set(p.position.x, 0, p.position.z);
      root.rotation.y = -p.headingRad;

      const vest = vestMats[i];
      if (vestHex.current[i] !== p.vestColor) {
        vest.color.set(p.vestColor);
        vest.emissive.set(p.vestColor);
        vestHex.current[i] = p.vestColor;
      }
      // A vest inside a live engine hazard reads hotter against dark concrete.
      vest.emissiveIntensity = p.inEngineHazard ? 0.95 : 0.32;

      /* Walk cycle. Amplitude follows speed, so a stationary figure resolves to
         a neutral stand rather than freezing part way through a stride. */
      const wantAmp = Math.min(1, p.speed / FULL_STRIDE);
      strideAmp.current[i] += (wantAmp - strideAmp.current[i]) * k;
      const amp = strideAmp.current[i];

      const wantWork = p.state === "WORKING" ? 1 : 0;
      workBlend.current[i] += (wantWork - workBlend.current[i]) * k;
      const work = workBlend.current[i];

      const swing = Math.sin(p.gait) * 0.9 * amp;
      // Arms counter-swing: sin(gait + PI) is just -sin(gait).
      const armSwing = -swing * 0.72;

      if (rig.legL) rig.legL.rotation.x = swing;
      if (rig.legR) rig.legR.rotation.x = -swing;
      if (rig.armL) rig.armL.rotation.x = armSwing + work * 0.95;
      if (rig.armR) rig.armR.rotation.x = -armSwing + work * 0.95;
      const bobY = Math.abs(Math.sin(p.gait)) * 0.055 * amp;
      if (rig.bob) rig.bob.position.y = bobY;
      if (rig.upper) rig.upper.rotation.x = work * 0.2;

      /* When a scan is available it replaces the procedural body. The scans
         are static poses, so the read comes from the bob and the lean rather
         than from limb articulation. */
      if (rig.scan) {
        const hasScan = Boolean(crew);
        rig.scan.visible = hasScan;
        if (rig.bob) rig.bob.visible = !hasScan;
        if (hasScan) {
          rig.scan.position.y = bobY;
          rig.scan.rotation.x = work * 0.16;
          // Lean into the stride a little so walking does not look like sliding.
          rig.scan.rotation.z = Math.sin(p.gait) * 0.035 * amp;
        }
      }
    }
  });

  return (
    <group>
      {Array.from({ length: SLOTS }, (_, i) => (
        <group
          key={i}
          visible={false}
          ref={(el) => {
            rigs.current[i].root = el;
          }}
        >
          <mesh geometry={CONTACT_GEO} material={M_CONTACT} position={[0, 0.02, 0]} />

          <group
            visible={false}
            ref={(el) => {
              rigs.current[i].scan = el;
            }}
          >
            {crew ? <primitive object={crew[i]} /> : null}
          </group>

          <group
            ref={(el) => {
              rigs.current[i].bob = el;
            }}
          >
            {/* legs pivot at the hip */}
            <group
              position={[-0.11, HIP_Y, 0]}
              ref={(el) => {
                rigs.current[i].legL = el;
              }}
            >
              <Limb geo={LEG_GEO} material={M_TROUSER} />
              <mesh geometry={BOOT_GEO} material={M_BOOT} position={[0, -0.78, -0.04]} />
            </group>
            <group
              position={[0.11, HIP_Y, 0]}
              ref={(el) => {
                rigs.current[i].legR = el;
              }}
            >
              <Limb geo={LEG_GEO} material={M_TROUSER} />
              <mesh geometry={BOOT_GEO} material={M_BOOT} position={[0, -0.78, -0.04]} />
            </group>

            {/* torso block leans forward slightly while working */}
            <group
              ref={(el) => {
                rigs.current[i].upper = el;
              }}
            >
              <mesh geometry={TORSO_GEO} material={M_SLEEVE} position={[0, 1.16, 0]} />
              <mesh geometry={VEST_GEO} material={vestMats[i]} position={[0, 1.18, 0]} />
              <mesh geometry={NECK_GEO} material={M_SKIN} position={[0, 1.48, 0]} />
              <mesh geometry={HEAD_GEO} material={M_SKIN} position={[0, 1.62, 0]} />
              <mesh geometry={HELMET_GEO} material={M_HELMET} position={[0, 1.6, 0]} />

              <group
                position={[-0.245, SHOULDER_Y, 0]}
                ref={(el) => {
                  rigs.current[i].armL = el;
                }}
              >
                <mesh geometry={ARM_GEO} material={M_SLEEVE} position={[0, -0.29, 0]} />
                <mesh geometry={HAND_GEO} material={M_SKIN} position={[0, -0.57, 0]} />
              </group>
              <group
                position={[0.245, SHOULDER_Y, 0]}
                ref={(el) => {
                  rigs.current[i].armR = el;
                }}
              >
                <mesh geometry={ARM_GEO} material={M_SLEEVE} position={[0, -0.29, 0]} />
                <mesh geometry={HAND_GEO} material={M_SKIN} position={[0, -0.57, 0]} />
              </group>
            </group>
          </group>
        </group>
      ))}
    </group>
  );
}
