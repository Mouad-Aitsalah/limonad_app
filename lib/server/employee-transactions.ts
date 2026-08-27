import "server-only";

import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { postEmployeePayrollAccountingEntry } from "@/lib/server/accounting";
import { requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import type { UserRole } from "@/types/auth";
import type {
  EmployeePayrollContextDto,
  EmployeeTransactionDto,
  EmployeeTransactionFilters,
  EmployeeTransactionInput,
} from "@/types/employees";

const employeeManagerRoles: UserRole[] = ["admin"];

const employeeSnapshotInclude = {
  advanceAccount: { select: { id: true, code: true, name: true } },
  salaryAccount: { select: { id: true, code: true, name: true } },
} as const;

const transactionInclude = {
  employee: {
    select: {
      employeeCode: true,
      fullName: true,
      salary: true,
      ...employeeSnapshotInclude,
    },
  },
  createdBy: { select: { fullName: true } },
  validatedBy: { select: { fullName: true } },
  cancelledBy: { select: { fullName: true } },
  accountingEntry: { select: { id: true, entryNumber: true } },
} as const;

type TransactionRecord = Prisma.EmployeeTransactionGetPayload<{
  include: typeof transactionInclude;
}>;

const transactionInputSchema = z.object({
  employeeId: z.string().trim().min(1, "L'employe est obligatoire."),
  transactionDate: z.string().trim().min(1, "La date est obligatoire."),
  payrollYear: z.coerce.number().int().min(2000).max(2100),
  payrollMonth: z.coerce.number().int().min(1).max(12),
  type: z.enum(["ADVANCE", "REMUNERATION_PERSONNEL", "TRANSFER"]),
  amount: z.coerce.number().positive("Le montant doit etre superieur a zero."),
  comment: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((value) => value || null),
  status: z.enum(["DRAFT", "VALIDATED", "CANCELLED"]).optional(),
  idempotencyKey: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .transform((value) => value || null),
});

export async function getEmployeePayrollContext(
  employeeId: string,
  input?: { payrollYear?: number | null; payrollMonth?: number | null },
): Promise<EmployeePayrollContextDto> {
  await requireSessionUser(employeeManagerRoles);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: employeeSnapshotInclude,
  });
  if (!employee) {
    throw new OperationsServiceError("Employe introuvable.", 404);
  }

  const period = resolvePayrollPeriod(input);
  const totals = await aggregateValidatedPeriod(prisma, {
    employeeId,
    payrollYear: period.payrollYear,
    payrollMonth: period.payrollMonth,
  });

  const salary = employee.salary?.toNumber() ?? 0;
  const remainingSalary = roundMoney(
    Math.max(0, salary - totals.advanceTotal - totals.transferredTotal),
  );

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    employeeName: employee.fullName,
    payrollYear: period.payrollYear,
    payrollMonth: period.payrollMonth,
    salary,
    remunerationTotal: totals.remunerationTotal,
    advanceTotal: totals.advanceTotal,
    transferredTotal: totals.transferredTotal,
    remainingSalary,
    paidAmount: roundMoney(totals.advanceTotal + totals.transferredTotal),
    isSettled: salary > 0 && remainingSalary === 0,
    advanceAccount: employee.advanceAccount,
    salaryAccount: employee.salaryAccount,
  };
}

export async function listEmployeeTransactions(
  filters: EmployeeTransactionFilters = {},
): Promise<EmployeeTransactionDto[]> {
  await requireSessionUser(employeeManagerRoles);

  const where: Prisma.EmployeeTransactionWhereInput = {};
  if (filters.employeeId) where.employeeId = filters.employeeId;
  if (filters.payrollYear) where.payrollYear = filters.payrollYear;
  if (filters.payrollMonth) where.payrollMonth = filters.payrollMonth;
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;

  const transactions = await prisma.employeeTransaction.findMany({
    where,
    include: transactionInclude,
    orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { number: "desc" }],
  });

  return transactions.map(mapTransactionToDto);
}

