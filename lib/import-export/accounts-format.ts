import { findColumn, headerKey, readBoolean, readCoordinates, readDate, readDecimal, readText } from "@/lib/import-export/cells";
import type { CellValue, TableColumn, TableRow } from "@/lib/import-export/tabular";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";

/**
 * THE file format of the accounts export / import (feuille "Comptes", or the
 * same columns in a CSV) - pure.
 *
 * Historical headers kept EXACTLY: N_compte, Nom_Compte, Type_Compte, Tel - a
 * file with only those four columns imports exactly as before. Every other
 * column is optional; a column that does not apply to the line's type is
 * ignored (and reported as a warning).
 *
 * Identification in the DESTINATION organisation: the business code + the
 * account type (never an internal id). Absent column or empty cell = keep the
 * stored value (phone, e-mail, address, GPS, ...).
 *
 * GPS: two named columns, Latitude and Longitude (never read by position, so
 * never swapped), both or none, -90..90 / -180..180, up to 7 decimals (the
 * database precision), decimal comma or point.
 */

export type AccountTypeCode = "CUSTOMER" | "SUPPLIER" | "EXPENSE" | "TREASURY" | "EMPLOYEE";
export const ACCOUNT_TYPES: readonly AccountTypeCode[] = ["CUSTOMER", "SUPPLIER", "EXPENSE", "TREASURY", "EMPLOYEE"];

export const ACCOUNT_TYPE_LABELS: Record<AccountTypeCode, string> = {
  CUSTOMER: "Client",
  SUPPLIER: "Fournisseur",
  EXPENSE: "Charge",
  TREASURY: "Trésorerie",
  EMPLOYEE: "Employé",
};

/** Accepted Type_Compte values (singular / plural, FR / EN), compared with headerKey. */
const TYPE_BY_KEY: Record<string, AccountTypeCode> = {
  client: "CUSTOMER",
  clients: "CUSTOMER",
  customer: "CUSTOMER",
  customers: "CUSTOMER",
  fournisseur: "SUPPLIER",
  fournisseurs: "SUPPLIER",
  supplier: "SUPPLIER",
  suppliers: "SUPPLIER",
  charge: "EXPENSE",
  charges: "EXPENSE",
  expense: "EXPENSE",
  expenses: "EXPENSE",
  tresorerie: "TREASURY",
  tresoreries: "TREASURY",
  treasury: "TREASURY",
  employe: "EMPLOYEE",
  employes: "EMPLOYEE",
  employee: "EMPLOYEE",
  employees: "EMPLOYEE",
  salarie: "EMPLOYEE",
  salaries: "EMPLOYEE",
};

export function accountTypeFromLabel(value: unknown): AccountTypeCode | null {
  return TYPE_BY_KEY[headerKey(value)] ?? null;
}

export type CustomerTypeCode = "GROCERY" | "CAFE" | "RESTAURANT" | "SUPERMARKET" | "WHOLESALER" | "COUNTER" | "OTHER";
export const CUSTOMER_TYPE_LABELS: Record<CustomerTypeCode, string> = {
  GROCERY: "Epicerie",
  CAFE: "Cafe",
  RESTAURANT: "Restaurant",
  SUPERMARKET: "Supermarche",
  WHOLESALER: "Grossiste",
  COUNTER: "Client comptoir",
  OTHER: "Autre",
};
const CUSTOMER_TYPE_BY_KEY: Record<string, CustomerTypeCode> = Object.fromEntries(
  (Object.entries(CUSTOMER_TYPE_LABELS) as Array<[CustomerTypeCode, string]>).flatMap(([code, label]) => [
    [headerKey(label), code],
    [headerKey(code), code],
  ]),
);
CUSTOMER_TYPE_BY_KEY.comptoir = "COUNTER";

export type TreasuryKindCode = "CASH" | "BANK";
export const TREASURY_KIND_LABELS: Record<TreasuryKindCode, string> = { CASH: "Caisse", BANK: "Banque" };
const TREASURY_KIND_BY_KEY: Record<string, TreasuryKindCode> = { caisse: "CASH", cash: "CASH", especes: "CASH", banque: "BANK", bank: "BANK" };

export type AccountStatusCode = "ACTIVE" | "INACTIVE" | "BLOCKED";
export const ACCOUNT_STATUS_LABELS: Record<AccountStatusCode, string> = { ACTIVE: "Actif", INACTIVE: "Inactif", BLOCKED: "Bloqué" };
const STATUS_BY_KEY: Record<string, AccountStatusCode> = {
  actif: "ACTIVE",
  active: "ACTIVE",
  inactif: "INACTIVE",
  inactive: "INACTIVE",
  bloque: "BLOCKED",
  blocked: "BLOCKED",
};

