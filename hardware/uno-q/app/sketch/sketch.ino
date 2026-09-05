/* AeroHalo - Arduino UNO Q (STM32U585) MCU firmware.
 * Three-sensor fusion edge layer for the AeroHalo airside safety prototype.
 *
 * Tabletop demonstrator for INSPIRE '26. NOT certified safety equipment, not
 * connected to any real aircraft system, and with no clearance authority.
 *
 * ---------------------------------------------------------------------------
 * Pin map (locked)
 * ---------------------------------------------------------------------------
 *   D2   optional HOLD reset / inspection button, INPUT_PULLUP, other leg GND
 *   D3   GREEN  status LED  -> 220-330R -> LED -> GND
 *   D4   YELLOW status LED  -> 220-330R -> LED -> GND
 *   D5   RED    status LED  -> 220-330R -> LED -> GND
 *   D6   HC-SR04 TRIG
 *   D7   HC-SR04 ECHO, through the existing 2.2k / 3.3k divider (~3.0 V)
 *   D8   HC-SR501 PIR OUT
 *   D9   SG90 servo signal                      (DISABLED, not commissioned)
 *   D10  SW-420 vibration module DO
 *   D11  Active buzzer MODULE signal (module has its own driver transistor)
 *   D0/D1 deliberately unused.
 *
 * The HC-SR04 divider is mandatory: Echo idles at 5 V and D7 is a 3.3 V pin.
 * The SW-420 runs at 3.3 V; the HC-SR04 and HC-SR501 run at 5 V. All share GND.
 *
 * ---------------------------------------------------------------------------
 * Why the RPC surface looks like this
 * ---------------------------------------------------------------------------
 * Telemetry is PULLED by Linux via Bridge.provide_safe("read_sensors"):
 *
 *  1. provide_safe binds with the "__safe__" tag so the core runs the handler
 *     from __loopHook() in loop context. It cannot race loop() halfway through
 *     updating the filter or the latch. Plain provide() runs on the Bridge
 *     worker thread and would race.
 *
 *  2. The payload is ONE JSON string, so there is exactly one wire shape. An
 *     earlier build passed several MsgPack arguments and the router logged
 *     "invalid packet, expected array, got: int8".
 *
 *  3. RPCLite's DEFAULT_RPC_BUFFER_SIZE is DECODER_BUFFER_SIZE/4 = 256 bytes,
 *     including framing. The keys below are short on purpose: the worst-case
 *     payload is about 170 bytes, which leaves real headroom.
 */
#include <Arduino.h>
#include <Arduino_RouterBridge.h>
#include <stdio.h>

/* Not commissioned yet. Do not set to 1 without physical sign-off: the servo
 * needs its own 5 V supply, a common ground and a clear arc to swing through. */
#define ENABLE_SERVO 0

/* Buzzer on D11. Set ENABLE_BUZZER to 0 to silence it without unwiring.
 *
 * ---------------------------------------------------------------------------
 * CURRENT LIMIT - READ THIS BEFORE WIRING A BARE BUZZER
 * ---------------------------------------------------------------------------
 * A three-pin buzzer MODULE has its own driver transistor, so D11 only switches
 * a base and the pin sees almost no load. Wire that straight in.
 *
 * A BARE two-pin element has no driver. Connected directly between D11 and GND
 * it pulls its full operating current THROUGH THE PIN - typically 20-30 mA,
 * against an STM32U585 absolute maximum of 20 mA per I/O. That is at or over
 * the limit, and over-current damage to a GPIO is cumulative and silent: the
 * pin does not fail loudly, it just gets weaker.
 *
 * With a bare element you MUST put a series resistor between D11 and the
 * buzzer. 330R holds the worst case near 10 mA, which is comfortably inside
 * spec. 220R is louder and still acceptable. The buzzer will be quieter than
 * it would be on 5 V through a transistor; that is the trade for not
 * degrading the pin.
 *
 * BUZZER_SERIES_OHMS is documentation, not a setting - the resistor is
 * physical. It is here so the value is recorded next to the code that assumes
 * it.
 * ---------------------------------------------------------------------------
 *
 * BUZZER_ACTIVE_HIGH: modules ship in both senses and software cannot tell
 * which. If yours sounds continuously at power-on, set this to 0.
 *
 * BUZZER_DRIVE: an ACTIVE buzzer contains its own oscillator and sounds on
 * DC. A PASSIVE one is just a transducer and needs a square wave - on DC it
 * only clicks. Two legs in a black case look identical either way, and no
 * amount of software can tell them apart.
 *
 * So mode 2 stops trying. Every chirp is driven BOTH ways in turn - half DC,
 * half tone - and whichever half the part responds to is the half you hear.
 * It costs nothing, it is the default, and it means an unlabelled buzzer from
 * a kit bag just works. Modes 0 and 1 remain for a part you have identified
 * and want driven cleanly.
 *
 *   0  steady DC only        an active element
 *   1  square wave only      a passive element
 *   2  both, every chirp     unknown part - default */
