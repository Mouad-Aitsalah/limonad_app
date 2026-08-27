import type { UserRole } from "@/types/auth";

export type User = {
  id: string;
  nom: string;
  email: string;
  telephone: string;
  role: UserRole;
  actif: boolean;
  organizationId: string | null;
  organizationName: string | null;
  derniereConnexion: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
