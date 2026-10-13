import type { Metadata } from "next";

import { EmployeesView } from "@/components/employees/employees-view";
import { getEmployees } from "@/lib/server/employees";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Employes",
};

export default async function EmployeesPage() {
  await requireModulePage("employees");
  const { items, summary } = await getEmployees();

  return <EmployeesView initialEmployees={items} initialSummary={summary} />;
}
