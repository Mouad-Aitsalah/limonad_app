"use client";

import { nowIso, withDatabase } from "./database";
import type { OutboxOperation, SyncOutboxEntry } from "./types";

/**
 * Adds a standalone outbox entry. `createOfflineSale` (sales-store.ts)
 * already enqueues its own entry as part of its atomic transaction - this
 * is for any other future entity that needs one outside that flow.
 *
 * Phase 1: nothing ever reads this queue to actually talk to the server -
 * see this task's own "12. OUTBOX" ("Ne rien envoyer au serveur dans cette
 * phase. Préparer seulement la structure.").
 */
export async function enqueueSyncOperation(entry: {
  entityType: string;
  entityLocalId: string;
  operation: OutboxOperation;
}): Promise<boolean> {
  const result = await withDatabase(async (db) => {
    await db.run(
      `INSERT INTO sync_outbox (
         id, entityType, entityLocalId, operation, createdAt,
         attemptCount, nextAttemptAt, lastError, lockedAt
       ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL)`,
      [
        `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        entry.entityType,
        entry.entityLocalId,
        entry.operation,
        nowIso(),
      ],
    );
    return true;
  });
  return result ?? false;
}

/**
 * PHASE 4B.1 - "5. SUCCÈS SERVEUR": sync_outbox has no "processed" flag (see
 * schema.ts's own CREATE TABLE) - only entityType/entityLocalId/operation/
 * attemptCount/lastError/lockedAt, none of which model "done". Deleting the
 * entry is therefore the only representation of "handled" this schema
 * supports - never a soft-delete/status column this table doesn't have.
 * Scoped to entityLocalId only (not entityType) since a given local sale
 * only ever has the one 'DRIVER_SALE'/'CREATE' entry createOfflineSale
 * inserted for it.
 */
export async function deleteOutboxEntriesForEntity(entityLocalId: string): Promise<boolean> {
  const result = await withDatabase(async (db) => {
    await db.run(`DELETE FROM sync_outbox WHERE entityLocalId = ?`, [entityLocalId]);
    return true;
  });
  return result ?? false;
}

export async function getPendingOutboxEntries(): Promise<SyncOutboxEntry[]> {
  const rows = await withDatabase(async (db) => {
    const result = await db.query(
      `SELECT * FROM sync_outbox WHERE lockedAt IS NULL ORDER BY createdAt ASC`,
    );
    return result.values ?? [];
  });
  return (rows ?? []).map(mapOutboxRow);
}

function mapOutboxRow(row: Record<string, unknown>): SyncOutboxEntry {
  return {
    id: String(row.id),
    entityType: String(row.entityType),
    entityLocalId: String(row.entityLocalId),
    operation: row.operation as OutboxOperation,
    createdAt: String(row.createdAt),
    attemptCount: Number(row.attemptCount),
    nextAttemptAt: (row.nextAttemptAt as string | null) ?? null,
    lastError: (row.lastError as string | null) ?? null,
    lockedAt: (row.lockedAt as string | null) ?? null,
  };
}
