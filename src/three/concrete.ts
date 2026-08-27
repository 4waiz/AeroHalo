"use client";

import * as THREE from "three";

/**
 * Procedural apron concrete.
 *
 * A flat-coloured ground plane under translucent safety zones reads as a wash
 * of colour - the surface disappears. Real apron concrete has aggregate
 * speckle, pour-to-pour tonal variation, tyre rubber and oil staining, and
 * that detail is what makes the zone overlays look like paint on a surface
 * rather than a tint on the lens.
 *
 * Everything is generated into a canvas at runtime, so no texture files ship
 * and there is nothing to 404. Tiles are drawn with wrap-around so the map
 * repeats seamlessly.
 */

export interface ConcreteTextures {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

const SIZE = 512;

/** Deterministic PRNG so the surface is identical on every reload. */
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

/** Draws a shape at every wrap offset that could touch the tile edge. */
function wrapped(
  x: number,
  y: number,
  reach: number,
  draw: (cx: number, cy: number) => void
) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const cx = x + ox * SIZE;
      const cy = y + oy * SIZE;
      if (cx + reach < 0 || cx - reach > SIZE || cy + reach < 0 || cy - reach > SIZE) continue;
      draw(cx, cy);
    }
  }
}

function buildHeight(seed: number): Float32Array {
  const r = rng(seed);
  const h = new Float32Array(SIZE * SIZE).fill(0.5);

  // Large tonal blotches: individual concrete pours cure at different shades.
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let i = 0; i < 90; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    const rad = 26 + r() * 92;
    const v = 108 + Math.floor(r() * 44);
    wrapped(x, y, rad, (cx, cy) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Aggregate: fine stone speckle just under the surface.
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const n = (r() - 0.5) * 46;
    const p = i * 4;
    img.data[p] = Math.max(0, Math.min(255, img.data[p] + n));
    img.data[p + 1] = img.data[p];
    img.data[p + 2] = img.data[p];
  }
  ctx.putImageData(img, 0, 0);

  const out = ctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) h[i] = out.data[i * 4] / 255;
  return h;
}

let cache: ConcreteTextures | null = null;

export function getConcreteTextures(): ConcreteTextures | null {
  if (typeof document === "undefined") return null;
  if (cache) return cache;

  const height = buildHeight(0x51ab);
  const r = rng(0x9f21);

  /* ---------------- albedo ---------------- */
  const colC = document.createElement("canvas");
  colC.width = colC.height = SIZE;
  const col = colC.getContext("2d", { willReadFrequently: true })!;
  const colImg = col.createImageData(SIZE, SIZE);
  // Base tone, matched to the apron material the markings were authored against.
  const BASE = [96, 102, 108];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const h = height[i];
    const k = 0.74 + h * 0.58;
    const p = i * 4;
    colImg.data[p] = Math.min(255, BASE[0] * k);
    colImg.data[p + 1] = Math.min(255, BASE[1] * k);
    colImg.data[p + 2] = Math.min(255, BASE[2] * k);
    colImg.data[p + 3] = 255;
  }
  col.putImageData(colImg, 0, 0);

  // Rubber deposits and oil staining, darker and slightly warm.
  for (let i = 0; i < 26; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    const rad = 12 + r() * 54;
    wrapped(x, y, rad, (cx, cy) => {
      const g = col.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(38,41,45,${0.2 + r() * 0.24})`);
      g.addColorStop(1, "rgba(38,41,45,0)");
      col.fillStyle = g;
      col.beginPath();
      col.arc(cx, cy, rad, 0, Math.PI * 2);
      col.fill();
    });
  }

  /* ---------------- roughness ---------------- */
  const roughC = document.createElement("canvas");
  roughC.width = roughC.height = SIZE;
  const rough = roughC.getContext("2d", { willReadFrequently: true })!;
  const roughImg = rough.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    // 0.78 - 1.0: polished patches where traffic has worn the surface.
    const v = Math.floor((0.78 + height[i] * 0.22) * 255);
    const p = i * 4;
    roughImg.data[p] = roughImg.data[p + 1] = roughImg.data[p + 2] = v;
    roughImg.data[p + 3] = 255;
  }
  rough.putImageData(roughImg, 0, 0);

  /* ---------------- normal (Sobel over the height field) ---------------- */
  const normC = document.createElement("canvas");
  normC.width = normC.height = SIZE;
  const norm = normC.getContext("2d", { willReadFrequently: true })!;
  const normImg = norm.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) =>
    height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const STRENGTH = 2.1;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * STRENGTH;
      const dy = (at(x, y + 1) - at(x, y - 1)) * STRENGTH;
      const len = Math.hypot(dx, dy, 1);
      const p = (y * SIZE + x) * 4;
      normImg.data[p] = ((-dx / len) * 0.5 + 0.5) * 255;
      normImg.data[p + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      normImg.data[p + 2] = (1 / len) * 0.5 * 255 + 127;
      normImg.data[p + 3] = 255;
    }
  }
  norm.putImageData(normImg, 0, 0);

  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };

  cache = {
    map: mk(colC, true),
    roughnessMap: mk(roughC, false),
    normalMap: mk(normC, false),
  };
  return cache;
}

/** Applies the generated surface to a material, tiled at `metresPerTile`. */
export function applyConcrete(
  mat: THREE.MeshStandardMaterial,
  groundW: number,
  groundD: number,
  metresPerTile = 14
) {
  const tex = getConcreteTextures();
  if (!tex) return;
  const rx = Math.max(1, Math.round(groundW / metresPerTile));
  const ry = Math.max(1, Math.round(groundD / metresPerTile));
  tex.map.repeat.set(rx, ry);
  tex.roughnessMap.repeat.set(rx, ry);
  tex.normalMap.repeat.set(rx, ry);
  mat.map = tex.map;
  mat.roughnessMap = tex.roughnessMap;
  mat.normalMap = tex.normalMap;
  mat.normalScale = new THREE.Vector2(0.55, 0.55);
  // The map already carries the base tone, so stop the flat colour doubling it.
  mat.color.set("#ffffff");
  mat.needsUpdate = true;
}
