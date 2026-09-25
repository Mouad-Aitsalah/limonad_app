"use client";

/**
 * COUNTER POS - what a logout does to the local data.
 *
 * Kept, on purpose (they are the only copy until synchronised, or the owner's
 * work): every offline sale in any state (PENDING / SYNCING / FAILED / SYNCED),
 * its lines and payments, the unsent carts, the device identity and the local
 * reference counter, the organization name/logo used to print a ticket.
 *
 * Deleted: the offline identity (no offline start is possible any more until a
 * new ONLINE login) and the mirrored reference data - catalogue, stock,
 * customers, the POS context and the data-sync state. None of it is needed to
 * synchronise a sale (each sale carries its own snapshot) and it is business
 * information that must not stay readable on a shared PC after sign-out. It is
 * mirrored again at the next online POS opening.
 *
 * Fail-soft: never throws, and the identity is cleared FIRST so that even if
 * the purge fails nobody can start offline.
 */

import { runStorage } from "./database";
import { clearOfflineSession, peekOfflineSessionOrganizationId } from "./offline-session";

export type LogoutCleanupResult = {
  identityCleared: boolean;
  referenceDataPurged: boolean;
  organizationId: string | null;
};

/** Deletes the mirrored reference data of ONE organization; sales are untouched. */
export async function purgeReferenceData(organizationId: string): Promise<boolean> {
  if (typeof organizationId !== "string" || organizationId === "") return false;
  const result = await runStorage(organizationId, async (db) => {
    await db.transaction(
      "rw",
      [db.products, db.stockLevels, db.customers, db.posContexts, db.syncStates],
      async () => {
        await db.products.where("organizationId").equals(organizationId).delete();
        await db.customers.where("organizationId").equals(organizationId).delete();
        await db.stockLevels.where("[organizationId+stockLocationId]").between(
          [organizationId, ""],
          [organizationId, "￿"],
        ).delete();
        await db.posContexts.filter((row) => row.organizationId === organizationId).delete();
        await db.syncStates.filter((row) => row.organizationId === organizationId).delete();
      },
    );
  });
  return result.ok;
}

export async function cleanupOnLogout(): Promise<LogoutCleanupResult> {
  const organizationId = await peekOfflineSessionOrganizationId();
  // Identity first: even if the purge fails, nobody can start offline.
  const identityCleared = await clearOfflineSession();
  const referenceDataPurged = organizationId ? await purgeReferenceData(organizationId) : false;
  return { identityCleared, referenceDataPurged, organizationId };
}
