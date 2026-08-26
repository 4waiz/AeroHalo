"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

export interface LoadedModel {
  scene: THREE.Group;
  /** Named nodes, so a multi-object GLB can be picked apart. */
  nodes: Record<string, THREE.Object3D>;
  /** World-space bounding box of the whole file. */
  box: THREE.Box3;
}

const cache = new Map<string, Promise<LoadedModel | null>>();

function buildLoader() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  // Served by three's own CDN-free copy in node_modules is not available at
  // runtime, so point at the standard decoder path; uncompressed files simply
  // never touch it.
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
  loader.setDRACOLoader(draco);
  return loader;
}

/**
 * Loads a GLB without ever suspending, and resolves to null when the file is
 * absent. The dashboard must keep running with a missing optional asset rather
 * than throwing a Suspense error into the canvas.
 */
function load(url: string): Promise<LoadedModel | null> {
  const hit = cache.get(url);
  if (hit) return hit;

  const p = fetch(url, { method: "HEAD" })
    .then((r) => {
      if (!r.ok) return null;
      return new Promise<LoadedModel | null>((resolve) => {
        buildLoader().load(
          url,
          (gltf) => {
            const scene = gltf.scene as THREE.Group;
            const nodes: Record<string, THREE.Object3D> = {};
            scene.traverse((o) => {
              if (o.name) nodes[o.name] = o;
              const m = o as THREE.Mesh;
              if (m.isMesh) {
                m.castShadow = true;
                m.receiveShadow = true;
              }
            });
            const box = new THREE.Box3().setFromObject(scene);
            resolve({ scene, nodes, box });
          },
          undefined,
          () => resolve(null)
        );
      });
    })
    .catch(() => null);

  cache.set(url, p);
  return p;
}

export function useOptionalGLTF(url: string): LoadedModel | null {
  const [model, setModel] = useState<LoadedModel | null>(null);

  useEffect(() => {
    let alive = true;
    load(url).then((m) => {
      if (alive) setModel(m);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return model;
}

/** Deep clone that keeps materials shared, for instancing props cheaply. */
export function cloneNode(node: THREE.Object3D): THREE.Object3D {
  const c = node.clone(true);
  c.position.set(0, 0, 0);
  c.rotation.set(0, 0, 0);
  c.scale.set(1, 1, 1);
  return c;
}
