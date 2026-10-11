import { PRODUCT_COLUMNS, type ProductColumnKey } from "@/lib/product-columns";

/**
 * Every table whose column labels an admin can rename (Paramètres ->
 * Personnalisation des tableaux), with the label each column shows by default
 * (= exactly what the table showed before this feature). Display only: a column
 * key never changes, nor does any property, query or database column.
 *
 * TABLE_COLUMNS describes a table component once; TABLE_PAGES says on which
 * page it appears and which of its columns that page shows. A configuration is
 * stored PER PAGE: the same component on two pages (the invoices table in
 * "Archives des factures" and "Factures journalières") is renamed independently.
 * Pure module: the browser, the server and the tests import it.
 */

const productColumns = Object.fromEntries(
  PRODUCT_COLUMNS.map((column) => [column.key, column.header]),
) as Record<ProductColumnKey, string>;

export const TABLE_COLUMNS = {
  // Dashboard
  topProducts: {
    label: "Top produits",
    columns: { product: "Produit", category: "Categorie", quantity: "Quantite", revenue: "CA", margin: "Marge" },
  },
  topCustomers: {
    label: "Top clients",
    columns: { customer: "Client", sales: "Ventes", revenue: "CA TTC", receivable: "Creance actuelle" },
  },
  forecastProducts: {
    label: "Prévisions d'achat",
    columns: {
      reference: "Référence",
      designation: "Désignation",
      currentStock: "Stock actuel",
      forecastSales: "Ventes prévues (7 j)",
      recommendedQty: "Qté recommandée",
      reliability: "Fiabilité",
    },
  },
  // Ventes & Caisse
  deposits: {
    label: "Historique des versements",
    columns: {
      number: "N° versement",
      date: "Date",
      time: "Heure",
      register: "POS / Caisse",
      cashier: "Caissier",
      cash: "Total especes",
      cheques: "Cheques",
      total: "Total",
      status: "Statut",
      actions: "Actions",
    },
  },
  archiveMonths: {
    label: "Mois",
    columns: {
      month: "Mois",
      year: "Année",
      orders: "Commandes",
      sold: "Total vendu",
      refunds: "Remboursements",
      net: "Total net",
    },
  },
  archiveSessions: {
    label: "Sessions",
    columns: {
      session: "Session",
      opened: "Ouverture",
      closed: "Fermeture",
      orders: "Commandes",
      sales: "Total ventes",
      refunds: "Remboursements",
      net: "Total net",
      status: "Statut",
      actions: "Actions",
    },
  },
  invoices: {
    label: "Factures",
    columns: {
      order: "Commande",
      date: "Date",
      customer: "Client",
      user: "Utilisateur",
      driverUser: "Chauffeur / utilisateur",
      items: "Articles",
      total: "Total",
      net: "Net",
      payment: "Paiement",
      status: "Statut",
      actions: "Actions",
    },
  },
  invoiceLines: {
    label: "Lignes d'une facture",
    columns: { product: "Produit", unitPrice: "Prix TTC", quantity: "Qté", total: "Total TTC" },
  },
  customerOrders: {
    label: "Commandes",
    columns: {
      order: "Commande",
      date: "Date",
      customer: "Client",
      items: "Articles",
      estimatedTotal: "Total estimé",
      status: "Statut",
      actions: "Actions",
    },
  },
  customerOrderLines: {
    label: "Détail d'une commande",
    columns: { product: "Produit", quantity: "Qté", estimatedTotal: "Total estimé" },
  },
  creditNotes: {
    label: "Historique des avoirs",
    columns: {
      number: "N° avoir",
      date: "Date",
      customer: "Client",
      supplier: "Fournisseur",
      products: "Produits",
      amount: "Montant",
      stockDestination: "Destination stock",
      stockSource: "Stock source",
      status: "Statut",
      user: "Utilisateur",
      actions: "Actions",
    },
  },
  // Produit / Catégorie
  products: {
    label: "Catalogue produits",
    columns: { ...productColumns, actions: "Actions" },
  },
  categories: {
    label: "Catégories",
    columns: {
      reference: "Réf catégorie",
      designation: "Désignation catégorie",
      productCount: "Nombre de produits",
      status: "Statut",
      actions: "Actions",
    },
  },
  // Stock & Logistique
  warehouseStock: {
    label: "Stock du dépôt",
    columns: {
      product: "Produit",
      category: "Categorie",
      currentStock: "Stock actuel",
      minimumStock: "Stock minimum",
      value: "Valeur",
      status: "Statut",
    },
  },
  stockMovements: {
    label: "Mouvements de stock",
    columns: {
      date: "Date",
      number: "N°",
      product: "Produit",
      location: "Emplacement",
      before: "Avant",
      after: "Apres",
      difference: "Ecart",
      reason: "Motif",
      origin: "Origine",
      destination: "Destination",
      user: "Utilisateur",
      type: "Type",
    },
  },
  truckStock: {
    label: "Stock camion",
    columns: {
      product: "Produit",
      quantity: "Quantite",
      available: "Disponible",
      value: "Valeur",
      updatedAt: "Derniere MAJ",
      actions: "Actions",
    },
  },
  depots: {
    label: "Dépôts",
    columns: { code: "Code", name: "Nom", status: "Statut", stockLocation: "Emplacement de stock associé" },
  },
  inventories: {
    label: "Inventaires",
    columns: {
      number: "Numero",
      status: "Statut",
      date: "Date",
      lines: "Lignes",
      value: "Valeur inventaire",
      stockBefore: "Stock avant",
      difference: "Difference",
      user: "Utilisateur",
      actions: "Actions",
    },
  },
  trucks: {
    label: "Camions",
    columns: {
      code: "Code",
      registration: "Immatriculation",
      brand: "Marque",
      model: "Modele",
      depot: "Depot",
      location: "Emplacement",
      capacity: "Capacite",
      status: "Statut",
      actions: "Actions",
    },
  },
  loadingLines: {
    label: "Feuille de transfert",
    columns: {
      product: "Produit",
      price: "Prix",
      depotStock: "Stock depot",
      initialLoad: "Charge initiale",
      reload: "Rechargee",
      theoreticalRemaining: "Restante theorique",
      actualRemaining: "Restante reelle",
      action: "Action",
    },
  },
  loadingsHistory: {
    label: "Historique des transferts",
    columns: {
      number: "Numero",
      date: "Date",
      driver: "Chauffeur",
      truck: "Camion",
      tour: "Tournee",
      depot: "Depot",
      products: "Produits",
      quantity: "Quantite",
      opened: "Ouverture",
      closed: "Fermeture",
      status: "Statut",
      actions: "Actions",
    },
  },
  loadingDetail: {
    label: "Détail d'un transfert",
    columns: {
      product: "Produit",
      departureStock: "Stock depart",
      initialLoad: "Charge initiale",
      reload: "Recharge",
      theoreticalRemaining: "Restant theorique",
      actualRemaining: "Restant reel",
      action: "Action",
    },
  },
  tourVisits: {
    label: "Visites de la tournée",
    columns: {
      order: "N°",
      customer: "Client",
      time: "Heure",
      status: "Statut",
      firstSale: "Première vente",
      sale: "Vente",
      amount: "Montant",
    },
  },
  // Achats
  purchases: {
    label: "Historique des achats",
    columns: {
      number: "N° Achat",
      date: "Date",
      supplier: "Fournisseur",
      user: "Utilisateur",
      amountHT: "Montant HT",
      vat: "TVA",
      amountTTC: "Montant TTC",
      payment: "Règlement",
      status: "Statut",
      actions: "Actions",
    },
  },
  // Clients & fournisseurs
  accounts: {
    label: "Comptes",
    columns: {
      accountNumber: "N° compte",
      name: "Nom du compte",
      type: "Type de compte",
      phone: "Telephone",
      creditLimit: "Plafond",
      createdAt: "Date de creation",
      createdBy: "Cree par",
      actions: "Actions",
    },
  },
  contacts: {
    label: "Contacts",
    columns: {
      reference: "Reference",
      fullName: "Nom complet",
      supplierReference: "Reference fournisseur",
      phone1: "Telephone 1",
      phone2: "Telephone 2",
      email: "Email",
      status: "Statut",
      actions: "Actions",
    },
  },
  // Employés
  employees: {
    label: "Employés",
    columns: {
      code: "Code employe",
      fullName: "Nom complet",
      hireDate: "Date embauche",
      salary: "Salaire",
      phone: "Telephone",
      advanceAccountCode: "Code compte avance",
      advanceAccountName: "Nom compte avance",
      salaryAccountCode: "Code compte salaire",
      salaryAccountName: "Nom compte salaire",
      status: "Statut",
      actions: "Actions",
    },
  },
  payrollHistory: {
    label: "Avances et salaires",
    columns: {
      number: "N°",
      date: "Date",
      period: "Periode",
      employee: "Employe",
      employeeCode: "Code employe",
      type: "Type",
      amount: "Montant",
      status: "Statut",
      user: "Utilisateur",
      comment: "Commentaire",
      journal: "Journal",
      actions: "Actions",
    },
  },
  // Comptabilité
  journal: {
    label: "Journal",
    columns: {
      operationNumber: "N° operation",
      operationDate: "Date operation",
      accountNumber: "N° compte",
      designation: "Designation",
      debit: "Debit",
      credit: "Credit",
      chequeNumber: "N° cheque",
      actions: "Actions",
    },
  },
  entryLines: {
    label: "Lignes de l'écriture",
    columns: {
      accountNumber: "N° compte",
      designation: "Désignation",
      accountName: "Nom du compte",
      debit: "Débit",
      credit: "Crédit",
    },
  },
  customerJournal: {
    label: "Opérations du client",
    columns: {
      date: "Date",
      operationNumber: "N° opération",
      accountNumber: "N° compte",
      designation: "Désignation",
      user: "Utilisateur",
      debit: "Débit",
      credit: "Crédit",
      balance: "Solde",
    },
  },
  customerBalances: {
    label: "Solde clients",
    columns: {
      accountNumber: "N° compte",
      accountName: "Nom du compte",
      balance: "Solde",
      createdBy: "Créé par",
      settlement: "Règlement",
    },
  },
  accountingAccounts: {
    label: "Comptes comptables",
    columns: {
      code: "Code",
      name: "Nom du compte",
      type: "Type",
      status: "Statut",
      movements: "Mouvements",
      actions: "Actions",
    },
  },
  // Administration
  users: {
    label: "Utilisateurs",
    columns: {
      name: "Nom",
      email: "Email",
      role: "Rôle",
      status: "Statut",
      lastLogin: "Dernière connexion",
      actions: "Actions",
    },
  },
} as const satisfies Record<string, { label: string; columns: Record<string, string> }>;

