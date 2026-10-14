// Non-destructive tests of scripts/test-db/state-store.mjs. They use only a fresh temporary directory created and
// removed by the tests themselves; no database, no repository file, no user directory is touched.
//   Run: node --test scripts/test-db/state-store.test.mjs   (also part of `npm run test:db:script`)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { Refusal } from "./core.mjs";
import { createStateStore, defaultStateDir, privateEntryProblem } from "./state-store.mjs";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HOST = "this-machine";
const roots = [];
function tempDir() {
  const root = mkdtempSync(path.join(tmpdir(), "comdis-state-test-"));
  roots.push(root);
  return path.join(root, "state", "test-db");
}
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const record = (overrides = {}) => ({ token: TOKEN, pid: 4242, host: HOST, started: "2026-10-14T10:00:00.000Z", database: "commdis_d2_test", ...overrides });
function store(dir, { alive = () => false, pid = 4242, platform = "win32" } = {}) {
  return createStateStore({ dir, platform, hostname: HOST, pid, isProcessAlive: alive, getuid: () => null });
}

// ---------- location ----------
test("location: a private per-user directory, never the shared temp directory", () => {
  assert.equal(defaultStateDir({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, home: "C:\\Users\\u" }), path.join("C:\\Users\\u\\AppData\\Local", "comdis", "test-db"));
  assert.equal(defaultStateDir({ platform: "win32", env: {}, home: path.resolve("/home/u") }), path.join(path.resolve("/home/u"), "AppData", "Local", "comdis", "test-db"));
  const home = path.resolve("/home/u");
  assert.equal(defaultStateDir({ platform: "linux", env: {}, home }), path.join(home, ".local", "state", "comdis", "test-db"));
  const xdg = path.resolve("/data/state");
  assert.equal(defaultStateDir({ platform: "linux", env: { XDG_STATE_HOME: xdg }, home }), path.join(xdg, "comdis", "test-db"));
  assert.equal(defaultStateDir({ platform: "linux", env: { XDG_STATE_HOME: "relative/dir" }, home }), path.join(home, ".local", "state", "comdis", "test-db"), "a relative XDG path is ignored");
  assert.throws(() => defaultStateDir({ platform: "linux", env: {}, home: "" }), Refusal);
  assert.throws(() => defaultStateDir({ platform: "linux", env: {}, home: "relative" }), Refusal);
  for (const dir of [defaultStateDir({ platform: "linux", env: {}, home }), defaultStateDir({ platform: "win32", env: {}, home })]) {
    assert.ok(!dir.startsWith(tmpdir()), "not under the shared temp directory");
  }
});

// ---------- POSIX permission rules (pure: they run on every platform) ----------
const stat = (over) => ({ isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, uid: 1000, mode: 0o100600, ...over });

test("POSIX rules: symbolic link, wrong type, other owner and group/other access are all problems; a 0600 file / 0700 directory of the user is fine", () => {
  assert.equal(privateEntryProblem(stat({}), { uid: 1000, kind: "file" }), null);
  assert.equal(privateEntryProblem(stat({ isFile: () => false, isDirectory: () => true, mode: 0o040700 }), { uid: 1000, kind: "directory" }), null);
  assert.match(privateEntryProblem(stat({ isSymbolicLink: () => true }), { uid: 1000, kind: "file" }), /symbolic link/);
  assert.match(privateEntryProblem(stat({ isFile: () => false }), { uid: 1000, kind: "file" }), /not a regular file/);
  assert.match(privateEntryProblem(stat({ isDirectory: () => false }), { uid: 1000, kind: "directory" }), /not a directory/);
  assert.match(privateEntryProblem(stat({ uid: 0 }), { uid: 1000, kind: "file" }), /another user/);
  assert.match(privateEntryProblem(stat({ mode: 0o100644 }), { uid: 1000, kind: "file" }), /accessible to other users/);
  assert.match(privateEntryProblem(stat({ mode: 0o100660 }), { uid: 1000, kind: "file" }), /accessible to other users/);
  assert.equal(privateEntryProblem(stat({ uid: 0, mode: 0o100666 }), { uid: null, kind: "file" }), null, "Windows: no POSIX owner/mode rules");
});

// ---------- exclusive creation, staleness, live runs ----------
test("write: creates the record exclusively (the file did not exist) and read returns it", () => {
  const dir = tempDir();
  const s = store(dir);
  assert.equal(s.read(), null);
  s.write(record());
  assert.deepEqual(s.read(), record());
  assert.deepEqual(readdirSync(dir), ["owner.json"]);
});

