"""AeroHalo sensor fusion and risk logic.

Hardware-independent and unit-testable off the board. Nothing here invents a
measurement: every function either works from a real sample or reports that it
could not.

There is exactly ONE risk engine. The MCU drives the LEDs from the level this
produces, and the dashboard renders the same score and the same reasons, so the
lights on the table and the numbers on the screen can never disagree.
"""
from collections import deque
import math

from config import (
    CAUTION_MM,
    CRITICAL_MM,
    MIN_APPROACH_MM_S,
    PREDICT_CAUTION_S,
    PREDICT_HOLD_S,
    RISK_CRITICAL_RANGE,
    RISK_PIR,
    RISK_PREDICT_CAUTION,
    RISK_PREDICT_HOLD,
    RISK_PROXIMITY_CAUTION,
    RISK_VIBRATION,
    BAND_CAUTION,
    BAND_HOLD,
)

# Levels shared with the MCU. Keep in step with sketch.ino.
LEVEL_SAFE = 0
LEVEL_CAUTION = 1
LEVEL_HOLD = 2
LEVEL_UNKNOWN = 3


class RangeTracker:
    """Least-squares closing speed over a short window of real samples.

    Timestamps come from the MCU's own millis() clock, not host receive time,
    so speed is not distorted by Linux scheduling or HTTP jitter.
    """

    def __init__(self):
        self.samples = deque(maxlen=12)
        self.last_seq = None

    def clear(self):
        self.samples.clear()
        self.last_seq = None

    def update(self, seq, sampled_ms, distance_mm, valid):
        if not valid:
            # Extrapolating across a dropout would manufacture a closing speed.
            self.clear()
            return 0.0
        if seq == self.last_seq:
            # Polled faster than the MCU updates. Reuse the fit rather than
            # adding a zero-dt point.
            return self._speed()
        self.last_seq = seq

        t = float(sampled_ms) / 1000.0
        d = float(distance_mm)
        if self.samples:
            dt = t - self.samples[-1][0]
            # Reset on reboot, millis rollover, long gaps, or physically
            # implausible motion (> 2 m/s).
            if dt <= 0 or dt > 0.5 or abs(d - self.samples[-1][1]) / dt > 2000:
                self.samples.clear()
        self.samples.append((t, d))
        while len(self.samples) > 1 and t - self.samples[0][0] > 0.8:
            self.samples.popleft()
        return self._speed()

    def _speed(self):
        """Positive result means closing on the sensor."""
        if len(self.samples) < 4 or self.samples[-1][0] - self.samples[0][0] < 0.29:
            return 0.0
        n = len(self.samples)
        mean_t = sum(t for t, _ in self.samples) / n
        mean_d = sum(d for _, d in self.samples) / n
        denominator = sum((t - mean_t) ** 2 for t, _ in self.samples)
        if denominator <= 0:
            return 0.0
        slope = sum((t - mean_t) * (d - mean_d) for t, d in self.samples) / denominator
        return max(0.0, -slope)


def time_to_boundary(distance_mm, closing_mm_s):
    """Seconds until the configured critical boundary, or None.

    Only defined for a target that is outside the boundary AND closing faster
    than the noise floor. This is time to a CONFIGURED BOUNDARY, not a time to
    collision with anything.
    """
    if distance_mm is None or distance_mm <= CRITICAL_MM:
        return None
    v = float(closing_mm_s)
    if v < MIN_APPROACH_MM_S:
        return None
    return (float(distance_mm) - CRITICAL_MM) / v


def range_assessment(distance_mm, closing_mm_s, valid):
    """Facts about the range sensor alone. No fusion, no scoring."""
    if not valid or distance_mm is None or not math.isfinite(float(distance_mm)):
        # No echo is UNKNOWN range: never 0 cm, never a hazard reading, and
        # never safe.
        return {
            "valid": False,
            "distance_cm": None,
            "ttz_s": None,
            "critical": False,
            "caution": False,
        }
    d = float(distance_mm)
    ttz = time_to_boundary(d, closing_mm_s)
    return {
        "valid": True,
        "distance_cm": round(d / 10.0, 1),
        "ttz_s": ttz,
        "critical": d <= CRITICAL_MM,
        "caution": CRITICAL_MM < d <= CAUTION_MM,
    }


