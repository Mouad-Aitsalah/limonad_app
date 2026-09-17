"use client";

import * as React from "react";

import type { CustomerDto, DriverCustomersPageDto } from "@/types/operations-dto";

export type DriverCustomersQueryFilters = {
  search?: string;
};

const PAGE_SIZE = 25;

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 21: the page-fetch request
 * this hook needs, abstracted away from HOW it's actually sent - a plain
 * async function, not a fetch wrapper, same pattern already established for
 * usePosProductSearch/CustomerNumberInput/MobileCustomerPicker. `null`
 * return means "this attempt produced nothing usable" (never throws) - the
 * caller then simply leaves whatever page is already showing untouched,
 * exactly like the previous inline `if (!response.ok) return;` did.
 */
export type DriverCustomersFetchPage = (params: {
  cursor: string | null;
  pageSize: number;
  search?: string;
}) => Promise<DriverCustomersPageDto | null>;

/** The hook's own, unchanged-since-always default: a same-origin, cookie-
 *  authenticated GET - exactly what every existing web call site (only
 *  DriverClientsView today) still gets when it doesn't pass `fetchPageImpl`. */
const defaultFetchPage: DriverCustomersFetchPage = async ({ cursor, pageSize, search }) => {
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (cursor) query.set("cursor", cursor);
  if (search) query.set("search", search);

  const response = await fetch(`/api/driver/customers/list?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as DriverCustomersPageDto;
};

/**
 * CRITICAL #2 follow-up: cursor-pagination client for /driver/clients, same
 * forward-only-with-cursor-stack pattern as useProductsPage (/produits) -
 * see getDriverCustomersPage's doc comment in lib/server/driver-customers.ts.
 *
 * ÉTAPE 21 - `fetchPageImpl`, omitted (every existing web call site), keeps
 * today's exact same-origin fetch. The Android shell can inject its own
 * online-Bearer-then-offline-cache implementation (see mobile/driver/src/lib/
 * driver-clients-data-source.ts) without this file needing to know anything
 * about SQLite/Capacitor - it only ever sees a plain function.
 */
export function useDriverCustomersPage(
  filters: DriverCustomersQueryFilters,
  initial?: DriverCustomersPageDto,
  fetchPageImpl: DriverCustomersFetchPage = defaultFetchPage,
) {
  const [items, setItems] = React.useState<CustomerDto[]>(initial?.items ?? []);
  const [totalCount, setTotalCount] = React.useState(initial?.totalCount ?? 0);
  const [totalAccessibleCustomers, setTotalAccessibleCustomers] = React.useState(
    initial?.totalAccessibleCustomers ?? 0,
  );
  const [activeCount, setActiveCount] = React.useState(initial?.activeCount ?? 0);
  const [blockedCount, setBlockedCount] = React.useState(initial?.blockedCount ?? 0);
  const [ownCreatedCount, setOwnCreatedCount] = React.useState(initial?.ownCreatedCount ?? 0);
  const [guaranteedCustomer, setGuaranteedCustomer] = React.useState<CustomerDto | null>(
    initial?.guaranteedCustomer ?? null,
  );
  const [pageIndex, setPageIndex] = React.useState(0);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initial?.nextCursor ?? null);
  const [hasMore, setHasMore] = React.useState(initial?.hasMore ?? false);
  const [loading, setLoading] = React.useState(false);
  const cursorStackRef = React.useRef<Array<string | null>>([null]);
  const skipNextResetRef = React.useRef(Boolean(initial));

  const { search } = filters;

  const fetchPage = React.useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const body = await fetchPageImpl({ cursor, pageSize: PAGE_SIZE, search: search || undefined });
        if (!body) return;
        setItems(body.items);
        setTotalCount(body.totalCount);
        setTotalAccessibleCustomers(body.totalAccessibleCustomers);
        setActiveCount(body.activeCount);
        setBlockedCount(body.blockedCount);
        setOwnCreatedCount(body.ownCreatedCount);
        setGuaranteedCustomer(body.guaranteedCustomer);
        setNextCursor(body.nextCursor);
        setHasMore(body.hasMore);
      } finally {
        setLoading(false);
      }
    },
    [search, fetchPageImpl],
  );

  React.useEffect(() => {
    if (skipNextResetRef.current) {
      skipNextResetRef.current = false;
      return;
    }
    cursorStackRef.current = [null];
    setPageIndex(0);
    void fetchPage(null);
  }, [fetchPage]);

  async function goToNextPage() {
    if (!hasMore || loading) return;
    const cursor = nextCursor;
    await fetchPage(cursor);
    cursorStackRef.current = [...cursorStackRef.current, cursor];
    setPageIndex((current) => current + 1);
  }

  async function goToPreviousPage() {
    if (pageIndex === 0 || loading) return;
    const previousIndex = pageIndex - 1;
    await fetchPage(cursorStackRef.current[previousIndex]);
    cursorStackRef.current = cursorStackRef.current.slice(0, previousIndex + 1);
    setPageIndex(previousIndex);
  }

  /** Re-fetches the current page in place - for an edit, where the affected
   * row is already on the visible page. */
  async function refetchCurrentPage() {
    await fetchPage(cursorStackRef.current[pageIndex]);
  }

  /** Jumps back to page 1 - for a newly created customer, which sorts first
   * under createdAt-desc and may not be on whatever page was open. */
  async function resetToFirstPage() {
    cursorStackRef.current = [null];
    setPageIndex(0);
    await fetchPage(null);
  }

  return {
    items,
    totalCount,
    totalAccessibleCustomers,
    activeCount,
    blockedCount,
    ownCreatedCount,
    guaranteedCustomer,
    pageIndex,
    refetchCurrentPage,
    resetToFirstPage,
    hasMore,
    hasPrevious: pageIndex > 0,
    loading,
    goToNextPage,
    goToPreviousPage,
  };
}
