import { z } from "zod";

import { normalizeAccountCode } from "@/lib/accounting-codes";
import type { Prisma } from "@/lib/generated/prisma/client";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/service-error";
import type { AccountingAccountType } from "@/types/accounting";
import type { EmployeeInput } from "@/types/employees";

// The rules of an employee record, moved UNCHANGED from lib/server/employees.ts
// (which uses them for createEmployee / updateEmployee) so that the accounts
// import applies exactly the same validation and accounting links - without the
// "server-only" marker, so they are testable. They never decide who may call
// them: every caller authorises first.

type DbClient = Prisma.TransactionClient | typeof import("@/lib/prisma").prisma;

const optionalString = () =>
  z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();

export const employeeInputSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(1, "Le code employe est obligatoire.")
    .max(60),
  fullName: z.string().trim().min(1, "Le nom complet est obligatoire.").max(160),
  hireDate: optionalString(),
  // Salary always Decimal in Postgres; phone is always free-form text (never
  // coerced to a number) so a leading 0 or international format survives.
  // F8-F: input-level sanity bound only - see the server-side
  // assertMoneyRange call in validateEmployeeInput below.
  salary: z.coerce
    .number()
    .min(0, "Le salaire ne peut pas etre negatif.")
    .max(MONEY_RANGE_MAX_NUMBER, "Le salaire depasse la limite autorisee.")
    .nullable()
    .optional(),
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

export function validateEmployeeInput(input: EmployeeInput) {
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
  // F8-F: server-side gate, kept independent of the Zod .max() above - this
  // is the single choke point both createEmployee and updateEmployee funnel
  // through.
  if (parsed.data.salary != null) {
    assertMoneyRange(parsed.data.salary, "salary");
  }
  return parsed.data;
}

export async function assertUniqueEmployeeCode(
  db: DbClient,
  organizationId: string,
  employeeCode: string,
  employeeIdToIgnore?: string,
) {
  const existing = await db.employee.findFirst({
    where: { employeeCode, organizationId },
    select: { id: true },
  });
  if (existing && existing.id !== employeeIdToIgnore) {
    throw new OperationsServiceError("Ce code employe existe deja.", 409, {
      employeeCode: "Ce code employe existe deja.",
    });
  }
}

export async function resolveEmployeeAccountingLink(
  db: DbClient,
  organizationId: string,
  input: {
    code: string;
    name: string;
    type: AccountingAccountType;
    field: "advanceAccountCode" | "salaryAccountCode";
  },
) {
  const normalizedCode = normalizeAccountCode(input.code);
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
          [input.field]: `Le compte ${normalizedCode} existe deja avec un type incompatible.`,
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

// A plain "YYYY-MM-DD" date-input value is unambiguous, so anchoring it
// directly at UTC midnight avoids the local-timezone-shift bug that hit the
// cash-deposit "date" column (constructing via new Date(y,m,d) then storing
// into a @db.Date column can silently roll back a day under UTC+1).
export function parseEmployeeDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

export function buildEmployeeAdvanceAccountName(fullName: string) {
  return `Avances et acomptes au personnel ${fullName.trim()}`;
}

export function buildEmployeeSalaryAccountName(fullName: string) {
  return `Rémunération due au personnel ${fullName.trim()}`;
}

