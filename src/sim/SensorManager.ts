import type { CameraFeed, Sensor, Vec2 } from "./types";
import type { Airframe } from "./aircraftTypes";
import { CAMERA_FLEET, buildSensors } from "./constants";
import { clamp, damp, dist, makeRng } from "./geometry";
import type { HardwareProvider } from "@/hardware/types";
import { SimulationProvider } from "@/hardware/SimulationProvider";

/**
 * Owns the proximity ring and the camera fleet.
 *
 * When the simulation provider is active this class computes what each sensor
 * would actually see - the range to the nearest tracked object - and pushes
 * that into the provider, which adds noise and hands it back. With
 * ArduinoProvider the same call path reads real hardware instead.
 */
export class SensorManager {
  sensors: Sensor[] = [];
  cameras: CameraFeed[] = [];

  /** Rolling AI metrics shown in System Summary. */
  inferenceAccuracy = 98.2;
  responseMs = 256;

  private rng = makeRng(0xa11ce);
  private provider: HardwareProvider;
  private degraded = 0;
  private nextWobble = 0;

  constructor(af: Airframe, provider: HardwareProvider) {
    this.provider = provider;
    this.setAirframe(af);
    this.cameras = CAMERA_FLEET.map((c) => ({
      id: c.id,
      label: c.label,
      online: true,
      quality: 99,
      latencyMs: 41,
    }));
  }

  setAirframe(af: Airframe) {
    this.sensors = buildSensors(af);
  }

  setProvider(p: HardwareProvider) {
    this.provider = p;
  }

  get onlineCount() {
    return this.sensors.filter((s) => s.online).length;
  }

  get total() {
    return this.sensors.length;
  }

  get camerasOnline() {
    return this.cameras.filter((c) => c.online).length;
  }

  /** Mean quality across the fleet, shown as Camera Feed Health. */
  get cameraHealth() {
    if (!this.cameras.length) return 0;
    const sum = this.cameras.reduce((a, c) => a + (c.online ? c.quality : 0), 0);
    return Math.round(sum / this.cameras.length);
  }

  /**
   * @param targets every tracked object position, used to synthesise ranges
   * @param load    number of live detections, which drives inference latency
   */
  update(clock: number, dt: number, targets: Vec2[], load: number, hazardPeak: number) {
    // Range each sensor to the nearest tracked object.
    const distances = new Map<string, number>();
    for (const s of this.sensors) {
      let best = Infinity;
      for (const t of targets) {
        const d = dist(s.position, t);
        if (d < best) best = d;
      }
      distances.set(s.id, best);
      s.value = Number.isFinite(best) ? best : 0;
    }

    if (this.provider instanceof SimulationProvider) {
      this.provider.feed({
        clock,
        distances,
        detections: load,
        degraded: this.degraded,
        cameraQuality: 99 - this.degraded * 6,
        cameraLatency: 38 + load * 1.6 + hazardPeak * 2.4,
        temperatureC: 24,
        windKt: 7,
      });
    }

    // Health drifts slightly; a sensor never silently reports a stale value.
    for (const s of this.sensors) {
      const target = s.online ? clamp(97 + this.rng() * 3, 90, 100) : 0;
      s.health = damp(s.health, target, 0.6, dt);
    }

    // The vision pipeline slows down under load and when the scene is busy.
    const targetMs = 196 + load * 3.4 + hazardPeak * 4.2 + this.degraded * 34;
    this.responseMs = damp(this.responseMs, targetMs, 1.1, dt);

    const targetAcc = clamp(99.1 - load * 0.13 - hazardPeak * 0.09 - this.degraded * 1.6, 88, 99.4);
    this.inferenceAccuracy = damp(this.inferenceAccuracy, targetAcc, 0.75, dt);

    // Occasional harmless jitter so the numbers are never frozen.
    if (clock > this.nextWobble) {
      this.nextWobble = clock + 2600 + this.rng() * 3200;
      for (const c of this.cameras) {
        if (c.online) {
          c.quality = clamp(96 + this.rng() * 4, 90, 100);
          c.latencyMs = Math.round(36 + this.rng() * 12 + load * 1.2);
        }
      }
    }
  }

  /** Degrades N cameras - used by the multi-hazard scenario. */
  degradeCameras(n: number) {
    this.degraded = clamp(n, 0, this.cameras.length);
    this.cameras.forEach((c, i) => {
      c.online = i >= this.degraded;
      if (!c.online) c.quality = 0;
    });
  }

  /** Takes N sensors offline. */
  degradeSensors(n: number) {
    this.sensors.forEach((s, i) => {
      s.online = i >= n;
      if (!s.online) s.health = 0;
    });
  }

  restoreAll() {
    this.degraded = 0;
    this.cameras.forEach((c) => {
      c.online = true;
      c.quality = 99;
    });
    this.sensors.forEach((s) => {
      s.online = true;
      s.health = 98;
    });
  }
}