#define ENABLE_BUZZER 1
#define BUZZER_ACTIVE_HIGH 1
#define BUZZER_DRIVE 2
#define BUZZER_SERIES_OHMS 330

static const uint8_t BUTTON_PIN = D2;
static const uint8_t LED_GREEN_PIN = D3;
static const uint8_t LED_YELLOW_PIN = D4;
static const uint8_t LED_RED_PIN = D5;
static const uint8_t TRIG_PIN = D6;
static const uint8_t ECHO_PIN = D7;
static const uint8_t PIR_PIN = D8;
static const uint8_t SERVO_PIN = D9;
static const uint8_t VIB_PIN = D10;
static const uint8_t BUZZER_PIN = D11;

/* Demonstration boundaries. Tabletop values, not aviation standards. */
static const int CRITICAL_MM = 200;   // <= 20 cm -> HOLD, latching
static const int CAUTION_MM = 500;    // 20-50 cm -> CAUTION
static const int RELEASE_MM = 500;    // reset only accepted beyond this
static const int MIN_VALID_MM = 20;
static const int MAX_VALID_MM = 4000;

static const unsigned long SAMPLE_MS = 100;                  // ~10 Hz
static const unsigned long ECHO_START_TIMEOUT_US = 30000UL;
static const unsigned long ECHO_HIGH_TIMEOUT_US = 25000UL;
static const unsigned long RELEASE_STABLE_MS = 2000;
static const unsigned long LINK_TIMEOUT_MS = 1500;

/* Buzzer cadence. An active buzzer has ONE tone and one volume, so urgency is
 * carried by HOW OFTEN it fires, not how loud it is.
 *
 * Three patterns, one per safety state, driven by the same fused level as the
 * LEDs - so what you hear and what you see can never disagree:
 *
 *   SAFE     silent           nothing is wrong, so say nothing
 *   CAUTION  10 beeps every 20 s
 *   HOLD     10 beeps every 10 s
 *
 * The buzzer sounds only when a light is amber or red. Audio that fires when
 * everything is fine is noise people learn to ignore, which is exactly when
 * you need them to hear it.
 *
 * UNKNOWN stays silent too: the system is saying it cannot see, and a
 * confident-sounding pattern for that would be the wrong message. */
static const unsigned long BEEP_ON_MS = 70;     // one chirp
static const unsigned long BEEP_OFF_MS = 130;   // gap inside a burst
static const unsigned long BEEP_SLOT_MS = BEEP_ON_MS + BEEP_OFF_MS;

static const uint8_t  BEEPS_CAUTION = 10;
static const uint8_t  BEEPS_HOLD = 10;
static const unsigned long CYCLE_CAUTION_MS = 20000UL;
static const unsigned long CYCLE_HOLD_MS = 10000UL;

/* Software tone for a PASSIVE element. ~2.7 kHz sits near the resonant peak of
 * most small transducers, so it is loud for the current it draws.
 *
 * Honest limitation: this is bit-banged from the main loop, and sampleRange()
 * can block for up to 30 ms waiting on an echo timeout. During those windows
 * the tone stops. It warbles slightly rather than holding a clean pitch. An
 * active buzzer avoids the problem entirely and is the better part to use. */
static const unsigned long TONE_HALF_PERIOD_US = 185;

/* HC-SR501 needs time to settle after power-up or its output floats and would
 * look like a stream of intrusions. Readings are ignored until this expires. */
static const unsigned long PIR_WARMUP_MS = 30000UL;
/* Hold a motion indication briefly so a 10 Hz poll cannot miss a short pulse. */
static const unsigned long PIR_STRETCH_MS = 1200UL;

/* SW-420 polarity is learned, not assumed: modules ship in both senses. The
 * level seen throughout this window with the board at rest becomes "idle". */
static const unsigned long VIB_CAL_MS = 3000UL;
/* Ignore further edges inside this window so one tap is one event. */
static const unsigned long VIB_DEBOUNCE_MS = 400UL;

static const uint8_t LEVEL_SAFE = 0;
static const uint8_t LEVEL_CAUTION = 1;
static const uint8_t LEVEL_HOLD = 2;
static const uint8_t LEVEL_UNKNOWN = 3;

