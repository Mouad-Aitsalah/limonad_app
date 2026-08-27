import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusClassNames: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  INACTIVE: "border-slate-200 bg-slate-100 text-slate-700",
  BLOCKED: "border-rose-200 bg-rose-50 text-rose-700",
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-700",
  VALIDATED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CREDIT: "border-amber-200 bg-amber-50 text-amber-700",
  DRAFT: "border-slate-200 bg-slate-100 text-slate-700",
  CANCELLED: "border-rose-200 bg-rose-50 text-rose-700",
  LOW_STOCK: "border-amber-200 bg-amber-50 text-amber-700",
  OUT_OF_STOCK: "border-rose-200 bg-rose-50 text-rose-700",
  AVAILABLE: "border-sky-200 bg-sky-50 text-sky-700",
};

type StatusBadgeProps = {
  value: string;
  label?: string;
  className?: string;
};

export function StatusBadge({ value, label, className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        statusClassNames[value] ?? "border-slate-200 bg-white/75 text-slate-700",
        className,
      )}
    >
      {label ?? value.replaceAll("_", " ")}
    </Badge>
  );
}
