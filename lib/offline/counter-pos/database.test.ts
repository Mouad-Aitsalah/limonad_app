import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  closeCounterPosDatabase,
  counterPosDatabaseName,
  deleteCounterPosDatabase,
  generateUuid,
  getCounterPosDatabase,
  getDeviceId,
  isIndexedDbAvailable,
  runStorage,
} from "./database";
import {
  getAuthorizedUser,
  getOrganizationInfo,
  listAuthorizedUsers,
  revokeAuthorizedUser,
  saveOrganizationInfo,
  upsertAuthorizedUser,
} from "./profile-store";
import { failureOf, uniqueOrg, unwrap } from "./test-helpers";

test("one database per organization, named after the organization", () => {
  const orgA = uniqueOrg();
  const orgB = uniqueOrg();
  const dbA = getCounterPosDatabase(orgA);
  const dbB = getCounterPosDatabase(orgB);
  assert.ok(dbA && dbB);
  assert.notEqual(dbA, dbB);
  assert.equal(dbA.name, counterPosDatabaseName(orgA));
  assert.notEqual(dbA.name, dbB.name);
  assert.equal(getCounterPosDatabase(orgA), dbA, "same organization -> same connection");
});

test("unusable organization ids never open a database", async () => {
  assert.equal(getCounterPosDatabase(""), null);
  assert.equal(getCounterPosDatabase("   "), null);
  assert.equal(getCounterPosDatabase(undefined as unknown as string), null);
  const result = await runStorage("", async () => 1);
  assert.equal(failureOf(result).code, "INVALID_INPUT");
});

test("data written for one organization is invisible to another", async () => {
  const orgA = uniqueOrg();
  const orgB = uniqueOrg();
  unwrap(await saveOrganizationInfo(orgA, { name: "Societe A" }));
  assert.equal(unwrap(await getOrganizationInfo(orgA))?.name, "Societe A");
  assert.equal(unwrap(await getOrganizationInfo(orgB)), null);

  unwrap(await upsertAuthorizedUser({ organizationId: orgA, userId: "u1" }, { name: "Alice", role: "cashier" }));
  assert.equal(unwrap(await listAuthorizedUsers(orgA)).length, 1);
  assert.equal(unwrap(await listAuthorizedUsers(orgB)).length, 0);
});

test("deviceId: created once, stable, persisted across reopen, distinct per organization", async () => {
  const orgA = uniqueOrg();
  const orgB = uniqueOrg();
  const first = unwrap(await getDeviceId(orgA));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(unwrap(await getDeviceId(orgA)), first);

  closeCounterPosDatabase(orgA); // simulates closing the app
  assert.equal(unwrap(await getDeviceId(orgA)), first, "survives a close/reopen");

  assert.notEqual(unwrap(await getDeviceId(orgB)), first);
});

test("concurrent first use of deviceId still yields ONE id", async () => {
  const org = uniqueOrg();
  const ids = await Promise.all(Array.from({ length: 10 }, () => getDeviceId(org)));
  assert.equal(new Set(ids.map((r) => unwrap(r))).size, 1);
});

test("deleteCounterPosDatabase wipes one organization only", async () => {
  const orgA = uniqueOrg();
  const orgB = uniqueOrg();
  unwrap(await saveOrganizationInfo(orgA, { name: "A" }));
  unwrap(await saveOrganizationInfo(orgB, { name: "B" }));
  unwrap(await deleteCounterPosDatabase(orgA));
  assert.equal(unwrap(await getOrganizationInfo(orgA)), null);
  assert.equal(unwrap(await getOrganizationInfo(orgB))?.name, "B");
  assert.equal(failureOf(await deleteCounterPosDatabase("")).code, "INVALID_INPUT");
});

