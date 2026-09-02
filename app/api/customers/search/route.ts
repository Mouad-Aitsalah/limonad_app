import { NextResponse } from "next/server";

import { searchCustomers } from "@/lib/server/customers";

/**
 * Phase 3: GET /api/customers/search?q=...&limit=20 - fast, organization-
 * scoped (and driver-scoped, for a driver session) customer search for POS.
 * See searchCustomers's doc comment in lib/server/customers.ts.
 */
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
    return NextResponse.json({ customers });
  } catch {
    return NextResponse.json(
      { message: "Impossible de rechercher les clients." },
      { status: 500 },
    );
  }
}
