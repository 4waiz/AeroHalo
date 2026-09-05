"""AeroHalo UNO Q application. Runs under Arduino App Lab on the board.

LIVE HARDWARE only. Every value published here comes from a real sensor on the
microcontroller: HC-SR04 range, HC-SR501 personnel/motion, SW-420 vibration.
There is no simulated, randomised or replayed data anywhere in this file. If a
sensor cannot measure, the field is null and the state is UNKNOWN, never SAFE.

Serves:
    GET  /api/state    fused telemetry (schema_version 3)
    GET  /api/events   retained event log
    POST /api/command  operator command, Bearer controller token required
"""
import copy
import json
import os
import queue
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from arduino.app_utils import App, Bridge
from arduino.app_bricks.web_ui import WebUI
from fastapi import Header, HTTPException

import config
from risk import (
    LEVEL_CAUTION,
    LEVEL_HOLD,
    LEVEL_SAFE,
    LEVEL_UNKNOWN,
    RangeTracker,
    fuse,
    range_assessment,
)

ui = WebUI()
tracker = RangeTracker()
lock = threading.RLock()
commands = queue.Queue(maxsize=12)
operator_token = secrets.token_urlsafe(18)
events = deque(maxlen=400)

LEVEL_NAME = {
    LEVEL_SAFE: "SAFE",
    LEVEL_CAUTION: "CAUTION",
    LEVEL_HOLD: "HOLD",
    LEVEL_UNKNOWN: "UNKNOWN",
}

state = {
    "schema_version": 3,
    "source": "uno-q",
    "hardware_connected": False,

    "range": {
        "online": False,
        "valid": False,
        "distance_cm": None,
        "raw_distance_cm": None,
        "closing_cm_s": None,
        "time_to_boundary_s": None,
        "sample_age_ms": None,
        "sample_sequence": None,
        "sample_rate_hz": None,
        "state": "UNKNOWN",
        "detail": "Waiting for the first HC-SR04 reading",
    },
    "pir": {
        "online": False,
        "warming_up": True,
        "motion_detected": False,
        "last_trigger_ms": None,
        # Raw pin, so a module whose on-board delay pot holds the output HIGH
        # can be told apart from genuine repeated motion.
        "raw_high": False,
        "high_for_ms": 0,
        "suspect_stuck": False,
        "never_low": False,
        "state": "UNKNOWN",
        "detail": "Warming up",
    },
    "vibration": {
        "online": False,
        "triggered": False,
        "last_trigger_ms": None,
        "polarity": "unverified",
        "state": "UNKNOWN",
        "detail": "Learning idle level",
    },
    "outputs": {
        "green_led": False,
        "yellow_led": False,
        "red_led": False,
        "self_test_done": False,
        "servo_enabled": False,
        "servo_commanded_state": "disabled",
    },
    "risk": {"score": None, "state": "UNKNOWN", "reasons": []},
    # `hazard_cleared` is the difference between "something is wrong RIGHT NOW"
    # and "something was wrong, it has passed, and a human still has to sign it
    # off". Both are HOLD, and showing them identically made a screen of green
    # sensors next to a red verdict look like a contradiction.
    "hold": {"latched": False, "reason": "", "since": None,
             "hazard_cleared": False},

    "sensors_online": 0,
    "sensors_total": 3,
    "bridge_roundtrip_ms": None,
    "telemetry_age_s": None,
    "last_command": "None",
    "storage": "starting",
    "updated_at": None,
}

last_success = 0.0
last_valid_at = 0.0
manual_request = False
release_pending = False
lamp_test_pending = False
hold_since = None
hold_reason = ""

sample_count = 0
rate_window_start = 0.0
last_seen_seq = None
# Consecutive valid samples. A stray echo off an empty room is not a "track",
# so losing it must not be treated as losing a target we were following.
valid_run = 0
# Last computed sample rate, held across window resets.
last_rate_hz = None
# Distance at the moment the track was last seen, so losing a target far away
# is not treated the same as losing one on the boundary.
last_valid_mm = None
# Timestamps of recent distinct vibration edges, for burst confirmation.
vib_event_times = []

