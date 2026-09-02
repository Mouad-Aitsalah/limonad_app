"use client";

import * as React from "react";

import type { CustomerDto, DriverCustomersPageDto } from "@/types/operations-dto";

export type DriverCustomersQueryFilters = {
  search?: string;
};

const PAGE_SIZE = 25;

/**
 * CRITICAL #2 follow-up: cursor-pagination client for /driver/clients, same
 * forward-only-with-cursor-stack pattern as useProductsPage (/produits) -
 * see getDriverCustomersPage's doc comment in lib/server/driver-customers.ts.
 */
export function useDriverCustomersPage(
  filters: DriverCustomersQueryFilters,
  initial?: DriverCustomersPageDto,
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
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (cursor) query.set("cursor", cursor);
        if (search) query.set("search", search);

        const response = await fetch(`/api/driver/customers/list?${query.toString()}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as DriverCustomersPageDto & { message?: string };
        if (!response.ok) return;
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
    [search],
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
