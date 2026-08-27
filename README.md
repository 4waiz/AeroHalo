# AeroHalo — Predictive Airside Safety Dashboard

A real-time airside safety monitoring platform for aircraft stands. AeroHalo watches an
apron in 3D, tracks every vehicle, person and piece of debris on it, and **predicts**
collisions before they happen instead of reporting them afterwards.

The centre of the dashboard is not a video or a picture — it is a live React Three Fiber
simulation of Stand A12, and every number on the surrounding panels is derived from it.

---

## The problem

Ground damage is one of aviation's most expensive routine failures. Industry estimates put
the annual cost of ramp and ground-handling incidents in the billions of dollars, and the
overwhelming majority are low-speed contacts: a baggage tractor clipping a wingtip, a belt
loader touching a fuselage, a truck reversing into a stabiliser.

These incidents share a shape:

- The vehicle is **visible** the whole time. Nothing is hidden.
- The geometry is **known**. The aircraft has not moved.
- The outcome was **predictable** several seconds before contact.
- Nobody was watching that specific interaction at that specific moment.

Existing tools mostly detect *proximity* — an alarm when something is already close.
By then the useful window has closed.

## The solution

AeroHalo continuously forward-integrates every tracked object against the aircraft's real
hull geometry and answers a harder question: **"if nothing changes, what gets hit, and
when?"**

That single change — from detection to prediction — is what makes intervention possible.
When the predicted time-to-collision drops below the intervention threshold, the system
commands an emergency stop and the contact never occurs.

The same tracking layer also covers the other three things that stop a stand:

| Hazard | What AeroHalo does |
| --- | --- |
| Vehicle conflict | Predicts the breach, names the part at risk, brakes the vehicle |
| Foreign object debris | Classifies material and size, blocks clearance if inside the movement area |
| Personnel intrusion | Flags entry into restricted and engine hazard areas |
| Engine hazard | Grows intake and jet-blast exclusion areas with engine spool |

---

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:3000>. Desktop is the target; the layout is designed for
1920×1080 and adapts down to 1366×768.

Production build:

```bash
npm run build && npm start
```

Type checking:

```bash
npm run typecheck
```

### Demo mode

```
http://localhost:3000/?demo=true
```

Runs a scripted 90-second sequence that exercises the whole system end to end. The
captions along the bottom of the monitoring view narrate each beat:

| T+ | What happens |
| --- | --- |
| 0s | System nominal, all zones clear |
| 8s | Service vehicle departs the staging area |
| 15s | Predicted trajectory conflict detected on the left wing |
| 20s | Risk elevated to CAUTION |
| 26s | Foreign object appears on the stand |
| 30s | FOD classified — HIGH severity, inside the movement area |
| 38s | Personnel enter the restricted area |
| 44s | Vehicle resumes its approach |
| 48s | Time-to-collision goes critical |
| 52s | Aircraft clearance drops to PUSHBACK HOLD |
| 56s | Automatic intervention — the vehicle brakes |
| 62s | **Collision prevented** |
| 70s | Hazards clear, crews withdraw |
| 80s | Stand secure, aircraft CLEAR |

`?present=true` boots straight into presentation mode.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `P` | Presentation mode — hides every developer control |
| `D` | Debug HUD — FPS, live hazard list, TTC, risk terms |
| `C` | Simulation controls drawer |
| `M` | Mute / unmute the alert tones |
| `1`–`4` | Jump to camera preset CAM 01–04 |
| `Esc` | Close overlays and drop camera focus |

---

## Architecture

The hard rule in this codebase: **React never drives the simulation, and the simulation
never touches React.**

