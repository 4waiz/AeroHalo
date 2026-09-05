# Genspark prompt — AeroHalo deck (INSPIRE '26)

Paste everything below the line into Genspark.

Every number in it was measured on the built prototype, not estimated. Anything
not verified is marked NOT IMPLEMENTED and must not appear as a capability.

---

## INSTRUCTIONS TO GENSPARK

Build a **16:9 PowerPoint, exactly 6 slides**.

**Photos:** I am attaching real photographs of the working prototype and real
screenshots of the live dashboard. **Use the attached images — do not generate
substitutes for them.** They are the proof the judges care about.

**All other graphics:** generate with **Nano Banana** — schematics, the pinout
diagram, the architecture diagram, zone diagrams, icons, the top-down aircraft
stand. Aim for engineered CAD/technical-illustration quality, not stock art and
not obviously-AI illustration.

**Attached image inventory and where each belongs:**

| Image | Slide | Use as |
|---|---|---|
| Foam-board airport diorama, wide, model aircraft + runway + terminal | 1 or 6 | hero shot of the physical build |
| Top-down, board + breadboard on the diorama, GREEN and RED LEDs lit | 5 or 6 | proof the LEDs are physically driven |
| Close-up: HC-SR04 + HC-SR501 mounted on the model aircraft nose, LEDs lit | 3 or 6 | proof of real sensor integration |
| Dashboard screenshot, LIVE HARDWARE mode, 3/3 sensors | 4 or 6 | proof the software reads real hardware |

---

## PROJECT

**AeroHalo — Predictive Airside Safety**
INSPIRE '26 · Engineering the Invisible · Arduino UNO Q Hackathon
American University of Sharjah · University Challenge: **Smart Aviation Systems**
Creator: **Awaiz Ahmed**

Tagline:

> Don't just detect the hazard.
> Predict the seconds before it happens.

Tabletop prototype. Demonstration thresholds, **not certified aviation safety
distances**.

---

## SCORE THE RUBRIC, NOT THE SLIDES

| Category | Points | Deck weight |
|---|---|---|
| Technical implementation & reliability | **35** | Slides 3 and 5 — the most detailed |
| Innovation & engineering creativity | **25** | Slide 4 |
| Impact & use-case relevance | **20** | Slide 2 |
| Prototype & live demonstration | **15** | Slide 6, then hand over to the table |
| Presentation & communication | **5** | keep every slide sparse |
| Bonus | up to 5 | folded into slide 5 |

Presentation is worth 5 points and the prototype 15, so the deck must be
**~3 minutes** and get out of the way. Max 25–35 words on most slides.

Do not invent scoring criteria beyond these.

---

## VERIFIED HARDWARE (all present and working)

- **Arduino UNO Q** — dual compute: STM32U585 Cortex-M33 MCU + Linux (Debian 13, aarch64)
- **HC-SR04** ultrasonic — distance, closing speed, predicted boundary entry
- **HC-SR501** — call it **Personnel / Motion Presence Sensor**
- **SW-420** — call it **Abnormal Vibration / Possible Impact Sensor**
- **Three status LEDs** — green / yellow / red, driven from the fused state
- **AeroHalo Next.js dashboard** — 3D digital twin and command interface

### Pin map (draw this exactly)

```
D3   GREEN LED    -> 220-330R -> LED -> GND
D4   YELLOW LED   -> 220-330R -> LED -> GND
D5   RED LED      -> 220-330R -> LED -> GND
D6   HC-SR04 TRIG
D7   HC-SR04 ECHO -> through 2.2k / 3.3k divider
D8   HC-SR501 OUT (middle pin)
D9   SG90 servo   -- NOT COMMISSIONED, compiled out
D10  SW-420 DO
D2   operator reset button, INPUT_PULLUP
```

### The voltage divider — give this real visual space

```
HC-SR04 ECHO  ──[ 2.2 kΩ ]──┬── D7
                            │
                       [ 3.3 kΩ ]
                            │
                           GND
```

**Why:** HC-SR04 Echo drives **5 V**. UNO Q GPIO is **3.3 V**.

