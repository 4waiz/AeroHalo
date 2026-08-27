"use client";

import type { ReactNode } from "react";
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import type { Airframe } from "@/sim/aircraftTypes";
import { STAND_ID, apronBounds } from "@/sim/constants";
import { applyConcrete } from "@/three/concrete";
import { cloneNode, useOptionalGLTF } from "@/three/useOptionalGLTF";

/**
 * Static stand dressing: concrete, painted markings, the terminal block,
 * floodlight masts and the scattered ground props.
 *
 * Nothing here reads simulation state, so the whole file is built once per
 * airframe inside `useMemo` and never touches `useFrame`. Everything that can
 * share a draw call is packed into an `InstancedMesh`.
 *
 * Every apron dimension is multiplied by `af.worldScale` so the stand stays
 * proportional to the parked airframe. Props that exist in the real world at a
 * fixed size (cones, chocks, ULDs) keep their true metre dimensions.
 */

/* ------------------------------------------------------------------ */
/* Shared geometry + material bank - module scope, created once        */
/* ------------------------------------------------------------------ */

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

/** Flat painted stripe: sits just above the slab and never fights it for z. */
function paintMaterial(color: string, opacity: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

const MAT_PAINT_WHITE = paintMaterial("#c8ccc9", 0.82);
const MAT_PAINT_YELLOW = paintMaterial("#d8b13a", 0.88);
const MAT_PAINT_RESTRAINT = paintMaterial("#c4522a", 0.78);

const MAT_CONCRETE = new THREE.MeshStandardMaterial({
  color: "#2f363d",
  roughness: 0.95,
  metalness: 0,
});

const MAT_SLAB_JOINT = new THREE.MeshStandardMaterial({
  color: "#1e252b",
  roughness: 1,
  metalness: 0,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const MAT_PATCH = new THREE.MeshStandardMaterial({
  color: "#272e35",
  roughness: 1,
  metalness: 0,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

// Structures were authored for a night apron; under daylight they need real
// cladding tones or they read as black cut-outs against the sky.
const MAT_TERMINAL = new THREE.MeshStandardMaterial({
  color: "#4a545e",
  roughness: 0.92,
  metalness: 0.05,
});
const MAT_TERMINAL_DARK = new THREE.MeshStandardMaterial({
  color: "#333c45",
  roughness: 0.95,
  metalness: 0,
});
const MAT_WINDOW = new THREE.MeshStandardMaterial({
  color: "#2e3f4f",
  emissive: "#8fa4b6",
  // Daylight glazing reflects the sky rather than glowing from inside.
  emissiveIntensity: 0.18,
  roughness: 0.16,
  metalness: 0.5,
});

const MAT_MAST = new THREE.MeshStandardMaterial({
  color: "#5a636b",
  roughness: 0.8,
  metalness: 0.35,
});
const MAT_LAMP = new THREE.MeshStandardMaterial({
  color: "#20272d",
  emissive: "#cfe0ee",
  emissiveIntensity: 1.5,
  roughness: 0.5,
  metalness: 0,
  toneMapped: false,
});

const MAT_CONE = new THREE.MeshStandardMaterial({
  color: "#e2762a",
  roughness: 0.72,
  metalness: 0,
});
const MAT_CONE_BASE = new THREE.MeshStandardMaterial({
  color: "#1c2126",
  roughness: 0.9,
  metalness: 0,
});
const MAT_CHOCK = new THREE.MeshStandardMaterial({
  color: "#d9b23c",
  roughness: 0.78,
  metalness: 0,
  flatShading: true,
});
const MAT_CRATE = new THREE.MeshStandardMaterial({
  color: "#3b454d",
  roughness: 0.85,
  metalness: 0.12,
});
const MAT_CRATE_LID = new THREE.MeshStandardMaterial({
  color: "#4a555e",
  roughness: 0.8,
  metalness: 0.15,
});
const MAT_ULD = new THREE.MeshStandardMaterial({
  color: "#8d959a",
  roughness: 0.55,
  metalness: 0.5,
  flatShading: true,
});
const MAT_ULD_TRIM = new THREE.MeshStandardMaterial({
  color: "#5d666c",
  roughness: 0.65,
  metalness: 0.35,
});
const MAT_BRIDGE = new THREE.MeshStandardMaterial({
  color: "#949ba1",
  roughness: 0.7,
  metalness: 0.25,
});
const MAT_BRIDGE_DARK = new THREE.MeshStandardMaterial({
  color: "#646c73",
  roughness: 0.8,
  metalness: 0.2,
});

/** Cone body pre-translated so its base sits on y = 0. */
const CONE_GEO = (() => {
  const g = new THREE.ConeGeometry(0.29, 0.68, 10, 1);
  g.translate(0, 0.34, 0);
  return g;
})();

/** Flat base plate under each procedural cone. */
const CONE_BASE_GEO = (() => {
  const g = new THREE.BoxGeometry(0.52, 0.06, 0.52);
  g.translate(0, 0.03, 0);
  return g;
})();

/** Wheel chock: triangular prism, flat face down, resting on y = 0. */
const CHOCK_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 3, 1);
  g.rotateX(Math.PI / 2); // prism axis now runs along Z
  g.rotateZ(Math.PI); // flip so the flat edge is the base
  g.scale(1.25, 0.72, 1.6);
  g.translate(0, 0.108, 0); // lift the base to y = 0
  return g;
})();

const POLE_GEO = new THREE.CylinderGeometry(1, 1, 1, 10, 1);

/* ------------------------------------------------------------------ */
/* Marking maths                                                       */
/* ------------------------------------------------------------------ */

/** One painted rectangle: `w` spans X, `l` spans Z, optional Y rotation. */
interface Seg {
  x: number;
  z: number;
  w: number;
  l: number;
  rot?: number;
}

/** Stripe running left-right at a constant z; `t` is the stripe thickness. */
const stripeX = (z: number, x0: number, x1: number, t: number): Seg => ({
  x: (x0 + x1) / 2,
  z,
  w: Math.abs(x1 - x0),
  l: t,
});

/** Stripe running fore-aft at a constant x; `t` is the stripe thickness. */
const stripeZ = (x: number, z0: number, z1: number, t: number): Seg => ({
  x,
  z: (z0 + z1) / 2,
  w: t,
  l: Math.abs(z1 - z0),
});

function dashX(out: Seg[], z: number, x0: number, x1: number, t: number, dash: number, gap: number) {
  for (let x = x0; x < x1 - 0.05; x += dash + gap) {
    out.push(stripeX(z, x, Math.min(x + dash, x1), t));
  }
}

function dashZ(out: Seg[], x: number, z0: number, z1: number, t: number, dash: number, gap: number) {
  for (let z = z0; z < z1 - 0.05; z += dash + gap) {
    out.push(stripeZ(x, z, Math.min(z + dash, z1), t));
  }
}

function rectOutline(out: Seg[], x0: number, x1: number, z0: number, z1: number, t: number) {
  out.push(stripeZ(x0, z0, z1, t), stripeZ(x1, z0, z1, t));
  out.push(stripeX(z0, x0, x1, t), stripeX(z1, x0, x1, t));
}

function dashedRect(
  out: Seg[],
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  t: number,
  dash: number,
  gap: number
) {
  dashZ(out, x0, z0, z1, t, dash, gap);
  dashZ(out, x1, z0, z1, t, dash, gap);
  dashX(out, z0, x0, x1, t, dash, gap);
  dashX(out, z1, x0, x1, t, dash, gap);
}

/** Deterministic LCG so the apron looks identical on every reload. */
function makeNoise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* GLB helpers                                                         */
/* ------------------------------------------------------------------ */

/** First mesh found under a node, used to feed a GLB body into an InstancedMesh. */
function firstMesh(o: THREE.Object3D | undefined | null): THREE.Mesh | null {
  if (!o) return null;
  const stack: THREE.Object3D[] = [o];
  while (stack.length > 0) {
    const n = stack.pop() as THREE.Object3D;
    if ((n as THREE.Mesh).isMesh) return n as THREE.Mesh;
    for (const c of n.children) stack.push(c);
  }
  return null;
}

/**
 * Resolves the geometry/material pair used by an instanced prop. When the GLB
 * is present its own mesh wins, with the node's local transform baked into a
 * cloned geometry so the footprint matches the procedural fallback.
 */
function instancedSource(
  node: THREE.Object3D | undefined,
  fallbackGeo: THREE.BufferGeometry,
  fallbackMat: THREE.Material
): { geo: THREE.BufferGeometry; mat: THREE.Material; procedural: boolean } {
  const m = firstMesh(node);
  if (!m) return { geo: fallbackGeo, mat: fallbackMat, procedural: true };
  const geo = m.geometry.clone();
  m.updateWorldMatrix(true, false);
  geo.applyMatrix4(m.matrixWorld);
  const raw = m.material;
  const mat = Array.isArray(raw) ? raw[0] : raw;
  return { geo, mat, procedural: false };
}

/* ------------------------------------------------------------------ */
/* Instanced helpers                                                   */
/* ------------------------------------------------------------------ */

const SCRATCH = new THREE.Object3D();

function PaintBand({
  segs,
  material,
  y,
  order,
}: {
  segs: Seg[];
  material: THREE.Material;
  y: number;
  order: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      SCRATCH.position.set(s.x, y, s.z);
      SCRATCH.rotation.set(0, s.rot ?? 0, 0);
      SCRATCH.scale.set(Math.max(s.w, 0.02), 0.02, Math.max(s.l, 0.02));
      SCRATCH.updateMatrix();
      mesh.setMatrixAt(i, SCRATCH.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [segs, y]);

  if (segs.length === 0) return null;
  return (
    <instancedMesh
      key={segs.length}
      ref={ref}
      args={[UNIT_BOX, material, segs.length]}
      renderOrder={order}
      frustumCulled={false}
    />
  );
}

/** A prop scattered at fixed world transforms, drawn in one call. */
function PropField({
  geometry,
  material,
  spots,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** [x, z, rotationY, uniformScale] */
  spots: [number, number, number, number][];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < spots.length; i++) {
      const [x, z, rot, sc] = spots[i];
      SCRATCH.position.set(x, 0, z);
      SCRATCH.rotation.set(0, rot, 0);
      SCRATCH.scale.setScalar(sc);
      SCRATCH.updateMatrix();
      mesh.setMatrixAt(i, SCRATCH.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [spots, geometry]);

  if (spots.length === 0) return null;
  return (
    <instancedMesh
      key={`${spots.length}`}
      ref={ref}
      args={[geometry, material, spots.length]}
      frustumCulled={false}
    />
  );
}

/** GLB body when the node exists, procedural children otherwise. */
function PropSlot({
  node,
  x,
  z,
  rotY,
  children,
}: {
  node: THREE.Object3D | undefined;
  x: number;
  z: number;
  rotY: number;
  children: ReactNode;
}) {
  const obj = useMemo(() => (node ? cloneNode(node) : null), [node]);
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      {obj ? <primitive object={obj} /> : children}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Procedural props                                                    */
/* ------------------------------------------------------------------ */

/** Ramp equipment crate, ~1.9 x 1.3 x 1.1 m. */
function ProceduralCrate() {
  return (
    <group>
      <mesh position={[0, 0.5, 0]} material={MAT_CRATE} geometry={UNIT_BOX} scale={[1.9, 1.0, 1.3]} />
      <mesh
        position={[0, 1.05, 0]}
        material={MAT_CRATE_LID}
        geometry={UNIT_BOX}
        scale={[2.02, 0.14, 1.42]}
      />
      <mesh
        position={[0, 0.55, -0.68]}
        material={MAT_CRATE_LID}
        geometry={UNIT_BOX}
        scale={[1.5, 0.6, 0.06]}
      />
    </group>
  );
}

/** LD3-style container, ~3.1 x 2.0 x 1.65 m. */
function ProceduralUld() {
  return (
    <group>
      <mesh position={[0, 0.98, 0]} material={MAT_ULD} geometry={UNIT_BOX} scale={[3.1, 1.9, 1.65]} />
      <mesh
        position={[0, 1.98, 0]}
        material={MAT_ULD_TRIM}
        geometry={UNIT_BOX}
        scale={[3.18, 0.14, 1.73]}
      />
      <mesh
        position={[0, 0.9, -0.86]}
        material={MAT_ULD_TRIM}
        geometry={UNIT_BOX}
        scale={[2.5, 1.5, 0.06]}
      />
      <mesh position={[0, 0.06, 0]} material={MAT_ULD_TRIM} geometry={UNIT_BOX} scale={[3.14, 0.12, 1.7]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Apron                                                               */
/* ------------------------------------------------------------------ */

export function Apron({ af }: { af: Airframe }) {
  const gse = useOptionalGLTF("/models/gse.glb");

  const layout = useMemo(() => {
    const s = af.worldScale;
    const e = af.envelope;
    const b = apronBounds(s);
    const noise = makeNoise(0x5eed01);

    /* --- ground extents, a little larger than the logical bounds --- */
    const gw = (b.maxX - b.minX) * 2.6;
    const gd = (b.maxZ - b.minZ) * 2.8;
    const gcz = (b.minZ + b.maxZ) / 2 + 25 * s;
    const gx0 = -gw / 2;
    const gx1 = gw / 2;
    const gz0 = gcz - gd / 2;
    const gz1 = gcz + gd / 2;

    /* --- slab / expansion joints every 7.5 s metres --- */
    const step = 7.5 * s;
    const joints: Seg[] = [];
    for (let x = Math.ceil(gx0 / step) * step; x <= gx1; x += step) {
      joints.push(stripeZ(x, gz0, gz1, 0.14 * s));
    }
    for (let z = Math.ceil(gz0 / step) * step; z <= gz1; z += step) {
      joints.push(stripeX(z, gx0, gx1, 0.14 * s));
    }

    /* --- low-contrast wear patches so the slab is not a flat plane --- */
    const patchSpec: [number, number, number, number][] = [
      [-18, 22, 26, 18],
      [24, -8, 20, 26],
      [-32, -14, 22, 16],
      [8, 41, 34, 20],
      [41, 27, 18, 22],
      [-6, -31, 30, 14],
      [-44, 8, 16, 30],
    ];
    const patches: Seg[] = patchSpec.map(([px, pz, pw, pl]) => ({
      x: px * s,
      z: pz * s,
      w: pw * s,
      l: pl * s,
      rot: (noise() - 0.5) * 0.25,
    }));

    /* --- stand geometry the markings key off --- */
    const stopZ = af.gear[0].z; // nose-gear contact patch = wheel stop
    const envX = e.halfSpan + 3 * s;
    const envZ0 = e.noseZ - 4 * s;
    const envZ1 = e.tailZ + 4 * s;
    const eraX = e.halfSpan + 1.6 * s;
    const eraZ0 = e.noseZ - 2.2 * s;
    const eraZ1 = e.tailZ + 2.2 * s;
    const identX = -4.6 * s;
    const identZ = stopZ + 2.2 * s;

    /* --- yellow: lead-in, stop bar, stand identifier box --- */
    const yellow: Seg[] = [];
    // Lead-in runs from the taxiway side (+Z) forward to the wheel stop.
    yellow.push(stripeZ(0, stopZ, 34 * s, 0.35 * s));
    yellow.push(stripeX(stopZ, -2 * s, 2 * s, 0.35 * s));
    // Short alignment ticks either side of the stop bar.
    yellow.push(stripeZ(-2 * s, stopZ - 0.9 * s, stopZ, 0.3 * s));
    yellow.push(stripeZ(2 * s, stopZ - 0.9 * s, stopZ, 0.3 * s));
    rectOutline(yellow, identX - 2 * s, identX + 2 * s, identZ - 1.2 * s, identZ + 1.2 * s, 0.18 * s);

    /* --- white: envelope outline, service roads, GSE bays --- */
    const white: Seg[] = [];
    dashedRect(white, -envX, envX, envZ0, envZ1, 0.22 * s, 1.8 * s, 1.2 * s);

    const roadHalf = 3.4 * s;
    const roadX0 = gx0 + 4 * s;
    const roadX1 = gx1 - 4 * s;
    for (const zc of [30 * s, -26 * s]) {
      white.push(stripeX(zc - roadHalf, roadX0, roadX1, 0.22 * s));
      white.push(stripeX(zc + roadHalf, roadX0, roadX1, 0.22 * s));
      dashX(white, zc, roadX0, roadX1, 0.16 * s, 2.6 * s, 2.6 * s);
    }

    // GSE staging bays, kept well outboard of the safety envelope.
    const bayX = e.halfSpan + 13 * s;
    const bayHalfW = 3.5 * s;
    const bayHalfL = 2.5 * s;
    const bays: [number, number][] = [
      [-bayX, 2 * s],
      [-bayX, 9 * s],
      [-bayX, 16 * s],
      [bayX, 2 * s],
      [bayX, 9 * s],
    ];
    for (const [bx, bz] of bays) {
      rectOutline(white, bx - bayHalfW, bx + bayHalfW, bz - bayHalfL, bz + bayHalfL, 0.18 * s);
    }

    /* --- red-orange equipment restraint area, just inside the envelope --- */
    const restraint: Seg[] = [];
    rectOutline(restraint, -eraX, eraX, eraZ0, eraZ1, 0.16 * s);

    /* --- terminal block --- */
    const tW = 120 * s;
    const tH = 14 * s;
    // Depth is kept short enough that the block's back face stays on the
    // concrete slab rather than hanging over the edge of the ground plane.
    const tD = 22 * s;
    const tZ = b.terminalZ - tD / 2; // front facade lands exactly on terminalZ

    const pillars: number[] = [];
    for (let x = -48 * s; x <= 48 * s + 0.01; x += 16 * s) pillars.push(x);

    const windows: [number, number][] = [];
    for (const wy of [5.2 * s, 9.2 * s]) {
      for (let x = -56 * s; x <= 56 * s + 0.01; x += 4.6 * s) {
        if (noise() < 0.18) continue; // a few unlit rooms break up the row
        windows.push([x, wy]);
      }
    }

    /* --- floodlight masts at the stand corners --- */
    const mastX = e.halfSpan + 17 * s;
    const masts: [number, number][] = [
      [-mastX, e.noseZ - 12 * s],
      [mastX, e.noseZ - 12 * s],
      [-mastX, e.tailZ + 14 * s],
      [mastX, e.tailZ + 14 * s],
    ];

    /* --- cones: envelope corners, wingtips, nose and tail, never on the
           lead-in line (x = 0) and never inside the aircraft footprint --- */
    const tipX = e.halfSpan + 1.4 * s;
    const envMid = (envZ0 + envZ1) / 2;
    const cones: [number, number, number, number][] = (
      [
        [envX, envZ0],
        [-envX, envZ0],
        [envX, envZ1],
        [-envX, envZ1],
        [envX, envMid],
        [-envX, envMid],
        [tipX, e.wingZ1 + 0.8 * s],
        [-tipX, e.wingZ1 + 0.8 * s],
        [tipX, e.wingZ0 - 0.8 * s],
        [-tipX, e.wingZ0 - 0.8 * s],
        [2.6 * s, e.noseZ - 3.2 * s],
        [-2.6 * s, e.noseZ - 3.2 * s],
        [3.0 * s, e.tailZ + 3.0 * s],
        [-3.0 * s, e.tailZ + 3.0 * s],
      ] as [number, number][]
    ).map(([x, z]) => [x, z, noise() * Math.PI, 1] as [number, number, number, number]);

    /* --- chocks fore and aft of every gear contact patch (real metres) --- */
    const chocks: [number, number, number, number][] = [];
    for (const g of af.gear) {
      chocks.push([g.x, g.z - 0.62, 0, 1]);
      chocks.push([g.x, g.z + 0.62, Math.PI, 1]);
    }

    /* --- staged equipment inside the bays --- */
    // Crates share the bays with the ULDs, so they are offset to the free
    // corner of each box rather than centred on it.
    const crates: [number, number, number][] = [
      [-bayX - 2.4 * s, 0.6 * s, 0.28],
      [-bayX + 2.4 * s, 10.4 * s, -0.16],
      [bayX - 2.4 * s, 3.6 * s, 0.44],
      [bayX + 2.2 * s, 7.2 * s, -0.35],
    ];
    const ulds: [number, number, number][] = [
      [-bayX, 16.2 * s, 0.06],
      [-bayX + 0.4 * s, 2.6 * s, -0.1],
      [-bayX - 0.3 * s, 8.4 * s, 0.14],
      [bayX + 0.2 * s, 1.6 * s, -0.05],
      [bayX - 0.4 * s, 9.8 * s, 0.2],
    ];

    /* --- jet bridge: only the airliner uses one --- */
    const doorX = af.forwardDoor.x;
    const doorZ = af.forwardDoor.z;
    const rotundaX = doorX + 3.2 * s;
    const rotundaZ = b.terminalZ + 26 * s;
    const cabX = doorX + 1.6;
    const cabZ = doorZ;
    const bridgeLen = Math.hypot(cabX - rotundaX, cabZ - rotundaZ);
    const bridgeAng = Math.atan2(cabX - rotundaX, cabZ - rotundaZ);

    return {
      s,
      b,
      ground: { w: gw, d: gd, cz: gcz },
      joints,
      patches,
      yellow,
      white,
      restraint,
      stopZ,
      identX,
      identZ,
      terminal: { tW, tH, tD, tZ, pillars, windows },
      masts,
      cones,
      chocks,
      crates,
      ulds,
      bridge: { rotundaX, rotundaZ, cabX, cabZ, bridgeLen, bridgeAng },
    };
  }, [af]);

  const { s, b } = layout;

  /* Cones and chocks always draw instanced; the GLB simply swaps the source. */
  const coneSrc = useMemo(
    () => instancedSource(gse?.nodes.GSE_Cone, CONE_GEO, MAT_CONE),
    [gse]
  );
  const chockSrc = useMemo(
    () => instancedSource(gse?.nodes.GSE_Chock, CHOCK_GEO, MAT_CHOCK),
    [gse]
  );

  /* Cone base plates only exist for the procedural cone. */
  const coneBases = useMemo(
    () =>
      coneSrc.procedural
        ? layout.cones.map(([x, z, r]) => [x, z, r, 1] as [number, number, number, number])
        : [],
    [coneSrc.procedural, layout.cones]
  );

  // Procedural aggregate, staining and surface relief. Without it the slab is
  // a flat colour and every translucent zone above it reads as a lens tint
  // rather than paint on concrete.
  useLayoutEffect(() => {
    applyConcrete(MAT_CONCRETE, layout.ground.w, layout.ground.d, 14 * af.worldScale);
  }, [layout.ground.w, layout.ground.d, af.worldScale]);

  return (
    <group>
      {/* ---------------- concrete ---------------- */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, layout.ground.cz]}
        receiveShadow
        material={MAT_CONCRETE}
      >
        <planeGeometry args={[layout.ground.w, layout.ground.d]} />
      </mesh>

      <PaintBand segs={layout.patches} material={MAT_PATCH} y={0.006} order={1} />
      <PaintBand segs={layout.joints} material={MAT_SLAB_JOINT} y={0.008} order={2} />

      {/* ---------------- painted markings ---------------- */}
      <PaintBand segs={layout.white} material={MAT_PAINT_WHITE} y={0.012} order={3} />
      <PaintBand segs={layout.restraint} material={MAT_PAINT_RESTRAINT} y={0.013} order={4} />
      <PaintBand segs={layout.yellow} material={MAT_PAINT_YELLOW} y={0.014} order={5} />

      {/* drei Text loads a font asynchronously; keep it in its own boundary so a
          slow or missing font never suspends the whole canvas. */}
      <Suspense fallback={null}>
        <Text
          position={[layout.identX, 0.021, layout.identZ]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={1.15 * s}
          color="#d8b13a"
          anchorX="center"
          anchorY="middle"
          renderOrder={9}
          depthOffset={-6}
          letterSpacing={0.08}
        >
          {STAND_ID}
        </Text>
        <Text
          position={[3.4 * s, 0.021, layout.stopZ + 1.15 * s]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.9 * s}
          color="#d8b13a"
          anchorX="center"
          anchorY="middle"
          renderOrder={9}
          depthOffset={-6}
          letterSpacing={0.14}
        >
          STOP
        </Text>
      </Suspense>

      {/* ---------------- terminal block ---------------- */}
      <group>
        <mesh
          position={[0, layout.terminal.tH / 2, layout.terminal.tZ]}
          geometry={UNIT_BOX}
          material={MAT_TERMINAL}
          scale={[layout.terminal.tW, layout.terminal.tH, layout.terminal.tD]}
        />
        {/* plinth */}
        <mesh
          position={[0, 1.2 * s, layout.terminal.tZ]}
          geometry={UNIT_BOX}
          material={MAT_TERMINAL_DARK}
          scale={[layout.terminal.tW + 3 * s, 2.4 * s, layout.terminal.tD + 1 * s]}
        />
        {/* stair / plant tower breaks the silhouette */}
        <mesh
          position={[-52 * s, 9 * s, b.terminalZ - 6 * s]}
          geometry={UNIT_BOX}
          material={MAT_TERMINAL}
          scale={[11 * s, 18 * s, 11 * s]}
        />
        {/* canopy lip */}
        <mesh
          position={[0, 11.4 * s, b.terminalZ + 2.0 * s]}
          geometry={UNIT_BOX}
          material={MAT_TERMINAL_DARK}
          scale={[layout.terminal.tW + 6 * s, 0.9 * s, 5.0 * s]}
        />
        {layout.terminal.pillars.map((px) => (
          <mesh
            key={px}
            position={[px, 5.5 * s, b.terminalZ + 3.6 * s]}
            geometry={UNIT_BOX}
            material={MAT_TERMINAL_DARK}
            scale={[1.5 * s, 11 * s, 1.5 * s]}
          />
        ))}
        <TerminalWindows
          spots={layout.terminal.windows}
          z={b.terminalZ + 0.08 * s}
          w={2.9 * s}
          h={1.6 * s}
        />
      </group>

      {/* ---------------- floodlight masts ---------------- */}
      {layout.masts.map(([mx, mz], i) => (
        <group key={i} position={[mx, 0, mz]}>
          <mesh
            geometry={POLE_GEO}
            material={MAT_MAST}
            position={[0, 0.25 * s, 0]}
            scale={[0.7 * s, 0.5 * s, 0.7 * s]}
          />
          <mesh
            geometry={POLE_GEO}
            material={MAT_MAST}
            position={[0, 6 * s, 0]}
            scale={[0.22 * s, 12 * s, 0.22 * s]}
          />
          <mesh
            geometry={UNIT_BOX}
            material={MAT_MAST}
            position={[0, 11.7 * s, 0]}
            scale={[2.9 * s, 0.18 * s, 0.2 * s]}
          />
          <mesh
            geometry={UNIT_BOX}
            material={MAT_LAMP}
            position={[0, 12.1 * s, 0]}
            scale={[2.4 * s, 0.5 * s, 0.95 * s]}
          />
        </group>
      ))}

      {/* ---------------- jet bridge (airliner stands only) ---------------- */}
      {af.id === "airliner" && (
        <group>
          <mesh
            geometry={POLE_GEO}
            material={MAT_BRIDGE_DARK}
            position={[layout.bridge.rotundaX, 3.2, layout.bridge.rotundaZ]}
            scale={[2.3, 6.4, 2.3]}
          />
          <mesh
            geometry={UNIT_BOX}
            material={MAT_BRIDGE}
            position={[
              (layout.bridge.rotundaX + layout.bridge.cabX) / 2,
              4.8,
              (layout.bridge.rotundaZ + layout.bridge.cabZ) / 2,
            ]}
            rotation={[0, layout.bridge.bridgeAng, 0]}
            scale={[3.2, 2.9, layout.bridge.bridgeLen]}
          />
          <mesh
            geometry={UNIT_BOX}
            material={MAT_BRIDGE_DARK}
            position={[layout.bridge.cabX, 4.9, layout.bridge.cabZ]}
            rotation={[0, layout.bridge.bridgeAng, 0]}
            scale={[4.2, 3.3, 3.4]}
          />
          {/* drive bogie two thirds of the way along the tunnel */}
          <group
            position={[
              layout.bridge.rotundaX + (layout.bridge.cabX - layout.bridge.rotundaX) * 0.68,
              0,
              layout.bridge.rotundaZ + (layout.bridge.cabZ - layout.bridge.rotundaZ) * 0.68,
            ]}
            rotation={[0, layout.bridge.bridgeAng, 0]}
          >
            <mesh
              geometry={POLE_GEO}
              material={MAT_BRIDGE_DARK}
              position={[-1.2, 1.7, 0]}
              scale={[0.3, 3.4, 0.3]}
            />
            <mesh
              geometry={POLE_GEO}
              material={MAT_BRIDGE_DARK}
              position={[1.2, 1.7, 0]}
              scale={[0.3, 3.4, 0.3]}
            />
            <mesh
              geometry={UNIT_BOX}
              material={MAT_BRIDGE_DARK}
              position={[0, 0.5, 0]}
              scale={[3.4, 1.0, 1.8]}
            />
          </group>
        </group>
      )}

      {/* ---------------- scattered props ---------------- */}
      <PropField geometry={coneSrc.geo} material={coneSrc.mat} spots={layout.cones} />
      {coneBases.length > 0 && (
        <PropField geometry={CONE_BASE_GEO} material={MAT_CONE_BASE} spots={coneBases} />
      )}
      <PropField geometry={chockSrc.geo} material={chockSrc.mat} spots={layout.chocks} />

      {layout.crates.map(([cx, cz, cr], i) => (
        <PropSlot key={`crate-${i}`} node={gse?.nodes.GSE_EquipmentBox} x={cx} z={cz} rotY={cr}>
          <ProceduralCrate />
        </PropSlot>
      ))}
      {layout.ulds.map(([ux, uz, ur], i) => (
        <PropSlot key={`uld-${i}`} node={gse?.nodes.GSE_ULD} x={ux} z={uz} rotY={ur}>
          <ProceduralUld />
        </PropSlot>
      ))}
    </group>
  );
}

/** Lit window row on the terminal facade, one draw call for the whole block. */
function TerminalWindows({
  spots,
  z,
  w,
  h,
}: {
  spots: [number, number][];
  z: number;
  w: number;
  h: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < spots.length; i++) {
      const [x, y] = spots[i];
      SCRATCH.position.set(x, y, z);
      SCRATCH.rotation.set(0, 0, 0);
      SCRATCH.scale.set(w, h, 1);
      SCRATCH.updateMatrix();
      mesh.setMatrixAt(i, SCRATCH.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [spots, z, w, h]);

  if (spots.length === 0) return null;
  return (
    <instancedMesh
      key={spots.length}
      ref={ref}
      args={[UNIT_PLANE, MAT_WINDOW, spots.length]}
      frustumCulled={false}
    />
  );
}
