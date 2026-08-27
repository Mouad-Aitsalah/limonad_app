import "server-only";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  listAccountingAccountOptions,
  normalizeAccountCode,
  resolveCustomerAuxiliaryCode,
  resolveSupplierAuxiliaryCode,
} from "@/lib/server/accounting";
import {
  ensureUniquePhone,
  parseCustomerInput,
  nextCustomerCode,
  updateCustomer,
} from "@/lib/server/customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { AccountingAccountType } from "@/types/accounting";
import type {
  BusinessAccountFormOptions,
  BusinessAccountInput,
  BusinessAccountListItem,
  BusinessAccountsPayload,
  BusinessAccountStatus,
} from "@/types/business-account";

type DbClient = typeof prisma | Prisma.TransactionClient;

/**
 * A business account (Client/Fournisseur/Charge/Tresorerie, managed in
 * /comptes) and an accounting-plan account (AccountingAccount, managed in
 * Comptabilite > Comptes comptables) are two different concepts: one is the
 * operational directory entry, the other is the ledger line écritures post
 * against. This resolves the accounting-plan account a business account
 * should be linked to - reusing an existing one by code (never duplicating
 * it) or creating it on the fly - so every business account with a real
 * accounting number is immediately selectable in "Choisir un compte".
 *
 * Codes that don't look like real accounting-plan numbers (the CHG-/TRE-
 * placeholders auto-generated when the admin leaves "N° compte" blank) are
 * left unlinked, exactly as before, so the chart of accounts isn't polluted
 * with internal placeholder codes.
 */
