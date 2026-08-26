/**
 * Optimises the downloaded crew scans into web-ready GLBs.
 *
 * The Sketchfab captures are ~300k triangles and ~29 MB each, with 2048px
 * textures and metallic = 1 (which renders as a black silhouette in a real-time
 * PBR scene). On the apron these figures are 15-40 m from the camera, so all
 * that matters is silhouette and clothing colour.
 *
 * Inputs live in raw_models/ and are NOT committed - public/models/ holds the
 * optimised output the app actually serves. If raw_models/ is absent (a fresh
 * clone), each entry is skipped with a note rather than failing the run.
 *
 *   node scripts/optimize-models.mjs
 */

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  simplify,

  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";



const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const ENCODER = path.join(here, "encode-texture.mjs");

const JOBS = [
  {
    in: "raw_models/blue_collar_worker_in_overalls.glb",
    out: "public/models/worker_blue.glb",
    label: "blue collar worker",
  },
  {
    in: "raw_models/construction_worker_in_reflective_safety_gear.glb",
    out: "public/models/worker_hivis.glb",
    label: "hi-vis construction worker",
  },
];

/** Fraction of the original triangles to keep. */
const TARGET_RATIO = 0.04;
/** Allowed geometric error, as a fraction of mesh extent. */
const TARGET_ERROR = 0.02;
/** Longest texture edge after resizing. */
const TEXTURE_SIZE = 1024;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function triangles(document) {
  let n = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      n += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
    }
  }
  return Math.round(n);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

await MeshoptSimplifier.ready;

let anyRun = false;

for (const job of JOBS) {
  const src = path.join(root, job.in);
  const dst = path.join(root, job.out);

  if (!fs.existsSync(src)) {
    console.log(`- skip  ${job.label}: ${job.in} not present`);
    continue;
  }
  anyRun = true;

  const beforeBytes = fs.statSync(src).size;
  const document = await io.read(src);
  const beforeTris = triangles(document);

  // Scans export at metallic 1, which kills them under real lighting.
  for (const material of document.getRoot().listMaterials()) {
    material.setMetallicFactor(0);
    material.setRoughnessFactor(0.78);
    material.setDoubleSided(false);
  }

  // Textures dominate the file: four 2048px PNGs against ~15k triangles of
  // geometry. These figures are 15-40 m from the camera, so 1024px JPEG is
  // indistinguishable and roughly fifty times smaller.
  //
  // Each texture is encoded by a child process; see encode-texture.mjs for why
  // sharp cannot run in this process alongside the glTF toolchain.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aerohalo-tex-"));
  let texIn = 0;
  let texOut = 0;
  try {
    const textures = document.getRoot().listTextures();
    for (let i = 0; i < textures.length; i++) {
      const texture = textures[i];
      const image = texture.getImage();
      if (!image) continue;

      const srcPath = path.join(tmpDir, `t${i}.png`);
      const outPath = path.join(tmpDir, `t${i}.jpg`);
      fs.writeFileSync(srcPath, image);
      try {
        execFileSync(
          process.execPath,
          [ENCODER, srcPath, outPath, String(TEXTURE_SIZE), "82"],
          { stdio: ["ignore", "ignore", "pipe"] }
        );
        const encoded = fs.readFileSync(outPath);
        texIn += image.byteLength;
        texOut += encoded.byteLength;
        texture.setImage(new Uint8Array(encoded)).setMimeType("image/jpeg");
        const uri = texture.getURI();
        if (uri) texture.setURI(uri.replace(/\.[^.]+$/, ".jpg"));
      } catch (err) {
        console.log(`    ! texture kept as-is: ${err.message}`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  if (texIn) {
    console.log(`    textures ${mb(texIn)} -> ${kb(texOut)}`);
  }

  await document.transform(
    dedup(),
    // Welding first is what lets the simplifier collapse across seams.
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: TARGET_RATIO,
      error: TARGET_ERROR,
      lockBorder: false,
    }),
    prune({ keepAttributes: false, keepLeaves: false })
  );

  await io.write(dst, document);

  const afterBytes = fs.statSync(dst).size;
  const afterTris = triangles(document);
  console.log(
    `- ${job.label}\n` +
      `    tris  ${beforeTris.toLocaleString()} -> ${afterTris.toLocaleString()}` +
      `  (${((afterTris / beforeTris) * 100).toFixed(1)}%)\n` +
      `    size  ${mb(beforeBytes)} -> ${afterBytes < 1024 * 1024 ? kb(afterBytes) : mb(afterBytes)}` +
      `  (${((afterBytes / beforeBytes) * 100).toFixed(1)}%)`
  );
}

if (!anyRun) {
  console.log(
    "\nNothing to do. Place the source scans in raw_models/ to regenerate " +
      "the crew GLBs; public/models/ already holds the optimised output."
  );
}
