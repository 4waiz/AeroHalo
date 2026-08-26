import type {
  Aircraft,
  FodMaterial,
  FodObject,
  GroundVehicle,
  Person,
  Route,
  Vec2,
  VehicleModel,
} from "./types";
import type { Airframe } from "./aircraftTypes";
import { buildPersonPaths, buildRoutes } from "./constants";
import { makeRng, pick, randRange, vecToHeading } from "./geometry";

/** Physical footprints in metres, matching the Blender GSE build. */
export const VEHICLE_SPECS: Record<
  VehicleModel,
  { l: number; w: number; h: number; label: string; cls: GroundVehicle["detectionClass"]; maxSpeed: number }
> = {
  baggageTractor: { l: 2.9, w: 1.5, h: 1.9, label: "Baggage Cart", cls: "Baggage Cart", maxSpeed: 6.2 },
  pushbackTug: { l: 5.0, w: 2.5, h: 1.6, label: "Pushback Tug", cls: "Pushback Tug", maxSpeed: 4.4 },
  utilityVan: { l: 4.4, w: 1.9, h: 1.9, label: "Utility Vehicle", cls: "Utility Vehicle", maxSpeed: 9.5 },
  beltLoader: { l: 5.2, w: 2.1, h: 3.4, label: "Belt Loader", cls: "Belt Loader", maxSpeed: 3.6 },
  serviceTruck: { l: 6.5, w: 2.4, h: 3.0, label: "Service Vehicle", cls: "Service Vehicle", maxSpeed: 7.5 },
};

const ROLES = ["Ramp Agent", "Loader", "Marshaller", "Engineer", "Fuel Operator"];
const VEST = ["#f2c53d", "#f5a623", "#e8f24d", "#ff8b1f"];

/**
 * Holds every tracked object and the routes they drive.
 * Nothing here mutates state on its own - the engine owns the tick.
 */
export class ObjectRegistry {
  aircraft!: Aircraft;
  vehicles: GroundVehicle[] = [];
  people: Person[] = [];
  fod: FodObject[] = [];
  routes = new Map<string, Route>();

  private af!: Airframe;
  private rng = makeRng(0xc0ffee);
  private fodSeq = 0;
  private vehSeq = 0;
  private persSeq = 0;

  constructor(af: Airframe) {
    this.rebuild(af);
  }

  get airframe() {
    return this.af;
  }

  route(id: string | null): Route | undefined {
    return id ? this.routes.get(id) : undefined;
  }

  /** Rebuilds the whole stand for a different airframe. */
  rebuild(af: Airframe) {
    this.af = af;
    this.rng = makeRng(0xc0ffee);
    this.fodSeq = 0;
    this.vehSeq = 0;
    this.persSeq = 0;

    this.routes.clear();
    for (const r of buildRoutes(af)) this.routes.set(r.id, r);

    this.aircraft = {
      id: "AC-01",
      type: af.name,
      registration: af.registration,
      stand: "A12",
      position: { x: 0, z: 0 },
      headingRad: 0,
      engines: { left: "OFF", right: "OFF", spool: 0 },
      beacon: false,
      parts: af.hull.map((p) => ({ ...p })),
    };

    this.vehicles = this.seedVehicles();
    this.people = this.seedPeople();
    this.fod = [];
  }

  /* ---------------- factories ---------------- */

  private makeVehicle(
    id: string,
    model: VehicleModel,
    routeId: string | null,
    waypoint: number,
    opts: Partial<GroundVehicle> = {}
  ): GroundVehicle {
    const spec = VEHICLE_SPECS[model];
    const route = routeId ? this.routes.get(routeId) : undefined;
    const start = route ? route.points[waypoint % route.points.length] : { x: 0, z: 0 };
    const next = route
      ? route.points[(waypoint + 1) % route.points.length]
      : { x: start.x, z: start.z - 1 };

    return {
      id,
      callsign: id,
      model,
      detectionClass: spec.cls,
      position: { x: start.x, z: start.z },
      headingRad: vecToHeading({ x: next.x - start.x, z: next.z - start.z }),
      speed: 0,
      targetSpeed: route ? Math.min(route.cruise, spec.maxSpeed) : 0,
      accel: 1.5,
      brakeAccel: 4.6,
      state: route ? "MOVING" : "IDLE",
      routeId,
      waypoint: (waypoint + 1) % (route?.points.length ?? 1),
      towsDolly: model === "baggageTractor",
      size: { l: spec.l, w: spec.w, h: spec.h },
      prediction: null,
      zone: null,
      autoStopped: false,
      holdTimer: 0,
      beacon: true,
      visible: true,
      ...opts,
    };
  }

