// Logic of scripts/test-db.mjs, with every side effect injectable so that scripts/test-db/core.test.mjs can exercise
// it (refusals, cleanup errors, interruptions, timeouts, ownership) without any real database.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const DB_NAME = "commdis_d2_test";
export const ADMIN_ENV = "COMDIS_TEST_DB_ADMIN_URL";
export const TIMEOUT_ENV = "COMDIS_TEST_DB_TIMEOUT_MS";
export const DEFAULT_TIMEOUT_MS = 600_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 3_600_000;
export const MARKER_PREFIX = "comdis-throwaway-test-db/v3";
export const COMMENT_ATTEMPTS = 3;
export const ADVISORY_LOCK_KEYS = [727_001, 42];
export const KILL_GRACE_MS = 5_000;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ALLOWED_PARAMS = new Set(["schema", "sslmode", "connect_timeout"]);
const FORBIDDEN_MARKERS = [/neon/i, /vercel/i, /amazonaws/i, /supabase/i, /azure/i, /render\.com/i, /railway/i];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_FLAGS = ["--check", "--cleanup-stale", "--owner-token", "--timeout-ms"];

export const USAGE = [
  "usage:",
  "  npm run test:db [-- <test file>... ] [-- --timeout-ms=<ms>]   run the database tests on a throwaway database",
  "  npm run test:db:check                                         validate the configuration, create nothing",
  "  npm run test:db:cleanup [-- --owner-token=<token>]            drop a throwaway database left by an interrupted run",
].join("\n");

export class Refusal extends Error {}

export function refuse(message) {
  throw new Refusal(message);
}

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------

/** Strict parsing: any unknown flag, repeated flag or incompatible combination is refused (never a full run by mistake). */
export function parseArgs(argv, env = {}) {
  const seen = new Set();
  const files = [];
  let check = false;
  let cleanup = false;
  let ownerToken = null;
  let timeoutMs = null;
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      files.push(arg);
      continue;
    }
    const [name, ...rest] = arg.split("=");
    const value = rest.length ? rest.join("=") : null;
    if (!ALLOWED_FLAGS.includes(name)) refuse(`unknown argument "${arg}".\n${USAGE}`);
    if (seen.has(name)) refuse(`argument ${name} given more than once.\n${USAGE}`);
    seen.add(name);
    if (name === "--check" || name === "--cleanup-stale") {
      if (value !== null) refuse(`${name} takes no value.\n${USAGE}`);
      if (name === "--check") check = true;
      else cleanup = true;
    } else if (name === "--owner-token") {
      if (!value || !UUID.test(value)) refuse(`--owner-token needs the token printed by the run or found in the database comment (a UUID).\n${USAGE}`);
      ownerToken = value;
    } else {
      if (value === null || !/^\d+$/.test(value)) refuse(`--timeout-ms needs an integer number of milliseconds.\n${USAGE}`);
      timeoutMs = Number(value);
    }
  }
  if (check && cleanup) refuse(`--check and --cleanup-stale cannot be combined.\n${USAGE}`);
  if (ownerToken && !cleanup) refuse(`--owner-token is only valid with --cleanup-stale.\n${USAGE}`);
  if (cleanup && files.length) refuse(`--cleanup-stale takes no test file.\n${USAGE}`);
  if (cleanup && timeoutMs !== null) refuse(`--timeout-ms is only valid when running tests.\n${USAGE}`);
  if (timeoutMs === null && env[TIMEOUT_ENV] !== undefined && env[TIMEOUT_ENV] !== "") {
    if (!/^\d+$/.test(env[TIMEOUT_ENV])) refuse(`${TIMEOUT_ENV} must be an integer number of milliseconds.`);
    timeoutMs = Number(env[TIMEOUT_ENV]);
  }
  timeoutMs ??= DEFAULT_TIMEOUT_MS;
  if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) refuse(`the per-file timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms.`);
  return { mode: cleanup ? "cleanup" : check ? "check" : "run", files, ownerToken, timeoutMs };
}

// ---------------------------------------------------------------------------------------------------------------
// Administrative URL
// ---------------------------------------------------------------------------------------------------------------

