"use client";

import * as React from "react";

import type { DriverPosProductDto } from "@/types/operations-dto";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Phase 3 follow-up: the POS product grid (comptoir + chauffeur) preloads a
 * bounded product list for instant, zero-round-trip local search - fine for
 * the realistic case (a depot/truck stocking at most a few hundred SKUs).
 * When the context reports `truncated` (more sellable products exist at
 * this location than the preload cap could fit) and the user has typed a
 * query, this falls back to GET /api/products/search?locationId=... instead
 * of silently searching only the incomplete local list. When not truncated,
 * behavior is unchanged: the local filter alone, no network call.
 */
export function usePosProductSearch(
  products: DriverPosProductDto[],
  search: string,
  options: {
    truncated: boolean;
    locationId: string | null | undefined;
    normalize: (value: string) => string;
  },
) {
  const { truncated, locationId, normalize } = options;
  // Keyed by the exact search term it answers, so a stale result from a
  // previous term is never shown as if it matched the current one - avoids
  // needing to synchronously reset state in the effect below when the
  // search is cleared or truncation stops applying.
  const [remoteState, setRemoteState] = React.useState<{
    key: string;
    results: DriverPosProductDto[];
  } | null>(null);
  // Every product ever returned by a remote search this session, keyed by
  // id - once a remotely-found product is added to the cart it must stay
  // resolvable even after the search term changes or is cleared, otherwise
  // cart totals/checkout would silently break for it.
  const [discovered, setDiscovered] = React.useState<Map<string, DriverPosProductDto>>(new Map());
  const trimmedSearch = search.trim();
  const shouldSearchRemote = truncated && Boolean(locationId) && trimmedSearch.length > 0;

  React.useEffect(() => {
    if (!shouldSearchRemote) return;
    let cancelled = false;
    const key = trimmedSearch;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ q: key, locationId: locationId as string, limit: "50" });
      fetch(`/api/products/search?${query.toString()}`)
        .then((response) => (response.ok ? response.json() : { products: [] }))
        .then((body: { products?: DriverPosProductDto[] }) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locationId is stable per session; re-running on it too would just re-fire the same search.
  }, [shouldSearchRemote, trimmedSearch]);

  const localFiltered = React.useMemo(() => {
    if (!trimmedSearch) return products;
    const query = normalize(search);
    return products.filter((product) =>
      normalize(`${product.name} ${product.reference} ${product.barcode ?? ""}`).includes(query),
    );
  }, [products, search, trimmedSearch, normalize]);

  const remoteResultsForCurrentSearch =
    shouldSearchRemote && remoteState?.key === trimmedSearch ? remoteState.results : null;
  const effectiveProducts =
    remoteResultsForCurrentSearch !== null ? remoteResultsForCurrentSearch : localFiltered;

  // Preloaded products plus every product ever discovered via remote
  // search - use this (not `products`) to build any id -> product lookup
  // that the cart resolves against.
  const allKnownProducts = React.useMemo(() => {
    if (discovered.size === 0) return products;
    const known = new Map(products.map((product) => [product.id, product]));
    for (const product of discovered.values()) {
      if (!known.has(product.id)) known.set(product.id, product);
    }
    return Array.from(known.values());
  }, [products, discovered]);

  // Derived, not tracked state: true exactly while a remote search is
  // relevant but its result hasn't arrived for the current search term yet.
  const searching = shouldSearchRemote && remoteState?.key !== trimmedSearch;

  return { products: effectiveProducts, allKnownProducts, searching };
}
