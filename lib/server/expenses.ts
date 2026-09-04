import "server-only";

import { z } from "zod";

import { MONEY_RANGE_MAX_NUMBER, roundMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { Prisma } from "@/lib/generated/prisma/client";
import type {
  ExpenseDto,
  ExpenseMutationInput,
  ExpensesPageDto,
  ExpensesPageParams,
} from "@/types/expense";

/**
 * BI Phase 2A - operating expenses (loyer, carburant, electricite,
 * telephone, reparation, transport...), deliberately separate from
 * Purchase (merchandise/stock - see lib/server/purchases.ts) and from
 * ExpenseAccount (the chart-of-accounts CATEGORY directory, reused here as
 * `expenseAccountId`, never duplicated). Ledger posting (accountingEntryId)
 * is NOT wired yet - Phase 2A-bis, by decision - so validating/cancelling a
 * charge here never touches AccountingEntry.
 */

const expenseInclude = {
  expenseAccount: { select: { name: true } },
  supplier: { select: { name: true } },
  createdBy: { select: { fullName: true } },
  validatedBy: { select: { fullName: true } },
  cancelledBy: { select: { fullName: true } },
} as const;

type ExpenseRecord = NonNullable<Awaited<ReturnType<typeof getExpenseRecordById>>>;

const optionalString = () =>
  z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();

const expenseMutationSchema = z.object({
  expenseAccountId: z.string().trim().min(1, "La categorie de charge est obligatoire."),
  date: z.coerce.date({ error: "La date est obligatoire." }),
  description: z.string().trim().min(1, "La designation est obligatoire."),
  supplierId: optionalString(),
  amountHT: z.coerce
    .number()
    .min(0, "Le montant HT ne peut pas etre negatif.")
    .max(MONEY_RANGE_MAX_NUMBER, "Le montant HT depasse la limite autorisee."),
  taxAmount: z.coerce
    .number()
    .min(0, "La TVA ne peut pas etre negative.")
    .max(MONEY_RANGE_MAX_NUMBER, "La TVA depasse la limite autorisee.")
    .optional(),
  method: z.enum(["CASH", "CARD", "CHECK", "BANK_TRANSFER", "CREDIT", "MIXED"]).nullable().optional(),
  reference: optionalString(),
  note: optionalString(),
  idempotencyKey: optionalString(),
});

function mapExpenseToDto(expense: ExpenseRecord): ExpenseDto {
  return {
    id: expense.id,
    expenseNumber: expense.expenseNumber,
    expenseAccountId: expense.expenseAccountId,
    expenseAccountName: expense.expenseAccount.name,
    date: expense.date.toISOString(),
    description: expense.description,
    supplierId: expense.supplierId,
    supplierName: expense.supplier?.name ?? null,
    amountHT: expense.amountHT.toNumber(),
    taxAmount: expense.taxAmount.toNumber(),
    amountTTC: expense.amountTTC.toNumber(),
    method: expense.method,
    reference: expense.reference,
    note: expense.note,
    status: expense.status,
    createdByUserId: expense.createdByUserId,
    createdByUserName: expense.createdBy.fullName,
    validatedByUserId: expense.validatedByUserId,
    validatedByUserName: expense.validatedBy?.fullName ?? null,
    validatedAt: expense.validatedAt?.toISOString() ?? null,
    cancelledByUserId: expense.cancelledByUserId,
    cancelledByUserName: expense.cancelledBy?.fullName ?? null,
    cancelledAt: expense.cancelledAt?.toISOString() ?? null,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

async function getExpenseRecordById(id: string, organizationId: string) {
  return prisma.expense.findFirst({
    where: { id, organizationId },
    include: expenseInclude,
  });
}

async function assertExpenseAccountBelongsToOrg(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  expenseAccountId: string,
) {
  const account = await db.expenseAccount.findFirst({
    where: { id: expenseAccountId, organizationId },
    select: { id: true },
  });
  if (!account) {
    throw new OperationsServiceError("Categorie de charge introuvable.", 422, {
      expenseAccountId: "Categorie de charge introuvable.",
    });
  }
}

async function assertSupplierBelongsToOrg(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  supplierId: string,
) {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, organizationId },
    select: { id: true },
  });
  if (!supplier) {
    throw new OperationsServiceError("Fournisseur introuvable.", 422, {
      supplierId: "Fournisseur introuvable.",
    });
  }
}

