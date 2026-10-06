import { REAL_SALE_STATUSES } from "@/lib/forecasting/product-daily-sales";

/**
 * Commercial stops of a tour (/trajets): the customers where at least one REAL
 * sale was recorded during the tour, numbered 1..N in the order of their FIRST
 * real sale.
 *
 *  - Real sale: the ERP-wide perimeter REAL_SALE_STATUSES (VALIDATED,
 *    PARTIALLY_PAID, PAID, CREDIT, CREDIT_NOTED - the same list as the BI and
 *    the forecasts). DRAFT (prepared, not collected) and CANCELLED never get a
 *    number.
 *  - The number belongs to the DISTINCT customer, not to each sale: a second
 *    sale at the same customer does not consume a new number.
 *  - Commercial moment of a sale: soldAt (real moment of an offline driver sale,
 *    synced later) ?? createdAt. Ties are broken by createdAt, then by id, so
 *    the order never depends on the order of the input array.
 *  - A sale without customerId gets no number (no fake customer is created).
 *  - The GPS / coordinates play no role: a customer without coordinates keeps
 *    its number (it simply has no marker on the map).
 *
 * Pure and framework-free: computed in memory from the sales already loaded
 * with the tour (one query, no query per customer), unit-tested without a
 * database.
 */

export type CommercialSaleInput = {
  id: string;
  customerId: string | null;
  status: string;
  soldAt: Date | string | null;
  createdAt: Date | string;
  /** When given, only the sales of this tour are taken (defensive scoping). */
  tourId?: string | null;
};

export type CommercialStop = {
  customerId: string;
  /** 1..N in the order of the first real sale of each distinct customer. */
  commercialStopNumber: number;
  /** ISO timestamp of the customer's first real sale (soldAt ?? createdAt). */
  firstSaleAt: string;
};

export type FirstSale = {
  customerId: string;
  firstSaleAt: string;
};

const REAL_STATUSES: ReadonlySet<string> = new Set(REAL_SALE_STATUSES);

export function isRealSaleStatus(status: string): boolean {
  return REAL_STATUSES.has(status);
}

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

type Ranked = { sale: CommercialSaleInput; momentMs: number; createdMs: number };

/** Deterministic chronological order: commercial moment, then createdAt, then id. */
function compareRanked(left: Ranked, right: Ranked): number {
  if (left.momentMs !== right.momentMs) return left.momentMs - right.momentMs;
  if (left.createdMs !== right.createdMs) return left.createdMs - right.createdMs;
  if (left.sale.id < right.sale.id) return -1;
  if (left.sale.id > right.sale.id) return 1;
  return 0;
}

/**
 * First sale (by the rule above) of each customer, among the sales accepted by
 * `accept`, in chronological order of that first sale.
 */
export function firstSalesByCustomer(
  sales: readonly CommercialSaleInput[],
  accept: (sale: CommercialSaleInput) => boolean,
  options: { tourId?: string } = {},
): FirstSale[] {
  const firstByCustomer = new Map<string, Ranked>();

  for (const sale of sales) {
    if (!sale.customerId) continue;
    if (options.tourId !== undefined && sale.tourId !== undefined && sale.tourId !== options.tourId) continue;
    if (!accept(sale)) continue;

    const createdMs = toMs(sale.createdAt);
    const momentMs = sale.soldAt ? toMs(sale.soldAt) : createdMs;
    if (!Number.isFinite(momentMs) || !Number.isFinite(createdMs)) continue;

    const candidate: Ranked = { sale, momentMs, createdMs };
    const current = firstByCustomer.get(sale.customerId);
    if (!current || compareRanked(candidate, current) < 0) {
      firstByCustomer.set(sale.customerId, candidate);
    }
  }

  return [...firstByCustomer.values()]
    .sort(compareRanked)
    .map((ranked) => ({
      customerId: ranked.sale.customerId as string,
      firstSaleAt: new Date(ranked.momentMs).toISOString(),
    }));
}

/** The numbered commercial stops of a tour, keyed by customerId. */
export function computeCommercialStops(
  sales: readonly CommercialSaleInput[],
  options: { tourId?: string } = {},
): Map<string, CommercialStop> {
  const stops = new Map<string, CommercialStop>();
  firstSalesByCustomer(sales, (sale) => isRealSaleStatus(sale.status), options).forEach(
    (first, index) => {
      stops.set(first.customerId, {
        customerId: first.customerId,
        commercialStopNumber: index + 1,
        firstSaleAt: first.firstSaleAt,
      });
    },
  );
  return stops;
}
