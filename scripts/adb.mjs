/**
 * Locating adb, in one place.
 *
 * Built with path.join rather than backslash string literals on purpose: those
 * are a menace to write correctly through a shell heredoc, and getting one
 * wrong silently produces a path like "AppData\LocalAndroidSdk..." that fails
 * with a confusing ENOENT instead of an obvious wrong-path error.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export function findAdb() {
  if (process.env.ADB_PATH && existsSync(process.env.ADB_PATH)) {
    return process.env.ADB_PATH;
  }

  const candidates = [];
  if (process.env.LOCALAPPDATA) {
    candidates.push(
      join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe")
    );
  }
  if (process.env.USERPROFILE) {
    candidates.push(
      join(
        process.env.USERPROFILE,
        "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe"
      )
    );
  }
  candidates.push("/usr/local/bin/adb", "/usr/bin/adb");

  for (const c of candidates) if (existsSync(c)) return c;
  return "adb";   // last resort: hope it is on PATH
}

export const ADB = findAdb();

/** Run adb, returning stdout or null. Never throws. */
export function adb(args, { quiet = false } = {}) {
  try {
    return execFileSync(ADB, args, { encoding: "utf8" });
  } catch (err) {
    if (!quiet) console.error(`adb ${args.join(" ")} failed: ${err.message}`);
    return null;
  }
}

/** Serial numbers of boards in state `device`. */
export function onlineDevices() {
  const out = adb(["devices"], { quiet: true });
  if (!out) return [];
  return out
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith("\tdevice"))
    .map((l) => l.split("\t")[0]);
}

/**
 * Devices, restarting the adb server once if the list comes back empty.
 *
 * A board that has rebooted is still present on USB but missing from adb until
 * the server re-scans, which happens constantly while developing. Kicking the
 * server is the fix nine times out of ten, so do it automatically rather than
 * making the operator remember.
 */
export function devicesWithRetry() {
  let found = onlineDevices();
  if (found.length) return found;

  console.log("No device listed; restarting the adb server and retrying...");
  adb(["kill-server"], { quiet: true });
  adb(["start-server"], { quiet: true });
  found = onlineDevices();
  return found;
}
