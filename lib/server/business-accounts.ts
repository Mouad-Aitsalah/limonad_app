import "server-only";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
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
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { AccountingAccountType } from "@/types/accounting";
import type {
  BusinessAccountFormOptions,
  BusinessAccountInput,
  BusinessAccountListItem,
  BusinessAccountsPageDto,
  BusinessAccountsSummaryDto,
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
    // F8-F: input-level sanity bounds only - see the server-side
    // assertMoneyRange calls in createBusinessAccount below (creditLimit is
    // also re-checked transitively via parseCustomerInput for the CUSTOMER
    // branch, but balance/currentBalance is unique to this file).
    creditLimit: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
    balance: z.coerce.number().min(0).max(MONEY_RANGE_MAX_NUMBER).optional(),
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

const ACCOUNTS_DEFAULT_PAGE_SIZE = 25;
const ACCOUNTS_MAX_PAGE_SIZE = 100;

const businessAccountListTypes = [
  "CUSTOMER",
  "SUPPLIER",
  "EXPENSE",
  "TREASURY",
  "EMPLOYEE",
] as const;

export type BusinessAccountsPageParams = {
  cursor?: string | null;
  pageSize?: number;
  /** Any other value (including "all"/undefined) means "every type". */
  type?: string;
  /** Any other value (including "all"/undefined) means "every status". */
  status?: string;
  city?: string;
  /** name / accountNumber(code) / phone / email - same fields the old,
   * fully-client-side AccountsView search used to match against. */
  search?: string;
};

function clampAccountsPageSize(pageSize: number | undefined): number {
  const requested = Math.trunc(pageSize ?? ACCOUNTS_DEFAULT_PAGE_SIZE);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, ACCOUNTS_MAX_PAGE_SIZE)
    : ACCOUNTS_DEFAULT_PAGE_SIZE;
}

function encodeAccountsCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}_${id}`;
}

function decodeAccountsCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const separatorIndex = cursor.indexOf("_");
  if (separatorIndex <= 0) return null;
  const ms = Number(cursor.slice(0, separatorIndex));
  const id = cursor.slice(separatorIndex + 1);
  if (!Number.isFinite(ms) || !id) return null;
  return { createdAt: new Date(ms), id };
}

/**
 * The "is this AccountingAccount actually an employee advance/salary
 * account, and not already surfaced as an Expense/Treasury business
 * account" predicate - shared between the paginated EMPLOYEE branch below
 * and the summary count, so the two never drift apart.
 */
function employeeAccountFilter(organizationId: string) {
  return Prisma.sql`
    acc."organizationId" = ${organizationId}
    AND (
      EXISTS (SELECT 1 FROM "Employee" e WHERE e."advanceAccountId" = acc.id)
      OR EXISTS (SELECT 1 FROM "Employee" e WHERE e."salaryAccountId" = acc.id)
    )
    AND acc.id NOT IN (
      SELECT "accountingAccountId" FROM "ExpenseAccount"
        WHERE "organizationId" = ${organizationId} AND "accountingAccountId" IS NOT NULL
      UNION
      SELECT "accountingAccountId" FROM "TreasuryAccount"
        WHERE "organizationId" = ${organizationId} AND "accountingAccountId" IS NOT NULL
    )
  `;
}

function customerBranch(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT 'customer:' || id AS id, id AS "sourceId", code AS "accountNumber", name,
           'CUSTOMER'::text AS type, phone, email, address, city,
           latitude::float8 AS latitude, longitude::float8 AS longitude,
           "creditLimit"::float8 AS "creditLimit", status::text AS status, "createdAt"
    FROM "Customer"
    WHERE "organizationId" = ${organizationId}
  `;
}

function supplierBranch(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT 'supplier:' || id AS id, id AS "sourceId", code AS "accountNumber", name,
           'SUPPLIER'::text AS type, phone, email, address, city,
           NULL::float8 AS latitude, NULL::float8 AS longitude,
           NULL::float8 AS "creditLimit",
           (CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END)::text AS status, "createdAt"
    FROM "Supplier"
    WHERE "organizationId" = ${organizationId}
  `;
}

function expenseBranch(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT 'expense:' || id AS id, id AS "sourceId", code AS "accountNumber", name,
           'EXPENSE'::text AS type, NULL::text AS phone, NULL::text AS email,
           NULL::text AS address, NULL::text AS city,
           NULL::float8 AS latitude, NULL::float8 AS longitude,
           NULL::float8 AS "creditLimit",
           (CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END)::text AS status, "createdAt"
    FROM "ExpenseAccount"
    WHERE "organizationId" = ${organizationId}
  `;
}

