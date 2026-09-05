# AeroHalo hardware status

AeroHalo Predictive Airside Safety Dashboard
INSPIRE '26 — Engineering the Invisible — Arduino UNO Q Hackathon
American University of Sharjah · Track: Smart Aviation Systems
Creator: Awaiz Ahmed

Tabletop prototype. Not certified aviation software. It does not issue aircraft
clearance, does not prevent collisions, and has no authority over any real
aircraft or ground vehicle.

Everything in this file was read off the actual machine and the actual board.
Where something has not been verified it says so.

---

## 1. Toolchain, as installed

| Component | Version | How it was checked |
|---|---|---|
| Arduino App Lab (Windows) | 0.10.0 | installed at `C:\Program Files\Arduino\Arduino App Lab` |
| Arduino IDE (Windows) | 2.3.10 | installed; **not** used for this project — see §6 |
| `arduino-cli` (Windows) | 1.4.1 | `arduino-cli version` |
| `arduino-cli` (board) | present | `/usr/bin/arduino-cli` |
| `arduino-app-cli` (board) | present | `/usr/bin/arduino-app-cli`, daemon on `127.0.0.1:8800` |
| Board OS | Debian GNU/Linux 13 (trixie), aarch64 | `cat /etc/os-release`, `uname -a` |
| Board hostname | `Awaiz` | `uname -a` |
| **Zephyr core (board)** | **0.51.0** | `arduino-cli core list` on the board |
| Zephyr core (Windows) | 1.0.0 | `arduino-cli core list` on the laptop |
| `arm-zephyr-eabi` (Windows) | 1.0.1 | `Arduino15/packages/zephyr/tools` |
| Arduino_RouterBridge | **0.2.2** (BCMI-labs) | bundled inside core 0.51.0 |
| Arduino_RPCLite | **0.2.0** | bundled inside core 0.51.0 |
| MsgPack | **0.4.2** (hideakitai) | declared in `sketch.yaml`, installed from board staging |
| ArxContainer / ArxTypeTraits / DebugLog | 0.7.0 / 0.3.2 / 0.8.4 | declared in `sketch.yaml` |
| FQBN | `arduino:zephyr:unoq` | `boards.txt` (`unoq.name=Arduino UNO Q`) |

The laptop core (1.0.0) and the board core (0.51.0) are **different versions with
different bundled libraries**. Compiling on the laptop proves the C++ is valid;
only the board build proves the app will run. Do not treat them as equivalent.

---

## 2. The MsgPack build failure, and why it happened

Symptom:

```
fatal error: MsgPack.h: No such file or directory
```

Root cause, confirmed on the board:

- Zephyr core 0.51.0 **bundles** `Arduino_RouterBridge` (0.2.2) and
  `Arduino_RPCLite` (0.2.0) in `…/hardware/zephyr/0.51.0/libraries/`.
- `Arduino_RPCLite` does `#include <MsgPack.h>`.
- MsgPack is a **third-party** library (hideakitai) and was not bundled and not
  installed. `arduino-cli lib list` on the board reported
  `No libraries installed.`

Fix — `hardware/uno-q/app/sketch/sketch.yaml` declares MsgPack and its own
transitive dependencies as per-app libraries. Two details matter:

1. **Do not declare `Arduino_RouterBridge` / `Arduino_RPCLite`.** They ship
   inside the core. Declaring them installs 0.4.x on top and shadows the
   core-matched 0.2.2, risking an API mismatch.
2. **Leave `platform:` unversioned.** Pinning `arduino:zephyr (0.51.0)` makes
   arduino-cli re-verify the platform against the remote package index. The
   venue network runs a captive portal that MITMs TLS, so that HEAD request
   fails and the build aborts with
   `Platform 'arduino:zephyr' not found: platform not installed`.

The board image already ships all four archives in
`~/.arduino15/staging/libraries/`, so they install with **no network access**.

Verified: `arduino-cli compile --profile default` on the board →
`Sketch uses 20540 bytes (1%) of program storage space.`

