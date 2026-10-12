import { z } from "zod";

import { normalizeAccountCode, resolveCustomerAuxiliaryCode, resolveSupplierAuxiliaryCode } from "@/lib/accounting-codes";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { AccountImportLine, AccountTypeCode } from "@/lib/import-export/accounts-format";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { resolveOrCreateAccountingLink } from "@/lib/server/business-accounts-core";
import {
  assertUniqueEmployeeCode,
  buildEmployeeAdvanceAccountName,
  buildEmployeeSalaryAccountName,
  parseEmployeeDate,
  resolveEmployeeAccountingLink,
  validateEmployeeInput,
} from "@/lib/server/employee-core";
import { OperationsServiceError } from "@/lib/server/service-error";
import type { AccountingAccountType } from "@/types/accounting";

/**
 * The accounts import (feuille "Comptes" / CSV) for ONE organisation that the
 * caller has already authorised - the database client is injected (the real
 * one, or a transaction the tests roll back). Shared by both endpoints so they
 * can never drift apart:
 *   - POST /api/comptes/import/preview -> classifyAccountImportRowsWith (read only)
 *   - POST /api/comptes/import         -> it re-classifies the file itself and
 *     applies THAT result (applyAccountImportRows), never the browser's statuses.
 *
 * IDENTIFICATION: an account is matched in the DESTINATION organisation by its
 * business code AND its type (Customer.code / Supplier.code / ExpenseAccount.code
 * / TreasuryAccount.code / Employee.employeeCode) - never by an internal id.
 * Found -> EXISTING_UPDATE (only the fields the file carries, shown old -> new)
 * or EXISTING_UNCHANGED; not found -> NEW.
 *
 * RULES REUSED, not re-invented:
 *   - customers / suppliers / charges: the creation the import always did, plus
 *     the optional fields; their auxiliary ledger accounts are created through
 *     resolveOrCreateAccountingLink (lib/server/business-accounts-core.ts, the
 *     /comptes form's rule) with the same codes (3421..., 4411..., the charge code);
 *   - treasury: the /comptes form's rule - nature (Caisse / Banque) required, its
 *     code is its ledger account (type TREASURY), balance 0 (a balance is never
 *     imported);
 *   - employees: the /employes rules (lib/server/employee-core.ts, used by
 *     createEmployee / updateEmployee): code, full name, two DISTINCT accounts -
 *     advance (RECEIVABLE) and salary (PAYABLE) - created or reused; admin only,
 *     like /employes.
 *
 * EMPTY = UNCHANGED: a field absent from the line (column missing or cell empty)
 * is never written. GPS is written only as a full, valid pair.
 */

export const ACCOUNT_IMPORT_MAX_ROWS = 2000;

type Db = Prisma.TransactionClient;

const absentIfEmpty = (value: unknown) => (value === null || value === "" ? undefined : value);
const optionalText = (max: number) => z.preprocess(absentIfEmpty, z.string().trim().min(1).max(max).optional());

export const accountImportRowSchema = z
  .object({
    excelRow: z.number().int().positive(),
    code: z.string().trim().min(1).max(60),
    type: z.enum(["CUSTOMER", "SUPPLIER", "EXPENSE", "TREASURY", "EMPLOYEE"]),
    name: optionalText(160),
    // phone: null / "" (older clients) = absent
    phone: optionalText(40),
    email: z.preprocess(absentIfEmpty, z.string().trim().email().max(200).optional()),
    address: optionalText(300),
    city: optionalText(120),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    ice: optionalText(40),
    taxId: optionalText(40),
    contactName: optionalText(160),
    customerType: z.enum(["GROCERY", "CAFE", "RESTAURANT", "SUPERMARKET", "WHOLESALER", "COUNTER", "OTHER"]).optional(),
    creditLimit: z.number().finite().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
    creditLimitEnabled: z.boolean().optional(),
    notes: optionalText(2000),
    description: optionalText(500),
    category: optionalText(120),
    treasuryKind: z.enum(["CASH", "BANK"]).optional(),
    hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    salary: z.number().finite().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
    advanceAccountCode: optionalText(24),
    salaryAccountCode: optionalText(24),
    accountStatus: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).optional(),
  })
  .refine((row) => (row.latitude === undefined) === (row.longitude === undefined), {
    message: "Latitude et Longitude doivent être renseignées ensemble.",
    path: ["latitude"],
  });

export const accountImportSchema = z.object({
  rows: z.array(accountImportRowSchema).max(ACCOUNT_IMPORT_MAX_ROWS),
});