/** Validates the administrative URL and returns { admin, throwaway } as URL objects. Throws Refusal. */
export function parseAdminUrl(raw) {
  if (!raw || !raw.trim()) {
    refuse(
      `${ADMIN_ENV} is not set. Set it to a LOCAL PostgreSQL URL (user able to CREATE DATABASE), for example ` +
        "postgresql://user:password@localhost:5432/postgres. The database tests never run without an explicit throwaway-database configuration.",
    );
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    refuse(`${ADMIN_ENV} is not a valid URL.`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") refuse(`${ADMIN_ENV} must be a postgresql:// URL.`);
  if (!LOOPBACK_HOSTS.has(url.hostname)) refuse(`${ADMIN_ENV} points to a non-local host (${url.hostname}). Only localhost, 127.0.0.1 and ::1 are allowed.`);
  if ((url.port || "5432") !== "5432") refuse(`${ADMIN_ENV} uses port ${url.port}; the database tests only accept the local default port 5432.`);
  if (FORBIDDEN_MARKERS.some((marker) => marker.test(raw))) refuse(`${ADMIN_ENV} contains a hosted-database marker (Neon, Vercel, cloud provider). Production or hosted databases are never allowed.`);
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) refuse(`${ADMIN_ENV} carries the connection parameter "${key}", which could redirect the connection; only ${[...ALLOWED_PARAMS].join(", ")} are allowed.`);
  }
  const adminDb = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!adminDb) refuse(`${ADMIN_ENV} must name an existing maintenance database (for example /postgres).`);
  if (adminDb === DB_NAME) refuse(`${ADMIN_ENV} must not point at ${DB_NAME} itself; use the maintenance database (for example /postgres).`);
  const throwaway = new URL(url.toString());
  throwaway.pathname = `/${DB_NAME}`;
  throwaway.search = "";
  throwaway.searchParams.set("schema", "public");
  return { admin: url, throwaway };
}

// ---------------------------------------------------------------------------------------------------------------
// Ownership marker (comment of the throwaway database) and state file
// ---------------------------------------------------------------------------------------------------------------

/** Host names are restricted to a safe alphabet so the marker is always parseable and never needs SQL escaping. */
export function sanitizeHost(host) {
  return String(host).replace(/[^A-Za-z0-9._-]/g, "_") || "unknown-host";
}

export function buildMarker({ token, oid, pid, host, started }) {
  return `${MARKER_PREFIX} token=${token} oid=${oid} pid=${pid} host=${sanitizeHost(host)} started=${started}`;
}

/** The marker of a database created by THIS script version, or null for anything else (older markers included). */
export function parseMarker(comment) {
  if (typeof comment !== "string") return null;
  const match = comment.match(/^comdis-throwaway-test-db\/v3 token=([0-9a-f-]{36}) oid=(\d+) pid=(\d+) host=([A-Za-z0-9._-]+) started=(\S+)$/);
  if (!match || !UUID.test(match[1])) return null;
  return { token: match[1], oid: match[2], pid: Number(match[3]), host: match[4], started: match[5] };
}

function ident(name) {
  if (name !== DB_NAME) refuse(`internal error: unexpected database name ${name}`);
  return `"${name}"`;
}

