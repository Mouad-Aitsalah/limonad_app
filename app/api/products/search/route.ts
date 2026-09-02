import { NextResponse } from "next/server";

import { searchPosProducts, searchProducts } from "@/lib/server/products";

/**
 * Phase 3 section 6: GET /api/products/search?q=...&limit=20 - fast,
 * organization-scoped, active-only-by-default product search for POS. See
 * searchProducts's doc comment in lib/server/products.ts.
 *
 * With `locationId`, delegates to searchPosProducts instead (scoped to
 * quantity > 0 at that location, same DriverPosProductDto shape as a POS
 * context's preloaded `products` list) - the fallback the POS frontend uses
 * when that preloaded list was truncated (see POS_PRODUCT_LIST_LIMIT).
 *
 * `supplierId` (Phase 3 CRITICAL #1 fix): scopes the search to that
 * supplier's own products, used only by the supplier-avoir picker - see
 * resolveSupplierFilter's doc comment for the exact fallback rule.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const limitParam = url.searchParams.get("limit");
    const locationId = url.searchParams.get("locationId");

    if (locationId) {
      const products = await searchPosProducts({
        locationId,
        q,
        limit: limitParam ? Number(limitParam) : undefined,
      });
      return NextResponse.json({ products });
    }

    const activeOnlyParam = url.searchParams.get("activeOnly");
    const supplierId = url.searchParams.get("supplierId") ?? undefined;
    const products = await searchProducts({
      q,
      limit: limitParam ? Number(limitParam) : undefined,
      activeOnly: activeOnlyParam === "false" ? false : true,
      supplierId,
    });
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json(
      { message: "Impossible de rechercher les produits." },
      { status: 500 },
    );
  }
}
