"use client";

import * as React from "react";

import type { ClientCatalogPageDto, ClientCatalogProductDto } from "@/types/client-portal";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Espace Client catalogue state: search + category are sent to
 * GET /api/client/catalog (filtered and paginated by the server - the browser
 * never filters a full product list). The first page comes from the server
 * render; "Voir plus" appends the next page.
 */
export function useClientCatalog(firstPage: ClientCatalogPageDto) {
  const [search, setSearch] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [products, setProducts] = React.useState<ClientCatalogProductDto[]>(firstPage.products);
  const [nextCursor, setNextCursor] = React.useState<string | null>(firstPage.nextCursor);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);
  const isInitialRef = React.useRef(true);

  const fetchPage = React.useCallback(
    async (params: { q: string; categoryId: string | null; cursor: string | null }) => {
      const query = new URLSearchParams();
      if (params.q.trim()) query.set("q", params.q.trim());
      if (params.categoryId) query.set("categoryId", params.categoryId);
      if (params.cursor) query.set("cursor", params.cursor);
      const response = await fetch(`/api/client/catalog?${query.toString()}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/client/login");
        return null;
      }
      if (!response.ok) throw new Error("Impossible de charger le catalogue.");
      return (await response.json()) as ClientCatalogPageDto;
    },
    [],
  );

  // New search / category -> first page again (debounced).
  React.useEffect(() => {
    if (isInitialRef.current) {
      isInitialRef.current = false;
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchPage({ q: search, categoryId, cursor: null })
        .then((page) => {
          if (!page || requestId !== requestIdRef.current) return;
          setProducts(page.products);
          setNextCursor(page.nextCursor);
        })
        .catch((reason: unknown) => {
          if (requestId === requestIdRef.current) setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, categoryId, fetchPage]);

  const loadMore = React.useCallback(async () => {
    if (!nextCursor || loading) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const page = await fetchPage({ q: search, categoryId, cursor: nextCursor });
      if (!page || requestId !== requestIdRef.current) return;
      setProducts((current) => [...current, ...page.products]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [nextCursor, loading, fetchPage, search, categoryId]);

  return { search, setSearch, categoryId, setCategoryId, products, nextCursor, loading, error, loadMore };
}
