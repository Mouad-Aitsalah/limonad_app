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

export type CreditNoteSaleOrigin = "comptoir" | "camion" | null;

export type CreditNoteLine = {
  id?: string;
  saleLineId?: string | null;
  productId: string;
  productName?: string;
  productReference?: string;
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
  saleOrigin: CreditNoteSaleOrigin;
  truckId: string | null;
  truckLabel?: string | null;
  sourceLabel?: string | null;
  tourneeClosed: boolean;
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
  }[];
};
