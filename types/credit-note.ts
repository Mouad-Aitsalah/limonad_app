export type CreditNoteStatus = "BROUILLON" | "VALIDE" | "CONTREPASSE";

export type CreditNoteReason =
  | "produit_defectueux"
  | "produit_endommage"
  | "erreur_livraison"
  | "erreur_fournisseur"
  | "erreur_quantite"
  | "produit_non_conforme"
  | "echange_client"
  | "surplus_livraison"
  | "retour_commercial"
  | "produit_perime"
  | "autre";

export type CreditNoteOrigin = "retour_manuel" | "facture";
export type CreditNotePartyType = "client" | "fournisseur";

/**
 * How a credit note is settled (stored as CreditNote.refundMethod):
 *  - "remboursement_especes": cash refunded from the till (default, CASH);
 *  - "avoir_sur_compte": amount credited to the customer's account (BANK) -
 *    customer notes only; a supplier note always keeps its current cash treatment.
 */
export type CreditNoteRefundMode = "remboursement_especes" | "avoir_sur_compte";

export type CreditNoteSaleOrigin = "comptoir" | "camion" | null;

export type CreditNoteLine = {
  id?: string;
  saleLineId?: string | null;
  productId: string;
  productName?: string;
  productReference?: string;
  productUnit?: string;
  invoiceNumber?: string | null;
  quantityReturned: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  totalHT?: number;
  taxAmount?: number;
  totalTTC?: number;
};

export type CreditNote = {
  id: string;
  /**
   * Final amount of the note as stored: lines + roundingAmount. Absent on a DTO
   * built before these fields existed (the lists then re-sum the lines as before).
   */
  totalTTC?: number;
  /** The share of the original sale's commercial rounding the note gives back (0 when none). */
  roundingAmount?: number;
  number: string;
  partyType: CreditNotePartyType;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  customerId: string | null;
  customerName?: string | null;
  supplierId: string | null;
  supplierName?: string | null;
  supplierCode?: string | null;
  origin: CreditNoteOrigin;
  /** Absent only on a DTO built outside the server mapper (mock data). */
  refundMode?: CreditNoteRefundMode;
  saleOrigin: CreditNoteSaleOrigin;
  truckId: string | null;
  truckLabel?: string | null;
  sourceLabel?: string | null;
  tourneeClosed: boolean;
  // F4: only set on a driver return (createDriverReturn) - the tour it was
  // physically collected on, distinct from truckId/truckLabel above (which
  // reflect the ORIGINAL sale's truck, if this return is linked to one).
  driverReturnTourId?: string | null;
  driverReturnTourCode?: string | null;
  driverReturnDriverName?: string | null;
  stockDestinationLocationId: string | null;
  stockDestinationLocationName?: string | null;
  stockSourceLocationId: string | null;
  stockSourceLocationName?: string | null;
  reason: CreditNoteReason;
  comment: string;
  returnDate: string;
  status: CreditNoteStatus;
  lines: CreditNoteLine[];
  createdBy: string;
  validatedBy: string | null;
  validatedAt: string | null;
  reversedAt?: string | null;
  stockMovements?: {
    id: string;
    movementNumber: string;
    type: string;
    quantity: number;
    destinationLocationName?: string | null;
    sourceLocationName?: string | null;
    createdAt: string;
    status: string;
  }[];
  createdAt: string;
  updatedAt: string;
};

export type ReturnableProductOrigin = {
  saleId: string;
  saleLineId: string;
  invoiceNumber: string;
  saleDate: string;
  stockLocationId: string;
  stockLocationName: string;
  quantityBought: number;
  quantityAlreadyReturned: number;
  quantityReturnable: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  // The original SaleLine's real totalTTC - together with quantityBought,
  // lets a caller derive the EXACT prorated return amount (see
  // computeLinkedReturnTotals in lib/pos-discount.ts) instead of
  // recomputing from discountPercent, which is only a rounded-to-the-
  // centime approximation for display/compatibility.
  originalTotalTTC: number;
  // Present ONLY when the original sale carries a commercial rounding
  // (Sale.roundingAmount != 0, see lib/sale-rounding.ts): everything the cart
  // needs to preview the share of that rounding a return gives back, with the
  // same pure function as the server (lib/credit-note-rounding.ts) - the sale's
  // rounding and EVERY line of the sale with its validated returned quantity.
  saleRounding?: {
    roundingAmount: number;
    lines: Array<{
      saleLineId: string;
      totalTTC: number;
      quantity: number;
      alreadyReturnedQuantity: number;
    }>;
  };
};

export type ReturnableProduct = {
  productId: string;
  productName: string;
  productReference: string;
  totalBought: number;
  alreadyReturned: number;
  returnableQuantity: number;
  lastPurchaseDate: string;
  invoicesCount: number;
  prices: number[];
  origins: ReturnableProductOrigin[];
};

export type CreateCreditNoteInput = {
  id?: string;
  partyType?: CreditNotePartyType;
  customerId?: string | null;
  supplierId?: string | null;
  // F4 finalization: required for a customer return ("client") - LINKED
  // means every line must carry a saleLineId (capped against it); MANUAL
  // means no line may. Lot 1: admin, depot manager and cashier alike, a
  // written justification required for every customer note, and the
  // cashier's MANUAL lines priced at the product's current sale price.
  // Not used for a supplier return.
  returnMode?: "LINKED" | "MANUAL";
  /** Lot 1: defaults to "remboursement_especes"; "avoir_sur_compte" is customer-only. */
  refundMode?: CreditNoteRefundMode;
  reason: CreditNoteReason;
  comment?: string | null;
  returnDate: string;
  stockDestinationLocationId?: string;
  stockSourceLocationId?: string;
  lines: {
    productId: string;
    quantityReturned: number;
    unitPrice?: number;
    discountPercent?: number;
    taxRate?: number;
    // F4: required when returnMode is LINKED (capped against it), forbidden
    // when MANUAL. See the F4 finalization report.
    saleLineId?: string | null;
  }[];
  // Client-generated, stable for one avoir creation attempt (F5). Lot 1:
  // REQUIRED by the server when `id` is not set (a fresh avoir, not an update
  // of an existing draft) - a resubmission with the same key returns the avoir
  // already created instead of creating a second one.
  idempotencyKey?: string | null;
};

export type CreateDriverReturnInput = {
  // F4 finalization: required (was optional).
  customerId: string;
  reason: CreditNoteReason;
  comment?: string | null;
  lines: {
    productId: string;
    quantityReturned: number;
    // F4 finalization: required on every line - a driver return is always
    // LINKED, never MANUAL.
    saleLineId: string;
  }[];
  idempotencyKey?: string | null;
};
