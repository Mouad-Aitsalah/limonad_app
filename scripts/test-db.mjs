#!/usr/bin/env node
// Runs the database-backed tests (`*.integration.test.ts`) against a THROWAWAY local PostgreSQL database.
//
//   npm run test:db                                       all database tests
//   npm run test:db -- <file> [<file>] [--timeout-ms=N]   only the given files / another per-file timeout
//   npm run test:db:check                                 validate the configuration, create nothing
//   npm run test:db:cleanup [-- --owner-token=<token>]    drop a throwaway database left by an interrupted run
//
// Required environment variable (never read from .env on purpose, so a default URL can never be picked up):
//   COMDIS_TEST_DB_ADMIN_URL   connection URL of a LOCAL PostgreSQL server (user allowed to CREATE DATABASE),
//                              e.g. postgresql://user:password@localhost:5432/postgres
// Optional: COMDIS_TEST_DB_TIMEOUT_MS (per-file timeout, default 600000 ms; --timeout-ms wins).
//
// The logic lives in scripts/test-db/core.mjs (unit-tested by scripts/test-db/core.test.mjs without any database).
// Safety rules:
//   - loopback host, port 5432, no connection-string override, no Neon/Vercel/cloud marker; the server itself must
//     confirm a loopback address and a primary;
//   - the only database ever created or dropped is `commdis_d2_test`, and it is dropped ONLY while its comment carries
//     the ownership token of the run that created it (never on the name alone). A database of that name that this script
//     did not create is never touched. The token, the database oid and the machine are recorded in the database comment and in a
//     private per-user record (state-store.mjs, created exclusively, not in the shared temp directory). A database left by an
//     interrupted run is cleaned only after its ownership is proven by that record (absent, invalid or contradictory record =
//     no automatic cleanup) or explicitly confirmed with --owner-token; if the comment cannot be written, recovery drops the
//     database only while it is still the exact oid captured right after CREATE;
//   - `test:db` and `test:db:cleanup` hold a PostgreSQL advisory lock and cannot run at the same time;
//   - the child processes receive an explicit allow-list of variables plus the throwaway URLs, never the administrative
//     URL or any other database URL, and never read the repository's .env;
//   - on SIGINT / SIGTERM / SIGHUP / SIGBREAK nothing new starts, the running test process TREE is stopped and awaited, then
//     the database is dropped. A forced kill (kill -9, taskkill /F, power loss) cannot be intercepted: the database then stays
//     until `npm run test:db:cleanup`;
//   - nothing is skipped silently, a timeout or a failed cleanup is a failure.
//
// Exit codes: 0 pass | 1 failure (test, skip, migration, timeout, cleanup, error) | 2 refused | 130 interrupted.
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants as osConstants, homedir, hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { ADMIN_ENV, Refusal, makeControl, parseAdminUrl, parseArgs, readProductionFragment, refuse, runChild, runCleanup, runSuite, sanitizeHost } from "./test-db/core.mjs";
import { createStateStore, defaultStateDir } from "./test-db/state-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["lib", "app", "components", "hooks"];

function discoverFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.integration\.test\.tsx?$/.test(entry) && readFileSync(full, "utf8").includes("D2_TEST_DATABASE_URL")) {
        found.push(path.relative(ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir));
  return found.sort();
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // exists but belongs to someone else
  }
}

const deps = {
  root: ROOT,
  stubsDir: path.join(ROOT, "scripts/test-db/stubs"),
  parentEnv: process.env,
  pid: process.pid,
  hostname: sanitizeHost(hostname()),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
  newToken: () => randomUUID(),
  isProcessAlive,
  discoverFiles,
  checkFile(file) {
    if (!existsSync(path.join(ROOT, file))) refuse(`test file not found: ${file}`);
    if (!readFileSync(path.join(ROOT, file), "utf8").includes("D2_TEST_DATABASE_URL")) refuse(`${file} is not a database test (it does not use D2_TEST_DATABASE_URL); it does not need this script.`);
  },
  async connectAdmin(admin) {
    const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 10_000 });
    client.on("error", (error) => console.error(`[test-db] administrative connection error: ${error.message}`));
    await client.connect();
    return client;
  },
  state: null, // created in main(): the private per-user ownership record (scripts/test-db/state-store.mjs)
  makeTmp() {
    const dir = mkdtempSync(path.join(tmpdir(), "comdis-test-db-"));
    const dotenvPath = path.join(dir, "empty.env");
    writeFileSync(dotenvPath, "");
    return { dir, dotenvPath, dispose: () => rmSync(dir, { recursive: true, force: true }) };
  },
  readTap: (file) => readFileSync(file, "utf8"),
  runChild,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

async function main() {
  const options = parseArgs(process.argv.slice(2), process.env);
  const { admin, throwaway } = parseAdminUrl(process.env[ADMIN_ENV]);
  const control = makeControl();
  deps.state = createStateStore({
    dir: defaultStateDir({ home: homedir() }),
    hostname: deps.hostname,
    pid: deps.pid,
    isProcessAlive: deps.isProcessAlive,
  });

  let forced = false;
  const onSignal = (signal) => {
    if (control.stopping) {
      if (forced) return;
      forced = true;
      console.error(`[test-db] ${signal} received again: exiting NOW without waiting. The throwaway database may still exist - run "npm run test:db:cleanup" (add "-- --owner-token=<token>" if it asks for it).`);
      process.exit(130);
    }
    console.error(`[test-db] ${signal} received: no further test will start; stopping the running test process tree, then cleaning up (send it again to exit immediately).`);
    control.requestStop(signal);
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"].filter((name) => name in osConstants.signals);
  for (const signal of signals) process.on(signal, () => onSignal(signal));

  if (options.mode === "cleanup") return runCleanup({ admin, ownerToken: options.ownerToken, deps });
  deps.productionFragment = readProductionFragment(ROOT);
  return runSuite({ admin, throwaway, files: options.files, timeoutMs: options.timeoutMs, checkOnly: options.mode === "check", deps, control });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof Refusal) {
      console.error(`[test-db] REFUSED: ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(`[test-db] ERROR: ${error?.message ?? error}`);
      process.exitCode = 1;
    }
  },
);