async function resolveOrCreateAccountingLink(
  db: DbClient,
  organizationId: string,
  input: { explicitAccountingAccountId: string | null; code: string; name: string; type: AccountingAccountType },
): Promise<string | null> {
  if (input.explicitAccountingAccountId) {
    return input.explicitAccountingAccountId;
  }

  const normalizedCode = normalizeAccountCode(input.code);
  if (!/^\d+$/.test(normalizedCode)) {
    return null;
  }

  const existing = await db.accountingAccount.findFirst({
    where: { code: normalizedCode, organizationId },
    select: { id: true, type: true },
  });

  if (existing) {
    if (existing.type !== input.type) {
      throw new OperationsServiceError(
        `Le compte comptable ${normalizedCode} existe deja avec un type incompatible.`,
        409,
        {
          code: `Le compte comptable ${normalizedCode} existe deja avec un type incompatible.`,
        },
      );
    }
    return existing.id;
  }

  const created = await db.accountingAccount.create({
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

const businessAccountTypeValues = [
  "CUSTOMER",
  "SUPPLIER",
  "EXPENSE",
  "TREASURY",
] as const;

const businessAccountStatusValues = ["ACTIVE", "INACTIVE", "BLOCKED"] as const;
const treasuryKindValues = ["CASH", "BANK"] as const;
const supplierAccountPrefix = "4411";

const optionalString = () =>
  z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();

const businessAccountInputSchema = z
  .object({
    type: z.enum(businessAccountTypeValues),
    code: optionalString(),
    name: z.string().trim().min(1, "Le nom est obligatoire."),
    phone: optionalString(),
    email: z
      .string()
      .trim()
      .email("L'adresse email est invalide.")
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    city: optionalString(),
    address: optionalString(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    creditLimit: z.coerce.number().min(0).optional(),
    balance: z.coerce.number().min(0).optional(),
    status: z.enum(businessAccountStatusValues).optional(),
    ice: optionalString(),
    taxId: optionalString(),
    description: optionalString(),
    category: optionalString(),
    treasuryKind: z.enum(treasuryKindValues).nullable().optional(),
    accountingAccountId: optionalString(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "CUSTOMER") {
      if (!data.phone) {
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Le telephone est obligatoire pour un client.",
        });
      }
      if (!data.city) {
        ctx.addIssue({
          code: "custom",
          path: ["city"],
          message: "La ville est obligatoire pour un client.",
        });
      }
      if (!data.address) {
        ctx.addIssue({
          code: "custom",
          path: ["address"],
          message: "L'adresse est obligatoire pour un client.",
        });
      }
    }
    if (data.type === "TREASURY" && !data.treasuryKind) {
      ctx.addIssue({
        code: "custom",
        path: ["treasuryKind"],
        message: "Le type de tresorerie est obligatoire.",
      });
    }
  });

export async function getBusinessAccounts(): Promise<BusinessAccountsPayload> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const [customers, suppliers, expenses, treasuryAccounts] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId: currentUser.organizationId },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }],
    }),
    prisma.supplier.findMany({
      where: { organizationId: currentUser.organizationId },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }],
    }),
    prisma.expenseAccount.findMany({
      where: { organizationId: currentUser.organizationId },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }],
    }),
    prisma.treasuryAccount.findMany({
      where: { organizationId: currentUser.organizationId },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }],
    }),
  ]);
  const linkedOperationalAccountingAccountIds = [
    ...expenses.map((expense) => expense.accountingAccountId),
    ...treasuryAccounts.map((account) => account.accountingAccountId),
  ].filter((accountingAccountId): accountingAccountId is string => Boolean(accountingAccountId));

  const employeeAccounts = await prisma.accountingAccount.findMany({
    where: {
      organizationId: currentUser.organizationId,
      ...(linkedOperationalAccountingAccountIds.length > 0
        ? { id: { notIn: linkedOperationalAccountingAccountIds } }
        : {}),
      OR: [
        { employeeAdvanceAccounts: { some: {} } },
        { employeeSalaryAccounts: { some: {} } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { code: "asc" }],
  });

  const items: BusinessAccountListItem[] = [
    ...customers.map((customer) => ({
      id: `customer:${customer.id}`,
      sourceId: customer.id,
      accountNumber: customer.code,
      name: customer.name,
      type: "CUSTOMER" as const,
      phone: customer.phone,
      creditLimit: customer.creditLimit.toNumber(),
      createdAt: customer.createdAt.toISOString(),
      email: customer.email,
      city: customer.city,
      address: customer.address,
      latitude: customer.latitude?.toNumber() ?? null,
      longitude: customer.longitude?.toNumber() ?? null,
      status: customer.status as BusinessAccountStatus,
    })),
    ...suppliers.map((supplier) => ({
      id: `supplier:${supplier.id}`,
      sourceId: supplier.id,
      accountNumber: supplier.code,
      name: supplier.name,
      type: "SUPPLIER" as const,
      phone: supplier.phone ?? null,
      creditLimit: null,
      createdAt: supplier.createdAt.toISOString(),
      email: supplier.email,
      city: supplier.city,
      address: supplier.address,
      status: (supplier.active ? "ACTIVE" : "INACTIVE") as BusinessAccountStatus,
    })),
    ...expenses.map((expense) => ({
      id: `expense:${expense.id}`,
      sourceId: expense.id,
      accountNumber: expense.code,
      name: expense.name,
      type: "EXPENSE" as const,
      phone: null,
      creditLimit: null,
      createdAt: expense.createdAt.toISOString(),
      city: null,
      status: (expense.active ? "ACTIVE" : "INACTIVE") as BusinessAccountStatus,
    })),
    ...treasuryAccounts.map((account) => ({
      id: `treasury:${account.id}`,
      sourceId: account.id,
      accountNumber: account.code,
      name: account.name,
      type: "TREASURY" as const,
      phone: null,
      creditLimit: null,
      createdAt: account.createdAt.toISOString(),
      city: null,
      status: (account.active ? "ACTIVE" : "INACTIVE") as BusinessAccountStatus,
    })),
    ...employeeAccounts.map((account) => ({
      id: `employee-account:${account.id}`,
      sourceId: account.id,
      accountNumber: account.code,
      name: account.name,
      type: "EMPLOYEE" as const,
      phone: null,
      creditLimit: null,
      createdAt: account.createdAt.toISOString(),
      city: null,
      status: (account.isActive ? "ACTIVE" : "INACTIVE") as BusinessAccountStatus,
    })),
  ].sort((a, b) => {
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
      a.accountNumber.localeCompare(b.accountNumber, "fr-FR") ||
      a.name.localeCompare(b.name, "fr-FR")
    );
  });

  return {
    items,
    summary: {
      totalCount: items.length,
      customerCount: items.filter((item) => item.type === "CUSTOMER").length,
      supplierCount: items.filter((item) => item.type === "SUPPLIER").length,
      expenseCount: items.filter((item) => item.type === "EXPENSE").length,
      treasuryCount: items.filter((item) => item.type === "TREASURY").length,
      employeeCount: items.filter((item) => item.type === "EMPLOYEE").length,
    },
  };
}

export async function getBusinessAccountFormOptions(): Promise<BusinessAccountFormOptions> {
  return {
    accountingAccounts: await listAccountingAccountOptions(),
  };
}

