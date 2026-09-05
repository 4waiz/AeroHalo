"""Off-board tests for the range risk logic.

Run from hardware/uno-q:   python tests/test_risk.py

These are SOFTWARE tests. Passing them says the maths is right; it says nothing
about whether a physical HC-SR04 is wired correctly.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "python"))

from risk import RangeTracker, assess  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print("  PASS  %s" % name)
    else:
        print("  FAIL  %s %s" % (name, detail))
        FAILURES.append(name)


print("assess(): missing data must never read as safe")
r = assess(None, 0.0, False)
check("no echo -> unknown flag", r["unknown"] is True)
check("no echo -> risk is None, not 0", r["risk"] is None)
check("no echo -> no fabricated ttz", r["ttz_s"] is None)

print("assess(): distance bands")
r = assess(734.0, 0.0, True)
check("73.4 cm -> level 0", r["level"] == 0, r)
check("73.4 cm -> risk under 25", r["risk"] is not None and r["risk"] < 30, r["risk"])

r = assess(430.0, 0.0, True)
check("43.0 cm -> level 1 caution", r["level"] == 1, r)
check("43.0 cm -> risk 25..60", 25 <= r["risk"] <= 60, r["risk"])

r = assess(186.0, 0.0, True)
check("18.6 cm -> level 2 hold", r["level"] == 2, r)
check("18.6 cm -> risk >= 80", r["risk"] >= 80, r["risk"])

print("assess(): stationary target has no predicted entry")
r = assess(600.0, 0.0, True)
check("stationary -> ttz None", r["ttz_s"] is None)
r = assess(600.0, 5.0, True)  # 0.5 cm/s, under the 2 cm/s noise floor
check("below noise floor -> ttz None", r["ttz_s"] is None)

print("assess(): prediction")
# 42.5 cm closing at 14 cm/s -> (425-200)/140 = 1.607 s -> predictive HOLD
r = assess(425.0, 140.0, True)
check("ttz computed", r["ttz_s"] is not None and abs(r["ttz_s"] - 1.607) < 0.01, r["ttz_s"])
check("ttz <= 2 s -> level 2", r["level"] == 2, r)
check("predictive hold risk >= 90", r["risk"] >= 90, r["risk"])

# 80 cm closing at 20 cm/s -> (800-200)/200 = 3.0 s -> predictive CAUTION
r = assess(800.0, 200.0, True)
check("ttz 3.0 s", abs(r["ttz_s"] - 3.0) < 0.01, r["ttz_s"])
check("3.0 s -> level 1", r["level"] == 1, r)

print("assess(): receding target never predicts entry")
r = assess(400.0, -50.0, True)
check("negative closing -> ttz None", r["ttz_s"] is None, r["ttz_s"])

print("RangeTracker: speed from timestamped MCU samples")
t = RangeTracker()
speed = 0.0
# 10 Hz, target closing 100 mm/s, starting at 800 mm.
for i in range(10):
    speed = t.update(seq=i, sampled_ms=i * 100, distance_mm=800 - i * 10, valid=True)
check("closing ~100 mm/s", abs(speed - 100.0) < 5.0, speed)

print("RangeTracker: duplicate sequence numbers do not distort the fit")
before = speed
after = t.update(seq=9, sampled_ms=900, distance_mm=710, valid=True)
check("duplicate seq keeps speed", abs(after - before) < 1e-9, (before, after))

print("RangeTracker: an invalid sample clears the window")
cleared = t.update(seq=10, sampled_ms=1000, distance_mm=-1, valid=False)
check("invalid -> speed 0", cleared == 0.0, cleared)
check("invalid -> window empty", len(t.samples) == 0)

print("RangeTracker: a receding target reports zero, not negative")
t2 = RangeTracker()
s = 0.0
for i in range(10):
    s = t2.update(seq=i, sampled_ms=i * 100, distance_mm=300 + i * 10, valid=True)
check("receding -> 0", s == 0.0, s)

print("RangeTracker: implausible jump resets rather than inventing speed")
t3 = RangeTracker()
for i in range(6):
    t3.update(seq=i, sampled_ms=i * 100, distance_mm=800 - i * 10, valid=True)
jump = t3.update(seq=6, sampled_ms=600, distance_mm=100, valid=True)
check("jump -> window reset, speed 0", jump == 0.0, jump)

print()
if FAILURES:
    print("%d FAILED: %s" % (len(FAILURES), ", ".join(FAILURES)))
    sys.exit(1)
print("All risk-logic tests passed.")
