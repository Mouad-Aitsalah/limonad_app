import { NextResponse } from "next/server";

import { getProductsPage } from "@/lib/server/products";

/**
 * Phase 3: dedicated paginated endpoint for /produits, distinct from
 * GET /api/products (unchanged - still the unbounded full list, still used
 * by components/achats/purchases-view.tsx for its product picker).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pageSizeParam = url.searchParams.get("pageSize");
    const page = await getProductsPage({
      cursor: url.searchParams.get("cursor") || undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
      categoryId: url.searchParams.get("categoryId") || undefined,
      brandId: url.searchParams.get("brandId") || undefined,
      status: url.searchParams.get("status") || undefined,
      search: url.searchParams.get("search") || undefined,
    });
    return NextResponse.json(page);
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les produits." },
      { status: 500 },
    );
  }
}
