import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { computeInvoiceTotals } from "@/lib/sales-calculations";
import { getCustomerName } from "@/lib/driver-pos";
import { formatCurrency } from "@/lib/utils";
import type { SaleInvoice } from "@/types/sale";

type DriverInvoicePreviewProps = {
  invoice: SaleInvoice;
  truckRegistration: string | null;
  onNewSale: () => void;
};

export function DriverInvoicePreview({
  invoice,
  truckRegistration,
  onNewSale,
}: DriverInvoicePreviewProps) {
  const totals = computeInvoiceTotals(invoice);

  return (
    <div className="space-y-4 rounded-3xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-heading text-lg font-semibold text-foreground">
            Vente enregistree avec succes
          </p>
          <p className="text-sm text-muted-foreground">
            Facture {invoice.numero}
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-emerald-700">
          <FileText aria-hidden="true" className="h-5 w-5" />
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-emerald-100 bg-white p-3 text-sm sm:grid-cols-2">
        <Info label="Chauffeur" value={invoice.driverName ?? "-"} />
        <Info
          label="Camion"
          value={`${invoice.truckCode ?? "-"}${
            truckRegistration ? ` - ${truckRegistration}` : ""
          }`}
        />
        <Info label="Client" value={getCustomerName(invoice.clientId)} />
        <Info label="Tournee" value={invoice.tourId ?? "-"} />
        <Info
          label="Date"
          value={invoice.date.toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
        <Info label="Total TTC" value={formatCurrency(totals.totalTTC)} />
      </div>

      <Separator />

      <div className="grid gap-2 sm:grid-cols-3">
        <Button type="button" variant="outline" onClick={() => window.print()}>
          Imprimer la facture
        </Button>
        <Button type="button" variant="outline">
          Afficher la facture
        </Button>
        <Button type="button" onClick={onNewSale}>
          Nouvelle vente
        </Button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
