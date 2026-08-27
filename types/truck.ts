export type TruckStatus =
  | "disponible"
  | "en_tournee"
  | "en_maintenance"
  | "hors_service";

export type CapaciteUnite = "kg" | "palettes";

export type Truck = {
  id: string;
  code: string;
  nom: string;
  immatriculation: string;
  marque: string;
  modele: string;
  annee: number;
  capacite: number;
  capaciteUnite: CapaciteUnite;
  statut: TruckStatus;
  chauffeurId: string | null;
  depotId: string;
  kilometrage: number;
  dateMiseEnService: Date;
  observations: string;
  actif: boolean;
  createdAt: Date;
  updatedAt: Date;
};
