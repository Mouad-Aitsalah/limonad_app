import type { InvoiceDetailFetchOutcome } from "@/components/ventes/invoice-detail-dialog";
import { formatCustomerCode } from "@/lib/customer-code";
import { businessDayRangeUtc, getCurrentBusinessDayParam } from "@/lib/business-day";
import { addMoney } from "@/lib/money";
import { getCachedCustomers, getOfflineSales } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext, OfflineSaleWithLines } from "@/lib/offline/driver-pos";
import type { CustomerDto, DriverTodaySalesDto } from "@/types/operations-dto";

import { fetchDriverSaleById } from "./driver-pos-data-source";
import { mobileFetch } from "./mobile-fetch";

/**
 * ÉTAPE 25E/D - "5. ONLINE" / "6. OFFLINE": tries the same historical data
 * (GET /api/driver/sales/today, a thin Bearer/CORS wrapper over
 * getTodaySalesForCurrentDriver() - see that route's own doc comment) over
 * Bearer, falls back to a local reconstruction on any non-ok outcome.
 *
 * ÉTAPE 25G - "FUSION ONLINE/OFFLINE": when this succeeds (source="server"),
 * `data.sales` already IS the authoritative list of every one of today's
 * confirmed sales, including any that started offline and have since
 * synced - DriverSalesView's own default offline overlay (PENDING_SYNC
 * only, unmodified - see that component's own doc comment) is exactly what
 * must merge on top of it, so the shell deliberately does NOT override
 * `fetchOfflineSales` in this case (see DriverSalesScreen.tsx). Only the
 * offline branch below needs a custom overlay.
 */
export type ShellDriverSalesTodayResult =
  | { ok: true; source: "server"; data: DriverTodaySalesDto }
  | { ok: true; source: "cache"; data: DriverTodaySalesDto }
  | { ok: false; message: string };

export async function loadShellDriverSalesToday(params: {
  token: string | null;
  offlineContext: DriverOfflineContext;
}): Promise<ShellDriverSalesTodayResult> {
  const { token, offlineContext } = params;

  if (token) {
    const outcome = await mobileFetch<DriverTodaySalesDto>("/api/driver/sales/today", token);
    if (outcome.kind === "ok") {
      return { ok: true, source: "server", data: outcome.data };
    }
    // unauthorized/network_error/server_error - fall through to the local
    // reconstruction, same graceful degrade as the other shell data sources.
  }

  return loadOfflineSalesToday(offlineContext);
}

/**
 * ÉTAPE 25C - "JOURNÉE COMMERCIALE": businessDayRangeUtc/getCurrentBusiness-
 * DayParam (lib/business-day.ts, pure/isomorphic, unmodified) instead of a
 * reimplemented isToday() - matches the server's own 02:00->02:00
 * Africa/Casablanca boundary exactly, not a plain calendar-day comparison.
 */
export async function getTodayOfflineSales(
  offlineContext: DriverOfflineContext,
): Promise<{ day: string; sales: OfflineSaleWithLines[] }> {
  const day = getCurrentBusinessDayParam();
  const { start, end } = businessDayRangeUtc(day);
  const scope = { organizationId: offlineContext.organizationId, driverId: offlineContext.driverId };
  const allSales = await getOfflineSales(scope);
  const sales = allSales.filter((sale) => {
    const soldAt = new Date(sale.soldAt).getTime();
    return soldAt >= start.getTime() && soldAt < end.getTime();
  });
  return { day, sales };
}

/**
 * ÉTAPE 25F/G - "OFFLINE: data serveur = aucune vente -> afficher les
 * ventes locales disponibles": `sales: []` deliberately - a SaleDto cannot
 * be faithfully reconstructed from offline_sales alone (no invoiceNumber/
 * saleYear/saleNumber/stampAmount/payments[]/customer|driver|truck|tour
 * display objects - see this étape's own audit) - never invented here.
 * Every one of today's local sales (ANY SyncStatus - PENDING_SYNC/SYNCING/
 * SYNCED/SYNC_ERROR/REQUIRES_REVIEW, see ÉTAPE 25B) instead flows through
 * DriverSalesScreen's own fetchOfflineSales override, which this function's
 * sibling (getTodayOfflineSales) also feeds. `stats` here are real
 * aggregations of that same local data - not invented, just summed.
 */
async function loadOfflineSalesToday(offlineContext: DriverOfflineContext): Promise<ShellDriverSalesTodayResult> {
  const { day, sales } = await getTodayOfflineSales(offlineContext);
  return {
    ok: true,
    source: "cache",
    data: {
      day,
      sales: [],
      stats: {
        count: sales.length,
        totalTTC: addMoney(...sales.map((sale) => sale.totalTTC)),
        paidAmount: addMoney(...sales.map((sale) => sale.paidAmount)),
        creditAmount: addMoney(...sales.map((sale) => sale.creditAmount)),
      },
    },
  };
}

/**
 * ÉTAPE 25A - "3. CUSTOMER LOADER": Bearer sibling of DriverSalesView's own
 * defaultFetchCustomers. Offline, reuses the EXACT same neutral-placeholder
 * mapping already established in driver-clients-data-source.ts (never a
 * second cache, never invented fields) - only `name`/`phone` actually
 * matter to DriverSalesView (offline row customer name + WhatsApp number).
 */
export function createShellFetchCustomers(params: {
  token: string | null;
  offlineContext: DriverOfflineContext;
}): () => Promise<CustomerDto[]> {
  return async () => {
    if (params.token) {
      const outcome = await mobileFetch<{ customers: CustomerDto[] }>("/api/driver/customers", params.token);
      if (outcome.kind === "ok" && outcome.data?.customers) return outcome.data.customers;
    }
    const cached = await getCachedCustomers({
      organizationId: params.offlineContext.organizationId,
      driverId: params.offlineContext.driverId,
    });
    return cached.map((customer) => ({
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
    }));
  };
}

/**
 * ÉTAPE 25A/I - "4./9. DÉTAIL D'UNE VENTE": Bearer sibling of
 * InvoiceDetailDialog's own defaultFetchSale, reusing fetchDriverSaleById
 * (driver-pos-data-source.ts, unchanged - already used for BUG-03's ticket
 * upgrade) instead of a second implementation of the same Bearer GET
 * /api/driver/sales/[id] call.
 */
export function createShellFetchSaleDetail(
  token: string | null,
): (id: string) => Promise<InvoiceDetailFetchOutcome> {
  return async (id: string) => {
    const sale = await fetchDriverSaleById(token, id);
    if (sale) return { ok: true, sale };
    return { ok: false, message: "Impossible de charger le detail de la vente." };
  };
}