function parseExpenseInput(input: ExpenseMutationInput) {
  const parsed = expenseMutationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }
  const data = parsed.data;
  assertMoneyRange(data.amountHT, "expense.amountHT");
  const taxAmount = data.taxAmount ?? 0;
  assertMoneyRange(taxAmount, "expense.taxAmount");
  const amountTTC = roundMoney(data.amountHT + taxAmount);
  assertMoneyRange(amountTTC, "expense.amountTTC");
  return { ...data, taxAmount, amountTTC };
}

async function nextExpenseNumber(
  tx: Pick<typeof prisma, "$queryRaw">,
  organizationId: string,
) {
  const number = await reserveDocumentSequence(tx, organizationId, DocumentType.ExpenseNumber);
  return `DPN-${String(number).padStart(6, "0")}`;
}

/**
 * Idempotent: a repeated call with the same idempotencyKey (double-click,
 * retried request) returns the already-created row instead of a duplicate -
 * checked both before writing (fast path) and via the unique constraint
 * (race fallback), same pattern as Sale.idempotencyKey elsewhere.
 */
export async function createExpense(input: ExpenseMutationInput): Promise<ExpenseDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const data = parseExpenseInput(input);

  if (data.idempotencyKey) {
    const existing = await prisma.expense.findFirst({
      where: { organizationId: user.organizationId, idempotencyKey: data.idempotencyKey },
      include: expenseInclude,
    });
    if (existing) return mapExpenseToDto(existing);
  }

  await assertExpenseAccountBelongsToOrg(prisma, user.organizationId, data.expenseAccountId);
  if (data.supplierId) {
    await assertSupplierBelongsToOrg(prisma, user.organizationId, data.supplierId);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const expenseNumber = await nextExpenseNumber(tx, user.organizationId);
      return tx.expense.create({
        data: {
          organizationId: user.organizationId,
          expenseNumber,
          expenseAccountId: data.expenseAccountId,
          date: data.date,
          description: data.description,
          supplierId: data.supplierId ?? null,
          amountHT: data.amountHT,
          taxAmount: data.taxAmount,
          amountTTC: data.amountTTC,
          method: data.method ?? null,
          reference: data.reference ?? null,
          note: data.note ?? null,
          status: "DRAFT",
          idempotencyKey: data.idempotencyKey ?? null,
          createdByUserId: user.id,
        },
        include: expenseInclude,
      });
    });
    return mapExpenseToDto(created);
  } catch (error) {
    const prismaError = error as { code?: string; meta?: { target?: string[] } };
    if (prismaError.code === "P2002" && data.idempotencyKey) {
      const existing = await prisma.expense.findFirst({
        where: { organizationId: user.organizationId, idempotencyKey: data.idempotencyKey },
        include: expenseInclude,
      });
      if (existing) return mapExpenseToDto(existing);
    }
    throw error;
  }
}

