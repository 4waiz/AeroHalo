"""Off-board tests for the AeroHalo range and fusion logic.

Run from hardware/uno-q:   python tests/test_risk.py

These are SOFTWARE tests. Passing them says the maths is right; it says nothing
about whether a sensor is wired correctly.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "python"))

from risk import (  # noqa: E402
    LEVEL_CAUTION,
    LEVEL_HOLD,
    LEVEL_SAFE,
    LEVEL_UNKNOWN,
    RangeTracker,
    fuse,
    range_assessment,
    time_to_boundary,
)

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print("  PASS  %s" % name)
    else:
        print("  FAIL  %s %s" % (name, detail))
        FAILURES.append(name)


def rng_at(cm, closing_cm_s=0.0, valid=True):
    return range_assessment(cm * 10 if cm is not None else None,
                            closing_cm_s * 10, valid)


print("range_assessment(): missing data is never a measurement")
r = range_assessment(None, 0.0, False)
check("no echo -> invalid", r["valid"] is False)
check("no echo -> distance None, not 0", r["distance_cm"] is None)
check("no echo -> no ttz", r["ttz_s"] is None)
check("no echo -> not critical", r["critical"] is False)

print("range_assessment(): bands")
check("73.4 cm -> neither band", not rng_at(73.4)["critical"] and not rng_at(73.4)["caution"])
check("43.0 cm -> caution", rng_at(43.0)["caution"] is True)
check("18.6 cm -> critical", rng_at(18.6)["critical"] is True)

print("time_to_boundary(): only for a real approach")
check("stationary -> None", time_to_boundary(600, 0.0) is None)
check("below noise floor -> None", time_to_boundary(600, 5.0) is None)
check("inside boundary -> None", time_to_boundary(150, 200.0) is None)
check("receding -> None", time_to_boundary(400, -50.0) is None)
t = time_to_boundary(425, 140.0)          # (425-200)/140
check("42.5 cm at 14 cm/s -> 1.61 s", t is not None and abs(t - 1.607) < 0.01, t)

print("fuse(): nothing happening is SAFE")
v = fuse(rng_at(80.0), False, False, False)
check("clear -> SAFE", v["level"] == LEVEL_SAFE, v)
check("clear -> low score", v["score"] < 30, v["score"])
check("clear -> no force", v["force_hold"] is False)

print("fuse(): a blind sensor is UNKNOWN, never SAFE")
v = fuse(rng_at(None, valid=False), False, False, False)
check("no echo -> UNKNOWN", v["level"] == LEVEL_UNKNOWN, v)
check("no echo -> not forced", v["force_hold"] is False, v)
check("unproven sensor -> says what to do",
      any("pass an object in front of it" in r for r in v["reasons"]), v["reasons"])

print("fuse(): losing a target ON the boundary does force HOLD")
v = fuse(rng_at(None, valid=False), False, False, True)
check("lost near boundary -> HOLD", v["level"] == LEVEL_HOLD, v)
check("lost near boundary -> forced", v["force_hold"] is True)

print("fuse(): proximity")
v = fuse(rng_at(43.0), False, False, False)
check("caution zone -> +30", v["score"] == 30, v["score"])
check("caution zone -> CAUTION", v["level"] == LEVEL_CAUTION, v)

v = fuse(rng_at(18.0), False, False, False)
check("critical -> forced HOLD", v["force_hold"] is True and v["level"] == LEVEL_HOLD, v)
check("critical -> +60", v["score"] >= 60, v["score"])
check("critical -> names itself", "exclusion boundary" in v["force_reason"], v["force_reason"])

print("fuse(): prediction")
v = fuse(rng_at(80.0, 20.0), False, False, False)   # ttz 3.0 s
check("ETA 3 s -> +25 CAUTION", v["level"] == LEVEL_CAUTION and v["score"] == 25, v)
v = fuse(rng_at(42.5, 14.0), False, False, False)   # ttz 1.6 s
check("ETA 1.6 s -> forced HOLD", v["force_hold"] and v["level"] == LEVEL_HOLD, v)
check("ETA 1.6 s -> caution+predict", v["score"] == 80, v["score"])

print("fuse(): personnel alone is normal near a stand, not a caution")
v = fuse(rng_at(80.0), True, False, False)
check("PIR alone -> +10", v["score"] == 10, v["score"])
check("PIR alone -> stays SAFE", v["level"] == LEVEL_SAFE, v)
check("PIR alone -> no force", v["force_hold"] is False, v)
check("PIR alone -> presence wording only",
      any("Personnel / motion" in r for r in v["reasons"]), v["reasons"])

print("fuse(): personnel WITH something at the boundary is the dangerous case")
v = fuse(rng_at(40.0), True, False, False)
check("PIR + caution -> +30 +35", v["score"] == 65, v["score"])
check("PIR + caution -> forced HOLD", v["level"] == LEVEL_HOLD and v["force_hold"], v)
check("PIR + caution -> says why",
      any("while an object is inside" in r for r in v["reasons"]), v["reasons"])

print("fuse(): one knock is not an impact")
v = fuse(rng_at(80.0), False, False, False, vibration_minor=True)
check("single knock -> +20", v["score"] == 20, v["score"])
check("single knock -> stays SAFE", v["level"] == LEVEL_SAFE, v)
check("single knock -> no latch", v["force_hold"] is False, v)

print("fuse(): a CONFIRMED impact forces HOLD regardless of score")
v = fuse(rng_at(80.0), False, True, False)
check("confirmed -> forced", v["force_hold"] is True and v["level"] == LEVEL_HOLD, v)
check("confirmed -> +55", v["score"] == 55, v["score"])
check("confirmed -> inspection wording", "inspection required" in v["force_reason"], v["force_reason"])

print("fuse(): contributions add and clamp")
v = fuse(rng_at(43.0, 14.0), True, True, False)
check("stacked -> clamped at 100", v["score"] == 100, v["score"])
check("stacked -> every cause listed", len(v["reasons"]) >= 3, v["reasons"])

print("fuse(): a sensor that has never seen anything is never SAFE")
v = fuse(rng_at(None, valid=False), True, False, False)
check("unproven + PIR -> UNKNOWN, not SAFE", v["level"] == LEVEL_UNKNOWN, v)

print("fuse(): a PROVEN sensor reporting silence means an empty corridor")
v = fuse(rng_at(None, valid=False), False, False, False, sensor_proven=True)
check("proven + silent -> SAFE", v["level"] == LEVEL_SAFE, v)
check("proven + silent -> says nothing detected",
      any("No object detected" in r for r in v["reasons"]), v["reasons"])
v = fuse(rng_at(None, valid=False), False, True, False, sensor_proven=True)
check("proven + silent + impact -> still HOLD", v["level"] == LEVEL_HOLD, v)

print("RangeTracker: speed from MCU timestamps")
t = RangeTracker()
speed = 0.0
for i in range(10):                       # 10 Hz, closing 100 mm/s from 800 mm
    speed = t.update(seq=i, sampled_ms=i * 100, distance_mm=800 - i * 10, valid=True)
check("closing ~100 mm/s", abs(speed - 100.0) < 5.0, speed)

before = speed
after = t.update(seq=9, sampled_ms=900, distance_mm=710, valid=True)
check("duplicate seq does not distort", abs(after - before) < 1e-9, (before, after))

cleared = t.update(seq=10, sampled_ms=1000, distance_mm=-1, valid=False)
check("invalid clears the window", cleared == 0.0 and len(t.samples) == 0)

t2 = RangeTracker()
s = 0.0
for i in range(10):
    s = t2.update(seq=i, sampled_ms=i * 100, distance_mm=300 + i * 10, valid=True)
check("receding reports 0, not negative", s == 0.0, s)

t3 = RangeTracker()
for i in range(6):
    t3.update(seq=i, sampled_ms=i * 100, distance_mm=800 - i * 10, valid=True)
check("implausible jump resets",
      t3.update(seq=6, sampled_ms=600, distance_mm=100, valid=True) == 0.0)

print()
if FAILURES:
    print("%d FAILED: %s" % (len(FAILURES), ", ".join(FAILURES)))
    sys.exit(1)
print("All fusion and range tests passed.")
