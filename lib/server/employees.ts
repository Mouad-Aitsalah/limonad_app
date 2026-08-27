import "server-only";

import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeAccountCode } from "@/lib/server/accounting";
import { requireSessionUser } from "@/lib/server/auth";
import {
  getEmployeePayrollContext,
  listEmployeeTransactions,
} from "@/lib/server/employee-transactions";
import { OperationsServiceError } from "@/lib/server/depots";
import type { AccountingAccountType } from "@/types/accounting";
import type { UserRole } from "@/types/auth";
import type {
  EmployeeDetailPayload,
  EmployeeDto,
  EmployeeInput,
  EmployeeOptionDto,
  EmployeesPayload,
} from "@/types/employees";

// COMDIS has no "super_admin" role - this maps the spec's "ADMIN / SUPER_ADMIN"
// onto the real role enum, same substitution already used for /contacts.
const employeeManagerRoles: UserRole[] = ["admin"];

const employeeInclude = {
  advanceAccount: { select: { id: true, code: true, name: true } },
  salaryAccount: { select: { id: true, code: true, name: true } },
} as const;

type DbClient = typeof prisma | Prisma.TransactionClient;
type EmployeeRecord = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

const optionalString = () =>
  z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();

const employeeInputSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(1, "Le code employe est obligatoire.")
    .max(60),
  fullName: z.string().trim().min(1, "Le nom complet est obligatoire.").max(160),
  hireDate: optionalString(),
  // Salary always Decimal in Postgres; phone is always free-form text (never
  // coerced to a number) so a leading 0 or international format survives.
  salary: z.coerce.number().min(0, "Le salaire ne peut pas etre negatif.").nullable().optional(),
  phone: optionalString(),
  advanceAccountCode: z
    .string()
    .trim()
    .min(1, "Le compte avance est obligatoire.")
    .max(24, "Le compte avance est trop long."),
  salaryAccountCode: z
    .string()
    .trim()
    .min(1, "Le compte salaire est obligatoire.")
    .max(24, "Le compte salaire est trop long."),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
}).superRefine((data, ctx) => {
  if (
    normalizeAccountCode(data.advanceAccountCode) ===
    normalizeAccountCode(data.salaryAccountCode)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["salaryAccountCode"],
      message: "Le compte salaire doit etre different du compte avance.",
    });
  }
});

export async function getEmployees(): Promise<EmployeesPayload> {
  await requireSessionUser(employeeManagerRoles);

  const employees = await prisma.employee.findMany({
    include: employeeInclude,
    orderBy: [{ createdAt: "desc" }, { employeeCode: "asc" }],
  });
  const items = employees.map(mapEmployeeToDto);

  const period = getCurrentPayrollPeriod();
  const monthlyAdvancesAgg = await prisma.employeeTransaction.aggregate({
    where: {
      type: "ADVANCE",
      status: "VALIDATED",
      payrollYear: period.payrollYear,
      payrollMonth: period.payrollMonth,
    },
    _sum: { amount: true },
  });

  return {
    items,
    summary: {
      totalCount: items.length,
      activeCount: items.filter((employee) => employee.status === "ACTIVE").length,
      monthlyPayroll: roundMoney(
        items
          .filter((employee) => employee.status === "ACTIVE")
          .reduce((sum, employee) => sum + (employee.salary ?? 0), 0),
      ),
      monthlyAdvances: roundMoney(monthlyAdvancesAgg._sum.amount?.toNumber() ?? 0),
    },
  };
}

export async function getEmployeeById(id: string): Promise<EmployeeDto> {
  await requireSessionUser(employeeManagerRoles);
  const employee = await prisma.employee.findUnique({ where: { id }, include: employeeInclude });
  if (!employee) {
    throw new OperationsServiceError("Employe introuvable.", 404);
  }
  return mapEmployeeToDto(employee);
}

