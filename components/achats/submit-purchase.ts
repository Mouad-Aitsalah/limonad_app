import type { Purchase, PurchaseInput } from "@/types/purchase";

/**
 * The single client-side entry point for creating a supplier purchase: maps
 * the form's PurchaseInput to the API payload and POSTs it. All the real
 * business logic (HT/TVA/TTC, payment, supplier credit, stock movements,
 * accounting, A-NNNNNN numbering) stays server-side in POST /api/purchases.
 */
export async function submitPurchase(input: PurchaseInput): Promise<Purchase> {
  const response = await fetch("/api/purchases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      date: input.date.toISOString().slice(0, 10),
      fournisseurId: input.fournisseurId,
      modeReglement: input.modeReglement,
      numeroCheque: input.numeroCheque,
      banque: input.banque,
      datePaiement: input.datePaiement?.toISOString().slice(0, 10) ?? null,
      observation: input.observation,
      lignes: input.lignes,
    }),
  });

  const payload = (await response.json()) as {
    purchase?: Purchase;
    message?: string;
  };

  if (!response.ok || !payload.purchase) {
    throw new Error(payload.message ?? "Impossible d'enregistrer l'achat.");
  }

  return payload.purchase;
}
