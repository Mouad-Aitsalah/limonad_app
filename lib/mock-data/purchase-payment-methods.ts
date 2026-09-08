import type { PurchasePaymentMethod } from "@/types/purchase";

export type PurchasePaymentMethodOption = {
  value: PurchasePaymentMethod;
  label: string;
};

export const purchasePaymentMethods: PurchasePaymentMethodOption[] = [
  { value: "especes", label: "Espèces" },
  { value: "carte", label: "Carte" },
  { value: "cheque", label: "Chèque" },
  { value: "virement", label: "Virement" },
  { value: "credit_fournisseur", label: "Crédit fournisseur" },
];

export const purchasePaymentLabels: Record<PurchasePaymentMethod, string> = {
  especes: purchasePaymentMethods[0].label,
  banque: "Banque",
  credit_fournisseur: purchasePaymentMethods.at(-1)?.label ?? "Crédit fournisseur",
  carte: "Carte",
  cheque: "Chèque",
  virement: "Virement",
};
