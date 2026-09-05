# Active buzzer — proximity audio alert

Sounds as an object closes on the boundary, and gets more urgent the nearer it
gets. Driven purely by the HC-SR04.

Status: **code deployed, not yet physically verified.** Wire it, then confirm.

---

## Wiring — BARE 2-PIN ELEMENT (what is on this build)

A bare buzzer has no driver transistor, so it pulls its **full operating
current through the GPIO**. That is 20–30 mA against an STM32U585 limit of
**20 mA per pin**. It needs a series resistor. This is not optional.

```
   UNO Q D11 ──[ 330 Ω ]──┬── buzzer (+, longer leg / marked side)
                          │
                          └── buzzer (−) ── UNO Q GND
```

| From | Through | To |
|---|---|---|
| **D11** | **330 Ω** | buzzer **+** |
| buzzer **−** | — | **GND** |

330 Ω holds the worst case near **10 mA**, comfortably inside spec. **220 Ω**
is louder and still acceptable. Anything less is not.

It will be quieter than a 5 V module. That is the trade for not degrading the
pin — and GPIO over-current damage is cumulative and silent: the pin does not
fail loudly, it just gets weaker over time.

### Active or passive? — it no longer matters

Two legs in a black case look identical either way, and no amount of software
can tell them apart. So the firmware stops trying. `BUZZER_DRIVE 2` — the
default — drives **both** ways inside every chirp: 35 ms of steady DC, then
35 ms of ~2.7 kHz square wave.

- An **active** element sounds through the first half.
- A **passive** one sounds through the second.

Either way you hear a 70 ms chirp, and an unlabelled buzzer out of a kit bag
just works. If you have identified the part and want it driven cleanly, set
`BUZZER_DRIVE 0` (active) or `1` (passive) in `sketch.ino`.

### Which one is it? — press TEST and listen

- **Active** — has its own oscillator, sounds on DC. This is what the default
  code assumes.
- **Passive** — just a transducer, needs a square wave. On DC it only *clicks*.

Two legs and a black case look identical either way, and software cannot tell
them apart. So it doesn't guess. The **TEST** button on the Outputs panel walks
the LEDs and sweeps the buzzer at the same time:

| LED lit | Buzzer driven with | Sounds if the part is |
|---|---|---|
| **GREEN** | steady DC | **active** |
| **YELLOW** | nothing | *(deliberate gap)* |
| **RED** | ~2.7 kHz square wave | **passive** |

The whole sweep runs 1.5 s. On the default `BUZZER_DRIVE 2` you do not need
this to make the buzzer work — but it is still the fastest way to tell a
**silent** buzzer from a **miswired** one:

- **Sound on green** → active element. Optionally set `BUZZER_DRIVE 0`.
- **Sound on red** → passive element. Optionally set `BUZZER_DRIVE 1`.
- **Nothing on either, but the LEDs walk** → the MCU *is* driving D11 and the
  element is not responding. The fault is **wiring or polarity**, not code.
- **Nothing, and the LEDs don't walk** → the board isn't running the test at
  all. Check the link, not the buzzer.

That third case is the one worth having. Without the sweep, a dead buzzer and a
buzzer the code never reaches look exactly the same from across a table.

When a tone is involved it is bit-banged from the main loop, so it warbles
slightly whenever the ultrasonic sensor is waiting on an echo timeout.

---

## Wiring — 3-PIN MODULE (preferred, if the kit has one)

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

No resistor needed — the module has the driver transistor on board, so D11 only
switches a base and the pin sees almost no load. Louder than the bare element
too, because the buzzer runs from 5 V rather than from a current-limited pin.

```
   MODULE                           BARE ELEMENT

   small PCB, 3 pins,               2 legs, no PCB
   transistor on board              needs the 330 Ω above
   D11 switches a base              D11 carries the load
```

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
| **SAFE** | silent | — |
| **CAUTION** | 10 beeps | 20 s |
| **HOLD** | 10 beeps | 10 s |
| **UNKNOWN** | silent | — |

A beep is 70 ms on, 130 ms off, so a ten-beep burst runs for two seconds.

**The buzzer only sounds when a light is amber or red.** An alarm that fires
while everything is fine is noise people learn to tune out, which is precisely
when you need them to hear it. Silence carries information here: it means the
lights are green.

**UNKNOWN is deliberately silent too.** The system is saying it cannot see, and
inventing a confident-sounding pattern for that would be the wrong message. The
LEDs still alternate amber and red, so the state is never hidden — it just
isn't shouted.

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
3. Press **TEST** on the Outputs panel and run the sweep above. That alone
   settles active-vs-passive-vs-miswired.
4. Leave it alone. Expect **silence** while the state is SAFE.
5. Bring an object inside 50 cm — **ten beeps every 20 seconds**.
6. Cross 20 cm — **ten beeps every 10 seconds**.
7. Watch the **BUZZER** lamp on the Outputs panel flash in time with it.

If the lamp flashes and the buzzer is silent, the wiring or the polarity is the
problem, not the code — the lamp shows what the MCU is actually driving.
