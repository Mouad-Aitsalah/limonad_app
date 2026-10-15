import { roundMoney } from "@/lib/money";
import type { CartLineComputed, CartTotals } from "@/components/pos/pos-layout";
import type {
  CreateCreditNoteInput,
  CreditNotePartyType,
  CreditNoteReason,
} from "@/types/credit-note";
import type { PosProduct } from "@/types/pos";
import type { ProductDto } from "@/types/product-dto";

/**
 * Pure rules of the credit note (« avoir ») screen built on the POS blocks - no React, no fetch, so they can
 * be tested without a browser. The screen (components/credit-notes/credit-note-pos-screen.tsx) only wires
 * them to the shared POS components (product grid, cart table, summary).
 *
 * An avoir is NOT a sale: the cart lines are returned goods priced at the product's catalogue price (sale
 * price for a customer, purchase price for a supplier), the total is an amount to REFUND, and the payload
 * goes to the credit note service (/api/credit-notes/manual), never to the sales one.
 */

export type CreditPosLine = {
  productId: string;
  productName: string;
  productReference: string;
  productUnit: string;
  quantityReturned: number;
  /** Unit price HT (what the credit note line stores). */
  unitPrice: number;
  taxRate: number;
};

export type CreditPosTotals = { totalHT: number; taxAmount: number; totalTTC: number };

/** « Mode de règlement » shown for every avoir created from this screen. */
export const CREDIT_NOTE_PAYMENT_MODE_LABEL = "Rembourser";

/** A customer avoir is a cash refund out of the till (CASH); this is the only mode the screen offers. */
export const CREDIT_NOTE_POS_REFUND_MODE = "remboursement_especes" as const;

export const CREDIT_NOTE_JUSTIFICATION_MIN_LENGTH = 5;

export const clientReasonOptions: CreditNoteReason[] = [
  "produit_defectueux",
  "produit_endommage",
  "erreur_livraison",
  "erreur_quantite",
  "produit_non_conforme",
  "echange_client",
  "retour_commercial",
  "autre",
];

export const supplierReasonOptions: CreditNoteReason[] = [
  "produit_defectueux",
  "produit_endommage",
  "erreur_fournisseur",
  "produit_non_conforme",
  "surplus_livraison",
  "retour_commercial",
  "produit_perime",
  "autre",
];

export function defaultReasonFor(party: CreditNotePartyType): CreditNoteReason {
  return party === "client" ? "retour_commercial" : "produit_defectueux";
}

/** Unit price HT a returned product starts at: the sale price for a customer, the purchase price for a supplier. */
export function creditUnitPriceFor(product: ProductDto, party: CreditNotePartyType): number {
  return party === "client" ? product.salePrice : product.purchasePrice;
}

export function productToCreditLine(product: ProductDto, party: CreditNotePartyType): CreditPosLine {
  return {
    productId: product.id,
    productName: product.name,
    productReference: product.reference,
    productUnit: product.unit,
    quantityReturned: 1,
    unitPrice: creditUnitPriceFor(product, party),
    taxRate: product.taxRate,
  };
}

/** The same rounding points as the server (HT rounded, then the VAT of that HT, then TTC = HT + VAT). */
export function creditLineTotals(line: Pick<CreditPosLine, "unitPrice" | "quantityReturned" | "taxRate">): CreditPosTotals {
  const totalHT = roundMoney(line.unitPrice * line.quantityReturned);
  const taxAmount = roundMoney(totalHT * (line.taxRate / 100));
  return { totalHT, taxAmount, totalTTC: roundMoney(totalHT + taxAmount) };
}

export function creditTotals(lines: ReadonlyArray<CreditPosLine>): CreditPosTotals {
  const sums = lines.reduce(
    (acc, line) => {
      const totals = creditLineTotals(line);
      return {
        totalHT: acc.totalHT + totals.totalHT,
        taxAmount: acc.taxAmount + totals.taxAmount,
        totalTTC: acc.totalTTC + totals.totalTTC,
      };
    },
    { totalHT: 0, taxAmount: 0, totalTTC: 0 },
  );
  return {
    totalHT: roundMoney(sums.totalHT),
    taxAmount: roundMoney(sums.taxAmount),
    totalTTC: roundMoney(sums.totalTTC),
  };
}

