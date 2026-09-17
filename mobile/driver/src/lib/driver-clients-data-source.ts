import type { DriverCustomersFetchPage } from "@/components/driver-clients/use-driver-customers-page";
import { localCustomerFilter } from "@/components/pos/mobile-customer-picker";
import { formatCustomerCode } from "@/lib/customer-code";
import { getCachedCustomers } from "@/lib/offline/driver-pos";
import type { CustomerDto, DriverCustomersPageDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 21 - "5. ONLINE" / "6.
 * OFFLINE": the shell's own DriverCustomersFetchPage (see that type's doc
 * comment in use-driver-customers-page.ts) - tries the SAME server endpoint
 * the web app already uses (GET /api/driver/customers/list, now CORS-enabled
 * - see that route's own doc comment), over Bearer instead of a cookie.
 *
 * On any non-ok outcome (offline, timeout, expired session, 5xx) - never
 * only a genuine network_error - falls back to cached_customers, the exact
 * SAME cache table/rows the driver POS's own customer search already reads
 * (see cache-store.ts's getCachedCustomers). No second cache, no second
 * table: this reuses it read-only, and NEVER writes to it - the only writer
 * remains refreshFullDriverCustomerCache (driver-pos-data-source.ts), called
 * once from DriverClientsScreen's own mount effect. Writing here too would
 * reintroduce exactly the "small preload silently clobbers the full cache"
 * bug bootstrap.ts's own skipCustomersCache flag was built to prevent (see
 * that flag's doc comment) - this function is read-only by construction.
 */
export function createShellCustomersPageFetcher(params: {
  token: string | null;
  organizationId: string;
  driverId: string;
}): DriverCustomersFetchPage {
  return async ({ cursor, pageSize, search }) => {
    if (params.token) {
      const query = new URLSearchParams({ pageSize: String(pageSize) });
      if (cursor) query.set("cursor", cursor);
      if (search) query.set("search", search);
      const outcome = await mobileFetch<DriverCustomersPageDto>(
        `/api/driver/customers/list?${query.toString()}`,
        params.token,
      );
      if (outcome.kind === "ok") return outcome.data;
      // unauthorized/server_error/network_error all fall through to the
      // offline cache below - a graceful degrade, not just "show nothing".
    }
    return loadOfflineCustomersPage({ ...params, cursor, pageSize, search });
  };
}

/**
 * ÉTAPE 21 - "4. CACHE CLIENTS": cached_customers only ever stores
 * {id, organizationId, driverId, code, name, phone, status, syncedAt} (see
 * lib/offline/driver-pos/types.ts's CachedCustomer) - never address/city/
 * type/creditLimit/creditLimitEnabled/currentBalance/creationOrigin/
 * latitude/longitude/... . Those missing fields get the EXACT SAME neutral
 * placeholders lib/offline/driver-pos/pos-context.ts's own dtoCustomers
 * mapping already uses for the driver POS's offline customer picker -
 * reused verbatim here, not reinvented, so both offline customer surfaces
 * agree on what "we don't know this offline" looks like. `creationOrigin:
 * "ADMIN"` is deliberate, not a guess: DriverClientsView's own existing
 * `disabled={customer.creationOrigin !== "DRIVER"}` check on "Modifier"/
 * "Ajouter la localisation" then naturally disables editing for every
 * offline-sourced row - never a fabricated allow, matching Étape 21's own
 * decision to keep customer create/edit out of this shell's scope for now.
 *
 * No server-side createdAt to sort by offline (also uncached) - falls back
 * to a plain alphabetical name sort, not "createdAt desc" like the server -
 * a real, documented difference from the online page order.
 */
async function loadOfflineCustomersPage(params: {
  organizationId: string;
  driverId: string;
  cursor: string | null;
  pageSize: number;
  search?: string;
}): Promise<DriverCustomersPageDto> {
  const cached = await getCachedCustomers({
    organizationId: params.organizationId,
    driverId: params.driverId,
  });

  const asDto: CustomerDto[] = cached
    .map((customer) => ({
      id: customer.id,
      code: customer.code,
      displayCode: formatCustomerCode(customer.code),
      name: customer.name,
      phone: customer.phone,
      address: "",
      city: "",
      type: "COUNTER",
      status: customer.status,
      creditLimit: 0,
      creditLimitEnabled: false,
      currentBalance: 0,
      createdByUserId: "",
      createdByUserName: "",
      creationOrigin: "ADMIN",
      createdAt: customer.syncedAt,
      updatedAt: customer.syncedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const filtered = params.search ? localCustomerFilter(asDto, params.search) : asDto;

  const startIndex = params.cursor ? Number(params.cursor) : 0;
  const endIndex = startIndex + params.pageSize;
  const items = filtered.slice(startIndex, endIndex);
  const hasMore = endIndex < filtered.length;

  return {
    items,
    nextCursor: hasMore ? String(endIndex) : null,
    hasMore,
    totalCount: filtered.length,
    totalAccessibleCustomers: asDto.length,
    activeCount: asDto.filter((customer) => customer.status === "ACTIVE").length,
    blockedCount: asDto.filter((customer) => customer.status === "BLOCKED").length,
    // creationOrigin isn't cached (see above) - genuinely unknown offline,
    // never guessed at as a real count.
    ownCreatedCount: 0,
    guaranteedCustomer: null,
  };
}
