import { NextResponse } from "next/server";

import { searchCustomers } from "@/lib/server/customers";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * Phase 3: GET /api/customers/search?q=...&limit=20 - fast, organization-
 * scoped (and driver-scoped, for a driver session) customer search for POS.
 * See searchCustomers's doc comment in lib/server/customers.ts.
 *
 * CORRECTION "RECHERCHE IMPOSSIBLE MALGRÉ CONNECTÉ": this route is called
 * cross-origin by the driver shell (ShellCustomerPicker) with a Bearer
 * token - auth already accepted that unchanged (requireOrganizationUser ->
 * resolveSessionToken), but the browser blocked the request before it ever
 * reached this handler because no CORS headers were ever attached. Mirrors
 * app/api/driver/pos/route.ts's own OPTIONS/withMobileCors wiring exactly -
 * withMobileCors only adds a header when the request's Origin is on the
 * mobile-shell allowlist, so a same-origin web app request is unaffected.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const limitParam = url.searchParams.get("limit");
    const activeOnlyParam = url.searchParams.get("activeOnly");
    const customers = await searchCustomers({
      q,
      limit: limitParam ? Number(limitParam) : undefined,
      activeOnly: activeOnlyParam === "false" ? false : true,
    });
    return withMobileCors(request, NextResponse.json({ customers }));
  } catch {
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de rechercher les clients." }, { status: 500 }),
    );
  }
}
