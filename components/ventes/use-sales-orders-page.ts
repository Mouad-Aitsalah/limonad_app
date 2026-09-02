"use client";

import * as React from "react";

import type { SaleHistoryListItemDto, SaleHistoryOrdersPageDto } from "@/types/operations-dto";

export type OrdersQueryFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  posSessionId?: string;
};

const PAGE_SIZE = 25;

/**
 * Phase 3: shared cursor-pagination client for /ventes's Commandes list and
 * the session/month drilldown dialogs (both now backed by the same
 * GET /api/sales-history) - forward-only with a cursor stack for
 * "Precedent" (pop back to an already-known cursor), the same pattern
 * already proven for /chargements's history pagination. Every filter
 * change resets to page 1 with a fresh cursor stack.
 */
export function useSalesOrdersPage(
  filters: OrdersQueryFilters,
  initial?: SaleHistoryOrdersPageDto,
  enabled = true,
) {
  const [items, setItems] = React.useState<SaleHistoryListItemDto[]>(initial?.items ?? []);
  const [totalCount, setTotalCount] = React.useState(initial?.totalCount ?? 0);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initial?.nextCursor ?? null);
  const [hasMore, setHasMore] = React.useState(initial?.hasMore ?? false);
  const [loading, setLoading] = React.useState(false);
  const cursorStackRef = React.useRef<Array<string | null>>([null]);
  const skipNextResetRef = React.useRef(Boolean(initial));

  const { search, dateFrom, dateTo, paymentMethod, posSessionId } = filters;

  const fetchPage = React.useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (cursor) query.set("cursor", cursor);
        if (search) query.set("search", search);
        if (dateFrom) query.set("dateFrom", dateFrom);
        if (dateTo) query.set("dateTo", dateTo);
        if (paymentMethod && paymentMethod !== "all") query.set("paymentMethod", paymentMethod);
        if (posSessionId) query.set("posSessionId", posSessionId);

        const response = await fetch(`/api/sales-history?${query.toString()}`);
        const body = (await response.json()) as SaleHistoryOrdersPageDto & { message?: string };
        if (!response.ok) return;
        setItems(body.items);
        setTotalCount(body.totalCount);
        setNextCursor(body.nextCursor);
        setHasMore(body.hasMore);
      } finally {
        setLoading(false);
      }
    },
    [search, dateFrom, dateTo, paymentMethod, posSessionId],
  );

  React.useEffect(() => {
    if (!enabled) return;
    if (skipNextResetRef.current) {
      skipNextResetRef.current = false;
      return;
    }
    cursorStackRef.current = [null];
    setPageIndex(0);
    void fetchPage(null);
  }, [enabled, fetchPage]);

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

  return {
    items,
    totalCount,
    pageIndex,
    hasMore,
    hasPrevious: pageIndex > 0,
    loading,
    goToNextPage,
    goToPreviousPage,
  };
}
