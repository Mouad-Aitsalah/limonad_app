"use client";

import * as React from "react";

import type { StockMovementDto, StockMovementsPageDto } from "@/types/operations-dto";

export type MovementsQueryFilters = {
  search?: string;
  productId?: string;
  locationId?: string;
  type?: string;
  referenceType?: string;
  dateFrom?: string;
  dateTo?: string;
};

const PAGE_SIZE = 25;

/**
 * Phase 3: cursor-pagination client for /stock's "Mouvements de stock"
 * table - same forward-only-with-cursor-stack pattern already proven for
 * /chargements and /ventes (see useSalesOrdersPage). Every filter change
 * resets to page 1 with a fresh cursor stack.
 */
export function useStockMovementsPage(filters: MovementsQueryFilters, initial?: StockMovementsPageDto) {
  const [items, setItems] = React.useState<StockMovementDto[]>(initial?.items ?? []);
  const [totalCount, setTotalCount] = React.useState(initial?.totalCount ?? 0);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initial?.nextCursor ?? null);
  const [hasMore, setHasMore] = React.useState(initial?.hasMore ?? false);
  const [loading, setLoading] = React.useState(false);
  const cursorStackRef = React.useRef<Array<string | null>>([null]);
  const skipNextResetRef = React.useRef(Boolean(initial));

  const { search, productId, locationId, type, referenceType, dateFrom, dateTo } = filters;

  const fetchPage = React.useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (cursor) query.set("cursor", cursor);
        if (search) query.set("search", search);
        if (productId) query.set("productId", productId);
        if (locationId) query.set("locationId", locationId);
        if (type && type !== "all") query.set("type", type);
        if (referenceType) query.set("referenceType", referenceType);
        if (dateFrom) query.set("dateFrom", dateFrom);
        if (dateTo) query.set("dateTo", dateTo);

        const response = await fetch(`/api/stock/movements?${query.toString()}`);
        const body = (await response.json()) as StockMovementsPageDto & { message?: string };
        if (!response.ok) return;
        setItems(body.items);
        setTotalCount(body.totalCount);
        setNextCursor(body.nextCursor);
        setHasMore(body.hasMore);
      } finally {
        setLoading(false);
      }
    },
    [search, productId, locationId, type, referenceType, dateFrom, dateTo],
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

  /** Re-fetches the current page in place (same cursor) - for callers like
   * a just-completed stock adjustment that need fresh data without
   * resetting the user back to page 1. */
  async function refetchCurrentPage() {
    await fetchPage(cursorStackRef.current[pageIndex]);
  }

  return {
    items,
    totalCount,
    pageIndex,
    refetchCurrentPage,
    hasMore,
    hasPrevious: pageIndex > 0,
    loading,
    goToNextPage,
    goToPreviousPage,
  };
}
