import { Badge } from "@/components/ui/badge";

import type { EmployeeStatus } from "@/types/employees";

const variants: Record<EmployeeStatus, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "secondary",
  INACTIVE: "outline",
};

const labels: Record<EmployeeStatus, string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
};

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}
