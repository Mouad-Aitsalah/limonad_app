"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { computeInvoiceTotals } from "@/lib/sales-calculations";
import { getCustomerName } from "@/lib/driver-pos";
import { formatCurrency } from "@/lib/utils";
import type { SaleInvoice } from "@/types/sale";

type DriverCheckoutDialogProps = {
  open: boolean;
  invoice: SaleInvoice | null;
  truckRegistration: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function DriverCheckoutDialog({
  open,
  invoice,
  truckRegistration,
  onOpenChange,
  onConfirm,
}: DriverCheckoutDialogProps) {
  const totals = invoice ? computeInvoiceTotals(invoice) : null;

  function handleConfirm() {
    toast.success("Vente enregistree avec succes");
    onConfirm();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {invoice && totals && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Valider la vente camion</DialogTitle>
              <DialogDescription>
                Facture {invoice.numero} rattachee a votre tournee active.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
              <Info label="Chauffeur" value={invoice.driverName ?? "-"} />
              <Info
                label="Camion"
                value={`${invoice.truckCode ?? "-"}${
                  truckRegistration ? ` - ${truckRegistration}` : ""
                }`}
              />
              <Info label="Client" value={getCustomerName(invoice.clientId)} />
              <Info label="Articles" value={String(totals.nombreArticles)} />
              <Info label="Total HT" value={formatCurrency(totals.totalHT)} />
              <Info label="TVA" value={formatCurrency(totals.totalTVA)} />
              <Info label="Total TTC" value={formatCurrency(totals.totalTTC)} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="button" onClick={handleConfirm}>
                Valider la vente
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  );
}
