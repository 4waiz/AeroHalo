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

/**
 * Arduino UNO Q transport.
 *
 * The UNO Q pairs a Linux-capable MPU with an STM32 MCU, so the intended
 * deployment is: the MCU samples the proximity ring and drives the beacon,
 * buzzer and emergency-stop relay; the MPU runs a small bridge that speaks the
 * JSON line protocol below over a WebSocket (or Web Serial when the board is
 * plugged straight into the operator laptop).
 *
 * Wire protocol - newline-delimited JSON, both directions:
 *   ->  {"t":"hello","v":1}
 *   <-  {"t":"dist","id":"SEN-01","d":12.44,"q":0.91}
 *   <-  {"t":"env","tc":24.1,"h":61,"p":1013,"wkt":7.2,"wdir":214}
 *   <-  {"t":"cam","id":"CAM-01","up":1,"q":98,"ms":41,"n":6}
 *   <-  {"t":"estop","on":1,"why":"ttc<3.4"}
 *   ->  {"t":"led","c":"red","hz":2}
 *   ->  {"t":"buz","p":"critical"}
 *   ->  {"t":"estop","on":1,"why":"AeroHalo auto-stop"}
 *
 * Nothing here is called by the demo. It exists so the dashboard can be pointed
 * at real hardware without reworking the layers above it.
 */

export interface ArduinoProviderOptions {
  /** e.g. "ws://uno-q.local:8080/telemetry" */
  url: string;
  /** Milliseconds between reconnect attempts. */
  reconnectMs?: number;
  /** Drop readings older than this, so a stalled link degrades visibly. */
  stalenessMs?: number;
}

export class ArduinoProvider implements HardwareProvider {
  readonly id: ProviderId = "arduino";
  readonly label = "Arduino UNO Q";

  private opts: Required<ArduinoProviderOptions>;
  private socket: WebSocket | null = null;
  private link: LinkState = "offline";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private distances = new Map<string, DistanceReading>();
  private cameras = new Map<string, CameraFrameInfo>();
  private env: EnvironmentReading | null = null;
  private estop: EmergencyStopState = { engaged: false, reason: "", at: 0 };

  constructor(opts: ArduinoProviderOptions) {
    this.opts = {
      reconnectMs: 2500,
      stalenessMs: 4000,
      ...opts,
    };
  }

  getLinkState() {
    return this.link;
  }

  connect(): Promise<void> {
    if (typeof WebSocket === "undefined") {
      this.link = "error";
      return Promise.reject(new Error("WebSocket unavailable in this runtime"));
    }
    return new Promise((resolve, reject) => {
      this.link = "connecting";
      const ws = new WebSocket(this.opts.url);
      this.socket = ws;

      ws.onopen = () => {
        this.link = "online";
        this.send({ t: "hello", v: 1 });
        resolve();
      };
      ws.onmessage = (ev) => this.ingest(ev.data);
      ws.onerror = () => {
        this.link = "error";
        reject(new Error("UNO Q link error"));
      };
      ws.onclose = () => {
        this.link = "offline";
        this.scheduleReconnect();
      };
    });
  }

  async disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.link = "offline";
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => this.scheduleReconnect());
    }, this.opts.reconnectMs);
  }

  private send(payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  /** Parses one newline-delimited JSON frame from the board. */
  private ingest(raw: unknown) {
    if (typeof raw !== "string") return;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const now = Date.now();
      switch (msg.t) {
        case "dist":
          this.distances.set(String(msg.id), {
            sensorId: String(msg.id),
            distance: Number(msg.d),
            quality: Number(msg.q ?? 1),
            at: now,
          });
          break;
        case "env":
          this.env = {
            temperatureC: Number(msg.tc),
            humidityPct: Number(msg.h),
            pressureHpa: Number(msg.p),
            windKt: Number(msg.wkt),
            windDirDeg: Number(msg.wdir),
            condition: String(msg.cond ?? "—"),
            at: now,
          };
          break;
        case "cam":
          this.cameras.set(String(msg.id), {
            cameraId: String(msg.id),
            online: Boolean(msg.up),
            quality: Number(msg.q ?? 0),
            latencyMs: Number(msg.ms ?? 0),
            detections: Number(msg.n ?? 0),
          });
          break;
        case "estop":
          this.estop = {
            engaged: Boolean(msg.on),
            reason: String(msg.why ?? ""),
            at: now,
          };
          break;
      }
    }
  }

  private fresh<T extends { at: number }>(r: T | undefined): T | undefined {
    if (!r) return undefined;
    return Date.now() - r.at <= this.opts.stalenessMs ? r : undefined;
  }

  async readDistance(sensorId: string): Promise<DistanceReading> {
    const r = this.fresh(this.distances.get(sensorId));
    return (
      r ?? { sensorId, distance: Infinity, quality: 0, at: Date.now() }
    );
  }

  async readAllDistances(): Promise<DistanceReading[]> {
    return [...this.distances.keys()].map(
      (id) =>
        this.fresh(this.distances.get(id)) ?? {
          sensorId: id,
          distance: Infinity,
          quality: 0,
          at: Date.now(),
        }
    );
  }

  async readEnvironment(): Promise<EnvironmentReading> {
    const e = this.fresh(this.env ?? undefined);
    return (
      e ?? {
        temperatureC: NaN,
        humidityPct: NaN,
        pressureHpa: NaN,
        windKt: NaN,
        windDirDeg: NaN,
        condition: "—",
        at: Date.now(),
      }
    );
  }

  async setWarningLed(cmd: LedCommand) {
    this.send({ t: "led", c: cmd.colour, hz: cmd.blinkHz });
  }

  async setBuzzer(pattern: BuzzerPattern) {
    this.send({ t: "buz", p: pattern });
  }

  async setEmergencyStop(engaged: boolean, reason: string) {
    this.send({ t: "estop", on: engaged ? 1 : 0, why: reason });
    this.estop = { engaged, reason, at: Date.now() };
    return this.estop;
  }

  getEmergencyStop() {
    return this.estop;
  }

  async readCameraFeeds(): Promise<CameraFrameInfo[]> {
    return [...this.cameras.values()];
  }
}
