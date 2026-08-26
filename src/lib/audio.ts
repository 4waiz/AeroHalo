"use client";

import type { AudioCue } from "@/sim/SimulationEngine";

/**
 * Small synthesised alert set.
 *
 * Tones are generated with WebAudio rather than shipped as files: it keeps the
 * bundle clean, guarantees no missing-asset failures, and lets the cues stay
 * short and quiet enough to live under a running dashboard.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlay = 0;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Browsers require a gesture before audio can start. */
export function unlockAudio() {
  ensure();
}

function blip(
  at: number,
  freq: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 1
) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  // Short attack, exponential tail - reads as an instrument panel tone rather
  // than a game sound effect.
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function sweep(at: number, from: number, to: number, dur: number, gain = 0.9) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function playCue(cue: AudioCue) {
  const c = ensure();
  if (!c) return;
  // Rate limit so a burst of alerts cannot turn into noise.
  const now = performance.now();
  if (now - lastPlay < 260) return;
  lastPlay = now;

  const t = c.currentTime + 0.01;
  switch (cue) {
    case "chirp":
      blip(t, 660, 0.07, "sine", 0.5);
      break;
    case "warn":
      blip(t, 880, 0.09, "triangle", 0.8);
      blip(t + 0.14, 880, 0.09, "triangle", 0.8);
      break;
    case "critical":
      blip(t, 1180, 0.075, "square", 0.55);
      blip(t + 0.115, 1180, 0.075, "square", 0.55);
      blip(t + 0.23, 1180, 0.11, "square", 0.6);
      break;
    case "clear":
      sweep(t, 620, 980, 0.24, 0.6);
      break;
  }
}

export function setVolume(v: number) {
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}
