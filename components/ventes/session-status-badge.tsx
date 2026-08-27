import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const config: Record<"OPEN" | "CLOSED", { label: string; className: string }> = {
  OPEN: { label: "Ouverte", className: "border-blue-200 bg-blue-50 text-blue-700" },
  CLOSED: {
    label: "Fermee",
    className: "border-muted-foreground/20 bg-muted text-muted-foreground",
  },
};

export function SessionStatusBadge({ status }: { status: "OPEN" | "CLOSED" }) {
  const { label, className } = config[status];
  return (
    <Badge variant="outline" className={cn(className)}>
      {label}
    </Badge>
  );
}
