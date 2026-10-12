import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { roundMoney as roundMoneyDecimal } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  getEmployeePayrollContext,
  listEmployeeTransactions,
} from "@/lib/server/employee-transactions";
import { OperationsServiceError } from "@/lib/server/depots";
import {
  assertUniqueEmployeeCode,
  buildEmployeeAdvanceAccountName,
  buildEmployeeSalaryAccountName,
  parseEmployeeDate,
  resolveEmployeeAccountingLink,
  validateEmployeeInput,
} from "@/lib/server/employee-core";
import { requireOrganizationUser } from "@/lib/server/organization-context";
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

type EmployeeRecord = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

export async function getEmployees(): Promise<EmployeesPayload> {
  const currentUser = await requireOrganizationUser(employeeManagerRoles);

  const employees = await prisma.employee.findMany({
    where: { organizationId: currentUser.organizationId },
    include: employeeInclude,
    orderBy: [{ createdAt: "desc" }, { employeeCode: "asc" }],
  });
  const items = employees.map(mapEmployeeToDto);

  const period = getCurrentPayrollPeriod();
  const monthlyAdvancesAgg = await prisma.employeeTransaction.aggregate({
    where: {
      organizationId: currentUser.organizationId,
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
  const currentUser = await requireOrganizationUser(employeeManagerRoles);
  const employee = await prisma.employee.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    include: employeeInclude,
  });
  if (!employee) {
    throw new OperationsServiceError("Employe introuvable.", 404);
  }
  return mapEmployeeToDto(employee);
}

export async function getEmployeeOptions(): Promise<EmployeeOptionDto[]> {
  const currentUser = await requireOrganizationUser(employeeManagerRoles);

  const employees = await prisma.employee.findMany({
    where: {
      organizationId: currentUser.organizationId,
      status: "ACTIVE",
    },
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
  const currentUser = await requireOrganizationUser(employeeManagerRoles);

  const employee = await prisma.employee.findFirst({
    where: { id, organizationId: currentUser.organizationId },
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
  const currentUser = await requireOrganizationUser(employeeManagerRoles);
  const data = validateEmployeeInput(input);

  try {
    const employee = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          await assertUniqueEmployeeCode(
            tx,
            currentUser.organizationId,
            data.employeeCode,
          );
          const advanceAccountId = await resolveEmployeeAccountingLink(
            tx,
            currentUser.organizationId,
            {
            code: data.advanceAccountCode,
            name: buildEmployeeAdvanceAccountName(data.fullName),
            type: "RECEIVABLE",
            field: "advanceAccountCode",
            },
          );
          const salaryAccountId = await resolveEmployeeAccountingLink(
            tx,
            currentUser.organizationId,
            {
            code: data.salaryAccountCode,
            name: buildEmployeeSalaryAccountName(data.fullName),
            type: "PAYABLE",
            field: "salaryAccountCode",
            },
          );

          return tx.employee.create({
            data: {
              organizationId: currentUser.organizationId,
              employeeCode: data.employeeCode,
              fullName: data.fullName,
              hireDate: parseEmployeeDate(data.hireDate),
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
  const currentUser = await requireOrganizationUser(employeeManagerRoles);
  const data = validateEmployeeInput(input);

  try {
    const employee = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const existing = await tx.employee.findFirst({
            where: { id, organizationId: currentUser.organizationId },
            select: { id: true },
          });
          if (!existing) {
            throw new OperationsServiceError("Employe introuvable.", 404);
          }

          await assertUniqueEmployeeCode(
            tx,
            currentUser.organizationId,
            data.employeeCode,
            id,
          );
          const advanceAccountId = await resolveEmployeeAccountingLink(
            tx,
            currentUser.organizationId,
            {
            code: data.advanceAccountCode,
            name: buildEmployeeAdvanceAccountName(data.fullName),
            type: "RECEIVABLE",
            field: "advanceAccountCode",
            },
          );
          const salaryAccountId = await resolveEmployeeAccountingLink(
            tx,
            currentUser.organizationId,
            {
            code: data.salaryAccountCode,
            name: buildEmployeeSalaryAccountName(data.fullName),
            type: "PAYABLE",
            field: "salaryAccountCode",
            },
          );

          return tx.employee.update({
            where: { id },
            data: {
              employeeCode: data.employeeCode,
              fullName: data.fullName,
              hireDate: parseEmployeeDate(data.hireDate),
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

// F8-C: delegates to the shared decimal-based engine (lib/money.ts) instead
// of `Math.round(value * 100) / 100`.
function roundMoney(value: number) {
  return roundMoneyDecimal(value);
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
