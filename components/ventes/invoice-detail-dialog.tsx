import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import { paymentMethodLabels } from "@/components/ventes/orders-toolbar";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

type InvoiceDetailDialogProps = {
  invoice: SaleDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function InvoiceDetailDialog({ invoice, open, onOpenChange }: InvoiceDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        {invoice && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">Commande {invoice.displayNumber}</DialogTitle>
                <InvoiceStatusBadge status={invoice.status} />
              </div>
              <DialogDescription>
                Detail de la commande et des articles vendus.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
              <div className="grid gap-4 rounded-2xl border border-border bg-muted/40 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">N° commande</p>
                  <p className="text-sm font-medium text-foreground">{invoice.displayNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="text-sm font-medium text-foreground">
                    {new Date(invoice.createdAt).toLocaleString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Client</p>
                  <p className="text-sm font-medium text-foreground">
                    {invoice.customer?.name ?? "Client comptoir"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Chauffeur / utilisateur</p>
                  <p className="text-sm font-medium text-foreground">
                    {invoice.driver?.name ?? invoice.createdByUserName}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Camion</p>
                  <p className="text-sm font-medium text-foreground">
                    {invoice.truck?.code ?? "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mode reglement</p>
                  <p className="text-sm font-medium text-foreground">
                    {paymentMethodLabels[invoice.paymentMethod] ?? invoice.paymentMethod}
                  </p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="text-right">Quantite</TableHead>
                    <TableHead className="text-right">Prix</TableHead>
                    <TableHead className="text-right">Remise</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium text-foreground">
                        {line.productName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(line.unitPriceHT)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.discountRate > 0 ? `${line.discountRate}%` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(line.totalTTC)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator />

              <div className="ml-auto max-w-xs space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total HT</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(invoice.subtotalHT)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">TVA</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(invoice.taxAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-base font-semibold">
                  <span className="text-foreground">Total TTC</span>
                  <span className="tabular-nums text-emerald-700">
                    {formatCurrency(invoice.totalTTC)}
                  </span>
                </div>
                {invoice.net !== undefined && invoice.net !== invoice.totalTTC && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Net (apres avoirs)</span>
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(invoice.net)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
