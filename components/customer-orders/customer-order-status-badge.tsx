import { Badge } from "@/components/ui/badge";
import { customerOrderStatusLabel, type CustomerOrderStatusValue } from "@/lib/client-portal-rules";

const STATUS_CLASS: Record<CustomerOrderStatusValue, string> = {
  SUBMITTED: "border-amber-200 bg-amber-50 text-amber-800",
  ACCEPTED: "border-sky-200 bg-sky-50 text-sky-800",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
  CONVERTED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-600",
};

/** Status of an online customer order - same wording for the customer and the staff. */
export function CustomerOrderStatusBadge({
  status,
  invoicePending,
}: {
  status: CustomerOrderStatusValue;
  /** CONVERTED with a still-pending (DRAFT) invoice -> "Facture en attente" instead of "Facturée". */
  invoicePending?: boolean;
}) {
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]}>
      {customerOrderStatusLabel(status, invoicePending)}
    </Badge>
  );
}
