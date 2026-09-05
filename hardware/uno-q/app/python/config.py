"""AeroHalo demo settings.

Every distance here is a tabletop demonstration value chosen so the effect is
visible on a desk. None of them are aviation standards and none of them are
derived from any real airside separation minimum.

Hardware bring-up build: HC-SR04 only. No servo, DC motor, stepper, buzzer or
camera AI is enabled anywhere in this application.
"""

# --- range boundaries (mm) -------------------------------------------------
CRITICAL_MM = 200.0   # <= 20 cm  -> HOLD / critical (latching)
CAUTION_MM = 500.0    # 20-50 cm  -> CAUTION; beyond -> SAFE
RELEASE_MM = 500.0    # operator reset only accepted beyond this

# --- prediction ------------------------------------------------------------
PREDICT_CAUTION_S = 4.0    # time-to-boundary <= 4 s -> predictive CAUTION
PREDICT_HOLD_S = 2.0       # time-to-boundary <= 2 s -> predictive HOLD
MIN_APPROACH_MM_S = 20.0   # 2 cm/s: below this, closing speed is not meaningful

# --- timing ----------------------------------------------------------------
POLL_INTERVAL_S = 0.10     # 10 Hz, matching the MCU sample rate
MCU_TIMEOUT_S = 1.0        # Bridge call timeout
# A single missed echo is normal for an HC-SR04. Only a sustained loss is
# treated as a hazard, so transient dropouts read UNKNOWN rather than HOLD.
INVALID_HOLD_AFTER_S = 1.5

# --- vision (disabled in this build) ---------------------------------------
ENABLE_VISION = False
DETECTION_CONFIDENCE = 0.55
DETECTION_DEBOUNCE_S = 0.10
FOD_PROXY_LABELS = {"bottle"}
VEHICLE_LABELS = {"car", "truck", "bus", "motorcycle"}
