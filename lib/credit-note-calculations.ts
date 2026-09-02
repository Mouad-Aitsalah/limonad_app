import { roundMoney } from "@/lib/money";
import { computeInvoiceTotals, computeLineTotals } from "@/lib/sales-calculations";
import type { CreditNote, CreditNoteLine, CreditNoteReason } from "@/types/credit-note";
import type { SaleInvoice, SaleInvoiceLine } from "@/types/sale";

export type CreditNoteLineComputed = CreditNoteLine & {
  productName: string;
  productReference: string;
  soldQuantity: number;
  alreadyReturnedQuantity: number;
  returnableQuantity: number;
  totalHT: number;
  taxAmount: number;
  totalTTC: number;
};

export type CreditNoteTotals = {
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  itemCount: number;
};

export const creditNoteReasonLabels: Record<CreditNoteReason, string> = {
  produit_defectueux: "Produit defectueux",
  produit_endommage: "Produit endommage",
  erreur_livraison: "Erreur de livraison",
  erreur_fournisseur: "Erreur fournisseur",
  erreur_quantite: "Erreur de quantite",
  produit_non_conforme: "Produit non conforme",
  echange_client: "Echange client",
  surplus_livraison: "Surplus de livraison",
  retour_commercial: "Retour commercial",
  produit_perime: "Produit perime",
  autre: "Autre",
};

export function computeCreditNoteLineTotals(line: CreditNoteLine) {
  const grossHT = line.unitPrice * line.quantityReturned;
  const discountAmount = grossHT * (line.discountPercent / 100);
  const totalHT = grossHT - discountAmount;
  const taxAmount = totalHT * (line.taxRate / 100);
  const totalTTC = totalHT + taxAmount;

  return { totalHT, taxAmount, totalTTC };
}

export function computeCreditNoteTotals(lines: CreditNoteLine[]): CreditNoteTotals {
  const totals = lines.reduce(
    (acc, line) => {
      const lineTotals = computeCreditNoteLineTotals(line);
      return {
        totalHT: acc.totalHT + lineTotals.totalHT,
        totalTVA: acc.totalTVA + lineTotals.taxAmount,
        totalTTC: acc.totalTTC + lineTotals.totalTTC,
        itemCount: acc.itemCount + line.quantityReturned,
      };
    },
    { totalHT: 0, totalTVA: 0, totalTTC: 0, itemCount: 0 },
  );

  return {
    // F8-B: same rounding points as before (only the final accumulated
    // totals, never the per-line intermediates) - just via the shared
    // decimal-based engine instead of `Math.round(x * 100) / 100`.
    totalHT: roundMoney(totals.totalHT),
    totalTVA: roundMoney(totals.totalTVA),
    totalTTC: roundMoney(totals.totalTTC),
    itemCount: totals.itemCount,
  };
}

export function getReturnedQuantityForInvoiceLine(
  creditNotes: CreditNote[],
  invoiceId: string,
  productId: string,
) {
  return creditNotes
    .filter(
      (note) =>
        note.invoiceId === invoiceId &&
        (note.status === "BROUILLON" || note.status === "VALIDE"),
    )
    .flatMap((note) => note.lines)
    .filter((line) => line.productId === productId)
    .reduce((sum, line) => sum + line.quantityReturned, 0);
}

export function buildReturnableLines(
  invoice: SaleInvoice,
  creditNotes: CreditNote[],
): CreditNoteLineComputed[] {
  return invoice.lignes.map((line) => {
    const alreadyReturnedQuantity = getReturnedQuantityForInvoiceLine(
      creditNotes,
      invoice.id,
      line.productId,
    );
    const quantityReturned = 0;
    const totals = computeCreditNoteLineTotals({
      productId: line.productId,
      quantityReturned,
      unitPrice: line.prixUnitaire,
      discountPercent: line.remisePercent,
      taxRate: line.tauxTVA,
    });

    return {
      productId: line.productId,
      productName: "Produit",
      productReference: line.productId,
      soldQuantity: line.quantite,
      alreadyReturnedQuantity,
      returnableQuantity: Math.max(0, line.quantite - alreadyReturnedQuantity),
      quantityReturned,
      unitPrice: line.prixUnitaire,
      discountPercent: line.remisePercent,
      taxRate: line.tauxTVA,
      totalHT: totals.totalHT,
      taxAmount: totals.taxAmount,
      totalTTC: totals.totalTTC,
    };
  });
}

export function validateCreditNoteLines(
  invoice: SaleInvoice,
  creditNotes: CreditNote[],
  lines: CreditNoteLine[],
) {
  for (const line of lines) {
    const invoiceLine = invoice.lignes.find(
      (item) => item.productId === line.productId,
    );

    if (!invoiceLine) {
      return "Un produit retourne n'existe pas dans la facture selectionnee.";
    }

    const alreadyReturnedQuantity = getReturnedQuantityForInvoiceLine(
      creditNotes,
      invoice.id,
      line.productId,
    );
    const returnableQuantity = invoiceLine.quantite - alreadyReturnedQuantity;

    if (line.quantityReturned > returnableQuantity) {
      return "La quantite retournee depasse la quantite encore retournable.";
    }

    if (line.quantityReturned < 0) {
      return "La quantite retournee doit etre positive.";
    }
  }

  if (lines.reduce((sum, line) => sum + line.quantityReturned, 0) <= 0) {
    return "Ajoutez au moins une quantite a retourner.";
  }

  return null;
}

export function resolveCreditNoteDestination(invoice: SaleInvoice) {
  if (!invoice.camionId) {
    return {
      saleOrigin: "comptoir" as const,
      destinationLocationId: "loc-main-warehouse",
      label: "Depot principal",
      tourneeClosed: true,
    };
  }

  const sessionNumber = Number(invoice.sessionId.replace("session-", ""));
  const tourneeClosed = sessionNumber % 3 !== 0;
  if (!tourneeClosed) {
    return {
      saleOrigin: "camion" as const,
      destinationLocationId: invoice.camionId,
      label: "Stock camion",
      tourneeClosed,
    };
  }

  return {
    saleOrigin: "camion" as const,
    destinationLocationId: "loc-main-warehouse",
    label: "Depot principal",
    tourneeClosed,
  };
}

export function getCreditNoteCustomerName(customerId: string) {
  return customerId;
}

export function getCreditNoteTruckLabel(truckId: string | null) {
  if (!truckId) return "Depot";
  return truckId;
}

export function getCreditNoteDestinationLabel(locationId: string) {
  return locationId;
}

export function getCreditNoteInvoiceTotals(invoice: SaleInvoice) {
  return computeInvoiceTotals(invoice);
}

export function getInvoiceLineTotal(line: SaleInvoiceLine) {
  return computeLineTotals(line);
}
