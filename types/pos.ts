export type PosOperationType = "sale" | "transfer";

export type PosProduct = {
  id: string;
  reference: string;
  barcode?: string | null;
  designation: string;
  prixVenteHT: number;
  prixVenteTTC: number;
  tauxTVA: number;
  quantiteStock: number;
  imageUrl?: string | null;
};

// CARD is deliberately not offered here anymore (COMDIS no longer takes
// bank-card payments at the POS) - it stays a valid Prisma PaymentMethod/
// SaleDto.paymentMethod value purely so old CARD sales remain readable
// (receipt, sales history, journal). Never add it back to
// posPaymentMethods without also reversing that business decision.
export type PosPaymentMethodValue =
  | "CASH"
  | "CHECK"
  | "BANK_TRANSFER"
  | "CREDIT"
  | "MIXED";

export type PosPaymentMethodOption = {
  value: PosPaymentMethodValue;
  label: string;
};

export const defaultPaymentMethod: PosPaymentMethodValue = "CASH";

export const posPaymentMethods: PosPaymentMethodOption[] = [
  { value: "CASH", label: "Espèces" },
  { value: "CHECK", label: "Chèque" },
  { value: "BANK_TRANSFER", label: "Virement" },
  { value: "CREDIT", label: "Crédit client" },
  { value: "MIXED", label: "Paiement mixte" },
];
