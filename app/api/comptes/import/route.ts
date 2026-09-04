import { NextResponse } from "next/server";
import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  accountImportSchema,
  classifyAccountImportRows,
  type AccountImportType,
  type ClassifiedAccountRow,
} from "@/lib/server/accounts-import";
import {
  normalizeAccountCode,
  resolveCustomerAuxiliaryCode,
  resolveSupplierAuxiliaryCode,
} from "@/lib/server/accounting";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { AccountingAccountType } from "@/types/accounting";

// A file of several hundred lines is imported one short transaction at a
// time (see below); give the handler room past the default serverless limit.
export const maxDuration = 60;

type ImportRowStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "ERROR";

type ImportRowResult = {
  excelRow: number;
  code: string;
  name: string;
  type: AccountImportType;
  accountingCode: string;
  status: ImportRowStatus;
  message: string;
};

/**
 * POST /api/comptes/import - the real write behind "Importer les comptes".
 *
 * Transactional strategy: the row list is re-validated here from scratch
 * (classifyAccountImportRows, exactly what the preview runs - the browser's
 * statuses are never trusted), then each importable line is applied in its
 * OWN short transaction. A CREATE wraps the directory row + its auxiliary
 * ledger account so the two commit or roll back together; an UPDATE is a
 * single organisation-scoped updateMany. One failing line is caught and
 * reported as ERROR/CONFLICT without rolling back the lines already done,
 * and re-importing the same file is safe: every line that already exists
 * unchanged comes back as UNCHANGED (idempotent, no duplicates).
 *
 * Every read and write is filtered by the caller's own organizationId -
 * there is no parameter that could point the import at another organisation.
 */
