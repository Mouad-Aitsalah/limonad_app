import { PackageSearch } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeInvoiceTotals } from "@/lib/sales-calculations";
import { getCustomerName } from "@/lib/driver-pos";
import { useCustomersStore } from "@/hooks/use-customers-store";
import { paymentMethods } from "@/lib/mock-data/payment-methods";
import { formatCurrency } from "@/lib/utils";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import type { SaleInvoice } from "@/types/sale";

export function DriverSalesTable({ invoices }: { invoices: SaleInvoice[] }) {
  const customers = useCustomersStore();

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <PackageSearch
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucune vente chauffeur pour le moment.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Facture</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Client</TableHead>
          <TableHead className="text-right">Articles</TableHead>
          <TableHead className="text-right">Total TTC</TableHead>
          <TableHead>Reglement</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead>Camion</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => {
          const totals = computeInvoiceTotals(invoice);
          const paymentLabel =
            paymentMethods.find((method) => method.value === invoice.modeReglement)
              ?.label ?? invoice.modeReglement;

          return (
            <TableRow key={invoice.id}>
              <TableCell className="font-medium text-foreground">
                {invoice.numero}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {invoice.date.toLocaleDateString("fr-FR")}
              </TableCell>
              <TableCell>{getCustomerName(invoice.clientId, customers)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {totals.nombreArticles}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatCurrency(totals.totalTTC)}
              </TableCell>
              <TableCell>{paymentLabel}</TableCell>
              <TableCell>
                <InvoiceStatusBadge status={invoice.statut} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {invoice.truckCode ?? "-"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
