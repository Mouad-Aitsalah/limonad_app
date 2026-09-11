import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCustomerBalancesPage } from "@/lib/server/customer-balances";
import { OperationsServiceError } from "@/lib/server/depots";

// Powers /comptabilite/solde-clients. Read-only, org-scoped inside
// getCustomerBalancesPage (never trusts a client-supplied organizationId).
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pageParam = url.searchParams.get("page");
    const pageSizeParam = url.searchParams.get("pageSize");
    const page = await getCustomerBalancesPage({
      page: pageParam ? Number(pageParam) : undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
      search: url.searchParams.get("search") || undefined,
      includeSettled: url.searchParams.get("includeSettled") === "1",
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le solde des clients." },
      { status: 500 },
    );
  }
}
