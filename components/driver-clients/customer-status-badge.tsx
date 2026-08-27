import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { customerStatusLabels } from "@/lib/customer-utils";
import type { CustomerStatus } from "@/types/customer";

const statusClasses: Record<CustomerStatus, string> = {
  actif: "border-emerald-200 bg-emerald-50 text-emerald-700",
  inactif: "border-slate-200 bg-slate-50 text-slate-600",
  bloque: "border-red-200 bg-red-50 text-red-700",
};

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return (
    <Badge variant="outline" className={cn(statusClasses[status])}>
      {customerStatusLabels[status]}
    </Badge>
  );
}