/** One line of the accounts import as sent to the server: a missing key = "keep what is stored". */
export type AccountImportLine = {
  excelRow: number;
  code: string;
  type: AccountTypeCode;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  /** Always both or neither. */
  latitude?: number;
  longitude?: number;
  ice?: string;
  taxId?: string;
  contactName?: string;
  customerType?: CustomerTypeCode;
  creditLimit?: number;
  creditLimitEnabled?: boolean;
  notes?: string;
  description?: string;
  category?: string;
  treasuryKind?: TreasuryKindCode;
  hireDate?: string;
  salary?: number;
  advanceAccountCode?: string;
  salaryAccountCode?: string;
  accountStatus?: AccountStatusCode;
};

export type AccountField = Exclude<keyof AccountImportLine, "excelRow" | "code" | "type" | "longitude">;

export type AccountColumnKey =
  | "code"
  | "name"
  | "type"
  | "phone"
  | "email"
  | "address"
  | "city"
  | "latitude"
  | "longitude"
  | "ice"
  | "taxId"
  | "contactName"
  | "customerType"
  | "creditLimit"
  | "creditLimitEnabled"
  | "notes"
  | "description"
  | "category"
  | "treasuryKind"
  | "hireDate"
  | "salary"
  | "advanceAccountCode"
  | "salaryAccountCode"
  | "status";

export type AccountColumnDefinition = {
  key: AccountColumnKey;
  header: string;
  aliases: readonly string[];
  label: string;
  kind: TableColumn["kind"];
  /** The account types this column applies to (empty = every type). */
  types: readonly AccountTypeCode[];
  locked?: boolean;
  /** Part of the GPS group (exported only when GPS is included). */
  gps?: boolean;
};

const ALL: readonly AccountTypeCode[] = [];
export const ACCOUNT_COLUMNS: readonly AccountColumnDefinition[] = [
  { key: "code", header: "N_compte", aliases: ["n° compte", "numero compte", "code"], label: "Code du compte", kind: "text", types: ALL, locked: true },
  { key: "name", header: "Nom_Compte", aliases: ["nom"], label: "Nom", kind: "text", types: ALL, locked: true },
  { key: "type", header: "Type_Compte", aliases: ["type compte"], label: "Type de compte", kind: "text", types: ALL, locked: true },
  { key: "phone", header: "Tel", aliases: ["telephone", "téléphone", "phone"], label: "Téléphone", kind: "text", types: ["CUSTOMER", "SUPPLIER", "EMPLOYEE"] },
  { key: "email", header: "Email", aliases: ["e-mail", "mail"], label: "Email", kind: "text", types: ["CUSTOMER", "SUPPLIER"] },
  { key: "address", header: "Adresse", aliases: ["address"], label: "Adresse", kind: "text", types: ["CUSTOMER", "SUPPLIER"] },
  { key: "city", header: "Ville", aliases: ["city"], label: "Ville", kind: "text", types: ["CUSTOMER", "SUPPLIER"] },
  { key: "latitude", header: "Latitude", aliases: ["lat"], label: "Latitude", kind: "number", types: ["CUSTOMER"], gps: true },
  { key: "longitude", header: "Longitude", aliases: ["lng", "lon"], label: "Longitude", kind: "number", types: ["CUSTOMER"], gps: true },
  { key: "ice", header: "ICE", aliases: [], label: "ICE", kind: "text", types: ["CUSTOMER", "SUPPLIER"] },
  { key: "taxId", header: "IF", aliases: ["identifiant fiscal"], label: "Identifiant fiscal (IF)", kind: "text", types: ["CUSTOMER", "SUPPLIER"] },
  { key: "contactName", header: "Contact", aliases: ["nom contact"], label: "Contact", kind: "text", types: ["CUSTOMER"] },
  { key: "customerType", header: "Categorie_Client", aliases: ["type client"], label: "Catégorie client", kind: "text", types: ["CUSTOMER"] },
  { key: "creditLimit", header: "Plafond_Credit", aliases: ["plafond crédit"], label: "Plafond de crédit", kind: "number", types: ["CUSTOMER"] },
  { key: "creditLimitEnabled", header: "Plafond_Credit_Actif", aliases: [], label: "Plafond de crédit actif", kind: "text", types: ["CUSTOMER"] },
  { key: "notes", header: "Notes", aliases: [], label: "Notes", kind: "text", types: ["CUSTOMER"] },
  { key: "description", header: "Description", aliases: [], label: "Description (charge)", kind: "text", types: ["EXPENSE"] },
  { key: "category", header: "Categorie_Charge", aliases: ["catégorie charge"], label: "Catégorie (charge)", kind: "text", types: ["EXPENSE"] },
  { key: "treasuryKind", header: "Nature_Tresorerie", aliases: ["nature trésorerie"], label: "Nature (trésorerie)", kind: "text", types: ["TREASURY"] },
  { key: "hireDate", header: "Date_Embauche", aliases: ["date d'embauche"], label: "Date d'embauche", kind: "text", types: ["EMPLOYEE"] },
  { key: "salary", header: "Salaire", aliases: [], label: "Salaire", kind: "number", types: ["EMPLOYEE"] },
  { key: "advanceAccountCode", header: "Compte_Avance", aliases: ["compte avance"], label: "Compte avance (employé)", kind: "text", types: ["EMPLOYEE"] },
  { key: "salaryAccountCode", header: "Compte_Salaire", aliases: ["compte salaire"], label: "Compte salaire (employé)", kind: "text", types: ["EMPLOYEE"] },
  { key: "status", header: "Statut", aliases: ["status"], label: "Statut", kind: "text", types: ALL },
];

