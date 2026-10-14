// Non-destructive tests of scripts/test-db/core.mjs: a fake PostgreSQL client and fake processes record every statement,
// so no database is ever contacted, created or dropped. The only real processes are small `node` sleepers started and
// killed by the tests themselves.   Run: npm run test:db:script
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import {
  DB_NAME,
  Refusal,
  assertChildEnvSafe,
  buildChildEnv,
  buildMarker,
  dropOwnedDatabase,
  fileProblems,
  killTree,
  makeControl,
  parseAdminUrl,
  parseArgs,
  parseMarker,
  parseTapTotals,
  recoverAfterMarkerFailure,
  runChild,
  runCleanup,
  runSuite,
  sanitizeHost,
} from "./core.mjs";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HOST = "this-machine";
const OID = "16500";
const marker = (overrides = {}) => buildMarker({ token: TOKEN, oid: OID, pid: 4242, host: HOST, started: "2026-10-14T10:00:00.000Z", ...overrides });
const ADMIN = "postgresql://admin:s3cretpw@localhost:5432/postgres";

// ---------- fakes ----------
/**
 * Fake PostgreSQL. The database `commdis_d2_test` is modelled with an oid and a comment. Fault injection:
 *  commentFailures   how many COMMENT statements fail before one succeeds (Infinity = always)
 *  commentLostAnswer the COMMENT is applied but the answer is lost (error thrown)
 *  oidReadFailures   how many catalogue reads fail right after CREATE
 *  newOid            oid given to a database created by CREATE
 */
function fakeClient({ exists = false, comment = null, oid = OID, lockFree = true, failDrop = false, replica = false, addr = "::1", commentFailures = 0, commentLostAnswer = false, oidReadFailures = 0, newOid = OID } = {}) {
  const db = { exists, comment, oid };
  const statements = [];
  const faults = { commentFailures, oidReadFailures };
  return {
    db,
    statements,
    ended: false,
    async query(sql, params) {
      statements.push(sql.trim().split("\n")[0]);
      if (/shobj_description/.test(sql)) {
        if (faults.armOidReads && faults.oidReadFailures > 0) {
          faults.oidReadFailures -= 1;
          throw new Error("simulated catalogue read failure");
        }
        return db.exists ? { rowCount: 1, rows: [{ oid: db.oid, comment: db.comment }] } : { rowCount: 0, rows: [] };
      }
      if (/current_database\(\)/.test(sql)) return { rows: [{ db: "postgres", addr, replica, pg: "18.3" }] };
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: lockFree }] };
      if (/pg_advisory_unlock/.test(sql)) return { rows: [{}] };
      if (/^CREATE DATABASE/i.test(sql)) {
        db.exists = true;
        db.comment = null;
        db.oid = newOid;
        faults.armOidReads = true;
        return { rowCount: 0, rows: [] };
      }
      if (/^COMMENT ON DATABASE/i.test(sql)) {
        if (commentLostAnswer) {
          db.comment = sql.match(/IS '(.*)'$/)[1];
          throw new Error("connection lost after COMMENT");
        }
        if (faults.commentFailures > 0) {
          faults.commentFailures -= 1;
          throw new Error("simulated COMMENT failure");
        }
        db.comment = sql.match(/IS '(.*)'$/)[1];
        return { rowCount: 0, rows: [] };
      }
      if (/^DROP DATABASE/i.test(sql)) {
        if (failDrop) throw new Error("simulated DROP failure");
        db.exists = false;
        db.comment = null;
        return { rowCount: 0, rows: [] };
      }
      assert.fail(`unexpected SQL: ${sql} ${JSON.stringify(params)}`);
    },
    async end() {
      this.ended = true;
    },
  };
}
const drops = (client) => client.statements.filter((s) => /^DROP DATABASE/i.test(s));
const creates = (client) => client.statements.filter((s) => /^CREATE DATABASE/i.test(s));
const comments = (client) => client.statements.filter((s) => /^COMMENT ON DATABASE/i.test(s));

