import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOrganizationConnections,
  countActiveDevicesByUser,
  isSessionActive,
  isValidDeviceId,
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
