#!/usr/bin/env node
/**
 * PHASE 5A.4 - "6. SCRIPT WINDOWS REPRODUCTIBLE".
 *
 * Cross-platform (Node child_process, no shell env-var prefix syntax like
 * `VAR=1 command` - that only works in POSIX shells, never plain cmd.exe/
 * PowerShell) equivalent of:
 *
 *   npm run build:driver-mobile
 *   COMDIS_LOCAL_DRIVER_SHELL=1 npx cap sync android
 *
 * The env var is injected via the child process's own `env` object, not
 * shell syntax - works identically on Windows, macOS, Linux.
 *
 * Does NOT run the Gradle build itself (JDK 21 must be selected by the
 * caller - see this phase's own report for why auto-detecting it here would
 * be fragile/machine-specific). Run that separately:
 *   cd android && .\gradlew assembleDebug (Windows) / ./gradlew assembleDebug
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// npm/npx are .cmd shims on Windows - spawnSync cannot exec them directly
// without a shell, so every command runs through one on every platform.
// Passed as ONE command-line string (not a command+args array) so
// `shell: true` never has to re-concatenate argv itself (the pattern
// Node's own docs warn is unsafe with untrusted input) - every command used
// here is a static, hardcoded literal, never user input.
function run(commandLine, options = {}) {
  console.log(`\n> ${commandLine}`);
  const result = spawnSync(commandLine, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    ...options,
  });
  if (result.error) {
    console.error(`[android:driver-local] Failed to run "${commandLine}":`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[android:driver-local] Command failed (exit ${result.status}): ${commandLine}`);
    process.exit(result.status ?? 1);
  }
}

console.log("[android:driver-local] 1/3 - building the driver shell (npm run build:driver-mobile)...");
run("npm run build:driver-mobile");

const distIndex = path.join(repoRoot, "mobile", "driver", "dist", "index.html");
const distAssets = path.join(repoRoot, "mobile", "driver", "dist", "assets");
if (!fs.existsSync(distIndex) || !fs.existsSync(distAssets)) {
  console.error(
    `[android:driver-local] Expected build output missing under mobile/driver/dist/ (index.html: ${fs.existsSync(distIndex)}, assets/: ${fs.existsSync(distAssets)}).`,
  );
  process.exit(1);
}

console.log("[android:driver-local] 2/3 - syncing Android in LOCAL mode (COMDIS_LOCAL_DRIVER_SHELL=1)...");
run("npx cap sync android", {
  env: { ...process.env, COMDIS_LOCAL_DRIVER_SHELL: "1" },
});

console.log("[android:driver-local] 3/3 - verifying the generated Capacitor config...");
const generatedConfigPath = path.join(
  repoRoot,
  "android",
  "app",
  "src",
  "main",
  "assets",
  "capacitor.config.json",
);
const generatedConfig = JSON.parse(fs.readFileSync(generatedConfigPath, "utf8"));

if (generatedConfig.server?.url) {
  console.error(
    `[android:driver-local] LOCAL sync still produced a server.url ("${generatedConfig.server.url}") - COMDIS_LOCAL_DRIVER_SHELL was not applied correctly.`,
  );
  process.exit(1);
}
if (generatedConfig.webDir !== "mobile/driver/dist") {
  console.error(
    `[android:driver-local] Expected webDir "mobile/driver/dist", got "${generatedConfig.webDir}".`,
  );
  process.exit(1);
}
if (generatedConfig.appId !== "ma.comdis.driver") {
  console.error(`[android:driver-local] appId changed unexpectedly: "${generatedConfig.appId}".`);
  process.exit(1);
}

console.log(
  `[android:driver-local] OK - webDir=${generatedConfig.webDir}, appId=${generatedConfig.appId}, no server.url.`,
);
console.log(
  "[android:driver-local] Android project is now in LOCAL mode. Build the APK yourself (JDK 21):\n" +
    "  cd android\n" +
    "  .\\gradlew assembleDebug   (Windows)   |   ./gradlew assembleDebug   (macOS/Linux)\n" +
    "  cd ..",
);