```
                    ┌──────────────────────────────┐
   requestAnimation │      SimulationEngine        │
   Frame  ─────────►│  tick(dt) at display rate    │
                    │                              │
                    │  ObjectRegistry   ZoneManager│
                    │  CollisionPrediction Engine  │
                    │  RiskEngine       AlertManager
                    │  SensorManager    EventLogger│
                    │  ClearanceManager            │
                    └───────┬──────────────┬───────┘
                            │              │
              snapshot()    │              │  mutable entity state
              at 10 Hz      │              │  (positions, headings)
                            ▼              ▼
                   ┌────────────────┐  ┌──────────────────┐
                   │  Zustand store │  │  R3F useFrame    │
                   │  → dashboard   │  │  → Object3D refs │
                   │    panels      │  │    (no re-render)│
                   └────────────────┘  └──────────────────┘
```

- One `requestAnimationFrame` loop in [`SimRuntime.tsx`](src/sim/SimRuntime.tsx) advances
  the engine with real elapsed time. Nothing else in the app owns a timer, which is why
  every card on screen always agrees with every other card.
- The engine publishes an immutable `SimSnapshot` at **10 Hz**. That is what the panels
  subscribe to, so React re-renders ten times a second rather than sixty.
- The 3D layer reads entity transforms **straight off `engine.registry`** inside its own
  `useFrame` and writes to `Object3D` refs. Positions never enter React state.
- Detection overlays are real DOM nodes whose screen positions are computed in the render
  loop from live world coordinates ([`DetectionOverlays.tsx`](src/three/DetectionOverlays.tsx)),
  so the boxes cannot lag a frame behind the objects they track.

### World contract

Everything downstream depends on one coordinate convention, stated once and obeyed
everywhere:

```
+X  stand right          +Y  up          -Z  aircraft nose direction
```

The aircraft is parked at the origin with its nose down `-Z`. Headings use `0 = facing -Z`,
turning positive toward `+X`. Every airframe declares the transform that maps its source
GLB into that frame ([`aircraftTypes.ts`](src/sim/aircraftTypes.ts)).

---

## The airfield around the stand

The monitored stand sits on a working airfield, not a black void. Two parallel
taxiways run across the far side of the apron with aircraft rolling along them,
under a daylight sky whose cloud deck is resolved in the shader (so it converges
toward the horizon rather than looking like wallpaper) and casts drifting shade
across the concrete.

That layer — [`TaxiTraffic.tsx`](src/three/TaxiTraffic.tsx) — is deliberately
**outside the simulation**. Taxiing traffic is not on the stand, is not tracked
by the sensor ring, and must never raise an alert or move the risk score, so it
runs in its own frame loop with no reference to the engine at all. It reuses the
two airframe GLBs that are already loaded, so it costs no extra download.

---

## Collision prediction

Implemented in [`CollisionPredictionEngine.ts`](src/sim/CollisionPredictionEngine.ts).

This is prediction, not proximity detection:

1. **Forward-integrate the vehicle** over a 14-second horizon at 34 samples. Crucially the
   vehicle is walked along the route it is *actually steering*, not extrapolated in a
   straight line — a straight-line guess badly mispredicts any vehicle mid-turn.
2. **Test against the real hull.** The aircraft is a set of named capsules taken from the
   airframe definition — nose, forward fuselage, centre fuselage, left/right wing, left/right
   engine, stabilators, fins. So the answer names the threatened part rather than emitting a
   bare distance.
3. **Extract the metrics:**
   - `ttc` — first sample where the footprint breaches the hull buffer, refined by
     interpolating between the bracketing samples
   - `dcpa` / `tcpa` — distance and time at closest point of approach
   - `distance` — current shortest gap to the hull
   - `part` — which piece of the airframe is at risk
4. **Rate it 0–10**, blending how soon (TTC), how close (DCPA and current gap), how fast,
   and how badly the threatened part would be damaged — an engine strike outweighs a
   fuselage brush.

Thresholds: **8 s** caution → **5 s** high → **3 s** critical, with automatic intervention
armed at **3.4 s**.

A vehicle below 0.15 m/s is parked, not closing, and is never assigned a TTC — otherwise
every belt loader at its working position would read as an imminent strike.

### Automatic emergency stop