const TAP_OK = (n) => `# tests ${n}\n# suites 0\n# pass ${n}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;

/** Local ownership record, same contract as scripts/test-db/state-store.mjs (read, write, update, remove(token), problem). */
function fakeState(initial = null, problem = null) {
  const store = { record: initial, problem, writes: 0, updates: 0, refuseWrite: false };
  store.api = {
    get problem() {
      return store.problem;
    },
    read: () => store.record,
    write(record) {
      if (store.refuseWrite) throw new Refusal("another test:db run is in progress or starting (simulated)");
      store.writes += 1;
      store.record = record;
    },
    update(record) {
      if (!store.record || store.record.token !== record.token) throw new Refusal("not this run's record");
      store.updates += 1;
      store.record = record;
    },
    remove(token) {
      if (token !== undefined && store.record && store.record.token !== token) return false;
      const had = store.record !== null;
      store.record = null;
      return had;
    },
  };
  return store;
}

function makeDeps({ client, state = null, stateProblem = null, alive = () => false, runner, tap = () => TAP_OK(3), files = ["lib/a.integration.test.ts", "lib/b.integration.test.ts"] } = {}) {
  const logs = [];
  const errors = [];
  const store = fakeState(state, stateProblem);
  const disposed = [];
  const deps = {
    root: "/repo",
    stubsDir: "/repo/scripts/test-db/stubs",
    parentEnv: { PATH: "/bin", HOME: "/home/x", PGHOST: "evil.neon.tech", DATABASE_URL_UNPOOLED: "postgresql://u:p@x.neon.tech/db", NODE_OPTIONS: "--require evil", COMDIS_TEST_DB_ADMIN_URL: ADMIN },
    pid: 4242,
    hostname: HOST,
    now: () => new Date("2026-10-14T10:00:00.000Z"),
    newToken: () => TOKEN,
    isProcessAlive: alive,
    sleep: async () => undefined,
    discoverFiles: () => files,
    checkFile: () => undefined,
    connectAdmin: async () => client,
    state: store.api,
    makeTmp: () => ({ dir: "/tmp/x", dotenvPath: "/tmp/x/empty.env", dispose: () => disposed.push(true) }),
    productionFragment: "ep-test-fragment-0000",
    readTap: tap,
    runChild: runner ?? (async () => ({ code: 0, timedOut: false, interrupted: false, output: "All migrations have been successfully applied." })),
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
  };
  return { deps, logs, errors, store, disposed };
}
const suiteArgs = (deps, extra = {}) => ({ admin: new URL(ADMIN), throwaway: new URL("postgresql://admin:s3cretpw@localhost:5432/commdis_d2_test?schema=public"), files: [], timeoutMs: 5000, checkOnly: false, deps, control: makeControl(), ...extra });

// ---------- arguments ----------
test("arguments: unknown flags, duplicates, bad values and incompatible combinations are refused (never a full run by mistake)", () => {
  for (const bad of [["--chek"], ["--check", "--check"], ["--check", "--cleanup-stale"], ["--owner-token=abc", "--cleanup-stale"], ["--owner-token=" + TOKEN], ["--cleanup-stale", "lib/x.integration.test.ts"], ["--cleanup-stale=1"], ["--timeout-ms"], ["--timeout-ms=abc"], ["--timeout-ms=10"], ["--timeout-ms=99999999"], ["-x"], ["--cleanup-stale", "--timeout-ms=5000"]]) {
    assert.throws(() => parseArgs(bad), Refusal, JSON.stringify(bad));
  }
  assert.throws(() => parseArgs([], { COMDIS_TEST_DB_TIMEOUT_MS: "soon" }), Refusal);
  assert.throws(() => parseArgs([], { COMDIS_TEST_DB_TIMEOUT_MS: "5" }), Refusal);
});

test("arguments: valid forms, default and configurable timeout", () => {
  assert.deepEqual(parseArgs([]), { mode: "run", files: [], ownerToken: null, timeoutMs: 600_000 });
  assert.equal(parseArgs(["--check"]).mode, "check");
  assert.equal(parseArgs(["lib/a.integration.test.ts", "--timeout-ms=45000"]).timeoutMs, 45_000);
  assert.equal(parseArgs([], { COMDIS_TEST_DB_TIMEOUT_MS: "120000" }).timeoutMs, 120_000);
  assert.equal(parseArgs(["--timeout-ms=2000"], { COMDIS_TEST_DB_TIMEOUT_MS: "120000" }).timeoutMs, 2000, "the flag wins");
  const cleanup = parseArgs(["--cleanup-stale", `--owner-token=${TOKEN}`]);
  assert.equal(cleanup.mode, "cleanup");
  assert.equal(cleanup.ownerToken, TOKEN);
});

test("administrative URL: only a local, override-free URL is accepted", () => {
  for (const bad of ["", "   ", "mysql://u:p@localhost/x", "postgresql://u:p@db.neon.tech:5432/postgres", "postgresql://u:p@localhost,x.neon.tech/postgres", "postgresql://u:p@10.0.0.5/postgres", "postgresql://u:p@localhost:6543/postgres", "postgresql://u:p@localhost/postgres?host=x", "postgresql://u:p@localhost/postgres?hostaddr=1.2.3.4", "postgresql://u:p@localhost/commdis_d2_test", "postgresql://u:p@localhost/", "postgresql://u:p@localhost/postgres?options=-c%20x"]) {
    assert.throws(() => parseAdminUrl(bad), Refusal, bad);
  }
  const { throwaway } = parseAdminUrl(ADMIN);
  assert.equal(throwaway.pathname, `/${DB_NAME}`);
  assert.equal(throwaway.search, "?schema=public");
});

// ---------- ownership marker ----------
test("marker: round trip (token, oid, pid, host, time); older markers, other prefixes and malformed fields are not ownership", () => {
  assert.deepEqual(parseMarker(marker()), { token: TOKEN, oid: OID, pid: 4242, host: HOST, started: "2026-10-14T10:00:00.000Z" });
  const v2 = `comdis-throwaway-test-db/v2 token=${TOKEN} pid=4242 host=${HOST} started=2026-10-14T10:00:00.000Z`;
  for (const bad of [null, undefined, "", "comdis-throwaway-test-db: created by scripts/test-db.mjs, safe to drop", v2, "something else", marker().replace(TOKEN, "not-a-uuid"), marker().replace(`oid=${OID}`, "oid=abc"), marker().replace(`oid=${OID} `, ""), marker() + " extra"]) {
    assert.equal(parseMarker(bad), null, String(bad));
  }
});

test("marker: the host name is reduced to a safe alphabet so the comment is always parseable and needs no SQL escaping", () => {
  assert.equal(sanitizeHost("my host's name"), "my_host_s_name");
  assert.equal(sanitizeHost(""), "unknown-host");
  const built = buildMarker({ token: TOKEN, oid: OID, pid: 1, host: "evil'; DROP DATABASE x; --", started: "2026-10-14T10:00:00.000Z" });
  assert.ok(!built.includes("'"));
  assert.equal(parseMarker(built).token, TOKEN);
});

// ---------- dropping a database that is not owned ----------
test("dropOwnedDatabase: never drops a database that is unmarked, foreign, mismatched or malformed", async () => {
  for (const comment of [null, "", "some other tool", "comdis-throwaway-test-db: created by scripts/test-db.mjs, safe to drop", marker({ token: OTHER })]) {
    const client = fakeClient({ exists: true, comment });
    await assert.rejects(() => dropOwnedDatabase(client, TOKEN), Refusal, String(comment));
    assert.equal(drops(client).length, 0, `no DROP for comment ${JSON.stringify(comment)}`);
  }
  const absent = fakeClient({ exists: false });
  assert.equal(await dropOwnedDatabase(absent, TOKEN), "absent");
  assert.equal(drops(absent).length, 0);
});

test("dropOwnedDatabase: a marker copied onto ANOTHER database (its oid is not the database's) is not accepted", async () => {
  const client = fakeClient({ exists: true, oid: "99999", comment: marker({ oid: OID }) });
  await assert.rejects(() => dropOwnedDatabase(client, TOKEN), (error) => error instanceof Refusal && /not the database the marker was written for/.test(error.message));
  assert.equal(drops(client).length, 0);
});

test("dropOwnedDatabase: when the oid created by this run is known, a database REPLACED under the same name (new oid, even with a copied marker) is not dropped", async () => {
  const client = fakeClient({ exists: true, oid: "77777", comment: marker({ oid: "77777" }) });
  await assert.rejects(() => dropOwnedDatabase(client, TOKEN, OID), (error) => error instanceof Refusal && /no longer the database this run created/.test(error.message));
  assert.equal(drops(client).length, 0);
});

test("dropOwnedDatabase: drops exactly the throwaway database, once, when token, marker oid and created oid all agree", async () => {
  const client = fakeClient({ exists: true, comment: marker() });
  assert.equal(await dropOwnedDatabase(client, TOKEN, OID), "dropped");
  assert.equal(drops(client).length, 1);
  assert.equal(drops(client)[0], `DROP DATABASE "${DB_NAME}" WITH (FORCE)`);
});

// ---------- recovery when the marker could not be written ----------
test("recovery: drops ONLY the exact database created by this run (same oid) that still carries no comment", async () => {
  const client = fakeClient({ exists: true, comment: null });
  assert.equal(await recoverAfterMarkerFailure(client, { token: TOKEN, oid: OID }), "dropped");
  assert.equal(drops(client).length, 1);
});

test("recovery: refuses, with the manual procedure, when the oid is unknown, replaced, or the database carries a foreign comment or another run's marker", async () => {
  const cases = [
    [{ exists: true, comment: null }, { token: TOKEN, oid: null }, /oid could not be recorded/],
    [{ exists: true, comment: null, oid: "77777" }, { token: TOKEN, oid: OID }, /no longer the database this run created/],
    [{ exists: true, comment: "created by someone else" }, { token: TOKEN, oid: OID }, /comment this run did not write/],
    [{ exists: true, comment: marker({ token: OTHER }) }, { token: TOKEN, oid: OID }, /another run's marker/],
  ];
  for (const [clientOptions, args, expected] of cases) {
    const client = fakeClient(clientOptions);
    await assert.rejects(() => recoverAfterMarkerFailure(client, args), (error) => error instanceof Refusal && expected.test(error.message) && /Manual recovery/.test(error.message) && /DROP DATABASE/.test(error.message));
    assert.equal(drops(client).length, 0);
  }
});

test("recovery: this run's own marker (the COMMENT was applied but its answer lost) is a full proof and goes through the normal checks", async () => {
  const client = fakeClient({ exists: true, comment: marker() });
  assert.equal(await recoverAfterMarkerFailure(client, { token: TOKEN, oid: OID }), "dropped");
  assert.equal(drops(client).length, 1);
  const replaced = fakeClient({ exists: true, oid: "77777", comment: marker({ oid: "77777" }) });
  await assert.rejects(() => recoverAfterMarkerFailure(replaced, { token: TOKEN, oid: OID }), Refusal);
  assert.equal(drops(replaced).length, 0);
});

// ---------- cleanup command ----------
const cleanupDeps = (client, over = {}) => makeDeps({ client, ...over });
const record = (overrides = {}) => ({ token: TOKEN, host: HOST, pid: 4242, oid: OID, ...overrides });

test("cleanup: refuses when ownership cannot be proven (no state record, no token) and explains how to confirm", async () => {
  const client = fakeClient({ exists: true, comment: marker() });
  const { deps } = cleanupDeps(client);
  await assert.rejects(() => runCleanup({ admin: new URL(ADMIN), ownerToken: null, deps }), (error) => error instanceof Refusal && /cannot be proven automatically/.test(error.message) && /no ownership record/.test(error.message) && error.message.includes(`--owner-token=${TOKEN}`));
  assert.equal(drops(client).length, 0);
  assert.equal(client.ended, true, "the connection is released");
  assert.ok(client.statements.some((s) => /pg_advisory_unlock/.test(s)), "the lock is released");
});

test("cleanup: an INVALID local record (reason reported by the store) is no proof, and the reason is shown", async () => {
  const client = fakeClient({ exists: true, comment: marker() });
  const { deps } = cleanupDeps(client, { state: null, stateProblem: "the ownership record is ignored: not a regular file" });
  await assert.rejects(() => runCleanup({ admin: new URL(ADMIN), ownerToken: null, deps }), (error) => error instanceof Refusal && /unusable \(the ownership record is ignored: not a regular file\)/.test(error.message));
  assert.equal(drops(client).length, 0);
});

test("cleanup: a CONTRADICTORY local record (other token, other machine, other pid, other oid) is no proof and nothing is dropped", async () => {
  for (const state of [record({ token: OTHER }), record({ host: "another-machine" }), record({ pid: 999 }), record({ oid: "99999" })]) {
    const client = fakeClient({ exists: true, comment: marker() });
    const { deps } = cleanupDeps(client, { state });
    await assert.rejects(() => runCleanup({ admin: new URL(ADMIN), ownerToken: null, deps }), (error) => error instanceof Refusal && /contradicts|names another database oid/.test(error.message), JSON.stringify(state));
    assert.equal(drops(client).length, 0);
  }
});

test("cleanup: a wrong --owner-token never authorises the drop", async () => {
  const client = fakeClient({ exists: true, comment: marker() });
  const { deps } = cleanupDeps(client, { state: null });
  await assert.rejects(() => runCleanup({ admin: new URL(ADMIN), ownerToken: OTHER, deps }), Refusal);
  assert.equal(drops(client).length, 0);
});

test("cleanup: a database without a valid marker is refused even with a token and a matching record", async () => {
  for (const comment of [null, "comdis-throwaway-test-db: created by scripts/test-db.mjs, safe to drop"]) {
    const client = fakeClient({ exists: true, comment });
    const { deps } = cleanupDeps(client, { state: record() });
    await assert.rejects(() => runCleanup({ admin: new URL(ADMIN), ownerToken: TOKEN, deps }), /no valid ownership marker/);
    assert.equal(drops(client).length, 0);
  }
});

test("cleanup: a marker whose oid is not the database's own (comment copied from another database) is refused even with record and token", async () => {
  const client = fakeClient({ exists: true, oid: "99999", comment: marker({ oid: OID }) });
  const { deps } = cleanupDeps(client, { state: record() });
  await assert.rejects(() => runCleanup({ admin: new URL(ADMIN), ownerToken: TOKEN, deps }), /comment was copied/);
  assert.equal(drops(client).length, 0);
});

test("cleanup: refuses while the owning process is still alive", async () => {
  const client = fakeClient({ exists: true, comment: marker({ pid: 777 }) });
  const { deps } = cleanupDeps(client, { state: record({ pid: 777 }), alive: (pid) => pid === 777 });
  await assert.rejects(() => runCleanup({ admin: new URL(ADMIN), ownerToken: null, deps }), /still running/);
  assert.equal(drops(client).length, 0);
});

test("cleanup: refuses to run concurrently with another test:db / cleanup (advisory lock)", async () => {
  const client = fakeClient({ exists: true, comment: marker(), lockFree: false });
  const { deps } = cleanupDeps(client, { state: record() });
  await assert.rejects(() => runCleanup({ admin: new URL(ADMIN), ownerToken: null, deps }), /another .*running/);
  assert.equal(drops(client).length, 0);
  assert.ok(!client.statements.some((s) => /pg_advisory_unlock/.test(s)), "a lock that was never obtained is not released");
});

test("cleanup: drops when the local record proves ownership (also a record written before the oid was known), or when the user confirms the exact token; removes the record", async () => {
  for (const [state, ownerToken] of [[record(), null], [record({ oid: undefined }), null], [null, TOKEN], [record({ token: OTHER }), TOKEN]]) {
    const client = fakeClient({ exists: true, comment: marker() });
    const { deps, store } = cleanupDeps(client, { state });
    assert.equal(await runCleanup({ admin: new URL(ADMIN), ownerToken, deps }), 0);
    assert.equal(drops(client).length, 1);
    if (state && state.token === TOKEN) assert.equal(store.record, null);
  }
});

test("cleanup: an already absent database is not an error and a stale record is removed, but a live run's record is kept", async () => {
  const client = fakeClient({ exists: false });
  const stale = cleanupDeps(client, { state: record() });
  assert.equal(await runCleanup({ admin: new URL(ADMIN), ownerToken: null, deps: stale.deps }), 0);
  assert.equal(stale.store.record, null);
  const live = cleanupDeps(fakeClient({ exists: false }), { state: record({ pid: 777 }), alive: (pid) => pid === 777 });
  assert.equal(await runCleanup({ admin: new URL(ADMIN), ownerToken: null, deps: live.deps }), 0);
  assert.ok(live.store.record, "the record of a live run is not touched");
});

// ---------- run: refusals ----------
test("run: a pre-existing database that this script did not create is refused, never created over, never dropped", async () => {
  for (const comment of [null, "owned by someone else", "comdis-throwaway-test-db: created by scripts/test-db.mjs, safe to drop"]) {
    const client = fakeClient({ exists: true, comment });
    const { deps } = makeDeps({ client });
    await assert.rejects(() => runSuite(suiteArgs(deps)), (error) => error instanceof Refusal && /NOT created by this script/.test(error.message));
    assert.equal(drops(client).length, 0);
    assert.equal(creates(client).length, 0);
  }
});

test("run: a database left by an earlier run is refused with the recovery command (not auto-dropped)", async () => {
  const client = fakeClient({ exists: true, comment: marker({ token: OTHER }) });
  const { deps } = makeDeps({ client });
  await assert.rejects(() => runSuite(suiteArgs(deps)), (error) => error instanceof Refusal && /test:db:cleanup/.test(error.message) && error.message.includes(OTHER));
  assert.equal(drops(client).length, 0);
});

test("run: refuses when another run holds the lock, or when the server is not a loopback primary", async () => {
  const locked = fakeClient({ lockFree: false });
  await assert.rejects(() => runSuite(suiteArgs(makeDeps({ client: locked }).deps)), /another .*running/);
  assert.equal(creates(locked).length, 0);
  for (const options of [{ addr: "10.1.2.3" }, { replica: true }]) {
    const client = fakeClient(options);
    await assert.rejects(() => runSuite(suiteArgs(makeDeps({ client }).deps)), Refusal);
    assert.equal(creates(client).length, 0);
  }
});

test("run: --check validates and creates nothing", async () => {
  const client = fakeClient();
  const { deps } = makeDeps({ client });
  assert.equal(await runSuite(suiteArgs(deps, { checkOnly: true })), 0);
  assert.equal(creates(client).length, 0);
  assert.equal(drops(client).length, 0);
});

test("run: an unacceptable file path is refused before any connection", async () => {
  const client = fakeClient();
  const { deps } = makeDeps({ client });
  for (const file of ["../x.test.ts", "/etc/x.test.ts", "C:/x.test.ts", "lib/x.ts"]) {
    await assert.rejects(() => runSuite(suiteArgs(deps, { files: [file] })), Refusal, file);
  }
  assert.equal(client.statements.length, 0);
});

// ---------- run: outcomes ----------
test("run: all tests pass -> exit 0, the database owned by this run is dropped and the record removed", async () => {
  const client = fakeClient();
  const { deps, store, disposed } = makeDeps({ client });
  assert.equal(await runSuite(suiteArgs(deps)), 0);
  assert.equal(creates(client).length, 1);
  assert.equal(drops(client).length, 1);
  assert.equal(client.db.exists, false);
  assert.equal(store.record, null);
  assert.equal(disposed.length, 1, "temporary files removed");
  assert.equal(client.ended, true);
});

test("run: the children get the throwaway URL and an allow-listed environment only; the administrative URL and other database variables never reach them", async () => {
  const client = fakeClient();
  const seen = [];
  const { deps } = makeDeps({ client, runner: async (cmd, args, env) => (seen.push(env), { code: 0, timedOut: false, interrupted: false, output: "" }) });
  await runSuite(suiteArgs(deps));
  assert.ok(seen.length >= 3, "migration + two files");
  for (const env of seen) {
    assert.equal(env.DATABASE_URL, env.DIRECT_URL);
    assert.equal(env.DATABASE_URL, env.D2_TEST_DATABASE_URL);
    assert.match(env.DATABASE_URL, /\/commdis_d2_test\?schema=public$/);
    for (const forbidden of ["PGHOST", "DATABASE_URL_UNPOOLED", "NODE_OPTIONS", "COMDIS_TEST_DB_ADMIN_URL"]) assert.ok(!(forbidden in env), forbidden);
    assert.ok(!Object.values(env).some((v) => v.includes("s3cretpw") && v !== env.DATABASE_URL), "the administrative password only appears inside the throwaway URL itself");
    assert.equal(env.DOTENV_CONFIG_PATH, "/tmp/x/empty.env");
  }
});

test("run: a failed migration -> exit 1, no test started, explicit message, database still cleaned up", async () => {
  const client = fakeClient();
  let testsStarted = 0;
  const { deps, errors, logs } = makeDeps({
    client,
    runner: async (cmd, args) => (args.includes("migrate") ? { code: 1, timedOut: false, interrupted: false, output: "Error: P3009 at postgresql://u:p@localhost/x" } : (testsStarted++, { code: 0, timedOut: false, interrupted: false, output: "" })),
  });
  assert.equal(await runSuite(suiteArgs(deps)), 1);
  assert.equal(testsStarted, 0);
  assert.ok(errors.some((e) => /MIGRATION FAILED/.test(e) && !/postgresql:\/\/u:p/.test(e)), "URL masked");
  assert.ok(logs.includes("[test-db] RESULT: FAIL"));
  assert.equal(drops(client).length, 1);
});

test("run: a failing test, a skipped test and a missing summary each make the run FAIL (exit 1) while the remaining files still run", async () => {
  for (const [code, tap, expected] of [[1, `# tests 3\n# pass 2\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n`, "1 failed"], [0, `# tests 3\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n`, "SKIPPED"], [0, null, "no result summary"]]) {
    const client = fakeClient();
    let index = 0;
    const { deps, logs } = makeDeps({
      client,
      runner: async (cmd, args) => (args.includes("migrate") ? { code: 0, timedOut: false, interrupted: false, output: "" } : (index++, { code, timedOut: false, interrupted: false, output: "" })),
      tap: () => {
        if (tap === null) throw new Error("no file");
        return tap;
      },
    });
    assert.equal(await runSuite(suiteArgs(deps)), 1, expected);
    assert.equal(index, 2, "both files were attempted");
    assert.ok(logs.some((l) => l.includes(expected)), expected);
    assert.ok(logs.includes("[test-db] RESULT: FAIL"));
  }
});