/** DRAFT only - a VALIDATED or CANCELLED charge is not modifiable normally. */
export async function updateExpense(
  id: string,
  input: ExpenseMutationInput,
): Promise<ExpenseDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getExpenseRecordById(id, user.organizationId);
  if (!existing) throw new OperationsServiceError("Charge introuvable.", 404);
  if (existing.status !== "DRAFT") {
    throw new OperationsServiceError("Seule une charge en brouillon peut etre modifiee.", 409);
  }

  const data = parseExpenseInput(input);
  await assertExpenseAccountBelongsToOrg(prisma, user.organizationId, data.expenseAccountId);
  if (data.supplierId) {
    await assertSupplierBelongsToOrg(prisma, user.organizationId, data.supplierId);
  }

  const updated = await prisma.expense.update({
    where: { id: existing.id },
    data: {
      expenseAccountId: data.expenseAccountId,
      date: data.date,
      description: data.description,
      supplierId: data.supplierId ?? null,
      amountHT: data.amountHT,
      taxAmount: data.taxAmount,
      amountTTC: data.amountTTC,
      method: data.method ?? null,
      reference: data.reference ?? null,
      note: data.note ?? null,
    },
    include: expenseInclude,
  });
  return mapExpenseToDto(updated);
}

/** Idempotent: validating an already-VALIDATED charge just returns it. */
export async function validateExpense(id: string): Promise<ExpenseDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getExpenseRecordById(id, user.organizationId);
  if (!existing) throw new OperationsServiceError("Charge introuvable.", 404);
  if (existing.status === "VALIDATED") return mapExpenseToDto(existing);
  if (existing.status === "CANCELLED") {
    throw new OperationsServiceError("Charge annulee, validation impossible.", 409);
  }

  const updated = await prisma.expense.update({
    where: { id: existing.id },
    data: { status: "VALIDATED", validatedByUserId: user.id, validatedAt: new Date() },
    include: expenseInclude,
  });
  return mapExpenseToDto(updated);
}

/** Idempotent: cancelling an already-CANCELLED charge just returns it. No
 * ledger reversal needed - Expense never posts to AccountingEntry yet
 * (Phase 2A-bis). A CANCELLED charge is excluded from the "Charges" KPI. */
export async function cancelExpense(id: string): Promise<ExpenseDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getExpenseRecordById(id, user.organizationId);
  if (!existing) throw new OperationsServiceError("Charge introuvable.", 404);
  if (existing.status === "CANCELLED") return mapExpenseToDto(existing);

  const updated = await prisma.expense.update({
    where: { id: existing.id },
    data: { status: "CANCELLED", cancelledByUserId: user.id, cancelledAt: new Date() },
    include: expenseInclude,
  });
  return mapExpenseToDto(updated);
}

const EXPENSES_DEFAULT_PAGE_SIZE = 25;
const EXPENSES_MAX_PAGE_SIZE = 100;

function clampExpensesPageSize(pageSize: number | undefined): number {
  const requested = Math.trunc(pageSize ?? EXPENSES_DEFAULT_PAGE_SIZE);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, EXPENSES_MAX_PAGE_SIZE)
    : EXPENSES_DEFAULT_PAGE_SIZE;
}

/** Keyset-paginated list for a future /charges screen - same (createdAt
 * desc, id desc) cursor shape as getLoadingHistoryPage / getBusinessAccountsPage. */
export async function getExpensesPage(
  params: ExpensesPageParams = {},
): Promise<ExpensesPageDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const pageSize = clampExpensesPageSize(params.pageSize);

  const where: Prisma.ExpenseWhereInput = { organizationId: user.organizationId };
  if (params.status) where.status = params.status as Prisma.ExpenseWhereInput["status"];
  if (params.expenseAccountId) where.expenseAccountId = params.expenseAccountId;
  if (params.dateFrom || params.dateTo) {
    where.date = {
      ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
      ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
    };
  }

  const [rows, totalCount] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: expenseInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    prisma.expense.count({ where }),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    items: pageRows.map(mapExpenseToDto),
    nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    hasMore,
    totalCount,
  };
}

/**
 * BI Phase 2A helper - the "Charges" KPI. A CANCELLED charge never counts;
 * neither does a DRAFT one (not yet a real commitment).
 */
export async function totalValidatedExpensesHT(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const result = await prisma.expense.aggregate({
    where: { organizationId, status: "VALIDATED", date: { gte: from, lt: to } },
    _sum: { amountHT: true },
  });
  return roundMoney(result._sum.amountHT?.toNumber() ?? 0);
}
