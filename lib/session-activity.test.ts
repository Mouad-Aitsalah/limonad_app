import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildOrganizationConnections,
  countActiveDevicesByUser,
  isMissingDeviceIdColumnError,
  isSessionActive,
  isValidDeviceId,
  loadSessionsWithDeviceFallback,
  ONLINE_WINDOW_MS,
  type ActivitySession,
} from "@/lib/session-activity";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

let counter = 0;
function session(overrides: Partial<ActivitySession> & { userId: string }): ActivitySession {
  counter += 1;
  return {
    id: `s${counter}`,
    deviceId: null,
    createdAt: ago(60 * 60 * 1000),
    lastUsedAt: ago(30 * 1000),
    expiresAt: later(60 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  };
}

test("one device logged in and active -> 1 connected device", () => {
  const counts = countActiveDevicesByUser([session({ userId: "u1", deviceId: "device-AAAAAAAAAAAA" })], NOW);
  assert.equal(counts.get("u1"), 1);
});

test("several devices used at the same time by one account are counted separately", () => {
  const counts = countActiveDevicesByUser(
    [
      session({ userId: "u1", deviceId: "device-AAAAAAAAAAAA" }),
      session({ userId: "u1", deviceId: "device-BBBBBBBBBBBB" }),
      session({ userId: "u1" }), // e.g. mobile Bearer login without a device id
    ],
    NOW,
  );
  assert.equal(counts.get("u1"), 3);
});

test("the same device logged in several times (several sessions) is counted once", () => {
  const counts = countActiveDevicesByUser(
    [
      session({ userId: "u1", deviceId: "device-AAAAAAAAAAAA" }),
      session({ userId: "u1", deviceId: "device-AAAAAAAAAAAA", lastUsedAt: ago(10 * 1000) }),
    ],
    NOW,
  );
  assert.equal(counts.get("u1"), 1);
});

test("logout: a revoked session is no longer counted", () => {
  const sessions = [
    session({ userId: "u1", deviceId: "device-AAAAAAAAAAAA", revokedAt: ago(5 * 1000) }),
    session({ userId: "u1", deviceId: "device-BBBBBBBBBBBB" }),
  ];
  assert.equal(countActiveDevicesByUser(sessions, NOW).get("u1"), 1);
  assert.equal(countActiveDevicesByUser([sessions[0]], NOW).has("u1"), false);
});

test("inactivity: a session silent for more than the window is not counted", () => {
  const idle = session({ userId: "u1", lastUsedAt: ago(ONLINE_WINDOW_MS + 1000) });
  const justInside = session({ userId: "u2", lastUsedAt: ago(ONLINE_WINDOW_MS - 1000) });
  assert.equal(isSessionActive(idle, NOW), false);
  assert.equal(isSessionActive(justInside, NOW), true);
  const counts = countActiveDevicesByUser([idle, justInside], NOW);
  assert.equal(counts.has("u1"), false);
  assert.equal(counts.get("u2"), 1);
});

test("an expired session is not counted even if it was active a moment ago", () => {
  const expired = session({ userId: "u1", lastUsedAt: ago(1000), expiresAt: ago(1) });
  assert.equal(isSessionActive(expired, NOW), false);
});

test("a freshly created session that has not made a request yet counts through createdAt", () => {
  const fresh = session({ userId: "u1", lastUsedAt: null, createdAt: ago(20 * 1000) });
  const stale = session({ userId: "u2", lastUsedAt: null, createdAt: ago(ONLINE_WINDOW_MS + 5000) });
  assert.equal(isSessionActive(fresh, NOW), true);
  assert.equal(isSessionActive(stale, NOW), false);
});

test("organization snapshot: per-user counts, total, online flags, users without session at 0", () => {
  const snapshot = buildOrganizationConnections(
    ["admin", "cashier", "driver"],
    [
      session({ userId: "admin", deviceId: "device-AAAAAAAAAAAA" }),
      session({ userId: "admin", deviceId: "device-BBBBBBBBBBBB" }),
      session({ userId: "cashier", deviceId: "device-CCCCCCCCCCCC" }),
    ],
    NOW,
  );
  assert.deepEqual(snapshot.users, [
    { userId: "admin", devices: 2, online: true },
    { userId: "cashier", devices: 1, online: true },
    { userId: "driver", devices: 0, online: false },
  ]);
  assert.equal(snapshot.totalDevices, 3);
  assert.equal(snapshot.onlineUsers, 2);
  assert.equal(snapshot.windowSeconds, ONLINE_WINDOW_MS / 1000);
});

test("organization isolation: sessions of users outside the organization are ignored", () => {
  const snapshot = buildOrganizationConnections(
    ["orgA-user"],
    [
      session({ userId: "orgA-user", deviceId: "device-AAAAAAAAAAAA" }),
      session({ userId: "orgB-user", deviceId: "device-ZZZZZZZZZZZZ" }),
      session({ userId: "orgB-user", deviceId: "device-YYYYYYYYYYYY" }),
    ],
    NOW,
  );
  assert.equal(snapshot.totalDevices, 1);
  assert.deepEqual(snapshot.users.map((user) => user.userId), ["orgA-user"]);
});

test("the snapshot never carries tokens, session ids or device ids", () => {
  const snapshot = buildOrganizationConnections(
    ["u1"],
    [session({ userId: "u1", deviceId: "device-AAAAAAAAAAAA" })],
    NOW,
  );
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes("device-"), false);
  assert.equal(/"(id|tokenHash|deviceId)"/.test(json), false);
  assert.deepEqual(Object.keys(snapshot.users[0]).sort(), ["devices", "online", "userId"]);
});

