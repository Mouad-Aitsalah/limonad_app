// Local ownership record of scripts/test-db.mjs: proof, for `test:db:cleanup`, that THIS user's machine started the run
// whose database is left behind. Kept in a private per-user directory (never the shared temp directory), created
// exclusively, read back only if it is a regular file that belongs to the current user.
//
//   Windows : %LOCALAPPDATA%\comdis\test-db   (inherits the user-private ACL of the profile; POSIX modes do not apply)
//   POSIX   : $XDG_STATE_HOME or ~/.local/state, /comdis/test-db   (directory 0700, file 0600, owner checked)
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

import { Refusal } from "./core.mjs";

const FILE_NAME = "owner.json";

export function defaultStateDir({ platform = process.platform, env = process.env, home }) {
  if (!home || !path.isAbsolute(home)) throw new Refusal("cannot locate the user's home directory for the ownership record.");
  let base;
  if (platform === "win32") {
    base = env.LOCALAPPDATA && path.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.join(home, "AppData", "Local");
  } else {
    base = env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(home, ".local", "state");
  }
  return path.join(base, "comdis", "test-db");
}

/** Pure check of a stat result for the POSIX rules: owned by `uid`, no group/other access. Returns a problem text or null. */
export function privateEntryProblem(stat, { uid, kind }) {
  if (stat.isSymbolicLink()) return `${kind} is a symbolic link`;
  if (kind === "directory" && !stat.isDirectory()) return "not a directory";
  if (kind === "file" && !stat.isFile()) return "not a regular file";
  if (uid !== null && stat.uid !== uid) return `${kind} belongs to another user`;
  if (uid !== null && (stat.mode & 0o077) !== 0) return `${kind} is accessible to other users (mode ${(stat.mode & 0o777).toString(8)})`;
  return null;
}

export function createStateStore({ dir, platform = process.platform, hostname, pid, isProcessAlive, getuid = () => (typeof process.getuid === "function" ? process.getuid() : null) }) {
  const file = path.join(dir, FILE_NAME);
  const posix = platform !== "win32";
  const store = { file, problem: null };

  function ensureDir() {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(dir);
    if (posix) {
      let problem = privateEntryProblem(stat, { uid: getuid(), kind: "directory" });
      if (problem && !stat.isSymbolicLink() && stat.isDirectory() && stat.uid === getuid()) {
        chmodSync(dir, 0o700); // ours but too open: tighten, then re-check
        problem = privateEntryProblem(lstatSync(dir), { uid: getuid(), kind: "directory" });
      }
      if (problem) throw new Refusal(`the ownership record directory ${dir} is not private (${problem}); refusing to use it.`);
    } else if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Refusal(`the ownership record directory ${dir} is not a plain directory; refusing to use it.`);
    }
  }

  /** The record, or null when absent or untrusted (the reason is then in store.problem). Never throws. */
  store.read = () => {
    store.problem = null;
    try {
      if (!existsSync(file)) return null;
      const stat = lstatSync(file);
      const problem = privateEntryProblem(stat, { uid: posix ? getuid() : null, kind: "file" });
      if (problem) {
        store.problem = `the ownership record ${file} is ignored: ${problem}`;
        return null;
      }
      const record = JSON.parse(readFileSync(file, "utf8"));
      if (!record || typeof record.token !== "string" || typeof record.host !== "string" || !Number.isInteger(record.pid)) {
        store.problem = `the ownership record ${file} is ignored: unexpected content`;
        return null;
      }
      return record;
    } catch (error) {
      store.problem = `the ownership record ${file} is unreadable: ${error.message}`;
      return null;
    }
  };

  function createExclusive(target, record) {
    const fd = openSync(target, "wx", 0o600); // fails if the entry exists (also if it is a symbolic link)
    try {
      writeSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
  }

  /** Exclusive creation. A stale record (its run is gone) is replaced; the record of a live run is never overwritten. */
  store.write = (record) => {
    ensureDir();
    try {
      createExclusive(file, record);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const existing = store.read();
    if (existing && existing.host === hostname && existing.pid !== pid && isProcessAlive(existing.pid)) {
      throw new Refusal(`another test:db run is in progress or starting (pid ${existing.pid}, token ${existing.token}); refusing to start a second one.`);
    }
    unlinkSync(file); // stale: its database was verified absent and the lock is held
    createExclusive(file, record);
  };

  /** Replaces the record of THIS run (same token) atomically: exclusive temporary file, then rename. */
  store.update = (record) => {
    const existing = store.read();
    if (!existing || existing.token !== record.token) throw new Refusal("the ownership record is no longer this run's; not updating it.");
    const temp = path.join(dir, `${FILE_NAME}.${pid}.tmp`);
    try {
      createExclusive(temp, record);
      renameSync(temp, file);
    } catch (error) {
      try {
        unlinkSync(temp);
      } catch {
        /* none */
      }
      throw error;
    }
  };

  /** Removes the record only if it carries `token`; without a token, only if its run is gone. Returns whether it was removed. */
  store.remove = (token) => {
    const existing = store.read();
    if (!existing) return false;
    if (token !== undefined ? existing.token !== token : existing.host === hostname && existing.pid !== pid && isProcessAlive(existing.pid)) return false;
    try {
      unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  };

  return store;
}