test("run: a timeout is a failure (exit 1) reported as TIMEOUT", async () => {
  const client = fakeClient();
  const { deps, logs } = makeDeps({ client, runner: async (cmd, args) => (args.includes("migrate") ? { code: 0, timedOut: false, interrupted: false, output: "" } : { code: 1, timedOut: true, interrupted: false, output: "" }) });
  assert.equal(await runSuite(suiteArgs(deps, { timeoutMs: 3000 })), 1);
  assert.ok(logs.some((l) => /TIMEOUT after 3 s/.test(l)));
  assert.equal(drops(client).length, 1);
});

test("run: when the cleanup fails the result is FAIL with a non-zero exit even though every test passed, and the recovery command is printed", async () => {
  const client = fakeClient({ failDrop: true });
  const { deps, errors, logs, store } = makeDeps({ client });
  assert.equal(await runSuite(suiteArgs(deps)), 1);
  assert.ok(logs.includes("[test-db] RESULT: FAIL"));
  assert.ok(!logs.includes("[test-db] RESULT: PASS"));
  assert.ok(errors.some((e) => /CLEANUP NOT GUARANTEED/.test(e) && /npm run test:db:cleanup/.test(e)));
  assert.ok(store.record && store.record.token === TOKEN, "the state record is kept so that the cleanup can prove ownership");
});

