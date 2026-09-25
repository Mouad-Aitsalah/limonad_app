import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  CounterSaleSyncError,
  isRetryableCounterSyncError,
  syncOfflineCounterSale,
} from "@/lib/server/counter-sales-sync";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { reportUnexpected } from "@/lib/server/report-error";

/**
 * PHASE 5 - receives ONE offline counter-POS sale and creates the real sale
 * through createCounterSale (see lib/server/counter-sales-sync.ts). Cookie
 * session + CSRF like POST /api/sales. Every failure carries a stable `code`
 * and an explicit `retryable` flag so the client never has to guess.
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  try {
    const body = await request.json();
    return NextResponse.json(await syncOfflineCounterSale(body), { status: 200 });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      // 401 = session expired (re-login fixes it); 403 = not allowed (it does not).
      const forbidden = error.status === 403;
      return NextResponse.json(
        {
          success: false,
          code: forbidden ? "FORBIDDEN" : "AUTH_REQUIRED",
          message: error.message,
          retryable: !forbidden,
        },
        { status: error.status },
      );
    }
    if (error instanceof CounterSaleSyncError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          message: error.message,
          fieldErrors: error.fieldErrors,
          retryable: isRetryableCounterSyncError(error),
        },
        { status: error.status },
      );
    }
    reportUnexpected(error, {
      route: "POST /api/sales/sync",
      area: "sales",
      op: "syncOfflineCounterSale",
    });
    return NextResponse.json(
      {
        success: false,
        code: "SALE_SYNC_FAILED",
        message: "Impossible de synchroniser la vente.",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
