import { Badge } from "@/components/ui/badge";
import { employeeTransactionStatusLabels } from "@/lib/employee-payroll";

import type { EmployeeTransactionStatus } from "@/types/employees";

const variants: Record<
  EmployeeTransactionStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  VALIDATED: "secondary",
  CANCELLED: "destructive",
};

export function EmployeeTransactionStatusBadge({
  status,
}: {
  status: EmployeeTransactionStatus;
}) {
  return <Badge variant={variants[status]}>{employeeTransactionStatusLabels[status]}</Badge>;
}