Installing Python's `msgpack` package is **not** a fix for this and was not done.

---

## 3. Board transport

| Path | Status |
|---|---|
| USB **ADB** | **Working.** Device `1246088821`. This is the transport in use. |
| Board Wi-Fi (`wlan0`) | Board has a real address (`10.204.11.0/20`) but the venue network **isolates clients**: ping and every probed port time out from the laptop. Unusable. |
| Board `sshd` | Listening on `:22`, not used (no credentials handled). |
| `192.168.56.1` | A **VirtualBox host-only adapter on the laptop**, not the board. Never point the dashboard at it. |

The dashboard therefore reaches the board through an adb port forward:

```bash
npm run unoq:link
```

which asserts `adb forward tcp:7000 tcp:7000` and verifies `/api/state`
responds. No network scanning, no firewall changes, no public exposure.

---

## 4. MCU flashing

`arduino-app-cli app start` failed to upload for two independent reasons, both
found by reading the logs rather than guessing:

1. **No upload port.** The stock recipe passes
   `-s "{upload.port.properties.serialNumber}"`, which drives `remoteocd` in
   remote-over-adb mode. When `arduino-app-cli` runs *on the board*, the board
   cannot discover itself as a USB device, so arduino-cli logs `Port=""`, the
   placeholder expands empty, and remoteocd targets an adb device named `""`.
2. **RAM mode is broken on this board.** App Lab prefers
   `flash_sketch_ram.cfg`, which reads the sketch load address the Zephyr
   firmware is meant to publish in SRAM:

   ```tcl
   lassign [split [mdw 0x20000000] ":"] ram base
   load_image ${filename} 0x$base bin
   ```

   That word reads back `00000000`, so OpenOCD tries to load at `0x00000000`
   and fails with `Failed to write memory at 0x00000000`.

Flash mode (`flash_sketch.cfg`, writes to `0x080F0000`) works. Verified
manually: `TZEN = 0`, `RDP level 0`, image written, `shutdown command invoked`,
no error.

### Current workaround — REVIEW BEFORE THE DEMO

Two files were added to the board today. **Both are reversible.**

| File | Purpose |
|---|---|
| `~/.arduino15/packages/arduino/hardware/zephyr/0.51.0/platform.local.txt` | overrides `tools.remoteocd.upload.pattern` to call the wrapper below |
| `~/.local/bin/aerohalo-flash.sh` | drives remoteocd in local mode, forces flash mode over RAM mode, retries with a settle delay |

To restore stock behaviour completely:

```bash
adb shell rm /home/arduino/.arduino15/packages/arduino/hardware/zephyr/0.51.0/platform.local.txt
```

`platform.local.txt` did not exist before today, so deleting it fully reverts.
The retry delay exists because `app start` flashes `empty.ino` and then the real
sketch back to back, and the second OpenOCD run can claim the SWD bitbang GPIO
lines before they have settled.

**Preferred path if it works:** flashing from **App Lab desktop**, which supplies
a real USB serial number and therefore does not need the override. This has not
yet been re-tested — see §7.

---

## 5. HC-SR04 wiring (as built)

```
HC-SR04 VCC  -> UNO Q 5V
HC-SR04 GND  -> UNO Q GND
HC-SR04 TRIG -> UNO Q D6

HC-SR04 ECHO -> 2.2 kohm -> junction -> UNO Q D7
                              |
                           3.3 kohm
                              |
                             GND
```

Nominal divider output: `5 x 3.3 / (2.2 + 3.3) = 3.0 V`.

The divider is **mandatory**. HC-SR04 Echo is a 5 V signal and D7 is a 3.3 V
input. Software cannot verify a resistor value or a physical pin placement, so
this is recorded as *user-reported wiring*, photographed but not electrically
measured.

Firmware: `hardware/uno-q/app/sketch/sketch.ino`

