# HC-SR501 personnel / motion sensor

Detects **presence**, not identity. Nothing in AeroHalo claims to recognise a
person, count people, or tell staff from anyone else. The dashboard wording is
"Personnel / motion presence detected" for exactly that reason.

Status: **working and verified live** — the output has been observed rising on
motion and falling afterwards. Tuning notes below.

---

## Wiring

```
HC-SR501 VCC -> UNO Q 5V        (module needs >= 4.5 V; it has its own regulator)
HC-SR501 OUT -> UNO Q D8        <-- the MIDDLE pin
HC-SR501 GND -> common GND
```

### The middle pin matters

The middle pin is **OUT** on essentially every HC-SR501. The two outer pins are
VCC and GND, **and their order varies between manufacturers** — which is exactly
how this gets miswired.

This bit us during bring-up. D8 was on an outer pin, so it sat permanently HIGH
and the dashboard reported continuous motion with nobody nearby. If that
happens again, the firmware will tell you: D8 is configured `INPUT_PULLDOWN`, so
a *disconnected* wire reads LOW. A pin that has **never once been LOW since
boot** is being actively driven by something that is not a PIR output, and the
telemetry reports that as:

```
Pin never LOW since boot: D8 may not be on the OUT pin
```

If D8 lands on the module's VCC pin, that is a 5 V rail into a 3.3 V GPIO.
Power the board down before rechecking this wire.

---

## The two potentiometers

From the kit documentation:

| Control | Range |
|---|---|
| Sensitivity | detection cone **3 m to 7 m**, apex **120–140°** |
| Delay (output hold) | **3 seconds to 5 minutes** |

Output is **3.3 V when motion is detected, 0 V otherwise** — so it is safe on a
3.3 V GPIO, unlike the HC-SR04 echo line.

Two consequences worth planning around:

1. **A long hold is a setting, not a fault.** An output held high for two
   minutes is the delay pot doing its job. The firmware measures the hold and
   reports it rather than guessing.
2. **At full sensitivity it sees the whole room.** A 7 m, 140° cone on a table
   at a busy venue will detect people almost continuously — and it is not wrong
   to do so. For a demonstration, turn sensitivity down and aim the dome along
   the approach lane rather than at the audience.

The pot layout is not consistent between manufacturers either. Identify them
empirically: turn one fully anti-clockwise and watch `pir.high_for_ms`. If the
hold time collapses, that was the delay pot.

---

## Firmware behaviour

`hardware/uno-q/app/sketch/sketch.ino`

- **30 s warm-up** after power-on (`PIR_WARMUP_MS`). The output floats while the
  module settles, and without this the app would open with a burst of fake
  intrusions. Reported as `warming_up`, and no personnel alert is raised.
- **1.2 s stretch** (`PIR_STRETCH_MS`) so a short pulse cannot slip between two
  10 Hz polls.
- Raw pin state and continuous-high duration are published, so a held output can
  be told apart from repeated genuine motion.

## Fusion behaviour

`hardware/uno-q/app/python/`

- Motion contributes **+35** to the risk score and raises the state to CAUTION.
- It does **not** force HOLD on its own. Personnel near the stand is a reason to
  slow down, not automatically to latch an interlock.
- It **does** block an operator reset: `clear_after_inspection` is refused while
  motion is present.
- After **60 s** of continuous high (`PIR_HELD_AFTER_MS`) it stops counting
  toward the score. A held output cannot distinguish "someone is still there"
  from "something triggered it four minutes ago", so it is no longer treated as
  evidence of *current* presence. It is still shown, labelled `OUTPUT HELD`.
- A sensor in that state is not counted in `sensors_online`, so the 3/3 figure
  only ever counts sensors whose answers are actually usable.

## Events

Logged on the **edge**, not per poll:

```
INFO      PIR ready (warm-up complete)
HIGH      Personnel / motion detected
INFO      Personnel zone clear
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| motion reported constantly, `never_low` true | D8 not on the middle (OUT) pin |
| motion reported constantly, `never_low` false | sensitivity too high for the room, or delay pot long |
| never triggers | VCC below 4.5 V, or still inside the 30 s warm-up |
| triggers on nothing in particular | heat sources, direct sun, moving air; it is an infrared sensor |
