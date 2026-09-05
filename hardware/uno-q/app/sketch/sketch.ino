/* AeroHalo Range - Arduino UNO Q (STM32U585) MCU firmware.
 *
 * Tabletop demonstrator for INSPIRE '26. NOT certified safety equipment and
 * not connected to any real aircraft system.
 *
 * Wiring (power off while wiring):
 *   HC-SR04 VCC  -> 5V
 *   HC-SR04 GND  -> GND
 *   HC-SR04 TRIG -> D6
 *   HC-SR04 ECHO -> 2.2k -> D7 junction -> 3.3k -> GND    (~3.0 V at D7)
 *
 * The divider is mandatory: HC-SR04 Echo idles at 5 V and D7 is a 3.3 V pin.
 *
 * Deliberately DISABLED in this build: servo, DC motor, stepper, buzzer and
 * any camera path. Only the ultrasonic sensor and the on-board RGB LED run.
 *
 * ---------------------------------------------------------------------------
 * Why the RPC surface looks like this
 * ---------------------------------------------------------------------------
 * Telemetry is PULLED by Linux (Bridge.provide_safe("read_sensors")) rather
 * than pushed with Bridge.notify. Two reasons:
 *
 *  1. provide_safe binds the handler with the "__safe__" tag, so the core runs
 *     it from __loopHook() in loop context. It therefore cannot race loop()
 *     while loop() is halfway through updating filteredMm / holdLatched.
 *     Plain provide() runs on the Bridge worker thread and would race.
 *
 *  2. The payload is a single JSON string. An earlier build sent five separate
 *     MsgPack arguments and the router logged
 *         "invalid packet, expected array, got: int8"
 *     One string has exactly one wire shape, so there is no argument-arity or
 *     integer-width mismatch to get wrong between the MCU and Python.
 */
#include <Arduino.h>
#include <Arduino_RouterBridge.h>
#include <stdio.h>

#define ENABLE_SERVO 0
#define ENABLE_BUZZER_DRIVER 0
#define ENABLE_DC_MOTOR 0
#define ENABLE_STEPPER 0

static const uint8_t TRIG_PIN = D6;
static const uint8_t ECHO_PIN = D7;

/* On-board RGB LED3 is active-low: LOW turns a channel ON. */
static const uint8_t LED_R = LED_BUILTIN;
static const uint8_t LED_G = LED_BUILTIN + 1;
static const uint8_t LED_B = LED_BUILTIN + 2;

/* Demonstration boundaries. Tabletop values, not aviation standards. */
static const int CRITICAL_MM = 200;   // <= 20 cm -> HOLD, latching
static const int CAUTION_MM  = 500;   // 20-50 cm -> CAUTION
static const int RELEASE_MM  = 500;   // reset only accepted beyond this
static const int MIN_VALID_MM = 20;   // below this the HC-SR04 is not trustworthy
static const int MAX_VALID_MM = 4000;

static const unsigned long SAMPLE_MS = 100;                  // ~10 Hz
static const unsigned long ECHO_START_TIMEOUT_US = 30000UL;  // wait for rising edge
static const unsigned long ECHO_HIGH_TIMEOUT_US = 25000UL;   // ~4.3 m ceiling
static const unsigned long RELEASE_STABLE_MS = 2000;         // stable safe time
static const unsigned long LINK_TIMEOUT_MS = 1500;           // Linux watchdog

unsigned long sequenceNo = 0;
unsigned long lastSampleMs = 0;
unsigned long sampledMs = 0;
unsigned long lastCommandMs = 0;
unsigned long safeSinceMs = 0;

int rawMm = -1;        // last single ping, -1 = no echo
int filteredMm = -1;   // median-of-3 then light EMA, -1 = invalid
bool rangeValid = false;
bool holdLatched = false;   // starts false; status is UNKNOWN until a real read
bool haveCommand = false;
int remoteLevel = 0;

static int history[3] = { -1, -1, -1 };
static uint8_t historyCount = 0;
static float ema = 0.0f;
static bool emaReady = false;

void setColour(bool red, bool green, bool blue) {
  digitalWrite(LED_R, red ? LOW : HIGH);
  digitalWrite(LED_G, green ? LOW : HIGH);
  digitalWrite(LED_B, blue ? LOW : HIGH);
}

/* True when Linux has stopped talking to us. Independent of the sensor. */
bool linkExpired() {
  return !haveCommand ||
         (unsigned long)(millis() - lastCommandMs) > LINK_TIMEOUT_MS;
}