export const ACCOUNT_SHEET_NAME = "Comptes";

export function accountColumn(key: AccountColumnKey): AccountColumnDefinition {
  return ACCOUNT_COLUMNS.find((column) => column.key === key)!;
}

const appliesTo = (column: AccountColumnDefinition, type: AccountTypeCode) => column.types.length === 0 || column.types.includes(type);

/** The columns to write, in the format's order (code, name and type always included). */
export function orderedAccountColumns(selected: Iterable<AccountColumnKey>, includeGps: boolean): AccountColumnDefinition[] {
  const wanted = new Set(selected);
  return ACCOUNT_COLUMNS.filter((column) => column.locked || (column.gps ? includeGps : wanted.has(column.key)));
}

// ---------------------------------------------------------------- export

/** One account as the export API gives it - business values only, never an id. */
export type AccountExportRow = {
  type: AccountTypeCode;
  code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  ice?: string | null;
  taxId?: string | null;
  contactName?: string | null;
  customerType?: CustomerTypeCode | null;
  creditLimit?: number | null;
  creditLimitEnabled?: boolean | null;
  notes?: string | null;
  description?: string | null;
  category?: string | null;
  treasuryKind?: TreasuryKindCode | null;
  hireDate?: string | null;
  salary?: number | null;
  advanceAccountCode?: string | null;
  salaryAccountCode?: string | null;
  status?: AccountStatusCode | null;
};

export function accountExportCells(row: AccountExportRow, columns: readonly AccountColumnDefinition[]): CellValue[] {
  return columns.map((column) => {
    if (!appliesTo(column, row.type)) return null;
    switch (column.key) {
      case "type":
        return ACCOUNT_TYPE_LABELS[row.type];
      case "customerType":
        return row.customerType ? CUSTOMER_TYPE_LABELS[row.customerType] : null;
      case "treasuryKind":
        return row.treasuryKind ? TREASURY_KIND_LABELS[row.treasuryKind] : null;
      case "status":
        return row.status ? ACCOUNT_STATUS_LABELS[row.status] : null;
      case "creditLimitEnabled":
        return row.creditLimitEnabled === null || row.creditLimitEnabled === undefined ? null : row.creditLimitEnabled ? "Oui" : "Non";
      default:
        return (row[column.key] as CellValue) ?? null;
    }
  });
}

// ---------------------------------------------------------------- import

export type ParsedAccountLine = {
  /** null when the line could not be read far enough to have a code and a type. */
  line: AccountImportLine | null;
  excelRow: number;
  rawType: string;
  errors: string[];
  warnings: string[];
};

