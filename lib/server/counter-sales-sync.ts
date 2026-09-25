import "server-only";

import {
  buildCounterSaleInput,
  counterSaleSyncSchema,
} from "@/lib/counter-sale-sync-contract";
import { prisma } from "@/lib/prisma";
import { createCounterSale } from "@/lib/server/counter-sales";
import { OperationsServiceError } from "@/lib/server/depots";
import {
  isRetryableSyncError,
  mapSaleServiceErrorToSyncCode,
  type OfflineSyncErrorCode,
} from "@/lib/server/offline-sync-errors";
import { requireOrganizationUser } from "@/lib/server/organization-context";

/**
 * PHASE 5 - server side of the counter POS offline synchronisation.
 *
 * ONE offline sale in, ONE real sale out. This file only (1) validates the
 * envelope, (2) rebuilds the exact CounterSaleInput the online POS would have
 * posted and (3) hands it to createCounterSale - stock, payment, credit,
 * numbering and accounting all stay there, untouched. It is deliberately not
 * built on syncOfflineDriverSale (a different actor and pricing model).
 *
 * Idempotency: the local idempotencyKey IS Sale.idempotencyKey. A replay
 * returns the sale createCounterSale already created for it, flagged
 * `duplicate` so the client treats it as "already synchronised".
 *
 * Known createCounterSale properties this cannot change (reported, not
 * worked around): it has no `soldAt` (the sale is dated at sync time) and it
 * attributes the sale to the SESSION user - hence the identity checks below
 * refuse a sale that was made by somebody else.
 */

export type CounterSaleSyncResult = {
  success: true;
  result: "CREATED" | "ALREADY_SYNCED";
  localId: string;
  serverSaleId: string;
  officialDisplayNumber: string;
  serverTotalTTC: number;
  /** The server total differs from what was collected offline (> 1 centime). */
  totalMismatch: boolean;
};

export class CounterSaleSyncError extends Error {
  constructor(
    message: string,
    readonly code: OfflineSyncErrorCode,
    readonly status: number,
    readonly fieldErrors?: unknown,
  ) {
    super(message);
    this.name = "CounterSaleSyncError";
  }
}

export function isRetryableCounterSyncError(error: CounterSaleSyncError): boolean {
  return isRetryableSyncError(error.code, error.status);
}

export async function syncOfflineCounterSale(input: unknown): Promise<CounterSaleSyncResult> {
  // Same role gate as createCounterSale; a missing/expired session throws
  // AuthServiceError 401, a role that no longer sells 403.
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const parsed = counterSaleSyncSchema.safeParse(input);
  if (!parsed.success) {
    throw new CounterSaleSyncError(
      "La vente hors connexion est invalide.",
      "VALIDATION_ERROR",
      422,
      parsed.error.flatten().fieldErrors,
    );
  }
  const payload = parsed.data;

  if (payload.organizationId !== sessionUser.organizationId || payload.userId !== sessionUser.id) {
    // createCounterSale would book it on the CURRENT session: refuse rather
    // than attribute a sale to somebody who did not make it.
    throw new CounterSaleSyncError(
      "Cette vente a été faite par un autre utilisateur ou une autre organisation : reconnectez-vous avec le compte d'origine.",
      "FORBIDDEN",
      403,
    );
  }

  const existing = await prisma.sale.findFirst({
    where: { organizationId: sessionUser.organizationId, idempotencyKey: payload.idempotencyKey },
    select: { id: true },
  });

  try {
    const sale = await createCounterSale(buildCounterSaleInput(payload));
    return {
      success: true,
      result: existing ? "ALREADY_SYNCED" : "CREATED",
      localId: payload.localId,
      serverSaleId: sale.id,
      officialDisplayNumber: sale.displayNumber,
      serverTotalTTC: sale.totalTTC,
      totalMismatch: Math.abs(sale.totalTTC - payload.totals.totalTTC) > 0.01,
    };
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      throw new CounterSaleSyncError(
        error.message,
        mapSaleServiceErrorToSyncCode(error),
        error.status,
        error.fieldErrors,
      );
    }
    throw error;
  }
}