  private seedVehicles(): GroundVehicle[] {
    const s = this.af.worldScale;
    return [
      // The tractor from the reference tableau.
      this.makeVehicle("VEH-1023", "baggageTractor", "bag-run", 0),
      this.makeVehicle("VEH-1048", "utilityVan", "svc-loop", 3),
      this.makeVehicle("VEH-2210", "serviceTruck", "truck-run", 1),
      this.makeVehicle("VEH-3305", "pushbackTug", null, 0, {
        position: { x: -25 * s, z: -25 * s },
        headingRad: Math.PI * 0.6,
        state: "IDLE",
        targetSpeed: 0,
        beacon: false,
      }),
      this.makeVehicle("VEH-4120", "beltLoader", null, 0, {
        position: { x: this.af.forwardDoor.x + 5.6 * s, z: this.af.forwardDoor.z - 3.1 * s },
        headingRad: -Math.PI / 2,
        state: "IDLE",
        targetSpeed: 0,
        beacon: false,
      }),
    ];
  }

  private seedPeople(): Person[] {
    const paths = buildPersonPaths(this.af);
    const ids = ["PERS-012", "PERS-045", "PERS-078", "PERS-103"];
    return paths.map((path, i) => {
      const start = path[0];
      const next = path[1 % path.length];
      return {
        id: ids[i],
        role: ROLES[i % ROLES.length],
        position: { x: start.x, z: start.z },
        headingRad: vecToHeading({ x: next.x - start.x, z: next.z - start.z }),
        speed: 0,
        targetSpeed: randRange(this.rng, 1.05, 1.45),
        state: "MOVING",
        path,
        waypoint: 1 % path.length,
        dwell: 0,
        gait: this.rng() * Math.PI * 2,
        zone: null,
        inEngineHazard: false,
        vestColor: pick(this.rng, VEST),
        visible: true,
      } satisfies Person;
    });
  }

  /** Adds debris at a world point. Detection latency models the edge model. */
  spawnFod(at: Vec2, clock: number, material?: FodMaterial, sizeCm?: number): FodObject {
    const materials: FodMaterial[] = ["Plastic", "Metal", "Tool", "Baggage", "Composite"];
    const m = material ?? pick(this.rng, materials);
    const size =
      sizeCm ??
      Math.round(
        m === "Metal" ? randRange(this.rng, 3, 9) :
        m === "Tool" ? randRange(this.rng, 12, 28) :
        m === "Baggage" ? randRange(this.rng, 22, 46) :
        randRange(this.rng, 5, 14)
      );

    const fod: FodObject = {
      id: `FOD-${String(++this.fodSeq).padStart(2, "0")}`,
      material: m,
      sizeCm: size,
      position: { x: at.x, z: at.z },
      rotation: this.rng() * Math.PI * 2,
      // Realistic edge-inference delay before the classifier commits.
      detectLatency: randRange(this.rng, 400, 800),
      detected: false,
      confidence: 0,
      inMovementArea: false,
      zone: null,
      spawnedAt: clock,
    };
    this.fod.push(fod);
    return fod;
  }

  removeFod(id: string) {
    this.fod = this.fod.filter((f) => f.id !== id);
  }

  clearFod() {
    this.fod = [];
  }

  vehicle(id: string) {
    return this.vehicles.find((v) => v.id === id);
  }

  person(id: string) {
    return this.people.find((p) => p.id === id);
  }

  fodById(id: string) {
    return this.fod.find((f) => f.id === id);
  }

  /** Any tracked object by id, used to focus the camera from an alert click. */
  locate(id: string): Vec2 | null {
    if (id === this.aircraft.id) return this.aircraft.position;
    return (
      this.vehicle(id)?.position ??
      this.person(id)?.position ??
      this.fodById(id)?.position ??
      null
    );
  }

  /** Every tracked position, for the sensor ring. */
  allPositions(): Vec2[] {
    const out: Vec2[] = [];
    for (const v of this.vehicles) if (v.visible) out.push(v.position);
    for (const p of this.people) if (p.visible) out.push(p.position);
    for (const f of this.fod) out.push(f.position);
    return out;
  }

  get trackedCount() {
    return this.vehicles.length + this.people.length + this.fod.length;
  }
}
