"use client";

import { useMemo } from "react";
import * as THREE from "three";
import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  Noise,
  Scanline,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";

/**
 * Makes the 3D feed read as footage from a real apron camera rather than a
 * clean render.
 *
 * The stack is deliberately restrained - each effect is doing one job that a
 * physical camera actually does:
 *   Bloom              floodlights, beacons and exhaust blooming in the lens
 *   ChromaticAberration cheap wide-angle glass splitting colour at the edges
 *   Scanline + Noise   sensor grain and the interlace of a streamed feed
 *   Vignette           lens falloff
 *   Brightness/Sat     the flat, slightly desaturated look of a security codec
 */
export function CameraFeed() {
  const caOffset = useMemo(() => new THREE.Vector2(0.00055, 0.00038), []);

  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <Bloom
        mipmapBlur
        intensity={0.42}
        luminanceThreshold={0.86}
        luminanceSmoothing={0.16}
        radius={0.55}
      />
      <ChromaticAberration
        offset={caOffset}
        radialModulation
        modulationOffset={0.42}
        blendFunction={BlendFunction.NORMAL}
      />
      <Scanline
        density={1.42}
        opacity={0.05}
        blendFunction={BlendFunction.OVERLAY}
      />
      <Noise premultiply opacity={0.058} blendFunction={BlendFunction.OVERLAY} />
      <BrightnessContrast brightness={0.018} contrast={0.1} />
      <HueSaturation saturation={-0.07} hue={0} />
      <Vignette offset={0.42} darkness={0.4} eskil={false} />
    </EffectComposer>
  );
}
