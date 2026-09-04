import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/server/customers";

/**
 * Shared foundation for the accounts Excel import (feuille "Comptes").
 *
 * Both endpoints go through here so they can never drift apart:
 *   - POST /api/comptes/import/preview  -> read-only, shows what would happen
 *   - POST /api/comptes/import          -> the real write; it re-runs
 *     classifyAccountImportRows() itself and acts on THAT result, never on
 *     the statuses the browser sent.
 *
 * Everything is scoped to a single organizationId (the caller's session) -
 * there is no code path that reads or writes another organisation's rows.
 */

// Import volontairement limité à ces 3 types. TREASURY existe dans
// l'architecture mais n'est PAS importable depuis ce fichier Excel ; REVENUE
// et EMPLOYEE non plus. Toute autre valeur de Type_Compte est rejetée en
// amont (frontend -> ERROR) et refusée ici par accountImportRowSchema.
export const accountImportTypes = ["CUSTOMER", "SUPPLIER", "EXPENSE"] as const;
export type AccountImportType = (typeof accountImportTypes)[number];

/** A file with more lines than this is rejected outright. */
export const ACCOUNT_IMPORT_MAX_ROWS = 2000;

export const accountImportRowSchema = z.object({
  excelRow: z.number().int().positive(),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.enum(accountImportTypes),
  phone: z.string().nullable().optional().transform(normalizePhone),
});

export const accountImportSchema = z.object({
  rows: z.array(accountImportRowSchema).max(ACCOUNT_IMPORT_MAX_ROWS),
});

export type AccountImportRow = z.infer<typeof accountImportRowSchema>;

/**
 * A customer keeps its short commercial/POS number in Customer.code ("2"),
 * and its accounting (auxiliary ledger) account is the textual prefix
 * "3421" + that number ("34212"). A code that is already a full "3421..."
 * number is returned unchanged, so an old "34212" never becomes "342134212".
 * Suppliers and charges keep their code exactly as written.
 * This mirrors accounting#resolveCustomerAuxiliaryCode, kept here so the
 * preview can display the target account without pulling in the whole
 * accounting module.
 */
export function accountingCodeForImport(type: AccountImportType, code: string): string {
  if (type !== "CUSTOMER") return code;
  return /^3421\d+$/.test(code) ? code : `3421${code}`;
}

export type ClassifiedStatus =
  | "NEW"
  | "EXISTING_UNCHANGED"
  | "EXISTING_UPDATE"
  | "CONFLICT";

export type AccountImportChange = { old: string | null; new: string | null };

export type ClassifiedAccountRow = AccountImportRow & {
  accountingCode: string;
  status: ClassifiedStatus;
  message: string;
  changes: Record<string, AccountImportChange>;
  /**
   * Id of the existing account this line matched (same code AND same type).
   * Only ever set for EXISTING_UNCHANGED / EXISTING_UPDATE, and it always
   * belongs to `organizationId` because it comes from the scoped preload
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
};

type ExistingAccount = { id: string; code: string; name: string; phone?: string | null };

/**
 * One preload per table (no N+1), then a pure in-memory comparison:
 *   - a code used by another type            -> CONFLICT
 *   - a customer phone already held elsewhere -> CONFLICT
 *   - no match                               -> NEW
 *   - match, same name/phone                  -> EXISTING_UNCHANGED
 *   - match, different name/phone             -> EXISTING_UPDATE
 */
export async function classifyAccountImportRows(
  organizationId: string,
  rows: AccountImportRow[],
): Promise<{ rows: ClassifiedAccountRow[]; summary: AccountImportSummary }> {
  const codes = [...new Set(rows.map((row) => row.code))];
  const shortCodes = codes.filter((code) => !/^3421\d+$/.test(code));
  const derivedCustomerCodes = shortCodes.map((code) => `3421${code}`);
  const phones = [
    ...new Set(rows.flatMap((row) => (row.type === "CUSTOMER" && row.phone ? [row.phone] : []))),
  ];

  const [customers, suppliers, expenses] = await Promise.all([
    prisma.customer.findMany({
      where: {
        organizationId,
        OR: [
          { code: { in: codes } },
          ...(derivedCustomerCodes.length ? [{ code: { in: derivedCustomerCodes } }] : []),
          ...(phones.length ? [{ phone: { in: phones } }] : []),
        ],
      },
      select: { id: true, code: true, name: true, phone: true },
    }),
    prisma.supplier.findMany({
      where: { organizationId, code: { in: codes } },
      select: { id: true, code: true, name: true, phone: true },
    }),
    prisma.expenseAccount.findMany({
      where: { organizationId, code: { in: codes } },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const by = (list: ExistingAccount[]) => new Map(list.map((row) => [row.code, row]));
  const maps: Record<AccountImportType, Map<string, ExistingAccount>> = {
    CUSTOMER: by(customers),
    SUPPLIER: by(suppliers),
    EXPENSE: by(expenses),
  };

  const classified: ClassifiedAccountRow[] = rows.map((row) => {
    const accountingCode = accountingCodeForImport(row.type, row.code);
    const base = { ...row, accountingCode };

    const incompatible = accountImportTypes.some(
      (type) => type !== row.type && maps[type].has(row.code),
    );
    if (incompatible) {
      return {
        ...base,
        status: "CONFLICT",
        message: "Ce code existe deja avec un type incompatible.",
        changes: {},
        existingId: null,
      };
    }

    const phoneOwner =
      row.type === "CUSTOMER" && row.phone
        ? customers.find((customer) => customer.phone === row.phone && customer.code !== row.code)
        : null;
    if (phoneOwner) {
      return {
        ...base,
        status: "CONFLICT",
        message: `Le telephone ${row.phone} est deja utilise par un autre client.`,
        changes: {},
        existingId: null,
      };
    }

    const same = maps[row.type].get(row.code);
    if (!same) {
      return { ...base, status: "NEW", message: "Nouveau compte.", changes: {}, existingId: null };
    }

    const changes: Record<string, AccountImportChange> = {};
    if (same.name !== row.name) changes.name = { old: same.name, new: row.name };
    if (row.type === "CUSTOMER" || row.type === "SUPPLIER") {
      const oldPhone = same.phone ?? null;
      if (oldPhone !== row.phone) changes.phone = { old: oldPhone, new: row.phone };
    }
    const hasChanges = Object.keys(changes).length > 0;
    return {
      ...base,
      status: hasChanges ? "EXISTING_UPDATE" : "EXISTING_UNCHANGED",
      message: hasChanges ? "Mise a jour detectee." : "Compte existant inchange.",
      changes,
      existingId: same.id,
    };
  });

  const count = (status: ClassifiedStatus) =>
    classified.filter((row) => row.status === status).length;

  return {
    rows: classified,
    summary: {
      total: classified.length,
      new: count("NEW"),
      unchanged: count("EXISTING_UNCHANGED"),
      update: count("EXISTING_UPDATE"),
      conflicts: count("CONFLICT"),
    },
  };
}