function sqlLiteral(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

/** { exists, oid, comment } of the throwaway database, read in ONE statement (the oid identifies this exact database). */
export async function readDatabaseState(client) {
  const found = await client.query("select d.oid::text as oid, shobj_description(d.oid, 'pg_database') as comment from pg_database d where d.datname = $1", [DB_NAME]);
  if (!found.rowCount) return { exists: false, oid: null, comment: null };
  return { exists: true, oid: String(found.rows[0].oid), comment: found.rows[0].comment ?? null };
}

async function dropAndVerify(client) {
  await client.query(`DROP DATABASE ${ident(DB_NAME)} WITH (FORCE)`);
  if ((await readDatabaseState(client)).exists) throw new Error(`${DB_NAME} still exists after DROP DATABASE`);
  return "dropped";
}

/**
 * Drops the throwaway database ONLY while (1) its comment carries a valid marker with exactly this token, (2) the oid
 * written in that marker is the database's own oid (a comment copied onto another database is detected) and (3) when
 * `expectedOid` is known, it is still that exact database. Everything is re-read right before the DROP. Returns "absent"
 * or "dropped"; throws Refusal in every other case. Never decides on the name alone.
 */
export async function dropOwnedDatabase(client, token, expectedOid = null) {
  const state = await readDatabaseState(client);
  if (!state.exists) return "absent";
  const marker = parseMarker(state.comment);
  if (!marker) refuse(`${DB_NAME} exists but carries no valid ownership marker from this script; it will NOT be dropped.`);
  if (marker.token !== token) refuse(`${DB_NAME} belongs to another run (token ${marker.token}); it will NOT be dropped.`);
  if (marker.oid !== state.oid) refuse(`${DB_NAME} carries this run's marker but is not the database the marker was written for (oid ${state.oid}, expected ${marker.oid}); it will NOT be dropped.`);
  if (expectedOid !== null && state.oid !== expectedOid) refuse(`${DB_NAME} is no longer the database this run created (oid ${state.oid}, created ${expectedOid}); it will NOT be dropped.`);
  return dropAndVerify(client);
}

/**
 * Recovery when `CREATE DATABASE` succeeded but the ownership marker could not be written. The only proof available is
 * the oid captured right after the CREATE, while holding the lock: the database is dropped ONLY if it is still that exact
 * database (same oid) and carries no foreign comment. Otherwise it is left alone and the manual procedure is explained.
 */
export async function recoverAfterMarkerFailure(client, { token, oid }) {
  const manual =
    `Manual recovery: connect to the local server and check that "select oid from pg_database where datname = '${DB_NAME}'" returns ${oid ?? "<the oid, which could not be recorded>"}; ` +
    `only then run: DROP DATABASE "${DB_NAME}";`;
  if (!oid) refuse(`${DB_NAME} was created by this run but its oid could not be recorded, so ownership cannot be proven. NOTHING was dropped. ${manual}`);
  const state = await readDatabaseState(client);
  if (!state.exists) return "absent";
  const marker = parseMarker(state.comment);
  if (marker) {
    // the COMMENT may have been applied although its answer was lost: this run's own marker is a full proof
    if (marker.token === token) return dropOwnedDatabase(client, token, oid);
    refuse(`${DB_NAME} now carries another run's marker (token ${marker.token}); NOTHING was dropped. ${manual}`);
  }
  if (state.oid !== oid) refuse(`${DB_NAME} is no longer the database this run created (oid ${state.oid}, created ${oid}); NOTHING was dropped. ${manual}`);
  if (state.comment !== null && state.comment !== "") refuse(`${DB_NAME} (oid ${oid}) carries a comment this run did not write; NOTHING was dropped. ${manual}`);
  return dropAndVerify(client);
}

// ---------------------------------------------------------------------------------------------------------------
// Server checks and the cluster-wide lock
// ---------------------------------------------------------------------------------------------------------------

export async function assertLocalPrimary(client) {
  const row = (
    await client.query(
      "select current_database() as db, coalesce(host(inet_server_addr()), 'unix-socket') as addr, pg_is_in_recovery() as replica, split_part(version(), ' ', 2) as pg",
    )
  ).rows[0];
  if (!(row.addr.startsWith("127.") || row.addr === "::1" || row.addr === "unix-socket")) refuse(`the server answered from ${row.addr}, which is not a loopback address.`);
  if (row.replica) refuse("the server is a replica (pg_is_in_recovery); refusing.");
  return row;
}

export async function acquireLock(client) {
  const got = (await client.query("select pg_try_advisory_lock($1, $2) as locked", ADVISORY_LOCK_KEYS)).rows[0].locked;
  if (!got) refuse('another "test:db" or "test:db:cleanup" is running against this server (advisory lock held); wait for it to finish.');
}

export async function releaseLock(client) {
  await client.query("select pg_advisory_unlock($1, $2)", ADVISORY_LOCK_KEYS);
}

// ---------------------------------------------------------------------------------------------------------------
// Environment given to the child processes
// ---------------------------------------------------------------------------------------------------------------

const ENV_ALLOWLIST = new Set(
  [
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "ALLUSERSPROFILE", "COMMONPROGRAMFILES", "USERNAME", "USER",
    "LOGNAME", "COMPUTERNAME", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "SHELL", "LANG", "TZ", "TERM",
  ].map((name) => name.toUpperCase()),
);

/** Explicit allow-list: system variables the tools need, plus the forced throwaway URLs. Nothing else is inherited. */
export function buildChildEnv(parentEnv, { throwawayUrl, stubsDir, dotenvPath }) {
  const env = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (ENV_ALLOWLIST.has(upper) || upper.startsWith("LC_")) env[key] = value;
  }
  env.DATABASE_URL = throwawayUrl;
  env.DIRECT_URL = throwawayUrl;
  env.D2_TEST_DATABASE_URL = throwawayUrl;
  env.NODE_PATH = stubsDir;
  env.DOTENV_CONFIG_PATH = dotenvPath; // an empty file: dotenv/config in the children never reads the repository's .env
  env.DOTENV_CONFIG_QUIET = "true";
  env.PRISMA_HIDE_UPDATE_MESSAGE = "1";
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  return env;
}