/** A catalogue card of the POS grid for a product being returned (price TTC of the party's price). */
export function productToPosProduct(product: ProductDto, party: CreditNotePartyType): PosProduct {
  const unitPrice = creditUnitPriceFor(product, party);
  return {
    id: product.id,
    reference: product.reference,
    barcode: product.barcode ?? null,
    designation: product.name,
    prixVenteHT: unitPrice,
    prixVenteTTC: roundMoney(unitPrice * (1 + product.taxRate / 100)),
    tauxTVA: product.taxRate,
    quantiteStock: 0,
    imageUrl: product.imageUrl ?? null,
  };
}

/** A returned line as a POS cart line (read-only price, no discount, nothing below cost). */
export function creditLineToCartLine(line: CreditPosLine): CartLineComputed {
  const totals = creditLineTotals(line);
  const unitPriceTTC = roundMoney(line.unitPrice * (1 + line.taxRate / 100));
  return {
    productId: line.productId,
    designation: line.productName,
    reference: line.productReference,
    quantity: line.quantityReturned,
    discountUnitAmount: 0,
    unitPriceHT: line.unitPrice,
    unitPriceTTC,
    tauxTVA: line.taxRate,
    baseHT: totals.totalHT,
    discountAmount: 0,
    netHT: totals.totalHT,
    tvaAmount: totals.taxAmount,
    totalTTC: totals.totalTTC,
    transferValue: 0,
  };
}

/** The POS summary totals of the amount to refund (no rounding share: a manual return carries none). */
export function creditTotalsToCartTotals(totals: CreditPosTotals): CartTotals {
  return {
    sousTotalHT: totals.totalHT,
    remise: 0,
    tva: totals.taxAmount,
    totalTTC: totals.totalTTC,
    netAPayer: totals.totalTTC,
    transferValue: 0,
  };
}

export type CreditNotePosPayloadInput = {
  party: CreditNotePartyType;
  /** Customer id (client) or supplier id (fournisseur). */
  partyId: string;
  /** Depot the goods go back to (client) or leave from (supplier). */
  depotId: string;
  reason: CreditNoteReason;
  comment: string;
  /** "YYYY-MM-DD". */
  returnDate: string;
  /** One key per avoir being created: a repeated submission returns the avoir already created. */
  idempotencyKey: string;
  lines: ReadonlyArray<CreditPosLine>;
};

/** The body of POST /api/credit-notes/manual: validated at once, refunded (client) in cash. */
export function buildCreditNotePosPayload(input: CreditNotePosPayloadInput): CreateCreditNoteInput {
  const lines = input.lines.map((line) => ({
    productId: line.productId,
    quantityReturned: line.quantityReturned,
    unitPrice: line.unitPrice,
    discountPercent: 0,
    taxRate: line.taxRate,
  }));
  if (input.party === "client") {
    return {
      partyType: "client",
      customerId: input.partyId,
      returnMode: "MANUAL",
      refundMode: CREDIT_NOTE_POS_REFUND_MODE,
      reason: input.reason,
      comment: input.comment,
      returnDate: input.returnDate,
      stockDestinationLocationId: input.depotId,
      idempotencyKey: input.idempotencyKey,
      lines,
    };
  }
  return {
    partyType: "fournisseur",
    supplierId: input.partyId,
    reason: input.reason,
    comment: input.comment,
    returnDate: input.returnDate,
    stockSourceLocationId: input.depotId,
    idempotencyKey: input.idempotencyKey,
    lines,
  };
}

/** Why the « Encaisser » dialog cannot be confirmed yet, or null when it can. */
export function creditNoteBlockingReason(input: {
  party: CreditNotePartyType;
  partyId: string;
  depotId: string;
  reason: CreditNoteReason;
  comment: string;
  lineCount: number;
}): string | null {
  if (input.lineCount === 0) return "Ajoutez au moins un produit dans le panier.";
  if (!input.partyId) return input.party === "client" ? "Sélectionnez un client." : "Sélectionnez un fournisseur.";
  if (!input.depotId) return "Sélectionnez le dépôt.";
  const comment = input.comment.trim();
  if (input.party === "client" && comment.length < CREDIT_NOTE_JUSTIFICATION_MIN_LENGTH) {
    return `La justification est obligatoire (${CREDIT_NOTE_JUSTIFICATION_MIN_LENGTH} caractères minimum).`;
  }
  if (input.party === "fournisseur" && input.reason === "autre" && comment.length === 0) {
    return "La justification est obligatoire pour le motif Autre.";
  }
  return null;
}
