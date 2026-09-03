import { roundCurrency } from "@/lib/utils";
import type { Purchase, PurchaseLine } from "@/types/purchase";

/**
 * Taux de TVA appliqué globalement à la facture d'achat (et non ligne par ligne,
 * conformément au fonctionnement d'une facture d'achat fournisseur classique).
 */
export const DEFAULT_PURCHASE_TVA_RATE = 20;

export function computeLineSousTotal(line: PurchaseLine): number {
  if (typeof line.totalHT === "number") return roundCurrency(line.totalHT);

  const base = line.quantite * line.prixAchat;
  const remise = base * (line.remisePercent / 100);
  return roundCurrency(base - remise);
}

export type PurchaseTotals = {
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
};

export function computePurchaseTotals(
  lignes: PurchaseLine[],
  tauxTVA: number = DEFAULT_PURCHASE_TVA_RATE,
): PurchaseTotals {
  const hasPersistedTotals = lignes.some(
    (line) =>
      typeof line.totalHT === "number" ||
      typeof line.totalTVA === "number" ||
      typeof line.totalTTC === "number",
  );

  if (hasPersistedTotals) {
    const totalHT = roundCurrency(
      lignes.reduce((sum, line) => sum + (line.totalHT ?? computeLineSousTotal(line)), 0),
    );
    const totalTVA = roundCurrency(
      lignes.reduce((sum, line) => sum + (line.totalTVA ?? 0), 0),
    );
    const totalTTC = roundCurrency(
      lignes.reduce((sum, line) => sum + (line.totalTTC ?? line.totalHT ?? 0), 0),
    );

    return {
      totalHT,
      totalTVA: totalTVA || roundCurrency(totalTTC - totalHT),
      totalTTC: totalTTC || roundCurrency(totalHT + totalTVA),
    };
  }

  const totalHT = roundCurrency(
    lignes.reduce((sum, line) => sum + computeLineSousTotal(line), 0),
  );
  const totalTVA = roundCurrency(totalHT * (tauxTVA / 100));
  const totalTTC = roundCurrency(totalHT + totalTVA);

  return { totalHT, totalTVA, totalTTC };
}

/**
 * Draft "Nouvel achat" form totals, computed TTC-first (the operator types a
 * tax-included unit price and a % discount on the TTC subtotal). HT / VAT are
 * derived per line from each product's own tax rate - mirrors the server
 * (lib/server/purchases.ts#createPurchase). Used only while typing a new
 * purchase; persisted purchases keep using computePurchaseTotals above,
 * which reads the stored HT/VAT/TTC columns.
 */
export function computeDraftPurchaseTotalsTTC(
  lines: Array<{
    quantite: number;
    prixAchatTTC: number;
    remisePercent: number;
    taxRate: number;
  }>,
): PurchaseTotals {
  let totalHT = 0;
  let totalTVA = 0;
  let totalTTC = 0;
  for (const line of lines) {
    const grossTTC = (line.quantite || 0) * (line.prixAchatTTC || 0);
    const lineTTC = roundCurrency(grossTTC * (1 - (line.remisePercent || 0) / 100));
    const lineHT = roundCurrency(lineTTC / (1 + (line.taxRate || 0) / 100));
    totalTTC += lineTTC;
    totalHT += lineHT;
    totalTVA += roundCurrency(lineTTC - lineHT);
  }
  return {
    totalHT: roundCurrency(totalHT),
    totalTVA: roundCurrency(totalTVA),
    totalTTC: roundCurrency(totalTTC),
  };
}

/** One draft purchase line's TTC subtotal (quantity x unit TTC, less % discount). */
export function computeDraftLineTotalTTC(line: {
  quantite: number;
  prixAchatTTC: number;
  remisePercent: number;
}): number {
  const grossTTC = (line.quantite || 0) * (line.prixAchatTTC || 0);
  return roundCurrency(grossTTC * (1 - (line.remisePercent || 0) / 100));
}

export function nextPurchaseNumero(existing: Purchase[]): string {
  const maxNumber = existing.reduce((max, purchase) => {
    const value = Number(purchase.numero.replace("A-", ""));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);

  return `A-${String(maxNumber + 1).padStart(6, "0")}`;
}