export async function createBusinessAccount(
  input: BusinessAccountInput,
): Promise<BusinessAccountListItem> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const parsed = businessAccountInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Compte invalide.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  const data = parsed.data;
  if (data.accountingAccountId) {
    const accountingAccount = await prisma.accountingAccount.findFirst({
      where: {
        id: data.accountingAccountId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });
    if (!accountingAccount) {
      throw new OperationsServiceError("Compte comptable introuvable.", 422, {
        accountingAccountId: "Compte comptable introuvable.",
      });
    }
  }

  if (data.type === "CUSTOMER") {
    const customerData = await parseCustomerInput({
      code: null,
      name: data.name,
      phone: data.phone ?? "",
      email: data.email,
      address: data.address ?? "",
      city: data.city ?? "",
      latitude: data.latitude,
      longitude: data.longitude,
      type: "COUNTER",
      status: data.status,
      creditLimit: data.creditLimit ?? 0,
    });

    await ensureUniquePhone(user.organizationId, customerData.phone);

    const customer = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const code = await nextCustomerCode(tx, user.organizationId);
          const created = await tx.customer.create({
            data: {
              organizationId: user.organizationId,
              ...customerData,
              code,
              status: customerData.status ?? "ACTIVE",
              creditLimit: customerData.creditLimit ?? 0,
              currentBalance: data.balance ?? 0,
              createdByUserId: user.id,
              creationOrigin: "ADMIN",
            },
          });
          // Pre-warm the auxiliary accounting-plan account (e.g. 34211) so
          // the client is immediately selectable in "Choisir un compte",
          // instead of waiting for its first posted sale to create it.
          await resolveOrCreateAccountingLink(tx, user.organizationId, {
            explicitAccountingAccountId: null,
            code: resolveCustomerAuxiliaryCode(created.code),
            name: created.name,
            type: "RECEIVABLE",
          });
          return created;
        },
        { isolationLevel: "Serializable" },
      ),
    );

    return {
      id: `customer:${customer.id}`,
      sourceId: customer.id,
      accountNumber: customer.code,
      name: customer.name,
      type: "CUSTOMER",
      phone: customer.phone,
      creditLimit: customer.creditLimit.toNumber(),
      createdAt: customer.createdAt.toISOString(),
      email: customer.email,
      city: customer.city,
      address: customer.address,
      latitude: customer.latitude?.toNumber() ?? null,
      longitude: customer.longitude?.toNumber() ?? null,
      status: customer.status as BusinessAccountStatus,
    };
  }

  if (data.type === "SUPPLIER") {
    const supplier = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const code = await nextSupplierCode(tx, user.organizationId);
          const created = await tx.supplier.create({
            data: {
              organizationId: user.organizationId,
              code,
              name: data.name,
              phone: data.phone,
              email: data.email,
              address: data.address,
              city: data.city,
              ice: data.ice,
              taxId: data.taxId,
              active: data.status !== "INACTIVE",
            },
          });
          // Pre-warm the auxiliary accounting-plan account (e.g. 44111) so
          // the supplier is immediately selectable in "Choisir un compte",
          // instead of waiting for its first posted purchase to create it.
          await resolveOrCreateAccountingLink(tx, user.organizationId, {
            explicitAccountingAccountId: null,
            code: resolveSupplierAuxiliaryCode(created.code),
            name: created.name,
            type: "PAYABLE",
          });
          return created;
        },
        { isolationLevel: "Serializable" },
      ),
    );

    return {
      id: `supplier:${supplier.id}`,
      sourceId: supplier.id,
      accountNumber: supplier.code,
      name: supplier.name,
      type: "SUPPLIER",
      phone: supplier.phone ?? null,
      creditLimit: null,
      createdAt: supplier.createdAt.toISOString(),
      email: supplier.email,
      city: supplier.city,
      address: supplier.address,
      status: (supplier.active ? "ACTIVE" : "INACTIVE") as BusinessAccountStatus,
    };
  }

  if (data.type === "EXPENSE") {
    const code = data.code ?? (await nextExpenseAccountCode(user.organizationId));
    await ensureUniqueExpenseAccountCode(user.organizationId, code);

    const expense = await prisma.$transaction(async (tx) => {
      const accountingAccountId = await resolveOrCreateAccountingLink(
        tx,
        user.organizationId,
        {
          explicitAccountingAccountId: data.accountingAccountId ?? null,
          code,
          name: data.name,
          type: "EXPENSE",
        },
      );
      return tx.expenseAccount.create({
        data: {
          organizationId: user.organizationId,
          code,
          name: data.name,
          description: data.description,
          category: data.category,
          balance: data.balance ?? 0,
          accountingAccountId,
          active: data.status !== "INACTIVE",
        },
        include: { accountingAccount: true },
      });
    });

    return {
      id: `expense:${expense.id}`,
      sourceId: expense.id,
      accountNumber: expense.code,
      name: expense.name,
      type: "EXPENSE",
      phone: null,
      creditLimit: null,
      createdAt: expense.createdAt.toISOString(),
      city: null,
      status: (expense.active ? "ACTIVE" : "INACTIVE") as BusinessAccountStatus,
    };
  }

  const code = data.code ?? (await nextTreasuryAccountCode(user.organizationId));
  await ensureUniqueTreasuryAccountCode(user.organizationId, code);

  const treasury = await prisma.$transaction(async (tx) => {
    const accountingAccountId = await resolveOrCreateAccountingLink(
      tx,
      user.organizationId,
      {
        explicitAccountingAccountId: data.accountingAccountId ?? null,
        code,
        name: data.name,
        type: "TREASURY",
      },
    );
    return tx.treasuryAccount.create({
      data: {
        organizationId: user.organizationId,
        code,
        name: data.name,
        kind: data.treasuryKind ?? "CASH",
        balance: data.balance ?? 0,
        accountingAccountId,
        active: data.status !== "INACTIVE",
      },
      include: { accountingAccount: true },
    });
  });

  return {
    id: `treasury:${treasury.id}`,
    sourceId: treasury.id,
    accountNumber: treasury.code,
    name: treasury.name,
    type: "TREASURY",
    phone: null,
    creditLimit: null,
    createdAt: treasury.createdAt.toISOString(),
    city: null,
    status: (treasury.active ? "ACTIVE" : "INACTIVE") as BusinessAccountStatus,
  };
}

