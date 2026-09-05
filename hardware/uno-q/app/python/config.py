"""AeroHalo demo settings.

Every distance and weight here is a tabletop demonstration value chosen so the
effect is visible on a desk. None of them are aviation standards and none are
derived from any real airside separation minimum.

Three-sensor build: HC-SR04 range, HC-SR501 personnel/motion, SW-420 vibration,
plus three status LEDs. Servo, DC motor, stepper, buzzer and camera are OFF.
"""

# --- range boundaries (mm) -------------------------------------------------
CRITICAL_MM = 200.0   # <= 20 cm  -> HOLD / critical (latching)
CAUTION_MM = 500.0    # 20-50 cm  -> CAUTION; beyond -> SAFE
RELEASE_MM = 500.0    # operator reset only accepted beyond this

# --- prediction ------------------------------------------------------------
PREDICT_CAUTION_S = 4.0    # time-to-boundary <= 4 s -> predictive CAUTION
PREDICT_HOLD_S = 2.0       # time-to-boundary <= 2 s -> predictive HOLD
MIN_APPROACH_MM_S = 20.0   # 2 cm/s: below this, closing speed is not meaningful

# --- risk weights ----------------------------------------------------------
# Additive and clamped to 0-100. Only the highest applicable band in each group
# contributes, so proximity and prediction do not double-count themselves.
RISK_PROXIMITY_CAUTION = 30
RISK_CRITICAL_RANGE = 60
RISK_PREDICT_CAUTION = 25
RISK_PREDICT_HOLD = 50
# Personnel near an aircraft stand is NORMAL - that is where ground crew work.
# Presence on its own is therefore informational and stays inside the SAFE band.
# It only carries real weight when something is also approaching the boundary,
# because personnel plus an approaching object is the combination that hurts.
RISK_PIR_ALONE = 10
RISK_PIR_WITH_PROXIMITY = 35

# A single knock is not an impact. A real one rings the switch repeatedly, so a
# lone event is noted and a confirmed burst is what forces the interlock.
RISK_VIBRATION_SINGLE = 20
RISK_VIBRATION = 55
# Distinct vibration events within this window to count as a confirmed impact.
VIB_CONFIRM_COUNT = 2
VIB_CONFIRM_WINDOW_S = 2.5

# --- risk bands ------------------------------------------------------------
BAND_CAUTION = 30   # 0-29 SAFE, 30-69 CAUTION, 70-100 HOLD
BAND_HOLD = 70

# --- timing ----------------------------------------------------------------
POLL_INTERVAL_S = 0.10     # 10 Hz, matching the MCU sample rate
MCU_TIMEOUT_S = 1.0        # Bridge call timeout
# A single missed echo is normal for an HC-SR04. Only a sustained loss is
# treated as a hazard, so transient dropouts read UNKNOWN rather than HOLD.
INVALID_HOLD_AFTER_S = 1.5
# Consecutive valid samples before we consider the sensor to be tracking
# something. Below this, an isolated echo off an empty room is just noise, and
# losing it must not escalate to HOLD.
VALID_RUN_FOR_TRACK = 5
# The SR501 holds its output HIGH for the period set by its on-board delay
# potentiometer, which the kit documentation gives as 3 seconds to 5 minutes.
# A long hold is therefore a legitimate SETTING, not a fault - but an output
# that has been high for minutes cannot tell "someone is still there" from
# "something triggered it four minutes ago", so past this point it stops
# counting as evidence of current presence.
PIR_HELD_AFTER_MS = 60000

# --- events ----------------------------------------------------------------
# Suppress repeats of the same continuous condition for this long.
EVENT_DEDUPE_S = 5.0

# --- vision (not part of this build) ---------------------------------------
ENABLE_VISION = False
DETECTION_CONFIDENCE = 0.55
DETECTION_DEBOUNCE_S = 0.10
FOD_PROXY_LABELS = {"bottle"}
VEHICLE_LABELS = {"car", "truck", "bus", "motorcycle"}