test("run: the oid of the created database is captured, written in the marker and in the local record, and checked by the final DROP", async () => {
  const client = fakeClient({ newOid: "16777" });
  let seenInRecord = null;
  const { deps, store } = makeDeps({
    client,
    runner: async (cmd, args) => {
      if (args.includes("migrate")) seenInRecord = store.record;
      return { code: 0, timedOut: false, interrupted: false, output: "" };
    },
  });
  assert.equal(await runSuite(suiteArgs(deps)), 0);
  assert.equal(comments(client).length, 1);
  assert.match(comments(client)[0], new RegExp(`token=${TOKEN} oid=16777 pid=4242 host=${HOST}`));
  assert.equal(seenInRecord.token, TOKEN);
  assert.equal(seenInRecord.oid, "16777", "the record was completed with the oid before any test started");
  assert.equal(store.writes, 1);
  assert.equal(store.updates, 1);
  assert.equal(drops(client).length, 1);
  assert.equal(store.record, null);
});

test("run: the ownership comment is retried (3 attempts at most) before giving up", async () => {
  const client = fakeClient({ commentFailures: 2 });
  const { deps } = makeDeps({ client });
  assert.equal(await runSuite(suiteArgs(deps)), 0);
  assert.equal(comments(client).length, 3, "two failures, then success");
  assert.equal(drops(client).length, 1);
});