export async function POST(request: Request) {
  try {
    const input = accountImportSchema.parse(await request.json());
    const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

    if (input.rows.length === 0) {
      return NextResponse.json({ message: "Aucune ligne a importer." }, { status: 422 });
    }

    const { rows } = await classifyAccountImportRows(user.organizationId, input.rows);

    const results: ImportRowResult[] = [];
    for (const row of rows) {
      results.push(await applyRow(user.organizationId, user.id, row));
    }

    const has = (type: AccountImportType, status: ImportRowStatus) =>
      results.filter((row) => row.type === type && row.status === status).length;
    const countStatus = (status: ImportRowStatus) =>
      results.filter((row) => row.status === status).length;

    return NextResponse.json({
      summary: {
        created: countStatus("CREATED"),
        updated: countStatus("UPDATED"),
        unchanged: countStatus("UNCHANGED"),
        conflicts: countStatus("CONFLICT"),
        errors: countStatus("ERROR"),
      },
      byType: {
        customersCreated: has("CUSTOMER", "CREATED"),
        customersUpdated: has("CUSTOMER", "UPDATED"),
        suppliersCreated: has("SUPPLIER", "CREATED"),
        suppliersUpdated: has("SUPPLIER", "UPDATED"),
        expensesCreated: has("EXPENSE", "CREATED"),
        expensesUpdated: has("EXPENSE", "UPDATED"),
        treasuriesCreated: has("TREASURY", "CREATED"),
        treasuriesUpdated: has("TREASURY", "UPDATED"),
      },
      rows: results,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Lignes import invalides." }, { status: 422 });
    }
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'importer les comptes." }, { status: 500 });
  }
}

async function applyRow(
  organizationId: string,
  userId: string,
  row: ClassifiedAccountRow,
): Promise<ImportRowResult> {
  const meta = {
    excelRow: row.excelRow,
    code: row.code,
    name: row.name,
    type: row.type,
    accountingCode: row.accountingCode,
  };

  // Server-side re-classification is authoritative: only NEW / EXISTING_UPDATE
  // are written, whatever the browser sent.
  if (row.status === "CONFLICT") {
    return { ...meta, status: "CONFLICT", message: row.message };
  }
  if (row.status === "EXISTING_UNCHANGED") {
    return { ...meta, status: "UNCHANGED", message: "Compte existant inchange." };
  }

  try {
    if (row.status === "NEW") {
      await createAccount(organizationId, userId, row);
      return { ...meta, status: "CREATED", message: "Compte cree." };
    }

    // EXISTING_UPDATE
    if (!row.existingId) {
      return { ...meta, status: "ERROR", message: "Compte introuvable au moment de la mise a jour." };
    }
    const updated = await updateAccount(organizationId, row.existingId, row);
    return updated
      ? { ...meta, status: "UPDATED", message: "Compte mis a jour." }
      : { ...meta, status: "ERROR", message: "Compte introuvable au moment de la mise a jour." };
  } catch (error) {
    return mapRowError(meta, error);
  }
}

async function createAccount(
  organizationId: string,
  userId: string,
  row: ClassifiedAccountRow,
): Promise<void> {
  if (row.type === "CUSTOMER") {
    await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          organizationId,
          code: row.code,
          name: row.name,
          phone: row.phone,
          address: "",
          city: "",
          type: "COUNTER",
          status: "ACTIVE",
          creditLimit: 0,
          currentBalance: 0,
          createdByUserId: userId,
          creationOrigin: "ADMIN",
        },
      });
      await resolveAuxiliaryAccountId(tx, organizationId, {
        code: resolveCustomerAuxiliaryCode(created.code),
        name: created.name,
        type: "RECEIVABLE",
      });
    });
    return;
  }

  if (row.type === "SUPPLIER") {
    await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          organizationId,
          code: row.code,
          name: row.name,
          phone: row.phone,
          active: true,
        },
      });
      await resolveAuxiliaryAccountId(tx, organizationId, {
        code: resolveSupplierAuxiliaryCode(created.code),
        name: created.name,
        type: "PAYABLE",
      });
    });
    return;
  }

  if (row.type === "EXPENSE") {
    await prisma.$transaction(async (tx) => {
      const accountingAccountId = await resolveAuxiliaryAccountId(tx, organizationId, {
        code: row.code,
        name: row.name,
        type: "EXPENSE",
      });
      await tx.expenseAccount.create({
        data: {
          organizationId,
          code: row.code,
          name: row.name,
          balance: 0,
          accountingAccountId,
          active: true,
        },
      });
    });
    return;
  }

  // TREASURY
  await prisma.$transaction(async (tx) => {
    const accountingAccountId = await resolveAuxiliaryAccountId(tx, organizationId, {
      code: row.code,
      name: row.name,
      type: "TREASURY",
    });
    await tx.treasuryAccount.create({
      data: {
        organizationId,
        code: row.code,
        name: row.name,
        kind: "CASH",
        balance: 0,
        accountingAccountId,
        active: true,
      },
    });
  });
}

/**
 * Resolve - or lazily create - the auxiliary chart-of-accounts row a business
 * account links to. Same contract as the private helper of the same intent in
 * lib/server/business-accounts.ts, kept local here so this route depends only
 * on stable, long-exported helpers (normalizeAccountCode) and never on that
 * module's internals:
 *   - a non-numeric placeholder code (CHG-/TRE-...) has no ledger account -> null
 *   - an existing code carrying a different type -> 409, surfaced per-row as CONFLICT
 *   - otherwise the existing id, or a freshly created row's id
 * Always scoped to the caller's organisation.
 */
