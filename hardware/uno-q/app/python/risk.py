"""Hardware-independent one-dimensional risk logic; unit-testable off the board.

Nothing in this module invents a measurement. Every function either works from
a real sample or reports that it cannot.
"""
from collections import deque
import math

from config import (
    CAUTION_MM,
    CRITICAL_MM,
    MIN_APPROACH_MM_S,
    PREDICT_CAUTION_S,
    PREDICT_HOLD_S,
)


class RangeTracker:
    """Least-squares closing speed over a short window of real samples.

    Timestamps come from the MCU's own millis() clock, not from the host's
    receive time, so speed is not distorted by Linux scheduling or HTTP jitter.
    """

    def __init__(self):
        self.samples = deque(maxlen=12)
        self.last_seq = None

    def clear(self):
        self.samples.clear()
        self.last_seq = None

    def update(self, seq, sampled_ms, distance_mm, valid):
        if not valid:
            # An invalid reading invalidates the whole window: extrapolating
            # across a dropout would manufacture a closing speed.
            self.clear()
            return 0.0
        if seq == self.last_seq:
            # Duplicate sample (poll faster than the MCU updates). Reuse the
            # existing fit rather than adding a zero-dt point.
            return self._speed()
        self.last_seq = seq

        t = float(sampled_ms) / 1000.0
        d = float(distance_mm)
        if self.samples:
            dt = t - self.samples[-1][0]
            # Reset on reboot, millis rollover, long gaps, or physically
            # implausible jumps (> 2 m/s of apparent motion).
            if dt <= 0 or dt > 0.5 or abs(d - self.samples[-1][1]) / dt > 2000:
                self.samples.clear()
        self.samples.append((t, d))
        while len(self.samples) > 1 and t - self.samples[0][0] > 0.8:
            self.samples.popleft()
        return self._speed()

    def _speed(self):
        """Positive result means closing on the sensor."""
        if len(self.samples) < 4 or self.samples[-1][0] - self.samples[0][0] < 0.29:
            # Too few points or too short a baseline to call it motion.
            return 0.0
        n = len(self.samples)
        mean_t = sum(t for t, _ in self.samples) / n
        mean_d = sum(d for _, d in self.samples) / n
        denominator = sum((t - mean_t) ** 2 for t, _ in self.samples)
        if denominator <= 0:
            return 0.0
        slope = sum((t - mean_t) * (d - mean_d) for t, d in self.samples) / denominator
        return max(0.0, -slope)


#: Distance at which the safe-band risk contribution reaches zero.
SAFE_ZERO_MM = 1500.0


def _distance_risk(d_mm):
    """Deterministic distance component of the risk score.

    Piecewise linear, keyed to the configured boundaries so the bands line up
    with the SAFE / CAUTION / HOLD the operator sees:

        d  > 50 cm          ->   0 .. 25   safe, decaying to 0 at 150 cm
        20 < d <= 50 cm     ->  25 .. 60   inside the caution boundary
        d <= 20 cm          ->  80 .. 100  inside the critical boundary

    The step from 60 to 80 at the critical boundary is deliberate: crossing it
    is a discrete event, not a gradual one. Prediction fills the 60-80 range
    for a target that is still outside the boundary but closing fast.
    """
    d = float(d_mm)
    if d <= CRITICAL_MM:
        # 20 cm -> 80, 0 cm -> 100
        return 80.0 + 20.0 * (CRITICAL_MM - max(0.0, d)) / CRITICAL_MM
    if d <= CAUTION_MM:
        # 50 cm -> 25, 20 cm -> 60
        span = CAUTION_MM - CRITICAL_MM
        return 25.0 + 35.0 * (CAUTION_MM - d) / span
    # 50 cm -> 25, 150 cm and beyond -> 0
    span = SAFE_ZERO_MM - CAUTION_MM
    return max(0.0, 25.0 * (SAFE_ZERO_MM - min(SAFE_ZERO_MM, d)) / span)


def assess(distance_mm, closing_mm_s, valid):
    """Evaluate one sample.

    Returns level 0 (safe), 1 (caution) or 2 (hold-worthy), a 0..100 risk
    figure, the predicted time to the critical boundary, and human-readable
    reasons.

    `ttz_s` is the time to the CONFIGURED BOUNDARY, not a time to collision
    with anything, and it is only defined for a target that is actually
    closing faster than the noise floor.
    """
    if not valid or distance_mm is None or not math.isfinite(float(distance_mm)):
        # No echo is UNKNOWN range: never 0 cm, never a measured hazard, and
        # never safe. Level 0 here would tell the MCU the zone is clear.
        return {
            "risk": None,
            "level": 0,
            "unknown": True,
            "ttz_s": None,
            "reasons": ["No echo from HC-SR04: range unknown"],
        }

    d = float(distance_mm)
    v = max(0.0, float(closing_mm_s))
    ttz = None
    if v >= MIN_APPROACH_MM_S and d > CRITICAL_MM:
        ttz = (d - CRITICAL_MM) / v

    risk = _distance_risk(d)
    level = 0
    reasons = []

    if d <= CRITICAL_MM:
        level = 2
        reasons.append("Object inside %.0f cm exclusion boundary" % (CRITICAL_MM / 10))
    elif d <= CAUTION_MM:
        level = 1
        reasons.append("Object inside %.0f cm caution boundary" % (CAUTION_MM / 10))

    # Prediction can only raise the level, never lower it.
    if ttz is not None and ttz <= PREDICT_HOLD_S:
        level = 2
        risk = max(risk, 90.0)
        reasons.append("Predicted boundary entry in %.1f s" % ttz)
    elif ttz is not None and ttz <= PREDICT_CAUTION_S:
        level = max(level, 1)
        risk = max(risk, 65.0)
        reasons.append("Predicted boundary entry in %.1f s" % ttz)

    return {
        "risk": int(round(max(0.0, min(100.0, risk)))),
        "level": level,
        "unknown": False,
        "ttz_s": ttz,
        "reasons": reasons,
    }


def normalize_detections(payload):
    """Accept label->list and older label->confidence detector formats."""
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
