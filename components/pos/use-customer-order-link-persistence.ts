"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  clearCustomerOrderLink,
  linkAfterServerCheck,
  loadCustomerOrderLink,
  resolveRestoredLink,
  saveCustomerOrderLink,
  type CustomerOrderLink,
  type LinkScope,
} from "@/lib/customer-order-link-storage";

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage blocked
  }
}

/**
 * Keeps the POS cart's link to an online customer order across a page reload
 * (see lib/customer-order-link-storage.ts for the rules):
 *  - once the saved cart has been restored, a stored link is re-attached only
 *    if there is a cart and its customer is the order's customer, and (online)
 *    only if the server confirms the order can still be opened - otherwise it
 *    is dropped and the staff is told;
 *  - afterwards every change of the link is written to / removed from the
 *    storage (organisation + user isolated), so the link disappears exactly
 *    when the operation ends (resetOperation) or the staff detaches it;
 *  - a link whose cart became empty is dropped.
 * Nothing here creates a sale: the link is only sent with the normal
 * validation, and createCounterSale re-checks it atomically server-side.
 */
export function useCustomerOrderLinkPersistence(options: {
  scope: LinkScope | null;
  linked: CustomerOrderLink | null;
  setLinked: React.Dispatch<React.SetStateAction<CustomerOrderLink | null>>;
  /** The saved cart has been restored (the "ready" moment of the POS). */
  cartRestored: boolean;
  cartLineCount: number;
  selectedCustomerId: string | null;
}) {
  const { scope, linked, setLinked, cartRestored, cartLineCount, selectedCustomerId } = options;
  const [ready, setReady] = React.useState(false);
  const latestRef = React.useRef({ cartLineCount, selectedCustomerId });
  React.useEffect(() => {
    latestRef.current = { cartLineCount, selectedCustomerId };
  });

  // 1. Restore once, right after the cart was restored.
  const organizationId = scope?.organizationId ?? null;
  const userId = scope?.userId ?? null;
  React.useEffect(() => {
    if (!organizationId || !userId || !cartRestored || ready) return;
    const linkScope: LinkScope = { organizationId, userId };
    void (async () => {
      await Promise.resolve();
      const storage = browserStorage();
      const stored = loadCustomerOrderLink(storage, linkScope);
      const { link, dropReason } = resolveRestoredLink(stored, latestRef.current);
      if (stored && !link) {
        clearCustomerOrderLink(storage, linkScope);
        if (dropReason === "CUSTOMER_MISMATCH") {
          toast.warning("Le panier n'est plus lié à la commande en ligne (le client a changé).");
        }
      }
      if (link) setLinked(link);
      setReady(true);

      // Best-effort check that the order can still be opened; offline / errors keep the link.
      if (link && typeof navigator !== "undefined" && navigator.onLine !== false) {
        let answer: Parameters<typeof linkAfterServerCheck>[1];
        try {
          const response = await fetch(`/api/customer-orders/${encodeURIComponent(link.id)}/pos`, { cache: "no-store" });
          const body = (await response.json().catch(() => ({}))) as { order?: { id?: string; customer?: { id?: string } } };
          answer = { status: response.status, orderId: body.order?.id, customerId: body.order?.customer?.id };
        } catch {
          answer = "network-error";
        }
        if (linkAfterServerCheck(link, answer) === null) {
          setLinked((current) => (current?.id === link.id ? null : current));
          toast.warning(`La commande en ligne ${link.orderNumber} n'est plus disponible : le panier n'y est plus lié.`);
        }
      }
    })();
  }, [organizationId, userId, cartRestored, ready, setLinked]);

  // 2. Persist every later change (and drop a link whose cart is empty).
  React.useEffect(() => {
    if (!organizationId || !userId || !ready) return;
    const linkScope: LinkScope = { organizationId, userId };
    const timer = window.setTimeout(() => {
      if (linked && cartLineCount === 0) {
        setLinked(null);
        return;
      }
      if (linked) saveCustomerOrderLink(browserStorage(), linkScope, linked);
      else clearCustomerOrderLink(browserStorage(), linkScope);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [organizationId, userId, ready, linked, cartLineCount, setLinked]);
}
