"use client";

import { Eye, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import {
  getDriverSaleCustomerName,
  getPaymentLabel,
} from "@/lib/driver-sales-calculations";
import { computeInvoiceTotals } from "@/lib/sales-calculations";
import { formatCurrency } from "@/lib/utils";
import type { Customer } from "@/types/customer";
import type { SaleInvoice } from "@/types/sale";
import type { DriverTourSalesGroup } from "@/lib/driver-sales-calculations";

type DriverTourSalesDialogProps = {
  group: DriverTourSalesGroup | null;
  customers: Customer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectInvoice: (invoice: SaleInvoice) => void;
};

export function DriverTourSalesDialog({
  group,
  customers,
  open,
  onOpenChange,
  onSelectInvoice,
}: DriverTourSalesDialogProps) {
  if (!group) return null;

  const { summary, invoices } = group;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{summary.tourCode}</DialogTitle>
          <DialogDescription>
            Ventes realisees pendant cette tournee camion.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Ventes" value={summary.salesCount.toString()} />
          <SummaryItem label="Clients" value={summary.customersCount.toString()} />
          <SummaryItem label="Quantite vendue" value={summary.totalQuantity.toString()} />
          <SummaryItem label="Stock restant" value="Voir /driver/stock" />
          <SummaryItem label="Total HT" value={formatCurrency(summary.totalHT)} />
          <SummaryItem label="TVA" value={formatCurrency(summary.totalTax)} />
          <SummaryItem label="Total TTC" value={formatCurrency(summary.totalTTC)} highlight />
          <SummaryItem label="Encaisse" value={formatCurrency(summary.paidAmount)} />
          <SummaryItem label="Credit" value={formatCurrency(summary.creditAmount)} />
          <SummaryItem label="Avoirs" value={formatCurrency(0)} />
          <SummaryItem label="Remboursements" value={formatCurrency(0)} />
          <SummaryItem label="Camion" value={summary.truckCode} />
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Facture</TableHead>
                <TableHead>Heure</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Articles</TableHead>
                <TableHead className="text-right">HT</TableHead>
                <TableHead className="text-right">TTC</TableHead>
                <TableHead>Reglement</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const totals = computeInvoiceTotals(invoice);
                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <ReceiptText aria-hidden="true" className="h-4 w-4 text-emerald-600" />
                        {invoice.numero}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invoice.date.toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>{getDriverSaleCustomerName(invoice.clientId, customers)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totals.nombreArticles}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totals.totalHT)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(totals.totalTTC)}
                    </TableCell>
                    <TableCell>{getPaymentLabel(invoice.modeReglement)}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={invoice.statut} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onSelectInvoice(invoice)}
                      >
                        <Eye aria-hidden="true" />
                        Voir
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-semibold tabular-nums ${
          highlight ? "text-emerald-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
