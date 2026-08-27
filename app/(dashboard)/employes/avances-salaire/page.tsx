import type { Metadata } from "next";

import { EmployeePayrollView } from "@/components/employees/employee-payroll-view";
import { partsToPeriodInput } from "@/lib/employee-payroll";
import { getCurrentSessionUser } from "@/lib/server/auth";
import {
  getEmployeePayrollContext,
  listEmployeeTransactions,
} from "@/lib/server/employee-transactions";
import { getEmployeeOptions } from "@/lib/server/employees";

export const metadata: Metadata = {
  title: "Avances / Salaire",
};

type EmployeePayrollPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EmployeePayrollPage({
  searchParams,
}: EmployeePayrollPageProps) {
  const params = await searchParams;
  const employees = await getEmployeeOptions();

  const requestedEmployeeId =
    typeof params.employeeId === "string" ? params.employeeId : null;
  const initialEmployeeId =
    employees.find((employee) => employee.id === requestedEmployeeId)?.id ??
    employees[0]?.id ??
    "";

  const now = new Date();
  const payrollYear = now.getFullYear();
  const payrollMonth = now.getMonth() + 1;
  const initialPeriodInput = partsToPeriodInput(payrollYear, payrollMonth);

  const [transactions, context, currentUser] = await Promise.all([
    listEmployeeTransactions(),
    initialEmployeeId
      ? getEmployeePayrollContext(initialEmployeeId, { payrollYear, payrollMonth })
      : Promise.resolve(null),
    getCurrentSessionUser(),
  ]);

  return (
    <EmployeePayrollView
      employees={employees}
      initialTransactions={transactions}
      initialContext={context}
      initialEmployeeId={initialEmployeeId}
      initialPeriodInput={initialPeriodInput}
      currentUserName={currentUser?.nom ?? null}
    />
  );
}
