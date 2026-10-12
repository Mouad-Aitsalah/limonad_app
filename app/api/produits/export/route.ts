import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { exportProductsPage } from "@/lib/server/data-exports";
import { OperationsServiceError } from "@/lib/server/depots";

/**
 * GET /api/produits/export - one page of the products export (admin only, 403
 * otherwise; the organisation of the session only). Query: cursor, search,
 * categoryId, status (the /produits filters), stock=1 (depot stock of the
 * exporting user), photos=1 (audit only - the photos themselves come from
 * /api/produits/export/photos). Business values only, never an internal id.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const page = await exportProductsPage({
      filters: {
        search: url.searchParams.get("search") ?? undefined,
        categoryId: url.searchParams.get("categoryId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      },
      cursor: url.searchParams.get("cursor") || null,
      withStock: url.searchParams.get("stock") === "1",
      withPhotos: url.searchParams.get("photos") === "1",
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'exporter les produits." }, { status: 500 });
  }
}
