"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Overcast sky and drifting cloud cover.
 *
 * The dome carries a planar cloud layer resolved in the shader, so the clouds
 * keep correct perspective toward the horizon instead of looking like a
 * wallpaper. A matching shadow layer drifts across the apron, which is what
 * actually sells the weather from the elevated camera - at CAM 01 the horizon
 * is out of frame, but the moving shade over the concrete is not.
 */

const TEX = 512;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

let cloudTex: THREE.Texture | null = null;

/** Seamless soft cumulus field, drawn as layered wrap-around blobs. */
function getCloudTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  if (cloudTex) return cloudTex;

  const c = document.createElement("canvas");
  c.width = c.height = TEX;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, TEX, TEX);

  const r = rng(0x1c10ad);
  // Three octaves: broad banks, mid puffs, fine edges.
  const octaves = [
    { count: 16, min: 90, max: 170, alpha: 0.5 },
    { count: 40, min: 40, max: 90, alpha: 0.34 },
    { count: 90, min: 14, max: 40, alpha: 0.22 },
  ];

  ctx.globalCompositeOperation = "lighter";
  for (const o of octaves) {
    for (let i = 0; i < o.count; i++) {
      const x = r() * TEX;
      const y = r() * TEX;
      const rad = o.min + r() * (o.max - o.min);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const cx = x + ox * TEX;
          const cy = y + oy * TEX;
          if (cx + rad < 0 || cx - rad > TEX || cy + rad < 0 || cy - rad > TEX) continue;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
          g.addColorStop(0, `rgba(255,255,255,${o.alpha})`);
          g.addColorStop(0.55, `rgba(255,255,255,${o.alpha * 0.4})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";

  // Push the midtones apart so the field reads as distinct cloud rather than haze.
  const img = ctx.getImageData(0, 0, TEX, TEX);
  for (let i = 0; i < TEX * TEX; i++) {
    const p = i * 4;
    const v = img.data[p] / 255;
    const s = Math.max(0, Math.min(1, (v - 0.3) / 0.5));
    const out = Math.floor(s * s * (3 - 2 * s) * 255);
    img.data[p] = img.data[p + 1] = img.data[p + 2] = out;
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  cloudTex = t;
  return t;
}

/* ------------------------------------------------------------------ */
/* Sky dome                                                            */
/* ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uClouds;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uCloud;
  uniform vec3 uCloudLit;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    vec3 base = mix(uHorizon, uZenith, smoothstep(-0.08, 0.62, h));

    // Intersect the view ray with a flat cloud deck so the layer converges
    // toward the horizon the way real overcast does.
    float t = max(h, 0.035);
    vec2 uv = (d.xz / t) * 0.055 + vec2(uTime * 0.0042, uTime * 0.0019);
    float c = texture2D(uClouds, uv).r;
    float c2 = texture2D(uClouds, uv * 2.1 + vec2(0.37, 0.11) - uTime * 0.0026).r;
    float cover = c * 0.68 + c2 * 0.32;

    // Fade the deck out at the horizon, where haze takes over.
    float band = smoothstep(0.0, 0.26, h);
    vec3 cloudCol = mix(uCloud, uCloudLit, smoothstep(0.35, 0.9, cover));
    vec3 col = mix(base, cloudCol, clamp(cover * band * 0.92, 0.0, 1.0));

    // A little extra murk right on the skyline.
    col = mix(col, uHorizon, smoothstep(0.12, -0.05, h));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function SkyDome({ scale }: { scale: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const clouds = useMemo(() => getCloudTexture(), []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uClouds: { value: clouds },
      // Daylight: pale haze on the skyline lifting to a real blue overhead,
      // with cloud bases in shadow and tops catching the sun.
      uHorizon: { value: new THREE.Color("#bcd3e4") },
      uZenith: { value: new THREE.Color("#2e6fb4") },
      uCloud: { value: new THREE.Color("#9fb0c0") },
      uCloudLit: { value: new THREE.Color("#ffffff") },
    }),
    [clouds]
  );

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[300 * scale, 32, 20]} />
      <shaderMaterial
        ref={mat}
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Cloud shadows on the apron                                          */
/* ------------------------------------------------------------------ */

export function CloudShadows({
  scale,
  width,
  depth,
  centreZ,
}: {
  scale: number;
  width: number;
  depth: number;
  centreZ: number;
}) {
  const clouds = useMemo(() => getCloudTexture(), []);
  const mat = useRef<THREE.MeshBasicMaterial>(null);

  // A separate texture instance so the shadow layer can tile independently of
  // the sky without fighting it over the shared offset.
  const shadowTex = useMemo(() => {
    if (!clouds) return null;
    const t = clouds.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(width / (170 * scale), depth / (170 * scale));
    t.needsUpdate = true;
    return t;
  }, [clouds, width, depth, scale]);

  useFrame((state) => {
    if (!shadowTex) return;
    const t = state.clock.elapsedTime;
    // Drift matched to the sky layer so shade and cloud move together.
    shadowTex.offset.set(t * 0.0042, t * 0.0019);
  });

  if (!shadowTex) return null;

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.018 * scale + 0.004, centreZ]}
      renderOrder={1}
    >
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial
        ref={mat}
        color="#0b1a26"
        alphaMap={shadowTex}
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </mesh>
  );
}