export type AccountImportRow = AccountImportLine;

export type ClassifiedStatus = "NEW" | "EXISTING_UNCHANGED" | "EXISTING_UPDATE" | "CONFLICT" | "ERROR";
export type AccountImportChange = { old: string | null; new: string | null };

export type ClassifiedAccountRow = AccountImportLine & {
  /** The ledger account(s) the line uses / will create (display). */
  accountingCode: string | null;
  status: ClassifiedStatus;
  message: string;
  changes: Record<string, AccountImportChange>;
  /**
   * Id of the existing account this line matched (same code AND same type).
   * Only set for EXISTING_*, and always from the organisation-scoped preload
   * below - never from the request body.
   */
  existingId: string | null;
};

export type AccountImportSummary = {
  total: number;
  new: number;
  unchanged: number;
  update: number;
  conflicts: number;
  errors: number;
};

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Actif", INACTIVE: "Inactif", BLOCKED: "Bloqué" };
const fmtCoordinate = (value: number) => value.toFixed(7).replace(/\.?0+$/, "");

/** The ledger account a line uses (display only - the write resolves it again). */
function displayAccountingCode(row: AccountImportLine): string | null {
  switch (row.type) {
    case "CUSTOMER":
      return resolveCustomerAuxiliaryCode(row.code);
    case "SUPPLIER":
      return resolveSupplierAuxiliaryCode(row.code);
    case "EXPENSE":
    case "TREASURY": {
      const code = normalizeAccountCode(row.code);
      return /^\d+$/.test(code) ? code : null;
    }
    case "EMPLOYEE":
      return row.advanceAccountCode || row.salaryAccountCode
        ? `${row.advanceAccountCode ?? "?"} / ${row.salaryAccountCode ?? "?"}`
        : null;
  }
}

/** The ledger accounts a NEW line would create, with the type they must have. */
function requiredLedgerAccounts(row: AccountImportLine): Array<{ code: string; type: AccountingAccountType; label: string }> {
  const numeric = (code: string) => /^\d+$/.test(normalizeAccountCode(code));
  switch (row.type) {
    case "CUSTOMER": {
      const code = resolveCustomerAuxiliaryCode(row.code);
      return numeric(code) ? [{ code: normalizeAccountCode(code), type: "RECEIVABLE", label: "client" }] : [];
    }
    case "SUPPLIER": {
      const code = resolveSupplierAuxiliaryCode(row.code);
      return numeric(code) ? [{ code: normalizeAccountCode(code), type: "PAYABLE", label: "fournisseur" }] : [];
    }
    case "EXPENSE":
      return numeric(row.code) ? [{ code: normalizeAccountCode(row.code), type: "EXPENSE", label: "charge" }] : [];
    case "TREASURY":
      return numeric(row.code) ? [{ code: normalizeAccountCode(row.code), type: "TREASURY", label: "trésorerie" }] : [];
    case "EMPLOYEE":
      return [
        ...(row.advanceAccountCode ? [{ code: normalizeAccountCode(row.advanceAccountCode), type: "RECEIVABLE" as const, label: "avance" }] : []),
        ...(row.salaryAccountCode ? [{ code: normalizeAccountCode(row.salaryAccountCode), type: "PAYABLE" as const, label: "salaire" }] : []),
      ];
  }
}

function employeeInputFrom(row: AccountImportLine, stored?: EmployeeSnapshot) {
  return {
    employeeCode: row.code,
    fullName: row.name ?? stored?.fullName ?? "",
    hireDate: row.hireDate ?? stored?.hireDate ?? null,
    salary: row.salary ?? stored?.salary ?? null,
    phone: row.phone ?? stored?.phone ?? null,
    advanceAccountCode: row.advanceAccountCode ?? stored?.advanceAccountCode ?? "",
    salaryAccountCode: row.salaryAccountCode ?? stored?.salaryAccountCode ?? "",
    status: (row.accountStatus as "ACTIVE" | "INACTIVE" | undefined) ?? stored?.status ?? "ACTIVE",
  };
}

type EmployeeSnapshot = {
  id: string;
  fullName: string;
  hireDate: string | null;
  salary: number | null;
  phone: string | null;
  advanceAccountCode: string;
  salaryAccountCode: string;
  status: "ACTIVE" | "INACTIVE";
};

