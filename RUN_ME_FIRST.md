# Running AeroHalo yourself

Three commands. Everything else is automatic.

```bash
npm run unoq:start     # start the app on the board
npm run unoq:token     # link the laptop to the board, capture the token
npm run dev            # start the dashboard
```

Then open **http://localhost:3000** and click **LIVE HARDWARE** in the header.

That's the whole thing. The rest of this file explains what each step does and
what to do when something is off.

---

## Before you start

- UNO Q connected by **USB-C** to the laptop.
- The three sensors and three LEDs wired (see `hardware/README.md`).
- Give the board ~40 seconds after plugging in. It boots a full Linux system.

Check it's there:

```bash
adb devices
```

You want one line ending in `device`. If the list is empty, the board is still
booting or the cable is charge-only.

---

## What each command does

### `npm run unoq:start`

Pushes this repository's copy of the app to the board, compiles the MCU sketch,
flashes it over the on-board SWD, launches the Python service, then waits until
the service actually answers before reporting success.

Takes 30–60 seconds. You'll see `aerohalo-flash: wrote ... on attempt 1` and
then `App serving. connected=true ...`.

**The repo is the source of truth**, so this is self-healing: if the board copy
is missing or damaged it is simply rewritten. Two `app restart` calls landing at
once once deleted the board's app directory outright, and the symptom was a
confusing `Error Finding Build Artifacts ... .cache/sketch: No such file or
directory`. Re-running this command fixes that completely.

### `npm run unoq:token`

Two jobs:

1. **Sets up the link.** Forwards `localhost:7000` to the board's port 7000
   over USB. This is how the dashboard reaches the board — *not* Wi-Fi. The
   venue network isolates clients, so the board's own IP is unreachable from
   the laptop even though both are online.
2. **Captures the controller token.** The board mints a new one every time its
   app starts, and operator commands (HOLD, Reset, LED test) need it. The
   script reads it off the board and writes `.env.local` for you.

It prints the board's live state, which is a quick health check:

```
Board app responding. connected=true state=SAFE sensors=3/3 range=73.4
```

If the board rebooted and `adb devices` went empty, this script restarts the
adb server and retries automatically — that's the usual fix.

### `npm run dev`

Starts the dashboard on http://localhost:3000.

---

## The two modes

**SIMULATION** — the full 3D airside: ground vehicles, personnel, FOD, the risk
heatmap, scripted scenarios. None of it is measured, and it never claims to be.

**LIVE HARDWARE** — the same 3D stand with every simulated entity removed and
the real HC-SR04 beam added. Every number comes from a sensor. Anything the
board could not measure reads `UNAVAILABLE`.

---

## Clearing a HOLD

HOLD **latches**. That is the point — something entered the exclusion zone and a
human needs to look.

To clear it:

1. Put a flat object ~70 cm in front of the HC-SR04, square to it.
2. Hold it still. The range must read valid and beyond 50 cm.
3. Press **Reset after inspection** and confirm.

The MCU independently re-checks that the range is valid, beyond 50 cm, steady
for 2 seconds, and that nothing is still vibrating. If any of that fails it
refuses and the panel tells you which condition blocked it. There is no route
around that check from the laptop side, by design.

---

## When something looks wrong

| What you see | What it means | Fix |
|---|---|---|
| `UNO Q OFFLINE` | board unplugged, rebooted, or app stopped | `npm run unoq:token` (restarts adb, re-links), then `npm run unoq:start` if needed |
| `Error Finding Build Artifacts` | the board's app directory was damaged | `npm run unoq:start` — it redeploys from the repo |
| `adb is not recognized` | adb is not on your PATH | you never need it directly; use the npm scripts, which find it themselves |
| `TELEMETRY STALE` | Linux is up, MCU has gone quiet | `npm run unoq:start` — it reflashes the sketch |
| `RANGE NO ECHO` | nothing in front of the sensor, or aimed past everything | put a flat target 30–80 cm away, square to it |
| `PIR OUTPUT HELD` | the SR501's delay pot is holding its output high | normal; it stops counting toward the score after 60 s. Turn the delay pot down if you want it snappier |
| Operator buttons 401 | token rotated when the board restarted | `npm run unoq:token`. No dev-server restart needed |
| Dashboard 500 / blank | `.next` build cache was disturbed | stop dev, `rm -rf .next`, `npm run dev` |

### One rule worth remembering

**Never run `npm run build` while `npm run dev` is serving.** They share the
`.next` directory, and the running server will start throwing chunk errors
mid-demo. Stop dev first.

---

## Checking things without the dashboard

The board's own API, straight through the forward:

```bash
curl -s http://127.0.0.1:7000/api/state
```

Software tests, no hardware needed:

```bash
npm run test:hardware
```

Board logs:

```bash
adb shell arduino-app-cli app logs user:aerohalo_range
```

---

## What this is

A tabletop prototype for INSPIRE '26. It is not certified aviation software, it
does not issue aircraft clearance, and it has no authority over anything real.
The distances, prediction, HOLD latch and LEDs are genuine measurements and
genuine hardware behaviour; the apron and aircraft are scenery.