async function resolveAuxiliaryAccountId(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: { code: string; name: string; type: AccountingAccountType },
): Promise<string | null> {
  const normalizedCode = normalizeAccountCode(input.code);
  if (!/^\d+$/.test(normalizedCode)) return null;

  const existing = await tx.accountingAccount.findFirst({
    where: { code: normalizedCode, organizationId },
    select: { id: true, type: true },
  });
  if (existing) {
    if (existing.type !== input.type) {
      throw new OperationsServiceError(
        `Le compte comptable ${normalizedCode} existe deja avec un type incompatible.`,
        409,
        { code: `Le compte comptable ${normalizedCode} existe deja avec un type incompatible.` },
      );
    }
    return existing.id;
  }

  const created = await tx.accountingAccount.create({
    data: {
      organizationId,
      code: normalizedCode,
      name: input.name,
      type: input.type,
      isActive: true,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Organisation-scoped update; returns false when the row no longer exists.
 *
 * When the name changes, the linked auxiliary ledger account is renamed in
 * the SAME transaction (renaming customer "2" to "Yassine Naimi" also
 * renames account 34212). resolveAuxiliaryAccountId /
 * ensureAccountingAccountByCode only ever create that account, never rename
 * it, and neither updateCustomer nor updateBusinessAccount touches it - so
 * without this the ledger label would stay stale after an import update.
 */
async function updateAccount(
  organizationId: string,
  id: string,
  row: ClassifiedAccountRow,
): Promise<boolean> {
  const nameChanged = Boolean(row.changes.name);

  return prisma.$transaction(async (tx) => {
    if (row.type === "CUSTOMER") {
      const { count } = await tx.customer.updateMany({
        where: { id, organizationId },
        data: { name: row.name, phone: row.phone },
      });
      if (count > 0 && nameChanged) {
        await syncAuxiliaryAccountName(
          tx,
          organizationId,
          resolveCustomerAuxiliaryCode(row.code),
          "RECEIVABLE",
          row.name,
        );
      }
      return count > 0;
    }

    if (row.type === "SUPPLIER") {
      const { count } = await tx.supplier.updateMany({
        where: { id, organizationId },
        data: { name: row.name, phone: row.phone },
      });
      if (count > 0 && nameChanged) {
        await syncAuxiliaryAccountName(
          tx,
          organizationId,
          resolveSupplierAuxiliaryCode(row.code),
          "PAYABLE",
          row.name,
        );
      }
      return count > 0;
    }

    if (row.type === "EXPENSE") {
      const { count } = await tx.expenseAccount.updateMany({
        where: { id, organizationId },
        data: { name: row.name },
      });
      if (count > 0 && nameChanged) {
        await syncAuxiliaryAccountName(tx, organizationId, row.code, "EXPENSE", row.name);
      }
      return count > 0;
    }

    const { count } = await tx.treasuryAccount.updateMany({
      where: { id, organizationId },
      data: { name: row.name },
    });
    if (count > 0 && nameChanged) {
      await syncAuxiliaryAccountName(tx, organizationId, row.code, "TREASURY", row.name);
    }
    return count > 0;
  });
}

/**
 * Rename the auxiliary ledger account that mirrors a business account.
 * No-op when the code is not a real accounting number (no linked account was
 * ever created - same guard as resolveAuxiliaryAccountId) or when no such
 * account exists. Scoped to the caller's organisation and to the account
 * type the link was created with, so it can never rename an unrelated row.
 */
async function syncAuxiliaryAccountName(
  tx: Prisma.TransactionClient,
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

function mapRowError(
  meta: Omit<ImportRowResult, "status" | "message">,
  error: unknown,
): ImportRowResult {
  const prismaError = error as { code?: string; meta?: { target?: string[] | string } };

  if (prismaError.code === "P2002") {
    const target = Array.isArray(prismaError.meta?.target)
      ? prismaError.meta.target.join(",")
      : String(prismaError.meta?.target ?? "");
    if (target.includes("phone")) {
      return { ...meta, status: "CONFLICT", message: "Ce telephone est deja utilise par un autre compte." };
    }
    // The code was taken between the preload and this write - the account
    // now exists, so the file is still consistent: report it as UNCHANGED.
    return { ...meta, status: "UNCHANGED", message: "Compte deja present." };
  }

  if (error instanceof OperationsServiceError) {
    return {
      ...meta,
      status: error.status === 409 ? "CONFLICT" : "ERROR",
      message: error.message,
    };
  }

  return { ...meta, status: "ERROR", message: "Import impossible pour cette ligne." };
}
