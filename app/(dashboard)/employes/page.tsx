import type { Metadata } from "next";

import { EmployeesView } from "@/components/employees/employees-view";
import { getEmployees } from "@/lib/server/employees";

export const metadata: Metadata = {
  title: "Employes",
};

export default async function EmployeesPage() {
  const { items, summary } = await getEmployees();

  return <EmployeesView initialEmployees={items} initialSummary={summary} />;
}
