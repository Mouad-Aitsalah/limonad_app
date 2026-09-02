"use client";

import * as React from "react";

import type { ProductDto } from "@/types/product-dto";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Phase 3 adversarial audit, CRITICAL #1 fix: shared search behavior for
 * every product picker that used to receive the entire, unbounded
 * getProducts() catalog (avoirs, chargements, inventaire, stock, achats -
 * see getProducts()'s doc comment in lib/server/products.ts for the measured
 * 12.5s/56MB finding). Modeled directly on the POS product/customer
 * pickers' already-proven pattern (usePosProductSearch, CustomerCombobox):
 * a small bounded `preload` is shown until the user types, then
 * GET /api/products/search (debounced) takes over - never more than a
 * handful of products in the browser at once, regardless of catalog size.
 *
 * `discovered` accumulates every product ever returned by a remote search
 * this session, keyed by id, so a product picked from search results stays
 * resolvable (`allKnownProducts`) even after the search term changes or is
 * cleared - the same requirement the POS cart/panier already had.
 */
export function useProductPickerSearch(
  preload: ProductDto[],
  query: string,
  options?: { supplierId?: string; limit?: number },
) {
  const supplierId = options?.supplierId;
  const limit = options?.limit;
  // Keyed by the exact search term it answers, so a stale result from a
  // previous term is never shown as if it matched the current one.
  const [remoteState, setRemoteState] = React.useState<{
    key: string;
    results: ProductDto[];
  } | null>(null);
  const [discovered, setDiscovered] = React.useState<Map<string, ProductDto>>(new Map());
  const trimmedQuery = query.trim();

  React.useEffect(() => {
    if (!trimmedQuery) return;
    let cancelled = false;
    const key = trimmedQuery;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: key });
      if (limit) params.set("limit", String(limit));
      if (supplierId) params.set("supplierId", supplierId);
      fetch(`/api/products/search?${params.toString()}`)
        .then((response) => (response.ok ? response.json() : { products: [] }))
        .then((body: { products?: ProductDto[] }) => {
          if (cancelled) return;
          const found = body.products ?? [];
          setRemoteState({ key, results: found });
          if (found.length > 0) {
            setDiscovered((current) => {
              const next = new Map(current);
              for (const product of found) next.set(product.id, product);
              return next;
            });
          }
        })
        .catch(() => {
          if (!cancelled) setRemoteState({ key, results: [] });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supplierId/limit are stable per screen; re-running on them too would just re-fire the same search.
  }, [trimmedQuery]);

  const results =
    trimmedQuery.length > 0
      ? remoteState?.key === trimmedQuery
        ? remoteState.results
        : []
      : preload;

  // Preloaded products plus every product ever discovered via remote search
  // - use this (not `preload`) to resolve any id -> product lookup a caller
  // still needs (e.g. a just-picked product's price for a default field).
  const allKnownProducts = React.useMemo(() => {
    if (discovered.size === 0) return preload;
    const known = new Map(preload.map((product) => [product.id, product]));
    for (const product of discovered.values()) {
      if (!known.has(product.id)) known.set(product.id, product);
    }
    return Array.from(known.values());
  }, [preload, discovered]);

  // Derived, not tracked state: true exactly while a remote search is
  // relevant but its result hasn't arrived for the current search term yet.
  const searching = trimmedQuery.length > 0 && remoteState?.key !== trimmedQuery;

  // A barcode scanner types the full code then sends Enter immediately -
  // far faster than the 300ms debounce above, so the debounced `results`
  // usually hasn't arrived yet when Enter fires. This bypasses the
  // debounce entirely for that one moment: an immediate, uncached search
  // call, resolved to a product only if it's an exact barcode or reference
  // match (same rule the old client-side resolveExactMatch used over the
  // full catalog) - never a loose "first result wins".
  const resolveExact = React.useCallback(
    async (rawQuery: string): Promise<ProductDto | null> => {
      const value = rawQuery.trim();
      if (!value) return null;
      const alreadyKnown = [...discovered.values(), ...preload].find(
        (product) => product.barcode === value || product.reference === value,
      );
      if (alreadyKnown) return alreadyKnown;
      const params = new URLSearchParams({ q: value, limit: "5" });
      if (limit) params.set("limit", String(limit));
      if (supplierId) params.set("supplierId", supplierId);
      try {
        const response = await fetch(`/api/products/search?${params.toString()}`);
        if (!response.ok) return null;
        const body = (await response.json()) as { products?: ProductDto[] };
        const found = body.products ?? [];
        if (found.length > 0) {
          setDiscovered((current) => {
            const next = new Map(current);
            for (const product of found) next.set(product.id, product);
            return next;
          });
        }
        const normalized = value.toLowerCase();
        return (
          found.find(
            (product) =>
              (product.barcode ?? "").toLowerCase() === normalized ||
              product.reference.toLowerCase() === normalized,
          ) ?? null
        );
      } catch {
        return null;
      }
    },
    [discovered, preload, limit, supplierId],
  );

  return { results, allKnownProducts, searching, resolveExact };
}