When Auto Stop is armed and predicted TTC falls inside the intervention window, the engine
commands the brake, raises `AUTO INTERVENTION`, and drives the hardware emergency-stop
line. Once the vehicle is stationary it reports `COLLISION PREVENTED` with the measured
stopping distance. Nothing teleports — the vehicle decelerates at its own brake rate and
the gap in the banner is the real one.

## Risk engine

[`RiskEngine.ts`](src/sim/RiskEngine.ts) turns the live hazard list into the single 0–100
number the dashboard leads with:

```
score = peak × 6.4  +  min(Σ secondaryᵢ × 0.62ⁱ × 1.05, 16)  +  min((n−1) × 1.2, 5)  +  ambient
```

The worst single hazard dominates — one vehicle three seconds from a wing strike is an
emergency regardless of how quiet the rest of the apron is — with a bounded contribution
from everything else so simultaneous minor hazards still push the number up. The displayed
value rises fast and falls slowly, which is how an operator expects an alarm to behave.

Safety status is derived from the score, with an override: an imminent strike (TTC ≤ 2.2 s)
forces CRITICAL outright, because there is no useful "moderate" reading two seconds before
contact.

## FOD detection

Debris is a real object in the world with material, size and position. On appearing it is
**undetected** — the classifier takes a randomised 400–800 ms, modelling genuine edge
inference latency, before it commits and reports a confidence. Risk scales with material,
size, whether it sits inside the aircraft movement area, and whether it is in front of a
running engine intake. Debris inside the movement area drops clearance to HOLD.

Spawn it from the controls drawer, or arm *click apron to drop FOD* and place it by hand.

## Personnel

Four crew walk assigned patrol paths with dwell times. Zone membership and engine hazard
containment are evaluated every tick. Entering the critical area raises an intrusion
hazard; entering a live intake or jet-blast area raises a much higher engine hazard that
scales with spool.

## Safety zones

Generated from the airframe envelope in [`constants.ts`](src/sim/constants.ts), and they
are the *same polygons the engine tests points against* — what the operator sees is exactly
what the safety logic is using.

CRITICAL is deliberately a set of **non-overlapping blocks** — fuselage corridor, wing
blocks, tail blocks, nose fan — because overlapping translucent polygons compound their
alpha and turn the stand into a solid slab of colour. The three bands are cut back against
each other with polygon holes so each shows only its own ring, the way apron paint is
actually laid out.

Engine hazard areas are dormant with the engines off and expand as they spool, which is the
point: the restricted footprint around a running engine is far larger than the aircraft.

---

## Arduino UNO Q integration

The browser demo runs entirely on simulated hardware, but nothing above the hardware layer
knows that. [`src/hardware/`](src/hardware) defines one interface —
[`HardwareProvider`](src/hardware/types.ts) — with two implementations:

- **`SimulationProvider`** — derives readings from the running simulation, then adds noise,
  quantisation and dropouts so the data behaves like a real sensor ring.
- **`ArduinoProvider`** — speaks a newline-delimited JSON protocol over a WebSocket to a
  physical UNO Q, with reconnection and staleness handling.

The intended deployment maps onto the UNO Q's split architecture: the STM32 MCU samples the
proximity ring and drives the beacon, buzzer and emergency-stop relay; the Linux-capable
MPU runs a bridge that speaks this protocol.

```
->  {"t":"hello","v":1}
<-  {"t":"dist","id":"SEN-01","d":12.44,"q":0.91}
<-  {"t":"env","tc":24.1,"h":61,"p":1013,"wkt":7.2,"wdir":214}
<-  {"t":"cam","id":"CAM-01","up":1,"q":98,"ms":41,"n":6}
->  {"t":"led","c":"red","hz":2}
->  {"t":"buz","p":"critical"}
->  {"t":"estop","on":1,"why":"AeroHalo auto-stop VEH-1023"}
```

Point the dashboard at real hardware with two environment variables — no code changes:

```bash
NEXT_PUBLIC_AEROHALO_HARDWARE=arduino
NEXT_PUBLIC_AEROHALO_UNOQ_URL=ws://uno-q.local:8080/telemetry
```

