# Active buzzer — proximity audio alert

Sounds as an object closes on the boundary, and gets more urgent the nearer it
gets. Driven purely by the HC-SR04.

Status: **code deployed, not yet physically verified.** Wire it, then confirm.

---

## Wiring

```
                    ACTIVE BUZZER MODULE
                    (3-pin, driver on board)

     ┌─────────────────┐
     │   ●  buzzer     │
     │                 │
     │  VCC  GND  I/O  │        VCC ──────────────► UNO Q  5V
     └───┬────┬────┬───┘        GND ──────────────► UNO Q  GND
         │    │    │            I/O ──────────────► UNO Q  D11
         │    │    │
        5V   GND  D11
```

| Module pin | Also labelled | Goes to |
|---|---|---|
| VCC | `+`, `V` | UNO Q **5V** |
| GND | `-`, `G` | UNO Q **GND** (common with everything else) |
| I/O | `S`, `SIG`, `IN` | UNO Q **D11** |

No resistor needed. The module already has the driver transistor and, on most
boards, a base resistor.

### It must be a MODULE, not a bare buzzer

```
   MODULE  (correct)                BARE ELEMENT  (do NOT use on a GPIO)

   small PCB, 3 pins,               2 legs, no PCB, no transistor
   transistor + resistor            draws 30 mA or more straight
   on board                         from the pin
```

A bare buzzer element pulls far more current than a GPIO should source. If all
you have is a bare one it needs an NPN transistor and a flyback diode — do not
hang it off the pin directly.

### 5 V part, 3.3 V signal

The module is powered from **5 V** so the buzzer is loud, but D11 only drives
the transistor's base at **3.3 V**. That switches an NPN fine, and nothing 5 V
ever touches a UNO Q pin. This is the opposite direction to the HC-SR04 echo
line, which is why that one needs a divider and this one does not.

---

## If it beeps constantly the moment you power up

Your module is **active-low**. Modules ship in both senses and software cannot
tell which. One-line fix in `hardware/uno-q/app/sketch/sketch.ino`:

```c
#define BUZZER_ACTIVE_HIGH 0
```

Then `npm run unoq:start`.

To silence it entirely without unwiring anything:

```c
#define ENABLE_BUZZER 0
```

---

## Behaviour

An active buzzer has **one tone and one volume** — you cannot make it louder
from a GPIO. Urgency is carried by **rate** instead, the same way a reversing
sensor does it.

Three patterns, one per safety state, driven by the **same fused level as the
LEDs** — so what you hear and what you see can never disagree.

| State | Pattern | Repeats every |
|---|---|---|
| **SAFE** | 1 beep | 60 s |
| **CAUTION** | 10 beeps | 20 s |
| **HOLD** | 10 beeps | 10 s |
| **UNKNOWN** | silent | — |

A beep is 70 ms on, 130 ms off, so a ten-beep burst runs for two seconds.

**UNKNOWN is deliberately silent.** The system is saying it cannot see, and
inventing a confident-sounding pattern for that would be the wrong message.

The SAFE tick every minute is a liveness signal: it tells you the system is
awake without becoming background noise you stop hearing.

---

## Implementation notes

`updateBuzzer()` in `sketch.ino`, called every loop pass.

- **Non-blocking.** A chirp/gap state machine advanced from `millis()`. No
  `delay()`, no `tone()` — either would stall the loop that the sampling and
  the safe RPC handlers depend on, and the interlock runs on that loop.
- **Driven by `effectiveLevel`**, the same fused state the LEDs use, so audio
  and lights cannot contradict each other. `updateBuzzer()` runs after
  `updateOutputs()` for exactly that reason.
- Reported in telemetry as `outputs.buzzer_on` and `outputs.buzzer_gap_ms`, so
  the dashboard shows the real state rather than re-deriving it. The Outputs
  panel has a buzzer lamp beside the LEDs and prints the live chirp interval.

---

## Pin map after this change

```
D2   operator reset button (INPUT_PULLUP)
D3   GREEN LED       220-330R
D4   YELLOW LED      220-330R
D5   RED LED         220-330R
D6   HC-SR04 TRIG
D7   HC-SR04 ECHO    via 2.2k / 3.3k divider
D8   HC-SR501 OUT
D9   SG90 servo      NOT COMMISSIONED
D10  SW-420 DO
D11  Active buzzer module I/O      <-- new
```

D0 and D1 remain unused.

---

## Verifying it

1. Wire it with the board **powered off**.
2. `npm run unoq:start`
3. Leave it alone. Expect **one beep a minute** while the state is SAFE.
4. Bring an object inside 50 cm — **ten beeps every 20 seconds**.
5. Cross 20 cm — **ten beeps every 10 seconds**.
6. Watch the **BUZZER** lamp on the Outputs panel flash in time with it.

If the lamp flashes and the buzzer is silent, the wiring or the polarity is the
problem, not the code — the lamp shows what the MCU is actually driving.
