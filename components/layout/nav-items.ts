import {
  Calculator,
  ClipboardCheck,
  ClipboardList,
  Contact as ContactIcon,
  Container,
  LayoutDashboard,
  Navigation,
  Package,
  ReceiptText,
  Settings,
  ShieldUser,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tags,
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
  order?: string;
  roles?: UserRole[];
  children?: Array<{
    label: string;
    href: string;
    description?: string;
    roles?: UserRole[];
  }>;
};

export const navItems: NavItem[] = [
  {
    label: "Organisations",
    href: "/organisations",
    icon: ShieldUser,
    description: "Pilotage multi-organisations",
    order: "00",
    roles: ["super_admin"],
  },
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "Vue business et alertes",
    order: "01",
  },
  {
    label: "Produits",
    href: "/produits",
    icon: Package,
    description: "Catalogue, prix et photos",
    order: "02",
  },
  {
    label: "Categories",
    href: "/categories",
    icon: Tags,
    description: "Organisation du catalogue",
    order: "03",
  },
  {
    label: "Stock",
    href: "/stock",
    icon: Warehouse,
    description: "Depot, camions et mouvements",
    order: "04",
  },
  {
    label: "Depots",
    href: "/depots",
    icon: Warehouse,
    description: "Depots de l'organisation",
    order: "042",
    roles: ["admin"],
  },
  {
    label: "Inventaire",
    href: "/inventaire",
    icon: ClipboardCheck,
    description: "Comptage physique du stock",
    order: "045",
    roles: ["admin", "depot_manager"],
  },
  {
    label: "Camions",
    href: "/camions",
    icon: Container,
    description: "Flotte et affectations",
    order: "05",
  },
  {
    label: "Chargements",
    href: "/chargements",
    icon: ClipboardList,
    description: "Preparation et transferts",
    order: "07",
    roles: ["admin", "depot_manager"],
  },
  {
    label: "Trajets",
    href: "/trajets",
    icon: Navigation,
    description: "Trajets GPS et historique",
    order: "06",
    roles: ["admin", "depot_manager"],
  },
  {
    label: "Achats",
    href: "/achats",
    icon: ShoppingBag,
    description: "Approvisionnements",
    order: "08",
  },
  {
    label: "Ventes",
    href: "/ventes",
    icon: ShoppingCart,
    description: "Factures et encaissements",
    order: "09",
  },
  {
    label: "Avoirs",
    href: "/avoirs",
    icon: ReceiptText,
    description: "Retours et credits",
    order: "10",
    roles: ["admin", "cashier"],
  },
  {
    label: "Point de Vente",
    icon: Store,
    description: "Encaissement et versements",
    order: "11",
    children: [
      {
        label: "Point de Vente",
        href: "/pos",
        description: "Encaissement direct",
      },
      {
        label: "Versements",
        href: "/pos/versements",
        description: "Declaration et historique de caisse",
      },
    ],
  },
  {
    label: "Comptes",
    href: "/comptes",
    icon: Wallet,
    description: "Clients, fournisseurs et tiers",
    order: "12",
  },
  {
    label: "Contacts",
    href: "/contacts",
    icon: ContactIcon,
    description: "Repertoire general de contacts",
    order: "125",
    roles: ["admin"],
  },
  {
    label: "Employes",
    icon: Users,
    description: "Personnel, avances et salaires",
    order: "127",
    roles: ["admin"],
    children: [
      {
        label: "Employes",
        href: "/employes",
        description: "Annuaire et fiches employes",
        roles: ["admin"],
      },
      {
        label: "Avances / Salaire",
        href: "/employes/avances-salaire",
        description: "Operations paie et historique",
        roles: ["admin"],
      },
    ],
  },
  {
    label: "Comptabilite",
    icon: Calculator,
    description: "Journal et parametres",
    order: "13",
    roles: ["admin", "depot_manager", "cashier"],
    children: [
      {
        label: "Journal",
        href: "/comptabilite/journal",
        description: "Suivi des operations",
        roles: ["admin", "depot_manager", "cashier"],
      },
      {
        label: "Comptes comptables",
        href: "/comptabilite/comptes",
        description: "Plan comptable",
        roles: ["admin", "depot_manager", "cashier"],
      },
      {
        label: "Ecritures",
        href: "/comptabilite/ecritures",
        description: "Saisir une ecriture manuelle",
        roles: ["admin", "depot_manager", "cashier"],
      },
      {
        label: "Reglements clients",
        href: "/comptabilite/reglements-clients",
        description: "Soldes et encaissements clients",
        roles: ["admin", "depot_manager", "cashier"],
      },
      {
        label: "Parametres comptables",
        href: "/comptabilite/parametres",
        description: "Comptes systeme",
        roles: ["admin", "depot_manager", "cashier"],
      },
    ],
  },
  {
    label: "Utilisateurs",
    href: "/utilisateurs",
    icon: ShieldUser,
    description: "Acces et roles",
    order: "14",
    roles: ["admin"],
  },
  {
    label: "Parametres",
    icon: Settings,
    description: "Identite de l'entreprise",
    order: "15",
    roles: ["admin"],
    children: [
      {
        label: "Identite de l'entreprise",
        href: "/parametres/identite",
        description: "Nom et logo affiches dans l'application et sur les tickets",
        roles: ["admin"],
      },
    ],
  },
];
