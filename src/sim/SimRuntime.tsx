"use client";

import { useEffect, useRef } from "react";
import { UI_HZ } from "./constants";
import { getEngine, useSim } from "./store";
import { playCue, unlockAudio } from "@/lib/audio";

/**
 * Drives the simulation.
 *
 * One requestAnimationFrame loop advances the engine with real elapsed time and
 * publishes a snapshot at UI_HZ. Nothing else in the app owns a timer, which is
 * what keeps the dashboard coherent - every card is reading the same tick.
 */
export function SimRuntime() {
  const publish = useSim((s) => s.publish);
  const setAirlinerAvailable = useSim((s) => s.setAirlinerAvailable);
  const togglePresentation = useSim((s) => s.togglePresentation);
  const toggleDebug = useSim((s) => s.toggleDebug);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const engine = getEngine();
    engine.onAudio = (cue) => playCue(cue);

    // Dev handle: lets the engine be inspected and stepped from the console,
    // which is how the scenario and demo timings get verified.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __aeroHalo?: unknown }).__aeroHalo = {
        engine,
        store: useSim,
      };
    }

    // Reflect any pre-existing engine flags into the store.
    useSim.setState({
      autoStop: engine.autoStop,
      autoTracking: engine.autoTracking,
      muted: engine.muted,
      airframeId: engine.airframeId,
    });

    // Demo mode from the query string.
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "true" || params.get("demo") === "1") {
      engine.startDemo();
    }
    if (params.get("present") === "true") {
      useSim.setState({ presentation: true });
    }

    // Only offer the airliner once its GLB is actually on disk.
    fetch("/models/airliner.glb", { method: "HEAD" })
      .then((r) => setAirlinerAvailable(r.ok))
      .catch(() => setAirlinerAvailable(false));

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const publishEvery = 1000 / UI_HZ;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;

      engine.tick(dt);

      acc += dt;
      if (acc >= publishEvery) {
        acc = 0;
        publish(engine.snapshot());
      }
    };
    raf = requestAnimationFrame(loop);

    // Publish once immediately so the first paint is never empty.
    publish(engine.snapshot());

    return () => cancelAnimationFrame(raf);
  }, [publish, setAirlinerAvailable]);

  /* ---- keyboard shortcuts ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "p":
          e.preventDefault();
          togglePresentation();
          break;
        case "d":
          e.preventDefault();
          toggleDebug();
          break;
        case "m":
          e.preventDefault();
          useSim.getState().toggleMute();
          break;
        case "c":
          e.preventDefault();
          useSim.getState().setControlsOpen(!useSim.getState().controlsOpen);
          break;
        case "escape":
          useSim.setState({ fullLogOpen: false, controlsOpen: false });
          useSim.getState().clearFocus();
          break;
        case "1":
          useSim.getState().setCamera("CAM 01");
          break;
        case "2":
          useSim.getState().setCamera("CAM 02");
          break;
        case "3":
          useSim.getState().setCamera("CAM 03");
          break;
        case "4":
          useSim.getState().setCamera("CAM 04");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePresentation, toggleDebug]);

  /* ---- audio needs a gesture before it can start ---- */
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  return null;
}
