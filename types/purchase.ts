export type PurchasePaymentMethod =
  | "especes"
  | "carte"
  | "cheque"
  | "virement"
  | "credit_fournisseur";

export type PurchaseStatus = "validee" | "en_attente" | "annulee";

export type PurchaseLine = {
  productId: string;
  productName?: string;
  quantite: number;
  prixAchat: number;
  remisePercent: number;
  tauxTVA?: number;
  totalHT?: number;
  totalTVA?: number;
  totalTTC?: number;
};

export type Purchase = {
  id: string;
  numero: string; // "A-000001"
  date: Date;
  fournisseurId: string;
  fournisseurNom?: string;
  modeReglement: PurchasePaymentMethod;
  numeroCheque: string | null;
  banque: string | null;
  datePaiement: Date | null;
  utilisateurId: string;
  utilisateurNom?: string;
  observation: string;
  statut: PurchaseStatus;
  lignes: PurchaseLine[];
  createdAt: Date;
  updatedAt: Date;
};
