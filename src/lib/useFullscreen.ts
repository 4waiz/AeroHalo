"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Fullscreen for a 3D view, shared by the simulation and the live feed.
 *
 * Prefers the real Fullscreen API so the canvas gets the whole display and the
 * browser chrome gets out of the way during a demo.
 *
 * It falls back to a CSS overlay when the browser refuses. That is not
 * hypothetical: `requestFullscreen` rejects with "Permissions check failed"
 * under a Permissions-Policy, inside a sandboxed iframe, and in some managed
 * or automated browser profiles. The previous code swallowed that rejection,
 * so the button did nothing and gave no reason - which is the single worst
 * outcome to have on stage. Filling the viewport is a weaker result than true
 * fullscreen, but it is a visible one, and the control always responds.
 *
 * `F` toggles. Escape exits either mode - the browser handles it for real
 * fullscreen, and the key handler covers the fallback.
 */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [native, setNative] = useState(false);
  const [fallback, setFallback] = useState(false);
  const full = native || fallback;

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (fallback) {
      setFallback(false);
      return;
    }
    const el = ref.current;
    if (!el?.requestFullscreen) {
      setFallback(true);
      return;
    }
    // Both arms are load-bearing. A Permissions-Policy denial THROWS
    // synchronously ("TypeError: Permissions check failed") and never reaches
    // a .catch, while a missing user gesture rejects the promise instead.
    // Handling only the promise is what made this button look dead.
    try {
      const p = el.requestFullscreen();
      if (p) void p.catch(() => setFallback(true));
    } catch {
      setFallback(true);
    }
  }, [fallback]);

  // Driven by the event, never by the click: the browser can leave fullscreen
  // on its own (Escape, tab switch) and the label has to follow.
  useEffect(() => {
    const onChange = () => setNative(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      if (e.key === "f" || e.key === "F") toggle();
      // Only the fallback needs this. Real fullscreen never delivers Escape to
      // the page, so there is no double handling to guard against.
      if (e.key === "Escape" && fallback) setFallback(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, fallback]);

  /* An inline style, deliberately, not a Tailwind class.
   *
   * The shells this attaches to carry `.panel`, which sets `position: relative`
   * from globals.css. That rule is unlayered, and unlayered declarations beat
   * anything in a cascade layer - which is where Tailwind's utilities live. So
   * `fixed` lost to `.panel` no matter where it sat in the class attribute:
   * the class list read correctly and the element never moved. Inline styles
   * sit above every layer and end the argument. */
  const overlayStyle: CSSProperties | undefined = fallback
    ? { position: "fixed", inset: 0, zIndex: 120, borderRadius: 0 }
    : undefined;

  return { ref, full, toggle, overlayStyle };
}
