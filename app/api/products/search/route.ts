import { AuthServiceError } from "@/lib/server/auth";
import { searchPosProducts, searchProducts } from "@/lib/server/products";
import { handleStaffSearchRoute } from "@/lib/staff-search-route";

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
  // No staff session -> 401 (403 for a role not allowed); any other error
  // stays a 500 - see handleStaffSearchRoute.
  return handleStaffSearchRoute(
    async () => {
      const url = new URL(request.url);
      const q = url.searchParams.get("q") ?? "";
      const limitParam = url.searchParams.get("limit");
      const locationId = url.searchParams.get("locationId");

      if (locationId) {
        const products = await searchPosProducts({
          locationId,
          q,
          limit: limitParam ? Number(limitParam) : undefined,
          // Counter POS opt-in (?sort=sold): best sellers first. Any other
          // caller (driver POS...) keeps the designation order.
          rankBySales: url.searchParams.get("sort") === "sold",
        });
        return { products };
      }

      const activeOnlyParam = url.searchParams.get("activeOnly");
      const supplierId = url.searchParams.get("supplierId") ?? undefined;
      const products = await searchProducts({
        q,
        limit: limitParam ? Number(limitParam) : undefined,
        activeOnly: activeOnlyParam === "false" ? false : true,
        supplierId,
      });
      return { products };
    },
    {
      isAuthError: (error): error is AuthServiceError => error instanceof AuthServiceError,
      failureMessage: "Impossible de rechercher les produits.",
    },
  );
}
