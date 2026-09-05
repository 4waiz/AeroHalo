# AeroHalo demo runbook

Everything here is a real command or a real physical action. Nothing is
aspirational; anything not yet proven is marked.

---

## Before the judges arrive

### 1. Bring the board up

Connect the UNO Q by USB-C and wait for it to finish booting (about 40 s).

```bash
adb devices
```

One device in state `device`. If the list is empty the board is not booted or
the cable is charge-only.

### 2. Start the board application

```bash
adb shell arduino-app-cli app start user:aerohalo_range
```

Expect `aerohalo-flash: wrote … on attempt 1` and the app to reach `running`:

```bash
adb shell arduino-app-cli app list | grep aerohalo
```

### 3. Link the laptop to the board and read the token

```bash
npm run unoq:token
```

This asserts the adb port forward, verifies `/api/state` answers, and prints a
line like `AEROHALO_UNOQ_TOKEN=…`. Put that line in `.env.local`.

**The token changes every time the board app restarts.** If the operator
buttons return 401, re-run this and restart the dev server.

### 4. Start the dashboard

```bash
npm run dev
```

Open **http://localhost:3000**.

### 5. Confirm the pipeline before you present

```bash
curl -s http://127.0.0.1:7000/api/state
```

`connected` must be `true` and `distance_cm` must be a number that changes when
you wave a hand in front of the sensor. If `connected` is `false`, the Linux
side is up but the MCU is not answering — reflash with step 2.

---

## Physical setup

- Sensor on the table, pointing along a clear run of at least 1 m.
- A flat target (a book or clipboard works; a hand is fine) to move toward it.
- Nothing within 50 cm at rest, or the demo starts in CAUTION.

Boundaries, which are **tabletop demonstration values, not aviation standards**:

| Range | State |
|---|---|
| > 50 cm | SAFE |
| 20–50 cm | CAUTION |
| ≤ 20 cm | HOLD (latching) |
| no echo | UNKNOWN — never SAFE |

---

## The demonstration

### Act 1 — the digital airside (SIMULATION)

Open on **SIMULATION**. The apron, the aircraft, ground vehicles, personnel,
FOD, the risk heatmap and the scripted intervention all run here.

> "This is the digital airside environment. Everything moving here is
> simulated, and the dashboard says so."

Run a scenario from the simulation controls if you want the intervention beat.

### Act 2 — switch to the real board

Click **LIVE HARDWARE** in the header.

The header badge changes to **UNO Q ONLINE**. The left column stops showing a
sensor fleet and shows **1 / 1 Range Sensor Online**. There is no AI-accuracy
figure anywhere in this mode, because nothing in this build measures one.

> "Same interface, but now every number comes from that board on the table.
> Anything it cannot measure says UNAVAILABLE rather than guessing."

### Act 3 — move the target

Centre view is on **RANGE BEAM**. Move the target slowly toward the sensor.

Distance falls: 73 → 55 → 42 → 31 cm. The marker slides along the corridor and
crosses from the green band into amber at 50 cm.

> "This marker is one-dimensional on purpose. An ultrasonic sensor measures
> distance along one axis; it does not know where the object is sideways, so we
> do not draw it somewhere it has not measured."

### Act 4 — the prediction, which is the point

Keep moving at a steady pace. Before the target reaches 20 cm, the panel shows
**Predicted boundary entry in N s** and the status escalates.

> "This is the differentiator. It is not reacting to a breach; it is estimating
> when the boundary will be crossed and escalating first."

- ≤ 4 s → predictive CAUTION
- ≤ 2 s → predictive HOLD

### Act 5 — HOLD latches

Cross 20 cm. Status goes **HOLD**, red, and the on-board RGB LED turns red.

### Act 6 — HOLD does not clear itself

Pull the target well back, past 50 cm.

The status stays **HOLD**.

> "Removing the hazard does not clear the hold. Something entered the exclusion
> zone, and that needs a human to look."

### Act 7 — operator reset

Press **Reset after inspection**. Confirm the dialog.

The MCU will still refuse unless the range has been steady beyond 50 cm for
2 seconds — if you rush it you will see the refusal, which is worth showing.

Status returns to **SAFE**.

### Act 8 — camera

Switch the centre view to **OV7670**.

**Current state: this shows `OV7670 OFFLINE — No valid camera frames received`.**
That is honest and it is fine to show. Say what it is:

> "The camera is a raw parallel module, not a USB webcam, so it needs the
> STM32's camera peripheral rather than the standard video brick. It is brought
> up over SCCB first and the dashboard refuses to display a feed until the
> board reports real frames."

Do not claim a live feed or any detection until `HARDWARE_STATUS.md` §7 records
those as passing.

---

## Failure recovery, mid-demo

| Symptom | Cause | Fix |
|---|---|---|
| Header shows **UNO Q OFFLINE** | USB dropped or app stopped | reseat USB, `adb devices`, then `arduino-app-cli app start user:aerohalo_range` |
| **TELEMETRY STALE** | MCU stopped answering | reflash: `arduino-app-cli app restart user:aerohalo_range` |
| Status stuck **UNKNOWN**, distance UNAVAILABLE | no echo — target too close (< 2 cm), too angled, or an Echo wire off | aim at a flat surface 30–80 cm away; check the D7 divider |
| Operator buttons return 401 | token rotated on app restart | `npm run unoq:token`, update `.env.local`, restart `npm run dev` |
| Dashboard blank after a build | `npm run build` overwrote the dev server's `.next` | stop dev, `rm -rf .next`, `npm run dev` |
| Distance jitters | normal ultrasonic noise | the raw ping is shown next to the filtered value on purpose |

**Do not** run `npm run build` while `npm run dev` is serving the demo. They
share `.next` and the running server will start throwing chunk errors.

---

## What to say if asked "is this real?"

- The distance, approach speed, predicted entry, HOLD latch and the LED are
  real measurements and real hardware behaviour.
- The apron, aircraft, vehicles, personnel and FOD are simulation, clearly
  labelled, and never shown as measurements in LIVE mode.
- It is a tabletop prototype. It is not certified, it does not issue clearance,
  and it has no authority over any real aircraft.

---

## Safety

- Servo, DC motor, stepper and buzzer are compiled out. Nothing moves.
- Never rewire while the board is powered.
- The HC-SR04 Echo divider must stay. Echo is 5 V; D7 is a 3.3 V pin.
- The OV7670 is a 3.3 V part. Do not put 5 V on its logic.
