import type { SaleDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";

/**
 * INTÉGRATION POS SHELL - "4. ONLINE": the Bearer sibling of
 * driver-pos-view.tsx's own inline `fetch("/api/driver/sales", {...})` calls
 * (validateSale/prepareInvoice). Same endpoint (app/api/driver/sales/
 * route.ts -> createDriverSale, unchanged server logic), same request body
 * shape - only the transport (absolute URL + Bearer) differs.
 */
export type CreateDriverSaleBody = {
  customerId: string | null;
  paymentMethod: string;
  paidAmount?: number;
  bankAccountingAccountId?: string | null;
  lines: Array<{ productId: string; quantity: number; discountRate: number }>;
  idempotencyKey: string;
  collectNow?: boolean;
};

export type CreateDriverSaleResult =
  | { ok: true; sale: SaleDto }
  | { ok: false; message: string };

export async function createOnlineDriverSale(
  token: string,
  body: CreateDriverSaleBody,
): Promise<CreateDriverSaleResult> {
  const outcome = await mobileFetch<{ sale?: SaleDto; message?: string }>("/api/driver/sales", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (outcome.kind === "ok" && outcome.data.sale) {
    return { ok: true, sale: outcome.data.sale };
  }
  if (outcome.kind === "unauthorized") {
    return { ok: false, message: "Session expiree. Reconnectez-vous." };
  }
  if (outcome.kind === "server_error") {
    return { ok: false, message: outcome.message };
  }
  if (outcome.kind === "network_error") {
    return { ok: false, message: outcome.message };
  }
  return { ok: false, message: "Reponse serveur incomplete." };
}