/** First readable message of a validation error (OperationsServiceError with field errors). */
function firstMessage(error: unknown): string {
  if (error instanceof OperationsServiceError) {
    const fields = error.fieldErrors ? Object.values(error.fieldErrors) : [];
    return fields[0] ?? error.message;
  }
  return "Ligne invalide.";
}

export async function classifyAccountImportRowsWith(
  db: Db,
  organizationId: string,
  rows: AccountImportLine[],
  options: { canImportEmployees: boolean },
): Promise<{ rows: ClassifiedAccountRow[]; summary: AccountImportSummary }> {
  const codesOf = (type: AccountTypeCode) => [...new Set(rows.filter((row) => row.type === type).map((row) => row.code))];
  const allCodes = [...new Set(rows.filter((row) => row.type !== "EMPLOYEE").map((row) => row.code))];
  const derivedCustomerCodes = allCodes.filter((code) => !/^3421\d+$/.test(code)).map((code) => `3421${code}`);
  const phones = [...new Set(rows.flatMap((row) => (row.type === "CUSTOMER" && row.phone ? [row.phone] : [])))];
  const ledgerCodes = [...new Set(rows.flatMap((row) => requiredLedgerAccounts(row).map((account) => account.code)))];
  const employeeCodes = codesOf("EMPLOYEE");

  const [customers, suppliers, expenses, treasuries, employees, ledger] = await Promise.all([
    allCodes.length || phones.length
      ? db.customer.findMany({
          where: {
            organizationId,
            OR: [
              { code: { in: allCodes } },
              ...(derivedCustomerCodes.length ? [{ code: { in: derivedCustomerCodes } }] : []),
              ...(phones.length ? [{ phone: { in: phones } }] : []),
            ],
          },
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            city: true,
            latitude: true,
            longitude: true,
            ice: true,
            taxId: true,
            contactName: true,
            type: true,
            creditLimit: true,
            creditLimitEnabled: true,
            notes: true,
            status: true,
          },
        })
      : Promise.resolve([]),
    allCodes.length
      ? db.supplier.findMany({
          where: { organizationId, code: { in: allCodes } },
          select: { id: true, code: true, name: true, phone: true, email: true, address: true, city: true, ice: true, taxId: true, active: true },
        })
      : Promise.resolve([]),
    allCodes.length
      ? db.expenseAccount.findMany({
          where: { organizationId, code: { in: allCodes } },
          select: { id: true, code: true, name: true, description: true, category: true, active: true },
        })
      : Promise.resolve([]),
    allCodes.length
      ? db.treasuryAccount.findMany({
          where: { organizationId, code: { in: allCodes } },
          select: { id: true, code: true, name: true, kind: true, active: true },
        })
      : Promise.resolve([]),
    employeeCodes.length
      ? db.employee.findMany({
          where: { organizationId, employeeCode: { in: employeeCodes } },
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            hireDate: true,
            salary: true,
            phone: true,
            status: true,
            advanceAccount: { select: { code: true } },
            salaryAccount: { select: { code: true } },
          },
        })
      : Promise.resolve([]),
    ledgerCodes.length
      ? db.accountingAccount.findMany({ where: { organizationId, code: { in: ledgerCodes } }, select: { code: true, type: true } })
      : Promise.resolve([]),
  ]);

  const byCode = <T extends { code: string }>(list: T[]) => new Map(list.map((row) => [row.code, row]));
  const customerByCode = byCode(customers);
  const supplierByCode = byCode(suppliers);
  const expenseByCode = byCode(expenses);
  const treasuryByCode = byCode(treasuries);
  const employeeByCode = new Map(employees.map((employee) => [employee.employeeCode, employee]));
  const ledgerTypeByCode = new Map(ledger.map((account) => [account.code, account.type as AccountingAccountType]));
  // The codes whose type matters for the accounting plan: a code already used by
  // another of these types is an incompatible line (the historical rule, now
  // with Trésorerie). Employee codes live apart (Employee.employeeCode).
  const codeTypes: Array<[AccountTypeCode, Map<string, unknown>]> = [
    ["CUSTOMER", customerByCode],
    ["SUPPLIER", supplierByCode],
    ["EXPENSE", expenseByCode],
    ["TREASURY", treasuryByCode],
  ];

  const seenKeys = new Map<string, number>();
  const seenPhones = new Map<string, string>();

  const classified: ClassifiedAccountRow[] = rows.map((row) => {
    const base = { ...row, accountingCode: displayAccountingCode(row), changes: {} as Record<string, AccountImportChange>, existingId: null as string | null };
    const done = (status: ClassifiedStatus, message: string, extra: Partial<ClassifiedAccountRow> = {}): ClassifiedAccountRow => ({ ...base, status, message, ...extra });

    const key = `${row.type}|${row.code}`;
    if (seenKeys.has(key)) {
      return done("CONFLICT", `Compte en double dans le fichier (même code et même type que la ligne ${seenKeys.get(key)}).`);
    }
    seenKeys.set(key, row.excelRow);

    if (row.type === "EMPLOYEE" && !options.canImportEmployees) {
      return done("ERROR", "Import des employés réservé à l'administrateur.");
    }
    if (row.type !== "EMPLOYEE" && codeTypes.some(([type, map]) => type !== row.type && map.has(row.code))) {
      return done("CONFLICT", "Ce code existe deja avec un type incompatible.");
    }
    if (row.type === "CUSTOMER" && row.phone) {
      const owner = customers.find((customer) => customer.phone === row.phone && customer.code !== row.code);
      if (owner) return done("CONFLICT", `Le telephone ${row.phone} est deja utilise par un autre client.`);
      const inFile = seenPhones.get(row.phone);
      if (inFile && inFile !== row.code) return done("CONFLICT", `Le telephone ${row.phone} est deja utilise par un autre client du fichier.`);
      seenPhones.set(row.phone, row.code);
    }
    if (row.type !== "CUSTOMER" && row.accountStatus === "BLOCKED") {
      return done("ERROR", "Le statut Bloqué ne concerne que les clients.");
    }

    const changes: Record<string, AccountImportChange> = {};
    const text = (field: string, stored: string | null | undefined, next: string | undefined) => {
      if (next !== undefined && (stored ?? null) !== next) changes[field] = { old: stored ?? null, new: next };
    };
    const status = (stored: string, next: string | undefined) => {
      if (next !== undefined && stored !== next) changes.status = { old: STATUS_LABEL[stored] ?? stored, new: STATUS_LABEL[next] ?? next };
    };

    switch (row.type) {
      case "CUSTOMER": {
        const existing = customerByCode.get(row.code);
        if (!existing) break;
        text("name", existing.name, row.name);
        text("phone", existing.phone, row.phone);
        text("email", existing.email, row.email);
        text("address", existing.address, row.address);
        text("city", existing.city, row.city);
        if (row.latitude !== undefined && row.longitude !== undefined) {
          const oldLat = existing.latitude?.toNumber() ?? null;
          const oldLon = existing.longitude?.toNumber() ?? null;
          if (oldLat === null || oldLon === null || fmtCoordinate(oldLat) !== fmtCoordinate(row.latitude) || fmtCoordinate(oldLon) !== fmtCoordinate(row.longitude)) {
            changes.gps = {
              old: oldLat === null || oldLon === null ? null : `${fmtCoordinate(oldLat)}, ${fmtCoordinate(oldLon)}`,
              new: `${fmtCoordinate(row.latitude)}, ${fmtCoordinate(row.longitude)}`,
            };
          }
        }
        text("ice", existing.ice, row.ice);
        text("taxId", existing.taxId, row.taxId);
        text("contactName", existing.contactName, row.contactName);
        text("customerType", existing.type, row.customerType);
        if (row.creditLimit !== undefined && existing.creditLimit.toNumber() !== row.creditLimit) {
          changes.creditLimit = { old: existing.creditLimit.toNumber().toString(), new: row.creditLimit.toString() };
        }
        if (row.creditLimitEnabled !== undefined && existing.creditLimitEnabled !== row.creditLimitEnabled) {
          changes.creditLimitEnabled = { old: existing.creditLimitEnabled ? "Oui" : "Non", new: row.creditLimitEnabled ? "Oui" : "Non" };
        }
        // the /comptes rule: an enabled ceiling must be a real amount (> 0)
        const enabled = row.creditLimitEnabled ?? existing.creditLimitEnabled;
        const limit = row.creditLimit ?? existing.creditLimit.toNumber();
        if (enabled && !(limit > 0)) return done("ERROR", "Plafond de crédit actif : définissez un plafond supérieur à 0.");
        text("notes", existing.notes, row.notes);
        status(existing.status, row.accountStatus);
        return finish(existing.id);
      }
      case "SUPPLIER": {
        const existing = supplierByCode.get(row.code);
        if (!existing) break;
        text("name", existing.name, row.name);
        text("phone", existing.phone, row.phone);
        text("email", existing.email, row.email);
        text("address", existing.address, row.address);
        text("city", existing.city, row.city);
        text("ice", existing.ice, row.ice);
        text("taxId", existing.taxId, row.taxId);
        status(existing.active ? "ACTIVE" : "INACTIVE", row.accountStatus);
        return finish(existing.id);
      }
      case "EXPENSE": {
        const existing = expenseByCode.get(row.code);
        if (!existing) break;
        text("name", existing.name, row.name);
        text("description", existing.description, row.description);
        text("category", existing.category, row.category);
        status(existing.active ? "ACTIVE" : "INACTIVE", row.accountStatus);
        return finish(existing.id);
      }
      case "TREASURY": {
        const existing = treasuryByCode.get(row.code);
        if (!existing) break;
        if (row.treasuryKind !== undefined && row.treasuryKind !== existing.kind) {
          return done("ERROR", "La nature d'une trésorerie existante (Caisse / Banque) ne peut pas être modifiée par import.");
        }
        text("name", existing.name, row.name);
        status(existing.active ? "ACTIVE" : "INACTIVE", row.accountStatus);
        return finish(existing.id);
      }
      case "EMPLOYEE": {
        const stored = employeeByCode.get(row.code);
        if (!stored) break;
        const snapshot: EmployeeSnapshot = {
          id: stored.id,
          fullName: stored.fullName,
          hireDate: stored.hireDate ? stored.hireDate.toISOString().slice(0, 10) : null,
          salary: stored.salary?.toNumber() ?? null,
          phone: stored.phone,
          advanceAccountCode: stored.advanceAccount?.code ?? "",
          salaryAccountCode: stored.salaryAccount?.code ?? "",
          status: stored.status,
        };
        try {
          validateEmployeeInput(employeeInputFrom(row, snapshot));
        } catch (error) {
          return done("ERROR", firstMessage(error));
        }
        text("name", snapshot.fullName, row.name);
        text("phone", snapshot.phone, row.phone);
        text("hireDate", snapshot.hireDate, row.hireDate);
        if (row.salary !== undefined && snapshot.salary !== row.salary) {
          changes.salary = { old: snapshot.salary === null ? null : snapshot.salary.toString(), new: row.salary.toString() };
        }
        text("advanceAccountCode", snapshot.advanceAccountCode || null, row.advanceAccountCode);
        text("salaryAccountCode", snapshot.salaryAccountCode || null, row.salaryAccountCode);
        status(snapshot.status, row.accountStatus);
        const ledgerConflict = ledgerProblem(row, ["advanceAccountCode", "salaryAccountCode"].filter((field) => changes[field]));
        if (ledgerConflict) return done("CONFLICT", ledgerConflict);
        return finish(snapshot.id);
      }
    }

    // ---- not found in the destination organisation: a NEW account ----
    if (!row.name) return done("ERROR", "Nom_Compte obligatoire pour créer un compte.");
    if (row.type === "TREASURY" && !row.treasuryKind) {
      return done("ERROR", "Nature_Tresorerie obligatoire pour créer une trésorerie (Caisse ou Banque).");
    }
    if (row.type === "CUSTOMER" && row.creditLimitEnabled && !((row.creditLimit ?? 0) > 0)) {
      return done("ERROR", "Plafond de crédit actif : définissez un plafond supérieur à 0.");
    }
    if (row.type === "EMPLOYEE") {
      try {
        validateEmployeeInput(employeeInputFrom(row));
      } catch (error) {
        return done("ERROR", firstMessage(error));
      }
    }
    const ledgerConflict = ledgerProblem(row);
    if (ledgerConflict) return done("CONFLICT", ledgerConflict);
    return done("NEW", "Nouveau compte.");

    function finish(existingId: string): ClassifiedAccountRow {
      const hasChanges = Object.keys(changes).length > 0;
      return done(hasChanges ? "EXISTING_UPDATE" : "EXISTING_UNCHANGED", hasChanges ? "Mise a jour detectee." : "Compte existant inchange.", {
        changes,
        existingId,
      });
    }
  });

  /** A ledger account the line would use that already exists with another type. */
  function ledgerProblem(row: AccountImportLine, onlyFields?: string[]): string | null {
    for (const account of requiredLedgerAccounts(row)) {
      if (onlyFields && !onlyFields.some((field) => (field === "advanceAccountCode" ? account.label === "avance" : account.label === "salaire"))) continue;
      const type = ledgerTypeByCode.get(account.code);
      if (type && type !== account.type) {
        return `Le compte comptable ${account.code} existe deja avec un type incompatible.`;
      }
    }
    return null;
  }

  const count = (status: ClassifiedStatus) => classified.filter((row) => row.status === status).length;
  return {
    rows: classified,
    summary: {
      total: classified.length,
      new: count("NEW"),
      unchanged: count("EXISTING_UNCHANGED"),
      update: count("EXISTING_UPDATE"),
      conflicts: count("CONFLICT"),
      errors: count("ERROR"),
    },
  };
}