def fuse(rng, pir_motion, vibration_event, range_unknown_too_long):
    """Combine the three sensors into one explainable safety state.

    Contributions are additive and clamped, and every one of them writes a
    human-readable reason, because the dashboard has to be able to say WHY it
    is in the state it is in.

    Returns score (0-100), level, reasons, and force_hold.

    `force_hold` is a safety override that ignores the banded score entirely:
    some conditions mean HOLD regardless of arithmetic.
    """
    score = 0
    reasons = []
    force_hold = False
    # Some conditions must raise the LEVEL even though their weight alone lands
    # inside a lower band. A predicted boundary entry scores 25, which is in the
    # 0-29 SAFE band - showing SAFE while predicting entry would defeat the
    # entire point of the system, so the level gets a floor.
    force_caution = False
    # Which condition forced the interlock. Reported separately so the HOLD
    # banner names the real cause instead of whatever happens to be first.
    force_reason = ""

    # --- proximity -------------------------------------------------------
    if rng["valid"]:
        if rng["critical"]:
            score += RISK_CRITICAL_RANGE
            force_hold = True
            force_reason = ("Object inside %.0f cm exclusion boundary (%.1f cm)"
                            % (CRITICAL_MM / 10, rng["distance_cm"]))
            reasons.append(force_reason)
        elif rng["caution"]:
            score += RISK_PROXIMITY_CAUTION
            reasons.append(
                "Object %.1f cm from sensor, inside the %.0f cm caution boundary"
                % (rng["distance_cm"], CAUTION_MM / 10)
            )

        # --- prediction --------------------------------------------------
        # Only the highest applicable band contributes; they do not stack.
        ttz = rng["ttz_s"]
        if ttz is not None:
            if ttz <= PREDICT_HOLD_S:
                score += RISK_PREDICT_HOLD
                force_hold = True
                force_reason = "Predicted boundary entry in %.1f s" % ttz
                reasons.append(force_reason)
            elif ttz <= PREDICT_CAUTION_S:
                score += RISK_PREDICT_CAUTION
                force_caution = True
                reasons.append("Predicted boundary entry in %.1f s" % ttz)
    else:
        reasons.append("No echo from HC-SR04: range unknown")
        if range_unknown_too_long:
            force_hold = True
            force_reason = "Range lost while a target was near the boundary"
            reasons.append(force_reason)

    # --- personnel -------------------------------------------------------
    # Presence only. This sensor cannot identify anyone and we do not claim it.
    if pir_motion:
        score += RISK_PIR
        reasons.append("Personnel / motion presence detected")

    # --- impact ----------------------------------------------------------
    # The concept is: possible aircraft or GSE impact -> inspection required.
    if vibration_event:
        score += RISK_VIBRATION
        force_hold = True
        force_reason = "Abnormal vibration: possible impact, inspection required"
        reasons.append(force_reason)

    score = max(0, min(100, score))

    if force_hold:
        level = LEVEL_HOLD
    elif score >= BAND_HOLD:
        level = LEVEL_HOLD
    elif score >= BAND_CAUTION or force_caution:
        level = LEVEL_CAUTION
    else:
        level = LEVEL_SAFE

    # A safe-looking score while the range sensor is blind is still not SAFE.
    if not rng["valid"] and level == LEVEL_SAFE:
        level = LEVEL_UNKNOWN

    return {
        "score": score,
        "level": level,
        "reasons": reasons,
        "force_hold": force_hold,
        "force_reason": force_reason,
    }


def normalize_detections(payload):
    """Accept label->list and older label->confidence detector formats.

    Retained for a future camera path; nothing calls it in this build.
    """
    result = []
    if not isinstance(payload, dict):
        return result
    for label, values in payload.items():
        if not isinstance(label, str):
            continue
        if not isinstance(values, list):
            values = [values]
        for item in values[:30]:
            if isinstance(item, dict):
                confidence = item.get("confidence", 0)
                box = item.get("bounding_box_xyxy")
            else:
                confidence, box = item, None
            try:
                confidence = float(confidence)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(confidence) or not 0 <= confidence <= 1:
                continue
            record = {"label": label, "confidence": confidence}
            if isinstance(box, (list, tuple)) and len(box) == 4:
                try:
                    coordinates = [float(x) for x in box]
                    if all(math.isfinite(x) for x in coordinates):
                        record["box_model_pixels"] = coordinates
                except (TypeError, ValueError):
                    pass
            result.append(record)
    return result[:50]