test("IndexedDB unavailable -> soft failure, never an exception", async () => {
  const org = uniqueOrg();
  const original = globalThis.indexedDB;
  // @ts-expect-error simulating an environment without IndexedDB
  delete globalThis.indexedDB;
  try {
    assert.equal(isIndexedDbAvailable(), false);
    assert.equal(getCounterPosDatabase(org), null);
    assert.equal(failureOf(await getDeviceId(org)).code, "INDEXEDDB_UNAVAILABLE");
    assert.equal(failureOf(await saveOrganizationInfo(org, { name: "x" })).code, "INDEXEDDB_UNAVAILABLE");
    assert.equal(failureOf(await deleteCounterPosDatabase(org)).code, "INDEXEDDB_UNAVAILABLE");
  } finally {
    globalThis.indexedDB = original;
  }
  assert.equal(isIndexedDbAvailable(), true);
});

test("generateUuid returns distinct RFC4122 v4 ids", () => {
  const ids = new Set(Array.from({ length: 500 }, () => generateUuid()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("authorized users: upsert, refresh, revoke, explicit reactivation", async () => {
  const org = uniqueOrg();
  const scope = { organizationId: org, userId: "u1" };
  const t0 = new Date("2026-09-25T10:00:00.000Z");
  const t1 = new Date("2026-09-25T11:00:00.000Z");

  const created = unwrap(
    await upsertAuthorizedUser(scope, { name: "Alice", role: "cashier", depotId: "d1", stockLocationId: "l1" }, { now: t0 }),
  );
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.enrolledAt, t0.toISOString());

  const refreshed = unwrap(await upsertAuthorizedUser(scope, { name: "Alice B.", role: "cashier" }, { now: t1 }));
  assert.equal(refreshed.name, "Alice B.");
  assert.equal(refreshed.enrolledAt, t0.toISOString(), "enrolment date kept");
  assert.equal(refreshed.lastSeenOnlineAt, t1.toISOString());

  const revoked = unwrap(await revokeAuthorizedUser(scope, { now: t1 }));
  assert.equal(revoked.status, "REVOKED");

  const afterRefresh = unwrap(await upsertAuthorizedUser(scope, { name: "Alice B.", role: "cashier" }, { now: t1 }));
  assert.equal(afterRefresh.status, "REVOKED", "a refresh must not silently re-enable a revoked user");

  const reactivated = unwrap(
    await upsertAuthorizedUser(scope, { name: "Alice B.", role: "cashier" }, { now: t1, reactivate: true }),
  );
  assert.equal(reactivated.status, "ACTIVE");

  assert.equal(failureOf(await revokeAuthorizedUser({ organizationId: org, userId: "ghost" })).code, "NOT_FOUND");
  assert.equal(unwrap(await getAuthorizedUser({ organizationId: org, userId: "ghost" })), null);
  assert.equal(failureOf(await upsertAuthorizedUser(scope, { name: " ", role: "cashier" })).code, "INVALID_INPUT");
});

test("scopes require both organizationId and userId", async () => {
  const org = uniqueOrg();
  assert.equal(
    failureOf(await getAuthorizedUser({ organizationId: org, userId: "" })).code,
    "INVALID_INPUT",
  );
  assert.equal(
    failureOf(await getAuthorizedUser(undefined as never)).code,
    "INVALID_INPUT",
  );
});

test("organization info is stored with the logo and refreshed in place", async () => {
  const org = uniqueOrg();
  unwrap(await saveOrganizationInfo(org, { name: "Ma Societe", tradeName: "MS", logoUrl: "data:image/png;base64,AAAA" }));
  const info = unwrap(await getOrganizationInfo(org));
  assert.equal(info?.tradeName, "MS");
  assert.equal(info?.logoUrl, "data:image/png;base64,AAAA");
  unwrap(await saveOrganizationInfo(org, { name: "Ma Societe 2" }));
  assert.equal(unwrap(await getOrganizationInfo(org))?.name, "Ma Societe 2");
  assert.equal(failureOf(await saveOrganizationInfo(org, { name: "" })).code, "INVALID_INPUT");
});
