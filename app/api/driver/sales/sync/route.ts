import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { DriverSaleSyncError, syncOfflineDriverSale } from "@/lib/server/driver-sales";
import { OperationsServiceError } from "@/lib/server/depots";
import { reportUnexpected } from "@/lib/server/report-error";

/**
 * PHASE 4A - "SYNCHRONISATION SERVEUR DES VENTES OFFLINE CHAUFFEUR".
 *
 * Receives ONE already-confirmed offline (driver POS) sale and creates the
 * real server Sale for it - see syncOfflineDriverSale's own doc comment for
 * the full contract. Idempotent by `clientMutationId` (mapped onto
 * Sale.idempotencyKey): the exact same payload sent 2, 3 or 10 times always
 * returns the same serverSaleId/officialDisplayNumber, never a duplicate.
 *
 * Deliberately NOT wired to anything yet (see this task's own "18./19." -
 * no SQLite syncStatus update, no auto-sync trigger). This is Phase 4A:
 * server endpoint only.
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  try {
    const body = await request.json();
    const result = await syncOfflineDriverSale(body);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/driver/sales/sync",
      area: "sales",
      op: "syncOfflineDriverSale",
    });
    if (error instanceof AuthServiceError) {
      return NextResponse.json(
        { success: false, code: "AUTH_REQUIRED", message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof DriverSaleSyncError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          message: error.message,
          fieldErrors: error.fieldErrors,
        },
        { status: error.status },
      );
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        {
          success: false,
          code: "SALE_SYNC_FAILED",
          message: error.message,
          fieldErrors: error.fieldErrors,
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { success: false, code: "SALE_SYNC_FAILED", message: "Impossible de synchroniser la vente." },
      { status: 500 },
    );
  }
}