export async function getEmployeeTransactions(employeeId: string): Promise<EmployeeTransactionDto[]> {
  return listEmployeeTransactions({ employeeId });
}

/**
 * Server-side numbering + serializable transaction keep the payroll module
 * idempotent and balanced even if the user double-clicks "Valider".
 */
export async function createEmployeeTransaction(input: EmployeeTransactionInput): Promise<EmployeeTransactionDto> {
  const user = await requireSessionUser(employeeManagerRoles);
  const parsed = transactionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const status = parsed.data.status ?? "VALIDATED";
  if (status === "CANCELLED") {
    throw new OperationsServiceError("Une operation ne peut pas etre creee directement annulee.", 422);
  }

  const transaction = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        if (parsed.data.idempotencyKey) {
          const existing = await tx.employeeTransaction.findUnique({
            where: { idempotencyKey: parsed.data.idempotencyKey },
            include: transactionInclude,
          });
          if (existing) {
            return existing;
          }
        }

        const employee = await tx.employee.findUnique({
          where: { id: parsed.data.employeeId },
          include: employeeSnapshotInclude,
        });
        if (!employee) {
          throw new OperationsServiceError("Employe introuvable.", 404);
        }

        const number = await nextTransactionNumber(
          tx,
          parsed.data.payrollYear,
          parsed.data.payrollMonth,
        );

        const created = await tx.employeeTransaction.create({
          data: {
            employeeId: parsed.data.employeeId,
            number,
            transactionDate: parseDate(parsed.data.transactionDate),
            payrollYear: parsed.data.payrollYear,
            payrollMonth: parsed.data.payrollMonth,
            type: parsed.data.type,
            amount: parsed.data.amount,
            status: "DRAFT",
            comment: parsed.data.comment,
            idempotencyKey: parsed.data.idempotencyKey,
            createdByUserId: user.id,
          },
          include: transactionInclude,
        });

        if (status !== "VALIDATED") {
          return created;
        }

        return validateTransactionRecord(tx, created.id, user.id);
      },
      { isolationLevel: "Serializable" },
    ),
  );

  return mapTransactionToDto(transaction);
}

export async function validateEmployeeTransaction(id: string): Promise<EmployeeTransactionDto> {
  const user = await requireSessionUser(employeeManagerRoles);
  const transaction = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => validateTransactionRecord(tx, id, user.id),
      { isolationLevel: "Serializable" },
    ),
  );
  return mapTransactionToDto(transaction);
}

export async function cancelEmployeeTransaction(id: string): Promise<EmployeeTransactionDto> {
  const user = await requireSessionUser(employeeManagerRoles);

  const transaction = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.employeeTransaction.findUnique({
        where: { id },
        include: transactionInclude,
      });
      if (!existing) {
        throw new OperationsServiceError("Operation introuvable.", 404);
      }
      if (existing.status === "VALIDATED") {
        throw new OperationsServiceError(
          "Une operation validee ne peut pas etre annulee automatiquement.",
          409,
        );
      }
      if (existing.status === "CANCELLED") {
        return existing;
      }

      return tx.employeeTransaction.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledByUserId: user.id,
        },
        include: transactionInclude,
      });
    },
    { isolationLevel: "Serializable" },
  );

  return mapTransactionToDto(transaction);
}

