"use client";

import * as React from "react";
import { toast } from "sonner";

import type { CustomerOrderForPosDto } from "@/types/customer-order-dto";
import type { DriverPosProductDto } from "@/types/operations-dto";

/**
 * Opens an ACCEPTED online customer order (/pos?customerOrder=<id>) in the
 * POS's OWN cart - the same flow as an AI-prepared cart (use-ai-pos-draft.ts):
 *   1. GET /api/customer-orders/<id>/pos re-validates it (ACCEPTED, products
 *      still sellable - loaded explicitly even beyond the 500 preloaded -,
 *      customer still ACTIVE).
 *   2. Cart empty -> fill directly; not empty -> ask (Remplacer / Annuler).
 *   3. The cart is LINKED to the order: the normal POS validation then sends
 *      customerOrderId and createCounterSale converts the order in the same
 *      transaction as the sale. Opening it changes nothing on the server.
 */
export function useCustomerOrderPos(options: {
  orderId: string | null;
  ready: boolean;
  blockedReason: string | null;
  hasCartContent: () => boolean;
  registerProducts: (products: DriverPosProductDto[]) => void;
  fillCart: (order: CustomerOrderForPosDto) => void;
  clearParam: () => void;
}) {
  const { orderId, ready } = options;
  const latestRef = React.useRef(options);
  React.useEffect(() => {
    latestRef.current = options;
  });
  const handledRef = React.useRef<string | null>(null);
  const [pendingOrder, setPendingOrder] = React.useState<CustomerOrderForPosDto | null>(null);

  // Forget a handled link once its parameter left the URL, so opening the
  // same order again (e.g. after "Annuler") works without a page reload.
  React.useEffect(() => {
    if (!orderId) handledRef.current = null;
  }, [orderId]);

  const apply = React.useCallback((order: CustomerOrderForPosDto) => {
    latestRef.current.fillCart(order);
    toast.success(`Commande ${order.orderNumber} chargée. Vérifiez le panier puis validez la vente.`);
    if (order.unavailableProducts.length > 0) {
      toast.warning(`Retiré(s) du panier (plus disponible) : ${order.unavailableProducts.join(", ")}.`);
    }
    setPendingOrder(null);
    latestRef.current.clearParam();
  }, []);

  React.useEffect(() => {
    if (!orderId || !ready || handledRef.current === orderId) return;
    handledRef.current = orderId;
    const { blockedReason, clearParam } = latestRef.current;
    if (blockedReason) {
      toast.error(blockedReason);
      clearParam();
      return;
    }
    // No cancellation on cleanup: handledRef already guarantees one load per id.
    void (async () => {
      try {
        const response = await fetch(`/api/customer-orders/${encodeURIComponent(orderId)}/pos`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { order?: CustomerOrderForPosDto; message?: string };
        if (!response.ok || !payload.order) {
          throw new Error(payload.message ?? "Impossible d'ouvrir la commande dans le POS.");
        }
        const order = payload.order;
        if (order.lines.length === 0) {
          throw new Error("Aucun produit de cette commande n'est encore disponible à la vente.");
        }
        latestRef.current.registerProducts(order.products);
        if (latestRef.current.hasCartContent()) setPendingOrder(order);
        else apply(order);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Impossible d'ouvrir la commande dans le POS.");
        latestRef.current.clearParam();
      }
    })();
  }, [orderId, ready, apply]);

  return {
    pendingOrder,
    confirmReplace: () => {
      if (pendingOrder) apply(pendingOrder);
    },
    cancelReplace: () => {
      setPendingOrder(null);
      latestRef.current.clearParam();
      toast.message("Panier actuel conservé. La commande n'a pas été ouverte.");
    },
  };
}
