import type { UserRole } from "@/types/auth";

/**
 * The modules a SUPER_ADMIN can enable or disable per organisation
 * (Organisations -> detail -> "Modules autorisés"), and the explicit
 * correspondence between each module and its pages. The API routes are mapped
 * in lib/modules/api-rules.ts. Every module listed here exists in the
 * application today: nothing is invented, and a module groups the pages of one
 * menu entry (or of a closely tied set of entries).
 *
 * "Essential" modules can never be disabled: the product catalogue feeds the
 * POS, the stock, the purchases and the credit notes, and the settings are the
 * admin's own configuration. Login, logout, the session, the account and the
 * SUPER_ADMIN space are not modules at all (always available).
 *
 * Pure module: the browser, the server and the tests import it.
 */

export const MODULE_KEYS = [
  "dashboard",
  "pos",
  "deposits",
  "salesArchive",
  "dailyInvoices",
  "customerOrders",
  "creditNotes",
  "products",
  "stock",
  "inventory",
  "stockTransfers",
  "trucks",
  "gps",
  "purchases",
  "accounts",
  "contacts",
  "employees",
  "accounting",
  "users",
  "settings",
  "assistant",
  "driverApp",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  description: string;
  /** Menu group, for the SUPER_ADMIN screen. */
  group: string;
  /** Roles that use the module today (display only - permissions are unchanged). */
  usedBy: readonly UserRole[];
  /** Always enabled: the SUPER_ADMIN cannot disable it. */
  essential?: boolean;
};

const STAFF: readonly UserRole[] = ["admin", "depot_manager", "cashier"];

export const MODULES: readonly ModuleDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Indicateurs, analyse commerciale, créances clients et prévisions d'achat.",
    group: "Pilotage",
    usedBy: ["admin", "depot_manager"],
  },
  {
    key: "pos",
    label: "Point de vente",
    description: "Caisse comptoir : factures, encaissements, factures en attente et mode hors ligne.",
    group: "Ventes & Caisse",
    usedBy: STAFF,
  },
  {
    key: "deposits",
    label: "Versements",
    description: "Versements de caisse (espèces et chèques) et leur historique.",
    group: "Ventes & Caisse",
    usedBy: STAFF,
  },
  {
    key: "salesArchive",
    label: "Archives des factures",
    description: "Historique des factures, sessions POS et ventes par mois.",
    group: "Ventes & Caisse",
    usedBy: STAFF,
  },
  {
    key: "dailyInvoices",
    label: "Factures journalières",
    description: "Factures d'une journée, avec indicateurs et filtres par utilisateur.",
    group: "Ventes & Caisse",
    usedBy: STAFF,
  },
  {
    key: "customerOrders",
    label: "Commandes en ligne",
    description: "Commandes reçues de l'Espace client et l'Espace client lui-même (connexion, catalogue, commandes).",
    group: "Ventes & Caisse",
    usedBy: STAFF,
  },
  {
    key: "creditNotes",
    label: "Avoirs clients / fournisseurs",
    description: "Avoirs, retours de marchandises et leur validation.",
    group: "Ventes & Caisse",
    usedBy: ["admin", "cashier"],
  },
  {
    key: "products",
    label: "Produits et catégories",
    description: "Catalogue produits, catégories, import et export. Utilisé par la caisse, le stock et les achats.",
    group: "Produit / Catégorie",
    usedBy: STAFF,
    essential: true,
  },
  {
    key: "stock",
    label: "Gestion du stock",
    description: "Stock des dépôts et des camions, mouvements, ajustements et dépôts.",
    group: "Stock & Logistique",
    usedBy: STAFF,
  },
  {
    key: "inventory",
    label: "Inventaire",
    description: "Inventaires physiques et ajustements qui en découlent.",
    group: "Stock & Logistique",
    usedBy: ["admin", "depot_manager"],
  },
  {
    key: "stockTransfers",
    label: "Transferts de stock",
    description: "Feuilles de chargement des camions (charge initiale, recharges, restant) et tournées.",
    group: "Stock & Logistique",
    usedBy: STAFF,
  },
  {
    key: "trucks",
    label: "Camions",
    description: "Flotte de camions, affectation et statut.",
    group: "Stock & Logistique",
    usedBy: STAFF,
  },
  {
    key: "gps",
    label: "Suivi GPS et circuits des chauffeurs",
    description: "Trajets, carte en direct, positions GPS envoyées par les chauffeurs et itinéraires.",
    group: "Stock & Logistique",
    usedBy: ["admin", "depot_manager", "cashier", "driver"],
  },
  {
    key: "purchases",
    label: "Achats",
    description: "Saisie des achats fournisseurs et historique des achats.",
    group: "Achats",
    usedBy: STAFF,
  },
  {
    key: "accounts",
    label: "Comptes",
    description: "Comptes clients, fournisseurs, charges, trésorerie et employés ; import et export.",
    group: "Clients & fournisseurs",
    usedBy: STAFF,
  },
  {
    key: "contacts",
    label: "Contacts",
    description: "Carnet de contacts des tiers.",
    group: "Clients & fournisseurs",
    usedBy: ["admin"],
  },
  {
    key: "employees",
    label: "Employés et paie",
    description: "Employés, avances et salaires.",
    group: "Table employé",
    usedBy: ["admin"],
  },
  {
    key: "accounting",
    label: "Comptabilité",
    description: "Journal, écritures, règlements clients, solde clients, comptes et paramètres comptables.",
    group: "Comptabilité",
    usedBy: STAFF,
  },
  {
    key: "users",
    label: "Gestion des utilisateurs",
    description: "Création et modification des utilisateurs de l'organisation, affectation dépôt / camion.",
    group: "Administration",
    usedBy: ["admin"],
  },
  {
    key: "settings",
    label: "Paramètres",
    description: "Identité de l'entreprise, tarification et personnalisation des tableaux.",
    group: "Administration",
    usedBy: ["admin"],
    essential: true,
  },
  {
    key: "assistant",
    label: "Assistant IA",
    description: "Questions sur les données de l'organisation et préparation de paniers POS.",
    group: "Assistant IA",
    usedBy: ["admin"],
  },
  {
    key: "driverApp",
    label: "Vente en tournée (application chauffeur)",
    description: "Application des chauffeurs : tournée, vente, clients, stock camion et ventes du jour.",
    group: "Application chauffeur",
    usedBy: ["driver"],
  },
];