- 10 Hz sampling, both echo waits bounded (30 ms worst case) so the MCU cannot hang
- median-of-3 then a light EMA; no invented values
- no echo → `valid=false`, reported as UNKNOWN, never 0 cm and never SAFE
- HOLD latches at ≤ 20 cm and never self-clears
- release requires an explicit operator reset **and** ≥ 2 s continuously beyond 50 cm
- 1.5 s link watchdog: if Linux stops talking, the MCU latches HOLD on its own
- servo, DC motor, stepper and buzzer are compiled out (`ENABLE_* 0`)

Verified: compiles clean on both cores (92432 bytes / 11 % on core 1.0.0).

---

## 6. Two toolchains, one MCU

Arduino IDE 2.3.10 and App Lab both target this board and **must not both own
the MCU**. Evidence that the IDE has been used here today: leftover
`GuideBot_ESP32_Robot_HTTP.ino.elf-zsk.bin` and a full
`zephyr-arduino_uno_q_stm32u585xx.elf` in `/tmp/remoteocd`.

**Chosen deployment path: Arduino App Lab / `arduino-app-cli`.** Do not upload
to the UNO Q from the Arduino IDE while App Lab owns the app, and close the IDE
serial monitor before a demo.

---

## 7. What is verified, and what is not

| Item | State |
|---|---|
| Frontend typecheck | **PASS** |
| Frontend production build | **PASS** |
| Risk-logic unit tests | **PASS** (`npm run test:hardware`) |
| MsgPack dependency repair | **PASS** — compiled on the board |
| Board app reaches `running`, serves `/api/state` | **PASS** |
| Laptop reaches the board API over adb forward | **PASS** |
| LIVE mode degrades truthfully with board unplugged | **PASS** — verified in browser |
| SIMULATION mode unchanged | **PASS** — verified in browser |
| **Live HC-SR04 distance on the dashboard** | **NOT YET** — needs the board reconnected |
| **Approach speed / predicted entry from real motion** | **NOT YET** |
| **HOLD latch and operator reset against real hardware** | **NOT YET** |
| **Warning LED visually confirmed** | **NOT YET** — requires a human to look at it |
| Stock (non-override) flashing via App Lab desktop | **NOT RE-TESTED** |
| **OV7670 SCCB identity** | **NOT ATTEMPTED** |
| OV7670 frame capture / live feed | **NOT ATTEMPTED** |

---

## 8. OV7670 — what is known so far

The module is an **OV7670 parallel DVP camera**, not a USB webcam. App Lab's
video bricks expect a Linux video device, so they will not drive this module.

One promising, unverified lead: zephyr core 0.51.0 bundles a `Camera` library
at `…/hardware/zephyr/0.51.0/libraries/Camera`. Whether it exposes a DCMI/PSSI
path usable for an OV7670 on the UNO Q pinout **has not been checked yet**.

Planned order (do not skip ahead):

1. SCCB/I²C identity — read PID/VER, expect `0x76 / 0x73`
2. MCLK present and in range
3. one QVGA RGB565 frame, validated for size and non-zero content
4. live stream to a board endpoint, then into the dashboard's OV7670 tab
5. detection only after a stable feed exists

Until step 1 passes, the dashboard shows `OV7670 OFFLINE — No valid camera
frames received`, which is the truth.

Wiring supplied by the operator is recorded in `hardware/OV7670.md` and must be
checked against the installed core's pinout before any pin is driven.

---

## 9. Risk score, defined

Deterministic and documented, computed in
`hardware/uno-q/app/python/risk.py`. No randomness.

Distance component, piecewise linear:

| Measured range | Risk |
|---|---|
| > 50 cm | 25 → 0, reaching 0 at 150 cm |
| 20–50 cm | 25 → 60 |
| ≤ 20 cm | 80 → 100 |

The 60→80 step at the critical boundary is deliberate: crossing it is a
discrete event. Prediction fills the 60–80 range for a target still outside the
boundary but closing fast:

- predicted entry ≤ 4 s → at least 65, level CAUTION
- predicted entry ≤ 2 s → at least 90, level HOLD

Predicted entry is only computed for a target actually closing faster than
2 cm/s, and is time to the **configured boundary** — not a time to collision
with anything.
