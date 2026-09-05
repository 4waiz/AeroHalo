#!/usr/bin/env node
/**
 * Establish and verify the laptop -> Arduino UNO Q link, then print the
 * controller token line the dashboard needs.
 *
 *   node scripts/unoq-link.mjs          set up the forward and report status
 *   node scripts/unoq-link.mjs --token  also print the current controller token
 *
 * Why adb and not the board's LAN address:
 * The UNO Q joins the venue Wi-Fi and gets a real address, but the network
 * isolates clients, so the laptop cannot reach the board over Wi-Fi at all
 * (ping and every port time out). The USB ADB link is already authorised and
 * is the transport that actually works, so we forward the App Lab web_ui port
 * to localhost and point the dashboard at that.
 *
 * This deliberately does not scan the network and does not touch the firewall.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const PORT = Number(process.env.AEROHALO_UNOQ_PORT ?? 7000);

/** adb is not on PATH by default on Windows; check the usual places. */
function findAdb() {
  if (process.env.ADB_PATH && existsSync(process.env.ADB_PATH)) {
    return process.env.ADB_PATH;
  }
  const candidates = [
    `${process.env.LOCALAPPDATA ?? ""}\\Android\\Sdk\\platform-tools\\adb.exe`,
    `${process.env.USERPROFILE ?? ""}\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe`,
    "/usr/local/bin/adb",
    "/usr/bin/adb",
    "adb",
  ];
  for (const c of candidates) {
    if (c === "adb") return c;
    if (c && existsSync(c)) return c;
  }
  return "adb";
}

const ADB = findAdb();

function adb(args, { quiet = false } = {}) {
  try {
    return execFileSync(ADB, args, { encoding: "utf8" });
  } catch (err) {
    if (!quiet) {
      console.error(`adb ${args.join(" ")} failed: ${err.message}`);
    }
    return null;
  }
}

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

const devices = adb(["devices"]);
if (devices === null) {
  fail(
    "Could not run adb. Set ADB_PATH to your adb executable and try again."
  );
}

const online = devices
  .split("\n")
  .slice(1)
  .map((l) => l.trim())
  .filter((l) => l.endsWith("\tdevice"))
  .map((l) => l.split("\t")[0]);

if (online.length === 0) {
  fail(
    "No UNO Q on ADB.\n" +
      "  Connect the board by USB-C, wait for it to finish booting, then rerun.\n" +
      "  `adb devices` should list one device in state `device`."
  );
}

console.log(`UNO Q on ADB: ${online[0]}`);

// Idempotent: re-running just re-asserts the same forward.
adb(["forward", `tcp:${PORT}`, `tcp:${PORT}`]);
console.log(`Forward: localhost:${PORT} -> board ${PORT}`);

const res = await fetch(`http://127.0.0.1:${PORT}/api/state`, {
  cache: "no-store",
}).catch((e) => ({ ok: false, statusText: e.message }));

if (!res.ok) {
  fail(
    `Forward is up but the board is not serving on ${PORT}.\n` +
      `  Start the app:  adb shell arduino-app-cli app start user:aerohalo_range\n` +
      `  Reason: ${res.statusText ?? "unknown"}`
  );
}

const state = await res.json();
console.log(
  `Board app responding. connected=${state.connected} status=${state.status} ` +
    `distance_cm=${state.distance_cm ?? "null"}`
);

if (process.argv.includes("--token")) {
  const logs = adb([
    "shell",
    "arduino-app-cli app logs user:aerohalo_range 2>/dev/null | grep -F 'CONTROLLER TOKEN' | tail -1",
  ]);
  const m = logs?.match(/CONTROLLER TOKEN \(paste into dashboard\):\s*(\S+)/);
  if (m) {
    // Printed for the operator to paste into .env.local; not written to disk
    // here and never committed.
    console.log(`\nAEROHALO_UNOQ_TOKEN=${m[1]}`);
    console.log("Put that line in .env.local, then restart `npm run dev`.");
  } else {
    console.log("\nController token not found in the app log yet.");
  }
}

console.log(`\nDashboard should use AEROHALO_UNOQ_URL=http://127.0.0.1:${PORT}`);