/** Last line of defence before any child starts: the children can only see the throwaway database. Throws Refusal. */
export function assertChildEnvSafe(env, { adminUrl, throwawayUrl, productionFragments = [] }) {
  const adminPassword = adminUrl ? decodeURIComponent(new URL(adminUrl).password) : "";
  for (const key of ["DATABASE_URL", "DIRECT_URL", "D2_TEST_DATABASE_URL"]) {
    if (env[key] !== throwawayUrl) refuse(`internal check: ${key} is not the throwaway URL.`);
  }
  for (const [key, value] of Object.entries(env)) {
    if (/^PG/i.test(key) || key === "NODE_OPTIONS") refuse(`internal check: ${key} must not reach the tests.`);
    // The throwaway URL legitimately carries the same role (and password) as the administrative URL; nothing else may.
    const rest = value.split(throwawayUrl).join("");
    if (adminUrl && rest.includes(adminUrl)) refuse(`internal check: the administrative URL is present in ${key}.`);
    if (adminPassword && adminPassword.length >= 4 && rest.includes(adminPassword)) refuse(`internal check: the administrative password is present in ${key}.`);
    if (/^postgres(ql)?:\/\//i.test(value) && value !== throwawayUrl) refuse(`internal check: ${key} carries a database URL other than the throwaway one.`);
    if (productionFragments.some((fragment) => fragment && value.includes(fragment))) refuse(`internal check: ${key} carries the known production endpoint.`);
    // The executable search path lists tool folders ("Azure Data Studio", a "vercel" CLI...): not a hosted database. Windows
    // names it `Path` (buildChildEnv keeps the parent's casing), so the comparison ignores the case - like the allow-list.
    if (key.toUpperCase() !== "PATH" && !/^(DATABASE_URL|DIRECT_URL|D2_TEST_DATABASE_URL)$/.test(key) && FORBIDDEN_MARKERS.some((marker) => marker.test(value))) {
      refuse(`internal check: ${key} carries a hosted-service marker.`);
    }
  }
}

/** The known production endpoint fragment, read from lib/production-endpoint.ts (single source of truth). Fails closed. */
export function readProductionFragment(root) {
  const text = readFileSync(path.join(root, "lib/production-endpoint.ts"), "utf8");
  const match = text.match(/KNOWN_PRODUCTION_ENDPOINT_SUBSTRING\s*=\s*"([^"]+)"/);
  if (!match) refuse("could not read KNOWN_PRODUCTION_ENDPOINT_SUBSTRING from lib/production-endpoint.ts; refusing to continue without the production guard.");
  return match[1];
}

// ---------------------------------------------------------------------------------------------------------------
// Child processes: timeout, tree termination, interruption
// ---------------------------------------------------------------------------------------------------------------

