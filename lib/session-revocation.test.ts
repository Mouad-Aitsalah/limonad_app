import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildOrganizationConnections,
  isSessionValid,
  type ActivitySession,
} from "@/lib/session-activity";
import {
  revokeUserSessionsInOrganization,
  SessionRevocationError,
  type RevocationDeps,
} from "@/lib/session-revocation";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

type Row = ActivitySession;

/** In-memory stand-in for the database, with the same semantics as the real query. */
function makeStore(users: Array<{ id: string; organizationId: string | null }>, sessions: Row[]) {
  const deps: RevocationDeps = {
    findUser: async (id) => users.find((user) => user.id === id) ?? null,
    // Mirrors: prisma.session.updateMany({ where: { userId, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } })
    revokeActiveSessions: async (userId, now) => {
      let count = 0;
      for (const row of sessions) {
        if (row.userId === userId && row.revokedAt === null && row.expiresAt.getTime() > now.getTime()) {
          row.revokedAt = now;
          count += 1;
        }
      }
      return count;
    },
  };
  return { deps, sessions };
}

let n = 0;
function session(userId: string, overrides: Partial<Row> = {}): Row {
  n += 1;
  return {
    id: `s${n}`,
    userId,
    deviceId: `device-${String(n).padStart(12, "0")}`,
    createdAt: ago(3600000),
    lastUsedAt: ago(20000),
    expiresAt: later(3600000),
    revokedAt: null,
    ...overrides,
  };
}

const USERS = [
  { id: "target", organizationId: "orgA" },
  { id: "colleague", organizationId: "orgA" },
  { id: "outsider", organizationId: "orgB" },
];

const asSuperAdmin = (userId: string, organizationId = "orgA") => ({
  actorRole: "super_admin",
  organizationId,
  userId,
  now: NOW,
});

test("revokes ALL active sessions of the user and returns how many; nothing is deleted", async () => {
  const { deps, sessions } = makeStore(USERS, [
    session("target"),
    session("target"),
    session("target"),
  ]);
  const result = await revokeUserSessionsInOrganization(deps, asSuperAdmin("target"));
  assert.deepEqual(result, { revokedSessions: 3 });
  assert.equal(sessions.length, 3, "session history is kept");
  assert.ok(sessions.every((row) => row.revokedAt?.getTime() === NOW.getTime()));
});

test("other users' sessions (same organization and other organizations) are untouched", async () => {
  const colleague = session("colleague");
  const outsider = session("outsider");
  const { deps } = makeStore(USERS, [session("target"), colleague, outsider]);
  await revokeUserSessionsInOrganization(deps, asSuperAdmin("target"));
  assert.equal(colleague.revokedAt, null);
  assert.equal(outsider.revokedAt, null);
});

test("only SUPER_ADMIN can use it: every other role is refused (403) and nothing is revoked", async () => {
  for (const role of ["admin", "depot_manager", "cashier", "driver", "", "SUPER_ADMIN"]) {
    const target = session("target");
    const { deps } = makeStore(USERS, [target]);
    await assert.rejects(
      revokeUserSessionsInOrganization(deps, { ...asSuperAdmin("target"), actorRole: role }),
      (error: unknown) => error instanceof SessionRevocationError && error.status === 403,
      `role "${role}"`,
    );
    assert.equal(target.revokedAt, null);
  }
});

test("a user outside the organization cannot be targeted (404) - sessions stay valid", async () => {
  const outsider = session("outsider");
  const { deps } = makeStore(USERS, [outsider]);
  await assert.rejects(
    revokeUserSessionsInOrganization(deps, asSuperAdmin("outsider", "orgA")),
    (error: unknown) => error instanceof SessionRevocationError && error.status === 404,
  );
  assert.equal(outsider.revokedAt, null);
});

test("an unknown user id gets the same 404 (no way to probe which ids exist)", async () => {
  const { deps } = makeStore(USERS, []);
  await assert.rejects(
    revokeUserSessionsInOrganization(deps, asSuperAdmin("does-not-exist")),
    (error: unknown) =>
      error instanceof SessionRevocationError &&
      error.status === 404 &&
      error.message === "Utilisateur introuvable dans cette organisation.",
  );
});

