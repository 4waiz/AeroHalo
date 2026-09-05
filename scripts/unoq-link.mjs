#!/usr/bin/env node
/**
 * Establish and verify the laptop -> Arduino UNO Q link.
 *
 *   npm run unoq:link     set up the forward and report board status
 *   npm run unoq:token    the above, and capture the controller token
 *
 * Why adb and not the board's LAN address:
 * The UNO Q joins the venue Wi-Fi and gets a real address, but the network
 * isolates clients, so the laptop cannot reach the board over Wi-Fi at all -
 * ping and every port time out. The USB ADB link is already authorised and is
 * the transport that actually works, so the App Lab web_ui port is forwarded to
 * localhost and the dashboard points at that.
 *
 * This deliberately does not scan the network and does not touch the firewall.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { adb, devicesWithRetry } from "./adb.mjs";

const PORT = Number(process.env.AEROHALO_UNOQ_PORT ?? 7000);
const APP = "user:aerohalo_range";
const TOKEN_FILE =
  "/home/arduino/ArduinoApps/aerohalo_range/data/controller_token";

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

/* ---- 1. is the board there? ------------------------------------------- */

const online = devicesWithRetry();

if (online.length === 0) {
  fail(
    "No UNO Q on ADB.\n" +
      "  Connect the board by USB-C, wait for it to finish booting, then rerun.\n" +
      "  Then run this again; it restarts the adb server for you."
  );
}

console.log(`UNO Q on ADB: ${online[0]}`);

/* ---- 2. forward the port ---------------------------------------------- */

adb(["forward", `tcp:${PORT}`, `tcp:${PORT}`]);   // idempotent
console.log(`Forward: localhost:${PORT} -> board ${PORT}`);

/* ---- 3. is the app actually serving? ---------------------------------- */

const res = await fetch(`http://127.0.0.1:${PORT}/api/state`, {
  cache: "no-store",
}).catch((e) => ({ ok: false, statusText: e.message }));

if (!res.ok) {
  fail(
    `Forward is up but the board is not serving on ${PORT}.\n` +
      `  Start the app:  adb shell arduino-app-cli app start ${APP}\n` +
      `  Reason: ${res.statusText ?? "unknown"}`
  );
}

const s = await res.json();
const r = s.range ?? {};
console.log(
  `Board app responding. connected=${s.hardware_connected} ` +
    `state=${s.risk?.state} sensors=${s.sensors_online}/${s.sensors_total} ` +
    `range=${r.distance_cm ?? "no echo"}`
);

/* ---- 4. capture the controller token ---------------------------------- */

if (process.argv.includes("--token")) {
  // Read the file the board application writes, NOT the log. The log line
  // scrolls out of the buffer as soon as the event stream gets going, which is
  // exactly when you need it: after a restart, mid-demo.
  const token = adb(["shell", `cat ${TOKEN_FILE} 2>/dev/null`])?.trim();

  if (token && token.length > 10) {
    // Written straight into .env.local, which is git-ignored. The token is
    // never printed, so it cannot end up in a screenshot or a screen recording.
    writeFileSync(
      join(process.cwd(), ".env.local"),
      `AEROHALO_UNOQ_URL=http://127.0.0.1:${PORT}\nAEROHALO_UNOQ_TOKEN=${token}\n`,
      "utf8"
    );
    console.log(`\nController token written to .env.local (${token.length} chars).`);
    console.log("No dev-server restart needed: it is re-read on every command.");
  } else {
    console.log("\nNo controller token file on the board yet.");
    console.log("  Start the app first:  npm run unoq:start");
  }
}

console.log(`\nDashboard: http://localhost:3000   (switch to LIVE HARDWARE)`);
