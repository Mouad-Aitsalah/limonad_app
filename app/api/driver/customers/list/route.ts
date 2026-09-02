import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getDriverCustomersPage } from "@/lib/server/driver-customers";
import { OperationsServiceError } from "@/lib/server/depots";

/**
 * CRITICAL #2 follow-up: dedicated cursor-paginated endpoint for
 * /driver/clients, distinct from GET /api/driver/customers (kept unbounded
 * and unused internally, see getCustomersForCurrentDriver's doc comment).
 */
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
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les clients." }, { status: 500 });
  }
}
