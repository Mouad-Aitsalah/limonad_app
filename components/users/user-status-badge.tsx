import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function UserStatusBadge({ actif }: { actif: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        actif
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-muted-foreground/20 bg-muted text-muted-foreground",
      )}
    >
      {actif ? "Actif" : "Inactif"}
    </Badge>
  );
}
