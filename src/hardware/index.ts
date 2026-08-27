import { ArduinoProvider } from "./ArduinoProvider";
import { SimulationProvider } from "./SimulationProvider";
import type { HardwareProvider } from "./types";

export * from "./types";
export { SimulationProvider } from "./SimulationProvider";
export { ArduinoProvider } from "./ArduinoProvider";

/**
 * Single place the app resolves its hardware source.
 *
 * Set NEXT_PUBLIC_AEROHALO_HARDWARE=arduino and
 * NEXT_PUBLIC_AEROHALO_UNOQ_URL=ws://<board>:8080/telemetry to run the same
 * dashboard against a physical Arduino UNO Q. With no env vars the simulation
 * provider is used, which is why the demo works with nothing plugged in.
 */
let active: HardwareProvider | null = null;

export function getHardwareProvider(): HardwareProvider {
  if (active) return active;

  const mode = process.env.NEXT_PUBLIC_AEROHALO_HARDWARE;
  const url = process.env.NEXT_PUBLIC_AEROHALO_UNOQ_URL;

  if (mode === "arduino" && url) {
    const p = new ArduinoProvider({ url });
    // Fire and forget - the dashboard keeps running on stale-safe defaults
    // until the board comes up, and reconnects on its own.
    p.connect().catch(() => undefined);
    active = p;
  } else {
    const p = new SimulationProvider();
    p.connect().catch(() => undefined);
    active = p;
  }
  return active;
}

/** Used by tests and by the provider toggle in the simulation controls. */
export function setHardwareProvider(p: HardwareProvider) {
  active = p;
}