// ---------------------------------------------------------------- write

export type AccountImportRowStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "ERROR";

export type AccountImportRowResult = {
  excelRow: number;
  code: string;
  name: string;
  type: AccountTypeCode;
  accountingCode: string | null;
  status: AccountImportRowStatus;
  message: string;
};

/** Runs one line's work in ONE transaction (production: prisma.$transaction; tests: the rolled-back tx). */
export type RunInTransaction = <T>(work: (tx: Db) => Promise<T>) => Promise<T>;

/**
 * Applies the classified lines one by one, each in its own short transaction: a
 * failing line is reported as ERROR / CONFLICT without rolling back the others,
 * and re-importing the same file is idempotent (UNCHANGED, no duplicate).
 */
export async function applyAccountImportRows(
  run: RunInTransaction,
  organizationId: string,
  userId: string,
  rows: ClassifiedAccountRow[],
): Promise<AccountImportRowResult[]> {
  const results: AccountImportRowResult[] = [];
  for (const row of rows) {
    const meta = { excelRow: row.excelRow, code: row.code, name: row.name ?? row.code, type: row.type, accountingCode: row.accountingCode };
    if (row.status === "CONFLICT" || row.status === "ERROR") {
      results.push({ ...meta, status: row.status, message: row.message });
      continue;
    }
    if (row.status === "EXISTING_UNCHANGED") {
      results.push({ ...meta, status: "UNCHANGED", message: "Compte existant inchange." });
      continue;
    }
    try {
      if (row.status === "NEW") {
        await run((tx) => createAccount(tx, organizationId, userId, row));
        results.push({ ...meta, status: "CREATED", message: "Compte cree." });
      } else {
        const updated = row.existingId ? await run((tx) => updateAccount(tx, organizationId, row.existingId!, row)) : false;
        results.push(
          updated
            ? { ...meta, status: "UPDATED", message: "Compte mis a jour." }
            : { ...meta, status: "ERROR", message: "Compte introuvable au moment de la mise a jour." },
        );
      }
    } catch (error) {
      results.push(mapRowError(meta, error));
    }
  }
  return results;
}

