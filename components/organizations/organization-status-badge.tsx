import { Badge } from "@/components/ui/badge";
import type { OrganizationStatus } from "@/types/organization";

export function OrganizationStatusBadge({
  status,
}: {
  status: OrganizationStatus;
}) {
  return (
    <Badge
      variant={status === "ACTIVE" ? "default" : "secondary"}
      className={status === "ACTIVE" ? "bg-emerald-600 text-white" : ""}
    >
      {status}
    </Badge>
  );
}
