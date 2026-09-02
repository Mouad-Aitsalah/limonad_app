import { NextResponse } from "next/server";

import { getProductPickerPreload } from "@/lib/server/products";

/**
 * Phase 3 CRITICAL #1 fix: GET /api/products/preload?supplierId=... - lets
 * the supplier-avoir picker re-fetch a small, supplier-scoped preload the
 * instant a supplier is selected, before the user types anything (the one
 * piece of the old client-side-filter-over-the-full-catalog behavior that a
 * static server-rendered preload alone couldn't reproduce). See
 * getProductPickerPreload's and resolveSupplierFilter's doc comments in
 * lib/server/products.ts for the exact fallback rule when a supplier has no
 * products of its own.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const supplierId = url.searchParams.get("supplierId") ?? undefined;
    const products = await getProductPickerPreload({ supplierId });
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les produits." },
      { status: 500 },
    );
  }
}
