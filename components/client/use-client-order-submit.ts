"use client";

import * as React from "react";

import type { ClientCartLine, ClientOrderSummaryDto } from "@/types/client-portal";

export type SubmitOutcome =
  | { kind: "created"; order: ClientOrderSummaryDto }
  | { kind: "price_changed"; message: string; prices: Array<{ productId: string; priceTTC: number }> }
  | { kind: "unavailable"; message: string; productIds: string[] }
  | { kind: "error"; message: string };

/**
 * Sends the cart to POST /api/client/orders. Only {productId, quantity} per
 * line goes out (plus the total the customer saw, so a server-side price
 * change is detected instead of silently charged). One idempotency key per
 * submission attempt: a double click or a network retry returns the same
 * order; a new key is minted once an order was actually created.
 */
export function useClientOrderSubmit() {
  const [submitting, setSubmitting] = React.useState(false);
  const idempotencyKeyRef = React.useRef<string | null>(null);

  const submit = React.useCallback(
    async (cart: ClientCartLine[], expectedTotalTTC: number, note: string): Promise<SubmitOutcome> => {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      setSubmitting(true);
      try {
        const response = await fetch("/api/client/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
            note: note.trim() || undefined,
            idempotencyKey: idempotencyKeyRef.current,
            expectedTotalTTC,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
          order?: ClientOrderSummaryDto;
          prices?: Array<{ productId: string; priceTTC: number }>;
          productIds?: string[];
        };
        if (response.ok && body.order) {
          idempotencyKeyRef.current = null;
          return { kind: "created", order: body.order };
        }
        if (response.status === 401) {
          window.location.assign("/client/login");
          return { kind: "error", message: "Votre session a expiré. Reconnectez-vous." };
        }
        if (body.code === "PRICE_CHANGED" && body.prices) {
          return { kind: "price_changed", message: body.message ?? "Les prix ont changé.", prices: body.prices };
        }
        if (body.code === "PRODUCTS_UNAVAILABLE" && body.productIds) {
          return { kind: "unavailable", message: body.message ?? "Produits indisponibles.", productIds: body.productIds };
        }
        return { kind: "error", message: body.message ?? "Impossible d'envoyer la commande." };
      } catch {
        // Network failure: the same key is kept so a retry cannot create a second order.
        return { kind: "error", message: "Connexion impossible. Vérifiez votre réseau puis réessayez." };
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  return { submit, submitting };
}