test("run: a COMMENT that was applied although its answer was lost is recognised by its exact marker (token + oid) and the run continues normally", async () => {
  const client = fakeClient({ commentLostAnswer: true });
  const { deps } = makeDeps({ client });
  assert.equal(await runSuite(suiteArgs(deps)), 0);
  assert.equal(comments(client).length, 3);
  assert.equal(drops(client).length, 1);
});

test("run: COMMENT fails 3 times -> automatic recovery drops ONLY the exact database created by this run (same oid), the run fails explicitly", async () => {
  const client = fakeClient({ commentFailures: Infinity });
  const { deps, errors, logs, store } = makeDeps({ client });
  await assert.rejects(() => runSuite(suiteArgs(deps)), /could not write the ownership marker on commdis_d2_test after 3 attempts/);
  assert.equal(comments(client).length, 3);
  assert.equal(drops(client).length, 1, "the recovery proved the oid and dropped it");
  assert.equal(client.db.exists, false);
  assert.ok(errors.some((e) => /ERROR after CREATE DATABASE/.test(e)));
  assert.ok(!errors.some((e) => /CLEANUP NOT GUARANTEED/.test(e)));
  assert.ok(logs.some((l) => /recovered: still the exact database created by this run, oid 16500/.test(l)));
  assert.equal(store.record, null);
});

