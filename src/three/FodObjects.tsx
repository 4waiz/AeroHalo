"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Airframe } from "@/sim/aircraftTypes";
import type { FodMaterial } from "@/sim/types";
import { getEngine } from "@/sim/store";
import { type LoadedModel, cloneNode, useOptionalGLTF } from "@/three/useOptionalGLTF";

/**
 * Foreign object debris.
 *
 * POOLING STRATEGY
 * ----------------
 * A fixed pool of SLOTS groups, each holding one body per FOD material with a
 * single variant shown. `engine.registry.fod` is REPLACED (not just mutated)
 * when debris is cleared, so the array is re-read from the registry on every
 * frame rather than captured once.
 *
 * Every body is authored with its longest dimension equal to 1.0 and resting on
 * y = 0, so a slot only has to set `scale` to the item's real size.
 */

const SLOTS = 24;

const MATERIAL_ORDER: FodMaterial[] = ["Plastic", "Metal", "Tool", "Baggage", "Composite"];

const MATERIAL_INDEX: Record<FodMaterial, number> = {
  Plastic: 0,
  Metal: 1,
  Tool: 2,
  Baggage: 3,
  Composite: 4,
};

/** Optional GLB body per material; Baggage and Composite stay procedural. */
const GLB_NODE: Partial<Record<FodMaterial, string>> = {
  Plastic: "GSE_FodBottle",
  Metal: "GSE_FodBolt",
  Tool: "GSE_FodTool",
};

/** Surface response per debris class. */
const LOOK: Record<FodMaterial, { color: string; roughness: number; metalness: number }> = {
  Plastic: { color: "#c9d2d6", roughness: 0.34, metalness: 0.0 },
  Metal: { color: "#9aa3a9", roughness: 0.3, metalness: 0.85 },
  Tool: { color: "#c05a2c", roughness: 0.48, metalness: 0.35 },
  Baggage: { color: "#4a3f38", roughness: 0.9, metalness: 0.0 },
  Composite: { color: "#5d6b73", roughness: 0.7, metalness: 0.12 },
};

/* ------------------------------------------------------------------ */
/* Shared geometry                                                     */
/* ------------------------------------------------------------------ */

const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Unit cylinder whose axis runs along Z. */
const CYL_Z = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  g.rotateX(Math.PI / 2);
  return g;
})();

/** Tapered cylinder, wide end toward +Z, narrow end toward -Z. */
const TAPER_Z = (() => {
  const g = new THREE.CylinderGeometry(1, 0.42, 1, 10, 1);
  g.rotateX(Math.PI / 2);
  return g;
})();

/** Six-sided cylinder along Z, for the bolt head. */
const HEX_Z = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
  g.rotateX(Math.PI / 2);
  return g;
})();

/**
 * Irregular flat composite shard: a low-segment disc whose rim radius is
 * modulated by a smooth function of the vertex angle, which keeps the outline
 * closed while making it read as a broken panel rather than a coin.
 */
const SHARD_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 0.07, 7, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (Math.hypot(x, z) < 1e-4) continue;
    const a = Math.atan2(z, x);
    const k = 0.62 + 0.3 * Math.sin(a * 3 + 1.2) + 0.12 * Math.cos(a * 5 - 0.4);
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.translate(0, 0.035, 0);
  return g;
})();

/* ------------------------------------------------------------------ */
/* Procedural bodies - longest dimension 1.0, resting on y = 0         */
/* ------------------------------------------------------------------ */

/** Discarded drinks bottle lying on its side, neck toward -Z. */
function BottleBody({ material }: { material: THREE.Material }) {
  return (
    <group position={[0, 0.15, 0]}>
      <mesh geometry={CYL_Z} material={material} position={[0, 0, 0.15]} scale={[0.15, 0.15, 0.6]} />
      <mesh geometry={TAPER_Z} material={material} position={[0, 0, -0.23]} scale={[0.15, 0.15, 0.16]} />
      <mesh geometry={CYL_Z} material={material} position={[0, 0, -0.38]} scale={[0.06, 0.06, 0.14]} />
      <mesh geometry={CYL_Z} material={material} position={[0, 0, -0.48]} scale={[0.08, 0.08, 0.07]} />
    </group>
  );
}

/** Hex-head bolt, head toward -Z. */
function BoltBody({ material }: { material: THREE.Material }) {
  return (
    <group position={[0, 0.26, 0]}>
      <mesh geometry={HEX_Z} material={material} position={[0, 0, -0.34]} scale={[0.26, 0.26, 0.24]} />
      <mesh geometry={CYL_Z} material={material} position={[0, 0, 0.12]} scale={[0.105, 0.105, 0.68]} />
    </group>
  );
}

/** Open-end spanner: shaft plus two prongs at the -Z end. */
function ToolBody({ material }: { material: THREE.Material }) {
  return (
    <group position={[0, 0.038, 0]}>
      <mesh geometry={BOX} material={material} position={[0, 0, 0.09]} scale={[0.14, 0.075, 0.82]} />
      <mesh geometry={BOX} material={material} position={[-0.1, 0, -0.4]} scale={[0.1, 0.075, 0.2]} />
      <mesh geometry={BOX} material={material} position={[0.1, 0, -0.4]} scale={[0.1, 0.075, 0.2]} />
    </group>
  );
}

/** Dropped soft bag; the offset shell rounds off the silhouette. */
function BaggageBody({ material }: { material: THREE.Material }) {
  return (
    <group>
      <mesh geometry={BOX} material={material} position={[0, 0.22, 0]} scale={[1.0, 0.44, 0.62]} />
      <mesh geometry={BOX} material={material} position={[0, 0.24, 0]} scale={[0.94, 0.38, 0.68]} />
      <mesh geometry={BOX} material={material} position={[0, 0.46, 0]} scale={[0.28, 0.07, 0.08]} />
    </group>
  );
}

