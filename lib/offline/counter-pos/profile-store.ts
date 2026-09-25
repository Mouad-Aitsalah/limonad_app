"use client";

/**
 * COUNTER POS - who this PC may sell for offline, and which organization it
 * belongs to (name / logo for the ticket).
 *
 * No secret is stored: no password, no session token, no PIN. Enrolment is
 * meant to happen ONLINE right after a real server login (a later phase adds
 * the salted PIN verifier as a new schema version). A record here means
 * "this PC has seen this user authenticate", never "this user is logged in".
 */

import { assertScope, CounterPosStoreError, runStorage, toIso } from "./database";
import type {
  AuthorizedUserRecord,
  CounterPosScope,
  OrganizationInfoRecord,
  StoreResult,
} from "./schema";

export type AuthorizedUserInput = {
  name: string;
  role: AuthorizedUserRecord["role"];
  depotId?: string | null;
  stockLocationId?: string | null;
};

/** Creates or refreshes the profile. A previously REVOKED user is NOT silently
 *  re-activated by a refresh: re-enrolment must be explicit (`reactivate`). */
export function upsertAuthorizedUser(
  scope: CounterPosScope,
  input: AuthorizedUserInput,
  options: { now?: Date; reactivate?: boolean } = {},
): Promise<StoreResult<AuthorizedUserRecord>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    if (typeof input?.name !== "string" || input.name.trim() === "") {
      throw new CounterPosStoreError("INVALID_INPUT", "name est requis.");
    }
    const nowIso = toIso(options.now);
    return db.transaction("rw", db.authorizedUsers, async () => {
      const key: [string, string] = [scope.organizationId, scope.userId];
      const previous = await db.authorizedUsers.get(key);
      const record: AuthorizedUserRecord = {
        organizationId: scope.organizationId,
        userId: scope.userId,
        name: input.name,
        role: input.role,
        depotId: input.depotId ?? null,
        stockLocationId: input.stockLocationId ?? null,
        status: previous?.status === "REVOKED" && !options.reactivate ? "REVOKED" : "ACTIVE",
        enrolledAt: previous?.enrolledAt ?? nowIso,
        updatedAt: nowIso,
        lastSeenOnlineAt: nowIso,
      };
      await db.authorizedUsers.put(record);
      return record;
    });
  });
}

export function getAuthorizedUser(
  scope: CounterPosScope,
): Promise<StoreResult<AuthorizedUserRecord | null>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    return (await db.authorizedUsers.get([scope.organizationId, scope.userId])) ?? null;
  });
}

export function listAuthorizedUsers(
  organizationId: string,
): Promise<StoreResult<AuthorizedUserRecord[]>> {
  return runStorage(organizationId, async (db) => {
    const users = await db.authorizedUsers.where("organizationId").equals(organizationId).toArray();
    return users.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  });
}

/** Marks a user as no longer allowed to sell offline on this PC. Their unsent
 *  sales are NOT deleted: they stay PENDING/FAILED for review. */
export function revokeAuthorizedUser(
  scope: CounterPosScope,
  options: { now?: Date } = {},
): Promise<StoreResult<AuthorizedUserRecord>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const nowIso = toIso(options.now);
    return db.transaction("rw", db.authorizedUsers, async () => {
      const key: [string, string] = [scope.organizationId, scope.userId];
      const previous = await db.authorizedUsers.get(key);
      if (!previous) throw new CounterPosStoreError("NOT_FOUND", "Utilisateur non autorise sur ce poste.");
      const record: AuthorizedUserRecord = { ...previous, status: "REVOKED", updatedAt: nowIso };
      await db.authorizedUsers.put(record);
      return record;
    });
  });
}

export type OrganizationInfoInput = {
  name: string;
  tradeName?: string | null;
  logoUrl?: string | null;
};

export function saveOrganizationInfo(
  organizationId: string,
  input: OrganizationInfoInput,
  options: { now?: Date } = {},
): Promise<StoreResult<OrganizationInfoRecord>> {
  return runStorage(organizationId, async (db) => {
    if (typeof input?.name !== "string" || input.name.trim() === "") {
      throw new CounterPosStoreError("INVALID_INPUT", "name est requis.");
    }
    const record: OrganizationInfoRecord = {
      organizationId,
      name: input.name,
      tradeName: input.tradeName ?? null,
      logoUrl: input.logoUrl ?? null,
      syncedAt: toIso(options.now),
    };
    await db.organizationInfo.put(record);
    return record;
  });
}

export function getOrganizationInfo(
  organizationId: string,
): Promise<StoreResult<OrganizationInfoRecord | null>> {
  return runStorage(organizationId, async (db) => (await db.organizationInfo.get(organizationId)) ?? null);
}