test("run: COMMENT fails and the database was REPLACED under the same name meanwhile -> nothing is dropped, manual recovery is explained", async () => {
  const client = fakeClient({ commentFailures: Infinity });
  const { deps, errors, store } = makeDeps({ client });
  deps.sleep = async () => {
    client.db.oid = "77777"; // someone dropped our database and created another one with the same name
  };
  await assert.rejects(() => runSuite(suiteArgs(deps)), /could not write the ownership marker/);
  assert.equal(drops(client).length, 0);
  assert.ok(client.db.exists, "the foreign database is untouched");
  assert.ok(errors.some((e) => /CLEANUP NOT GUARANTEED/.test(e) && /no longer the database this run created/.test(e) && /Manual recovery/.test(e) && /follow the manual recovery above/.test(e)));
  assert.ok(store.record, "the record is kept");
});

test("run: COMMENT fails and a foreign comment appears on the database -> nothing is dropped", async () => {
  const client = fakeClient({ commentFailures: Infinity });
  const { deps, errors } = makeDeps({ client });
  deps.sleep = async () => {
    client.db.comment = "somebody else's database";
  };
  await assert.rejects(() => runSuite(suiteArgs(deps)), /could not write the ownership marker/);
  assert.equal(drops(client).length, 0);
  assert.ok(errors.some((e) => /comment this run did not write/.test(e) && /Manual recovery/.test(e)));
});

