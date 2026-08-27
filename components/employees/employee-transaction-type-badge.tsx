import { Badge } from "@/components/ui/badge";
import { employeeTransactionTypeLabels } from "@/lib/employee-payroll";

import type { EmployeeTransactionType } from "@/types/employees";

export function EmployeeTransactionTypeBadge({
  type,
}: {
  type: EmployeeTransactionType;
}) {
  return <Badge variant="outline">{employeeTransactionTypeLabels[type]}</Badge>;
}
