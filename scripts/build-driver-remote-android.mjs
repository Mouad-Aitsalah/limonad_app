#!/usr/bin/env node
/**
 * PHASE 5A.4 - explicit restore of REMOTE mode (see build-driver-local-
 * android.mjs's own doc comment). Deliberately DELETES
 * COMDIS_LOCAL_DRIVER_SHELL from the child's env, in case it is set in the
 * calling shell's own environment (e.g. a developer exported it earlier in
 * the same terminal session) - this script's whole job is to prove/restore
 * the REMOTE default regardless of shell state.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// See build-driver-local-android.mjs's own doc comment: always through a
// shell (npm/npx are .cmd shims on Windows), always a single static
// command-line string, never user input.
function run(commandLine, options = {}) {
  console.log(`\n> ${commandLine}`);
  const result = spawnSync(commandLine, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    ...options,
  });
  if (result.error) {
    console.error(`[android:driver-remote] Failed to run "${commandLine}":`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[android:driver-remote] Command failed (exit ${result.status}): ${commandLine}`);
    process.exit(result.status ?? 1);
  }
}

const env = { ...process.env };
delete env.COMDIS_LOCAL_DRIVER_SHELL;

console.log("[android:driver-remote] Syncing Android in REMOTE mode (no COMDIS_LOCAL_DRIVER_SHELL)...");
run("npx cap sync android", { env });

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

if (generatedConfig.server?.url !== "https://limonad-app.vercel.app") {
  console.error(
    `[android:driver-remote] Expected server.url to be restored to https://limonad-app.vercel.app, got: ${JSON.stringify(generatedConfig.server)}.`,
  );
  process.exit(1);
}
if (generatedConfig.webDir !== "www") {
  console.error(`[android:driver-remote] Expected webDir "www", got "${generatedConfig.webDir}".`);
  process.exit(1);
}

console.log(
  `[android:driver-remote] OK - server.url=${generatedConfig.server.url}, webDir=${generatedConfig.webDir}. Android project is back in REMOTE mode.`,
);