const defined = <T extends Record<string, unknown>>(object: T): Partial<T> =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as Partial<T>;

const activeFrom = (status: AccountImportLine["accountStatus"]) => (status === undefined ? undefined : status === "ACTIVE");

async function createAccount(tx: Db, organizationId: string, userId: string, row: ClassifiedAccountRow): Promise<void> {
  const name = row.name!;
  switch (row.type) {
    case "CUSTOMER": {
      const hasGps = row.latitude !== undefined && row.longitude !== undefined;
      const created = await tx.customer.create({
        data: {
          organizationId,
          code: row.code,
          name,
          phone: row.phone ?? null,
          email: row.email ?? null,
          // the import has always created customers without address / city
          address: row.address ?? "",
          city: row.city ?? "",
          type: row.customerType ?? "COUNTER",
          status: row.accountStatus ?? "ACTIVE",
          creditLimit: row.creditLimit ?? 0,
          creditLimitEnabled: row.creditLimitEnabled ?? false,
          currentBalance: 0,
          ice: row.ice ?? null,
          taxId: row.taxId ?? null,
          contactName: row.contactName ?? null,
          notes: row.notes ?? null,
          ...(hasGps ? { latitude: row.latitude, longitude: row.longitude, locationUpdatedAt: new Date() } : {}),
          createdByUserId: userId,
          creationOrigin: "ADMIN",
        },
      });
      await resolveOrCreateAccountingLink(tx, organizationId, {
        explicitAccountingAccountId: null,
        code: resolveCustomerAuxiliaryCode(created.code),
        name: created.name,
        type: "RECEIVABLE",
      });
      return;
    }
    case "SUPPLIER": {
      const created = await tx.supplier.create({
        data: {
          organizationId,
          code: row.code,
          name,
          phone: row.phone ?? null,
          email: row.email ?? null,
          address: row.address ?? null,
          city: row.city ?? null,
          ice: row.ice ?? null,
          taxId: row.taxId ?? null,
          active: row.accountStatus !== "INACTIVE",
          createdByUserId: userId,
        },
      });
      await resolveOrCreateAccountingLink(tx, organizationId, {
        explicitAccountingAccountId: null,
        code: resolveSupplierAuxiliaryCode(created.code),
        name: created.name,
        type: "PAYABLE",
      });
      return;
    }
    case "EXPENSE": {
      const accountingAccountId = await resolveOrCreateAccountingLink(tx, organizationId, {
        explicitAccountingAccountId: null,
        code: row.code,
        name,
        type: "EXPENSE",
      });
      await tx.expenseAccount.create({
        data: {
          organizationId,
          code: row.code,
          name,
          description: row.description ?? null,
          category: row.category ?? null,
          balance: 0,
          accountingAccountId,
          active: row.accountStatus !== "INACTIVE",
          createdByUserId: userId,
        },
      });
      return;
    }
    case "TREASURY": {
      // same rule as the /comptes form (createBusinessAccount): unique code, linked ledger account, balance 0
      const taken = await tx.treasuryAccount.findFirst({ where: { organizationId, code: row.code }, select: { id: true } });
      if (taken) throw new OperationsServiceError("Une tresorerie existe deja avec ce code.", 409);
      const accountingAccountId = await resolveOrCreateAccountingLink(tx, organizationId, {
        explicitAccountingAccountId: null,
        code: row.code,
        name,
        type: "TREASURY",
      });
      await tx.treasuryAccount.create({
        data: {
          organizationId,
          code: row.code,
          name,
          kind: row.treasuryKind!,
          balance: 0,
          accountingAccountId,
          active: row.accountStatus !== "INACTIVE",
          createdByUserId: userId,
        },
      });
      return;
    }
    case "EMPLOYEE": {
      // exactly createEmployee's transaction body (lib/server/employees.ts)
      const data = validateEmployeeInput(employeeInputFrom(row));
      await assertUniqueEmployeeCode(tx, organizationId, data.employeeCode);
      const advanceAccountId = await resolveEmployeeAccountingLink(tx, organizationId, {
        code: data.advanceAccountCode,
        name: buildEmployeeAdvanceAccountName(data.fullName),
        type: "RECEIVABLE",
        field: "advanceAccountCode",
      });
      const salaryAccountId = await resolveEmployeeAccountingLink(tx, organizationId, {
        code: data.salaryAccountCode,
        name: buildEmployeeSalaryAccountName(data.fullName),
        type: "PAYABLE",
        field: "salaryAccountCode",
      });
      await tx.employee.create({
        data: {
          organizationId,
          employeeCode: data.employeeCode,
          fullName: data.fullName,
          hireDate: parseEmployeeDate(data.hireDate),
          salary: data.salary ?? null,
          phone: data.phone,
          advanceAccountId,
          salaryAccountId,
          status: data.status ?? "ACTIVE",
        },
      });
      return;
    }
  }
}