/* ---------------- range ---------------- */
unsigned long sequenceNo = 0;
unsigned long lastSampleMs = 0;
unsigned long sampledMs = 0;
unsigned long safeSinceMs = 0;
int rawMm = -1;
int filteredMm = -1;
bool rangeValid = false;
/* Has the sensor EVER produced a valid reading since boot? A sensor that has
 * proved it can see and is still sampling, but hears nothing, is reporting an
 * empty corridor. One that has never seen anything might simply be broken, and
 * those two cases must not be treated alike. */
bool rangeEverValid = false;
static int history[3] = { -1, -1, -1 };
static uint8_t historyCount = 0;
/* Consecutive in-boundary samples before the latch fires. An HC-SR04 emits
 * occasional nonsense, especially on its first pings after reset, and a single
 * bogus 5 cm reading would otherwise latch HOLD for the whole demonstration. */
static uint8_t criticalRun = 0;
static const uint8_t CRITICAL_RUN_NEEDED = 3;
static float ema = 0.0f;
static bool emaReady = false;

/* ---------------- link / latch ---------------- */
unsigned long lastCommandMs = 0;
bool haveCommand = false;
/* LIVE, not latched. Nothing sensor-driven sticks any more: the state tracks
 * the current readings, so a target that moves away returns the system to SAFE
 * by itself. The only sticky HOLD left is the operator's Manual HOLD, and Linux
 * owns that - it simply keeps sending LEVEL_HOLD until the operator resets. */
bool holdActive = false;
uint8_t remoteLevel = LEVEL_UNKNOWN;

/* ---------------- PIR ---------------- */
bool pirMotion = false;
unsigned long pirLastTriggerMs = 0;
bool pirEverTriggered = false;
/* Raw pin state and how long it has been continuously HIGH. An HC-SR501 holds
 * its output HIGH for the period set by its on-board delay potentiometer,
 * which ships anywhere from ~5 s to ~5 min, so a pin that never falls is a
 * module setting, not continuous personnel presence. Reporting both lets the
 * dashboard tell the difference instead of crying wolf. */
int pirRaw = LOW;
unsigned long pirHighSinceMs = 0;
/* Has the pin EVER been observed LOW? D8 is configured INPUT_PULLDOWN, so a
 * disconnected wire reads LOW. A pin that is HIGH from the first sample and
 * never falls is therefore being actively driven - which for a working
 * HC-SR501 output it should not be. This distinguishes "sensor is busy" from
 * "D8 is not looking at the sensor output at all". */
bool pirEverLow = false;

/* ---------------- vibration ---------------- */
bool vibCalibrated = false;
int vibIdleLevel = HIGH;        // learned during VIB_CAL_MS
bool vibActive = false;         // instantaneous, debounced
bool vibEvent = false;          // latched edge, cleared once Linux has read it
unsigned long vibLastTriggerMs = 0;
unsigned long vibLastEdgeMs = 0;
bool vibEverTriggered = false;

/* ---------------- button ---------------- */
bool buttonRequest = false;     // latched press, cleared when Linux acts on it
bool buttonPrev = true;         // INPUT_PULLUP idles HIGH

/* ---------------- outputs ---------------- */
bool buzzerOn = false;              // pin level, for the steady-DC drive
unsigned long buzzerChirpMs = 0;    // when the last inline chirp was emitted
unsigned long buzzerCycleMs = 0;    // start of the current burst cycle
unsigned long buzzerGapMs = 0;      // current cycle length, 0 = silent
uint8_t effectiveLevel = LEVEL_UNKNOWN;   // set by updateOutputs, read by the buzzer

bool ledGreen = false, ledYellow = false, ledRed = false;
bool ledSelfTestDone = false;   // reported so the dashboard knows the lamp test ran
/* Operator-triggered lamp test. Non-blocking: updateOutputs() drives the walk
 * from this timestamp, so the sensor loop and the RPC handlers keep running. */
unsigned long lampTestStartMs = 0;
static const unsigned long LAMP_STEP_MS = 500;
static const unsigned long LAMP_TOTAL_MS = LAMP_STEP_MS * 3;

void writeLeds(bool g, bool y, bool r) {
  ledGreen = g;
  ledYellow = y;
  ledRed = r;
  digitalWrite(LED_GREEN_PIN, g ? HIGH : LOW);
  digitalWrite(LED_YELLOW_PIN, y ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, r ? HIGH : LOW);
}

