/**
 * Resizes and re-encodes one texture. Invoked as a child process by
 * optimize-models.mjs.
 *
 * This runs in its own process on purpose. When sharp is loaded into the same
 * process as the glTF toolchain, libvips fails to resolve the colourspace of
 * these scans' PNGs and every encode dies with "colourspace: parameter space
 * not set". The identical bytes encode fine in a process that imports nothing
 * but sharp, so the work is isolated here. The cost is one short-lived process
 * per texture in a build script, which is not worth optimising away.
 *
 *   node scripts/encode-texture.mjs <in.png> <out.jpg> [maxEdge] [quality]
 */

import sharp from "sharp";

const [, , inPath, outPath, sizeArg, qualityArg] = process.argv;

if (!inPath || !outPath) {
  console.error("usage: encode-texture.mjs <in> <out> [maxEdge] [quality]");
  process.exit(2);
}

const maxEdge = Number(sizeArg) || 1024;
const quality = Number(qualityArg) || 82;

await sharp(inPath)
  .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
  // No .flatten(): compositing a background needs a resolved colourspace.
  // JPEG drops alpha on its own, and these scans are all OPAQUE.
  .jpeg({ quality, mozjpeg: true })
  .toFile(outPath);
