# AeroHalo hardware

The physical edge layer of AeroHalo. This directory is the **source of truth**
for the firmware and the board application; the copy running inside Arduino App
Lab on the UNO Q is a deployment of what is here, not the other way round.

Tabletop prototype. Not certified aviation equipment.

---

## Layout

```
hardware/
  README.md          this file
  HC-SR04.md         range sensor: wiring, firmware behaviour, prediction, tests
  OV7670.md          camera module: why it is not a webcam, and the bring-up order
  uno-q/
    app/             the Arduino App Lab application, deployed to the board
      app.yaml       app manifest (declares the web_ui brick)
      python/        Linux-side application: telemetry, risk, HTTP API
        main.py      poll loop, /api/state, /api/events, /api/command
        config.py    boundaries and timing, all in one place
        risk.py      closing speed, prediction, deterministic risk score
      sketch/        MCU firmware
        sketch.ino   HC-SR04 sampling, filtering, HOLD latch, watchdog, LED
        sketch.yaml  build profile — this is where the MsgPack fix lives
    tests/
      test_risk.py   off-board logic tests (npm run test:hardware)
```

---

## Architecture

```
        HC-SR04                     (5 V sensor, 3.0 V divided Echo)
           |
           v
     STM32U585 MCU                  sketch.ino
           |                        10 Hz sampling, median+EMA, HOLD latch,
           |                        1.5 s link watchdog, RGB warning LED
           v
    Arduino Bridge (RPC)            provide_safe: handlers run in loop context
           |
           v
     UNO Q Linux app                main.py
           |                        prediction, event log, HTTP API on :7000
           v
     adb port forward               laptop cannot reach the board over Wi-Fi
           |
           v
   Next.js /api/unoq/* proxy        keeps the controller token server-side
           |
           v
   AeroHalo dashboard               LIVE HARDWARE mode
```

The split is deliberate: the MCU owns anything that must stay safe when Linux
stops responding, Linux owns anything that needs history or arithmetic, and the
browser owns nothing but presentation.

---

## Deploy to the board

From a machine with `adb` and the board connected by USB:

```bash
adb push hardware/uno-q/app/. /home/arduino/ArduinoApps/aerohalo_range/
adb shell arduino-app-cli app restart user:aerohalo_range
```

Then verify — do not assume:

```bash
adb shell arduino-app-cli app list | grep aerohalo     # expect: running
adb shell 'curl -s http://127.0.0.1:7000/api/state'    # expect: connected true
```

Full first-run sequence, including the token and the dashboard, is in
[`DEMO_RUNBOOK.md`](../DEMO_RUNBOOK.md).

---

## The two board modifications

Two files were added to the board to make flashing work from the CLI. Both are
reversible and both are explained in `HARDWARE_STATUS.md` §4:

- `…/hardware/zephyr/0.51.0/platform.local.txt`
- `~/.local/bin/aerohalo-flash.sh`

They exist because the stock upload recipe passes an empty `-s` serial number
when `arduino-app-cli` runs on the board itself, and because RAM-mode upload
reads a load address of `0x00000000` on this board. If flashing from App Lab
desktop works, prefer that and delete `platform.local.txt`.

---

## What is enabled

| Component | State |
|---|---|
| HC-SR04 ultrasonic | **enabled** — the live demonstration |
| On-board RGB LED3 | **enabled** — red HOLD, amber caution, green safe, blue unknown |
| OV7670 camera | wired, **not yet brought up** — see `OV7670.md` |
| SG90 servo | compiled out (`ENABLE_SERVO 0`) |
| DC motor / stepper | compiled out |
| Buzzer | compiled out |

Nothing in this build moves. No actuator is energised, and no unidentified 5 V
load is driven from a GPIO.

---

## Ground rules

- Never rewire while the board is powered.
- The HC-SR04 Echo divider stays. Echo is 5 V; D7 is a 3.3 V pin.
- The OV7670 is a 3.3 V part.
- Missing data is UNKNOWN or HOLD, never a reassuring green state.
- A queued command is not a confirmed hardware action.
- Arduino IDE and App Lab must not both own the MCU. App Lab is the chosen path.
