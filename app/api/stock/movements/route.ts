import { NextResponse } from "next/server";

import { getStockMovementsPage } from "@/lib/server/stock-movements";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const pageSizeParam = url.searchParams.get("pageSize");
    const page = await getStockMovementsPage({
      cursor: cursor || undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
      productId: url.searchParams.get("productId") || undefined,
      locationId: url.searchParams.get("locationId") || undefined,
      type: url.searchParams.get("type") || undefined,
      referenceType: url.searchParams.get("referenceType") || undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      search: url.searchParams.get("search") || undefined,
    });
    return NextResponse.json(page);
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les mouvements." },
      { status: 500 },
    );
  }
}