export type ParsedAccountTable = {
  present: Set<AccountColumnKey>;
  lines: ParsedAccountLine[];
  fatal?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAccountTable(headers: readonly unknown[], rows: readonly TableRow[]): ParsedAccountTable {
  const index = new Map<AccountColumnKey, number>();
  for (const column of ACCOUNT_COLUMNS) {
    const found = findColumn(headers, [column.header, ...column.aliases]);
    if (found >= 0) index.set(column.key, found);
  }
  const present = new Set(index.keys());
  const missing = (["code", "type"] as const).filter((key) => !present.has(key)).map((key) => accountColumn(key).header);
  if (missing.length) return { present, lines: [], fatal: `Colonne(s) obligatoire(s) absente(s) : ${missing.join(", ")}.` };

  const lines: ParsedAccountLine[] = [];
  for (const row of rows) {
    const cell = (key: AccountColumnKey) => (index.has(key) ? row.cells[index.get(key)!] : undefined);
    const errors: string[] = [];
    const warnings: string[] = [];
    const code = readText(cell("code")) ?? "";
    const rawType = readText(cell("type")) ?? "";
    const type = rawType ? accountTypeFromLabel(rawType) : null;
    if (!code) errors.push("N_compte vide");
    if (!rawType) errors.push("Type_Compte vide");
    else if (!type) errors.push(`Type_Compte non reconnu : ${rawType}`);
    if (!type || !code) {
      lines.push({ line: null, excelRow: row.line, rawType, errors, warnings });
      continue;
    }

    const line: AccountImportLine = { excelRow: row.line, code, type };
    const applicable = (key: AccountColumnKey) => {
      if (!index.has(key)) return false;
      const column = accountColumn(key);
      if (appliesTo(column, type)) return true;
      if (readText(cell(key)) !== undefined) warnings.push(`${column.header} ignoré pour un compte ${ACCOUNT_TYPE_LABELS[type].toLowerCase()}`);
      return false;
    };
    const text = (key: "name" | "phone" | "address" | "city" | "ice" | "taxId" | "contactName" | "notes" | "description" | "category" | "advanceAccountCode" | "salaryAccountCode", max: number) => {
      if (!applicable(key)) return;
      const value = readText(cell(key));
      if (value === undefined) return;
      if (value.length > max) errors.push(`${accountColumn(key).header} trop long (${max} caractères maximum)`);
      else line[key] = value;
    };
    text("name", 160);
    text("phone", 40);
    text("address", 300);
    text("city", 120);
    text("ice", 40);
    text("taxId", 40);
    text("contactName", 160);
    text("notes", 2000);
    text("description", 500);
    text("category", 120);
    text("advanceAccountCode", 24);
    text("salaryAccountCode", 24);

    if (applicable("email")) {
      const email = readText(cell("email"));
      if (email !== undefined) {
        if (!EMAIL_RE.test(email)) errors.push(`Email invalide : ${email}`);
        else line.email = email;
      }
    }
    if (index.has("latitude") || index.has("longitude")) {
      if (type === "CUSTOMER") {
        const gps = readCoordinates(cell("latitude"), cell("longitude"));
        if (gps.kind === "error") errors.push(gps.message);
        else if (gps.kind === "value") {
          line.latitude = gps.latitude;
          line.longitude = gps.longitude;
        }
      } else if (readText(cell("latitude")) !== undefined || readText(cell("longitude")) !== undefined) {
        warnings.push(`Latitude / Longitude ignorées pour un compte ${ACCOUNT_TYPE_LABELS[type].toLowerCase()}`);
      }
    }
    if (applicable("customerType")) {
      const value = readText(cell("customerType"));
      if (value !== undefined) {
        const code = CUSTOMER_TYPE_BY_KEY[headerKey(value)];
        if (!code) errors.push(`Categorie_Client non reconnue : ${value}`);
        else line.customerType = code;
      }
    }
    if (applicable("creditLimit")) {
      const value = readDecimal(cell("creditLimit"));
      if (value !== undefined) {
        if (value === null || value < 0 || value > MONEY_RANGE_MAX_NUMBER) errors.push("Plafond_Credit invalide (montant positif ou nul attendu)");
        else line.creditLimit = value;
      }
    }
    if (applicable("creditLimitEnabled")) {
      const value = readBoolean(cell("creditLimitEnabled"));
      if (value === null) errors.push("Plafond_Credit_Actif invalide (Oui ou Non attendu)");
      else if (value !== undefined) line.creditLimitEnabled = value;
    }
    if (applicable("treasuryKind")) {
      const value = readText(cell("treasuryKind"));
      if (value !== undefined) {
        const kind = TREASURY_KIND_BY_KEY[headerKey(value)];
        if (!kind) errors.push(`Nature_Tresorerie non reconnue : ${value} (Caisse ou Banque attendu)`);
        else line.treasuryKind = kind;
      }
    }
    if (applicable("hireDate")) {
      const value = readDate(cell("hireDate"));
      if (value === null) errors.push("Date_Embauche invalide (AAAA-MM-JJ ou JJ/MM/AAAA attendu)");
      else if (value !== undefined) line.hireDate = value;
    }
    if (applicable("salary")) {
      const value = readDecimal(cell("salary"));
      if (value !== undefined) {
        if (value === null || value < 0 || value > MONEY_RANGE_MAX_NUMBER) errors.push("Salaire invalide (montant positif ou nul attendu)");
        else line.salary = value;
      }
    }
    if (applicable("status")) {
      const value = readText(cell("status"));
      if (value !== undefined) {
        const status = STATUS_BY_KEY[headerKey(value)];
        if (!status) errors.push(`Statut non reconnu : ${value}`);
        else if (status === "BLOCKED" && type !== "CUSTOMER") errors.push("Le statut Bloqué ne concerne que les clients");
        else line.accountStatus = status;
      }
    }
    lines.push({ line, excelRow: row.line, rawType, errors, warnings });
  }
  return { present, lines };
}
