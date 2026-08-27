export type Product = {
  // Identité
  id: string;
  reference: string;
  codeBarres: string;
  designation: string;

  // Relations
  categorieId: string;
  fournisseurId: string;
  marqueId: string;

  // Prix
  prixAchatHT: number;
  prixAchatTTC: number;
  prixVenteDetail: number;
  prixVenteDemiGros: number;
  prixVenteGros: number;

  // Fiscalité
  tauxTVA: number;

  // Stock
  quantiteStock: number;
  stockAlerte: number;

  // Conditionnement
  unite: string;
  quantiteMinimumDetail: number;
  quantiteMinimumGros: number;

  // Programme fidélité
  pointsFidelite: number;

  // État
  disponible: boolean;
  actif: boolean;

  // Dates
  createdAt: Date;
  updatedAt: Date;
};
