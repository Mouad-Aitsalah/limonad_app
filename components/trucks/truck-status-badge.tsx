import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const truckStatusConfig = {
  AVAILABLE: {
    label: "Disponible",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  LOADING: {
    label: "Chargement",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  ON_TOUR: {
    label: "En tournee",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  MAINTENANCE: {
    label: "Maintenance",
    className: "border-amber-200 bg-amber-50 text-amber-600",
  },
  INACTIVE: {
    label: "Inactif",
    className: "border-red-200 bg-red-50 text-red-600",
  },
} as const;

export type TruckStatusValue = keyof typeof truckStatusConfig;

export function TruckStatusBadge({ status }: { status: string }) {
  const config =
    truckStatusConfig[status as TruckStatusValue] ?? truckStatusConfig.INACTIVE;

  return (
    <Badge variant="outline" className={cn(config.className)}>
      {config.label}
    </Badge>
  );
}