function treasuryBranch(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT 'treasury:' || id AS id, id AS "sourceId", code AS "accountNumber", name,
           'TREASURY'::text AS type, NULL::text AS phone, NULL::text AS email,
           NULL::text AS address, NULL::text AS city,
           NULL::float8 AS latitude, NULL::float8 AS longitude,
           NULL::float8 AS "creditLimit",
           (CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END)::text AS status, "createdAt"
    FROM "TreasuryAccount"
    WHERE "organizationId" = ${organizationId}
  `;
}

function employeeBranch(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT 'employee-account:' || acc.id AS id, acc.id AS "sourceId", acc.code AS "accountNumber",
           acc.name, 'EMPLOYEE'::text AS type, NULL::text AS phone, NULL::text AS email,
           NULL::text AS address, NULL::text AS city,
           NULL::float8 AS latitude, NULL::float8 AS longitude,
           NULL::float8 AS "creditLimit",
           (CASE WHEN acc."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END)::text AS status,
           acc."createdAt"
    FROM "AccountingAccount" acc
    WHERE ${employeeAccountFilter(organizationId)}
  `;
}

type RawAccountRow = {
  id: string;
  sourceId: string;
  accountNumber: string;
  name: string;
  type: BusinessAccountListItem["type"];
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  creditLimit: number | null;
  status: BusinessAccountStatus;
  createdAt: Date;
};

function mapRawRowToListItem(row: RawAccountRow): BusinessAccountListItem {
  return {
    id: row.id,
    sourceId: row.sourceId,
    accountNumber: row.accountNumber,
    name: row.name,
    type: row.type,
    phone: row.phone,
    creditLimit: row.creditLimit,
    createdAt: row.createdAt.toISOString(),
    email: row.email,
    city: row.city,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status,
  };
}

/**
 * Phase 3: /comptes ("Clients, fournisseurs et tiers") used to load ALL
 * rows from 4 tables (Customer/Supplier/ExpenseAccount/TreasuryAccount) plus
 * a derived 5th pseudo-type (AccountingAccount rows linked to an employee
 * advance/salary account) - fully unbounded, merged into one JS array, then
 * filtered/searched/sorted 100% client-side in AccountsView. At 10k+
 * clients that's a multi-megabyte payload and a full-table scan on every
 * page load.
 *
 * Replaced by one raw-SQL keyset-paginated query: each source is a UNION ALL
 * branch (only the branches matching the `type` filter are included, so
 * narrowing to type=CUSTOMER skips the other 4 tables entirely), wrapped so
 * status/city/search/cursor filters and the final ORDER BY + LIMIT apply
 * once, across the union, instead of once per branch. Cursor is `(createdAt,
 * id)` encoded as a single opaque string - the same keyset-pagination shape
 * as every other Phase 3 list, just hand-rolled here since Prisma's native
 * `cursor:{id}` only works against a single model, not a raw UNION.
 */
export async function getBusinessAccountsPage(
  params: BusinessAccountsPageParams = {},
): Promise<BusinessAccountsPageDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = currentUser.organizationId;
  const pageSize = clampAccountsPageSize(params.pageSize);
  const cursor = decodeAccountsCursor(params.cursor);
  const typeFilter =
    params.type && (businessAccountListTypes as readonly string[]).includes(params.type)
      ? (params.type as BusinessAccountListItem["type"])
      : null;
  const statusFilter =
    params.status && params.status !== "all" ? (params.status as BusinessAccountStatus) : null;
  const cityFilter = params.city && params.city !== "all" ? params.city : null;
  const search = params.search?.trim();

  const branches: Prisma.Sql[] = [];
  if (!typeFilter || typeFilter === "CUSTOMER") branches.push(customerBranch(organizationId));
  if (!typeFilter || typeFilter === "SUPPLIER") branches.push(supplierBranch(organizationId));
  if (!typeFilter || typeFilter === "EXPENSE") branches.push(expenseBranch(organizationId));
  if (!typeFilter || typeFilter === "TREASURY") branches.push(treasuryBranch(organizationId));
  if (!typeFilter || typeFilter === "EMPLOYEE") branches.push(employeeBranch(organizationId));

  const filters: Prisma.Sql[] = [Prisma.sql`1 = 1`];
  if (statusFilter) filters.push(Prisma.sql`status = ${statusFilter}`);
  if (cityFilter) filters.push(Prisma.sql`city = ${cityFilter}`);
  if (search) {
    const like = `%${search}%`;
    filters.push(
      Prisma.sql`("accountNumber" ILIKE ${like} OR name ILIKE ${like} OR COALESCE(phone, '') ILIKE ${like} OR COALESCE(email, '') ILIKE ${like})`,
    );
  }
  if (cursor) {
    filters.push(
      Prisma.sql`("createdAt" < ${cursor.createdAt} OR ("createdAt" = ${cursor.createdAt} AND id < ${cursor.id}))`,
    );
  }

  const [rows, summary, cities] = await Promise.all([
    prisma.$queryRaw<RawAccountRow[]>(Prisma.sql`
      WITH accounts AS (${Prisma.join(branches, " UNION ALL ")})
      SELECT * FROM accounts
      WHERE ${Prisma.join(filters, " AND ")}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${pageSize + 1}
    `),
    fetchAccountsSummary(organizationId),
    fetchAccountCities(organizationId),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const lastRow = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(mapRawRowToListItem),
    nextCursor: hasMore && lastRow ? encodeAccountsCursor(lastRow.createdAt, lastRow.id) : null,
    hasMore,
    summary,
    cities,
  };
}

