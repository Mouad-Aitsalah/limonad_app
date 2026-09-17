import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getDriverCustomersPage } from "@/lib/server/driver-customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * CRITICAL #2 follow-up: dedicated cursor-paginated endpoint for
 * /driver/clients, distinct from GET /api/driver/customers (kept unbounded
 * and unused internally, see getCustomersForCurrentDriver's doc comment).
 *
 * ÉTAPE 21 - now also called cross-origin by the driver shell (see mobile/
 * driver/src/lib/driver-clients-data-source.ts) for its own online paginated
 * list - same CORS wiring as app/api/driver/pos/route.ts and app/api/driver/
 * customers/route.ts's own GET. GET is never CSRF-gated (rejectUntrustedOrigin
 * only checks mutating methods), so this needed no other change.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pageSizeParam = url.searchParams.get("pageSize");
    const page = await getDriverCustomersPage({
      cursor: url.searchParams.get("cursor") || undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
      search: url.searchParams.get("search") || undefined,
      guaranteeCustomerId: url.searchParams.get("customerId") || undefined,
    });
    return withMobileCors(request, NextResponse.json(page));
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return withMobileCors(request, NextResponse.json({ message: error.message }, { status: error.status }));
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger les clients." }, { status: 500 }),
    );
  }
}