export async function getEmployeeOptions(): Promise<EmployeeOptionDto[]> {
  await requireSessionUser(employeeManagerRoles);

  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    include: employeeInclude,
    orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
  });

  return employees.map((employee) => ({
    id: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    salary: employee.salary?.toNumber() ?? null,
    status: employee.status,
    advanceAccount: employee.advanceAccount,
    salaryAccount: employee.salaryAccount,
  }));
}

export async function getEmployeeDetail(
  id: string,
  input?: { payrollYear?: number | null; payrollMonth?: number | null },
): Promise<EmployeeDetailPayload> {
  await requireSessionUser(employeeManagerRoles);

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: employeeInclude,
  });
  if (!employee) {
    throw new OperationsServiceError("Employe introuvable.", 404);
  }

  const period = resolvePayrollPeriod(input);
  const [payrollContext, history] = await Promise.all([
    getEmployeePayrollContext(employee.id, period),
    listEmployeeTransactions({
      employeeId: employee.id,
      payrollYear: period.payrollYear,
      payrollMonth: period.payrollMonth,
    }),
  ]);

  return {
    employee: mapEmployeeToDto(employee),
    period: payrollContext,
    history,
  };
}

export async function createEmployee(input: EmployeeInput): Promise<EmployeeDto> {
  await requireSessionUser(employeeManagerRoles);
  const data = validateEmployeeInput(input);

  try {
    const employee = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          await assertUniqueEmployeeCode(tx, data.employeeCode);
          const advanceAccountId = await resolveEmployeeAccountingLink(tx, {
            code: data.advanceAccountCode,
            name: buildEmployeeAdvanceAccountName(data.fullName),
            type: "RECEIVABLE",
            field: "advanceAccountCode",
          });
          const salaryAccountId = await resolveEmployeeAccountingLink(tx, {
            code: data.salaryAccountCode,
            name: buildEmployeeSalaryAccountName(data.fullName),
            type: "PAYABLE",
            field: "salaryAccountCode",
          });

          return tx.employee.create({
            data: {
              employeeCode: data.employeeCode,
              fullName: data.fullName,
              hireDate: parseDate(data.hireDate),
              salary: data.salary ?? null,
              phone: data.phone,
              advanceAccountId,
              salaryAccountId,
              status: data.status ?? "ACTIVE",
            },
            include: employeeInclude,
          });
        },
        { isolationLevel: "Serializable" },
      ),
    );
    return mapEmployeeToDto(employee);
  } catch (error) {
    throw mapEmployeeError(error);
  }
}

/**
 * Editing an employee (salary, dates, linked accounts, status) never
 * touches EmployeeTransaction rows - the two tables are fully separate, so
 * past advances/bonuses are never silently altered by a later edit.
 */
export async function updateEmployee(id: string, input: EmployeeInput): Promise<EmployeeDto> {
  await requireSessionUser(employeeManagerRoles);
  const data = validateEmployeeInput(input);

  try {
    const employee = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const existing = await tx.employee.findUnique({
            where: { id },
            select: { id: true },
          });
          if (!existing) {
            throw new OperationsServiceError("Employe introuvable.", 404);
          }

          await assertUniqueEmployeeCode(tx, data.employeeCode, id);
          const advanceAccountId = await resolveEmployeeAccountingLink(tx, {
            code: data.advanceAccountCode,
            name: buildEmployeeAdvanceAccountName(data.fullName),
            type: "RECEIVABLE",
            field: "advanceAccountCode",
          });
          const salaryAccountId = await resolveEmployeeAccountingLink(tx, {
            code: data.salaryAccountCode,
            name: buildEmployeeSalaryAccountName(data.fullName),
            type: "PAYABLE",
            field: "salaryAccountCode",
          });

          return tx.employee.update({
            where: { id },
            data: {
              employeeCode: data.employeeCode,
              fullName: data.fullName,
              hireDate: parseDate(data.hireDate),
              salary: data.salary ?? null,
              phone: data.phone,
              advanceAccountId,
              salaryAccountId,
              status: data.status ?? "ACTIVE",
            },
            include: employeeInclude,
          });
        },
        { isolationLevel: "Serializable" },
      ),
    );
    return mapEmployeeToDto(employee);
  } catch (error) {
    throw mapEmployeeError(error);
  }
}