/* One HC-SR04 ping. Returns echo width in microseconds, or 0 for no echo.
 * Both waits are bounded, so this can never hang the MCU: worst case is
 * ECHO_START_TIMEOUT_US, i.e. 30 ms.
 */
unsigned long pingEchoUs() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(4);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);   // standard 10 us trigger pulse
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
  /* Speed of sound 343 m/s, round trip halved: mm = us * 343 / 2000. */
  int measured = us ? (int)((us * 343UL) / 2000UL) : -1;
  bool ok = (measured >= MIN_VALID_MM && measured <= MAX_VALID_MM);
  sequenceNo++;
  sampledMs = millis();
  rawMm = ok ? measured : -1;

  if (!ok) {
    /* A timeout means UNKNOWN range. It is never reported as 0 cm and never
     * as a safe distance. The filter is reset so a stale value cannot leak
     * back out once echoes return. */
    historyCount = 0;
    emaReady = false;
    rangeValid = false;
    filteredMm = -1;
    safeSinceMs = 0;
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
    ema += 0.5f * ((float)stable - ema);   // light smoothing only, no invention
  }
  filteredMm = (int)(ema + 0.5f);
  rangeValid = true;

  if (filteredMm <= CRITICAL_MM) holdLatched = true;  // latch, never self-clears

  /* Track how long we have been continuously safe, for the release gate. */
  if (filteredMm > RELEASE_MM) {
    if (safeSinceMs == 0) safeSinceMs = sampledMs;
  } else {
    safeSinceMs = 0;
  }
}

/* Local hazard level from the MCU's own view, independent of Linux. */
int localLevel() {
  if (!rangeValid) return 2;                     // unknown is never "clear"
  if (filteredMm <= CRITICAL_MM) return 2;
  if (filteredMm <= CAUTION_MM) return 1;
  return 0;
}

/* Linux -> MCU. Runs in loop context because it is bound with provide_safe. */
bool apply_command(int level, bool release) {
  remoteLevel = constrain(level, 0, 2);
  lastCommandMs = millis();
  haveCommand = true;

  if (remoteLevel >= 2 || localLevel() >= 2) holdLatched = true;

  bool stable = safeSinceMs != 0 &&
                (unsigned long)(millis() - safeSinceMs) >= RELEASE_STABLE_MS;

  /* Explicit operator reset only, and only when the MCU independently agrees
   * the zone has been quiet at a safe distance for RELEASE_STABLE_MS. */
  if (release && rangeValid && filteredMm > RELEASE_MM &&
      localLevel() == 0 && stable) {
    holdLatched = false;
    remoteLevel = 0;
  }
  return holdLatched;  // logic state, NOT physical barrier feedback
}

/* MCU -> Linux. One JSON string: exactly one wire shape, nothing to mismatch. */
String read_sensors() {
  char out[240];
  snprintf(out, sizeof(out),
    "{\"seq\":%lu,\"ms\":%lu,\"age_ms\":%lu,\"mm\":%d,\"raw_mm\":%d,"
    "\"valid\":%s,\"held\":%s,\"level\":%d,\"link_lost\":%s,"
    "\"servo_enabled\":%s}",
    sequenceNo, sampledMs, (unsigned long)(millis() - sampledMs),
    filteredMm, rawMm,
    rangeValid ? "true" : "false",
    holdLatched ? "true" : "false",
    localLevel(),
    linkExpired() ? "true" : "false",
    ENABLE_SERVO ? "true" : "false");
  return String(out);
}

void updateLed() {
  /* The watchdog is the reason this is not simply a function of holdLatched:
   * if Linux stops talking, the MCU latches HOLD on its own. */
  if (linkExpired() && haveCommand) holdLatched = true;

  if (holdLatched) setColour(true, false, false);                  // red
  else if (!rangeValid) setColour(false, false, true);             // blue: no echo
  else if (localLevel() == 1 || remoteLevel == 1)
    setColour(true, true, false);                                  // amber
  else setColour(false, true, false);                              // green
}

void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  setColour(false, false, true);   // blue until the first valid reading

  Bridge.begin();
  Bridge.provide_safe("read_sensors", read_sensors);
  Bridge.provide_safe("apply_command", apply_command);
}

void loop() {
  unsigned long now = millis();
  if ((unsigned long)(now - lastSampleMs) >= SAMPLE_MS) {
    lastSampleMs = now;
    sampleRange();
  }
  updateLed();
  /* Return promptly so __loopHook() can run the queued safe RPC handlers. */
}
