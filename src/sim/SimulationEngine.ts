import type {
  Alert,
  FodObject,
  GroundVehicle,
  Hazard,
  InterventionBanner,
  Person,
  Route,
  ScenarioId,
  Severity,
  SimSnapshot,
  TrackedOverlay,
  Vec2,
  ZoneId,
} from "./types";
import { AIRFRAMES, DEFAULT_AIRFRAME, type AirframeId, type Airframe } from "./aircraftTypes";
import {
  MAX_VISIBLE_EVENTS,
  TTC_AUTOSTOP,
  TTC_CAUTION,
  describeLocation,
  fodSpots,
  intrusionTarget,
} from "./constants";
import {
  clamp,
  damp,
  dist,
  headingToVec,
  makeRng,
  pick,
  randRange,
  turnToward,
  vecToHeading,
} from "./geometry";
import { AlertManager } from "./AlertManager";
import { ClearanceManager } from "./ClearanceManager";
import { CollisionPredictionEngine } from "./CollisionPredictionEngine";
import { EventLogger } from "./EventLogger";
import { ObjectRegistry, VEHICLE_SPECS } from "./ObjectRegistry";
import { RiskEngine } from "./RiskEngine";
import { SensorManager } from "./SensorManager";
import { ZoneManager } from "./ZoneManager";
import { getHardwareProvider } from "@/hardware";
import type { BuzzerPattern, HardwareProvider } from "@/hardware/types";

export type AudioCue = "warn" | "critical" | "clear" | "chirp";

/** Weightings used when scoring zone integrity. */
const INTEGRITY_WEIGHT = { vehicle: 1.0, person: 0.35, fod: 0.55 };

const MS_PER_S = 1000;

interface DemoStep {
  t: number;
  caption: string;
  run?: (e: SimulationEngine) => void;
}

/**
 * The single owner of simulation state.
 *
 * Everything on the dashboard is derived from one 60 Hz tick here. React never
 * drives the simulation and the simulation never touches React - it publishes a
 * snapshot at 10 Hz, and the 3D layer reads entity transforms straight off the
 * registry inside its own frame loop.
 */
export class SimulationEngine {
  registry: ObjectRegistry;
  zones: ZoneManager;
  risk: RiskEngine;
  alerts: AlertManager;
  events: EventLogger;
  sensors: SensorManager;
  clearance: ClearanceManager;
  hardware: HardwareProvider;

  /** Simulation wall clock, ms. Seeded to the reference time on boot. */
  clock: number;
  running = true;
  airframeId: AirframeId = DEFAULT_AIRFRAME;

  autoStop = true;
  autoTracking = true;
  muted = true;

  hazards: Hazard[] = [];
  intervention: InterventionBanner | null = null;

  onAudio?: (cue: AudioCue) => void;

  private rng = makeRng(0x1e5f00d);
  private adHoc = new Map<string, Route>();
  private adHocSeq = 0;
  private ambient = 1.4;
  private nextAmbientEvent = 0;
  private lastBuzzer: BuzzerPattern = "off";
  private interventionExpiry = 0;

  /* demo mode */
  demoActive = false;
  demoElapsed = 0;
  demoCaption = "";
  private demoStep = 0;

  constructor(airframeId: AirframeId = DEFAULT_AIRFRAME) {
    this.airframeId = airframeId;
    const af = this.af;

    // Boot the clock at the reference timestamp, then let it run.
    const d = new Date();
    d.setUTCHours(14, 26, 37, 0);
    this.clock = d.getTime();

    this.registry = new ObjectRegistry(af);
    this.zones = new ZoneManager(af);
    this.risk = new RiskEngine(af);
    this.alerts = new AlertManager();
    this.events = new EventLogger();
    this.hardware = getHardwareProvider();
    this.sensors = new SensorManager(af, this.hardware);
    this.clearance = new ClearanceManager();

    this.wireAlerts();
    this.seedReferenceState();
  }