test("run: the oid of the new database cannot be read -> no marker is written, nothing is dropped, the manual procedure is explained", async () => {
  const client = fakeClient({ oidReadFailures: Infinity });
  const { deps, errors } = makeDeps({ client });
  await assert.rejects(() => runSuite(suiteArgs(deps)), /oid could not be read/);
  assert.equal(comments(client).length, 0);
  assert.equal(drops(client).length, 0);
  assert.ok(errors.some((e) => /CLEANUP NOT GUARANTEED/.test(e) && /oid could not be recorded/.test(e) && /Manual recovery/.test(e)));
});

test("run: the final DROP is refused when the database was replaced during the run, even though the name and a copied marker match", async () => {
  const client = fakeClient();
  const { deps, errors, logs } = makeDeps({
    client,
    runner: async (cmd, args) => {
      if (!args.includes("migrate")) {
        client.db.oid = "77777";
        client.db.comment = marker({ oid: "77777" }); // same token, copied marker, other database
      }
      return { code: 0, timedOut: false, interrupted: false, output: "" };
    },
  });
  assert.equal(await runSuite(suiteArgs(deps)), 1);
  assert.equal(drops(client).length, 0);
  assert.ok(errors.some((e) => /CLEANUP NOT GUARANTEED/.test(e) && /no longer the database this run created/.test(e)));
  assert.ok(logs.includes("[test-db] RESULT: FAIL"));
});

test("run: an unusable ownership record directory, or another live run, stops everything BEFORE any CREATE DATABASE", async () => {
  const client = fakeClient();
  const { deps, store } = makeDeps({ client });
  store.refuseWrite = true;
  await assert.rejects(() => runSuite(suiteArgs(deps)), Refusal);
  assert.equal(creates(client).length, 0);
  assert.equal(drops(client).length, 0);
  assert.ok(client.ended);
});

test("interruption: after a stop request no new test starts, the running process is awaited, the database is cleaned and the exit code is 130", async () => {
  const client = fakeClient();
  const control = makeControl();
  const started = [];
  const { deps, logs } = makeDeps({
    client,
    files: ["lib/a.integration.test.ts", "lib/b.integration.test.ts", "lib/c.integration.test.ts"],
    runner: async (cmd, args) => {
      if (args.includes("migrate")) return { code: 0, timedOut: false, interrupted: false, output: "" };
      started.push(args.at(-1));
      if (started.length === 1) {
        control.requestStop("SIGINT"); // the user presses Ctrl-C while file 1 runs; the child is terminated and awaited
        return { code: 1, timedOut: false, interrupted: true, output: "" };
      }
      return { code: 0, timedOut: false, interrupted: false, output: "" };
    },
  });
  assert.equal(await runSuite(suiteArgs(deps, { control })), 130);
  assert.deepEqual(started, ["lib/a.integration.test.ts"], "no further test file was started");
  assert.equal(drops(client).length, 1, "the database owned by this run is dropped");
  assert.ok(logs.some((l) => /NOT RUN\s+2 file/.test(l)));
  assert.ok(logs.some((l) => /RESULT: FAIL \(interrupted by SIGINT\)/.test(l)));
});

test("interruption before anything started: nothing is created when the stop precedes the migration", async () => {
  const client = fakeClient();
  const control = makeControl();
  const { deps } = makeDeps({ client, runner: async (cmd, args) => { assert.ok(!args.some((a) => /integration/.test(a)), "no test starts"); return { code: 0, timedOut: false, interrupted: false, output: "" }; } });
  control.requestStop("SIGTERM");
  assert.equal(await runSuite(suiteArgs(deps, { control })), 130);
  assert.equal(drops(client).length, 1);
});

