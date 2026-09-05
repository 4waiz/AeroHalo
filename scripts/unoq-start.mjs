#!/usr/bin/env node
/**
 * Start the AeroHalo application on the board.
 *
 *   npm run unoq:start
 *
 * Compiles the MCU sketch, flashes it over the on-board SWD adapter and
 * launches the Python service. Takes 30-60 s. Safe to re-run: it restarts a
 * running app rather than failing.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";
import { ADB, devicesWithRetry } from "./adb.mjs";

const APP = "user:aerohalo_range";

const devices = devicesWithRetry();
if (devices.length === 0) {
  console.error(
    "\n  No UNO Q on ADB.\n" +
      "  Connect it by USB-C, give it ~40 s to boot, then rerun.\n"
  );
  process.exit(1);
}

console.log(`UNO Q on ADB: ${devices[0]}`);
console.log("Building and flashing on the board. This takes 30-60 s...\n");

// Streamed rather than captured: the flash is the slow part, and watching it
// beats staring at a blank terminal wondering whether it hung.
const r = spawnSync(
  ADB,
  [
    "shell",
    `arduino-app-cli app restart ${APP} 2>&1 | grep -E "aerohalo-flash|ERROR|Failed Upload"`,
  ],
  { encoding: "utf8", stdio: "inherit" }
);

if (r.status !== 0) {
  console.error(
    `\n  Start failed. Full log:  adb shell arduino-app-cli app logs ${APP}\n`
  );
  process.exit(1);
}

console.log("\nApp started. Next:  npm run unoq:token\n");