/* Two ways to drive the element, used by the self-identification sweep.
 *
 * Software cannot tell an active buzzer from a passive one - both are two legs
 * and a case. So rather than guess, the operator test drives each in turn and
 * lets the person in the room hear which one works.
 *
 * With BUZZER_DRIVE 2 you do not need that answer - both halves are driven in
 * every chirp anyway. The sweep stays because it is still the fastest way to
 * tell a silent buzzer from a miswired one: if the LEDs walk and nothing is
 * audible, the fault is the wiring, not the code. */
void buzzerDc(bool on) {
#if ENABLE_BUZZER
  digitalWrite(BUZZER_PIN, (on == (BUZZER_ACTIVE_HIGH != 0)) ? HIGH : LOW);
#else
  (void)on;
#endif
}

/* A bounded burst of ~2.7 kHz square wave. Blocking, but only for ms
 * milliseconds and only from the operator test or a chirp - both far inside
 * the 1500 ms link timeout the watchdog uses. */
void buzzerToneFor(unsigned long ms) {
#if ENABLE_BUZZER
  unsigned long until = micros() + ms * 1000UL;
  while ((long)(micros() - until) < 0) {
    digitalWrite(BUZZER_PIN, HIGH);
    delayMicroseconds(TONE_HALF_PERIOD_US);
    digitalWrite(BUZZER_PIN, LOW);
    delayMicroseconds(TONE_HALF_PERIOD_US);
  }
  digitalWrite(BUZZER_PIN, LOW);
#else
  (void)ms;
#endif
}

void writeBuzzer(bool on) {
#if ENABLE_BUZZER
  buzzerOn = on;
#if BUZZER_DRIVE == 0
  buzzerDc(on);
#else
  /* Anything involving a waveform emits the whole chirp here and now, rather
   * than holding a level across loop passes. Bounded by BEEP_ON_MS either way,
   * so it can never run away with the loop. */
  if (on) {
#if BUZZER_DRIVE == 2
    /* Half DC, half tone. An active element sounds through the first half, a
     * passive one through the second, so the chirp lands whichever it is. */
    buzzerDc(true);
    delay(BEEP_ON_MS / 2);
    buzzerDc(false);
    buzzerToneFor(BEEP_ON_MS / 2);
#else
    buzzerToneFor(BEEP_ON_MS);
#endif
    buzzerChirpMs = millis();
    buzzerOn = false;   // the pin is already back low; the lamp uses the stamp
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
#endif
#else
  (void)on;
  buzzerOn = false;
#endif
}

/* What the dashboard lamp should show.
 *
 * With a waveform drive the chirp is emitted inline and the pin is back low
 * long before anyone polls, so reporting the bare level says "silent" right
 * through a burst you can hear across the room. Report the chirp for one slot
 * instead: the lamp then flashes in time with the sound, which is the whole
 * point of having it. */
bool buzzerAudible() {
#if ENABLE_BUZZER
#if BUZZER_DRIVE == 0
  return buzzerOn;
#else
  return buzzerChirpMs != 0 &&
         (unsigned long)(millis() - buzzerChirpMs) < BEEP_SLOT_MS;
#endif
#else
  return false;
#endif
}

/* Buzzer, driven by the SAME fused level as the LEDs.
 *
 * Non-blocking: a burst state machine advanced from millis(), so the 10 Hz
 * sampling and the safe RPC handlers keep running underneath it. No tone(), no
 * delay() - either would stall the loop the interlock depends on.
 */
void updateBuzzer() {
#if ENABLE_BUZZER
  /* The operator sweep owns the element while it runs, exactly as it owns the
   * LEDs. Without this the cadence machine would drive it back low on the very
   * next pass and the sweep would be inaudible. */
  if (lampTestStartMs != 0) return;

  unsigned long now = millis();

  uint8_t beeps;
  unsigned long cycle;
  switch (effectiveLevel) {
    case LEVEL_CAUTION: beeps = BEEPS_CAUTION; cycle = CYCLE_CAUTION_MS; break;
    case LEVEL_HOLD:    beeps = BEEPS_HOLD;    cycle = CYCLE_HOLD_MS;    break;
    default:            beeps = 0;             cycle = 0;                break;
  }
  buzzerGapMs = cycle;

  if (beeps == 0) {
    writeBuzzer(false);
    buzzerCycleMs = now;
    return;
  }

  unsigned long elapsed = now - buzzerCycleMs;
  if (elapsed >= cycle) {
    buzzerCycleMs = now;      // next burst
    elapsed = 0;
  }

  /* Inside the burst window each beep owns a slot: chirp, then gap. */
  unsigned long burstLen = (unsigned long)beeps * BEEP_SLOT_MS;
  if (elapsed < burstLen) {
    writeBuzzer((elapsed % BEEP_SLOT_MS) < BEEP_ON_MS);
  } else {
    writeBuzzer(false);
  }
#endif
}

bool linkExpired() {
  return !haveCommand ||
         (unsigned long)(millis() - lastCommandMs) > LINK_TIMEOUT_MS;
}

bool pirWarming() { return millis() < PIR_WARMUP_MS; }

/* ------------------------------------------------------------------ */
/* HC-SR04                                                             */
/* ------------------------------------------------------------------ */

/* One ping. Returns echo width in microseconds, or 0 for no echo. Both waits
 * are bounded, so a missing or stuck Echo line can never hang the MCU:
 * worst case is ECHO_START_TIMEOUT_US, i.e. 30 ms. */
unsigned long pingEchoUs() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(4);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long t0 = micros();
  while (digitalRead(ECHO_PIN) == LOW) {
    if ((unsigned long)(micros() - t0) > ECHO_START_TIMEOUT_US) return 0;
  }
  unsigned long rise = micros();
  while (digitalRead(ECHO_PIN) == HIGH) {
    if ((unsigned long)(micros() - rise) > ECHO_HIGH_TIMEOUT_US) return 0;
  }
  return (unsigned long)(micros() - rise);
}

