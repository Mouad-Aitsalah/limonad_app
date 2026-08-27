import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const config: Record<"EN_COURS" | "TERMINE", { label: string; className: string }> = {
  EN_COURS: { label: "En cours", className: "border-blue-200 bg-blue-50 text-blue-700" },
  TERMINE: {
    label: "Termine",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
};

export function InventoryStatusBadge({ status }: { status: "EN_COURS" | "TERMINE" }) {
  const { label, className } = config[status];
  return (
    <Badge variant="outline" className={cn(className)}>
      {label}
    </Badge>
  );
}
