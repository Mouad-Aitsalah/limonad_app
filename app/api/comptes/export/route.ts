import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { exportAccountsPage } from "@/lib/server/data-exports";
import { OperationsServiceError } from "@/lib/server/depots";

/**
 * GET /api/comptes/export?type=CUSTOMER|SUPPLIER|EXPENSE|TREASURY|EMPLOYEE&cursor=&gps=1
 * One page of one account type (admin only; the organisation of the session).
 * Business values only - never an internal id, never a balance.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const page = await exportAccountsPage({
      type: url.searchParams.get("type") ?? "",
      cursor: url.searchParams.get("cursor") || null,
      includeGps: url.searchParams.get("gps") === "1",
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'exporter les comptes." }, { status: 500 });
  }
}