/** Kills a child AND everything it spawned (tsx starts the test runner, which starts one process per file). */
export function killTree(pid, { force }) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM"); // the child leads its own process group (detached)
  } catch {
    try {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Shared between the signal handlers and the run: what is running now, and whether a stop was requested. */
export function makeControl() {
  const control = {
    stopping: false,
    signal: null,
    current: null,
    requestStop(signal) {
      control.stopping = true;
      control.signal ??= signal;
      control.current?.terminate();
    },
  };
  return control;
}

/** Runs a child; resolves with { code, timedOut, interrupted, output }. The whole process tree is stopped on timeout or stop request. */
export function runChild(command, args, env, { cwd, timeoutMs, control, capture = false, graceMs = KILL_GRACE_MS }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    });
    let output = "";
    let timedOut = false;
    let interrupted = false;
    let settled = false;
    let forceTimer = null;
    const terminate = () => {
      killTree(child.pid, { force: process.platform === "win32" });
      forceTimer ??= setTimeout(() => killTree(child.pid, { force: true }), graceMs);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const handle = { terminate: () => { interrupted = true; terminate(); } };
    if (control) {
      control.current = handle;
      if (control.stopping) handle.terminate();
    }
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      if (control && control.current === handle) control.current = null;
      resolve({ code: code ?? 1, timedOut, interrupted, output });
    };
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => finish(code));
    child.on("error", (error) => {
      output += String(error);
      finish(1);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------------------------

export function parseTapTotals(tap) {
  const totals = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const match = tap.match(new RegExp(`^# ${key} (\\d+)`, "m"));
    totals[key] = match ? Number(match[1]) : null;
  }
  return totals;
}

/** Per-file verdict: a list of problems (empty = ok). A skipped, failed, cancelled, missing, timed-out or interrupted test is a problem. */
export function fileProblems(result, timeoutMs) {
  const problems = [];
  if (result.timedOut) problems.push(`TIMEOUT after ${Math.round(timeoutMs / 1000)} s (process tree killed)`);
  if (result.interrupted) problems.push("INTERRUPTED");
  if (result.code !== 0) problems.push("exit code " + result.code);
  if (result.tests === null) problems.push("no result summary");
  else {
    if (result.tests === 0) problems.push("no test executed");
    if (result.fail) problems.push(`${result.fail} failed`);
    if (result.cancelled) problems.push(`${result.cancelled} cancelled`);
    if (result.skipped) problems.push(`${result.skipped} SKIPPED (a database test must never be skipped here)`);
    if (result.pass !== result.tests - (result.skipped ?? 0) - (result.todo ?? 0)) problems.push("pass count does not match the test count");
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// The two commands. Every side effect comes through `deps`.
//   deps: { connectAdmin(), state: { read(), write(obj), update(obj), remove(token), problem }, runChild(cmd,args,env,opts),
//           now(), newToken(), pid, hostname, isProcessAlive(pid), sleep(ms), discoverFiles(), checkFile(file), root, stubsDir,
//           parentEnv, makeTmp(), productionFragment, readTap(file), log, error }
//   state.write refuses (Refusal) when the private record cannot be created exclusively or belongs to a live run.
// ---------------------------------------------------------------------------------------------------------------

const RECOVERY = 'run "npm run test:db:cleanup" (if it asks for it, add "-- --owner-token=<token>" with the token printed at the start of the run)';

async function withLockedAdmin(deps, admin, fn) {
  const client = await deps.connectAdmin(admin);
  let locked = false;
  try {
    const server = await assertLocalPrimary(client);
    await acquireLock(client);
    locked = true;
    return await fn(client, server);
  } finally {
    if (locked) await releaseLock(client).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

/**
 * `npm run test:db:cleanup`. Returns an exit code. The database is dropped ONLY when ALL of these hold:
 *  1. it carries a valid v3 marker, and the oid in that marker is the database's own oid;
 *  2. ownership is proven by the local state record (same token, same machine, same pid, consistent oid) - or, when
 *     the record is absent, invalid or contradictory, explicitly confirmed with --owner-token equal to the marker's token;
 *  3. the run that created it is not alive on this machine;
 *  4. dropOwnedDatabase re-reads the state and re-checks the token and the oid right before the DROP.
 */
export async function runCleanup({ admin, ownerToken, deps }) {
  const myHost = sanitizeHost(deps.hostname);
  return withLockedAdmin(deps, admin, async (client) => {
    const current = await readDatabaseState(client);
    if (!current.exists) {
      const stale = deps.state.read();
      if (stale && !(stale.host === myHost && stale.pid !== deps.pid && deps.isProcessAlive(stale.pid))) deps.state.remove(stale.token);
      deps.log(`[test-db] cleanup: ${DB_NAME} is already absent.`);
      return 0;
    }
    const marker = parseMarker(current.comment);
    if (!marker) refuse(`${DB_NAME} exists but carries no valid ownership marker from this script (it was not created by it, or by an older version); it will NOT be dropped. Drop it by hand only if you are certain it is yours.`);
    if (marker.oid !== current.oid) {
      refuse(`${DB_NAME} carries a marker written for another database (marker oid ${marker.oid}, database oid ${current.oid}): the comment was copied; it will NOT be dropped.`);
    }

    const record = deps.state.read();
    let stateVerdict;
    if (!record) stateVerdict = deps.state.problem ? `the local ownership record is unusable (${deps.state.problem})` : "this machine has no ownership record";
    else if (record.token !== marker.token) stateVerdict = `the local ownership record (token ${record.token}) contradicts the database marker (token ${marker.token})`;
    else if (record.host !== myHost || record.pid !== marker.pid) stateVerdict = "the local ownership record contradicts the marker (machine or pid differ)";
    else if (record.oid !== undefined && record.oid !== null && String(record.oid) !== current.oid) stateVerdict = `the local ownership record names another database oid (${record.oid}, database ${current.oid})`;
    else stateVerdict = null;
    const provenByState = stateVerdict === null;
    const confirmedByUser = ownerToken !== null && ownerToken === marker.token;
    if (!provenByState && !confirmedByUser) {
      refuse(
        `ownership of ${DB_NAME} cannot be proven automatically: created by pid ${marker.pid} on host ${marker.host} at ${marker.started} (token ${marker.token}), but ${stateVerdict}. ` +
          `Nothing was dropped. If you recognise this database as yours, re-run with "-- --owner-token=${marker.token}".`,
      );
    }
    if (marker.host === myHost && marker.pid !== deps.pid && deps.isProcessAlive(marker.pid)) {
      refuse(`the run that created ${DB_NAME} (pid ${marker.pid}) is still running; nothing was dropped.`);
    }
    const result = await dropOwnedDatabase(client, marker.token, current.oid);
    deps.state.remove(marker.token);
    deps.log(`[test-db] cleanup: ${DB_NAME} -> ${result} (ownership ${provenByState ? "proven by the local state record" : `confirmed with --owner-token (${stateVerdict})`}).`);
    return 0;
  });
}

/** The oid of the database this run has just created (read under the lock, right after CREATE); null if it cannot be read. */
async function captureCreatedOid(client, deps) {
  for (let attempt = 1; attempt <= COMMENT_ATTEMPTS; attempt += 1) {
    try {
      const state = await readDatabaseState(client);
      return state.exists ? state.oid : null;
    } catch {
      await deps.sleep(100 * attempt);
    }
  }
  return null;
}

/** Writes the ownership marker (at most COMMENT_ATTEMPTS tries). Returns { written, error }. */
async function writeOwnershipMarker(client, deps, marker) {
  let lastError = null;
  for (let attempt = 1; attempt <= COMMENT_ATTEMPTS; attempt += 1) {
    try {
      await client.query(`COMMENT ON DATABASE ${ident(DB_NAME)} IS ${sqlLiteral(buildMarker(marker))}`);
      return { written: true, error: null };
    } catch (error) {
      lastError = error;
      await deps.sleep(200 * attempt);
    }
  }
  // the statement may have been applied although its answer was lost: only this run's exact marker counts
  try {
    const state = await readDatabaseState(client);
    const found = parseMarker(state.comment);
    if (state.exists && found && found.token === marker.token && found.oid === marker.oid) return { written: true, error: null };
  } catch {
    /* keep the original error */
  }
  return { written: false, error: lastError };
}

/** `npm run test:db` and `npm run test:db:check`. Returns an exit code. */
export async function runSuite({ admin, throwaway, files: requestedFiles, timeoutMs, checkOnly, deps, control }) {
  const files = requestedFiles.length ? requestedFiles : deps.discoverFiles();
  if (!files.length) refuse("no database test file found (expected *.integration.test.ts files that use D2_TEST_DATABASE_URL).");
  for (const file of files) {
    if (!/\.test\.tsx?$/.test(file) || path.isAbsolute(file) || file.includes("..") || /^[a-zA-Z]:/.test(file)) refuse(`not an acceptable test file path: ${file}`);
    deps.checkFile(file);
  }

  return withLockedAdmin(deps, admin, async (client, server) => {
    const existing = await readDatabaseState(client);
    if (existing.exists) {
      const marker = parseMarker(existing.comment);
      refuse(
        marker
          ? `${DB_NAME} already exists, left by an earlier run (token ${marker.token}, pid ${marker.pid}, host ${marker.host}, started ${marker.started}): ${RECOVERY}.`
          : `${DB_NAME} already exists and was NOT created by this script; it will not be touched.`,
      );
    }
    deps.log(`[test-db] local PostgreSQL ${server.pg} confirmed (loopback ${server.addr}, primary). Throwaway database: ${DB_NAME}`);
    deps.log(`[test-db] test files (${files.length}):\n${files.map((file) => `  - ${file}`).join("\n")}`);
    if (checkOnly) {
      deps.log("[test-db] --check: configuration valid, nothing created.");
      return 0;
    }

    const token = deps.newToken();
    const started = deps.now().toISOString();
    const host = sanitizeHost(deps.hostname);
    deps.log(`[test-db] run token ${token} (pid ${deps.pid}). If this run is killed forcibly (kill -9, taskkill /F, power loss, crash) the throwaway database is NOT removed: ${RECOVERY}.`);
    // Before anything is created: an unusable record directory, or another live run, stops everything here.
    const record = { token, pid: deps.pid, host, started, database: DB_NAME };
    deps.state.write(record);

    let created = false;
    let oid = null;
    let markerWritten = false;
    let cleanupFailed = false;
    const results = [];
    let migrationFailed = false;
    try {
      try {
        await client.query(`CREATE DATABASE ${ident(DB_NAME)}`);
        created = true;
        oid = await captureCreatedOid(client, deps);
        if (oid === null) throw new Error(`${DB_NAME} was created but its oid could not be read, so no ownership marker can be written.`);
        const marker = await writeOwnershipMarker(client, deps, { token, oid, pid: deps.pid, host, started });
        if (!marker.written) throw new Error(`could not write the ownership marker on ${DB_NAME} after ${COMMENT_ATTEMPTS} attempts (${marker.error?.message ?? "unknown error"}).`);
        markerWritten = true;
        try {
          deps.state.update({ ...record, oid });
        } catch (error) {
          deps.error(`[test-db] warning: the ownership record could not be completed with the oid (${error.message}); the database marker carries it anyway.`);
        }
      } catch (error) {
        if (created) deps.error(`[test-db] ERROR after CREATE DATABASE: ${error.message}`);
        throw error;
      }

      const tmp = deps.makeTmp();
      const url = throwaway.toString();
      const env = buildChildEnv(deps.parentEnv, { throwawayUrl: url, stubsDir: deps.stubsDir, dotenvPath: tmp.dotenvPath });
      assertChildEnvSafe(env, { adminUrl: admin.toString(), throwawayUrl: url, productionFragments: [deps.productionFragment] });
      try {
        if (!control.stopping) {
          const migrate = await deps.runChild(process.execPath, [path.join(deps.root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], env, { cwd: deps.root, timeoutMs, control, capture: true });
          const lines = migrate.output.split(/\r?\n/).filter((line) => /migrations? found|successfully|applied|rror/i.test(line));
          deps.log(`[test-db] migrate deploy on ${DB_NAME}: ${lines.join(" | ") || "(no summary)"}`);
          if (migrate.code !== 0 || migrate.timedOut || migrate.interrupted) {
            migrationFailed = true;
            if (!migrate.interrupted) deps.error(`[test-db] MIGRATION ${migrate.timedOut ? "TIMED OUT" : "FAILED"}:\n` + migrate.output.replace(/postgres(ql)?:\/\/\S+/gi, "<url>"));
          }
        }
        for (const [index, file] of files.entries()) {
          if (control.stopping || migrationFailed) break; // after a stop request nothing new starts
          const tapFile = path.join(tmp.dir, `${index}.tap`);
          deps.log(`\n[test-db] ===== ${file} =====`);
          const run = await deps.runChild(
            process.execPath,
            [path.join(deps.root, "node_modules/tsx/dist/cli.mjs"), "--test", "--experimental-test-module-mocks", "--test-concurrency=1", "--test-reporter=spec", "--test-reporter-destination=stdout", "--test-reporter=tap", `--test-reporter-destination=${tapFile}`, file],
            env,
            { cwd: deps.root, timeoutMs, control },
          );
          let totals;
          try {
            totals = parseTapTotals(deps.readTap(tapFile));
          } catch {
            totals = { tests: null, pass: null, fail: null, cancelled: null, skipped: null, todo: null };
          }
          results.push({ file, code: run.code, timedOut: run.timedOut, interrupted: run.interrupted, ...totals });
        }
      } finally {
        tmp.dispose();
      }
    } finally {
      try {
        let outcome = "not created";
        if (created) {
          outcome = markerWritten
            ? await dropOwnedDatabase(client, token, oid)
            : `${await recoverAfterMarkerFailure(client, { token, oid })} (recovered: still the exact database created by this run, oid ${oid})`;
        }
        deps.log(`[test-db] cleanup: ${DB_NAME} -> ${outcome}`);
        deps.state.remove(token);
      } catch (error) {
        cleanupFailed = true;
        deps.error(
          `[test-db] WARNING - CLEANUP NOT GUARANTEED: ${error.message}\n[test-db] The throwaway database ${DB_NAME} may still exist. ` +
            (markerWritten ? `To recover: ${RECOVERY}.` : "It has no valid ownership marker, so test:db:cleanup will refuse it too: follow the manual recovery above."),
        );
      }
    }

    deps.log("\n[test-db] ===== SUMMARY =====");
    let ok = true;
    const sum = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0 };
    for (const result of results) {
      const problems = fileProblems(result, timeoutMs);
      if (problems.length) ok = false;
      for (const key of Object.keys(sum)) sum[key] += result[key] ?? 0;
      deps.log(`  ${problems.length ? "FAIL" : "ok  "}  ${result.file}  tests=${result.tests ?? "?"} pass=${result.pass ?? "?"} fail=${result.fail ?? "?"} skipped=${result.skipped ?? "?"}${problems.length ? "  <- " + problems.join("; ") : ""}`);
    }
    const notRun = files.length - results.length;
    if (notRun > 0) {
      ok = false;
      deps.log(`  NOT RUN  ${notRun} file(s) never started (${control.stopping ? `stop requested: ${control.signal}` : "migration failed"})`);
    }
    deps.log(`  TOTAL  files=${results.length}/${files.length} tests=${sum.tests} pass=${sum.pass} fail=${sum.fail} cancelled=${sum.cancelled} skipped=${sum.skipped}`);
    if (cleanupFailed) deps.log("  CLEANUP  FAILED (see the warning above)");
    const pass = ok && !cleanupFailed && !migrationFailed && !control.stopping;
    deps.log(pass ? "[test-db] RESULT: PASS" : `[test-db] RESULT: FAIL${control.stopping ? ` (interrupted by ${control.signal})` : ""}`);
    if (control.stopping) return 130;
    return pass ? 0 : 1;
  });
}
