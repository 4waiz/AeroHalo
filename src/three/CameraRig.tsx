"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Airframe } from "@/sim/aircraftTypes";
import { buildCameraPresets } from "@/sim/constants";
import { getEngine, useSim } from "@/sim/store";

type OC = React.ComponentRef<typeof OrbitControls>;

const tmp = new THREE.Vector3();
const scratch = new THREE.Vector3();
const goalScratch = new THREE.Vector3();

/**
 * Surveillance camera behaviour.
 *
 * Presets move with a cinematic ease rather than a cut, auto tracking nudges
 * only the look-at point toward the highest-risk object (never yanking the
 * whole camera), and a manual drag immediately takes precedence - the operator
 * always wins over the automation.
 */
export function CameraRig({ af }: { af: Airframe }) {
  const controls = useRef<OC>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const engine = useMemo(() => getEngine(), []);

  const cameraId = useSim((s) => s.cameraId);
  const viewNonce = useSim((s) => s.viewNonce);
  const zoomNonce = useSim((s) => s.zoomNonce);
  const autoTracking = useSim((s) => s.autoTracking);
  const focus = useSim((s) => s.focus);

  const presets = useMemo(() => buildCameraPresets(af), [af]);

  const goalPos = useRef(new THREE.Vector3());
  const goalTarget = useRef(new THREE.Vector3());
  const goalFov = useRef(34);
  const transitioning = useRef(false);
  const dragging = useRef(false);
  /** Blocks automation for a moment after the operator lets go. */
  const manualUntil = useRef(0);
  /** Auto-tracking offset applied on top of the preset look-at point. */
  const trackOffset = useRef(new THREE.Vector3());

  /* ---- jump to a preset ---- */
  useEffect(() => {
    const p = presets[cameraId];
    goalPos.current.set(...p.position);
    goalTarget.current.set(...p.target);
    goalFov.current = p.fov;
    transitioning.current = true;
    trackOffset.current.set(0, 0, 0);
  }, [cameraId, viewNonce, presets]);

  /* ---- initial placement without an animation ---- */
  useEffect(() => {
    const p = presets["CAM 01"];
    camera.position.set(...p.position);
    camera.fov = p.fov;
    camera.updateProjectionMatrix();
    if (controls.current) {
      controls.current.target.set(...p.target);
      controls.current.update();
    }
    // Only on mount / airframe change.
  }, [af, camera, presets]);

  /* ---- zoom buttons ---- */
  useEffect(() => {
    if (zoomNonce === 0) return;
    const delta = useSim.getState().zoomDelta;
    const c = controls.current;
    if (!c) return;
    tmp.copy(camera.position).sub(c.target);
    const len = tmp.length();
    const next = THREE.MathUtils.clamp(
      len * (delta > 0 ? 0.82 : 1.22),
      6 * af.worldScale,
      90 * af.worldScale
    );
    tmp.setLength(next);
    goalPos.current.copy(c.target).add(tmp);
    goalTarget.current.copy(c.target);
    transitioning.current = true;
  }, [zoomNonce, camera, af]);

  useFrame((state, rawDelta) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDelta, 0.1);
    const now = state.clock.elapsedTime;

    if (dragging.current) {
      transitioning.current = false;
      manualUntil.current = now + 3.5;
    } else if (transitioning.current) {
      // Preset / zoom transition.
      const k = 1 - Math.exp(-3.6 * dt);
      camera.position.lerp(goalPos.current, k);
      c.target.lerp(goalTarget.current, k);
      if (Math.abs(camera.fov - goalFov.current) > 0.05) {
        camera.fov += (goalFov.current - camera.fov) * k;
        camera.updateProjectionMatrix();
      }
      if (
        camera.position.distanceTo(goalPos.current) < 0.12 * af.worldScale &&
        c.target.distanceTo(goalTarget.current) < 0.12 * af.worldScale
      ) {
        transitioning.current = false;
      }
      c.update();
    } else if (now >= manualUntil.current) {
      /* ---- automation: focus request, then auto tracking ---- */
      const preset = presets[useSim.getState().cameraId];
      const base = tmp.set(...preset.target);

      let desired: THREE.Vector3 | null = null;
      let strength = 0;

      const focusReq = focus;
      if (focusReq && engine.clock - focusReq.at < 9000) {
        const p = engine.registry.locate(focusReq.id);
        if (p) {
          desired = scratch.set(p.x, 1.2 * af.worldScale, p.z);
          strength = 0.85;
        }
      } else if (autoTracking) {
        const hot = engine.focusPoint();
        if (hot && hot.risk >= 3.4) {
          desired = scratch.set(hot.p.x, 1.0 * af.worldScale, hot.p.z);
          // Never fully hand the frame over to the hazard - the aircraft stays
          // the subject, the camera only leans toward the incident.
          strength = THREE.MathUtils.clamp((hot.risk - 3.4) / 6, 0, 1) * 0.5;
        }
      }

      goalScratch.copy(base);
      if (desired) goalScratch.lerp(desired, strength);

      // Gentle, heavily damped - this must never feel like it snaps.
      c.target.lerp(goalScratch, 1 - Math.exp(-1.35 * dt));
      c.update();
    }

    /* ---- mast vibration ----
       A pole-mounted apron camera is never perfectly still. This is applied
       after OrbitControls has written the orientation, and because the
       controls recompute the look-at every frame it can never accumulate. */
    const yaw =
      Math.sin(now * 1.13) * 0.00042 +
      Math.sin(now * 2.71 + 1.7) * 0.00026 +
      Math.sin(now * 0.37) * 0.00055;
    const pitch =
      Math.sin(now * 1.61 + 0.9) * 0.00034 +
      Math.sin(now * 3.19) * 0.00019 +
      Math.sin(now * 0.29 + 2.2) * 0.00041;
    camera.rotateY(yaw);
    camera.rotateX(pitch);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableZoom
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.42}
      zoomSpeed={0.7}
      panSpeed={0.5}
      minDistance={6 * af.worldScale}
      maxDistance={92 * af.worldScale}
      // Keep the feed above the horizon: a surveillance mast never looks up.
      minPolarAngle={0.16}
      maxPolarAngle={Math.PI / 2 - 0.045}
      target={[0, 1.5 * af.worldScale, 0]}
      onStart={() => {
        dragging.current = true;
      }}
      onEnd={() => {
        dragging.current = false;
      }}
    />
  );
}