function validateEmployeeInput(input: EmployeeInput) {
  const parsed = employeeInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }
  return parsed.data;
}

async function assertUniqueEmployeeCode(
  db: DbClient,
  employeeCode: string,
  employeeIdToIgnore?: string,
) {
  const existing = await db.employee.findUnique({
    where: { employeeCode },
    select: { id: true },
  });
  if (existing && existing.id !== employeeIdToIgnore) {
    throw new OperationsServiceError("Ce code employe existe deja.", 409, {
      employeeCode: "Ce code employe existe deja.",
    });
  }
}

async function resolveEmployeeAccountingLink(
  db: DbClient,
  input: {
    code: string;
    name: string;
    type: AccountingAccountType;
    field: "advanceAccountCode" | "salaryAccountCode";
  },
) {
  const normalizedCode = normalizeAccountCode(input.code);
  const existing = await db.accountingAccount.findUnique({
    where: { code: normalizedCode },
    select: { id: true, type: true },
  });

  if (existing) {
    if (existing.type !== input.type) {
      throw new OperationsServiceError(
        `Le compte comptable ${normalizedCode} existe deja avec un type incompatible.`,
        409,
        {
          [input.field]: `Le compte ${normalizedCode} existe deja avec un type incompatible.`,
        },
      );
    }
    return existing.id;
  }

  const created = await db.accountingAccount.create({
    data: {
      code: normalizedCode,
      name: input.name,
      type: input.type,
      isActive: true,
    },
    select: { id: true },
  });

  return created.id;
}

// A plain "YYYY-MM-DD" date-input value is unambiguous, so anchoring it
// directly at UTC midnight avoids the local-timezone-shift bug that hit the
// cash-deposit "date" column (constructing via new Date(y,m,d) then storing
// into a @db.Date column can silently roll back a day under UTC+1).
function parseDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

function mapEmployeeToDto(employee: EmployeeRecord): EmployeeDto {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    hireDate: employee.hireDate ? employee.hireDate.toISOString() : null,
    salary: employee.salary?.toNumber() ?? null,
    phone: employee.phone,
    advanceAccount: employee.advanceAccount,
    salaryAccount: employee.salaryAccount,
    status: employee.status,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getCurrentPayrollPeriod() {
  return resolvePayrollPeriod();
}

function resolvePayrollPeriod(input?: {
  payrollYear?: number | null;
  payrollMonth?: number | null;
}) {
  const now = new Date();
  const payrollYear = input?.payrollYear ?? now.getFullYear();
  const payrollMonth = input?.payrollMonth ?? now.getMonth() + 1;
  return { payrollYear, payrollMonth };
}

export function mapEmployeeError(error: unknown) {
  if (error instanceof OperationsServiceError) return error;
  const prismaError = error as {
    code?: string;
    meta?: { target?: string | string[] };
  };
  if (prismaError.code === "P2002") {
    const targets = Array.isArray(prismaError.meta?.target)
      ? prismaError.meta?.target
      : prismaError.meta?.target
        ? [prismaError.meta.target]
        : [];
    if (targets.some((target) => String(target).includes("employeeCode"))) {
      return new OperationsServiceError("Ce code employe existe deja.", 409, {
        employeeCode: "Ce code employe existe deja.",
      });
    }
    return new OperationsServiceError("Ce code employe existe deja.", 409, {
      employeeCode: "Ce code employe existe deja.",
    });
  }
  if (prismaError.code === "P2025") {
    return new OperationsServiceError("Employe introuvable.", 404);
  }
  return new OperationsServiceError("Une erreur est survenue.", 500);
}

function buildEmployeeAdvanceAccountName(fullName: string) {
  return `Avances et acomptes au personnel ${fullName.trim()}`;
}

function buildEmployeeSalaryAccountName(fullName: string) {
  return `Rémunération due au personnel ${fullName.trim()}`;
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

  throw new OperationsServiceError("Impossible d'enregistrer l'employe.", 500);
}