`5 V × 3.3 / (2.2 + 3.3) = 3.0 V` — above logic-high, safely under the limit.

This is the single clearest piece of electrical engineering in the project and
technical implementation is worth 35 points. Make it legible from the back row.

---

## MEASURED PERFORMANCE — use these exact figures

| Metric | Measured |
|---|---|
| MCU sample rate | **9.9–10.0 Hz** |
| Bridge round trip, MCU to Linux | **~25 ms** |
| Dashboard HTTP round trip | **~38 ms** |
| MCU firmware footprint | **23,432 bytes — 1% of 1,966,080** |
| MCU RAM | **4,792 bytes — 0%** |
| Telemetry payload | **176 bytes worst case, in a 256-byte RPC buffer** |
| Sensors online | **3 / 3** |
| Worst-case echo timeout | **30 ms — the MCU cannot hang** |

Real logged readings to quote: `78.4 cm`, `43.7 cm`, `36.5 cm`, `10.2 cm`.
Real logged predictions: `3.5 s`, `2.1 s`, `1.7 s`, `1.1 s`.

---

## ARCHITECTURE (slide 3 — premium diagram, Nano Banana)

```
   HC-SR04            HC-SR501            SW-420
   Distance           Personnel           Vibration
       \                  |                  /
        \                 |                 /
         └────────  SENSOR FUSION  ────────┘
                          │
                   Arduino UNO Q
              STM32U585 MCU  +  Linux
                          │
                    RISK ENGINE
                          │
              SAFE / CAUTION / HOLD
                          │
              ┌───────────┴───────────┐
              │                       │
      AeroHalo Dashboard       Physical Output
                                GREEN / YELLOW / RED
```

Make **SENSOR INPUT → ARDUINO PROCESSING → PHYSICAL OUTPUT** unmistakable. It
is named explicitly in the rubric.

Worth a callout: the split is deliberate. The **MCU** owns everything that must
stay safe if Linux stops responding — sampling, the latch, the LEDs, a 1.5 s
watchdog. **Linux** owns history and arithmetic. The **browser** owns nothing
but presentation.

---

## PREDICTIVE LOGIC (slide 4 — the innovation slide)

```
Time to Boundary  =  (Distance − Critical Boundary) ÷ Closing Speed
```

Closing speed is a least-squares fit over 0.8 s of samples, timestamped with
the **MCU's own clock**, so Linux scheduling and HTTP jitter cannot distort it.

| Range | State |
|---|---|
| > 50 cm | SAFE |
| 20–50 cm | CAUTION |
| ≤ 20 cm | HOLD |

| Predicted boundary entry | Escalation |
|---|---|
| ≤ 4 s | CAUTION |
| ≤ 2 s | HOLD |

Label it **PREDICTED BOUNDARY ENTRY**. Never "collision prediction".

Only computed for a target outside the boundary closing faster than 2 cm/s.
Otherwise it reads "Not approaching" — which is different from "unknown", and
the dashboard says so.

---

## SENSOR FUSION — ONE state, explainable (slide 4)

Deterministic and additive, clamped 0–100. **Show the real weights:**

| Contribution | Points |
|---|---|
| Object in caution band (20–50 cm) | +30 |
| Object inside critical boundary (≤20 cm) | +60 · forces HOLD |
| Predicted entry ≤ 4 s | +25 · floors level at CAUTION |
| Predicted entry ≤ 2 s | +50 · forces HOLD |
| Personnel **alone** | +10 · stays SAFE |
| Personnel **while an object is inside a boundary** | +35 |
| Single vibration event | +20 · not confirmed |
| **Confirmed** impact (2 events within 2.5 s) | +55 · forces HOLD |

Bands: **0–29 SAFE · 30–69 CAUTION · 70–100 HOLD**

**The context-weighted personnel rule is worth calling out.** Ground crew
standing near a stand is the *normal* state of an airside. Scoring that as a
caution means the system cries wolf and gets ignored. It carries full weight
only when something is *also* approaching — that is the combination that hurts.

Worked example for the slide:

