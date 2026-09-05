#!/usr/bin/env node
/**
 * Deploy and start the AeroHalo application on the board.
 *
 *   npm run unoq:start
 *
 * Pushes this repository's copy of the app to the board, compiles the MCU
 * sketch, flashes it over the on-board SWD adapter and launches the Python
 * service. Takes 30-60 s.
 *
 * The repo is the source of truth, so this is self-healing: if the board copy
 * is missing or half-deleted it is simply rewritten. That is not theoretical -
 * two `app restart` invocations landing at once once wiped
 * /home/arduino/ArduinoApps/aerohalo_range entirely, and the failure showed up
 * as a baffling "Error Finding Build Artifacts ... .cache/sketch: No such file
 * or directory". Pushing every time costs about a second and removes the whole
 * failure mode.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { ADB, adb, devicesWithRetry } from "./adb.mjs";

const APP = "user:aerohalo_range";
const REMOTE = "/home/arduino/ArduinoApps/aerohalo_range";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_APP = join(REPO, "hardware", "uno-q", "app");

/** Everything the board needs. Build artefacts are deliberately not included. */
const FILES = [
  "app.yaml",
  "python/main.py",
  "python/config.py",
  "python/risk.py",
  "python/requirements.txt",
  "sketch/sketch.ino",
  "sketch/sketch.yaml",
];

/* ---- 1. board present? ------------------------------------------------- */

const devices = devicesWithRetry();
if (devices.length === 0) {
  console.error(
    "\n  No UNO Q on ADB.\n" +
      "  Connect it by USB-C, give it about 40 s to boot, then run this again.\n"
  );
  process.exit(1);
}
console.log(`UNO Q on ADB: ${devices[0]}`);

/* ---- 2. push this repo's copy of the app ------------------------------- */

for (const f of FILES) {
  const local = join(LOCAL_APP, f);
  if (!existsSync(local)) {
    console.error(`\n  Missing from the repository: hardware/uno-q/app/${f}\n`);
    process.exit(1);
  }
}

adb(["shell", `mkdir -p ${REMOTE}/python ${REMOTE}/sketch ${REMOTE}/data`]);
for (const f of FILES) {
  const r = adb(["push", join(LOCAL_APP, f), `${REMOTE}/${f}`], { quiet: true });
  if (r === null) {
    console.error(`\n  Failed to push ${f} to the board.\n`);
    process.exit(1);
  }
}
console.log(`Deployed ${FILES.length} files from hardware/uno-q/app`);

/* ---- 3. start it ------------------------------------------------------- */

// `start` on a stopped app, `restart` on a running one. Asking a stopped app to
// restart makes App Lab flash the empty sketch first for no reason, which is
// slower and one more chance for the SWD lines to be contended.
const listing = adb(["shell", `arduino-app-cli app list 2>/dev/null | grep aerohalo`], {
  quiet: true,
});
const running = (listing ?? "").includes("running");
const verb = running ? "restart" : "start";

console.log(`Building and flashing on the board (${verb}). This takes 30-60 s...\n`);

const r = spawnSync(
  ADB,
  [
    "shell",
    `arduino-app-cli app ${verb} ${APP} 2>&1 | grep -E "aerohalo-flash: wrote|ERROR|Failed Upload"`,
  ],
  { encoding: "utf8", stdio: "inherit" }
);

if (r.status !== 0) {
  console.error(
    `\n  Start failed. Full log:\n` +
      `    "${ADB}" shell arduino-app-cli app logs ${APP}\n`
  );
  process.exit(1);
}

/* ---- 4. prove it is actually serving ----------------------------------- */

adb(["forward", "tcp:7000", "tcp:7000"], { quiet: true });

let ok = false;
for (let i = 0; i < 15; i++) {
  await new Promise((res) => setTimeout(res, 1000));
  const probe = await fetch("http://127.0.0.1:7000/api/state", {
    cache: "no-store",
  }).catch(() => null);
  if (probe?.ok) {
    const s = await probe.json();
    console.log(
      `\nApp serving. connected=${s.hardware_connected} ` +
        `state=${s.risk?.state} sensors=${s.sensors_online}/${s.sensors_total}`
    );
    ok = true;
    break;
  }
}

if (!ok) {
  console.error(
    "\n  Flashed, but the service is not answering on port 7000 yet.\n" +
      "  Give it a few seconds and run `npm run unoq:token` to check again.\n"
  );
  process.exit(1);
}

console.log("\nNext:  npm run unoq:token\n");