async function validateTransactionRecord(
  tx: Prisma.TransactionClient,
  id: string,
  validatedByUserId: string,
) {
  const existing = await tx.employeeTransaction.findUnique({
    where: { id },
    include: transactionInclude,
  });
  if (!existing) {
    throw new OperationsServiceError("Operation introuvable.", 404);
  }
  if (existing.status === "VALIDATED") {
    return existing;
  }
  if (existing.status === "CANCELLED") {
    throw new OperationsServiceError("Une operation annulee ne peut pas etre validee.", 409);
  }

  const employee = await tx.employee.findUnique({
    where: { id: existing.employeeId },
    include: employeeSnapshotInclude,
  });
  if (!employee) {
    throw new OperationsServiceError("Employe introuvable.", 404);
  }

  const totals = await aggregateValidatedPeriod(tx, {
    employeeId: existing.employeeId,
    payrollYear: existing.payrollYear,
    payrollMonth: existing.payrollMonth,
  });
  const salary = employee.salary?.toNumber() ?? 0;
  if (salary <= 0) {
    throw new OperationsServiceError(
      "Le salaire mensuel de l'employe doit etre configure avant validation.",
      422,
      { salary: "Salaire mensuel manquant." },
    );
  }

  const amount = existing.amount.toNumber();
  const remainingBefore = roundMoney(
    Math.max(0, salary - totals.advanceTotal - totals.transferredTotal),
  );

  if (existing.type === "ADVANCE") {
    if (!employee.advanceAccountId) {
      throw new OperationsServiceError(
        "Veuillez configurer les comptes comptables de cet employe.",
        422,
        { advanceAccountId: "Compte avance manquant." },
      );
    }
    if (amount > remainingBefore) {
      throw new OperationsServiceError(
        "Le montant de l'avance depasse le reste du salaire.",
        422,
        { amount: "Le montant de l'avance depasse le reste du salaire." },
      );
    }
  }

  if (existing.type === "REMUNERATION_PERSONNEL") {
    if (!employee.salaryAccountId) {
      throw new OperationsServiceError(
        "Veuillez configurer les comptes comptables de cet employe.",
        422,
        { salaryAccountId: "Compte salaire manquant." },
      );
    }
    if (totals.remunerationTotal > 0) {
      throw new OperationsServiceError(
        "La remuneration du personnel est deja validee pour cette periode.",
        409,
      );
    }
    if (!amountEquals(amount, salary)) {
      throw new OperationsServiceError(
        "Le montant de la remuneration doit correspondre au salaire mensuel.",
        422,
        { amount: "Le montant doit correspondre au salaire mensuel." },
      );
    }
  }

  if (existing.type === "TRANSFER") {
    if (!employee.salaryAccountId) {
      throw new OperationsServiceError(
        "Veuillez configurer les comptes comptables de cet employe.",
        422,
        { salaryAccountId: "Compte salaire manquant." },
      );
    }
    if (totals.transferredTotal > 0) {
      throw new OperationsServiceError(
        "Le transfert du reste du salaire est deja valide pour cette periode.",
        409,
      );
    }
    if (remainingBefore <= 0) {
      throw new OperationsServiceError("Aucun reste de salaire a regler pour cette periode.", 422);
    }
    if (!amountEquals(amount, remainingBefore)) {
      throw new OperationsServiceError(
        "Le montant du transfert doit correspondre au reste du salaire.",
        422,
        { amount: "Le montant du transfert doit correspondre au reste du salaire." },
      );
    }
  }

  const advanceToOffset = existing.type === "TRANSFER" ? totals.advanceTotal : 0;
  const remainingAfter =
    existing.type === "ADVANCE"
      ? roundMoney(Math.max(0, remainingBefore - amount))
      : existing.type === "TRANSFER"
        ? 0
        : remainingBefore;

  const accountingEntry = await postEmployeePayrollAccountingEntry(tx, {
    operationId: existing.id,
    operationNumber: existing.number,
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    employeeName: employee.fullName,
    date: existing.transactionDate,
    payrollYear: existing.payrollYear,
    payrollMonth: existing.payrollMonth,
    type: existing.type,
    amount,
    salary,
    advanceTotal: totals.advanceTotal,
    advanceToOffset,
    remainingSalary: remainingAfter,
    advanceAccountId: employee.advanceAccountId,
    salaryAccountId: employee.salaryAccountId,
    createdByUserId: validatedByUserId,
  });

  return tx.employeeTransaction.update({
    where: { id: existing.id },
    data: {
      status: "VALIDATED",
      validatedAt: new Date(),
      validatedByUserId,
      accountingEntryId: accountingEntry.id,
    },
    include: transactionInclude,
  });
}

