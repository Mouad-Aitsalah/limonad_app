import type { CurrentUser } from "@/types/auth";

/**
 * Authentification mock uniquement : mots de passe en clair, comparaison simulée.
 * À remplacer plus tard par une vraie table Utilisateur + mots de passe chiffrés (voir ARCHITECTURE.md §11, §20).
 *
 * L'id du chauffeur ("driver-1") réutilise volontairement celui déjà présent dans
 * lib/mock-data/drivers.ts (Youssef Amrani, affecté à CAM-01 dans lib/mock-data/trucks.ts),
 * pour que les futures pages "chauffeur" puissent déjà résoudre "mon camion" sans refonte.
 */
export type MockAuthUser = CurrentUser & { password: string };

export const authUsers: MockAuthUser[] = [
  {
    id: "user-admin",
    nom: "Administrateur COMDIS",
    email: "admin@comdis.local",
    password: "123456",
    role: "admin",
  },
  {
    id: "user-cashier",
    nom: "Caissier Principal",
    email: "caissier@comdis.local",
    password: "123456",
    role: "cashier",
  },
  {
    id: "driver-1",
    nom: "Youssef Amrani",
    email: "chauffeur@comdis.local",
    password: "123456",
    role: "driver",
  },
];
