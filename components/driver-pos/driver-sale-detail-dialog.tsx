"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import { products } from "@/lib/mock-data/products";
import {
  getDriverSaleCustomerCode,
  getDriverSaleCustomerName,
  getPaymentLabel,
  getTourById,
} from "@/lib/driver-sales-calculations";
import { computeInvoiceTotals, computeLineTotals } from "@/lib/sales-calculations";
import { formatCurrency } from "@/lib/utils";
import type { Customer } from "@/types/customer";
import type { SaleInvoice } from "@/types/sale";

type DriverSaleDetailDialogProps = {
  invoice: SaleInvoice | null;
  customers: Customer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DriverSaleDetailDialog({
  invoice,
  customers,
  open,
  onOpenChange,
}: DriverSaleDetailDialogProps) {
  if (!invoice) return null;

  const totals = computeInvoiceTotals(invoice);
  const tour = getTourById(invoice.tourId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <DialogTitle>Facture {invoice.numero}</DialogTitle>
              <DialogDescription>
                Detail de la vente chauffeur, client et lignes produits.
              </DialogDescription>
            </div>
            <InvoiceStatusBadge status={invoice.statut} />
          </div>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <InfoBlock label="Client" value={getDriverSaleCustomerName(invoice.clientId, customers)} />
          <InfoBlock label="Code client" value={getDriverSaleCustomerCode(invoice.clientId, customers)} />
          <InfoBlock label="Date" value={invoice.date.toLocaleString("fr-FR")} />
          <InfoBlock label="Chauffeur" value={invoice.driverName ?? invoice.createdByUserName ?? "-"} />
          <InfoBlock label="Camion" value={invoice.truckCode ?? invoice.camionId ?? "-"} />
          <InfoBlock label="Tournee" value={tour?.code ?? invoice.tourId ?? "-"} />
          <InfoBlock label="Reglement" value={getPaymentLabel(invoice.modeReglement)} />
          <InfoBlock label="Avoir lie" value="Aucun" />
          <InfoBlock label="Origine" value="POS chauffeur" />
        </div>

        <Separator />

        <div className="overflow-hidden rounded-2xl border border-border/70">
          <div className="grid grid-cols-12 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="col-span-5">Produit</span>
            <span className="col-span-2 text-right">Qte</span>
            <span className="col-span-2 text-right">PU HT</span>
            <span className="col-span-3 text-right">Total TTC</span>
          </div>
          {invoice.lignes.map((line) => {
            const product = products.find((item) => item.id === line.productId);
            const lineTotals = computeLineTotals(line);
            return (
              <div
                key={`${line.productId}-${line.prixUnitaire}`}
                className="grid grid-cols-12 border-t border-border/70 px-3 py-3 text-sm"
              >
                <span className="col-span-5 font-medium text-foreground">
                  {product?.designation ?? line.productId}
                </span>
                <span className="col-span-2 text-right tabular-nums">
                  {line.quantite}
                </span>
                <span className="col-span-2 text-right tabular-nums">
                  {formatCurrency(line.prixUnitaire)}
                </span>
                <span className="col-span-3 text-right font-medium tabular-nums">
                  {formatCurrency(lineTotals.total)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <TotalBlock label="Total HT" value={formatCurrency(totals.totalHT)} />
          <TotalBlock label="TVA" value={formatCurrency(totals.totalTVA)} />
          <TotalBlock label="Total TTC" value={formatCurrency(totals.totalTTC)} highlight />
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline">
            <Printer aria-hidden="true" />
            Imprimer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  );
}

function TotalBlock({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          highlight ? "text-emerald-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