export type TableKey = keyof typeof TABLE_COLUMNS;
export type TableColumnKey<T extends TableKey> = keyof (typeof TABLE_COLUMNS)[T]["columns"] & string;

export type TablePageTable = {
  table: TableKey;
  /** The columns this page shows, in order. Absent = every column of the table. */
  columns?: readonly string[];
};

export type TablePage = {
  key: string;
  label: string;
  href: string;
  /** Only this exact path (a sibling page lives under the same prefix). */
  exact?: boolean;
  tables: readonly TablePageTable[];
};

const ALL_PRODUCT_COLUMNS = [...PRODUCT_COLUMNS.map((column) => column.key), "actions"];

/** Every page with a renamable table, in menu order. Labels = the menu entries. */
export const TABLE_PAGES = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", tables: [{ table: "topProducts" }, { table: "topCustomers" }, { table: "forecastProducts" }] },
  { key: "deposits", label: "Versements", href: "/pos/versements", tables: [{ table: "deposits" }] },
  {
    key: "salesArchive",
    label: "Archives des factures",
    href: "/ventes",
    exact: true,
    tables: [
      { table: "archiveMonths" },
      { table: "archiveSessions" },
      { table: "invoices", columns: ["order", "date", "customer", "driverUser", "items", "total", "net", "payment", "status", "actions"] },
      { table: "invoiceLines" },
    ],
  },
  {
    key: "dailyInvoices",
    label: "Factures journalières",
    href: "/ventes/journalieres",
    tables: [
      { table: "invoices", columns: ["order", "date", "customer", "user", "items", "total", "payment", "status", "actions"] },
      { table: "invoiceLines" },
    ],
  },
  { key: "customerOrders", label: "Commandes en ligne", href: "/ventes/commandes-en-ligne", tables: [{ table: "customerOrders" }, { table: "customerOrderLines" }] },
  { key: "creditNotes", label: "Avoir client / fournisseur", href: "/avoirs", tables: [{ table: "creditNotes" }] },
  { key: "products", label: "Produits", href: "/produits", tables: [{ table: "products", columns: ALL_PRODUCT_COLUMNS }] },
  { key: "categories", label: "Catégories", href: "/categories", tables: [{ table: "categories" }] },
  { key: "stock", label: "Stock", href: "/stock", tables: [{ table: "warehouseStock" }, { table: "stockMovements" }, { table: "truckStock" }] },
  { key: "depots", label: "Dépôts", href: "/depots", tables: [{ table: "depots" }] },
  { key: "inventory", label: "Inventaire", href: "/inventaire", tables: [{ table: "inventories" }] },
  { key: "trucks", label: "Camions", href: "/camions", tables: [{ table: "trucks" }] },
  { key: "loadings", label: "Transferts de Stock", href: "/chargements", tables: [{ table: "loadingLines" }, { table: "loadingsHistory" }, { table: "loadingDetail" }] },
  { key: "tourVisits", label: "Trajets", href: "/trajets", tables: [{ table: "tourVisits" }] },
  { key: "purchases", label: "Historique des achats", href: "/achats", exact: true, tables: [{ table: "purchases" }] },
  { key: "accounts", label: "Comptes", href: "/comptes", tables: [{ table: "accounts" }] },
  { key: "contacts", label: "Contacts", href: "/contacts", tables: [{ table: "contacts" }] },
  {
    key: "employees",
    label: "Employés",
    href: "/employes",
    tables: [
      { table: "employees" },
      // the payroll history of ONE employee (detail page): no employee columns
      { table: "payrollHistory", columns: ["number", "date", "period", "type", "amount", "status", "user", "comment", "journal", "actions"] },
    ],
  },
  { key: "payroll", label: "Avances / Salaire", href: "/employes/avances-salaire", tables: [{ table: "payrollHistory" }] },
  { key: "journal", label: "Journal", href: "/comptabilite/journal", tables: [{ table: "journal" }] },
  { key: "entries", label: "Écriture comptable", href: "/comptabilite/ecritures", tables: [{ table: "entryLines" }] },
  { key: "settlements", label: "Règlements clients", href: "/comptabilite/reglements-clients", tables: [{ table: "customerJournal" }] },
  { key: "balances", label: "Solde clients", href: "/comptabilite/solde-clients", tables: [{ table: "customerBalances" }] },
  { key: "ledgerAccounts", label: "Comptes comptables", href: "/comptabilite/comptes", tables: [{ table: "accountingAccounts" }] },
  { key: "users", label: "Utilisateurs", href: "/utilisateurs", tables: [{ table: "users" }] },
] as const satisfies readonly TablePage[];