  get af(): Airframe {
    return AIRFRAMES[this.airframeId];
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  private wireAlerts() {
    this.alerts.onRaise = (a) => {
      this.events.log(
        this.clock,
        a.level,
        a.title,
        a.location,
        { id: a.targetId, kind: a.targetKind },
        `raise:${a.hazardId}`,
        4000
      );
      this.cue(a.level === "critical" ? "critical" : a.level === "high" ? "warn" : "chirp");
    };
    this.alerts.onEscalate = (a, from) => {
      this.events.log(
        this.clock,
        a.level,
        `${a.title} – escalated ${from.toUpperCase()} to ${a.level.toUpperCase()}`,
        a.location,
        { id: a.targetId, kind: a.targetKind },
        `esc:${a.hazardId}:${a.level}`,
        3000
      );
      if (a.level === "critical") this.cue("critical");
      else if (a.level === "high") this.cue("warn");
    };
    this.alerts.onResolve = (a) => {
      this.events.log(
        this.clock,
        "info",
        `${a.title} – resolved`,
        a.location,
        { id: a.targetId, kind: a.targetKind },
        `res:${a.hazardId}`,
        3000
      );
    };
  }

  /**
   * Puts the stand into the exact situation the dashboard was specified
   * against: a tractor closing on the left wing, debris in the nose zone and a
   * walker inside the right wing area. Everything below is a real object in the
   * simulation, so the picture starts resolving the moment the clock runs.
   */
  private seedReferenceState() {
    const af = this.af;
    const s = af.worldScale;

    this.events.log(this.clock - 254000, "info", "System initialized – All sensors online", "—");
    this.events.log(
      this.clock - 117000,
      "info",
      "Pushback clearance status changed to HOLD",
      `Stand A12`
    );

    // Tractor already committed to the left wing approach at 8 km/h.
    const veh = this.registry.vehicle("VEH-1023");
    if (veh) {
      const route = this.registry.route("conflict-lwing");
      if (route) {
        veh.routeId = "conflict-lwing";
        veh.waypoint = 2;
        veh.position = { x: -21 * s, z: 4.25 * s };
        veh.headingRad = vecToHeading({
          x: route.points[2].x - veh.position.x,
          z: route.points[2].z - veh.position.z,
        });
        veh.speed = 2.22; // exactly 8 km/h
        veh.targetSpeed = 2.22;
        veh.state = "MOVING";
      }
    }

    // Debris in the nose zone, already classified.
    const fod = this.registry.spawnFod(
      { x: -1.6 * s, z: af.envelope.noseZ - 2.4 * s },
      this.clock,
      "Plastic",
      6
    );
    fod.detected = true;
    fod.detectLatency = 0;
    fod.confidence = 0.93;

    // Walker inside the right wing area.
    const p = this.registry.person("PERS-045");
    if (p) {
      p.position = { x: 4.6 * s, z: 2.4 * s };
      p.path = [
        { x: 4.6 * s, z: 2.4 * s },
        { x: 8.5 * s, z: 4.5 * s },
        { x: 11 * s, z: 1 * s },
        { x: 7 * s, z: -2 * s },
      ];
      p.waypoint = 1;
      p.state = "MOVING";
      p.headingRad = vecToHeading({ x: 3.9 * s, z: 2.1 * s });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public controls                                                     */
  /* ------------------------------------------------------------------ */

  setAirframe(id: AirframeId) {
    if (id === this.airframeId) return;
    this.airframeId = id;
    const af = this.af;
    this.registry.rebuild(af);
    this.zones.setAirframe(af);
    this.risk.setAirframe(af);
    this.sensors.setAirframe(af);
    this.alerts.clear();
    this.hazards = [];
    this.adHoc.clear();
    this.intervention = null;
    this.clearance.reset(this.clock);
    this.events.log(
      this.clock,
      "info",
      `Monitored airframe changed to ${af.name}`,
      `Stand A12`
    );
    this.seedReferenceState();
  }

  setAutoStop(on: boolean) {
    this.autoStop = on;
    this.events.log(
      this.clock,
      "info",
      `Automatic emergency stop ${on ? "ARMED" : "DISARMED"}`,
      "Stand A12",
      undefined,
      `autostop:${on}`,
      1500
    );
  }

  setAutoTracking(on: boolean) {
    this.autoTracking = on;
  }

  setMuted(m: boolean) {
    this.muted = m;
  }


  private cue(c: AudioCue) {
    if (!this.muted) this.onAudio?.(c);
  }

  /* ------------------------------------------------------------------ */
  /* Routing helpers - no teleporting, ever                              */
  /* ------------------------------------------------------------------ */

  /**
   * Builds a temporary route from where the vehicle actually is to a target.
   *
   * Intermediate points are pushed out onto a stand-off circle around the
   * aircraft, so a diversion drives *around* the airframe instead of straight
   * across the tail. Without this, sending a vehicle from one side of the stand
   * to the other would route it over the aircraft and fire a spurious
   * intervention on the way.
   */
  private assignAdHocRoute(v: GroundVehicle, target: Vec2, cruise: number, loop = false) {
    const from = { x: v.position.x, z: v.position.z };
    const d = dist(from, target);
    const af = this.af;
    // Stand-off radius: outside the wingtips with room for the vehicle.
    const standoff = af.envelope.halfSpan + 9 * af.worldScale;
    const centre: Vec2 = { x: 0, z: (af.envelope.noseZ + af.envelope.tailZ) / 2 };

    /** Pushes a point out to the stand-off circle if it would cut the corner. */
    const clear = (p: Vec2): Vec2 => {
      const dx = p.x - centre.x;
      const dz = p.z - centre.z;
      const r = Math.hypot(dx, dz);
      if (r >= standoff || r < 1e-4) return p;
      const k = standoff / r;
      return { x: centre.x + dx * k, z: centre.z + dz * k };
    };

    const points: Vec2[] = [];
    if (d > 12) {
      // Two waypoints so the detour reads as an arc rather than a dog-leg.
      for (const t of [0.36, 0.68]) {
        points.push(
          clear({
            x: from.x + (target.x - from.x) * t + (this.rng() - 0.5) * d * 0.06,
            z: from.z + (target.z - from.z) * t + (this.rng() - 0.5) * d * 0.06,
          })
        );
      }
    }
    points.push(target);

    const id = `adhoc-${++this.adHocSeq}`;
    const route: Route = {
      id,
      name: "Ad-hoc track",
      points,
      loop,
      cruise,
    };
    this.adHoc.set(id, route);
    this.registry.routes.set(id, route);
    v.routeId = id;
    v.waypoint = 0;
    v.targetSpeed = Math.min(cruise, VEHICLE_SPECS[v.model].maxSpeed);
    v.state = "MOVING";
    v.autoStopped = false;
    v.holdTimer = 0;
  }

  /**
   * Sends a vehicle back to the nearest point on one of the standing routes.
   * Reuses the ad-hoc builder so the rejoin also arcs around the airframe -
   * a direct line back would drive straight through the aircraft.
   */
  private returnToRoute(v: GroundVehicle, routeId: string) {
    const route = this.registry.route(routeId);
    if (!route) return;
    let best = 0;
    let bestD = Infinity;
    route.points.forEach((p, i) => {
      const d = dist(v.position, p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    this.assignAdHocRoute(v, route.points[best], route.cruise);
    // Remember where to hand back once the rejoin completes.
    (v as GroundVehicle & { rejoinTo?: string }).rejoinTo = routeId;
  }

  /* ------------------------------------------------------------------ */
  /* Scenarios                                                           */
  /* ------------------------------------------------------------------ */

  scenario(id: ScenarioId) {
    const af = this.af;
    const s = af.worldScale;

    switch (id) {
      case "normal": {
        this.clearHazards();
        const standing: Record<string, string> = {
          "VEH-1023": "bag-run",
          "VEH-1048": "svc-loop",
          "VEH-2210": "truck-run",
        };
        for (const v of this.registry.vehicles) {
          v.visible = true;
          v.autoStopped = false;
          v.holdTimer = 0;
          const target = standing[v.id];
          if (target) this.returnToRoute(v, target);
          else {
            v.state = "IDLE";
            v.targetSpeed = 0;
          }
        }
        this.events.log(this.clock, "info", "Normal operations resumed", "Stand A12");
        break;
      }

      case "collision": {
        // Divert whichever tractor is free toward the left wing tip.
        const v =
          this.registry.vehicle("VEH-1023") ??
          this.registry.vehicles.find((x) => x.model === "baggageTractor");
        if (v) {
          const wing = af.hull.find((h) => h.name === "Left Wing");
          const target: Vec2 = wing
            ? { x: wing.b.x - 1.6, z: wing.b.z }
            : { x: -8 * s, z: 2.6 * s };
          this.assignAdHocRoute(v, target, 2.22);
          this.events.log(
            this.clock,
            "medium",
            `${v.id} deviated from assigned service track`,
            describeLocation(v.position, af),
            { id: v.id, kind: "vehicle" }
          );
        }
        break;
      }

      case "intrusion": {
        const p = this.registry.person("PERS-045") ?? this.registry.people[1];
        if (p) {
          const t = intrusionTarget(af);
          p.path = [
            { x: p.position.x, z: p.position.z },
            { x: (p.position.x + t.x) / 2, z: (p.position.z + t.z) / 2 - 1.2 * s },
            t,
          ];
          p.waypoint = 1;
          p.state = "MOVING";
          p.dwell = 0;
          this.events.log(
            this.clock,
            "medium",
            `${p.id} proceeding into restricted area`,
            describeLocation(t, af),
            { id: p.id, kind: "person" }
          );
        }
        break;
      }

      case "fod": {
        this.spawnFodRandom();
        break;
      }

      case "multi": {
        this.scenario("collision");
        this.scenario("intrusion");
        this.spawnFodRandom();
        this.spawnFodRandom();
        this.sensors.degradeCameras(1);
        this.sensors.degradeSensors(1);
        this.startEngines();
        this.events.log(
          this.clock,
          "high",
          "Multiple simultaneous hazards detected on stand",
          "Stand A12"
        );
        break;
      }

      case "engineStart": {
        this.startEngines();
        break;
      }

      case "clear": {
        this.clearHazards();
        this.events.log(this.clock, "info", "All hazards cleared by operator", "Stand A12");
        this.cue("clear");
        break;
      }

      case "reset": {
        this.reset();
        break;
      }
    }
  }

  startEngines() {
    const a = this.registry.aircraft;
    if (a.engines.left === "OFF") {
      a.engines.left = "STARTING";
      a.engines.right = "STARTING";
      a.beacon = true;
      this.events.log(
        this.clock,
        "medium",
        "Engine start sequence initiated – hazard areas expanding",
        "Stand A12 – Engine Zones"
      );
      this.cue("warn");
    } else {
      a.engines.left = "SPOOLDOWN";
      a.engines.right = "SPOOLDOWN";
      this.events.log(this.clock, "info", "Engine shutdown initiated", "Stand A12 – Engine Zones");
    }
  }

  spawnFodRandom() {
    const spots = fodSpots(this.af);
    const at = pick(this.rng, spots);
    return this.spawnFodAt({
      x: at.x + randRange(this.rng, -1.4, 1.4),
      z: at.z + randRange(this.rng, -1.4, 1.4),
    });
  }

  spawnFodAt(at: Vec2): FodObject {
    const f = this.registry.spawnFod(at, this.clock);
    this.events.log(
      this.clock,
      "info",
      `Object entered stand – classification pending`,
      describeLocation(at, this.af),
      { id: f.id, kind: "fod" },
      `fodspawn:${f.id}`
    );
    return f;
  }

  clearHazards() {
    this.registry.clearFod();
    const standing: Record<string, string> = {
      "VEH-1023": "bag-run",
      "VEH-1048": "svc-loop",
      "VEH-2210": "truck-run",
    };
    for (const v of this.registry.vehicles) {
      v.autoStopped = false;
      v.holdTimer = 0;
      if (v.state === "AUTO_STOPPED" || v.state === "HOLDING") {
        v.state = v.routeId ? "MOVING" : "IDLE";
      }
      // Anything sitting inside the envelope is driven back out, not just
      // un-latched - otherwise it immediately raises the same hazard again.
      if (v.zone === "critical" || v.zone === "caution") {
        const target = standing[v.id];
        if (target) this.returnToRoute(v, target);
      }
    }
    for (const p of this.registry.people) {
      if (p.zone === "critical" || p.inEngineHazard) {
        // Walk them back out rather than snapping them away.
        const af = this.af;
        const away: Vec2 = {
          x: p.position.x + (p.position.x >= 0 ? 9 : -9) * af.worldScale,
          z: p.position.z + 5 * af.worldScale,
        };
        p.path = [{ x: p.position.x, z: p.position.z }, away];
        p.waypoint = 1;
        p.state = "EVACUATING";
        p.dwell = 0;
      }
    }
    this.sensors.restoreAll();
    this.registry.aircraft.engines.left = "OFF";
    this.registry.aircraft.engines.right = "OFF";
    this.registry.aircraft.engines.spool = 0;
    this.registry.aircraft.beacon = false;
    this.hazards = [];
    this.alerts.clear();
  }

  /**
   * Rebuilds the stand. Kept separate from `reset()` so the demo script can
   * clear the world at T+0 without switching itself off - `reset()` also tears
   * down demo state, which would stop the sequence on its own first step.
   */
  resetWorld(seed = true) {
    this.registry.rebuild(this.af);
    this.zones.setAirframe(this.af);
    this.risk.reset();
    this.alerts.clear();
    this.events.clear();
    this.sensors.restoreAll();
    this.clearance.reset(this.clock);
    this.hazards = [];
    this.intervention = null;
    this.adHoc.clear();
    this.events.log(this.clock, "info", "System initialized – All sensors online", "—");
    if (seed) this.seedReferenceState();
  }

  reset() {
    this.resetWorld(true);
    this.demoActive = false;
    this.demoElapsed = 0;
    this.demoStep = 0;
    this.demoCaption = "";
  }

  /* ------------------------------------------------------------------ */
  /* Demo mode                                                           */
  /* ------------------------------------------------------------------ */

  private demoScript: DemoStep[] = [
    {
      t: 0,
      caption: "System nominal – all safety zones clear",
      run: (e) => {
        e.resetWorld(false);
        e.registry.clearFod();
        e.alerts.clear();
        e.hazards = [];
        // Put every vehicle back on a standing route, away from the aircraft.
        const standing: Record<string, string> = {
          "VEH-1023": "bag-run",
          "VEH-1048": "svc-loop",
          "VEH-2210": "truck-run",
        };
        for (const v of e.registry.vehicles) {
          const t = standing[v.id];
          if (t) {
            const r = e.registry.route(t)!;
            v.routeId = t;
            v.waypoint = 1;
            v.position = { x: r.points[0].x, z: r.points[0].z };
            v.headingRad = vecToHeading({
              x: r.points[1].x - r.points[0].x,
              z: r.points[1].z - r.points[0].z,
            });
            v.speed = 0;
            v.targetSpeed = 0;
            v.state = "IDLE";
          }
        }
        const p = e.registry.person("PERS-045");
        if (p) {
          const paths = e.registry.people[1].path;
          p.position = { x: paths[0].x, z: paths[0].z };
          p.waypoint = 1;
          p.state = "MOVING";
        }
      },
    },
    {
      t: 8,
      caption: "Service vehicle departing staging area",
      run: (e) => {
        for (const v of e.registry.vehicles) {
          const r = e.registry.route(v.routeId);
          if (r) {
            v.state = "MOVING";
            v.targetSpeed = Math.min(r.cruise, VEHICLE_SPECS[v.model].maxSpeed);
          }
        }
        const v = e.registry.vehicle("VEH-1023");
        if (v) {
          const route = e.registry.route("conflict-lwing")!;
          // Drive onto the outer end of the conflict track from where it is.
          e.assignAdHocRoute(v, route.points[1], 3.4);
        }
      },
    },
    {
      t: 15,
      caption: "Predicted trajectory conflict – left wing",
      run: (e) => {
        const v = e.registry.vehicle("VEH-1023");
        if (v) {
          const route = e.registry.route("conflict-lwing")!;
          e.assignAdHocRoute(v, route.points[2], 1.9);
        }
      },
    },
    { t: 20, caption: "Risk elevated – status CAUTION" },
    {
      t: 26,
      caption: "Foreign object detected on stand",
      run: (e) => {
        const af = e.af;
        e.spawnFodAt({
          x: -1.9 * af.worldScale,
          z: af.envelope.noseZ - 2.1 * af.worldScale,
        });
      },
    },
    { t: 30, caption: "FOD classified – HIGH severity, movement area" },
    {
      t: 38,
      caption: "Personnel entering restricted area",
      run: (e) => e.scenario("intrusion"),
    },
    {
      t: 44,
      caption: "Vehicle resuming approach – closing on left wing",
      run: (e) => {
        const v = e.registry.vehicle("VEH-1023");
        if (v) {
          const wing = e.af.hull.find((h) => h.name === "Left Wing");
          e.assignAdHocRoute(
            v,
            wing ? { x: wing.b.x - 1.4, z: wing.b.z } : { x: -8, z: 2.6 },
            1.15
          );
        }
      },
    },
    { t: 48, caption: "Time to collision critical – TTC below threshold" },
    { t: 52, caption: "Aircraft clearance – PUSHBACK HOLD" },
    { t: 56, caption: "Automatic intervention – vehicle braking" },
    { t: 62, caption: "Collision prevented – aircraft protected" },
    {
      t: 70,
      caption: "Hazards clearing – crews withdrawing",
      run: (e) => {
        e.registry.clearFod();
        // Release anything the intervention latched, so the stand can actually
        // return to CLEAR rather than sitting on a stale hold.
        for (const v of e.registry.vehicles) {
          v.autoStopped = false;
          v.holdTimer = 0;
          if (v.state === "AUTO_STOPPED" || v.state === "BRAKING") v.state = "IDLE";
        }
        for (const p of e.registry.people) {
          if (p.zone === "critical" || p.inEngineHazard) {
            const away: Vec2 = {
              x: p.position.x + 11 * e.af.worldScale,
              z: p.position.z + 6 * e.af.worldScale,
            };
            p.path = [{ x: p.position.x, z: p.position.z }, away];
            p.waypoint = 1;
            p.state = "EVACUATING";
          }
        }
        const v = e.registry.vehicle("VEH-1023");
        if (v) e.returnToRoute(v, "bag-run");
      },
    },
    {
      t: 80,
      caption: "Stand secure – aircraft CLEAR",
      run: (e) => {
        // Everything that was going to withdraw has withdrawn by now; drop any
        // residue so the sequence finishes on a genuinely clear stand.
        e.clearHazards();
        e.hazards = [];
        e.alerts.clear();
        e.cue("clear");
      },
    },
    {
      t: 90,
      caption: "Demonstration complete",
      run: (e) => {
        e.demoActive = false;
      },
    },
  ];

  startDemo() {
    this.demoActive = true;
    this.demoElapsed = 0;
    this.demoStep = 0;
    this.demoCaption = "";
  }

  stopDemo() {
    this.demoActive = false;
    this.demoCaption = "";
  }

  private tickDemo(dt: number) {
    if (!this.demoActive) return;
    this.demoElapsed += dt;
    while (
      this.demoStep < this.demoScript.length &&
      this.demoElapsed >= this.demoScript[this.demoStep].t
    ) {
      const step = this.demoScript[this.demoStep];
      this.demoCaption = step.caption;
      step.run?.(this);
      this.demoStep++;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tick                                                                */
  /* ------------------------------------------------------------------ */

  tick(dtMs: number) {
    if (!this.running) return;
    // Guard against tab-switch hitches producing a huge integration step.
    const dt = clamp(dtMs, 0, 100) / MS_PER_S;
    this.clock += dtMs;

    this.tickDemo(dt);
    this.tickEngines(dt);
    this.zones.updateEngines(
      this.registry.aircraft.engines.spool,
      this.registry.aircraft.engines.left !== "OFF"
    );

    for (const v of this.registry.vehicles) this.tickVehicle(v, dt);
    for (const p of this.registry.people) this.tickPerson(p, dt);
    this.tickFod(dt);

    this.hazards = this.buildHazards();
    this.tickAutoStop();

    this.tickAmbient(dt);
    this.risk.update(this.hazards, this.ambient, dt);
    this.risk.decay(dt);
    this.depositHeat(dt);

    this.alerts.sync(this.hazards, this.clock);

    const cl = this.clearance.evaluate(this.hazards, this.clock);
    if (cl.changed) {
      const lvl: Severity =
        this.clearance.status === "HOLD"
          ? "high"
          : this.clearance.status === "CAUTION"
            ? "medium"
            : "info";
      this.events.log(
        this.clock,
        lvl,
        `Pushback clearance status changed to ${this.clearance.status}`,
        "Stand A12",
        undefined,
        `clr:${this.clearance.status}`,
        2500
      );
      if (this.clearance.status === "CLEAR") this.cue("clear");
    }

    const peak = this.hazards.reduce((m, h) => Math.max(m, h.risk), 0);
    this.sensors.update(
      this.clock,
      dt,
      this.registry.allPositions(),
      this.registry.trackedCount,
      peak
    );
    this.pushHardwareOutputs();

    if (this.intervention && this.clock > this.interventionExpiry) {
      this.intervention = null;
    }
  }

  /* ---------------- engines ---------------- */

  private tickEngines(dt: number) {
    const e = this.registry.aircraft.engines;
    let target = 0;
    if (e.left === "STARTING") target = 1;
    else if (e.left === "RUNNING") target = 1;
    else if (e.left === "SPOOLDOWN") target = 0;

    e.spool = damp(e.spool, target, e.left === "STARTING" ? 0.35 : 0.7, dt);

    if (e.left === "STARTING" && e.spool > 0.97) {
      e.left = "RUNNING";
      e.right = "RUNNING";
      this.events.log(
        this.clock,
        "medium",
        "Engines running – blast and intake hazard areas active",
        "Stand A12 – Engine Zones"
      );
    }
    if (e.left === "SPOOLDOWN" && e.spool < 0.02) {
      e.left = "OFF";
      e.right = "OFF";
      e.spool = 0;
      this.registry.aircraft.beacon = false;
    }
  }

  /* ---------------- vehicles ---------------- */

  private tickVehicle(v: GroundVehicle, dt: number) {
    if (!v.visible) return;

    if (v.holdTimer > 0) {
      v.holdTimer -= dt;
      if (v.holdTimer <= 0) {
        v.holdTimer = 0;
        // Only release if the conflict has actually gone away.
        const stillRisky = v.prediction?.ttc != null && v.prediction.ttc < TTC_CAUTION;
        if (!stillRisky) {
          v.autoStopped = false;
          this.returnToRoute(v, v.model === "baggageTractor" ? "bag-run" : "svc-loop");
          this.events.log(
            this.clock,
            "info",
            `${v.id} released – resuming assigned track`,
            describeLocation(v.position, this.af),
            { id: v.id, kind: "vehicle" },
            `rel:${v.id}`
          );
        } else {
          v.holdTimer = 2;
        }
      }
    }

    const stopped =
      v.state === "AUTO_STOPPED" || v.state === "STOPPED" || v.state === "HOLDING";
    const wanted = stopped ? 0 : v.state === "BRAKING" ? 0 : v.targetSpeed;

    // Longitudinal control.
    if (v.speed < wanted) {
      v.speed = Math.min(wanted, v.speed + v.accel * dt);
    } else if (v.speed > wanted) {
      const decel = v.state === "BRAKING" || v.autoStopped ? v.brakeAccel : v.accel * 1.6;
      v.speed = Math.max(wanted, v.speed - decel * dt);
    }

    if (v.state === "BRAKING" && v.speed <= 0.02) {
      v.speed = 0;
      v.state = "AUTO_STOPPED";
      const gap = v.prediction?.distance ?? 0;
      this.raiseIntervention(
        "COLLISION PREVENTED",
        [`${v.id} halted ${gap.toFixed(1)} m from ${v.prediction?.part ?? "airframe"}`,
          "Predicted contact averted by AeroHalo"],
        7000
      );
      this.events.log(
        this.clock,
        "high",
        `Collision prevented – ${v.id} stopped ${gap.toFixed(1)} m from ${v.prediction?.part ?? "aircraft"}`,
        describeLocation(v.position, this.af),
        { id: v.id, kind: "vehicle" },
        `prevented:${v.id}`,
        8000
      );
      this.cue("clear");
      v.holdTimer = 8;
    }

    // Steering along the route.
    const route = this.registry.route(v.routeId);
    if (route && v.speed > 0.001) {
      const target = route.points[Math.min(v.waypoint, route.points.length - 1)];
      const toTarget = { x: target.x - v.position.x, z: target.z - v.position.z };
      const desired = vecToHeading(toTarget);
      // Slower vehicles turn tighter; this keeps the tracks looking driven.
      const turnRate = clamp(2.4 - v.speed * 0.12, 0.7, 2.4);
      v.headingRad = turnToward(v.headingRad, desired, turnRate * dt);

      if (dist(v.position, target) < Math.max(1.2, v.speed * 0.8)) {
        if (v.waypoint + 1 < route.points.length) {
          v.waypoint++;
        } else if (route.loop) {
          v.waypoint = 0;
        } else {
          // Reached the end of a one-shot track.
          const handoff = (v as GroundVehicle & { rejoinTo?: string }).rejoinTo;
          if (handoff) {
            const r = this.registry.route(handoff);
            if (r) {
              v.routeId = handoff;
              let best = 0;
              let bestD = Infinity;
              r.points.forEach((p, i) => {
                const d = dist(v.position, p);
                if (d < bestD) {
                  bestD = d;
                  best = i;
                }
              });
              v.waypoint = (best + 1) % r.points.length;
              v.targetSpeed = Math.min(r.cruise, VEHICLE_SPECS[v.model].maxSpeed);
            }
            delete (v as GroundVehicle & { rejoinTo?: string }).rejoinTo;
          } else {
            v.state = "STOPPED";
            v.targetSpeed = 0;
          }
        }
      }
    }

    const dir = headingToVec(v.headingRad);
    v.position.x += dir.x * v.speed * dt;
    v.position.z += dir.z * v.speed * dt;

    v.zone = this.zones.zoneOf(v.position);
    v.prediction = CollisionPredictionEngine.predict(
      v,
      this.registry.aircraft,
      this.registry.route(v.routeId)
    );

    // Re-rate the prediction with zone severity folded in.
    if (v.prediction) {
      v.prediction.risk = CollisionPredictionEngine.riskFor({
        ttc: v.prediction.ttc,
        dcpa: v.prediction.dcpa,
        distance: v.prediction.distance,
        speed: v.speed,
        weight:
          this.af.hull.find((h) => h.name === v.prediction!.part)?.severityWeight ?? 1,
        zoneSeverity: this.zones.severityOf(v.zone),
      });
    }
  }

  /**
   * Automatic emergency stop. When armed, a vehicle whose predicted breach
   * falls inside the intervention window is braked before it can reach the
   * airframe - the headline demonstration of the whole system.
   */
  private tickAutoStop() {
    if (!this.autoStop) return;
    for (const v of this.registry.vehicles) {
      const p = v.prediction;
      if (!p || p.ttc == null) continue;
      if (v.autoStopped || v.state === "BRAKING" || v.state === "AUTO_STOPPED") continue;
      if (v.speed < 0.05) continue;
      if (p.ttc > TTC_AUTOSTOP) continue;

      v.state = "BRAKING";
      v.autoStopped = true;
      v.targetSpeed = 0;
      this.raiseIntervention(
        "AUTO INTERVENTION",
        [`Vehicle ${v.id} stopped`, `Predicted contact with ${p.part} in ${p.ttc.toFixed(1)} s`],
        6000
      );
      this.events.log(
        this.clock,
        "critical",
        `Automatic intervention – ${v.id} emergency stop commanded`,
        describeLocation(v.position, this.af),
        { id: v.id, kind: "vehicle" },
        `autostop:${v.id}`,
        8000
      );
      this.cue("critical");
      void this.hardware.setEmergencyStop(true, `AeroHalo auto-stop ${v.id}`);
    }
  }

  private raiseIntervention(title: string, lines: string[], ms: number) {
    this.intervention = { id: `IV-${this.clock}`, title, lines, at: this.clock };
    this.interventionExpiry = this.clock + ms;
  }

  /* ---------------- people ---------------- */

  private tickPerson(p: Person, dt: number) {
    if (!p.visible) return;

    if (p.dwell > 0) {
      p.dwell -= dt;
      p.speed = damp(p.speed, 0, 6, dt);
      p.state = p.state === "EVACUATING" ? "EVACUATING" : "WORKING";
    } else {
      p.state = p.state === "EVACUATING" ? "EVACUATING" : "MOVING";
      p.speed = damp(p.speed, p.targetSpeed * (p.state === "EVACUATING" ? 1.7 : 1), 2.4, dt);

      const target = p.path[Math.min(p.waypoint, p.path.length - 1)];
      const desired = vecToHeading({ x: target.x - p.position.x, z: target.z - p.position.z });
      p.headingRad = turnToward(p.headingRad, desired, 2.8 * dt);

      if (dist(p.position, target) < 0.7) {
        if (p.waypoint + 1 < p.path.length) {
          p.waypoint++;
          if (this.rng() < 0.4) p.dwell = randRange(this.rng, 1.5, 5);
        } else if (p.state === "EVACUATING") {
          p.state = "IDLE";
          p.dwell = randRange(this.rng, 3, 6);
          // Hand them a fresh patrol once they are clear.
          p.path = [
            { x: p.position.x, z: p.position.z },
            { x: p.position.x + randRange(this.rng, -8, 8), z: p.position.z + randRange(this.rng, -6, 6) },
          ];
          p.waypoint = 1;
        } else {
          p.waypoint = 0;
          if (this.rng() < 0.5) p.dwell = randRange(this.rng, 2, 6);
        }
      }
    }

    const dir = headingToVec(p.headingRad);
    p.position.x += dir.x * p.speed * dt;
    p.position.z += dir.z * p.speed * dt;
    p.gait += p.speed * dt * 3.6;

    p.zone = this.zones.zoneOf(p.position);
    const eng = this.zones.inEngineHazard(p.position);
    p.inEngineHazard = eng.hit;
  }

  /* ---------------- FOD ---------------- */

  private tickFod(dt: number) {
    for (const f of this.registry.fod) {
      if (!f.detected) {
        f.detectLatency -= dt * MS_PER_S;
        if (f.detectLatency <= 0) {
          f.detected = true;
          f.confidence = randRange(this.rng, 0.86, 0.97);
          this.events.log(
            this.clock,
            "high",
            `FOD classified – ${f.material}, ${f.sizeCm} cm`,
            describeLocation(f.position, this.af),
            { id: f.id, kind: "fod" },
            `fodcls:${f.id}`
          );
          this.cue("warn");
        }
      }
      f.inMovementArea = this.zones.inMovementArea(f.position);
      f.zone = this.zones.zoneOf(f.position);
    }
  }

  /* ---------------- hazards ---------------- */

  private buildHazards(): Hazard[] {
    const out: Hazard[] = [];
    const af = this.af;

    /* --- predicted vehicle conflicts --- */
    for (const v of this.registry.vehicles) {
      if (!v.visible) continue;
      // Equipment parked at its designated service position is authorised to
      // be there - it is tracked and boxed, but it is not a hazard.
      if (v.state === "IDLE" && v.speed < 0.05) continue;
      const p = v.prediction;
      if (!p) continue;
      if (p.ttc == null && p.risk < 3.7) continue;

      const partLower = p.part.toLowerCase();
      const kmh = v.speed * 3.6;
      const detail =
        p.ttc != null
          ? `TTC ${p.ttc.toFixed(1)} s · ${p.distance.toFixed(1)} m · ${kmh.toFixed(0)} km/h`
          : `${p.distance.toFixed(1)} m · CPA ${p.dcpa.toFixed(1)} m · ${kmh.toFixed(0)} km/h`;

      out.push({
        id: `haz-col-${v.id}`,
        source: "collision",
        targetId: v.id,
        targetKind: "vehicle",
        risk: p.risk,
        level: p.level,
        title:
          v.state === "AUTO_STOPPED"
            ? `Vehicle held clear of ${partLower}`
            : `Vehicle approaching ${partLower}`,
        location: `Stand A12 – ${p.part} Zone`,
        detail,
        ttc: p.ttc,
        createdAt: this.clock,
      });
    }

    /* --- debris --- */
    for (const f of this.registry.fod) {
      if (!f.detected) continue;
      let r = 3.9;
      if (f.inMovementArea) r += 2.6;
      if (f.zone === "critical") r += 0.9;
      else if (f.zone === "caution") r += 0.3;
      r += clamp(f.sizeCm / 40, 0, 1) * 1.0;
      r +=
        f.material === "Metal" ? 0.6 :
        f.material === "Tool" ? 0.5 :
        f.material === "Baggage" ? 0.4 :
        f.material === "Composite" ? 0.3 : 0.1;
      // Debris in front of a running engine is far worse.
      if (this.zones.inEngineHazard(f.position).kind === "intake") r += 1.8;
      r = clamp(r, 0, 10);

      out.push({
        id: `haz-fod-${f.id}`,
        source: "fod",
        targetId: f.id,
        targetKind: "fod",
        risk: r,
        level: r >= 8.4 ? "critical" : r >= 6.6 ? "high" : r >= 4.2 ? "medium" : "low",
        title: f.inMovementArea
          ? "FOD detected in movement zone"
          : "FOD detected on stand",
        location: describeLocation(f.position, af),
        detail: `${f.material} · ${f.sizeCm} cm · ${(f.confidence * 100).toFixed(0)}% conf`,
        createdAt: f.spawnedAt,
      });
    }

    /* --- personnel --- */
    for (const p of this.registry.people) {
      if (!p.visible) continue;
      const inRestricted = p.zone === "critical" || p.inEngineHazard;
      if (!inRestricted) continue;

      let r = 2.9;
      if (p.zone === "critical") r += 2.2;
      else if (p.zone === "caution") r += 0.7;
      if (p.inEngineHazard) {
        const spool = Math.max(0.6, this.registry.aircraft.engines.spool);
        r += 3.2 * spool;
      }
      if (p.state === "MOVING") r += 0.3;
      r = clamp(r, 0, 10);

      out.push({
        id: `haz-int-${p.id}`,
        source: p.inEngineHazard ? "engine" : "intrusion",
        targetId: p.id,
        targetKind: "person",
        risk: r,
        level: r >= 8.2 ? "critical" : r >= 6.4 ? "high" : r >= 4.2 ? "medium" : "low",
        title: p.inEngineHazard
          ? "Personnel inside engine hazard area"
          : "Personnel entered restricted zone",
        location: describeLocation(p.position, af),
        detail: `${p.id} · ${p.role} · ${p.state.toLowerCase()}`,
        createdAt: this.clock,
      });
    }

    return out.sort((a, b) => b.risk - a.risk);
  }

  /* ---------------- ambient + heat ---------------- */

  private tickAmbient(dt: number) {
    const a = this.registry.aircraft;
    let target = 0.8;
    if (a.engines.left === "RUNNING") target += 2.2;
    else if (a.engines.left === "STARTING") target += 1.4;
    target += (this.sensors.total - this.sensors.onlineCount) * 0.9;
    target += (this.sensors.cameras.length - this.sensors.camerasOnline) * 0.7;
    this.ambient = damp(this.ambient, target, 0.8, dt);

    // Rare, low-key background activity so the log never goes dead.
    if (this.clock > this.nextAmbientEvent) {
      this.nextAmbientEvent = this.clock + randRange(this.rng, 16000, 34000);
      if (this.nextAmbientEvent > 0 && this.rng() > 0.45) {
        const msgs = [
          "Sensor ring self-test completed – all nodes nominal",
          "Vision model heartbeat OK – edge inference nominal",
          "Apron lighting level within operating limits",
          "Stand boundary scan completed – no breaches",
          "Camera fleet synchronisation check passed",
        ];
        this.events.log(this.clock, "info", pick(this.rng, msgs), "Stand A12");
      }
    }
  }

  private depositHeat(dt: number) {
    for (const v of this.registry.vehicles) {
      if (!v.visible || !v.prediction) continue;
      const amt = (v.prediction.risk / 10) * dt * 1.5;
      if (amt > 0.001) this.risk.deposit(v.position, amt, 2.6);
    }
    for (const p of this.registry.people) {
      if (!p.visible) continue;
      if (p.zone === "critical" || p.inEngineHazard) {
        this.risk.deposit(p.position, dt * 0.55, 1.9);
      } else if (p.zone === "caution") {
        this.risk.deposit(p.position, dt * 0.12, 1.6);
      }
    }
    for (const f of this.registry.fod) {
      if (!f.detected) continue;
      this.risk.deposit(f.position, dt * (f.inMovementArea ? 0.7 : 0.3), 2.1);
    }
    const eng = this.registry.aircraft.engines;
    if (eng.spool > 0.05) {
      for (const side of ["left", "right"] as const) {
        this.risk.deposit(this.af.engines[side].nozzle, dt * 0.45 * eng.spool, 2.8);
        this.risk.deposit(this.af.engines[side].intake, dt * 0.3 * eng.spool, 2.2);
      }
    }
  }

  /* ---------------- hardware outputs ---------------- */

  private pushHardwareOutputs() {
    const status = RiskEngine.statusFor(this.risk.score, this.hazards);
    const colour = status === "CRITICAL" ? "red" : status === "CAUTION" ? "amber" : "green";
    void this.hardware.setWarningLed({
      colour,
      blinkHz: status === "CRITICAL" ? 3 : status === "CAUTION" ? 1 : 0,
    });

    const pattern: BuzzerPattern =
      status === "CRITICAL" ? "critical" : status === "CAUTION" ? "warning" : "off";
    if (pattern !== this.lastBuzzer) {
      this.lastBuzzer = pattern;
      void this.hardware.setBuzzer(this.muted ? "off" : pattern);
    }

    const anyBraking = this.registry.vehicles.some(
      (v) => v.state === "BRAKING" || v.state === "AUTO_STOPPED"
    );
    if (!anyBraking && this.hardware.getEmergencyStop().engaged) {
      void this.hardware.setEmergencyStop(false, "cleared");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Snapshot                                                            */
  /* ------------------------------------------------------------------ */

  private overlays(): TrackedOverlay[] {
    const out: TrackedOverlay[] = [];
    const af = this.af;

    for (const v of this.registry.vehicles) {
      if (!v.visible) continue;
      const p = v.prediction;
      // Only surface vehicles the operator needs to see boxed.
      const relevant =
        (p && (p.ttc != null || p.risk >= 2.4)) || v.zone === "critical" || v.zone === "caution";
      if (!relevant) continue;
      const level: Severity = p?.level ?? "info";
      out.push({
        id: v.id,
        kind: "vehicle",
        cls: v.detectionClass,
        label: v.detectionClass,
        line1: `ID: ${v.id}`,
        line2:
          v.state === "AUTO_STOPPED"
            ? "Status: STOPPED"
            : `Speed: ${(v.speed * 3.6).toFixed(0)} km/h`,
        level,
        confidence: 0.94,
        x: v.position.x,
        y: v.size.h,
        z: v.position.z,
        boxW: Math.max(v.size.l, v.size.w),
        boxH: v.size.h,
      });
    }

    for (const p of this.registry.people) {
      if (!p.visible) continue;
      const relevant = p.zone !== null;
      if (!relevant) continue;
      const level: Severity = p.inEngineHazard
        ? "high"
        : p.zone === "critical"
          ? "medium"
          : "info";
      out.push({
        id: p.id,
        kind: "person",
        cls: "Person",
        label: "Person",
        line1: `ID: ${p.id}`,
        line2: `Status: ${p.state === "MOVING" ? "Moving" : p.state === "EVACUATING" ? "Evacuating" : p.state === "WORKING" ? "Working" : "Idle"}`,
        level,
        confidence: 0.91,
        x: p.position.x,
        y: 1.8,
        z: p.position.z,
        boxW: 0.9,
        boxH: 1.8,
      });
    }

    for (const f of this.registry.fod) {
      if (!f.detected) continue;
      out.push({
        id: f.id,
        kind: "fod",
        cls: "FOD",
        label: "FOD",
        line1: `Type: ${f.material}`,
        line2: `Size: ${f.sizeCm} cm`,
        level: f.inMovementArea ? "high" : "medium",
        confidence: f.confidence,
        x: f.position.x,
        y: 0.35,
        z: f.position.z,
        boxW: Math.max(0.45, f.sizeCm / 100),
        boxH: Math.max(0.35, f.sizeCm / 100),
      });
    }

    void af;
    // Worst first, then capped: past half a dozen boxes the feed stops being
    // readable and the operator loses the ones that matter.
    return out
      .sort((a, b) => RiskEngine.severityRank(b.level) - RiskEngine.severityRank(a.level))
      .slice(0, 6);
  }

  snapshot(): SimSnapshot {
    const score = this.risk.score;
    const status = RiskEngine.statusFor(score, this.hazards);

    const breaches: { zone: ZoneId | null; weight: number }[] = [];
    for (const v of this.registry.vehicles) {
      if (v.visible && v.zone) breaches.push({ zone: v.zone, weight: INTEGRITY_WEIGHT.vehicle });
    }
    for (const p of this.registry.people) {
      if (p.visible && (p.zone === "critical" || p.inEngineHazard)) {
        breaches.push({ zone: p.inEngineHazard ? "engine" : p.zone, weight: INTEGRITY_WEIGHT.person });
      }
    }
    for (const f of this.registry.fod) {
      if (f.detected && f.zone) breaches.push({ zone: f.zone, weight: INTEGRITY_WEIGHT.fod });
    }

    const peak = this.hazards.length ? this.hazards[0] : null;

    return {
      clock: this.clock,
      running: this.running,
      riskScore: score,
      safetyStatus: status,
      clearance: this.clearance.status,
      clearanceReason: this.clearance.reason,
      activeAlerts: this.alerts.list(),
      events: this.events.list(MAX_VISIBLE_EVENTS * 6),
      hazards: this.hazards,
      zoneIntegrity: this.zones.integrity(breaches),
      sensorsOnline: this.sensors.onlineCount,
      sensorsTotal: this.sensors.total,
      camerasOnline: this.sensors.camerasOnline,
      camerasTotal: this.sensors.cameras.length,
      cameraHealth: this.sensors.cameraHealth,
      inferenceAccuracy: this.sensors.inferenceAccuracy,
      responseMs: this.sensors.responseMs,
      engineState: this.registry.aircraft.engines.left,
      engineSpool: this.registry.aircraft.engines.spool,
      heat: this.risk.heatCells(),
      overlays: this.overlays(),
      intervention: this.intervention,
      autoStop: this.autoStop,
      autoTracking: this.autoTracking,
      muted: this.muted,
      vehicleCount: this.registry.vehicles.filter((v) => v.visible).length,
      personCount: this.registry.people.filter((p) => p.visible).length,
      fodCount: this.registry.fod.length,
      peakHazardId: peak?.targetId ?? null,
      demoActive: this.demoActive,
      demoElapsed: this.demoElapsed,
      demoCaption: this.demoCaption,
    };
  }

  /** Highest-risk world position, used by auto tracking. */
  focusPoint(): { p: Vec2; risk: number } | null {
    if (!this.hazards.length) return null;
    const h = this.hazards[0];
    const p = this.registry.locate(h.targetId);
    return p ? { p, risk: h.risk } : null;
  }
}

export type { Alert, SimSnapshot };
