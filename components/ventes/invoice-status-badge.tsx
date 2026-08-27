import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const config: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Brouillon", className: "border-slate-200 bg-slate-50 text-slate-600" },
  VALIDATED: { label: "Validee", className: "border-blue-200 bg-blue-50 text-blue-700" },
  PARTIALLY_PAID: {
    label: "Partiellement payee",
    className: "border-amber-200 bg-amber-50 text-amber-600",
  },
  PAID: { label: "Payee", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  CREDIT: { label: "Credit", className: "border-amber-200 bg-amber-50 text-amber-600" },
  CANCELLED: { label: "Annulee", className: "border-red-200 bg-red-50 text-red-600" },
  CREDIT_NOTED: {
    label: "Avoir emis",
    className: "border-purple-200 bg-purple-50 text-purple-700",
  },
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const entry = config[status] ?? { label: status, className: "border-border bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={cn(entry.className)}>
      {entry.label}
    </Badge>
  );
}