test("a user without any active session: 0 revoked, no error, old revocations are not re-stamped", async () => {
  const alreadyRevoked = session("target", { revokedAt: ago(60000) });
  const expired = session("target", { expiresAt: ago(1000) });
  const { deps } = makeStore(USERS, [alreadyRevoked, expired]);
  const result = await revokeUserSessionsInOrganization(deps, asSuperAdmin("target"));
  assert.deepEqual(result, { revokedSessions: 0 });
  assert.equal(alreadyRevoked.revokedAt?.getTime(), ago(60000).getTime());
  assert.equal(expired.revokedAt, null);
  const none = makeStore(USERS, []);
  assert.deepEqual(await revokeUserSessionsInOrganization(none.deps, asSuperAdmin("target")), {
    revokedSessions: 0,
  });
});

test("after the revocation the user shows 0 devices / offline and the organization total drops", async () => {
  const rows = [
    session("target"),
    session("target"),
    session("colleague"),
  ];
  const { deps } = makeStore(USERS, rows);
  const ids = ["target", "colleague"];

  const before = buildOrganizationConnections(ids, rows, NOW);
  assert.equal(before.totalDevices, 3);
  assert.deepEqual(before.users[0], { userId: "target", devices: 2, online: true });

  await revokeUserSessionsInOrganization(deps, asSuperAdmin("target"));

  const after = buildOrganizationConnections(ids, rows, NOW);
  assert.deepEqual(after.users[0], { userId: "target", devices: 0, online: false });
  assert.deepEqual(after.users[1], { userId: "colleague", devices: 1, online: true });
  assert.equal(after.totalDevices, 1);
  assert.equal(after.onlineUsers, 1);
});

test("a revoked session is refused by the session check used for every protected request", async () => {
  const live = session("target");
  const { deps } = makeStore(USERS, [live]);
  assert.equal(isSessionValid(live, NOW), true);
  await revokeUserSessionsInOrganization(deps, asSuperAdmin("target"));
  assert.equal(isSessionValid(live, NOW), false, "revoked -> refused immediately");
  assert.equal(isSessionValid(session("target", { expiresAt: ago(1) }), NOW), false, "expired -> refused");
  assert.equal(isSessionValid(session("target"), NOW.getTime()), true, "accepts a timestamp too");
});

test("wiring guard: auth uses the shared validity check, the route is CSRF + SUPER_ADMIN protected, nothing is deleted or leaked", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  const auth = read("./server/auth.ts");
  assert.ok(
    (auth.match(/isSessionValid\(session, /g) ?? []).length >= 2,
    "getCurrentSessionUser and refreshCurrentSession both use isSessionValid",
  );

  const server = read("./server/organization-connections.ts");
  const revokeFn = server.slice(server.indexOf("export async function revokeOrganizationUserSessions"));
  assert.match(revokeFn, /await requireSuperAdmin\(\)/);
  assert.match(revokeFn, /session\.updateMany\(/);
  assert.match(revokeFn, /revokedAt: null/);
  assert.match(revokeFn, /data: \{ revokedAt: now \}/);
  assert.equal(/session\.delete/.test(server), false, "no session row is ever deleted");
  assert.equal(/user\.delete/.test(server), false);
  assert.equal(/tokenHash/.test(server), false, "no token material in this module");

  const route = read("../app/api/organizations/[id]/connections/[userId]/revoke/route.ts");
  assert.match(route, /rejectUntrustedOrigin\(request\)/);
  assert.match(route, /export async function POST/);
  assert.equal(/tokenHash|deviceId/.test(route), false);
});

test("heartbeat answers 401 for an ended session and the client only reacts to a real 401", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const heartbeat = read("../app/api/auth/heartbeat/route.ts");
  assert.match(heartbeat, /status: 401/);
  const hook = read("../hooks/use-auth.tsx");
  assert.match(hook, /response\.status === 401\) void revalidateSession\(\)/);
});