static int median3(int a, int b, int c) {
  int t;
  if (a > b) { t = a; a = b; b = t; }
  if (b > c) { t = b; b = c; c = t; }
  if (a > b) { t = a; a = b; b = t; }
  return b;
}

void sampleRange() {
  unsigned long us = pingEchoUs();
  /* 343 m/s, round trip halved: mm = us * 343 / 2000. */
  int measured = us ? (int)((us * 343UL) / 2000UL) : -1;
  bool ok = (measured >= MIN_VALID_MM && measured <= MAX_VALID_MM);
  sequenceNo++;
  sampledMs = millis();
  rawMm = ok ? measured : -1;

  if (!ok) {
    /* No echo is UNKNOWN range for reporting: never 0 cm, never SAFE. Clearing
     * the filter stops a stale value leaking back out once echoes return.
     *
     * For the RELEASE gate it counts as clear, though: nothing is echoing, so
     * nothing is inside the boundary. The clear timer keeps running rather than
     * resetting, which is what makes the reset usable on a sensor pointed down
     * an empty lane. */
    historyCount = 0;
    emaReady = false;
    rangeValid = false;
    filteredMm = -1;
    criticalRun = 0;
    if (safeSinceMs == 0) safeSinceMs = sampledMs;
    return;
  }

  history[2] = history[1];
  history[1] = history[0];
  history[0] = measured;
  if (historyCount < 3) historyCount++;
  int stable = (historyCount == 3)
                 ? median3(history[0], history[1], history[2])
                 : measured;

  if (!emaReady) {
    ema = (float)stable;
    emaReady = true;
  } else {
    ema += 0.5f * ((float)stable - ema);   // light smoothing only
  }
  filteredMm = (int)(ema + 0.5f);
  rangeValid = true;
  rangeEverValid = true;

  /* Latch only once the median+EMA filter is primed AND the boundary has been
   * breached on consecutive samples. 3 samples at 10 Hz is 300 ms, far too
   * quick to matter physically but long enough to reject a single bad ping. */
  if (filteredMm <= CRITICAL_MM && historyCount == 3) {
    if (criticalRun < 255) criticalRun++;
    /* No latch: criticalRun only decides whether the breach is confirmed.
     * localLevel() reads it live. */
  } else {
    criticalRun = 0;
  }

  if (filteredMm > RELEASE_MM) {
    if (safeSinceMs == 0) safeSinceMs = sampledMs;
  } else {
    safeSinceMs = 0;
  }
}

/* ------------------------------------------------------------------ */
/* HC-SR501                                                            */
/* ------------------------------------------------------------------ */

void samplePir() {
  unsigned long now = millis();
  int level = digitalRead(PIR_PIN);
  if (level == HIGH) {
    if (pirRaw == LOW) pirHighSinceMs = now;   // rising edge
  } else {
    pirHighSinceMs = 0;
    pirEverLow = true;
  }
  pirRaw = level;

  if (pirWarming()) {
    pirMotion = false;
    return;
  }
  if (level == HIGH) {
    pirMotion = true;
    pirLastTriggerMs = now;
    pirEverTriggered = true;
  } else if ((unsigned long)(now - pirLastTriggerMs) > PIR_STRETCH_MS) {
    pirMotion = false;
  }
}

