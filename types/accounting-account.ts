export type AccountClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type AccountType =
  | "Comptes de financement permanent"
  | "Comptes d'actif immobilisé"
  | "Comptes d'actif circulant (hors trésorerie)"
  | "Comptes de passif circulant (hors trésorerie)"
  | "Comptes de trésorerie"
  | "Comptes de charges"
  | "Comptes de produits"
  | "Comptes de résultats"
  | "Comptes de produits et charges réfléchis"
  | "Comptes spéciaux";

export type AccountingAccount = {
  id: string;
  numeroCompte: string;
  nomCompte: string;
  classe: AccountClass;
  typeCompte: AccountType;
  actif: boolean;
  createdAt: Date;
  updatedAt: Date;
};
