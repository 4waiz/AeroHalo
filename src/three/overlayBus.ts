/**
 * Bridge between the HTML detection overlays and the 3D projector.
 *
 * The overlay cards are real DOM nodes (so they can use the same typography and
 * Tailwind tokens as the rest of the dashboard), but their screen positions are
 * computed inside the render loop from live world coordinates. Writing straight
 * to `style.transform` through this map keeps the boxes locked to their objects
 * without re-rendering React every frame.
 */

export interface OverlayNode {
  root: HTMLElement;
  /** The label card, measured once so overlap tests use its real size. */
  panel: HTMLElement | null;
  w: number;
  h: number;
}

const nodes = new Map<string, OverlayNode>();

export function registerOverlay(id: string, root: HTMLElement | null, panel: HTMLElement | null) {
  if (!root) nodes.delete(id);
  else nodes.set(id, { root, panel, w: 0, h: 0 });
}

export function getOverlayNode(id: string) {
  return nodes.get(id);
}

