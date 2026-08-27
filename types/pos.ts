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

export type PosPaymentMethodValue =
  | "CASH"
  | "CHECK"
  | "CARD"
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
  { value: "CARD", label: "Carte bancaire" },
  { value: "BANK_TRANSFER", label: "Virement" },
  { value: "CREDIT", label: "Crédit client" },
  { value: "MIXED", label: "Paiement mixte" },
];
