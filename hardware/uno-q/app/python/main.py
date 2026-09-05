"""AeroHalo UNO Q application. Runs under Arduino App Lab on the board.

LIVE HARDWARE only: every distance published here comes from the HC-SR04 on
the microcontroller. There is no simulated, randomised or replayed range
anywhere in this file. If the sensor gives no echo the reading is reported
UNKNOWN, never 0 cm and never SAFE.

Serves:
    GET  /api/state    current telemetry (schema_version 2)
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
from risk import RangeTracker, assess, normalize_detections

ui = WebUI()
tracker = RangeTracker()
lock = threading.RLock()
commands = queue.Queue(maxsize=12)
operator_token = secrets.token_urlsafe(18)
events = deque(maxlen=400)

state = {
    "schema_version": 2,
    "source": "uno-q",
    "connected": False,
    "distance_cm": None,
    "raw_distance_cm": None,
    "closing_cm_s": None,
    "ttz_s": None,
    "risk": None,
    "status": "UNKNOWN",
    "hold": False,
    "sensor_valid": False,
    "servo_enabled": False,
    "engine_on": False,
    "vision_enabled": config.ENABLE_VISION,
    "vision_latched": False,
    "vision_seen": False,
    "detections": [],
    "vision_last_event_age_s": None,
    "sample_rate_hz": None,
    "alerts": ["Waiting for the first HC-SR04 reading."],
    "bridge_roundtrip_ms": None,
    "updated_utc": None,
    "sample_seq": None,
    "last_command": "None",
    "storage": "starting",
    "camera_scope": "Camera AI disabled in this build",
    "telemetry_line": "HC-SR04 | waiting for microcontroller",
    # OV7670 is a parallel DVP module, not a UVC device. It stays "absent"
    # until the board has actually identified it over SCCB.
    "camera": {
        "state": "absent",
        "sensor_id": None,
        "width": None,
        "height": None,
        "fps": None,
        "frame_age_s": None,
        "detail": "OV7670 bring-up not started",
    },
}

last_success = 0.0
last_valid_at = 0.0
manual_request = False
release_pending = False
engine_on = False
last_event_key = None

# Measured sample-rate window.
sample_count = 0
rate_window_start = 0.0
last_seen_seq = None

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


def add_event(severity, message):
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
            # Stale telemetry is UNKNOWN, never a reassuring status.
            result.update(
                connected=False,
                status="UNKNOWN",
                distance_cm=None,
                raw_distance_cm=None,
                closing_cm_s=None,
                ttz_s=None,
                risk=None,
                sensor_valid=False,
                sample_rate_hz=None,
            )
            result["alerts"] = [
                "No telemetry from the microcontroller. Range unknown."
            ]
            result["telemetry_line"] = "HC-SR04 | no telemetry"
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
    allowed = {"hold", "clear_after_inspection", "engine_on", "engine_off"}
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
    global manual_request, release_pending, engine_on
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
            elif command == "engine_on":
                engine_on = True
                # A mode change is never evidence that the zone is clear.
                manual_request = True
            elif command == "engine_off":
                engine_on = False
            state["engine_on"] = engine_on
            state["last_command"] = "Queued: " + command
        add_event("OPERATOR", command)


def loop():
    global last_success, last_valid_at, manual_request, release_pending
    global last_event_key, sample_count, rate_window_start, last_seen_seq

    started = time.monotonic()
    process_commands()

    try:
        raw = Bridge.call("read_sensors", timeout=config.MCU_TIMEOUT_S)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        sample = json.loads(raw)
        required = {"seq", "ms", "age_ms", "mm", "raw_mm", "valid", "held", "level"}
        if not isinstance(sample, dict) or not required.issubset(sample):
            raise ValueError("Unexpected MCU telemetry schema")

        now = time.monotonic()
        valid = (
            bool(sample["valid"])
            and 20 <= sample["mm"] <= 4000
            and sample["age_ms"] <= 500
        )
        if valid:
            last_valid_at = now

        speed = tracker.update(sample["seq"], sample["ms"], sample["mm"], valid)
        evaluation = assess(sample["mm"] if valid else None, speed, valid)

        # Measured sample rate, so a stalled sketch is visible rather than implied.
        if sample["seq"] != last_seen_seq:
            last_seen_seq = sample["seq"]
            sample_count += 1
            if rate_window_start == 0.0:
                rate_window_start = now
        elapsed = now - rate_window_start if rate_window_start else 0.0
        rate = round(sample_count / elapsed, 1) if elapsed >= 1.0 else None
        if elapsed > 10.0:  # slide the window so the figure stays current
            sample_count, rate_window_start = 0, now

        with lock:
            level = evaluation["level"]
            reasons = list(evaluation["reasons"])

            # Sustained loss of echo escalates to HOLD; a single dropout does
            # not. Either way the status is UNKNOWN, never SAFE.
            if evaluation["unknown"]:
                since_valid = now - last_valid_at if last_valid_at else None
                if since_valid is None or since_valid > config.INVALID_HOLD_AFTER_S:
                    level = 2
                    reasons.append(
                        "No valid echo for over %.1f s: holding"
                        % config.INVALID_HOLD_AFTER_S
                    )

            if manual_request:
                level = 2
                reasons.append("Manual HOLD requested by operator")

            release = False
            if release_pending:
                if valid and sample["mm"] > config.RELEASE_MM and level == 0:
                    release = True
                else:
                    state["last_command"] = (
                        "Reset refused: inspect the zone, move the target beyond "
                        "%.0f cm, hold it steady, then retry"
                        % (config.RELEASE_MM / 10)
                    )
                release_pending = False

            held = bool(
                Bridge.call(
                    "apply_command",
                    int(level),
                    bool(release),
                    timeout=config.MCU_TIMEOUT_S,
                )
            )
            if manual_request:
                manual_request = False  # the MCU owns the latch now

            if release:
                state["last_command"] = (
                    "Reset refused by MCU: hold a safe distance for 2 s"
                    if held
                    else "Reset accepted by MCU"
                )
                add_event("OPERATOR", state["last_command"])

            if held and not reasons:
                reasons.append(
                    "HOLD latched. Inspect the zone, then use Reset after inspection."
                )

            if not valid:
                status = "UNKNOWN"
            elif held:
                status = "HOLD"
            elif level == 1:
                status = "CAUTION"
            else:
                status = "SAFE"

            last_success = now
            state.update(
                connected=True,
                distance_cm=round(sample["mm"] / 10.0, 1) if valid else None,
                raw_distance_cm=(
                    round(sample["raw_mm"] / 10.0, 1) if sample["raw_mm"] > 0 else None
                ),
                closing_cm_s=round(speed / 10.0, 1) if valid else None,
                ttz_s=(
                    round(evaluation["ttz_s"], 2)
                    if evaluation["ttz_s"] is not None
                    else None
                ),
                risk=evaluation["risk"],
                status=status,
                hold=held,
                sensor_valid=valid,
                servo_enabled=bool(sample.get("servo_enabled", False)),
                sample_rate_hz=rate,
                alerts=reasons,
                bridge_roundtrip_ms=round((now - started) * 1000, 1),
                updated_utc=utc_now(),
                sample_seq=sample["seq"],
                engine_on=engine_on,
                telemetry_line=(
                    "HC-SR04 | Distance: %.1f cm | VALID" % (sample["mm"] / 10.0)
                    if valid
                    else "HC-SR04 | Distance: UNKNOWN"
                ),
            )

            # Log on meaningful transitions only, so the journal does not fill
            # with one entry per frame as the decimals move.
            event_key = (status, held, level, valid)
            if event_key != last_event_key:
                add_event(
                    status,
                    " | ".join(reasons) if reasons else "Range clear and stable",
                )
                last_event_key = event_key

    except Exception as exc:  # noqa: BLE001 - a dead link must not kill the loop
        tracker.clear()
        with lock:
            state.update(
                connected=False,
                status="UNKNOWN",
                hold=state.get("hold", False),
                risk=None,
                distance_cm=None,
                raw_distance_cm=None,
                closing_cm_s=None,
                ttz_s=None,
                sensor_valid=False,
                sample_rate_hz=None,
                alerts=["MCU communication failed: " + str(exc)],
                telemetry_line="HC-SR04 | MCU unreachable",
            )
        if last_event_key != ("ERROR",):
            add_event("ERROR", str(exc))
            last_event_key = ("ERROR",)
        # Never fabricate a successful HOLD here: the MCU watchdog is
        # independent and latches on its own when Linux goes quiet.

    time.sleep(max(0.005, config.POLL_INTERVAL_S - (time.monotonic() - started)))


print("AeroHalo LIVE HARDWARE mode. HC-SR04 on D6 (TRIG) / D7 (ECHO).", flush=True)
print("No simulated or randomised distance values are used.", flush=True)
print("Servo, DC motor, stepper, buzzer and camera AI are DISABLED.", flush=True)
print("CONTROLLER TOKEN (paste into dashboard): " + operator_token, flush=True)
add_event("STARTUP", "Waiting for the first real HC-SR04 reading.")
App.run(user_loop=loop)