test("device id validation only accepts the random ids the app generates", () => {
  assert.equal(isValidDeviceId("abcdEFGH12345678_-xy"), true);
  assert.equal(isValidDeviceId("short"), false);
  assert.equal(isValidDeviceId("has space and <script>"), false);
  assert.equal(isValidDeviceId("a".repeat(65)), false);
  assert.equal(isValidDeviceId(undefined), false);
});

// ---------------------------------------------------------------------------
// Regression: the code was deployed to production before migration
// 20261003100000_add_session_device_id (Vercel runs `next build` only), so
// reading Session.deviceId raised a database error -> HTTP 500 on
// /api/organizations/[id]/connections. The count must degrade, not fail.
// ---------------------------------------------------------------------------

test("missing deviceId column is recognised (Prisma P2022, Postgres 42703, message)", () => {
  assert.equal(isMissingDeviceIdColumnError(Object.assign(new Error("The column `Session.deviceId` does not exist in the current database."), { code: "P2022" })), true);
  assert.equal(isMissingDeviceIdColumnError(Object.assign(new Error("query failed"), { code: "P2022", meta: { column: "Session.deviceId" } })), true);
  assert.equal(isMissingDeviceIdColumnError({ cause: { originalCode: "42703" }, message: "x" }), true);
  assert.equal(isMissingDeviceIdColumnError(new Error('column "deviceId" does not exist')), true);
});

test("other failures are never mistaken for the missing column", () => {
  assert.equal(isMissingDeviceIdColumnError(new Error("connect ECONNREFUSED 127.0.0.1:5432")), false);
  assert.equal(isMissingDeviceIdColumnError(Object.assign(new Error("Can't reach database server"), { code: "P1001" })), false);
  assert.equal(isMissingDeviceIdColumnError(Object.assign(new Error("table does not exist"), { code: "P2021" })), false);
  assert.equal(isMissingDeviceIdColumnError(new Error('column "other" does not exist')), false);
  assert.equal(isMissingDeviceIdColumnError(null), false);
  assert.equal(isMissingDeviceIdColumnError("P2022"), false);
});

test("fallback: with the column available, device tracking is used as is", async () => {
  const rows = [session({ userId: "u1", deviceId: "device-AAAAAAAAAAAA" })];
  const result = await loadSessionsWithDeviceFallback(
    async () => rows,
    async () => {
      throw new Error("must not be called");
    },
  );
  assert.equal(result.deviceTracking, "device");
  assert.equal(result.sessions, rows);
});

test("fallback: column missing in production -> counts per active session instead of failing", async () => {
  const withoutDevice = [
    { id: "a", userId: "u1", createdAt: ago(3600000), lastUsedAt: ago(10000), expiresAt: later(3600000), revokedAt: null },
    { id: "b", userId: "u1", createdAt: ago(3600000), lastUsedAt: ago(20000), expiresAt: later(3600000), revokedAt: null },
  ];
  const result = await loadSessionsWithDeviceFallback(
    async () => {
      throw Object.assign(new Error("The column `Session.deviceId` does not exist in the current database."), { code: "P2022" });
    },
    async () => withoutDevice,
  );
  assert.equal(result.deviceTracking, "session");
  assert.ok(result.sessions.every((row) => row.deviceId === null));
  const snapshot = buildOrganizationConnections(["u1", "u2"], result.sessions, NOW, result.deviceTracking);
  assert.equal(snapshot.deviceTracking, "session");
  assert.equal(snapshot.totalDevices, 2);
  assert.deepEqual(snapshot.users, [
    { userId: "u1", devices: 2, online: true },
    { userId: "u2", devices: 0, online: false },
  ]);
});

test("fallback: a real failure (database unreachable) is rethrown, never hidden as zero devices", async () => {
  await assert.rejects(
    loadSessionsWithDeviceFallback(
      async () => {
        throw new Error("connect ECONNREFUSED");
      },
      async () => [],
    ),
    /ECONNREFUSED/,
  );
});

test("snapshot defaults to device tracking", () => {
  assert.equal(buildOrganizationConnections([], [], NOW).deviceTracking, "device");
});

test("wiring guard: the connections query goes through the fallback, and auth never SELECTs deviceId", () => {
  const connections = readFileSync(new URL("./server/organization-connections.ts", import.meta.url), "utf8");
  assert.match(connections, /loadSessionsWithDeviceFallback\(/);
  // deviceId may only appear in the "with device" select, never in the shared base select / where
  assert.equal((connections.match(/deviceId: true/g) ?? []).length, 1);
  const auth = readFileSync(new URL("./server/auth.ts", import.meta.url), "utf8");
  assert.equal(/deviceId: true/.test(auth), false, "login / session checks must not depend on the optional column");
});
