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
  box: HTMLElement | null;
}

const nodes = new Map<string, OverlayNode>();

export function registerOverlay(id: string, root: HTMLElement | null, box: HTMLElement | null) {
  if (!root) nodes.delete(id);
  else nodes.set(id, { root, box });
}

export function getOverlayNode(id: string) {
  return nodes.get(id);
}

export function overlayIds() {
  return nodes.keys();
}

export function clearOverlays() {
  nodes.clear();
}