async function updateAccount(tx: Db, organizationId: string, id: string, row: ClassifiedAccountRow): Promise<boolean> {
  const nameChanged = Boolean(row.changes.name);
  switch (row.type) {
    case "CUSTOMER": {
      const gps = row.changes.gps && row.latitude !== undefined && row.longitude !== undefined;
      const { count } = await tx.customer.updateMany({
        where: { id, organizationId },
        data: defined({
          name: row.name,
          phone: row.phone,
          email: row.email,
          address: row.address,
          city: row.city,
          ice: row.ice,
          taxId: row.taxId,
          contactName: row.contactName,
          type: row.customerType,
          creditLimit: row.creditLimit,
          creditLimitEnabled: row.creditLimitEnabled,
          notes: row.notes,
          status: row.accountStatus,
          ...(gps ? { latitude: row.latitude, longitude: row.longitude, locationUpdatedAt: new Date() } : {}),
        }),
      });
      if (count > 0 && nameChanged) await syncAuxiliaryAccountName(tx, organizationId, resolveCustomerAuxiliaryCode(row.code), "RECEIVABLE", row.name!);
      return count > 0;
    }
    case "SUPPLIER": {
      const { count } = await tx.supplier.updateMany({
        where: { id, organizationId },
        data: defined({
          name: row.name,
          phone: row.phone,
          email: row.email,
          address: row.address,
          city: row.city,
          ice: row.ice,
          taxId: row.taxId,
          active: activeFrom(row.accountStatus),
        }),
      });
      if (count > 0 && nameChanged) await syncAuxiliaryAccountName(tx, organizationId, resolveSupplierAuxiliaryCode(row.code), "PAYABLE", row.name!);
      return count > 0;
    }
    case "EXPENSE": {
      const { count } = await tx.expenseAccount.updateMany({
        where: { id, organizationId },
        data: defined({ name: row.name, description: row.description, category: row.category, active: activeFrom(row.accountStatus) }),
      });
      if (count > 0 && nameChanged) await syncAuxiliaryAccountName(tx, organizationId, row.code, "EXPENSE", row.name!);
      return count > 0;
    }
    case "TREASURY": {
      const { count } = await tx.treasuryAccount.updateMany({
        where: { id, organizationId },
        data: defined({ name: row.name, active: activeFrom(row.accountStatus) }),
      });
      if (count > 0 && nameChanged) await syncAuxiliaryAccountName(tx, organizationId, row.code, "TREASURY", row.name!);
      return count > 0;
    }
    case "EMPLOYEE": {
      // updateEmployee's rules on the MERGED values (stored + file), so nothing
      // absent from the file is lost
      const stored = await tx.employee.findFirst({
        where: { id, organizationId },
        select: {
          fullName: true,
          hireDate: true,
          salary: true,
          phone: true,
          status: true,
          advanceAccount: { select: { code: true } },
          salaryAccount: { select: { code: true } },
        },
      });
      if (!stored) return false;
      const data = validateEmployeeInput(
        employeeInputFrom(row, {
          id,
          fullName: stored.fullName,
          hireDate: stored.hireDate ? stored.hireDate.toISOString().slice(0, 10) : null,
          salary: stored.salary?.toNumber() ?? null,
          phone: stored.phone,
          advanceAccountCode: stored.advanceAccount?.code ?? "",
          salaryAccountCode: stored.salaryAccount?.code ?? "",
          status: stored.status,
        }),
      );
      await assertUniqueEmployeeCode(tx, organizationId, data.employeeCode, id);
      const advanceAccountId = await resolveEmployeeAccountingLink(tx, organizationId, {
        code: data.advanceAccountCode,
        name: buildEmployeeAdvanceAccountName(data.fullName),
        type: "RECEIVABLE",
        field: "advanceAccountCode",
      });
      const salaryAccountId = await resolveEmployeeAccountingLink(tx, organizationId, {
        code: data.salaryAccountCode,
        name: buildEmployeeSalaryAccountName(data.fullName),
        type: "PAYABLE",
        field: "salaryAccountCode",
      });
      const { count } = await tx.employee.updateMany({
        where: { id, organizationId },
        data: {
          fullName: data.fullName,
          hireDate: parseEmployeeDate(data.hireDate),
          salary: data.salary ?? null,
          phone: data.phone,
          advanceAccountId,
          salaryAccountId,
          status: data.status ?? "ACTIVE",
        },
      });
      return count > 0;
    }
  }
}

