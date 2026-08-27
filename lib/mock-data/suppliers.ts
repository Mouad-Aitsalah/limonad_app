import type { Supplier } from "@/types/supplier";

/**
 * Les id reprennent volontairement ceux déjà référencés en tant que
 * `fournisseurId` dans lib/mock-data/products.ts — même identité mock
 * partagée, prête à devenir une vraie table Fournisseur.
 */
export const suppliers: Supplier[] = [
  {
    id: "fournisseur-sportidis",
    nom: "SportiDis Maroc",
    telephone: "+212 5 22-11-22-33",
    email: "contact@sportidis.ma",
    adresse: "Zone Industrielle Sidi Bernoussi, Casablanca",
  },
  {
    id: "fournisseur-teamwear",
    nom: "TeamWear Distribution",
    telephone: "+212 5 22-44-55-66",
    email: "commercial@teamwear.ma",
    adresse: "Quartier Industriel, Aïn Sebaâ, Casablanca",
  },
  {
    id: "fournisseur-nutripro",
    nom: "NutriPro Sarl",
    telephone: "+212 5 22-77-88-99",
    email: "ventes@nutripro.ma",
    adresse: "Zone Franche, Tanger",
  },
];