export type TablePageKey = (typeof TABLE_PAGES)[number]["key"];

export function findTablePage(key: string): TablePage | undefined {
  return (TABLE_PAGES as readonly TablePage[]).find((page) => page.key === key);
}

/** The page a pathname belongs to: the most specific matching href. */
export function tablePageForPath(pathname: string | null | undefined): TablePage | undefined {
  if (!pathname) return undefined;
  let best: TablePage | undefined;
  for (const page of TABLE_PAGES as readonly TablePage[]) {
    const matches = page.exact
      ? pathname === page.href
      : pathname === page.href || pathname.startsWith(`${page.href}/`);
    if (matches && (!best || page.href.length > best.href.length)) best = page;
  }
  return best;
}

/** The columns a page shows for one of its tables, with their default label. */
export function pageTableColumns(pageTable: TablePageTable): Array<{ key: string; defaultLabel: string }> {
  const columns = TABLE_COLUMNS[pageTable.table].columns as Record<string, string>;
  const keys = pageTable.columns ?? Object.keys(columns);
  return keys.map((key) => ({ key, defaultLabel: columns[key] }));
}

export function defaultColumnLabel(table: TableKey, column: string): string {
  return (TABLE_COLUMNS[table].columns as Record<string, string>)[column] ?? column;
}
