"use client";

import * as React from "react";

import type { DriverPosProductDto } from "@/types/operations-dto";

/**
 * The POS context only preloads POS_PRODUCT_LIST_LIMIT (500) products. A cart
 * line whose product is outside that preload (an AI-prepared cart, a cart
 * restored after a refresh, ...) used to be dropped silently by `cartLines`
 * (no product -> no line). This hook loads every such product explicitly by
 * id (GET /api/products/pos-by-ids) and hands it to `onLoaded`, which merges
 * it into the POS's known products. A product that no longer exists / is no
 * longer ACTIVE is reported through `onUnavailable` instead of vanishing.
 *
 * Each id is requested at most once (retried only after a network failure).
 */
export function useMissingCartProducts(options: {
  cartProductIds: string[];
  isKnown: (productId: string) => boolean;
  locationId: string | null | undefined;
  enabled: boolean;
  onLoaded: (products: DriverPosProductDto[]) => void;
  onUnavailable: (count: number) => void;
}) {
  const { cartProductIds, locationId, enabled } = options;
  const requestedRef = React.useRef(new Set<string>());
  const latestRef = React.useRef(options);
  React.useEffect(() => {
    latestRef.current = options;
  });

  const idsKey = cartProductIds.join(",");
  React.useEffect(() => {
    if (!enabled || !locationId || !idsKey) return;
    const { isKnown } = latestRef.current;
    const missing = [...new Set(idsKey.split(","))].filter(
      (id) => id && !isKnown(id) && !requestedRef.current.has(id),
    );
    if (missing.length === 0) return;
    for (const id of missing) requestedRef.current.add(id);

    const params = new URLSearchParams({ locationId, ids: missing.join(",") });
    fetch(`/api/products/pos-by-ids?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("pos-by-ids");
        const body = (await response.json()) as { products?: DriverPosProductDto[] };
        const products = body.products ?? [];
        if (products.length > 0) latestRef.current.onLoaded(products);
        const found = new Set(products.map((product) => product.id));
        const unavailable = missing.filter((id) => !found.has(id)).length;
        if (unavailable > 0) latestRef.current.onUnavailable(unavailable);
      })
      .catch(() => {
        // Network failure: allow a later retry for these ids.
        for (const id of missing) requestedRef.current.delete(id);
      });
  }, [idsKey, enabled, locationId]);
}
