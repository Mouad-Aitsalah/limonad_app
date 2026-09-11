"use client";

import * as React from "react";

import type { DailyInvoicesPageDto } from "@/types/daily-invoice";

const PAGE_SIZE = 25;

export type DailyInvoicesFilters = {
  day: string;
  userIds: string[];
  paymentMethod: string;
};

/**
 * Cursor pagination for /ventes/journalieres, same forward-only + cursor
 * stack pattern as useSalesOrdersPage. The KPI block (count, CA total, CA
 * par mode) comes back with every page response but is computed server-side
 * over the WHOLE filtered day, so it stays stable while paging.
 */
export function useDailyInvoicesPage(
  filters: DailyInvoicesFilters,
  initial: DailyInvoicesPageDto,
) {
  const [data, setData] = React.useState<DailyInvoicesPageDto>(initial);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const cursorStackRef = React.useRef<Array<string | null>>([null]);
  const skipNextResetRef = React.useRef(true);

  const { day, userIds, paymentMethod } = filters;
  const userIdsKey = userIds.join(",");

  const fetchPage = React.useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), day });
        if (cursor) query.set("cursor", cursor);
        if (userIdsKey) query.set("userIds", userIdsKey);
        if (paymentMethod && paymentMethod !== "all") query.set("paymentMethod", paymentMethod);

        const response = await fetch(`/api/daily-invoices?${query.toString()}`);
        const body = (await response.json()) as DailyInvoicesPageDto & { message?: string };
        if (!response.ok) return;
        setData(body);
      } finally {
        setLoading(false);
      }
    },
    [day, userIdsKey, paymentMethod],
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

  const refetch = React.useCallback(
    () => fetchPage(cursorStackRef.current[pageIndex] ?? null),
    [fetchPage, pageIndex],
  );

  async function goToNextPage() {
    if (!data.hasMore || loading) return;
    const cursor = data.nextCursor;
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
    data,
    pageIndex,
    hasMore: data.hasMore,
    hasPrevious: pageIndex > 0,
    loading,
    goToNextPage,
    goToPreviousPage,
    refetch,
  };
}
