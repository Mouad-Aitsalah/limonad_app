import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PurchaseStatus } from "@/types/purchase";

const config: Record<PurchaseStatus, { label: string; className: string }> = {
  validee: {
    label: "Validé",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  en_attente: {
    label: "En attente",
    className: "border-amber-200 bg-amber-50 text-amber-600",
  },
  annulee: {
    label: "Annulée",
    className: "border-red-200 bg-red-50 text-red-600",
  },
};

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  const { label, className } = config[status];
  return (
    <Badge variant="outline" className={cn(className)}>
      {label}
    </Badge>
  );
}
