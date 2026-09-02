"use client";

import * as React from "react";

import type { ProductDto, ProductsPageDto } from "@/types/product-dto";

export type ProductsQueryFilters = {
  search?: string;
  categoryId?: string;
  status?: string;
};

const PAGE_SIZE = 25;

/**
 * Phase 3: cursor-pagination client for /produits - same forward-only-with-
 * cursor-stack pattern already proven for /stock, /chargements and /ventes
 * (see useStockMovementsPage). Adds resetToFirstPage(), used after creating
 * a product so the newly-created row (which sorts first under
 * createdAt-desc) is immediately visible, even if the admin was deep on
 * another page.
 */
export function useProductsPage(filters: ProductsQueryFilters, initial?: ProductsPageDto) {
  const [items, setItems] = React.useState<ProductDto[]>(initial?.items ?? []);
  const [totalCount, setTotalCount] = React.useState(initial?.totalCount ?? 0);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initial?.nextCursor ?? null);
  const [hasMore, setHasMore] = React.useState(initial?.hasMore ?? false);
  const [loading, setLoading] = React.useState(false);
  const cursorStackRef = React.useRef<Array<string | null>>([null]);
  const skipNextResetRef = React.useRef(Boolean(initial));

  const { search, categoryId, status } = filters;

  const fetchPage = React.useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (cursor) query.set("cursor", cursor);
        if (search) query.set("search", search);
        if (categoryId && categoryId !== "all") query.set("categoryId", categoryId);
        if (status && status !== "all") query.set("status", status);

        const response = await fetch(`/api/products/list?${query.toString()}`, { cache: "no-store" });
        const body = (await response.json()) as ProductsPageDto & { message?: string };
        if (!response.ok) return;
        setItems(body.items);
        setTotalCount(body.totalCount);
        setNextCursor(body.nextCursor);
        setHasMore(body.hasMore);
      } finally {
        setLoading(false);
      }
    },
    [search, categoryId, status],
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

  /** Re-fetches the current page in place (same cursor) - for an edit or a
   * status toggle, where the affected row is already on the visible page. */
  async function refetchCurrentPage() {
    await fetchPage(cursorStackRef.current[pageIndex]);
  }

  /** Jumps back to page 1 and re-fetches from scratch - for a newly created
   * product, which sorts first and may not be on whatever page the admin
   * was viewing. */
  async function resetToFirstPage() {
    cursorStackRef.current = [null];
    setPageIndex(0);
    await fetchPage(null);
  }

  return {
    items,
    totalCount,
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
