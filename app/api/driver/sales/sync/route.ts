import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { DriverSaleSyncError, syncOfflineDriverSale } from "@/lib/server/driver-sales";
import { OperationsServiceError } from "@/lib/server/depots";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
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
 * CORRECTION "FINALISATION PIPELINE OFFLINE V1": this route is the one the
 * shell's syncPendingDriverSales actually calls cross-origin, with a Bearer
 * token, once every offline CASH sale is meant to reach the server - it had
 * neither CORS (browser blocked the request before it landed here) nor a
 * CSRF bypass for Bearer requests (rejectUntrustedOrigin would have refused
 * it anyway, same as a forged cross-site POST). Same fix as
 * app/api/driver/sales/route.ts: skip the cookie-CSRF check when a Bearer
 * header is present (a bearer token carries no ambient credential, so there
 * is nothing for a forged cross-site request to exploit - the web app never
 * sends this header, so its own CSRF protection is unchanged), add
 * OPTIONS/withMobileCors for the allowlisted shell origin.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function POST(request: Request) {
  const hasBearer = (request.headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ");
  if (!hasBearer) {
    const csrfRejection = rejectUntrustedOrigin(request);
    if (csrfRejection) return csrfRejection;
  }

  try {
    const body = await request.json();
    const result = await syncOfflineDriverSale(body);
    return withMobileCors(request, NextResponse.json(result, { status: 200 }));
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/driver/sales/sync",
      area: "sales",
      op: "syncOfflineDriverSale",
    });
    if (error instanceof AuthServiceError) {
      return withMobileCors(
        request,
        NextResponse.json({ success: false, code: "AUTH_REQUIRED", message: error.message }, { status: error.status }),
      );
    }
    if (error instanceof DriverSaleSyncError) {
      return withMobileCors(
        request,
        NextResponse.json(
          {
            success: false,
            code: error.code,
            message: error.message,
            fieldErrors: error.fieldErrors,
          },
          { status: error.status },
        ),
      );
    }
    if (error instanceof OperationsServiceError) {
      return withMobileCors(
        request,
        NextResponse.json(
          {
            success: false,
            code: "SALE_SYNC_FAILED",
            message: error.message,
            fieldErrors: error.fieldErrors,
          },
          { status: error.status },
        ),
      );
    }
    return withMobileCors(
      request,
      NextResponse.json(
        { success: false, code: "SALE_SYNC_FAILED", message: "Impossible de synchroniser la vente." },
        { status: 500 },
      ),
    );
  }
}