The abstraction covers `distanceSensor`, `environmentSensor`, `warningLED`, `buzzer`,
`emergencyStop` and `cameraFeed`. Auto Stop already drives the emergency-stop line through
it, so the software side of the intervention is wired today.

---

## 3D assets

| Asset | Source | Notes |
| --- | --- | --- |
| `aircraft.glb` | Supplied (Sketchfab) | F/A-18E Super Hornet, 4.3k tris. Placement measured from its own vertex cloud |
| `airliner.glb` | Authored in Blender | Generic A320-class narrow-body, 35k tris, no branding |
| `gse.glb` | Authored in Blender | 13 ground-support objects, 13k tris total |
| `worker_blue.glb`, `worker_hivis.glb` | Supplied (Sketchfab) | Photogrammetry crew scans, decimated to ~15k tris and ~1 MB each |

The apron itself — concrete, markings, terminal, floodlight masts, staging props — is
procedural Three.js geometry. The concrete surface (aggregate speckle, pour variation,
rubber and oil staining, plus a derived normal map) is generated into a canvas at runtime,
so no texture files ship and there is nothing to 404.

**Optimising the crew scans.** The two supplied scans arrive at ~300k triangles and
~29 MB each, with 2048px textures and `metallic = 1` (which renders them black in a
real-time PBR scene). `scripts/optimize-models.mjs` decimates them with meshoptimizer,
resizes the textures to 1024px JPEG and fixes the material, taking the pair from 58 MB to
2 MB with no visible difference at apron viewing distance:

```bash
npm run optimize:models
```

It reads from `raw_models/` (not committed) and writes to `public/models/`. On a fresh
clone there is nothing to do — the optimised output is already checked in.

**Airframe switching.** Use the aircraft selector on the monitoring control bar. Switching
rebuilds the entire stand: zones, service routes, sensor ring positions, camera distances
and apron markings all scale with the airframe, because each one declares a `worldScale`.

> **Licensing:** the two supplied Sketchfab models are included as provided. Check their
> individual licences before redistributing this repository publicly.

---

## Project structure

```
src/
  app/                    Next.js app router, global styles, design tokens
  components/             Dashboard panels (header, columns, timeline, controls)
  sim/                    Simulation core — no React, no Three.js
    types.ts              Domain model
    constants.ts          Stand geometry, zones, routes, camera presets
    aircraftTypes.ts      Switchable airframes + collision hulls
    geometry.ts           Vector, polygon and easing maths
    SimulationEngine.ts   The tick loop and scenario/demo scripting
    CollisionPredictionEngine.ts
    RiskEngine.ts  ZoneManager.ts  AlertManager.ts
    EventLogger.ts  SensorManager.ts  ClearanceManager.ts
    ObjectRegistry.ts     Entity storage and factories
    store.ts              Zustand UI state + engine singleton
  three/                  3D layer
    Scene.tsx             Canvas, lighting, fog composition
    Apron.tsx             Concrete, markings, terminal, props
    AircraftModel.tsx  GroundFleet.tsx  Personnel.tsx  FodObjects.tsx
    SafetyZones.tsx  EngineHazard.tsx  Trajectory.tsx
    CameraRig.tsx         Presets, auto tracking, mast vibration
    DetectionOverlays.tsx AI vision boxes + projector
    Sky.tsx  concrete.ts  CameraFeed.tsx
  hardware/               HardwareProvider, Simulation + Arduino implementations
  lib/                    Formatting, severity theming, synthesised audio
public/models/            GLB assets
```

## Performance notes

- Entity rendering uses **fixed pools** with registry index → slot index mapping. Nothing
  mounts or unmounts as objects appear and disappear; slots are shown and hidden.
- Geometries and materials are module-level singletons. Instancing is used for cones,
  chocks, slab joints and terminal windows.
- Zero `setState` inside any `useFrame`.
- Alert tones are synthesised with WebAudio rather than shipped as files, and rate-limited
  so a burst of alerts cannot turn into noise.

---

Made by Awaiz Ahmed