test("write: the record of a LIVE run on this machine is never overwritten (second run refused)", () => {
  const dir = tempDir();
  store(dir).write(record({ pid: 777 }));
  const second = store(dir, { alive: (pid) => pid === 777, pid: 4242 });
  assert.throws(() => second.write(record({ token: OTHER })), (error) => error instanceof Refusal && /another test:db run is in progress/.test(error.message));
  assert.equal(second.read().token, TOKEN, "the live run's record is intact");
});

test("write: a stale record (its run is gone) is replaced, again by exclusive creation", () => {
  const dir = tempDir();
  store(dir).write(record({ pid: 777 }));
  const second = store(dir, { alive: () => false });
  second.write(record({ token: OTHER, pid: 4242 }));
  assert.equal(second.read().token, OTHER);
  assert.deepEqual(readdirSync(dir), ["owner.json"]);
});

test("write: a record from another machine name is treated as not live here (pid checks are only valid on the same host)", () => {
  const dir = tempDir();
  store(dir).write(record({ host: "other-host", pid: 777 }));
  const second = store(dir, { alive: () => true });
  second.write(record({ token: OTHER }));
  assert.equal(second.read().token, OTHER);
});

// ---------- atomic update ----------
test("update: replaces this run's record atomically (no temporary file left), refuses another run's token", () => {
  const dir = tempDir();
  const s = store(dir);
  s.write(record());
  s.update({ ...record(), oid: "16500" });
  assert.equal(s.read().oid, "16500");
  assert.deepEqual(readdirSync(dir), ["owner.json"], "no leftover temporary file");
  assert.throws(() => s.update({ ...record({ token: OTHER }), oid: "1" }), Refusal);
  assert.equal(s.read().oid, "16500");
  const empty = store(tempDir());
  assert.throws(() => empty.update(record()), Refusal, "nothing to update");
});

// ---------- tokens ----------
test("remove: only the record carrying the given token; without a token only a stale record", () => {
  const dir = tempDir();
  const s = store(dir);
  s.write(record());
  assert.equal(s.remove(OTHER), false);
  assert.ok(existsSync(path.join(dir, "owner.json")));
  assert.equal(s.remove(TOKEN), true);
  assert.equal(s.read(), null);

  const live = store(dir, { alive: (pid) => pid === 777 });
  live.write(record({ pid: 777 }));
  const other = store(dir, { alive: (pid) => pid === 777, pid: 4242 });
  assert.equal(other.remove(), false, "a live run's record is not removed without its token");
  const gone = store(dir, { alive: () => false, pid: 4242 });
  assert.equal(gone.remove(), true, "a stale record is");
});

// ---------- invalid / contradictory content ----------
test("read: unreadable or malformed content is ignored (null) with the reason in `problem`, never thrown, never trusted", () => {
  const dir = tempDir();
  const s = store(dir);
  s.write(record());
  const file = path.join(dir, "owner.json");
  for (const content of ["", "{not json", "null", JSON.stringify({ token: 5 }), JSON.stringify({ token: TOKEN, host: HOST }), JSON.stringify({ token: TOKEN, host: HOST, pid: "12" })]) {
    writeFileSync(file, content);
    assert.equal(s.read(), null, JSON.stringify(content));
    assert.match(s.problem, /ignored|unreadable/);
  }
  writeFileSync(file, JSON.stringify(record()));
  assert.deepEqual(s.read(), record());
  assert.equal(s.problem, null);
});

test("read: a record that is a symbolic link is refused (when the platform lets the test create one)", (t) => {
  const dir = tempDir();
  const s = store(dir);
  s.write(record());
  const file = path.join(dir, "owner.json");
  const target = path.join(dir, "elsewhere.json");
  writeFileSync(target, readFileSync(file));
  rmSync(file);
  try {
    symlinkSync(target, file);
  } catch {
    t.skip("symbolic links cannot be created here (needs a privilege on Windows); the rule is covered by privateEntryProblem");
    return;
  }
  assert.equal(s.read(), null);
  assert.match(s.problem, /symbolic link/);
  // exclusive creation never writes THROUGH the link: it replaces the link itself by a fresh regular file
  store(dir, { alive: () => false }).write(record({ token: OTHER }));
  assert.equal(readFileSync(target, "utf8").includes(OTHER), false, "the link target was not overwritten");
  assert.equal(store(dir).read().token, OTHER);
});

// ---------- real POSIX modes (only where the file system has them) ----------
test("POSIX: the directory is created 0700 and the file 0600 (skipped on Windows)", { skip: process.platform === "win32" ? "POSIX permission bits do not exist on Windows" : false }, async () => {
  const { statSync } = await import("node:fs");
  const dir = tempDir();
  const s = createStateStore({ dir, platform: "linux", hostname: HOST, pid: 4242, isProcessAlive: () => false });
  s.write(record());
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(dir, "owner.json")).mode & 0o777, 0o600);
});
