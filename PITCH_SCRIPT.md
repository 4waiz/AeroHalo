# AeroHalo — 3-minute pitch script

**Team Kanban T17** · INSPIRE '26 · Smart Aviation Systems
Speakers: **Huda Mueen** (problem + innovation) · **Obaid Mukaddam** (engineering + reliability)

Total spoken ≈ 3:00. Slide order is the deck order, so you never fight the clicker.

| Slide | Speaker | Time | Running |
|---|---|---|---|
| 1 Title | Huda | 0:15 | 0:15 |
| 2 The problem | Huda | 0:25 | 0:40 |
| 3 Engineering | Obaid | 0:40 | 1:20 |
| 4 Predict. Fuse. Explain. | Huda | 0:45 | 2:05 |
| 5 Fail safe | Obaid | 0:35 | 2:40 |
| 6 Live demo | Obaid | 0:20 | 3:00 |

> **Read this before you rehearse.** Slide 4 says *"hazard removed → still HOLD →
> operator reset."* The automatic states are now **live** — they clear
> themselves when the hazard goes. Only the operator's **Manual HOLD** stays
> until a person clears it. The script below says it that way, and it is true.
> Say it as written and you are safe under questioning.

---

## SLIDE 1 — Title · **HUDA** · 0:15

> We're Team Kanban. This is **AeroHalo** — predictive airside safety.
>
> Most systems tell you a boundary has been crossed. Ours estimates **when** it
> is about to be, and escalates first.

*(Click)*

---

## SLIDE 2 — The problem · **HUDA** · 0:25

> On an airside, vehicles, crew and equipment move within metres of an aircraft
> worth tens of millions. The window to react is **seconds**.
>
> Three hazards: a vehicle closing in, personnel in a restricted area, and an
> impact nobody saw happen.
>
> So — can we identify risk **before** the boundary is crossed?

*(Click — hand to Obaid)*

---

## SLIDE 3 — Engineering AeroHalo · **OBAID** · 0:40

> Three real sensors on an Arduino UNO Q — ultrasonic for distance, PIR for
> personnel, vibration for impact. Three LEDs for the state.
>
> One detail worth your attention. The ultrasonic echo drives **five volts**.
> The UNO Q's GPIO is **three-point-three**. So echo goes through a 2.2k–3.3k
> divider — **three volts exactly**. Above logic-high, under the limit. Without
> it, you damage the pin.
>
> The UNO Q gives us two processors. The **microcontroller** owns anything that
> must stay safe if Linux stops — sampling, LEDs, a one-and-a-half second
> watchdog. **Linux** predicts and serves the dashboard.
>
> Ten hertz, twenty-five milliseconds round trip, **one percent** of flash.

*(Click — hand to Huda)*

---

## SLIDE 4 — Predict. Fuse. Explain. · **HUDA** · 0:45

> The innovation is three things.
>
> **Predict.** From distance we derive closing speed — a least-squares fit,
> timestamped by the microcontroller. Distance minus boundary, over closing
> speed, gives **predicted boundary entry**. Under four seconds, caution. Under
> two, hold. We react to a trajectory, not a trip-wire.
>
> **Fuse.** Not three gadgets with three opinions — **one** safety state. And
> the weighting is deliberate. Personnel *alone* scores ten, because crew near a
> stand is normal. Personnel **while something is inside the boundary** scores
> thirty-five — that's the combination that hurts.
>
> **Explain.** Every state carries a **why**. An operator sees which input drove
> the decision.
>
> And an operator hold stays until a person clears it. Confirmation, not
> assumption.

*(Click — hand to Obaid)*

---

## SLIDE 5 — Fail safe, not fail silent · **OBAID** · 0:35

> Anything can fail, so we designed for it.
>
> An ultrasonic sensor can't tell *"nothing is there"* from *"I am broken"* —
> both are silence. AeroHalo asks **which one**. A sensor that has proved it
> works and hears nothing reports an empty corridor. One that never has stays
> **unknown**. Never green.
>
> If Linux goes quiet for one and a half seconds, the microcontroller holds **on
> its own**. A breach must repeat over three samples, so one bad ping can't
> trigger it. Echo waits are bounded — it **cannot** hang.
>
> And the scope was deliberate: three sensors that work, over a camera that
> might not.

*(Click)*

---

## SLIDE 6 — Live demonstration · **OBAID** · 0:20

> Everything on that dashboard is measured. These are real logged readings —
> seventy-eight centimetres down to ten, predicted entry falling from
> three-and-a-half seconds to one.
>
> Rather than tell you AeroHalo works — let us show you.

*(Move to the table. Demo starts.)*

---

## Demo run order — keep talking while you move

1. **Object far** — green. *"Nothing in the zone."*
2. **Move it in slowly** — yellow at fifty centimetres.
3. **Keep moving** — *"watch the predicted entry fall"* — red before it reaches twenty.
4. **Move it away** — returns to green by itself.
5. **Wave at the PIR** — personnel detected.
6. **Tap the board** — impact, holds for four seconds, clears.
7. **Manual HOLD, then Reset** — *"this one needs a person."*

---

## If a judge asks

**"Is this real or simulated?"**
> Everything in live mode is measured. There is a simulation mode, clearly
> labelled — we don't mix them.

**"How accurate is the prediction?"**
> It is a least-squares fit over eight hundred milliseconds of real samples. We
> call it *predicted boundary entry*, not collision prediction — it is time to a
> configured boundary, and we only compute it for something actually closing.

**"Why not a camera?"**
> We scoped one. It's a parallel module, not a USB webcam, so it needs the
> STM32's camera peripheral and a custom Zephyr path. We judged that we would
> not get it reliable in the time — three sensors that work beat one that
> half-works.

**"What happens if a sensor fails?"**
> It reads unknown, never safe. And if Linux stops responding entirely, the
> microcontroller holds on its own — that watchdog runs independently.

**"Is the servo working?"**
> No, and we're not claiming it. It's wired and scoped on D9 but not
> commissioned, so it's compiled out. We'd rather show you three things that
> work than four where one doesn't.

---

## Delivery notes

- **Slow down on the divider** (slide 3) and **on "predict, fuse, explain"**
  (slide 4). Those are the two moments that win marks.
- Numbers land harder than adjectives. Say *"ten hertz"* and *"three volts"*,
  not *"very fast"* and *"safe voltage"*.
- If the demo misbehaves, say so and keep going — *"that's the sensor reading
  no echo, which is why we never show green for it."* Judges reward composure
  and honest failure states more than a lucky run.
- Do **not** claim certification, real aircraft deployment, or collision
  prevention. It's a tabletop prototype and saying so costs you nothing.