// ---------- environment ----------
test("child environment: PG*, NODE_OPTIONS, other database URLs and the admin URL are rejected by the final check", () => {
  const url = "postgresql://admin:s3cretpw@localhost:5432/commdis_d2_test?schema=public";
  const good = buildChildEnv({ PATH: "/bin" }, { throwawayUrl: url, stubsDir: "/s", dotenvPath: "/e" });
  assert.doesNotThrow(() => assertChildEnvSafe(good, { adminUrl: ADMIN, throwawayUrl: url, productionFragments: ["ep-test-fragment-0000"] }));
  for (const poisoned of [{ PGHOST: "x" }, { NODE_OPTIONS: "--x" }, { OTHER: "postgresql://u:p@elsewhere/db" }, { LEAK: ADMIN }, { LEAK: "pw=s3cretpw" }, { X: "ep-test-fragment-0000.neon.tech" }, { DATABASE_URL: "postgresql://u:p@elsewhere/db" }]) {
    assert.throws(() => assertChildEnvSafe({ ...good, ...poisoned }, { adminUrl: ADMIN, throwawayUrl: url, productionFragments: ["ep-test-fragment-0000"] }), Refusal, JSON.stringify(poisoned));
  }
});

test("child environment: only the allow-list is inherited (Windows-style casing too); database variables are forced", () => {
  const url = "postgresql://u:p@localhost:5432/commdis_d2_test?schema=public";
  const env = buildChildEnv({ Path: "C:\\bin", SystemRoot: "C:\\Windows", LC_ALL: "C", PGPASSWORD: "x", GEMINI_API_KEY: "k", DATABASE_URL: "prod", DIRECT_URL: "prod", APP_ENV: "production", NODE_OPTIONS: "--x", npm_config_x: "1" }, { throwawayUrl: url, stubsDir: "/s", dotenvPath: "/e" });
  assert.equal(env.Path, "C:\\bin");
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.LC_ALL, "C");
  for (const dropped of ["PGPASSWORD", "GEMINI_API_KEY", "APP_ENV", "NODE_OPTIONS", "npm_config_x"]) assert.ok(!(dropped in env), dropped);
  assert.equal(env.DATABASE_URL, url);
  assert.equal(env.DIRECT_URL, url);
});

// ---------- results ----------
test("results: TAP totals and per-file problems", () => {
  assert.deepEqual(parseTapTotals(TAP_OK(4)), { tests: 4, pass: 4, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual(fileProblems({ code: 0, timedOut: false, interrupted: false, ...parseTapTotals(TAP_OK(2)) }, 1000), []);
  assert.ok(fileProblems({ code: 0, timedOut: false, interrupted: false, tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, 1000).includes("no test executed"));
  assert.ok(fileProblems({ code: 1, timedOut: true, interrupted: false, tests: null }, 2000).some((p) => /TIMEOUT after 2 s/.test(p)));
});

// ---------- real (harmless) processes: timeout, tree kill, stop request ----------
const SLEEPER = ["-e", "setInterval(()=>{},1000)"];
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("runChild: a child that exceeds the timeout is killed, awaited and reported as timed out", async () => {
  const started = Date.now();
  const result = await runChild(process.execPath, SLEEPER, process.env, { cwd: process.cwd(), timeoutMs: 700, control: makeControl(), graceMs: 500 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - started < 8000);
});

test("runChild: a stop request terminates the running child and resolves it as interrupted; a later child is stopped at once", async () => {
  const control = makeControl();
  const running = runChild(process.execPath, SLEEPER, process.env, { cwd: process.cwd(), timeoutMs: 60_000, control, graceMs: 500 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  control.requestStop("SIGTERM");
  const result = await running;
  assert.equal(result.interrupted, true);
  assert.equal(result.timedOut, false);
  const late = await runChild(process.execPath, SLEEPER, process.env, { cwd: process.cwd(), timeoutMs: 60_000, control, graceMs: 500 });
  assert.equal(late.interrupted, true, "a child started after the stop request is terminated immediately");
});

test("killTree: the whole tree dies, grandchildren included", async () => {
  const parent = spawn(process.execPath, ["-e", `const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});console.log("GRANDCHILD="+c.pid);setInterval(()=>{},1000)`], { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  const grandchild = await new Promise((resolve, reject) => {
    let buffer = "";
    parent.stdout.on("data", (chunk) => {
      buffer += chunk;
      const match = buffer.match(/GRANDCHILD=(\d+)/);
      if (match) resolve(Number(match[1]));
    });
    parent.on("error", reject);
    setTimeout(() => reject(new Error("grandchild pid not reported")), 8000);
  });
  assert.ok(alive(parent.pid) && alive(grandchild));
  killTree(parent.pid, { force: true });
  const deadline = Date.now() + 8000;
  while ((alive(parent.pid) || alive(grandchild)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(alive(parent.pid), false, "child gone");
  assert.equal(alive(grandchild), false, "grandchild gone");
});