export function findModule(key: string): ModuleDefinition | undefined {
  return MODULES.find((module) => module.key === key);
}

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}

export function isEssentialModule(key: ModuleKey): boolean {
  return findModule(key)?.essential === true;
}

/**
 * Pages -> module, by path prefix (segment boundary: "/stock" covers
 * "/stock" and "/stock/...", never "/stockxyz"). The most specific prefix
 * wins ("/pos/versements" is "deposits", "/pos" is "pos"). A page that is not
 * listed belongs to no module and is always available (login, home, the
 * SUPER_ADMIN space, the mobile launcher...).
 */
export const PAGE_MODULE_RULES: ReadonlyArray<{ path: string; module: ModuleKey }> = [
  { path: "/dashboard", module: "dashboard" },
  { path: "/pos", module: "pos" },
  { path: "/pos/versements", module: "deposits" },
  { path: "/ventes", module: "salesArchive" },
  { path: "/ventes/journalieres", module: "dailyInvoices" },
  { path: "/ventes/commandes-en-ligne", module: "customerOrders" },
  { path: "/client", module: "customerOrders" },
  { path: "/avoirs", module: "creditNotes" },
  { path: "/produits", module: "products" },
  { path: "/categories", module: "products" },
  { path: "/stock", module: "stock" },
  { path: "/depots", module: "stock" },
  { path: "/inventaire", module: "inventory" },
  { path: "/chargements", module: "stockTransfers" },
  { path: "/tournees", module: "stockTransfers" },
  { path: "/camions", module: "trucks" },
  { path: "/trajets", module: "gps" },
  { path: "/achats", module: "purchases" },
  { path: "/comptes", module: "accounts" },
  { path: "/clients", module: "accounts" },
  { path: "/contacts", module: "contacts" },
  { path: "/employes", module: "employees" },
  { path: "/comptabilite", module: "accounting" },
  { path: "/comptes-comptables", module: "accounting" },
  { path: "/utilisateurs", module: "users" },
  { path: "/parametres", module: "settings" },
  { path: "/assistant-ia", module: "assistant" },
  { path: "/driver", module: "driverApp" },
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The module a page belongs to, or null (always available). */
export function moduleForPagePath(pathname: string | null | undefined): ModuleKey | null {
  if (!pathname) return null;
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  let best: { path: string; module: ModuleKey } | null = null;
  for (const rule of PAGE_MODULE_RULES) {
    if (matchesPrefix(path, rule.path) && (!best || rule.path.length > best.path.length)) best = rule;
  }
  return best?.module ?? null;
}

/**
 * The assistant's tools read data of other modules: each tool is allowed only
 * when at least one of its modules is enabled (an empty list = always).
 * Enforced by app/api/ai/chat (the tool is neither offered to the model nor
 * executed).
 */
export const ASSISTANT_TOOL_MODULES: Readonly<Record<string, readonly ModuleKey[]>> = {
  get_product_count: [],
  list_products: [],
  search_product: [],
  list_out_of_stock_products: ["stock"],
  list_low_stock_products: ["stock"],
  check_stock: ["stock"],
  get_sales_summary: ["dashboard", "salesArchive", "dailyInvoices"],
  get_top_selling_products: ["dashboard", "salesArchive", "dailyInvoices"],
  get_customer_receivables_summary: ["dashboard", "accounting"],
  list_top_customer_receivables: ["dashboard", "accounting"],
  get_customer_balance: ["dashboard", "accounting"],
  search_customer: ["accounts", "pos", "accounting"],
  get_invoice: ["salesArchive", "dailyInvoices"],
  prepare_pos_sale: ["pos"],
  get_purchase_recommendations: ["dashboard", "purchases"],
};