# Event de-duplication: key -> monotonic time it was last emitted.
_event_seen = {}
_last_state_key = None
_pir_announced = False
_vib_announced = False
_range_announced = False
# Previous edge states. Continuous conditions are logged when they BEGIN, not
# for as long as they last: someone standing in front of the PIR is one event,
# not one per poll.
_prev_pir_motion = False
_prev_caution = False
_prev_ttz_band = None

try:
    data_dir = Path(os.getenv("AERO_DATA_DIR", "/app/data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    log_file = data_dir / "events.jsonl"
    with log_file.open("a", encoding="utf-8"):
        pass
    state["storage"] = "JSONL at %s" % log_file
except OSError:
    log_file = None
    state["storage"] = "Memory only: export before stopping"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def add_event(severity, message, key=None, dedupe_s=None):
    """Append an event, suppressing repeats of a continuous condition.

    `key` identifies the condition. While the same key keeps arriving inside
    `dedupe_s` it is logged once, so holding an object at 30 cm produces one
    CAUTION line rather than ten per second.
    """
    now = time.monotonic()
    if key is not None:
        window = config.EVENT_DEDUPE_S if dedupe_s is None else dedupe_s
        previous = _event_seen.get(key)
        if previous is not None and now - previous < window:
            return
        _event_seen[key] = now

    entry = {"utc": utc_now(), "severity": severity, "message": message}
    with lock:
        events.appendleft(entry)
        if log_file is not None:
            try:
                with log_file.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(entry) + "\n")
            except OSError:
                state["storage"] = "Log write failed: memory/export still available"
    print("[%s] %s" % (severity, message), flush=True)


def get_state():
    with lock:
        result = copy.deepcopy(state)
        age = time.monotonic() - last_success if last_success else None
        result["telemetry_age_s"] = round(age, 3) if age is not None else None
        if age is None or age > 2.0:
            # Stale telemetry is UNKNOWN. It is never a reassuring state, and
            # no sensor is claimed online when nothing is arriving.
            result["hardware_connected"] = False
            result["range"].update(
                online=False, valid=False, distance_cm=None, raw_distance_cm=None,
                closing_cm_s=None, time_to_boundary_s=None, sample_rate_hz=None,
                state="UNKNOWN", detail="No telemetry from the microcontroller",
            )
            result["pir"].update(online=False, motion_detected=False,
                                 state="UNKNOWN", detail="No telemetry")
            result["vibration"].update(online=False, triggered=False,
                                       state="UNKNOWN", detail="No telemetry")
            result["sensors_online"] = 0
            result["risk"] = {
                "score": None,
                "state": "UNKNOWN",
                "reasons": ["No telemetry from the microcontroller"],
            }
        result["events"] = list(events)[:14]
        return result


def get_events():
    with lock:
        return {"events": list(events), "storage": state["storage"]}


def post_command(payload: dict, authorization: str = Header(default="")):
    supplied = authorization.removeprefix("Bearer ")
    if not secrets.compare_digest(supplied, operator_token):
        raise HTTPException(
            status_code=401,
            detail="Paste the controller token printed in the board console",
        )
    name = payload.get("command")
    allowed = {"hold", "clear_after_inspection", "lamp_test"}
    if name not in allowed:
        raise HTTPException(status_code=400, detail="Unknown command")
    try:
        commands.put_nowait(name)
    except queue.Full:
        raise HTTPException(status_code=429, detail="Command queue busy")
    return {
        "accepted": True,
        "command": name,
        "note": "Queued, not yet confirmed by hardware",
    }


ui.expose_api("GET", "/api/state", get_state)
ui.expose_api("GET", "/api/events", get_events)
ui.expose_api("POST", "/api/command", post_command)


def process_commands():
    global manual_request, release_pending, lamp_test_pending
    while True:
        try:
            command = commands.get_nowait()
        except queue.Empty:
            break
        with lock:
            if command == "hold":
                manual_request = True
                release_pending = False
            elif command == "clear_after_inspection":
                release_pending = True
            elif command == "lamp_test":
                lamp_test_pending = True
            state["last_command"] = "Queued: " + command
        add_event("OPERATOR", "Operator command: " + command)


def loop():
    global last_success, last_valid_at, manual_request, release_pending
    global sample_count, rate_window_start, last_seen_seq, lamp_test_pending
    global valid_run, last_valid_mm, vib_event_times, last_rate_hz
    global _last_state_key, _pir_announced, _vib_announced, _range_announced
    global _prev_pir_motion, _prev_caution, _prev_ttz_band
    global hold_since, hold_reason

    started = time.monotonic()
    process_commands()

    try:
        raw = Bridge.call("read_sensors", timeout=config.MCU_TIMEOUT_S)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        s = json.loads(raw)
        required = {"s", "t", "a", "d", "w", "v", "h", "l", "p", "pw", "b", "be"}
        if not isinstance(s, dict) or not required.issubset(s):
            raise ValueError("Unexpected MCU telemetry schema")

        now = time.monotonic()

        # ---- range ------------------------------------------------------
        valid = bool(s["v"]) and 20 <= s["d"] <= 4000 and s["a"] <= 500
        if valid:
            valid_run += 1
            # Only a sustained track arms the "signal lost" escalation. Half a
            # second of consecutive echoes means something is really there.
            if valid_run >= config.VALID_RUN_FOR_TRACK:
                last_valid_at = now
                last_valid_mm = s["d"]
        else:
            valid_run = 0
        speed = tracker.update(s["s"], s["t"], s["d"], valid)
        rng = range_assessment(s["d"] if valid else None, speed, valid)

        # Escalate to HOLD only if the range WAS valid and then went away.
        # Before the first ever reading the correct answer is UNKNOWN, not HOLD:
        # latching at power-on would force an operator reset before the
        # demonstration could even begin.
        # Losing the echo only escalates to HOLD if we lost a target that was
        # ACTUALLY NEAR THE BOUNDARY. An HC-SR04 pointed across a table sees
        # nothing most of the time, and "no object in range" is not a fault;
        # going blind while something sat at 25 cm is. Either way the state is
        # UNKNOWN, never SAFE - this only decides whether it latches.
        since_valid = now - last_valid_at if last_valid_at else None
        range_unknown_too_long = (
            since_valid is not None
            and since_valid > config.INVALID_HOLD_AFTER_S
            and last_valid_mm is not None
            # Only if we lost it INSIDE the exclusion boundary. Losing sight of
            # something at 45 cm is an ordinary dropout, not an emergency, and
            # latching on it kept the system red on a bench where the sensor
            # flickers constantly.
            and last_valid_mm <= config.CRITICAL_MM
        )

        # ---- PIR --------------------------------------------------------
        pir_warming = bool(s["pw"])
        pir_motion = bool(s["p"]) and not pir_warming
        pir_age_ms = int(s.get("pt", 999999))
        pir_seen = pir_age_ms < 999999
        sensor_proven = bool(s.get("ev", 0)) and config.NO_ECHO_IS_CLEAR
        pir_raw_high = bool(s.get("pr", 0))
        pir_high_for = int(s.get("ph", 0))
        # An HC-SR501 output that never falls is its delay potentiometer, not a
        # person standing still for a minute. Flag it rather than reporting
        # continuous personnel presence.
        pir_ever_low = bool(s.get("pl", 1))
        # D8 is pulled down, so a disconnected wire reads LOW. A pin that has
        # never once been LOW is being driven by something that is not a
        # working PIR output - most likely D8 is on the wrong header pin.
        pir_never_low = not pir_ever_low
        pir_suspect = pir_never_low or (
            pir_raw_high and pir_high_for > config.PIR_HELD_AFTER_MS
        )

        # ---- vibration --------------------------------------------------
        vib_calibrated = bool(s.get("bc", 0))
        vib_active = bool(s["b"])
        vib_edge = bool(s["be"])
        vib_age_ms = int(s.get("bt", 999999))
        vib_seen = vib_age_ms < 999999
        vib_idle_high = bool(s.get("bi", 1))

        # ---- fusion -----------------------------------------------------
        # Confirm an impact from a BURST, not a single knock. A real strike
        # rings the switch repeatedly; a bench bump does not, and treating one
        # bump as an impact left the interlock permanently red.
        if vib_edge:
            vib_event_times.append(now)
        vib_event_times = [
            t for t in vib_event_times
            if now - t <= config.VIB_CONFIRM_WINDOW_S
        ]
        vib_confirmed = len(vib_event_times) >= config.VIB_CONFIRM_COUNT
        vib_minor = bool(vib_edge) and not vib_confirmed

        # A confirmed vibration HOLD must survive the shaking stopping, so the
        # engine is fed the latch, not the instantaneous line level.
        vib_forces_hold = vib_confirmed or (
            state["vibration"]["triggered"] and state["hold"]["latched"]
        )
        # A stuck output is a sensor fault, not personnel. Excluded from the
        # score so it cannot hold the whole system at CAUTION indefinitely.
        verdict = fuse(rng, pir_motion and not pir_suspect,
                       vib_forces_hold, range_unknown_too_long,
                       vibration_minor=vib_minor,
                       sensor_proven=sensor_proven)

        level = verdict["level"]
        reasons = list(verdict["reasons"])
        if manual_request:
            level = LEVEL_HOLD
            reasons.append("Manual HOLD requested by operator")

        # ---- operator release -------------------------------------------
        # The physical button and the dashboard button take the same path and
        # face the same interlocks.
        button_request = bool(s.get("bq", 0))
        if button_request and not release_pending:
            release_pending = True
            add_event("OPERATOR", "Physical reset button pressed",
                      key="btn", dedupe_s=1.0)

        release = False
        if release_pending:
            # Deliberately NOT blocked on PIR motion. The operator pressing the
            # button is themselves a person standing in front of a sensor with a
            # 7 m, 140-degree cone, so requiring "no motion" would make the
            # reset impossible to use - it would refuse precisely because
            # somebody came to perform the inspection it is asking for.
            #
            # The conditions that DO matter are the ones the operator can
            # actually put right: the monitored zone must be measurably clear,
            # and nothing may still be shaking.
            # No echo is NOT a blocker. An HC-SR04 aimed down an empty lane
            # reports no echo by design; treating that as "cannot verify" made
            # the reset impossible to use and left the interlock red forever.
            # What blocks a release is something MEASURABLY inside the
            # boundary, or a disturbance still in progress.
            blockers = []
            if valid and s["d"] <= config.RELEASE_MM:
                blockers.append("target within %.0f cm" % (config.RELEASE_MM / 10))
            if vib_active:
                blockers.append("vibration still active")
            if blockers:
                state["last_command"] = "Reset refused: " + ", ".join(blockers)
                add_event("OPERATOR", state["last_command"], key="reset_refused")
            else:
                release = True
            release_pending = False

        # ---- operator lamp test -----------------------------------------
        # Issued from the main loop like every other MCU call, so there is one
        # controlled path to the Bridge and no overlapping RPCs.
        if lamp_test_pending:
            lamp_test_pending = False
            try:
                Bridge.call("lamp_test", timeout=config.MCU_TIMEOUT_S)
                state["last_command"] = "Lamp test commanded (watch the LEDs)"
                add_event("INFO", "Lamp test commanded: green, yellow, red")
            except Exception as exc:  # noqa: BLE001
                state["last_command"] = "Lamp test failed: %s" % exc

        # ---- command the MCU --------------------------------------------
        held = bool(
            Bridge.call("apply_command", int(level), bool(release),
                        timeout=config.MCU_TIMEOUT_S)
        )
        if manual_request:
            manual_request = False   # the MCU owns the latch now

        if release:
            if held:
                state["last_command"] = (
                    "Reset refused by MCU: hold a safe distance for 2 s")
                add_event("OPERATOR", state["last_command"])
            else:
                state["last_command"] = "Operator inspection completed"
                add_event("INFO", "Operator inspection completed. HOLD released.")
                _event_seen.clear()   # let the next real condition speak again

        if held:
            level = LEVEL_HOLD

        # ---- measured sample rate ---------------------------------------
        if s["s"] != last_seen_seq:
            last_seen_seq = s["s"]
            sample_count += 1
            if rate_window_start == 0.0:
                rate_window_start = now
        elapsed = now - rate_window_start if rate_window_start else 0.0
        if elapsed >= 1.0:
            last_rate_hz = round(sample_count / elapsed, 1)
        # Hold the last figure across the window reset. Recomputing from zero
        # every ten seconds made the panel blink to UNAVAILABLE for a second at
        # a time, which reads as a fault rather than as arithmetic.
        rate = last_rate_hz
        if elapsed > 10.0:
            sample_count, rate_window_start = 0, now

        state_name = LEVEL_NAME[level]

        # Per-sensor severity, on the same SAFE / CAUTION / HOLD vocabulary as
        # the fused state. Derived here rather than in the browser so there is
        # exactly one place safety logic lives.
        if not valid and not sensor_proven:
            range_state = "UNKNOWN"
        elif valid and rng["critical"]:
            range_state = "HOLD"
        elif valid and rng["caution"]:
            range_state = "CAUTION"
        else:
            range_state = "SAFE"

        # An object inside a boundary is what turns personnel presence from a
        # note into a hazard, so the PIR escalates with the proximity it is
        # standing next to.
        if pir_warming or pir_suspect:
            pir_state = "UNKNOWN"
        elif not pir_motion:
            pir_state = "SAFE"
        elif range_state in ("HOLD", "CAUTION"):
            pir_state = "HOLD"
        else:
            pir_state = "CAUTION"

        if not vib_calibrated:
            vib_state = "UNKNOWN"
        elif vib_confirmed:
            vib_state = "HOLD"
        elif vib_active or vib_edge:
            vib_state = "CAUTION"
        else:
            vib_state = "SAFE"


        # ---- one-time "online" announcements ----------------------------
        if valid and not _range_announced:
            _range_announced = True
            add_event("INFO", "HC-SR04 online")
        if not pir_warming and not _pir_announced:
            _pir_announced = True
            add_event("INFO", "PIR ready (warm-up complete)")
        if vib_calibrated and not _vib_announced:
            _vib_announced = True
            add_event("INFO", "SW-420 online, idle level %s"
                      % ("HIGH" if vib_idle_high else "LOW"))

        # ---- condition events, logged on the EDGE ------------------------
        # Each of these is a continuous condition. Logging it once when it
        # begins keeps the timeline readable; logging it per poll fills the
        # screen with the same line and buries everything else.
        if pir_motion and not _prev_pir_motion:
            add_event("HIGH", "Personnel / motion detected",
                      key="pir_motion", dedupe_s=30.0)
        elif _prev_pir_motion and not pir_motion:
            # Deduped: a PIR that keeps re-triggering would otherwise fill the
            # timeline with alternating detected/clear pairs and bury
            # everything else.
            add_event("INFO", "Personnel zone clear", key="pir_clear", dedupe_s=30.0)
        _prev_pir_motion = pir_motion

        if vib_edge:
            # Already edge-latched on the MCU; the window just stops a burst of
            # taps becoming a burst of lines.
            add_event("CRITICAL",
                      "Abnormal vibration detected. Possible impact, inspection required",
                      key="vib", dedupe_s=2.0)

        ttz_band = None
        if rng["valid"] and rng["ttz_s"] is not None:
            if rng["ttz_s"] <= config.PREDICT_HOLD_S:
                ttz_band = "hold"
            elif rng["ttz_s"] <= config.PREDICT_CAUTION_S:
                ttz_band = "caution"
        if ttz_band is not None and ttz_band != _prev_ttz_band:
            add_event("CRITICAL" if ttz_band == "hold" else "HIGH",
                      "Predicted boundary entry in %.1f s" % rng["ttz_s"])
        _prev_ttz_band = ttz_band

        in_caution = bool(rng["valid"] and rng["caution"])
        if in_caution and not _prev_caution:
            add_event("CAUTION", "Object entered caution zone. Distance %.1f cm"
                      % rng["distance_cm"])
        elif _prev_caution and not in_caution and rng["valid"]:
            add_event("INFO", "Object left the caution zone")
        _prev_caution = in_caution

        with lock:
            if held and hold_since is None:
                hold_since = utc_now()
                hold_reason = (verdict.get("force_reason")
                               or (reasons[0] if reasons else "Safety interlock engaged"))
                add_event("HOLD", "Safety interlock engaged: " + hold_reason)
            elif not held:
                hold_since = None
                hold_reason = ""

            # Put the latch at the TOP of the reason list whenever it is set.
            # Without this the panel showed only whatever was happening right
            # now - "No echo from HC-SR04" - while the actual cause, a vibration
            # event minutes earlier, was invisible. The operator was left
            # looking at a HOLD with no explanation for it.
            if held:
                latch_line = "HOLD latched: %s" % (
                    hold_reason or "safety interlock engaged")
                reasons = [latch_line] + [r for r in reasons if r != latch_line]
                if range_state == "SAFE" and pir_state == "SAFE" and vib_state == "SAFE":
                    reasons.append(
                        "All sensors now read SAFE. The interlock is held open "
                        "pending operator inspection, not by a live hazard.")
                reasons.append(
                    "Clear it with Reset after inspection once the zone is verified")

            last_success = now
            online = (
                (1 if (valid or sensor_proven) else 0)
                + (1 if (not pir_warming and not pir_suspect) else 0)
                + (1 if vib_calibrated else 0)
            )

            state["hardware_connected"] = True
            state["range"].update(
                online=True,
                valid=valid,
                distance_cm=rng["distance_cm"],
                raw_distance_cm=round(s["w"] / 10.0, 1) if s["w"] > 0 else None,
                closing_cm_s=round(speed / 10.0, 1) if valid else None,
                time_to_boundary_s=(
                    round(rng["ttz_s"], 2) if rng["ttz_s"] is not None else None),
                sample_age_ms=int(s["a"]),
                sample_sequence=int(s["s"]),
                sample_rate_hz=rate,
                state=range_state,
                detail=(
                    "HC-SR04 on D6 / D7" if valid
                    else "No object within sensor range" if sensor_proven
                    # Until the sensor returns one real reading we cannot tell
                    # "nothing there" from "not working", so say what would
                    # settle it rather than leaving the operator guessing.
                    else "Not yet proven: pass an object in front of it once"),
            )
            state["pir"].update(
                online=not pir_warming and not pir_suspect,
                warming_up=pir_warming,
                motion_detected=pir_motion,
                last_trigger_ms=pir_age_ms if pir_seen else None,
                raw_high=pir_raw_high,
                high_for_ms=pir_high_for,
                suspect_stuck=pir_suspect,
                never_low=pir_never_low,
                state=pir_state,
                detail=(
                    "Warming up" if pir_warming
                    else "Pin never LOW since boot: D8 may not be on the OUT pin"
                         if pir_never_low
                    else "Output held high %.0f s: check the module delay pot"
                         % (pir_high_for / 1000.0) if pir_suspect
                    else "Motion detected" if pir_motion
                    else "Clear"),
            )
            state["vibration"].update(
                online=vib_calibrated,
                triggered=vib_active or vib_edge,
                last_trigger_ms=vib_age_ms if vib_seen else None,
                state=vib_state,
                polarity=(
                    "unverified" if not vib_calibrated
                    else ("active-low" if vib_idle_high else "active-high")),
                detail=(
                    "Learning idle level" if not vib_calibrated
                    else "Impact detected" if (vib_active or vib_edge)
                    else "Normal"),
            )
            state["outputs"].update(
                green_led=bool(s.get("g", 0)),
                yellow_led=bool(s.get("y", 0)),
                red_led=bool(s.get("r", 0)),
                self_test_done=bool(s.get("st", 0)),
                servo_enabled=bool(s.get("sv", 0)),
                servo_commanded_state="disabled",
            )
            # A latched HOLD must not read 0%. The gauge and the state are two
            # views of the same thing, and once the interlock is set the system
            # IS in the hold band regardless of what the sensors say right now.
            shown_score = verdict["score"]
            if held:
                shown_score = max(shown_score, config.BAND_HOLD)

            state["risk"] = {
                "score": shown_score if (
                    rng["valid"] or sensor_proven or pir_motion or vib_edge or held
                ) else None,
                "state": state_name,
                "reasons": reasons,
            }
            all_sensors_safe = (
                range_state == "SAFE"
                and pir_state == "SAFE"
                and vib_state == "SAFE"
            )
            state["hold"] = {
                "latched": held,
                "reason": hold_reason,
                "since": hold_since,
                "hazard_cleared": bool(held and all_sensors_safe),
            }
            state["sensors_online"] = online
            state["bridge_roundtrip_ms"] = round((now - started) * 1000, 1)
            state["updated_at"] = utc_now()

    except Exception as exc:  # noqa: BLE001 - a dead link must not kill the loop
        tracker.clear()
        with lock:
            state["hardware_connected"] = False
            state["range"].update(online=False, valid=False, distance_cm=None,
                                  closing_cm_s=None, time_to_boundary_s=None,
                                  detail="MCU unreachable")
            state["pir"].update(online=False, motion_detected=False,
                                detail="MCU unreachable")
            state["vibration"].update(online=False, detail="MCU unreachable")
            state["sensors_online"] = 0
            state["risk"] = {
                "score": None,
                "state": "UNKNOWN",
                "reasons": ["MCU communication failed: " + str(exc)],
            }
        add_event("ERROR", "MCU communication failed: " + str(exc), key="mcu_err")
        # Never fabricate a successful HOLD: the MCU watchdog is independent and
        # latches on its own when Linux goes quiet.

    time.sleep(max(0.005, config.POLL_INTERVAL_S - (time.monotonic() - started)))


print("AeroHalo LIVE HARDWARE. Three-sensor fusion:", flush=True)
print("  HC-SR04 range   D6 TRIG / D7 ECHO (through the 2.2k/3.3k divider)", flush=True)
print("  HC-SR501 PIR    D8", flush=True)
print("  SW-420 vibration D10", flush=True)
print("  Status LEDs     D3 green / D4 yellow / D5 red", flush=True)
print("Servo (D9) is DISABLED and not commanded.", flush=True)
print("No simulated or randomised sensor values are used.", flush=True)
print("CONTROLLER TOKEN (paste into dashboard): " + operator_token, flush=True)

# Also write it into the app's data directory. The log line scrolls out of the
# buffer once the event stream gets going, so scraping the log for it is
# unreliable exactly when you need it - after a restart, mid-demo.
#
# The path matters: this application runs in a container where /app is a bind
# mount of the app directory on the board, so /app/data lands somewhere the
# host (and therefore `adb shell cat`) can actually read. The container's own
# /tmp is private and would be useless here.
try:
    _token_path = data_dir / "controller_token"
    with _token_path.open("w", encoding="utf-8") as _fh:
        _fh.write(operator_token)
except (OSError, NameError) as _exc:  # pragma: no cover - best effort only
    print("Could not write the controller token file: %s" % _exc, flush=True)
add_event("INFO", "UNO Q connected. Waiting for the first sensor readings.")
App.run(user_loop=loop)
