import type { UserRole } from "@/types/auth";

export type User = {
  id: string;
  nom: string;
  email: string;
  telephone: string;
  role: UserRole;
  actif: boolean;
  derniereConnexion: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