```
Distance        34 cm
Boundary ETA    2.8 s
Personnel       DETECTED
Vibration       NORMAL
        ↓
RISK  78 / 100
        ↓
      HOLD

WHY HOLD?
  +30  object inside the caution boundary
  +35  personnel present while an object is inside
  +50  predicted boundary entry in 2.8 s   → forces HOLD
```

Every state on the real dashboard carries this **WHY** list. Nothing is a black
box and no number is random.

---

## RELIABILITY — FAIL SAFE, NOT FAIL SILENT (slide 5, 35-point category)

Use that phrase as the slide title. All of the following are implemented:

| Condition | Behaviour |
|---|---|
| No echo, sensor never proven | **UNKNOWN** — never SAFE |
| No echo, sensor already proven working | **CLEAR** — an empty corridor, honestly labelled |
| Stale telemetry (> 2 s) | **UNKNOWN**, fail-safe |
| Linux goes quiet > 1.5 s | MCU latches HOLD **on its own** |
| Single bad ping | rejected — boundary must be breached on 3 consecutive samples |
| PIR power-on | **30 s warm-up**, no alerts raised |
| PIR output held by its delay pot | detected, excluded from the score, labelled |
| SW-420 polarity | **learned at boot**, never assumed — this unit: active-high |
| Single knock | +20, logged as minor, **does not latch** |
| Confirmed impact | latches HOLD |
| HOLD | **latched** until operator inspection |
| Startup | never shows green before a sensor is validated |
| Power-on | **lamp test** walks green → yellow → red, 500 ms each |
| Unwired sensor pin | pulled down, so a loose wire reads "nothing", not noise |

Two details that show real engineering judgement:

- **Both echo waits are bounded** (30 ms / 25 ms). A missing or shorted Echo
  line cannot hang the microcontroller.
- **An ultrasonic sensor cannot tell "nothing is there" from "I am broken"** —
  both are silence. AeroHalo resolves it by asking whether the sensor has ever
  returned a reading and is still sampling. Proven-and-silent is clear;
  never-proven-and-silent is UNKNOWN.

### Bonus points — all truthful

**LOW COST** commodity sensors · **MODULAR** spare GPIO for more nodes ·
**EDGE-FIRST** all safety logic on the board, no cloud · **SCALABLE** one node
per stand · **SAFETY** fail-safe plus human reset · **RESOURCE EFFICIENT** 1%
flash, 0% RAM

Do **not** make environmental sustainability claims.

---

## HUMAN IN THE LOOP (slide 4 or 5)

```
Hazard detected → HOLD → hazard removed → STILL HOLD
                                              ↓
                                   Operator inspection / reset
                                              ↓
                                             SAFE
```

> **Safety requires confirmation, not assumption.**

The MCU re-checks the release conditions **independently** — corridor clear,
steady 2 s, no active vibration. Linux cannot talk it into an unsafe release,
and there is deliberately no bypass.

---

## PHYSICAL OUTPUT

| State | GREEN | YELLOW | RED |
|---|---|---|---|
| SAFE | ON | off | off |
| CAUTION | off | ON | off |
| HOLD | off | off | ON |
| UNKNOWN / fault | off | alternating | alternating |

LED states are **read back from the MCU** into the dashboard, so the lights on
the table and the panel on screen cannot disagree.

**SG90 servo (D9): NOT COMMISSIONED.** Compiled out with `ENABLE_SERVO 0`.
Show it on the pinout as a planned expansion only. Do not claim barrier
movement, and do not imply it. There is no position feedback in this build, so
a servo command would not be proof of a barrier position anyway.

**No camera in this build.** Do not show or imply camera vision, object
classification, or any AI accuracy figure.

---

## USE CASE (slide 2)

Users: ground operations teams · ramp safety personnel · turnaround coordinators

Hazards: ground vehicle approaching an aircraft · personnel entering a
restricted area · abnormal impact or vibration event

Frame it as **Smart Aviation Systems**, not a generic Arduino project.

Key line: *airside environments put multiple moving hazards within metres of
high-value aircraft, and the window to react is seconds.*

