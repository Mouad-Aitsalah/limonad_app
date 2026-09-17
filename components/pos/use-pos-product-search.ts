"use client";

import * as React from "react";

import type { DriverPosProductDto } from "@/types/operations-dto";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 4: the remote-search
 * request this hook needs to make, abstracted away from HOW it's actually
 * sent - a plain async function, not a fetch wrapper, so this file never has
 * to know about bases URLs, headers, or auth. `limit` is always the fixed
 * "50" this hook has always used; included here only so a caller never has
 * to guess/hardcode it independently. Must resolve to `[]` (never throw
 * upward) on any failure - the hook's own default implementation already
 * does this, and any injected replacement should match that contract so
 * `searching`/`effectiveProducts` behave identically either way.
 */
export type PosProductRemoteSearch = (params: {
  query: string;
  locationId: string;
  limit: number;
}) => Promise<DriverPosProductDto[]>;

const DEFAULT_REMOTE_SEARCH_LIMIT = 50;

/** The hook's own, unchanged-since-Phase-3 default: a same-origin, cookie-
 *  authenticated GET - exactly what every existing web call site (counter +
 *  driver POS) still gets when it doesn't pass `searchRemote`. */
const defaultSearchRemote: PosProductRemoteSearch = async ({ query, locationId, limit }) => {
  const params = new URLSearchParams({ q: query, locationId, limit: String(limit) });
  const response = await fetch(`/api/products/search?${params.toString()}`);
  if (!response.ok) return [];
  const body = (await response.json()) as { products?: DriverPosProductDto[] };
  return body.products ?? [];
};

/**
 * Phase 3 follow-up: the POS product grid (comptoir + chauffeur) preloads a
 * bounded product list for instant, zero-round-trip local search - fine for
 * the realistic case (a depot/truck stocking at most a few hundred SKUs).
 * When the context reports `truncated` (more sellable products exist at
 * this location than the preload cap could fit) and the user has typed a
 * query, this falls back to GET /api/products/search?locationId=... instead
 * of silently searching only the incomplete local list. When not truncated,
 * behavior is unchanged: the local filter alone, no network call.
 *
 * ÉTAPE 4 addition: `options.searchRemote` is an OPTIONAL override for that
 * fallback request - every other line of logic (debounce, `discovered`,
 * `allKnownProducts`, `searching`) is untouched. Omitted (both existing web
 * call sites - pos-layout.tsx, driver-pos-view.tsx), behavior is byte-for-
 * byte the same relative, cookie-authenticated fetch as before this option
 * existed. The Android shell can inject its own Bearer-authenticated
 * request here instead of forking this whole hook (see mobile/driver/src/
 * lib/use-shell-pos-product-search.ts, whose only real difference from this
 * file is precisely that one fetch call). This module still imports nothing
 * from mobile/driver/ - the injection point is a plain function type, never
 * a dependency on shell code.
 */
export function usePosProductSearch(
  products: DriverPosProductDto[],
  search: string,
  options: {
    truncated: boolean;
    locationId: string | null | undefined;
    normalize: (value: string) => string;
    searchRemote?: PosProductRemoteSearch;
  },
) {
  const { truncated, locationId, normalize, searchRemote = defaultSearchRemote } = options;
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
      searchRemote({ query: key, locationId: locationId as string, limit: DEFAULT_REMOTE_SEARCH_LIMIT })
        .then((found) => {
          if (cancelled) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locationId is stable per session; re-running on it too would just re-fire the same search. searchRemote defaults to a module-scope constant when not injected, and an injected one is expected to be stable across renders (same contract as any other callback prop).
  }, [shouldSearchRemote, trimmedSearch, searchRemote]);

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
