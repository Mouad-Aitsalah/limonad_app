"use client";

import * as React from "react";

import type { BusinessAccountListItem, BusinessAccountsPageDto, BusinessAccountsSummaryDto } from "@/types/business-account";

export type AccountsQueryFilters = {
  search?: string;
  type?: string;
  status?: string;
  city?: string;
};

const PAGE_SIZE = 25;

const emptySummary: BusinessAccountsSummaryDto = {
  totalCount: 0,
  customerCount: 0,
  supplierCount: 0,
  expenseCount: 0,
  treasuryCount: 0,
  employeeCount: 0,
};

/**
 * Phase 3: cursor-pagination client for /comptes - same forward-only-with-
 * cursor-stack pattern already proven for /chargements, /ventes and /stock
 * (see useStockMovementsPage). summary/cities ride along on every response
 * since they're always org-wide (unaffected by the current page/filters),
 * not paginated data of their own.
 */
export function useAccountsPage(filters: AccountsQueryFilters, initial?: BusinessAccountsPageDto) {
  const [items, setItems] = React.useState<BusinessAccountListItem[]>(initial?.items ?? []);
  const [summary, setSummary] = React.useState<BusinessAccountsSummaryDto>(initial?.summary ?? emptySummary);
  const [cities, setCities] = React.useState<string[]>(initial?.cities ?? []);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initial?.nextCursor ?? null);
  const [hasMore, setHasMore] = React.useState(initial?.hasMore ?? false);
  const [loading, setLoading] = React.useState(false);
  const cursorStackRef = React.useRef<Array<string | null>>([null]);
  const skipNextResetRef = React.useRef(Boolean(initial));

  const { search, type, status, city } = filters;

  const fetchPage = React.useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (cursor) query.set("cursor", cursor);
        if (search) query.set("search", search);
        if (type && type !== "all") query.set("type", type);
        if (status && status !== "all") query.set("status", status);
        if (city && city !== "all") query.set("city", city);

        const response = await fetch(`/api/comptes?${query.toString()}`, { cache: "no-store" });
        const body = (await response.json()) as BusinessAccountsPageDto & { message?: string };
        if (!response.ok) return;
        setItems(body.items);
        setSummary(body.summary);
        setCities(body.cities);
        setNextCursor(body.nextCursor);
        setHasMore(body.hasMore);
      } finally {
        setLoading(false);
      }
    },
    [search, type, status, city],
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

  /** Re-fetches the current page in place (same cursor) - used after an
   * account create/edit so the list refreshes without resetting the user
   * back to page 1. */
  async function refetchCurrentPage() {
    await fetchPage(cursorStackRef.current[pageIndex]);
  }

  return {
    items,
    summary,
    cities,
    pageIndex,
    refetchCurrentPage,
    hasMore,
    hasPrevious: pageIndex > 0,
    loading,
    goToNextPage,
    goToPreviousPage,
  };
}
