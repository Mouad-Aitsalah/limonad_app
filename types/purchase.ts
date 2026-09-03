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
  /** Unit purchase price tax EXCLUDED (stored value, kept for compatibility). */
  prixAchat: number;
  /** Unit purchase price tax INCLUDED - what the /achats form shows and sends. */
  prixAchatTTC?: number;
  remisePercent: number;
  tauxTVA?: number;
  totalHT?: number;
  totalTVA?: number;
  totalTTC?: number;
};

/** What the purchase form submits per line: a tax-INCLUDED unit price. */
export type PurchaseLineInput = {
  productId: string;
  quantite: number;
  prixAchatTTC: number;
  remisePercent: number;
};

/** What the /achats "Nouvel achat" form hands to its onSaved callback. */
export type PurchaseInput = Omit<
  Purchase,
  "id" | "numero" | "createdAt" | "updatedAt" | "lignes"
> & { lignes: PurchaseLineInput[] };

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
