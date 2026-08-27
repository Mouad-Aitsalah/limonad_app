export type CustomerType =
  | "epicerie"
  | "cafe"
  | "restaurant"
  | "supermarche"
  | "grossiste"
  | "client_comptoir"
  | "autre";

export type CustomerStatus = "actif" | "inactif" | "bloque";

export type CustomerCreationOrigin = "DRIVER" | "ADMIN";

export type Customer = {
  id: string;
  nom: string;
  code: string;
  telephone: string;
  adresse: string;
  ville: string;
  type: CustomerType;
  statut: CustomerStatus;
  email?: string;
  ice?: string;
  identifiantFiscal?: string;
  contactPrincipal?: string;
  plafondCredit: number;
  creditUtilise: number;
  gps?: string;
  notes?: string;
  createdByUserId: string;
  createdByUserName: string;
  createdByDriverId?: string;
  createdFromTruckId?: string;
  createdFromTourId?: string;
  creationOrigin: CustomerCreationOrigin;
  createdAt: Date;
  updatedAt: Date;
};
