import { AuthServiceError } from "@/lib/server/auth";
import { searchCustomers } from "@/lib/server/customers";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
import { handleStaffSearchRoute } from "@/lib/staff-search-route";

/**
 * Phase 3: GET /api/customers/search?q=...&limit=20 - fast, organization-
 * scoped (and driver-scoped, for a driver session) customer search for POS.
 * See searchCustomers's doc comment in lib/server/customers.ts.
 *
 * CORRECTION "RECHERCHE IMPOSSIBLE MALGRÉ CONNECTÉ": this route is called
 * cross-origin by the driver shell (ShellCustomerPicker) with a Bearer
 * token - auth already accepted that unchanged (requireOrganizationUser ->
 * resolveSessionToken), but the browser blocked the request before it ever
 * reached this handler because no CORS headers were ever attached. Mirrors
 * app/api/driver/pos/route.ts's own OPTIONS/withMobileCors wiring exactly -
 * withMobileCors only adds a header when the request's Origin is on the
 * mobile-shell allowlist, so a same-origin web app request is unaffected.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request) {
  // No staff session -> 401 (403 for a role not allowed); any other error
  // stays a 500 - see handleStaffSearchRoute. Every response, errors
  // included, keeps the mobile-shell CORS headers as before.
  return handleStaffSearchRoute(
    async () => {
      const url = new URL(request.url);
      const q = url.searchParams.get("q") ?? "";
      const limitParam = url.searchParams.get("limit");
      const activeOnlyParam = url.searchParams.get("activeOnly");
      const customers = await searchCustomers({
        q,
        limit: limitParam ? Number(limitParam) : undefined,
        activeOnly: activeOnlyParam === "false" ? false : true,
      });
      return { customers };
    },
    {
      isAuthError: (error): error is AuthServiceError => error instanceof AuthServiceError,
      failureMessage: "Impossible de rechercher les clients.",
      wrap: (response) => withMobileCors(request, response),
    },
  );
}
