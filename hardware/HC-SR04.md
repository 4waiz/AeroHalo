# HC-SR04 ultrasonic range sensor

The one sensor that carries the live demonstration. Status: firmware written and
compiling; **live readings on the dashboard not yet confirmed** (see
`HARDWARE_STATUS.md` §7).

---

## Wiring

```
HC-SR04 VCC  -> UNO Q 5V
HC-SR04 GND  -> UNO Q GND
HC-SR04 TRIG -> UNO Q D6

HC-SR04 ECHO -> 2.2 kohm -> junction -> UNO Q D7
                              |
                           3.3 kohm
                              |
                             GND
```

### The divider is not optional

HC-SR04 Echo drives a **5 V** logic high. UNO Q D7 is a **3.3 V** input.
Connecting Echo directly risks damaging the pin.

```
5 V x 3.3k / (2.2k + 3.3k) = 3.0 V
```

3.0 V is comfortably above the input's logic-high threshold and safely below
its maximum.

Software cannot check a resistor value or a physical pin placement. This
document records wiring **as reported and photographed by the operator**, not as
electrically measured.

Never rewire while the board is powered.

---

## Firmware behaviour

`hardware/uno-q/app/sketch/sketch.ino`

### Sampling

- 10 Hz (`SAMPLE_MS = 100`)
- 10 µs trigger pulse, per the datasheet
- **Both** echo waits are bounded: 30 ms waiting for the rising edge, 25 ms for
  the pulse width. Worst case 30 ms, so a missing or stuck Echo line can never
  hang the MCU.
- `mm = us * 343 / 2000` (343 m/s, round trip halved)

### Validity

A reading counts only if it is between 20 mm and 4000 mm. Anything else —
including a timeout — sets `valid = false`.

**An invalid reading is UNKNOWN. It is never reported as 0 cm and never as
SAFE.** On invalid, the filter state is cleared so a stale value cannot leak
back out when echoes return.

### Filtering

Median-of-3, then a light EMA (`alpha = 0.5`). Enough to take the edges off
ultrasonic noise, light enough that the marker still tracks a moving hand
without visible lag. The unfiltered ping is published alongside as
`raw_distance_cm` so the noise is visible rather than hidden.

### Safety states

| Condition | Result |
|---|---|
| ≤ 20 cm | HOLD, latched on the MCU |
| 20–50 cm | CAUTION |
| > 50 cm | SAFE |
| no valid echo | UNKNOWN (never SAFE) |
| no valid echo for > 1.5 s | escalates to HOLD |
| Linux silent for > 1.5 s | MCU latches HOLD on its own |

HOLD **latches**. Moving the object away does not clear it.

### Release

Requires all of:

1. an explicit operator `clear_after_inspection` command,
2. a valid reading beyond 50 cm,
3. that condition held continuously for **2 seconds**,
4. the MCU's own independent level check agreeing.

The MCU re-checks conditions 2–4 itself, so Linux cannot talk it into an unsafe
release. A refused reset is reported back and logged.

### What the latch does not guarantee

The 1.5 s watchdog is a **software** timeout. It does not guarantee anything
during total power loss or a hardware fault, and there is no position-feedback
sensor anywhere in this build. A HOLD state is a logic state, not proof that
something physical stopped.

---

## Prediction

Closing speed comes from a least-squares fit over up to 0.8 s of samples,
timestamped with the **MCU's own `millis()`** rather than host receive time, so
Linux scheduling and HTTP jitter do not distort it.

Guards, all in `risk.py`:

- fewer than 4 samples, or a baseline under 0.29 s → speed 0
- a gap over 0.5 s, a negative dt (millis rollover or reboot), or apparent
  motion over 2 m/s → window cleared rather than fitted
- duplicate sequence numbers reuse the existing fit instead of adding a
  zero-dt point
- a receding target reports 0, never a negative speed

```
time_to_boundary = (distance_cm - 20) / closing_speed_cm_per_s
```

Computed **only** when the target is outside 20 cm and closing faster than
2 cm/s. Otherwise it is `null`, which the UI renders as "Not approaching" —
deliberately different from UNAVAILABLE, which means "we do not know".

| Predicted entry | Escalation |
|---|---|
| ≤ 4 s | CAUTION |
| ≤ 2 s | HOLD |

This is time to a **configured boundary**, not a time to collision with
anything, and it is labelled "Predicted boundary entry" everywhere it appears.

---

## Testing

Off-board logic tests:

```bash
npm run test:hardware
```

Covers the distance bands, the prediction thresholds, no-echo handling,
duplicate sequence numbers, implausible jumps and receding targets.

These are **software** tests. Passing them says the maths is right; it says
nothing about whether the sensor is wired correctly.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| always UNKNOWN | Echo not reaching D7 — check the divider junction, and that the 3.3k goes to GND |
| always ~2 cm or nonsense | Trig and Echo swapped |
| works close, UNKNOWN far away | target too angled; ultrasound needs a flat surface facing the sensor |
| very noisy | soft or curved target, or a nearby reflective surface |
| nothing at all | sensor VCC on 3.3 V instead of 5 V |