export async function updateBusinessAccount(
  accountId: string,
  input: BusinessAccountInput,
): Promise<BusinessAccountListItem> {
  await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

  const parsed = businessAccountInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Compte invalide.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  const data = parsed.data;
  const [sourceType, sourceId] = accountId.split(":");
  if (!sourceType || !sourceId) {
    throw new OperationsServiceError("Compte introuvable.", 404);
  }

  if (sourceType === "customer") {
    const customer = await updateCustomer(sourceId, {
      code: null,
      name: data.name,
      phone: data.phone ?? "",
      email: data.email,
      address: data.address ?? "",
      city: data.city ?? "",
      type: "COUNTER",
      status: data.status,
      creditLimit: data.creditLimit ?? 0,
      latitude: data.latitude,
      longitude: data.longitude,
    });

    return {
      id: `customer:${customer.id}`,
      sourceId: customer.id,
      accountNumber: customer.code,
      name: customer.name,
      type: "CUSTOMER",
      phone: customer.phone,
      creditLimit: customer.creditLimit,
      createdAt: customer.createdAt,
      email: customer.email,
      city: customer.city,
      address: customer.address,
      latitude: customer.latitude ?? null,
      longitude: customer.longitude ?? null,
      status: customer.status as BusinessAccountStatus,
    };
  }

  throw new OperationsServiceError(
    "La modification est actuellement disponible uniquement pour les comptes clients.",
    422,
  );
}

async function nextSupplierCode(
  tx: Pick<typeof prisma, "supplier">,
  organizationId: string,
) {
  const codes = await tx.supplier.findMany({
    where: {
      organizationId,
      code: { startsWith: supplierAccountPrefix },
    },
    select: { code: true },
  });
  return buildNextAccountNumber(
    codes.map((supplier) => supplier.code),
    supplierAccountPrefix,
  );
}

async function nextExpenseAccountCode(organizationId: string) {
  const last = await prisma.expenseAccount.findFirst({
    where: {
      organizationId,
      code: { startsWith: "CHG-" },
    },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const nextNumber = Number(last?.code.replace("CHG-", "") ?? "0") + 1;
  return `CHG-${String(nextNumber).padStart(4, "0")}`;
}

async function nextTreasuryAccountCode(organizationId: string) {
  const last = await prisma.treasuryAccount.findFirst({
    where: {
      organizationId,
      code: { startsWith: "TRE-" },
    },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const nextNumber = Number(last?.code.replace("TRE-", "") ?? "0") + 1;
  return `TRE-${String(nextNumber).padStart(4, "0")}`;
}

async function ensureUniqueExpenseAccountCode(organizationId: string, code: string) {
  const existing = await prisma.expenseAccount.findFirst({
    where: { code, organizationId },
    select: { id: true },
  });
  if (existing) {
    throw new OperationsServiceError("Une charge existe deja avec ce code.", 409, {
      code: "Une charge existe deja avec ce code.",
    });
  }
}

async function ensureUniqueTreasuryAccountCode(organizationId: string, code: string) {
  const existing = await prisma.treasuryAccount.findFirst({
    where: { code, organizationId },
    select: { id: true },
  });
  if (existing) {
    throw new OperationsServiceError("Une tresorerie existe deja avec ce code.", 409, {
      code: "Une tresorerie existe deja avec ce code.",
    });
  }
}

function buildNextAccountNumber(existingCodes: string[], prefix: string) {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const highest = existingCodes.reduce((max, code) => {
    const match = code.match(pattern);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `${prefix}${highest + 1}`;
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string };
      attempt += 1;

      if (!["P2002", "P2034"].includes(prismaError.code ?? "") || attempt >= maxAttempts) {
        throw error;
      }
    }
  }

  throw new OperationsServiceError("Impossible de générer le numéro de compte.", 500);
}
