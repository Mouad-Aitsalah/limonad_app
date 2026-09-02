import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getSalesOrdersPage } from "@/lib/server/sales-history";

// Powers /ventes's Commandes tab and the session/month drilldown dialogs -
// separate from /api/sales (sale creation + getAllSales) to avoid any
// ambiguity with that existing route's own GET/POST contract.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const pageSizeParam = url.searchParams.get("pageSize");
    const page = await getSalesOrdersPage({
      cursor: cursor || undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
      search: url.searchParams.get("search") || undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      paymentMethod: url.searchParams.get("paymentMethod") || undefined,
      posSessionId: url.searchParams.get("posSessionId") || undefined,
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger l'historique des ventes." },
      { status: 500 },
    );
  }
}
