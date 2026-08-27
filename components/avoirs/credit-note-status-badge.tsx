import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CreditNoteStatus } from "@/types/credit-note";

const statusLabels: Record<CreditNoteStatus, string> = {
  BROUILLON: "Brouillon",
  VALIDE: "Valide",
  CONTREPASSE: "Contrepasse",
};

const statusClasses: Record<CreditNoteStatus, string> = {
  BROUILLON: "border-amber-200 bg-amber-50 text-amber-700",
  VALIDE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CONTREPASSE: "border-slate-200 bg-slate-50 text-slate-600",
};

export function CreditNoteStatusBadge({
  status,
}: {
  status: CreditNoteStatus;
}) {
  return (
    <Badge variant="outline" className={cn(statusClasses[status])}>
      {statusLabels[status]}
    </Badge>
  );
}