/**
 * Rename the auxiliary ledger account that mirrors a business account (moved
 * unchanged from the import route). No-op when the code is not a real
 * accounting number or when no such account exists; scoped to the organisation
 * and to the account type the link was created with.
 */
async function syncAuxiliaryAccountName(
  tx: Db,
  organizationId: string,
  code: string,
  type: AccountingAccountType,
  name: string,
): Promise<void> {
  const normalizedCode = normalizeAccountCode(code);
  if (!/^\d+$/.test(normalizedCode)) return;
  await tx.accountingAccount.updateMany({
    where: { organizationId, code: normalizedCode, type },
    data: { name },
  });
}

function mapRowError(meta: Omit<AccountImportRowResult, "status" | "message">, error: unknown): AccountImportRowResult {
  const prismaError = error as { code?: string; meta?: { target?: string[] | string } };
  if (prismaError.code === "P2002") {
    const target = Array.isArray(prismaError.meta?.target) ? prismaError.meta.target.join(",") : String(prismaError.meta?.target ?? "");
    if (target.includes("phone")) {
      return { ...meta, status: "CONFLICT", message: "Ce telephone est deja utilise par un autre compte." };
    }
    // The code was taken between the preload and this write - the account
    // now exists, so the file is still consistent: report it as UNCHANGED.
    return { ...meta, status: "UNCHANGED", message: "Compte deja present." };
  }
  if (error instanceof OperationsServiceError) {
    return { ...meta, status: error.status === 409 ? "CONFLICT" : "ERROR", message: firstMessage(error) };
  }
  return { ...meta, status: "ERROR", message: "Import impossible pour cette ligne." };
}