Question to leave hanging: **Can we identify risk before the boundary is
crossed?**

---

## ENGINEERING TRADE-OFFS (slide 5 panel)

Title: **ENGINEERED FOR RELIABILITY UNDER HACKATHON CONSTRAINTS**

Deliberate scope control, not missing features:

- HC-SR04 for range that demonstrably works, over a camera that might not
- PIR for personnel presence **independent** of the range sensor
- SW-420 for physical-event detection the other two cannot see
- UNO Q for edge processing, no cloud dependency
- Next.js dashboard for depth of visualisation
- Plain LEDs for state you can read across a room with no screen

One honest sentence worth including: *a camera path was scoped, evaluated
against the time available, and deliberately cut in favour of three sensors
that work reliably.*

---

## SLIDE STRUCTURE — 6 slides, no more

**1 · AEROHALO** — Predictive Airside Safety. Tagline. Nano Banana top-down
aircraft stand with green/amber/red zones, or the diorama photo. Tiny footer:
`INSPIRE '26 | Smart Aviation Systems | Made by Awaiz Ahmed`

**2 · SECONDS MATTER ON THE GROUND** — the problem. Aircraft, personnel,
vehicles, service equipment. Almost no text. End on the question.

**3 · ENGINEERING AEROHALO** — the 35-point slide. Architecture diagram,
pinout, the voltage divider, the MCU/Linux split, measured figures. Densest
slide in the deck.

**4 · PREDICT. FUSE. EXPLAIN.** — the 25-point slide. Boundary-ETA formula, the
fusion table, the worked example with its WHY list, the latched human-in-loop
cycle.

**5 · BUILT TO FAIL SAFE** — reliability table, `FAIL SAFE, NOT FAIL SILENT`,
trade-offs panel, bonus strip.

**6 · LIVE DEMONSTRATION** — prototype photo + dashboard screenshot, one huge
flow `PHYSICAL WORLD → UNO Q → AEROHALO`, and the demo sequence:

```
01  SAFE       object far           GREEN
02  CAUTION    object approaches    YELLOW
03  PREDICT    boundary ETA falls   RED · HOLD
04  PERSONNEL  PIR triggers
05  IMPACT     vibration → inspection HOLD
06  RESET      operator clears the system
```

Bottom line: *Rather than tell you AeroHalo works, let us show you.*

---

## DESIGN

16:9 · dark aerospace command-centre · near-black / dark navy ground · cyan
technical accents · safety green / amber / red used **only** for state.

Aircraft top views, clean schematics, real prototype photography, real
dashboard screenshots, sensor icons, signal-flow arrows.

Large visual hierarchy, minimal text. No corporate stock photos, no cartoons,
no generic AI-illustration look. **It should read as engineered, not
generated.**

---

## TRUTHFULNESS — non-negotiable

Never claim: airport certification · deployment on a real aircraft · guaranteed
collision prevention · AI accuracy percentages · camera vision · 12 sensors ·
6 cameras · a working servo barrier.

Never present simulation output as hardware measurement.

Naming, exactly:
- HC-SR501 → **Personnel / Motion Presence Sensor** (presence only; it cannot
  identify anyone)
- SW-420 → **Abnormal Vibration / Possible Impact Sensor**
- HC-SR04 prediction → **Predicted Boundary Entry**
- Thresholds → **prototype demonstration values**

The dashboard has a SIMULATION mode with vehicles, personnel and FOD. If it
appears at all, it must be labelled SIMULATION. Everything shown as LIVE is
measured.

---

## WHAT THE JUDGES SHOULD LEAVE BELIEVING

1. The electronics are real and correctly engineered — including the divider.
2. The UNO Q is genuinely processing three real sensors at 10 Hz.
3. It reacts reliably in real time, and fails safe when it cannot.
4. The innovation is **predictive, explainable sensor fusion** — not sensor monitoring.
5. Hardware and software are one system, verified end to end.
6. The use case is specifically airside safety.
7. It is low-cost, modular, edge-first and scalable.
8. The scope decisions were deliberate and defensible.