async function nextTransactionNumber(
  tx: Prisma.TransactionClient,
  payrollYear: number,
  payrollMonth: number,
) {
  const prefix = `SAL-${payrollYear}${String(payrollMonth).padStart(2, "0")}-`;
  const last = await tx.employeeTransaction.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSuffix = last?.number.match(/(\d{6})$/)?.[1];
  const next = (lastSuffix ? Number(lastSuffix) : 0) + 1;
  return `${prefix}${String(next).padStart(6, "0")}`;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function mapTransactionToDto(transaction: TransactionRecord): EmployeeTransactionDto {
  return {
    id: transaction.id,
    employeeId: transaction.employeeId,
    employeeCode: transaction.employee.employeeCode,
    employeeName: transaction.employee.fullName,
    number: transaction.number,
    transactionDate: transaction.transactionDate.toISOString(),
    payrollYear: transaction.payrollYear,
    payrollMonth: transaction.payrollMonth,
    type: transaction.type,
    amount: transaction.amount.toNumber(),
    status: transaction.status,
    comment: transaction.comment,
    accountingEntryId: transaction.accountingEntryId,
    accountingEntryNumber: transaction.accountingEntry?.entryNumber ?? null,
    createdByUserId: transaction.createdByUserId,
    createdByUserName: transaction.createdBy.fullName,
    validatedAt: transaction.validatedAt?.toISOString() ?? null,
    validatedByUserId: transaction.validatedByUserId ?? null,
    validatedByUserName: transaction.validatedBy?.fullName ?? null,
    cancelledAt: transaction.cancelledAt?.toISOString() ?? null,
    cancelledByUserId: transaction.cancelledByUserId ?? null,
    cancelledByUserName: transaction.cancelledBy?.fullName ?? null,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

export function mapEmployeeTransactionError(error: unknown) {
  if (error instanceof OperationsServiceError) return error;
  return new OperationsServiceError("Une erreur est survenue.", 500);
}

async function aggregateValidatedPeriod(
  db: typeof prisma | Prisma.TransactionClient,
  input: { employeeId: string; payrollYear: number; payrollMonth: number },
) {
  const rows = await db.employeeTransaction.groupBy({
    by: ["type"],
    where: {
      employeeId: input.employeeId,
      payrollYear: input.payrollYear,
      payrollMonth: input.payrollMonth,
      status: "VALIDATED",
    },
    _sum: { amount: true },
  });

  let advanceTotal = 0;
  let remunerationTotal = 0;
  let transferredTotal = 0;

  for (const row of rows) {
    const amount = row._sum.amount?.toNumber() ?? 0;
    if (row.type === "ADVANCE") advanceTotal = amount;
    if (row.type === "REMUNERATION_PERSONNEL") remunerationTotal = amount;
    if (row.type === "TRANSFER") transferredTotal = amount;
  }

  return { advanceTotal, remunerationTotal, transferredTotal };
}

function resolvePayrollPeriod(input?: {
  payrollYear?: number | null;
  payrollMonth?: number | null;
}) {
  const now = new Date();
  return {
    payrollYear: input?.payrollYear ?? now.getFullYear(),
    payrollMonth: input?.payrollMonth ?? now.getMonth() + 1,
  };
}

function amountEquals(left: number, right: number) {
  return Math.abs(roundMoney(left) - roundMoney(right)) < 0.001;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;

  const run = async (): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string };
      attempt += 1;
      if (!["P2002", "P2034"].includes(prismaError.code ?? "") || attempt >= maxAttempts) {
        throw error;
      }
      return run();
    }
  };

  return run();
}
