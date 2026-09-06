import {
  Calculator,
  LayoutDashboard,
  Package,
  Settings,
  ShieldUser,
  ShoppingBag,
  ShoppingCart,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import type { UserRole } from "@/types/auth";

export type NavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  description?: string;
  roles?: UserRole[];
  children?: Array<{
    label: string;
    href: string;
    roles?: UserRole[];
    /** Highlight this child only on an exact pathname match, never on its
     * sub-routes (used when a sibling child lives under this href). */
    exact?: boolean;
  }>;
};

const ACCOUNTING_ROLES: UserRole[] = ["admin", "depot_manager", "cashier"];

export const navItems: NavItem[] = [
  {
    label: "Organisations",
    href: "/organisations",
    icon: ShieldUser,
    description: "Pilotage multi-organisations",
    roles: ["super_admin"],
  },
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "Vue business et alertes",
  },
  {
    label: "Ventes & Caisse",
    icon: ShoppingCart,
    description: "Encaissement, versements et avoirs",
    children: [
      { label: "Point de vente", href: "/pos" },
      { label: "Versements", href: "/pos/versements" },
      { label: "Ventes", href: "/ventes" },
      { label: "Avoirs", href: "/avoirs", roles: ["admin", "cashier"] },
    ],
  },
  {
    label: "Catalogue",
    icon: Package,
    description: "Produits et catégories",
    children: [
      { label: "Produits", href: "/produits" },
      { label: "Catégories", href: "/categories" },
    ],
  },
  {
    label: "Stock & Logistique",
    icon: Warehouse,
    description: "Stock, dépôts, camions et tournées",
    children: [
      { label: "Stock", href: "/stock" },
      { label: "Dépôts", href: "/depots", roles: ["admin"] },
      { label: "Inventaire", href: "/inventaire", roles: ["admin", "depot_manager"] },
      { label: "Camions", href: "/camions" },
      { label: "Chargements", href: "/chargements", roles: ["admin", "depot_manager"] },
      { label: "Trajets", href: "/trajets", roles: ["admin", "depot_manager"] },
    ],
  },
  {
    label: "Achats",
    icon: ShoppingBag,
    description: "Approvisionnements",
    children: [
      { label: "Achat", href: "/achats/nouveau" },
      { label: "Historique des achats", href: "/achats", exact: true },
    ],
  },
  {
    label: "Clients & fournisseurs",
    icon: Wallet,
    description: "Comptes et contacts tiers",
    children: [
      { label: "Comptes", href: "/comptes" },
      { label: "Contacts", href: "/contacts", roles: ["admin"] },
    ],
  },
  {
    label: "Ressources humaines",
    icon: Users,
    description: "Employés et paie",
    roles: ["admin"],
    children: [
      { label: "Employés", href: "/employes", roles: ["admin"] },
      { label: "Avances / Salaire", href: "/employes/avances-salaire", roles: ["admin"] },
    ],
  },
  {
    label: "Comptabilité",
    icon: Calculator,
    description: "Journal, écritures et règlements",
    roles: ACCOUNTING_ROLES,
    children: [
      { label: "Journal", href: "/comptabilite/journal", roles: ACCOUNTING_ROLES },
      { label: "Écritures", href: "/comptabilite/ecritures", roles: ACCOUNTING_ROLES },
      {
        label: "Règlements clients",
        href: "/comptabilite/reglements-clients",
        roles: ACCOUNTING_ROLES,
      },
      { label: "Comptes comptables", href: "/comptabilite/comptes", roles: ACCOUNTING_ROLES },
      {
        label: "Paramètres comptables",
        href: "/comptabilite/parametres",
        roles: ACCOUNTING_ROLES,
      },
    ],
  },
  {
    label: "Administration",
    icon: Settings,
    description: "Utilisateurs et paramètres",
    roles: ["admin"],
    children: [
      { label: "Utilisateurs", href: "/utilisateurs", roles: ["admin"] },
      { label: "Paramètres", href: "/parametres/identite", roles: ["admin"] },
    ],
  },
];
