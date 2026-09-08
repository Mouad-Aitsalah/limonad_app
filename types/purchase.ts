export type PurchasePaymentMethod =
  | "especes"
  | "carte"
  | "cheque"
  | "virement"
  | "credit_fournisseur";

export type PurchaseStatus = "validee" | "en_attente" | "annulee";

/**
 * Price-entry mode of a purchase (mutually exclusive per purchase).
 *  - CLASSIC_TTC: tax-included unit price + one discount (historical, default).
 *  - DOUBLE_DISCOUNT_HT: gross HT unit price + two SUCCESSIVE discounts.
 */
export type PurchasePricingMode = "CLASSIC_TTC" | "DOUBLE_DISCOUNT_HT";

export type PurchaseLine = {
  productId: string;
  productName?: string;
  quantite: number;
  /** Unit purchase price tax EXCLUDED (stored value, kept for compatibility). */
  prixAchat: number;
  /** Unit purchase price tax INCLUDED - what the classic /achats form shows and sends. */
  prixAchatTTC?: number;
  /** DOUBLE_DISCOUNT_HT: gross HT unit price used (= stored unitPurchasePrice). */
  prixBrutHT?: number;
  /** DOUBLE_DISCOUNT_HT: discount 1 (%). Mirrors remisePercent. */
  remise1Percent?: number;
  /** DOUBLE_DISCOUNT_HT: discount 2 (%), applied AFTER discount 1. */
  remise2Percent?: number;
  /** DOUBLE_DISCOUNT_HT: net unit HT after both discounts, rounded for display. */
  prixNetHT?: number;
  remisePercent: number;
  tauxTVA?: number;
  totalHT?: number;
  totalTVA?: number;
  totalTTC?: number;
};

/** Classic mode line input: a tax-INCLUDED unit price + one discount. */
export type ClassicPurchaseLineInput = {
  productId: string;
  quantite: number;
  prixAchatTTC: number;
  remisePercent: number;
};

/** Double-remise mode line input: gross HT unit price + two discounts. */
export type DoubleDiscountPurchaseLineInput = {
  productId: string;
  quantite: number;
  prixBrutHT: number;
  remise1Percent: number;
  remise2Percent: number;
};

/** What the purchase form submits per line - shape depends on pricingMode. */
export type PurchaseLineInput =
  | ClassicPurchaseLineInput
  | DoubleDiscountPurchaseLineInput;

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
  /** Price-entry mode. Absent/legacy rows are CLASSIC_TTC. */
  pricingMode: PurchasePricingMode;
  lignes: PurchaseLine[];
  createdAt: Date;
  updatedAt: Date;
};
