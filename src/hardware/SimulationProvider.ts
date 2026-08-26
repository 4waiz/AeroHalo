import type {
  BuzzerPattern,
  CameraFrameInfo,
  DistanceReading,
  EmergencyStopState,
  EnvironmentReading,
  HardwareProvider,
  LedCommand,
  LinkState,
  ProviderId,
} from "./types";
import { CAMERA_FLEET } from "@/sim/constants";
import { clamp, makeRng } from "@/sim/geometry";

/**
 * Sensor values synthesised from the running simulation.
 *
 * The provider does not invent numbers out of nowhere: the simulation engine
 * pushes the real world state in via `feed()`, and this class shapes it into
 * the same readings a physical sensor ring would produce, including noise,
 * quantisation and the occasional dropout.
 */
export class SimulationProvider implements HardwareProvider {
  readonly id: ProviderId = "simulation";
  readonly label = "Simulation (on-device)";

  private link: LinkState = "online";
  private rng = makeRng(0x5eed1234);
  private estop: EmergencyStopState = { engaged: false, reason: "", at: 0 };
  private led: LedCommand = { colour: "green", blinkHz: 0 };
  private buzzer: BuzzerPattern = "off";

  /** Latest truth pushed in by the simulation engine. */
  private truth = {
    clock: 0,
    distances: new Map<string, number>(),
    cameraQuality: 100,
    cameraLatency: 42,
    detections: 0,
    degraded: 0,
    temperatureC: 24,
    windKt: 7,
  };

  feed(state: Partial<typeof this.truth> & { distances?: Map<string, number> }) {
    Object.assign(this.truth, state);
  }

  getLinkState() {
    return this.link;
  }

  async connect() {
    this.link = "online";
  }

  async disconnect() {
    this.link = "offline";
  }

  private noise(scale: number) {
    return (this.rng() - 0.5) * 2 * scale;
  }

  async readDistance(sensorId: string): Promise<DistanceReading> {
    const raw = this.truth.distances.get(sensorId);
    const inRange = raw !== undefined && raw < 42;
    // A real ultrasonic ring loses confidence with distance.
    const quality = inRange ? clamp(1 - (raw as number) / 55, 0.25, 1) : 0.2;
    return {
      sensorId,
      distance: inRange ? Math.max(0.02, (raw as number) + this.noise(0.06)) : Infinity,
      quality,
      at: this.truth.clock,
    };
  }

  async readAllDistances(): Promise<DistanceReading[]> {
    const out: DistanceReading[] = [];
    for (const id of this.truth.distances.keys()) out.push(await this.readDistance(id));
    return out;
  }

  async readEnvironment(): Promise<EnvironmentReading> {
    return {
      temperatureC: this.truth.temperatureC + this.noise(0.12),
      humidityPct: 61 + this.noise(1.5),
      pressureHpa: 1013 + this.noise(0.6),
      windKt: Math.max(0, this.truth.windKt + this.noise(0.8)),
      windDirDeg: 214 + this.noise(6),
      condition: "Overcast",
      at: this.truth.clock,
    };
  }

  async setWarningLed(cmd: LedCommand) {
    this.led = cmd;
  }

  getWarningLed() {
    return this.led;
  }

  async setBuzzer(pattern: BuzzerPattern) {
    this.buzzer = pattern;
  }

  getBuzzer() {
    return this.buzzer;
  }

  async setEmergencyStop(engaged: boolean, reason: string) {
    this.estop = { engaged, reason, at: this.truth.clock };
    return this.estop;
  }

  getEmergencyStop() {
    return this.estop;
  }

  async readCameraFeeds(): Promise<CameraFrameInfo[]> {
    const degraded = this.truth.degraded;
    return CAMERA_FLEET.map((c, i) => {
      const off = i < degraded;
      return {
        cameraId: c.id,
        online: !off,
        quality: off ? 0 : clamp(this.truth.cameraQuality + this.noise(1.4), 0, 100),
        latencyMs: Math.round(this.truth.cameraLatency + this.noise(6)),
        detections: this.truth.detections,
      };
    });
  }
}