/** Broken composite panel, resting at a slight angle. */
function ShardBody({ material }: { material: THREE.Material }) {
  return (
    <group rotation={[0, 0, 0.09]}>
      <mesh geometry={SHARD_GEO} material={material} />
    </group>
  );
}

function ProceduralBody({ kind, material }: { kind: FodMaterial; material: THREE.Material }) {
  switch (kind) {
    case "Plastic":
      return <BottleBody material={material} />;
    case "Metal":
      return <BoltBody material={material} />;
    case "Tool":
      return <ToolBody material={material} />;
    case "Baggage":
      return <BaggageBody material={material} />;
    case "Composite":
      return <ShardBody material={material} />;
  }
}

/**
 * A GLB body renormalised to the same convention as the procedural fallbacks:
 * longest dimension 1.0, lowest point on y = 0. Without this the authored
 * Blender size would fight the per-item `sizeCm` scaling.
 */
function useNormalisedClone(node: THREE.Object3D | undefined) {
  return useMemo(() => {
    if (!node) return null;
    const c = cloneNode(node);
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    if (longest < 1e-5) return c;
    c.scale.setScalar(1 / longest);
    c.position.y = -box.min.y / longest;
    return c;
  }, [node]);
}

function FodBody({
  kind,
  gse,
  material,
}: {
  kind: FodMaterial;
  gse: LoadedModel | null;
  material: THREE.Material;
}) {
  const nodeName = GLB_NODE[kind];
  const obj = useNormalisedClone(nodeName ? gse?.nodes[nodeName] : undefined);
  if (obj) return <primitive object={obj} />;
  return <ProceduralBody kind={kind} material={material} />;
}

/* ------------------------------------------------------------------ */
/* FOD field                                                           */
/* ------------------------------------------------------------------ */

export function FodObjects({ af }: { af: Airframe }) {
  const gse = useOptionalGLTF("/models/gse.glb");
  const engineRef = useRef<ReturnType<typeof getEngine> | null>(null);

  const slots = useRef<(THREE.Group | null)[]>([]);
  const variants = useRef<(THREE.Group | null)[][]>([]);
  if (variants.current.length === 0) {
    variants.current = Array.from({ length: SLOTS }, () =>
      new Array<THREE.Group | null>(MATERIAL_ORDER.length).fill(null)
    );
  }

  /* One material per slot: the debris class sets colour/roughness/metalness,
     and the detection state drives the emissive. Cached so the colour is only
     written when the slot actually changes item. */
  const mats = useMemo(
    () =>
      Array.from(
        { length: SLOTS },
        () =>
          new THREE.MeshStandardMaterial({
            color: LOOK.Plastic.color,
            roughness: LOOK.Plastic.roughness,
            metalness: LOOK.Plastic.metalness,
            emissive: "#ffb45c",
            emissiveIntensity: 0,
            flatShading: true,
          })
      ),
    []
  );
  const matKind = useRef<(FodMaterial | null)[]>(new Array(SLOTS).fill(null));

  useEffect(() => {
    return () => {
      for (const m of mats) m.dispose();
    };
  }, [mats]);

  useEffect(() => {
    matKind.current.fill(null);
  }, [af]);

  /* Only vehicles and people cast. GLB bodies arrive with shadows enabled by
     the loader, so they are cleared once the model resolves. */
  useLayoutEffect(() => {
    for (const g of slots.current) {
      g?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
    }
  }, [gse]);

  /**
   * Rendered floor size. Real debris can be 3 cm across, which is invisible
   * from the elevated monitoring camera, so the item is drawn at a readable
   * minimum. The floor grows with the stand because the camera presets pull
   * back by the same factor on the larger airframe.
   */
  const minRender = 0.25 * Math.sqrt(af.worldScale);

  useFrame((state) => {
    const engine = engineRef.current ?? (engineRef.current = getEngine());
    // Cleared debris swaps the array wholesale, so never cache it across frames.
    const list = engine.registry.fod;
    const glow = 0.22 + 0.14 * Math.sin(state.clock.elapsedTime * 3);

    for (let i = 0; i < SLOTS; i++) {
      const root = slots.current[i];
      if (!root) continue;

      const f = i < list.length ? list[i] : undefined;
      if (!f) {
        root.visible = false;
        continue;
      }

      root.visible = true;
      root.position.set(f.position.x, 0, f.position.z);
      root.rotation.y = f.rotation;
      root.scale.setScalar(Math.max(f.sizeCm / 100, minRender));

      const bodies = variants.current[i];
      const want = MATERIAL_INDEX[f.material];
      for (let k = 0; k < bodies.length; k++) {
        const b = bodies[k];
        if (b && b.visible !== (k === want)) b.visible = k === want;
      }

      const mat = mats[i];
      if (matKind.current[i] !== f.material) {
        const look = LOOK[f.material];
        mat.color.set(look.color);
        mat.roughness = look.roughness;
        mat.metalness = look.metalness;
        matKind.current[i] = f.material;
      }
      // Undetected debris still exists physically, it just carries no highlight.
      mat.emissiveIntensity = f.detected ? glow : 0;
    }
  });

  return (
    <group>
      {Array.from({ length: SLOTS }, (_, i) => (
        <group
          key={i}
          visible={false}
          ref={(el) => {
            slots.current[i] = el;
          }}
        >
          {MATERIAL_ORDER.map((m, k) => (
            <group
              key={m}
              visible={k === 0}
              ref={(el) => {
                variants.current[i][k] = el;
              }}
            >
              <FodBody kind={m} gse={gse} material={mats[i]} />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}