/** Global per-type counts, always unfiltered by the current search/type/
 * status/city selection - matches the summary cards' pre-existing meaning
 * (org-wide totals, not "how many match my current filter"). */
async function fetchAccountsSummary(organizationId: string): Promise<BusinessAccountsSummaryDto> {
  const [customerCount, supplierCount, expenseCount, treasuryCount, employeeRows] = await Promise.all([
    prisma.customer.count({ where: { organizationId } }),
    prisma.supplier.count({ where: { organizationId } }),
    prisma.expenseAccount.count({ where: { organizationId } }),
    prisma.treasuryAccount.count({ where: { organizationId } }),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM "AccountingAccount" acc
      WHERE ${employeeAccountFilter(organizationId)}
    `),
  ]);
  const employeeCount = employeeRows[0]?.count ?? 0;

  return {
    totalCount: customerCount + supplierCount + expenseCount + treasuryCount + employeeCount,
    customerCount,
    supplierCount,
    expenseCount,
    treasuryCount,
    employeeCount,
  };
}

/** Distinct cities across Customer + Supplier (the only 2 types that carry
 * one) - used to populate the "Ville" filter dropdown without loading every
 * row client-side just to derive its own filter options. */
async function fetchAccountCities(organizationId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ city: string }>>(Prisma.sql`
    SELECT DISTINCT city FROM (
      SELECT city FROM "Customer" WHERE "organizationId" = ${organizationId} AND city IS NOT NULL
      UNION
      SELECT city FROM "Supplier" WHERE "organizationId" = ${organizationId} AND city IS NOT NULL
    ) cities
    ORDER BY city ASC
  `);
  return rows.map((row) => row.city);
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

    // F8-F: currentBalance's initial value is unique to this file (bypasses
    // parseCustomerInput, which has no balance/currentBalance field of its
    // own) - checked here, before the transaction below creates the row.
    assertMoneyRange(data.balance ?? 0, "customer.currentBalance");

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
    // F8-F: ExpenseAccount.balance is Decimal(12,2), checked before the
    // transaction below creates the row.
    assertMoneyRange(data.balance ?? 0, "expenseAccount.balance");

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
  // F8-F: TreasuryAccount.balance is Decimal(12,2), checked before the
  // transaction below creates the row.
  assertMoneyRange(data.balance ?? 0, "treasuryAccount.balance");

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
  tx: Pick<typeof prisma, "supplier" | "$queryRaw">,
  organizationId: string,
) {
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.SupplierCode,
  );
  return `${supplierAccountPrefix}${number}`;
}

async function nextExpenseAccountCode(organizationId: string) {
  const number = await reserveDocumentSequence(
    prisma,
    organizationId,
    DocumentType.ExpenseAccountCode,
  );
  return `CHG-${String(number).padStart(4, "0")}`;
}

async function nextTreasuryAccountCode(organizationId: string) {
  const number = await reserveDocumentSequence(
    prisma,
    organizationId,
    DocumentType.TreasuryAccountCode,
  );
  return `TRE-${String(number).padStart(4, "0")}`;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 40): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string; message?: string };
      attempt += 1;
      const isRetryable =
        ["P2002", "P2034"].includes(prismaError.code ?? "") ||
        (prismaError.code === "P2010" &&
          /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }
      // Jittered backoff: under N-way true-simultaneous contention on the
      // same counter row, retrying instantly just re-collides with the same
      // herd (empirically verified: without this, 50-100-way concurrent
      // reserveDocumentSequence() calls exhausted immediate retries - see
      // scripts/_tmp-test-real-generators.ts in the Phase 3 numbering
      // chantier report).
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }

  throw new OperationsServiceError("Impossible de générer le numéro de compte.", 500);
}
