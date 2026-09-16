import * as React from "react";

import type { DriverPosProductDto } from "@/types/operations-dto";

import { apiUrl } from "./api-base";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * INTÉGRATION POS SHELL - Bearer/absolute-URL fork of components/pos/use-
 * pos-product-search.ts. Forked (not imported) only because that hook's
 * remote-search fallback is a bare relative `fetch("/api/products/search")`
 * with no way to inject a base URL/Authorization header from outside -
 * every other line of logic here is unchanged from the original.
 */
export function useShellPosProductSearch(
  token: string | null,
  products: DriverPosProductDto[],
  search: string,
  options: {
    truncated: boolean;
    locationId: string | null | undefined;
    normalize: (value: string) => string;
  },
) {
  const { truncated, locationId, normalize } = options;
  const [remoteState, setRemoteState] = React.useState<{
    key: string;
    results: DriverPosProductDto[];
  } | null>(null);
  const [discovered, setDiscovered] = React.useState<Map<string, DriverPosProductDto>>(new Map());
  const trimmedSearch = search.trim();
  const shouldSearchRemote = truncated && Boolean(locationId) && Boolean(token) && trimmedSearch.length > 0;

  React.useEffect(() => {
    if (!shouldSearchRemote || !token) return;
    let cancelled = false;
    const key = trimmedSearch;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ q: key, locationId: locationId as string, limit: "50" });
      fetch(apiUrl(`/api/products/search?${query.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      })
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
  }, [shouldSearchRemote, trimmedSearch, token, locationId]);

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

  const allKnownProducts = React.useMemo(() => {
    if (discovered.size === 0) return products;
    const known = new Map(products.map((product) => [product.id, product]));
    for (const product of discovered.values()) {
      if (!known.has(product.id)) known.set(product.id, product);
    }
    return Array.from(known.values());
  }, [products, discovered]);

  const searching = shouldSearchRemote && remoteState?.key !== trimmedSearch;

  return { products: effectiveProducts, allKnownProducts, searching };
}