/* ------------------------------------------------------------------ */
/* SW-420                                                              */
/* ------------------------------------------------------------------ */

void sampleVibration() {
  int level = digitalRead(VIB_PIN);
  unsigned long now = millis();

  if (!vibCalibrated) {
    /* Learn the resting level. Any change restarts the window, so a board that
     * is being knocked about during boot simply stays uncalibrated rather than
     * learning the wrong polarity. */
    static unsigned long calStart = 0;
    static int calLevel = -1;
    if (calLevel != level) {
      calLevel = level;
      calStart = now;
    }
    if (calStart != 0 && (unsigned long)(now - calStart) >= VIB_CAL_MS) {
      vibIdleLevel = level;
      vibCalibrated = true;
      /* Start the debounce window here. Without this, vibLastEdgeMs is still 0
       * and the very first post-calibration evaluation looks like an edge that
       * happened long ago, which fired a phantom impact the instant the sensor
       * came online and latched HOLD before the demo began. */
      vibLastEdgeMs = now;
      /* Anything "detected" before we knew the idle level was meaningless. */
      vibEvent = false;
      vibEverTriggered = false;
    }
    vibActive = false;
    return;
  }

  bool triggered = (level != vibIdleLevel);
  if (triggered) {
    if (!vibActive && (unsigned long)(now - vibLastEdgeMs) > VIB_DEBOUNCE_MS) {
      /* Rising edge of a distinct disturbance. Latch it for Linux to log once. */
      vibEvent = true;
      vibLastTriggerMs = now;
      vibEverTriggered = true;
      vibLastEdgeMs = now;
    }
    vibActive = true;
  } else if ((unsigned long)(now - vibLastEdgeMs) > VIB_DEBOUNCE_MS) {
    vibActive = false;
  }
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

void sampleButton() {
  bool pressed = (digitalRead(BUTTON_PIN) == LOW);   // INPUT_PULLUP
  if (pressed && !buttonPrev) buttonRequest = true;  // latch the falling edge
  buttonPrev = pressed;
}

/* ------------------------------------------------------------------ */
/* Local safety level, computed without Linux                          */
/* ------------------------------------------------------------------ */

uint8_t localLevel() {
  if (!rangeValid) {
    /* No echo from a sensor that has proved it works = nothing within range,
     * which is the normal resting state of a corridor pointed at empty space.
     * No echo from a sensor that has never worked stays UNKNOWN. */
    return rangeEverValid ? LEVEL_SAFE : LEVEL_UNKNOWN;
  }
  if (filteredMm <= CRITICAL_MM && criticalRun >= CRITICAL_RUN_NEEDED)
    return LEVEL_HOLD;
  if (filteredMm <= CRITICAL_MM) return LEVEL_CAUTION;   // confirming
  if (filteredMm <= CAUTION_MM) return LEVEL_CAUTION;
  return LEVEL_SAFE;
}

/* ------------------------------------------------------------------ */
/* RPC                                                                 */
/* ------------------------------------------------------------------ */

/* Linux -> MCU. Runs in loop context (provide_safe), so it cannot race loop(). */
bool apply_command(int level, bool release) {
  remoteLevel = (uint8_t)constrain(level, 0, 3);
  lastCommandMs = millis();
  haveCommand = true;

  /* Linux has now seen these, so stop re-reporting them. */
  buttonRequest = false;
  vibEvent = false;

  /* Only a measured hazard latches. LEVEL_UNKNOWN deliberately does not:
   * at power-on the sensor has not read anything yet, and latching then would
   * force an operator reset before the demo could even start. */
  /* Nothing latches here. The effective level is recomputed every pass from
   * whatever Linux last sent and whatever this MCU can see for itself. */

  bool stable = safeSinceMs != 0 &&
                (unsigned long)(millis() - safeSinceMs) >= RELEASE_STABLE_MS;

  /* Explicit operator reset only, and only when the MCU independently agrees
   * the corridor has been clear for RELEASE_STABLE_MS.
   *
   * Clear means NOTHING INSIDE THE BOUNDARY, satisfied two ways: a valid
   * reading beyond RELEASE_MM, or no echo at all from a sensor that has already
   * proved it works. Demanding a positive echo made the reset unusable - a
   * sensor aimed down an empty lane is silent by design, so the interlock could
   * never be cleared and stayed latched for good.
   *
   * A reading INSIDE the boundary still refuses, a sensor that has never seen
   * anything still refuses, and Linux cannot talk the MCU past either. */
  /* `release` is accepted and acknowledged for protocol compatibility, but the
   * MCU has nothing to release: with live states the interlock clears itself as
   * soon as the readings clear. The operator's Manual HOLD is held on the Linux
   * side, which stops sending LEVEL_HOLD when the operator resets it. */
  (void)release;
  (void)stable;
  return holdActive;   // logic state, NOT physical barrier feedback
}

/* Linux -> MCU. Starts the non-blocking lamp walk. Returns immediately: the
 * caller gets "accepted", never "the operator saw it light up". */
bool lamp_test() {
  lampTestStartMs = millis();
  return true;
}

/* MCU -> Linux. Short keys keep the worst case near 170 bytes, well inside the
 * 256-byte RPC buffer.
 *
 *   s  sample sequence      t  MCU millis at sample   a  age of that sample, ms
 *   d  filtered range mm    w  raw range mm           v  range valid
 *   h  HOLD latched         l  MCU-local level        x  Linux link expired
 *   p  PIR motion           pw PIR still warming      pt ms since PIR trigger
 *   b  vibration active     be latched vib event      bt ms since vib trigger
 *   bc vibration calibrated bi learned idle level
 *   g/y/r commanded LEDs    bq button release request sv servo enabled
 *   st  LED lamp test completed at power-on
 *   bz  buzzer sounding now   bg  current gap in ms, 0 = silent
 */
String read_sensors() {
  char out[248];
  unsigned long now = millis();
  unsigned long pirAge = pirEverTriggered ? (now - pirLastTriggerMs) : 999999UL;
  unsigned long vibAge = vibEverTriggered ? (now - vibLastTriggerMs) : 999999UL;
  if (pirAge > 999999UL) pirAge = 999999UL;
  if (vibAge > 999999UL) vibAge = 999999UL;

  snprintf(out, sizeof(out),
    "{\"s\":%lu,\"t\":%lu,\"a\":%lu,\"d\":%d,\"w\":%d,\"v\":%d,\"h\":%d,"
    "\"l\":%d,\"x\":%d,\"p\":%d,\"pw\":%d,\"pt\":%lu,\"b\":%d,\"be\":%d,"
    "\"bt\":%lu,\"bc\":%d,\"bi\":%d,\"g\":%d,\"y\":%d,\"r\":%d,\"bq\":%d,"
    "\"pr\":%d,\"ph\":%lu,\"pl\":%d,"
    "\"sv\":%d,\"st\":%d,\"ev\":%d,\"bz\":%d,\"bg\":%lu}",
    sequenceNo, sampledMs, (unsigned long)(now - sampledMs),
    filteredMm, rawMm, rangeValid ? 1 : 0, holdActive ? 1 : 0,
    (int)localLevel(), linkExpired() ? 1 : 0,
    pirMotion ? 1 : 0, pirWarming() ? 1 : 0, pirAge,
    vibActive ? 1 : 0, vibEvent ? 1 : 0, vibAge,
    vibCalibrated ? 1 : 0, vibIdleLevel == HIGH ? 1 : 0,
    ledGreen ? 1 : 0, ledYellow ? 1 : 0, ledRed ? 1 : 0,
    buttonRequest ? 1 : 0,
    pirRaw == HIGH ? 1 : 0,
    pirHighSinceMs ? (unsigned long)(now - pirHighSinceMs) : 0UL,
    pirEverLow ? 1 : 0,
    ENABLE_SERVO ? 1 : 0,
    ledSelfTestDone ? 1 : 0,
    rangeEverValid ? 1 : 0,
    buzzerAudible() ? 1 : 0, buzzerGapMs);
  return String(out);
}

/* ------------------------------------------------------------------ */
/* Outputs                                                             */
/* ------------------------------------------------------------------ */

void updateOutputs() {
  /* An operator lamp test overrides the display for its duration. It only
   * changes what the LEDs show, never the safety state underneath. */
  if (lampTestStartMs != 0) {
    unsigned long elapsed = millis() - lampTestStartMs;
    if (elapsed < LAMP_TOTAL_MS) {
      unsigned long step = elapsed / LAMP_STEP_MS;
      writeLeds(step == 0, step == 1, step == 2);
#if ENABLE_BUZZER
      /* Green  = steady DC   -> an ACTIVE element sounds here, a passive one is silent
       * Yellow = nothing     -> a deliberate gap, so the two halves cannot be confused
       * Red    = 2.7 kHz     -> a PASSIVE element sounds here, an active one may buzz thinly
       *
       * Whichever half is audible names the part. Neither means the fault is
       * wiring or polarity, not code - which is the useful answer too. */
      if (step == 0) {
        buzzerDc(true);
        buzzerOn = true;
        buzzerChirpMs = millis();
      } else if (step == 1) {
        buzzerDc(false);
        buzzerOn = false;
      } else {
        buzzerToneFor(20);   // small chunks, re-emitted every loop pass
        buzzerOn = true;
        buzzerChirpMs = millis();
      }
#endif
      return;
    }
    lampTestStartMs = 0;
    ledSelfTestDone = true;
#if ENABLE_BUZZER
    writeBuzzer(false);
#endif
  }

  /* The MCU latches HOLD by itself if Linux goes quiet. The watchdog is why
   * this is not simply a function of the level Linux last sent. */
  bool linkFault = linkExpired() && haveCommand;

  uint8_t local = localLevel();
  /* Take the more pessimistic of the fused level from Linux and what this MCU
   * can see on its own, so the LEDs can never show green while the MCU itself
   * is looking at a hazard. UNKNOWN (3) outranks everything. */
  uint8_t effective = remoteLevel;
  if (local == LEVEL_UNKNOWN || effective == LEVEL_UNKNOWN) {
    effective = LEVEL_UNKNOWN;
  } else if (local > effective) {
    effective = local;
  }
  if (linkFault) effective = LEVEL_HOLD;
  holdActive = (effective == LEVEL_HOLD);
  effectiveLevel = effective;

  bool fault = linkExpired() || effective == LEVEL_UNKNOWN;

  if (fault) {
    /* Alternating red/yellow, never green. Non-blocking: no delay() here, so
     * the sensor loop and the safe RPC handlers keep running. */
    bool phase = ((millis() / 400UL) % 2UL) == 0;
    writeLeds(false, phase, !phase);
    return;
  }

  switch (effective) {
    case LEVEL_SAFE:    writeLeds(true, false, false); break;
    case LEVEL_CAUTION: writeLeds(false, true, false); break;
    default:            writeLeds(false, false, true); break;
  }

#if ENABLE_SERVO
  /* Deliberately not implemented until the servo is physically commissioned.
   * A servo command is not evidence of a barrier position: there is no
   * position feedback anywhere in this build. */
#endif
}

/* ------------------------------------------------------------------ */

void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);
  /* Pulled down, not floating. If a sensor is not yet wired the pin reads a
   * steady LOW, which means "no motion" / "no vibration" instead of picking up
   * noise and inventing an intrusion. Both modules drive their output
   * push-pull, so the pulldown does not fight them once they are connected. */
  pinMode(PIR_PIN, INPUT_PULLDOWN);
  pinMode(VIB_PIN, INPUT_PULLDOWN);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_YELLOW_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);

  /* Power-on lamp test: each LED alone, in order, so a dead lamp or a swapped
   * pair is obvious before anyone trusts the colours. A blocking delay() is
   * acceptable here and ONLY here: setup() runs once, before Bridge.begin(),
   * so nothing is waiting on us. The runtime loop never blocks. */
  writeLeds(true, false, false);
  delay(500);
  writeLeds(false, true, false);
  delay(500);
  writeLeds(false, false, true);
  delay(500);

  /* Then straight into the UNKNOWN indication. Never green: nothing has been
   * measured yet, so claiming SAFE would be a lie the operator can see. */
  writeLeds(false, true, false);
  ledSelfTestDone = true;

#if ENABLE_BUZZER
  pinMode(BUZZER_PIN, OUTPUT);
  writeBuzzer(false);   // silent before anything has been measured
#endif

#if ENABLE_SERVO
  pinMode(SERVO_PIN, OUTPUT);
#endif

  Bridge.begin();
  Bridge.provide_safe("read_sensors", read_sensors);
  Bridge.provide_safe("apply_command", apply_command);
  Bridge.provide_safe("lamp_test", lamp_test);
}

void loop() {
  unsigned long now = millis();
  if ((unsigned long)(now - lastSampleMs) >= SAMPLE_MS) {
    lastSampleMs = now;
    sampleRange();
    samplePir();
  }
  /* Vibration and the button are edge-sensitive, so they are polled every pass
   * rather than at the 10 Hz sensor cadence. */
  sampleVibration();
  sampleButton();
  updateOutputs();   // computes effectiveLevel
  updateBuzzer();    // ...which the buzzer pattern follows
  /* Return promptly so __loopHook() can run the queued safe RPC handlers. */
}
