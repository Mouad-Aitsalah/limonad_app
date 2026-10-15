"use client";

import * as React from "react";

import type { ClientCartLine, ClientOrderSummaryDto } from "@/types/client-portal";

export type SubmitOutcome =
  | { kind: "created"; order: ClientOrderSummaryDto }
  | { kind: "unavailable"; message: string; productIds: string[] }
  | { kind: "busy" }
  | { kind: "error"; message: string };

/** The body of POST /api/client/orders: the products and quantities only - never a price or a total. */
export function buildClientOrderBody(cart: ClientCartLine[], note: string, idempotencyKey: string) {
  return {
    lines: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    note: note.trim() || undefined,
    idempotencyKey,
  };
}

/**
 * Sends the cart to POST /api/client/orders. Only {productId, quantity} per
 * line goes out: the server prices the order from the database. One
 * idempotency key per submission attempt: a double click, a second tap while
 * the first request runs, or a network retry returns the same order; a new
 * key is minted once an order was actually created.
 */
export function useClientOrderSubmit() {
  const [submitting, setSubmitting] = React.useState(false);
  const idempotencyKeyRef = React.useRef<string | null>(null);
  // Synchronous guard: a second tap in the same tick never starts a second request.
  const inFlightRef = React.useRef(false);

  const submit = React.useCallback(async (cart: ClientCartLine[], note: string): Promise<SubmitOutcome> => {
    if (inFlightRef.current) return { kind: "busy" };
    inFlightRef.current = true;
    idempotencyKeyRef.current ??= crypto.randomUUID();
    setSubmitting(true);
    try {
      const response = await fetch("/api/client/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildClientOrderBody(cart, note, idempotencyKeyRef.current)),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        order?: ClientOrderSummaryDto;
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
      if (body.code === "PRODUCTS_UNAVAILABLE" && body.productIds) {
        return { kind: "unavailable", message: body.message ?? "Produits indisponibles.", productIds: body.productIds };
      }
      return { kind: "error", message: body.message ?? "Impossible d'envoyer la commande." };
    } catch {
      // Network failure: the same key is kept so a retry cannot create a second order.
      return { kind: "error", message: "Connexion impossible. Vérifiez votre réseau puis réessayez." };
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting };
}
