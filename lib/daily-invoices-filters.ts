/**
 * The filters of « Factures journalières » and of its « Regroupement des ventes »
 * page - ONE representation for both (the URL query), read by the server with
 * lib/server/daily-invoices.ts dailyParamsFromSearchParams, so the two pages
 * always cover the same invoices and the « Retour » link keeps the filters.
 * Pure and isomorphic (client and server).
 *
 *   ?day=YYYY-MM-DD&userIds=<id>,<id>&paymentMethod=<PaymentMethod>
 *   absent values = the defaults: current business day, every user, every method.
 */

export const DAILY_INVOICES_PATH = "/ventes/journalieres";
export const DAILY_SALES_GROUPING_PATH = "/ventes/journalieres/regroupement";

/** Same value set as the « Mode de règlement » filter (PaymentMethod enum). */
export const DAILY_PAYMENT_METHODS = ["CASH", "CARD", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"] as const;

export type DailyInvoicesFilters = {
  day: string;
  userIds: string[];
  /** A PaymentMethod value, or "all". */
  paymentMethod: string;
};

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

/** The parameters the server reads (GET /api/daily-invoices, its sales grouping and both pages). */
export type DailyInvoicesQueryParams = {
  /** Business day "YYYY-MM-DD"; defaults to the current one (02:00 cutoff). */
  day?: string;
  cursor?: string | null;
  pageSize?: number;
  /** OR filter on Sale.createdByUserId. Empty = all users. */
  userIds?: string[];
  /** Exact Sale.paymentMethod; anything else = all methods. */
  paymentMethod?: string;
};

/** The query parameters of the daily invoices routes and pages - one parser for all of them. */
export function dailyParamsFromSearchParams(searchParams: URLSearchParams): DailyInvoicesQueryParams {
  const pageSizeParam = searchParams.get("pageSize");
  const userIdsParam = searchParams.get("userIds");
  return {
    day: searchParams.get("day") || undefined,
    cursor: searchParams.get("cursor") || undefined,
    pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
    userIds: userIdsParam
      ? userIdsParam.split(",").map((value) => value.trim()).filter(Boolean)
      : undefined,
    paymentMethod: searchParams.get("paymentMethod") || undefined,
  };
}

function read(params: SearchParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** A Next page's `searchParams` (or any query) as URLSearchParams - first value of a repeated key. */
export function toURLSearchParams(params: SearchParamsLike): URLSearchParams {
  if (params instanceof URLSearchParams) return params;
  const result = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const value = read(params, key);
    if (value !== undefined) result.set(key, value);
  }
  return result;
}

/** The filters carried by a query; `day` is resolved by the caller (the server answers with the day it used). */
export function dailyFiltersFromQuery(params: SearchParamsLike, day: string): DailyInvoicesFilters {
  const userIds = [...new Set((read(params, "userIds") ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  const method = read(params, "paymentMethod") ?? "";
  return {
    day,
    userIds,
    paymentMethod: (DAILY_PAYMENT_METHODS as readonly string[]).includes(method) ? method : "all",
  };
}

/** The query of a set of filters (only the non-default parts beyond the day). */
export function dailyFiltersToQuery({ day, userIds, paymentMethod }: DailyInvoicesFilters): string {
  const query = new URLSearchParams();
  if (day) query.set("day", day);
  if (userIds.length) query.set("userIds", userIds.join(","));
  if (paymentMethod && paymentMethod !== "all") query.set("paymentMethod", paymentMethod);
  return query.toString();
}

const withQuery = (path: string, filters: DailyInvoicesFilters) => {
  const query = dailyFiltersToQuery(filters);
  return query ? `${path}?${query}` : path;
};

/** « Regroupement des ventes » with the filters of the daily invoices page. */
export const dailySalesGroupingHref = (filters: DailyInvoicesFilters) => withQuery(DAILY_SALES_GROUPING_PATH, filters);

/** « Retour aux factures journalières » with the filters of the grouping page. */
export const dailyInvoicesHref = (filters: DailyInvoicesFilters) => withQuery(DAILY_INVOICES_PATH, filters);
