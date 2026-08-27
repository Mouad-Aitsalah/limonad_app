import { PurchaseStatusBadge } from "@/components/achats/purchase-status-badge";
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
import { purchasePaymentLabels } from "@/lib/mock-data/purchase-payment-methods";
import { suppliers as fallbackSuppliers } from "@/lib/mock-data/suppliers";
import {
  computeLineSousTotal,
  computePurchaseTotals,
  DEFAULT_PURCHASE_TVA_RATE,
} from "@/lib/purchase-calculations";
import { formatCurrency } from "@/lib/utils";
import type { ProductOptionDto } from "@/types/product-dto";
import type { Purchase } from "@/types/purchase";

function supplierName(purchase: Purchase, supplierOptions: ProductOptionDto[]) {
  return (
    purchase.fournisseurNom ??
    supplierOptions.find((supplier) => supplier.id === purchase.fournisseurId)?.name ??
    fallbackSuppliers.find((supplier) => supplier.id === purchase.fournisseurId)?.nom ??
    "-"
  );
}

function userName(purchase: Purchase) {
  return purchase.utilisateurNom ?? purchase.utilisateurId;
}

function formatDate(date: Date | null) {
  if (!date) return "-";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

type PurchaseDetailDialogProps = {
  purchase: Purchase | null;
  supplierOptions: ProductOptionDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PurchaseDetailDialog({
  purchase,
  supplierOptions,
  open,
  onOpenChange,
}: PurchaseDetailDialogProps) {
  const totals = purchase
    ? computePurchaseTotals(purchase.lignes, DEFAULT_PURCHASE_TVA_RATE)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        {purchase && totals ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">
                  Achat {purchase.numero}
                </DialogTitle>
                <PurchaseStatusBadge status={purchase.statut} />
              </div>
              <DialogDescription>
                Détail de la facture d&apos;achat et des articles réceptionnés.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
              <div className="grid gap-4 rounded-2xl border border-border bg-muted/40 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">N° Achat</p>
                  <p className="text-sm font-medium text-foreground">
                    {purchase.numero}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatDate(purchase.date)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fournisseur</p>
                  <p className="text-sm font-medium text-foreground">
                    {supplierName(purchase, supplierOptions)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mode règlement</p>
                  <p className="text-sm font-medium text-foreground">
                    {purchasePaymentLabels[purchase.modeReglement]}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date paiement</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatDate(purchase.datePaiement)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Utilisateur</p>
                  <p className="text-sm font-medium text-foreground">
                    {userName(purchase)}
                  </p>
                </div>
                {purchase.modeReglement === "cheque" ? (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">N° chèque</p>
                      <p className="text-sm font-medium text-foreground">
                        {purchase.numeroCheque}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Banque</p>
                      <p className="text-sm font-medium text-foreground">
                        {purchase.banque}
                      </p>
                    </div>
                  </>
                ) : null}
                {purchase.observation ? (
                  <div className="sm:col-span-3">
                    <p className="text-xs text-muted-foreground">Observation</p>
                    <p className="text-sm font-medium text-foreground">
                      {purchase.observation}
                    </p>
                  </div>
                ) : null}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="text-right">Quantité</TableHead>
                    <TableHead className="text-right">Prix Achat</TableHead>
                    <TableHead className="text-right">Remise</TableHead>
                    <TableHead className="text-right">Sous-total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchase.lignes.map((line, index) => (
                    <TableRow key={`${purchase.id}-${index}`}>
                      <TableCell className="font-medium text-foreground">
                        {line.productName ?? line.productId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantite}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(line.prixAchat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.remisePercent}%
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(computeLineSousTotal(line))}
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
                    {formatCurrency(totals.totalHT)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">TVA</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(totals.totalTVA)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-base font-semibold">
                  <span className="text-foreground">Total TTC</span>
                  <span className="tabular-nums text-emerald-700">
                    {formatCurrency(totals.totalTTC)}
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
